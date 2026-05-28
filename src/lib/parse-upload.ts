import Busboy from "busboy";
import { Readable } from "node:stream";

export class UploadTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`File exceeds the ${limitBytes}-byte limit.`);
    this.name = "UploadTooLargeError";
  }
}

export class NoFileError extends Error {
  constructor() {
    super("No file was uploaded.");
    this.name = "NoFileError";
  }
}

export interface ParsedUpload {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Stream-parse a `multipart/form-data` request body, enforcing a hard byte
 * limit. We bail as soon as we exceed `limitBytes` instead of buffering the
 * whole payload — important for a public-facing endpoint.
 *
 * Expects a single file field named `file`.
 */
export function parseUpload(
  req: Request,
  limitBytes: number,
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data."));
      return;
    }
    if (!req.body) {
      reject(new NoFileError());
      return;
    }

    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 1,
        fileSize: limitBytes,
      },
    });

    let settled = false;
    let foundFile = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    busboy.on("file", (fieldname, fileStream, info) => {
      foundFile = true;
      const chunks: Buffer[] = [];

      fileStream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      fileStream.on("limit", () => {
        settle(() => reject(new UploadTooLargeError(limitBytes)));
      });

      fileStream.on("close", () => {
        if (settled) return;
        // `truncated` is the canonical signal from busboy, but `limit` should
        // already have fired. Double-check anyway.
        if (fileStream.truncated) {
          settle(() => reject(new UploadTooLargeError(limitBytes)));
          return;
        }
        settle(() =>
          resolve({
            filename: info.filename,
            mimeType: info.mimeType,
            data: Buffer.concat(chunks),
          }),
        );
      });
    });

    busboy.on("error", (err) => settle(() => reject(err as Error)));
    busboy.on("finish", () => {
      if (!foundFile) settle(() => reject(new NoFileError()));
    });

    // Convert the Web ReadableStream into a Node Readable and pipe in.
    Readable.fromWeb(req.body as never).pipe(busboy);
  });
}
