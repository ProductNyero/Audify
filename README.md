# File to Speech (Next.js + Piper TTS)

Upload a `.txt`, `.md`, or `.docx` file, get back a `.wav` you can play and download.
All synthesis runs **locally** through [Piper TTS](https://github.com/rhasspy/piper) — no paid APIs, no login, no database, no stored history.

Markdown files are passed through [`remove-markdown`](https://www.npmjs.com/package/remove-markdown) first so headings, links, code fences, and emphasis don't get read aloud literally.

**Tables** in `.md`, `.docx`, and `.txt` files are detected and converted into prose before synthesis (intro that names the columns once, then one sentence per row), so Piper doesn't read out repeated column labels or pipe characters. See [Table narration](#table-narration) below.

```
┌────────────┐   multipart/form-data   ┌────────────────────┐    stdin     ┌────────┐
│ Next.js UI │ ──────────────────────▶ │ /api/synthesize    │ ───────────▶ │ piper  │
│ (browser)  │ ◀────────── audio/wav ─ │ extract → spawn    │ ◀── .wav ──── │  CLI   │
└────────────┘                         └────────────────────┘              └────────┘
```

## 1. Prerequisites

- **Node.js 20+**
- **Python 3.9+** (Piper is a Python package)
- **macOS, Linux, or WSL.** Native Windows works but the `download-voice.sh` helper needs bash.

Check what you have:

```bash
node -v
python3 --version
```

## 2. Install Node dependencies

From the project root:

```bash
npm install
```

## 3. Install Piper TTS

Piper is distributed as a Python package called `piper-tts`. The cleanest install on macOS / modern Linux is in a virtual environment so it doesn't fight your system Python:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install piper-tts
```

Sanity check — this should print a help banner:

```bash
piper --help
```

Keep that venv activated while you run `npm run dev`, **or** copy the resolved path and set it explicitly in `.env.local`:

```bash
which piper
# e.g. /Users/you/Desktop/TTS App/.venv/bin/piper
```

## 4. Download a voice model

Piper ships zero voices — you pick one from [the catalogue](https://github.com/rhasspy/piper/blob/master/VOICES.md). The helper script grabs one for you:

```bash
./scripts/download-voice.sh                # defaults to en_US-amy-medium
# or
./scripts/download-voice.sh en_GB-alan-medium
```

That writes two files to `./models/`:

```
models/en_US-amy-medium.onnx        # the model weights
models/en_US-amy-medium.onnx.json   # config (must sit next to the .onnx)
```

Both files are required and Piper expects them to share a basename.

## 5. Configure env vars

Copy the example and edit if needed:

```bash
cp .env.example .env.local
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `PIPER_BIN` | Path to the `piper` executable. Leave as `piper` if on `$PATH`. | `piper` |
| `PIPER_MODEL` | Path to the `.onnx` voice file. | `./models/en_US-amy-medium.onnx` |
| `MAX_UPLOAD_MB` | Hard upload limit, enforced mid-stream. | `5` |
| `MAX_TEXT_CHARS` | How many characters of extracted text to feed Piper. | `10000` |

## 6. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, pick a `.txt`, `.md`, or `.docx` file, and click **Generate speech**. The audio player and download link appear once Piper finishes.

## Project layout

```
src/
├── app/
│   ├── api/synthesize/route.ts   # POST endpoint: upload → extract → piper → wav
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                  # landing page
├── components/
│   └── UploadForm.tsx            # client component: form, states, audio player
└── lib/
    ├── extract-text.ts           # .txt + .md (remove-markdown) + .docx (mammoth)
    ├── table-narration.ts        # formatTableForSpeech + per-format finders
    ├── parse-upload.ts           # streaming multipart parser w/ size limit
    └── piper.ts                  # spawns the Piper CLI, returns WAV bytes
scripts/
└── download-voice.sh             # grabs a voice from Hugging Face
models/                           # voice .onnx + .onnx.json files live here
Dockerfile                        # Node + Python + Piper + model, all baked
brimble.json                      # Brimble project config
```

## Table narration

Raw tables read out terribly through any TTS engine — the engine has no idea cells are cells, so it ends up saying "Column Name, Column Age, Column Department…" or re-reading the headers on every row.

To fix that, every extractor runs the upload through `src/lib/table-narration.ts` **before** the markdown / HTML strip step. The exported `formatTableForSpeech({ headers, rows })` produces a fixed shape with **contextual per-cell sentences** — each value is prefixed with `Under <Header>:` so the listener has constant header context regardless of where they tune in:

> Here is a table with **N** columns: A, B, and C. **First row.** Under A: x. Under B: y. Under C: z. **Second row.** Under A: …

Per-format helpers find tables in each source and splice the narration back into the document in place:

| File | What's detected | How |
| --- | --- | --- |
| `.md` | GFM pipe tables (with the mandatory `\|---\|---\|` separator) | `narrateMarkdownTables` |
| `.docx` | All `<table>` blocks in mammoth's HTML output | `narrateHtmlTables` (driven by `mammoth.convertToHtml`) |
| `.txt` | Pipe tables (`\| a \| b \|`), with or without `+----+` borders | `narratePlainTextTables` |

### Example

This markdown:

```markdown
| Process                 | Description                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Develop Project Charter | It is only when a project has been selected and the business case defined (the project's why) that a charter can be created |
```

…becomes this before being sent to Piper:

> Here is a table with two columns: Process and Description. First row. Under Process: Develop Project Charter. Under Description: It is only when a project has been selected and the business case defined**, in parentheses, the project's why,** that a charter can be created.

Notice the parentheses: they're converted to spoken prose by a separate `narratePunctuation` pass that runs in `normalizeAndValidate`, so Piper doesn't drop them or mumble them. The same pass handles `[brackets]` ("in brackets, …,") and `{braces}` ("in braces, …,"). Empty groups (`()`, `[]`, `{}`) are stripped entirely.

### Behaviors worth knowing

- **Contextual narration.** Each cell becomes its own sentence — "Under \<Header\>: \<Value\>." — so the listener never loses track of which column they're hearing. The repetition reads naturally to a human ear because Piper inserts a sentence-boundary pause between each one.
- **Empty cells are dropped silently.** A row like `\| Bea \|  \| 555-1234 \|` only narrates the populated cells; no dangling "Under Email:" with nothing after it.
- **Ordinal row labels** are words for the first ten rows ("First row", …, "Tenth row") then fall back to "Row 11", "Row 12", … for long tables.
- **Punctuation narration runs at the end**, on the full extracted text. That means parens are spoken whether they appear in a table cell or in regular prose like `(see chapter 5)`.
- **First-row-is-header** for `.docx` is a heuristic — mammoth doesn't always emit `<th>`, so we treat the first row as the header whenever there's more than one row. Wrong only for unusual documents.
- **Column-aligned text tables (separator = spaces)** are NOT detected — they're indistinguishable from regular prose without a layout engine. Use pipe-style tables in `.txt` files if you need narration.
- **PDF is not yet supported** as an upload type. When it is, plug the extractor's text through `narratePlainTextTables` (or render to HTML and use `narrateHtmlTables`) and tables will work the same way.

### Tests

The narration layer has a `node:test` suite covering both the contextual format and the punctuation handling:

```bash
npm test
```

This runs `tests/table-narration.test.ts` against `formatTableForSpeech`, `narratePunctuation`, and each of the per-format finders. Tests use Node's built-in test runner (no Jest/Vitest) and `tsx` to load the TypeScript sources directly.

## Error responses

The API returns a JSON body of shape `{ "error": string }` with these statuses:

| Status | When |
| --- | --- |
| `400` | No file in the request. |
| `413` | File exceeds `MAX_UPLOAD_MB`. |
| `415` | Not a `.txt`, `.md`, or `.docx`. |
| `422` | File is empty / unreadable. |
| `500` | Piper missing, model missing, or synthesis failed. |

The UI surfaces the message verbatim.

## Deploying to Brimble

Brimble can build straight from the `Dockerfile`, which:

1. Installs Node deps and runs `next build` (with `output: "standalone"`).
2. Installs Python + `piper-tts` into `/opt/piper-venv`.
3. Downloads `en_US-amy-medium` into `/app/models/` during the build.
4. Runs the standalone server on port `3000`.

### One-time setup

```bash
# Install the Brimble CLI (skip if you already have it).
npm install -g @brimble/cli
brimble login
```

### Deploy

From the project root:

```bash
brimble deploy
```

Brimble reads `brimble.json`, sees `"framework": "docker"`, builds the image, and exposes port `3000` behind its router.

### Tweaking the deployed config

- **Change the voice** — edit the two `curl` lines and the `PIPER_MODEL` env in the `Dockerfile`, then redeploy. (Voices range from ~20 MB to ~120 MB; "medium" quality is a good default.)
- **Raise upload limit** — bump `MAX_UPLOAD_MB` in `brimble.json` (and `.env.local` for local dev).
- **Add more voices** — `RUN curl …` for each model into `/app/models/`, then accept a voice id from the client and pass `--model` accordingly in `src/lib/piper.ts`.

### Why bake the model into the image?

Brimble containers are ephemeral — anything downloaded at runtime gets re-downloaded on every cold start. Baking the `.onnx` into the image keeps cold starts fast and removes a hard dependency on Hugging Face being reachable from the runtime network.

## Privacy

- Uploaded files are parsed in memory; the raw bytes never touch disk.
- The generated WAV is written to an OS temp directory, read back into memory, and the temp directory is deleted in a `finally` block before the response is sent.
- There is no database, no logging of file contents, and no auth layer — keep the deployment behind your own access control if you process sensitive documents.
