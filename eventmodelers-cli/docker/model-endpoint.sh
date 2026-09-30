# Sourced by both entrypoints (`. model-endpoint.sh`): points the chosen harness at a custom model endpoint.
#
#   MODEL_BASE_URL  endpoint URL; when empty nothing here does anything
#   MODEL_NAME      model id at that endpoint (required for opencode, optional elsewhere -> --model)
#   MODEL_API_KEY   optional key for that endpoint
#
# Each harness takes its endpoint differently, so the one URL is mapped to the variable or config it reads.
# Wire protocol matters: claude expects the Anthropic API, gemini the Gemini API, the others OpenAI-compatible.
if [ -n "$MODEL_BASE_URL" ]; then
  case "$AGENT" in
    claude)
      export ANTHROPIC_BASE_URL="$MODEL_BASE_URL"
      [ -z "$MODEL_API_KEY" ] || export ANTHROPIC_AUTH_TOKEN="$MODEL_API_KEY"
      ;;
    gemini)
      export GOOGLE_GEMINI_BASE_URL="$MODEL_BASE_URL"
      [ -z "$MODEL_API_KEY" ] || export GEMINI_API_KEY="$MODEL_API_KEY"
      ;;
    hermes)
      export OPENAI_BASE_URL="$MODEL_BASE_URL"
      [ -z "$MODEL_API_KEY" ] || export OPENAI_API_KEY="$MODEL_API_KEY"
      ;;
    codex)
      mkdir -p "$HOME/.codex"
      printf 'model_provider = "custom"\n\n[model_providers.custom]\nname = "Custom"\nbase_url = "%s"\nenv_key = "MODEL_API_KEY"\nwire_api = "responses"\n' \
        "$MODEL_BASE_URL" > "$HOME/.codex/config.toml"
      ;;
    opencode)
      [ -n "$MODEL_NAME" ] || { echo "MODEL_BASE_URL needs MODEL_NAME with AGENT=opencode" >&2; exit 1; }
      key=""
      [ -z "$MODEL_API_KEY" ] || key=',"apiKey":"{env:MODEL_API_KEY}"'
      export OPENCODE_CONFIG_CONTENT='{"provider":{"custom":{"npm":"@ai-sdk/openai-compatible","name":"Custom","options":{"baseURL":"{env:MODEL_BASE_URL}"'"$key"'},"models":{"'"$MODEL_NAME"'":{}}}}}'
      set -- --model "custom/$MODEL_NAME" "$@"
      ;;
    *)
      echo "MODEL_BASE_URL is not supported with AGENT=$AGENT" >&2; exit 1
      ;;
  esac
  # opencode got its prefixed --model above; every other harness takes the plain id.
  if [ "$AGENT" != opencode ] && [ -n "$MODEL_NAME" ]; then set -- --model "$MODEL_NAME" "$@"; fi
fi
