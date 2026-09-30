#!/bin/sh
set -e

AGENT="${AGENT:-claude}"

# Optional custom model endpoint (MODEL_BASE_URL/MODEL_NAME/MODEL_API_KEY), mapped per harness.
. /usr/local/bin/model-endpoint.sh

# Which harness drives the loop: claude (default), opencode or codex.
exec eventmodelers run --standalone --agent "$AGENT" --non-interactive "$@"
