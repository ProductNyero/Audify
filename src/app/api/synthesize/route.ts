import { NextResponse } from "next/server";

import {
  EmptyTextError,
  UnsupportedFileError,
  extractText,
  normalizeAndValidate,
} from "@/lib/extract-text";
import {
  NoFileError,
  UploadTooLargeError,
  parseUpload,
} from "@/lib/parse-upload";
import { PiperError, synthesizeToWav } from "@/lib/piper";

// Force the Node.js runtime — we need `child_process` and the Node stream APIs
// that the edge runtime does not provide.
export const runtime = "nodejs";
// We're handling streaming uploads and binary responses; no caching, please.
export const dynamic = "force-dynamic";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const maxUploadMb = envInt("MAX_UPLOAD_MB", 5);
  const maxTextChars = envInt("MAX_TEXT_CHARS", 10_000);
  const limitBytes = maxUploadMb * 1024 * 1024;

  let upload;
  try {
    upload = await parseUpload(req, limitBytes);
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      return jsonError(
        `File is larger than the ${maxUploadMb} MB limit.`,
        413,
      );
    }
    if (err instanceof NoFileError) {
      return jsonError("No file uploaded. Choose a .txt or .docx file.", 400);
    }
    return jsonError(
      err instanceof Error ? err.message : "Failed to read upload.",
      400,
    );
  }

  let text: string;
  try {
    const raw = await extractText(
      upload.filename,
      upload.mimeType,
      upload.data,
    );
    text = normalizeAndValidate(raw, maxTextChars);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return jsonError(err.message, 415);
    }
    if (err instanceof EmptyTextError) {
      return jsonError(err.message, 422);
    }
    return jsonError(
      err instanceof Error
        ? `Could not read that file: ${err.message}`
        : "Could not read that file.",
      422,
    );
  }

  let wav: Buffer;
  try {
    wav = await synthesizeToWav(text);
  } catch (err) {
    if (err instanceof PiperError) {
      // Surface a friendly message; log the stderr server-side for ops.
      if (err.stderr) {
        console.error("[piper stderr]", err.stderr);
      }
      const userMessage =
        err.code === "MISSING_BIN"
          ? "Speech engine is not installed on the server."
          : err.code === "MISSING_MODEL"
            ? "Speech engine has no voice model configured."
            : "Speech engine failed to generate audio.";
      return jsonError(userMessage, 500);
    }
    console.error("[synthesize] unexpected error", err);
    return jsonError("Unexpected server error.", 500);
  }

  const safeName =
    upload.filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") ||
    "speech";

  // Convert the Node Buffer to a Uint8Array for NextResponse's Body type.
  // Casting to BodyInit keeps TS happy across DOM/Node lib mixes.
  return new NextResponse(new Uint8Array(wav) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": wav.byteLength.toString(),
      "Content-Disposition": `attachment; filename="${safeName}.wav"`,
      "Cache-Control": "no-store",
    },
  });
}
