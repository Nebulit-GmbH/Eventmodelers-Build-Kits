#!/usr/bin/env bash
# Fails when an agent image carries anything that looks like a credential.
# Usage: scan-image.sh <image>   (the image must already be in the local docker daemon)
#
# Credentials are supposed to arrive through the environment at `docker run` time; nothing may
# be baked into a layer, the image config or the filesystem. Run before every push.
set -euo pipefail

image=${1:?usage: scan-image.sh <image>}
work=$(mktemp -d)
cid=""
cleanup() { [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

fail=0
flag() { echo "::error::$image: $1"; fail=1; }

# Token-shaped strings. `_authToken` is deliberately not here: it only matters in an rc file
# (checked by name below), and npm/yarn's own code mentions it.
patterns='npm_[A-Za-z0-9]{36}|dckr_pat_|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY'

echo "== config + history"
meta=$( { docker inspect "$image" --format '{{json .Config.Env}}{{json .Config.Cmd}}{{json .Config.Entrypoint}}'; \
          docker history --no-trunc --format '{{.CreatedBy}}' "$image"; } )
if grep -Eq 'EVENTMODELERS_(TOKEN|ORGANIZATION_ID|BOARD_ID)=[^ "\\]+' <<<"$meta"; then
  flag "EVENTMODELERS_* value set in image config or a layer's command"
fi
if grep -Eq "$patterns" <<<"$meta"; then flag "token-shaped string in image config or history"; fi

echo "== filesystem"
cid=$(docker create "$image")
docker export "$cid" | tar -x -C "$work" 2>/dev/null || true

# Only the places a build or a test run could have written to; node_modules and the distro's
# own trust store are out of scope.
roots=()
for d in workspace home root opt/eventmodelers-cli etc usr/local/bin; do [ -d "$work/$d" ] && roots+=("$work/$d"); done

# Files that exist only to hold credentials. `.env.example` templates and empty rc files are fine.
while IFS= read -r f; do
  case "$f" in
    *.env.example|*.env.sample) continue ;;
    */.npmrc|*/.yarnrc|*/.yarnrc.yml) [ -s "$f" ] || continue ;;
  esac
  flag "credential file present: ${f#"$work"}"
done < <(find "${roots[@]}" -path '*/node_modules' -prune -o -type f \( \
    -name '.env' -o -name '.env.*' -o -name auth.json -o -name opencode.json -o -name '.netrc' \
    -o -name '.git-credentials' -o -name '.dockercfg' -o -name '.npmrc' -o -name '.yarnrc' -o -name '.yarnrc.yml' \
    -o -name '*.pem' -o -name 'id_rsa*' -o -name 'id_ed25519*' \
    -o -path '*/.docker/config.json' -o -path '*/.aws/*' -o -path '*/.ssh/*' \
    -o -path '*/.eventmodelers/config.json' \) -print 2>/dev/null)

# Token-shaped content anywhere in those roots.
if hits=$(grep -rIlE --exclude-dir=node_modules "$patterns" "${roots[@]}" 2>/dev/null) && [ -n "$hits" ]; then
  while IFS= read -r f; do flag "token-shaped string in ${f#"$work"}"; done <<<"$hits"
fi

# A populated "token" field in a config file (placeholders like <TOKEN> or ${VAR} are fine).
# JSON files under /workspace and the home dirs only: the skill docs (.md) show example payloads.
homes=()
for d in workspace home root; do [ -d "$work/$d" ] && homes+=("$work/$d"); done
if [ ${#homes[@]} -gt 0 ]; then
  if hits=$(grep -rIlE --include='*.json' --exclude-dir=node_modules '"(token|apiKey|api_key)"[[:space:]]*:[[:space:]]*"[^"<$]' "${homes[@]}" 2>/dev/null) && [ -n "$hits" ]; then
    while IFS= read -r f; do flag "populated token field in ${f#"$work"}"; done <<<"$hits"
  fi
fi

if [ "$fail" -ne 0 ]; then echo "credential scan FAILED for $image"; exit 1; fi
echo "credential scan clean: $image"
