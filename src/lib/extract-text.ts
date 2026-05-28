import mammoth from "mammoth";
import removeMarkdown from "remove-markdown";

import {
  htmlToPlainText,
  narrateHtmlTables,
  narrateMarkdownTables,
  narratePlainTextTables,
  narratePunctuation,
} from "./table-narration";

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

export class EmptyTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyTextError";
  }
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
// Browsers are inconsistent about markdown's mime type — some send
// "text/markdown", some "text/x-markdown", many fall back to "text/plain"
// or "application/octet-stream". The extension is the reliable signal.
const MARKDOWN_MIMES = new Set(["text/markdown", "text/x-markdown"]);

/**
 * Decide which extractor to run based on the filename + mime type.
 * Extension wins over mime because browsers often mis-label .docx and .md.
 *
 * Each branch runs its own table-narration pass BEFORE the markdown / HTML
 * stripping step, so tables turn into prose ("Here is a table with three
 * columns: …. First row: …") that survives the subsequent strip unchanged.
 */
export async function extractText(
  filename: string,
  mime: string | undefined,
  data: Buffer,
): Promise<string> {
  const lower = filename.toLowerCase();

  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    (mime && MARKDOWN_MIMES.has(mime))
  ) {
    const raw = data.toString("utf8");
    // Order matters: turn `| a | b |` blocks into prose FIRST, then strip
    // the remaining inline markdown (headings, emphasis, link URLs, etc).
    const withNarratedTables = narrateMarkdownTables(raw);
    return removeMarkdown(withNarratedTables, {
      stripListLeaders: true,
      gfm: true,
      useImgAltText: true,
    });
  }

  if (lower.endsWith(".docx") || mime === DOCX_MIME) {
    // Use convertToHtml (not extractRawText) so table structure survives.
    // mammoth emits `<table><tr><td>...` which `narrateHtmlTables` can parse.
    const result = await mammoth.convertToHtml({ buffer: data });
    const withNarratedTables = narrateHtmlTables(result.value);
    return htmlToPlainText(withNarratedTables);
  }

  if (lower.endsWith(".txt") || mime === "text/plain") {
    const raw = data.toString("utf8");
    return narratePlainTextTables(raw);
  }

  throw new UnsupportedFileError(
    "Unsupported file type. Upload a .txt, .md, or .docx file.",
  );
}

/**
 * Final TTS-prep pass: whitespace normalization, punctuation narration (so
 * brackets/parens are spoken naturally), emptiness assertion, length cap.
 *
 * Runs after `extractText` regardless of source format, so every code path
 * benefits from the same punctuation handling.
 */
export function normalizeAndValidate(raw: string, maxChars: number): string {
  const cleaned = raw.replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").trim();

  if (!cleaned) {
    throw new EmptyTextError(
      "The file is empty or contains no readable text.",
    );
  }

  // Punctuation narration BEFORE the length cap so a paren block isn't
  // truncated mid-replacement, which would leave a dangling "in parentheses,".
  const spoken = narratePunctuation(cleaned);
  return spoken.slice(0, maxChars);
}
