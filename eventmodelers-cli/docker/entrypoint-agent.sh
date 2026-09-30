#!/bin/sh
set -e

# Which harness drives the loop: claude (default), opencode or codex.
exec eventmodelers run --standalone --agent "${AGENT:-claude}" --non-interactive "$@"
