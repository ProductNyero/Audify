import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Thin wrapper around the Piper CLI.
 *
 * Piper is installed via `pip install piper-tts` and exposes a `piper`
 * executable. We invoke it as a child process, write the text to stdin,
 * and ask it to write the resulting WAV to a temp file we then read back.
 *
 * Why a temp file instead of capturing stdout?
 * Piper CAN stream raw audio to stdout, but Node's child_process stdout
 * stream interleaves with logging on some platforms and we'd have to do
 * WAV-header reconstruction. Writing to a file is the safe, portable path.
 */

export class PiperError extends Error {
  constructor(
    message: string,
    public readonly code: "MISSING_BIN" | "MISSING_MODEL" | "PIPER_FAILED",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "PiperError";
  }
}

export interface SynthesizeOptions {
  /** Override the env-configured binary path, mostly for tests. */
  piperBin?: string;
  /** Override the env-configured model path, mostly for tests. */
  modelPath?: string;
  /** Hard limit on how long Piper is allowed to run, in ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function synthesizeToWav(
  text: string,
  opts: SynthesizeOptions = {},
): Promise<Buffer> {
  const piperBin = opts.piperBin ?? process.env.PIPER_BIN ?? "piper";
  const modelPath = opts.modelPath ?? process.env.PIPER_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!modelPath) {
    throw new PiperError(
      "PIPER_MODEL env var is not set. Point it at a .onnx file.",
      "MISSING_MODEL",
    );
  }

  // Each request gets its own temp dir so concurrent requests can't clobber
  // each other's output. We clean it up in `finally`.
  const workDir = await mkdtemp(path.join(tmpdir(), "piper-"));
  const outPath = path.join(workDir, `${randomUUID()}.wav`);

  try {
    await runPiper({
      piperBin,
      modelPath,
      outPath,
      text,
      timeoutMs,
    });
    return await readFile(outPath);
  } finally {
    // Best-effort cleanup; never throw from here.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

interface RunArgs {
  piperBin: string;
  modelPath: string;
  outPath: string;
  text: string;
  timeoutMs: number;
}

function runPiper(args: RunArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      args.piperBin,
      ["--model", args.modelPath, "--output_file", args.outPath],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stderr = "";
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignored — process may already be gone
      }
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(
        new PiperError(
          `Piper timed out after ${args.timeoutMs}ms`,
          "PIPER_FAILED",
          stderr,
        ),
      );
    }, args.timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        fail(
          new PiperError(
            `Piper binary not found at "${args.piperBin}". Did you run "pip install piper-tts"?`,
            "MISSING_BIN",
          ),
        );
        return;
      }
      fail(err);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
      } else {
        reject(
          new PiperError(
            `Piper exited with code ${code}`,
            "PIPER_FAILED",
            stderr,
          ),
        );
      }
    });

    child.stdin.on("error", (err) => fail(err));
    child.stdin.end(args.text, "utf8");
  });
}
