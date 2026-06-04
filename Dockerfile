# syntax=docker/dockerfile:1.7

############################
# 1. Install Node deps      #
############################
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use ci when a lockfile is present, otherwise fall back to install. Brimble
# checks out the repo as-is, so this works whether or not you've run `npm i`
# locally before pushing.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

############################
# 2. Build the Next.js app  #
############################
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

############################
# 3. Runtime: Node + Piper  #
############################
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PIPER_BIN=piper \
    PIPER_MODEL=/app/models/en_US-amy-medium.onnx \
    MAX_UPLOAD_MB=5 \
    MAX_TEXT_CHARS=10000

# Install Python + pip + curl + the libs Piper's onnxruntime wheel needs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ca-certificates curl libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# Install Piper into an isolated virtualenv so we don't fight Debian's PEP 668
# "externally-managed-environment" guard, then expose it on $PATH.
RUN python3 -m venv /opt/piper-venv \
 && /opt/piper-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/piper-venv/bin/pip install --no-cache-dir piper-tts
ENV PATH="/opt/piper-venv/bin:${PATH}"

# Bake the default voice model into the image so the container is self-
# contained on Brimble (no runtime download required, faster cold starts).
RUN mkdir -p /app/models \
 && curl -fL --retry 3 \
      -o /app/models/en_US-amy-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" \
 && curl -fL --retry 3 \
      -o /app/models/en_US-amy-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

# Copy the standalone Next.js build. `output: "standalone"` in next.config.mjs
# produces /app/.next/standalone/server.js plus a minimal node_modules tree.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# Health hint: Brimble can poll "/" to confirm the app is up.
CMD ["node", "server.js"]
