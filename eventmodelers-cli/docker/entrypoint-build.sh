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

# Optional custom model endpoint (MODEL_BASE_URL/MODEL_NAME/MODEL_API_KEY), mapped per harness.
. /usr/local/bin/model-endpoint.sh

exec eventmodelers run --agent "$AGENT" --non-interactive "$@"
