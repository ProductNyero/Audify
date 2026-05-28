#!/usr/bin/env bash
# Download a Piper voice model into ./models.
#
# Usage:
#   ./scripts/download-voice.sh                # default voice (en_US-amy-medium)
#   ./scripts/download-voice.sh en_GB-alan-medium
#
# Piper voices are hosted on Hugging Face under rhasspy/piper-voices and follow
# the path  <lang>/<lang_REGION>/<name>/<quality>/<lang_REGION>-<name>-<quality>.onnx
# along with a sibling .onnx.json. We resolve the URL from the voice id.

set -euo pipefail

VOICE="${1:-en_US-amy-medium}"
MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$MODELS_DIR"

# Split "en_US-amy-medium" into lang_region / name / quality.
LANG_REGION="${VOICE%%-*}"          # en_US
REST="${VOICE#*-}"                  # amy-medium
NAME="${REST%-*}"                   # amy
QUALITY="${REST##*-}"               # medium
LANG="${LANG_REGION%%_*}"           # en

BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/${LANG}/${LANG_REGION}/${NAME}/${QUALITY}"
ONNX_URL="${BASE_URL}/${VOICE}.onnx"
JSON_URL="${BASE_URL}/${VOICE}.onnx.json"

echo "Downloading voice '${VOICE}' to ${MODELS_DIR}"
echo "  ${ONNX_URL}"
curl -fL --retry 3 -o "${MODELS_DIR}/${VOICE}.onnx" "${ONNX_URL}"
echo "  ${JSON_URL}"
curl -fL --retry 3 -o "${MODELS_DIR}/${VOICE}.onnx.json" "${JSON_URL}"

echo
echo "Done. Set this in .env.local:"
echo "  PIPER_MODEL=./models/${VOICE}.onnx"
