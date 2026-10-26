#!/bin/sh
set -e

AGENT="${AGENT:-claude}"

# Which harness drives the loop: claude (default), opencode, codex, gemini, hermes or pi.
exec eventmodelers run --standalone --agent "$AGENT" --non-interactive "$@"
