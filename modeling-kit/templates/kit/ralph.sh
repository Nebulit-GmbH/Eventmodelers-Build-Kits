#!/bin/bash
# Eventmodelers agent loop — processes tasks.json indefinitely
# Usage: ./ralph.sh [iterations] [project_dir]
#   iterations  — number of loop cycles; 0 or omitted means run forever
#   project_dir — path to the project root; defaults to ../ (parent of .eventmodelers.ai)

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITERATIONS="${1:-0}"
PROJECT_DIR="${2:-"$KIT_DIR/.."}"
TASKS_FILE="$KIT_DIR/tasks.json"
AGENT_SCRIPT="$KIT_DIR/agent.sh"

if [[ ! -f "$KIT_DIR/.eventmodelers/config.json" ]]; then
  echo "ERROR: No .eventmodelers/config.json found in $KIT_DIR"
  echo "Run: npx @eventmodelers/eventmodelers.ai install"
  exit 1
fi

echo "Eventmodelers agent — kit: $KIT_DIR  project: $PROJECT_DIR"

has_pending_tasks() {
  [[ -f "$TASKS_FILE" ]] || return 1
  local content
  content=$(cat "$TASKS_FILE")
  [[ "$content" != "[]" && -n "$content" ]]
}

run_agent() {
  local prompt="$1"
  local attempt=0
  while [[ $attempt -lt 3 ]]; do
    attempt=$((attempt + 1))
    if (cd "$PROJECT_DIR" && bash "$AGENT_SCRIPT" "$prompt") 2>&1; then
      return 0
    fi
    echo "[ralph] agent error (attempt $attempt/3)"
    if [[ $attempt -lt 3 ]]; then
      sleep 10
    else
      echo "[ralph] task failed 3 times — discarding and continuing"
      node -e "
let t = [];
try { t = JSON.parse(require('fs').readFileSync('$TASKS_FILE', 'utf8')); } catch {}
t.shift();
require('fs').writeFileSync('$TASKS_FILE', JSON.stringify(t, null, 2));
" 2>/dev/null || true
    fi
  done
}

cycle=0
while [[ "$ITERATIONS" -eq 0 || "$cycle" -lt "$ITERATIONS" ]]; do
  if has_pending_tasks; then
    run_agent "Process the next task from tasks.json."
  else
    sleep 5
  fi
  (( cycle++ )) || true
done
