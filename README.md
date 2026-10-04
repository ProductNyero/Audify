# Audify

Upload a `.txt`, `.md`, or `.docx` file, get back a `.wav` you can play and download.
Piper runs on the machine hosting the application - through [Piper TTS](https://github.com/rhasspy/piper) — no paid APIs, no login, no database, no stored history. With a hosted deployment, uploaded documents are processed on the server. 

Markdown files are passed through [`remove-markdown`](https://www.npmjs.com/package/remove-markdown) first so headings, links, code fences, and emphasis don't get read aloud literally.

**Tables** in `.md`, `.docx`, and `.txt` files are detected and converted into prose before synthesis (each populated cell becomes a sentence, with its column heading repeated for context). 

PDF uploads are not supported. By default, conversion is limited to the first 10,000 characters of prepared text.

```
┌────────────┐   multipart/form-data   ┌────────────────────┐    stdin     ┌────────┐
│ Next.js UI │ ──────────────────────▶ │ /api/synthesize    │ ───────────▶ │ piper  │
│ (browser)  │ ◀────────── audio/wav ─ │ extract → spawn    │ ◀── .wav ──── │  CLI   │
└────────────┘                         └────────────────────┘              └────────┘
```


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
```


## Privacy

- Uploaded files are parsed in memory; the raw bytes never touch disk.
- The generated WAV is written to an OS temp directory, read back into memory, and deletion of the temp directory is attempted in a finally block before the response is sent.
- There is no database, no logging of file contents, and no auth layer — keep the deployment behind your own access control if you process sensitive documents.
