#!/bin/sh
set -e

AGENT="${AGENT:-claude}"

# Which harness drives the loop: claude (default), opencode or codex.
exec eventmodelers run --standalone --agent "$AGENT" --non-interactive "$@"
