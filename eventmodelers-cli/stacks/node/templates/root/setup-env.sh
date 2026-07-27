#!/usr/bin/env bash
set -euo pipefail

prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local value
  read -rp "$prompt_text: " value
  if [[ -z "$value" ]]; then
    echo "Error: $var_name cannot be empty." >&2
    exit 1
  fi
  echo "$value"
}

prompt_secret() {
  local var_name="$1"
  local prompt_text="$2"
  local value
  read -rsp "$prompt_text: " value
  echo "" >&2
  if [[ -z "$value" ]]; then
    echo "Error: $var_name cannot be empty." >&2
    exit 1
  fi
  echo "$value"
}

echo "=== Postgres .env setup ==="
echo ""

DB_HOST=$(prompt DB_HOST "Postgres host (e.g. localhost)")
DB_PORT=$(prompt DB_PORT "Postgres port (e.g. 5432)")
DB_NAME=$(prompt DB_NAME "Database name (e.g. postgres)")
DB_USER=$(prompt DB_USER "Database user (e.g. postgres)")
DB_PASSWORD=$(prompt_secret DB_PASSWORD "Database password")
BACKEND_URL=$(prompt BACKEND_URL "Backend URL (e.g. http://localhost:3000)")

cat > .env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?prepareThreshold=0

BACKEND_URL=${BACKEND_URL}
PORT=3000
API_URL=${BACKEND_URL}

# Flyway configuration
FLYWAY_URL=jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}
FLYWAY_USER=${DB_USER}
FLYWAY_PASSWORD=${DB_PASSWORD}
EOF

echo ""
echo ".env created successfully."