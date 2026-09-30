#!/bin/sh
set -e

# Which harness drives the loop; the images set it, opencode is the default for older ones.
AGENT="${AGENT:-opencode}"

# A mounted checkout hides anything baked into /workspace, so the kit is installed here, not at build time.
git config --global --get user.email >/dev/null 2>&1 || git config --global user.email "agent@eventmodelers.ai"
git config --global --get user.name >/dev/null 2>&1 || git config --global user.name "Eventmodelers Build Agent"
[ -d .git ] || git init -q

if [ ! -d .build-kit ]; then
  # init asks where credentials come from; 4 = skip, they come from the environment.
  # Community kits are cloned from KIT_GIT (init --stack <name> --git <url>); built-in stacks need no URL.
  printf '4\n' | eventmodelers init --stack "$STACK" ${KIT_GIT:+--git "$KIT_GIT"}
  # Claude Code reads .claude/skills natively; other harnesses need stubs for their own skill directory.
  [ "$AGENT" = claude ] || eventmodelers init-agents --hosts "$AGENT"
fi

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

exec eventmodelers run --agent "$AGENT" --non-interactive "$@"
