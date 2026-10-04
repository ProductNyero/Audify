"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "working"; phase: "uploading" | "synthesizing" }
  | { kind: "error"; message: string }
  | { kind: "done"; audioUrl: string; filename: string };

const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".docx"] as const;

interface Props {
  maxUploadMb: number;
}

export default function UploadForm({ maxUploadMb }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revoke any previous object URL when a new one replaces it, or on unmount.
  useEffect(() => {
    return () => {
      if (status.kind === "done") URL.revokeObjectURL(status.audioUrl);
    };
  }, [status]);

  const reset = () => {
    setFile(null);
    setStatus({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPick = (picked: File | null) => {
    if (!picked) {
      setFile(null);
      return;
    }
    const lower = picked.name.toLowerCase();
    const okExt = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!okExt) {
      setStatus({
        kind: "error",
        message: "Only .txt, .md, and .docx files are supported.",
      });
      setFile(null);
      return;
    }
    if (picked.size > maxUploadMb * 1024 * 1024) {
      setStatus({
        kind: "error",
        message: `That file is larger than the ${maxUploadMb} MB limit.`,
      });
      setFile(null);
      return;
    }
    setFile(picked);
    setStatus({ kind: "idle" });
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;

    // Revoke any previous result before starting a new run.
    if (status.kind === "done") URL.revokeObjectURL(status.audioUrl);

    setStatus({ kind: "working", phase: "uploading" });

    const fd = new FormData();
    fd.append("file", file);

    let res: Response;
    try {
      res = await fetch("/api/synthesize", { method: "POST", body: fd });
    } catch {
      setStatus({
        kind: "error",
        message:
          "Could not reach the server. Check your connection and try again.",
      });
      return;
    }

    setStatus({ kind: "working", phase: "synthesizing" });

    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // Body wasn't JSON; keep the generic message.
      }
      setStatus({ kind: "error", message });
      return;
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const base = file.name.replace(/\.[^.]+$/, "") || "speech";
    setStatus({ kind: "done", audioUrl, filename: `${base}.wav` });
  };

  const isWorking = status.kind === "working";
  const showReset = file !== null || status.kind !== "idle";

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/1.5 p-3 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_64px_-24px_rgba(0,0,0,0.6)]"
    >
      <label
        htmlFor="file"
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-black/30 px-6 py-12 text-center transition ${
          isWorking
            ? "cursor-not-allowed border-white/10 opacity-60"
            : "border-white/12 hover:border-white/25 hover:bg-black/40"
        }`}
      >
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/4 text-white/80 transition group-hover:border-white/20 group-hover:text-white"
        >
          {file ? <FileGlyph /> : <UploadGlyph />}
        </span>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-white">
            {file ? file.name : "Click to choose a file"}
          </span>
          <span className="text-xs text-white/45">
            {file
              ? formatBytes(file.size)
              : `TXT, DOCX, or MD · up to ${maxUploadMb} MB`}
          </span>
        </div>

        <input
          ref={inputRef}
          id="file"
          name="file"
          type="file"
          accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          disabled={isWorking}
        />
      </label>

      <div className="flex items-center justify-between gap-3 px-1">
        <button
          type="submit"
          disabled={!file || isWorking}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 shadow-xs transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/6 disabled:text-white/35"
        >
          {isWorking && <Spinner />}
          {isWorking
            ? status.phase === "uploading"
              ? "Uploading"
              : "Synthesizing"
            : "Generate speech"}
        </button>

        {showReset && (
          <button
            type="button"
            onClick={reset}
            disabled={isWorking}
            className="rounded-lg px-3 py-2 text-sm text-white/55 transition hover:text-white disabled:opacity-40"
          >
            Reset
          </button>
        )}
      </div>

      <div aria-live="polite" className="contents">
        {status.kind === "error" && (
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-red-500/20 bg-red-500/6 px-4 py-3 text-sm text-red-200"
          >
            <ErrorGlyph />
            <span className="leading-relaxed">{status.message}</span>
          </div>
        )}

        {status.kind === "done" && (
          <div className="flex flex-col gap-4 rounded-xl border border-white/8 bg-white/2.5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                />
                Audio ready
              </div>
              <span className="text-xs text-white/40">
                {status.filename}
              </span>
            </div>

            <audio src={status.audioUrl} controls />

            <a
              href={status.audioUrl}
              download={status.filename}
              className="inline-flex items-center gap-2 self-start rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-sm text-white/85 transition hover:border-white/20 hover:text-white"
            >
              <DownloadGlyph />
              Download .wav
            </a>
          </div>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers — kept colocated since they're only used by this form.
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function UploadGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ErrorGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
