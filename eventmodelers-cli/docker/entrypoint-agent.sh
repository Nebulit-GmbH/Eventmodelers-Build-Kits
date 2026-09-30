#!/bin/sh
set -e

# MODEL_BASE_URL points opencode at any OpenAI-compatible endpoint (local server, OpenRouter, LiteLLM, a gateway).
# MODEL_NAME is the id that endpoint knows; MODEL_API_KEY is optional.
if [ -n "$MODEL_BASE_URL" ]; then
  [ "$AGENT" = opencode ] || { echo "MODEL_BASE_URL is only supported with AGENT=opencode" >&2; exit 1; }
  [ -n "$MODEL_NAME" ] || { echo "MODEL_BASE_URL needs MODEL_NAME" >&2; exit 1; }
  key=""
  [ -z "$MODEL_API_KEY" ] || key=',"apiKey":"{env:MODEL_API_KEY}"'
  export OPENCODE_CONFIG_CONTENT='{"provider":{"custom":{"npm":"@ai-sdk/openai-compatible","name":"Custom","options":{"baseURL":"{env:MODEL_BASE_URL}"'"$key"'},"models":{"'"$MODEL_NAME"'":{}}}}}'
  set -- --model "custom/$MODEL_NAME" "$@"
fi

# Which harness drives the loop: claude (default), opencode or codex.
exec eventmodelers run --standalone --agent "${AGENT:-claude}" --non-interactive "$@"
