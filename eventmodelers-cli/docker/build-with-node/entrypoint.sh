#!/bin/sh
set -e

# A mounted checkout hides anything baked into /workspace, so the kit is installed here, not at build time.
git config --global --get user.email >/dev/null 2>&1 || git config --global user.email "agent@eventmodelers.ai"
git config --global --get user.name >/dev/null 2>&1 || git config --global user.name "Eventmodelers Build Agent"
[ -d .git ] || git init -q

if [ ! -d .build-kit ]; then
  # init asks where credentials come from; 4 = skip, they come from the environment.
  printf '4\n' | eventmodelers init --stack "$STACK"
  eventmodelers init-agents --hosts opencode
fi

exec eventmodelers run --agent opencode --non-interactive "$@"
