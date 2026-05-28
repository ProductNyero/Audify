import removeMarkdown from "remove-markdown";

/**
 * Converts tabular data into prose suitable for a TTS engine. Tables get read
 * as: a short intro that lists the columns, followed by one sentence per cell
 * where each cell is contextualized by its column header.
 *
 * Output shape (per the contextual-narration requirement):
 *
 *   Here is a table with N columns: A, B, and C.
 *   First row. Under A: <value>. Under B: <value>. Under C: <value>.
 *   Second row. Under A: <value>. ...
 *
 * The module is split into three layers:
 *   - `formatTableForSpeech`  — the shape-agnostic narrator (`{headers, rows}`)
 *   - per-format finders      — detect tables in markdown / HTML / plain text,
 *                               replace them in-place with their narration
 *   - `narratePunctuation`    — turns `(x)` / `[x]` / `{x}` into spoken form
 *                               so Piper doesn't drop or mumble them
 *
 * Design choices for the MVP:
 *   - Each cell is its own sentence, "Under <Header>: <Value>.". The repetition
 *     gives Piper natural prosody breaks and makes the row easy to follow even
 *     without visual structure.
 *   - Empty cells and fully empty rows are dropped silently.
 *   - First-row-is-header is the default for HTML and markdown tables (markdown
 *     enforces this with the `|---|` separator; HTML lets it slide).
 */

export interface Table {
  /** Column headers, or null if the source clearly has no header row. */
  headers: string[] | null;
  /** Each inner array is a row; cell order matches headers when headers exist. */
  rows: string[][];
}

// ---------------------------------------------------------------------------
// Public: narrator
// ---------------------------------------------------------------------------

export function formatTableForSpeech(table: Table): string {
  const cleanedRows = table.rows
    .map((row) => row.map((cell) => normalizeCell(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));

  const cleanedHeaders = table.headers
    ? table.headers.map((h) => normalizeCell(h))
    : null;

  const hasHeaders =
    cleanedHeaders !== null && cleanedHeaders.some((h) => h.length > 0);

  if (cleanedRows.length === 0 && !hasHeaders) {
    return "";
  }

  const parts: string[] = [];

  if (hasHeaders) {
    // Intro lists the named columns once — the row sentences below repeat
    // each header inline as "Under <Header>:" so the listener has constant
    // context regardless of where they tune in.
    const namedHeaders = cleanedHeaders!.filter((h) => h.length > 0);
    parts.push(introWithHeaders(namedHeaders));
  } else if (cleanedRows.length > 0) {
    parts.push(introWithoutHeaders(cleanedRows.length));
  }

  cleanedRows.forEach((row, idx) => {
    const sentence = narrateRow(row, cleanedHeaders, idx);
    if (sentence) parts.push(sentence);
  });

  return parts.join(" ");
}

/**
 * Build the spoken form of a single row, e.g.
 *   "First row. Under Process: Develop Project Charter. Under Description: …"
 *
 * Cells are mapped to their column header by position. Cells whose header is
 * empty are read as bare sentences ("<Value>."). Empty cells are skipped.
 */
function narrateRow(
  row: string[],
  headers: string[] | null,
  zeroBasedIndex: number,
): string {
  const sentences: string[] = [];
  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    if (!value) continue;
    const header = headers && headers[i] ? headers[i] : null;
    sentences.push(
      header
        ? `Under ${header}: ${ensureSentenceEnd(value)}`
        : ensureSentenceEnd(value),
    );
  }
  if (sentences.length === 0) return "";
  return `${ordinalRow(zeroBasedIndex)}. ${sentences.join(" ")}`;
}

/**
 * Append a period to a string if it doesn't already end with terminal
 * punctuation. Keeps the narration from producing "...created.." double-dots
 * when a cell already ends in `.`, `!`, or `?`.
 */
function ensureSentenceEnd(s: string): string {
  const trimmed = s.replace(/\s+$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Convert paired brackets/parens/braces into spoken prose so Piper doesn't
 * drop them or read them awkwardly:
 *
 *   "...defined (the project's why) that a..."
 *     → "...defined, in parentheses, the project's why, that a..."
 *
 * Applied to the final text just before TTS, so it works for both narrated
 * table cells and regular prose. Iterates a few passes to handle simple
 * nesting like "(see [fig. 3])"; deeply nested pathological inputs are
 * intentionally left partially expanded rather than risking a regex explosion.
 */
export function narratePunctuation(text: string): string {
  let out = text;

  // Empty groups carry no information and would otherwise produce a
  // dangling "in parentheses," with nothing to follow.
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/\[\s*\]/g, "");
  out = out.replace(/\{\s*\}/g, "");

  // Expand innermost-first by iterating. Cap iterations as a safety net.
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out.replace(/\(([^()]+)\)/g, ", in parentheses, $1,");
    out = out.replace(/\[([^[\]]+)\]/g, ", in brackets, $1,");
    out = out.replace(/\{([^{}]+)\}/g, ", in braces, $1,");
    if (out === before) break;
  }

  // Clean up artifacts introduced by the surrounding commas:
  //   - collapse repeat whitespace
  //   - merge runs of commas
  //   - drop spaces before terminal punctuation
  //   - drop the trailing "," our regex inserts when a paren ends a sentence
  //     ("mostly,." → "mostly.")
  //   - drop a trailing ", " that lands right after a sentence end
  //   - trim a leading ", " left when a paren opened the line
  out = out
    .replace(/[ \t]+/g, " ")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/,([.!?;:])/g, "$1")
    .replace(/([.!?])\s*,/g, "$1")
    .replace(/(^|\n)\s*,\s*/g, "$1");

  return out.trim();
}

// ---------------------------------------------------------------------------
// Public: per-format finders
// ---------------------------------------------------------------------------

/**
 * Replace GFM-style markdown tables with their spoken narration. Markdown
 * tables are reliably detectable thanks to the mandatory `|---|---|` separator
 * row between the header and the data rows.
 */
export function narrateMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (
      isPipeRow(lines[i]) &&
      i + 1 < lines.length &&
      isMarkdownSeparator(lines[i + 1])
    ) {
      const headers = parsePipeRow(lines[i]).map(stripInlineMarkdown);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && isPipeRow(lines[j])) {
        rows.push(parsePipeRow(lines[j]).map(stripInlineMarkdown));
        j++;
      }
      const narration = formatTableForSpeech({ headers, rows });
      if (narration) out.push(narration);
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

/**
 * Replace each `<table>...</table>` in an HTML string (e.g. mammoth output)
 * with its spoken narration. Uses regex parsing, which is safe here because
 * mammoth produces predictable, well-formed table markup.
 */
export function narrateHtmlTables(html: string): string {
  return html.replace(TABLE_RE, (_, body: string) => {
    const table = parseHtmlTable(body);
    const narration = formatTableForSpeech(table);
    // Surround with blank lines so the narration becomes its own paragraph
    // once we later strip the rest of the HTML.
    return narration ? `\n\n${narration}\n\n` : "";
  });
}

/**
 * Replace ASCII / pipe-bar tables in plain text with narration. We only detect
 * pipe tables (`| a | b |`), optionally bordered by `+----+----+` separators.
 * Column-aligned text tables (separator = runs of spaces) are intentionally
 * NOT detected — they're indistinguishable from formatted prose without a
 * proper layout engine.
 */
export function narratePlainTextTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isPipeRow(lines[i])) {
      const tableLines: string[] = [];
      let j = i;
      while (
        j < lines.length &&
        (isPipeRow(lines[j]) ||
          isMarkdownSeparator(lines[j]) ||
          isAsciiBorder(lines[j]))
      ) {
        if (isPipeRow(lines[j])) tableLines.push(lines[j]);
        j++;
      }
      // Require at least two pipe rows before we treat it as a table — a single
      // line with bars (e.g. "use | for pipes") is probably prose.
      if (tableLines.length >= 2) {
        const parsed = tableLines.map(parsePipeRow);
        const headers = parsed[0];
        const rows = parsed.slice(1);
        const narration = formatTableForSpeech({ headers, rows });
        if (narration) out.push(narration);
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ORDINAL_WORDS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
] as const;

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

function ordinalRow(zeroBasedIndex: number): string {
  const word = ORDINAL_WORDS[zeroBasedIndex];
  return word ? `${word} row` : `Row ${zeroBasedIndex + 1}`;
}

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function oxfordJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function introWithHeaders(headers: string[]): string {
  const n = headers.length;
  const colWord = n === 1 ? "column" : "columns";
  return `Here is a table with ${countWord(n)} ${colWord}: ${oxfordJoin(headers)}.`;
}

function introWithoutHeaders(rowCount: number): string {
  const word = rowCount === 1 ? "row" : "rows";
  return `Here is a table with ${countWord(rowCount)} ${word}.`;
}

function normalizeCell(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function stripInlineMarkdown(s: string): string {
  return removeMarkdown(s, {
    stripListLeaders: false,
    gfm: true,
    useImgAltText: true,
  }).trim();
}

// ----- pipe-row helpers (shared by markdown + plain text finders) ----------

function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  // At least two pipes (one column).
  const pipeCount = (trimmed.match(/\|/g) ?? []).length;
  return pipeCount >= 2;
}

function isMarkdownSeparator(line: string): boolean {
  const trimmed = line.trim();
  // | --- | :---: | ---: |   — pipes, dashes, colons, whitespace; at least one dash
  return /^\|[\s:|-]+\|$/.test(trimmed) && trimmed.includes("-");
}

function isAsciiBorder(line: string): boolean {
  // +----+----+ or |----|----|  — only +, -, |, whitespace, with a dash
  const trimmed = line.trim();
  return (
    trimmed.length >= 3 &&
    /^[+|\s-]+$/.test(trimmed) &&
    trimmed.includes("-") &&
    /[+|]/.test(trimmed)
  );
}

function parsePipeRow(line: string): string[] {
  const trimmed = line.trim();
  // Strip the leading and trailing pipes, then split on the inner ones.
  const inner = trimmed.slice(1, -1);
  return inner.split("|").map((c) => c.trim());
}

// ----- HTML helpers --------------------------------------------------------

const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;

interface ParsedHtmlRow {
  cells: string[];
  isHeaderRow: boolean;
}

function parseHtmlTable(tableHtml: string): Table {
  const rows: ParsedHtmlRow[] = [];

  // Reset stateful regex lastIndex before each use — these are module-level
  // regexes, so a previous call left lastIndex in an unpredictable state.
  ROW_RE.lastIndex = 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = ROW_RE.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let hasTh = false;

    CELL_RE.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = CELL_RE.exec(rowHtml)) !== null) {
      if (cellMatch[1].toLowerCase() === "th") hasTh = true;
      cells.push(stripTagsAndDecode(cellMatch[2]));
    }

    if (cells.length > 0) {
      rows.push({ cells, isHeaderRow: hasTh });
    }
  }

  if (rows.length === 0) return { headers: null, rows: [] };

  // Heuristic: prefer an explicit <th>-bearing first row; otherwise assume the
  // first row is the header iff we have at least one data row to compare it to.
  if (rows[0].isHeaderRow || rows.length > 1) {
    return {
      headers: rows[0].cells,
      rows: rows.slice(1).map((r) => r.cells),
    };
  }
  return { headers: null, rows: rows.map((r) => r.cells) };
}

function stripTagsAndDecode(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)));
}

/**
 * Convert a (possibly tag-rich) HTML string into plain text suitable for TTS.
 * Block-level tags become paragraph breaks; everything else is stripped.
 * Exposed here so `extract-text.ts` can reuse it after `narrateHtmlTables`.
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|thead|tbody|tfoot)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|li|tr|table|thead|tbody|tfoot)\b[^>]*>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
