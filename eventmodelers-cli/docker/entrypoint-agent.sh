#!/bin/sh
set -e

AGENT="${AGENT:-claude}"

# Which harness drives the loop: claude (default), opencode, codex, gemini, hermes, pi or kiro.
exec eventmodelers run --standalone --agent "$AGENT" --non-interactive "$@"
