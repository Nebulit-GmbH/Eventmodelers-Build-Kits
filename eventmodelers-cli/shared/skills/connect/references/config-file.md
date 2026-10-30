# Steps 1 and 3 — Config file walk and persist

## Step 1 — Read config file

Search for `.eventmodelers/config.json` starting from the current working directory and walking up through all parent directories. This is the same file every kit installed in this project reads and writes, so credentials only need to be entered once per project:

```bash
dir="$PWD"
config_file=""
while [ "$dir" != "/" ]; do
  if [ -f "$dir/.eventmodelers/config.json" ]; then
    config_file="$dir/.eventmodelers/config.json"
    break
  fi
  dir="$(dirname "$dir")"
done
[ -n "$config_file" ] && cat "$config_file"
```

If a file is found (at any level), note its path and extract any values **not already set by Step 0**:
- `token` → `TOKEN`
- `boardId` → `BOARD_ID`
- `organizationId` (or `orgId`) → `ORG_ID`
- `baseUrl` → `BASE_URL` (default: `https://api.eventmodelers.ai` if missing)

Resolution priority: **inline param > config file > ask user**

If all four are present (from any source), skip straight to **Step 4 — Verify** — do **not** run Step 3. Step 3 only runs after Step 2 collects a value interactively from the user; if nothing was collected interactively (values came from inline params and/or an existing config file), there is nothing new to persist.

## Step 3 — Persist config

Only reached when Step 2 collected at least one value interactively from the user. Once all values are collected, write the config file. When writing, merge with any existing config — do **not** overwrite fields that were provided as inline params with values from a previous config (the inline param is the user's explicit intent for this session, but the persisted value should reflect the most recently user-supplied value):

```bash
mkdir -p .eventmodelers
cat > .eventmodelers/config.json << 'EOF'
{
  "token": "<TOKEN>",
  "boardId": "<BOARD_ID>",
  "organizationId": "<ORG_ID>",
  "baseUrl": "<BASE_URL>"
}
EOF
```

Then ensure `.eventmodelers/config.json` is in `.gitignore`. Check whether it is already present:

```bash
grep -q ".eventmodelers/config.json" .gitignore 2>/dev/null || echo "MISSING"
```

If `MISSING`, append it:

```bash
echo ".eventmodelers/config.json" >> .gitignore
```

Tell the user: `"Config saved to .eventmodelers/config.json and added to .gitignore."`

## Config file format

`.eventmodelers/config.json`:
```json
{
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "boardId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "organizationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "baseUrl": "http://localhost:3000"
}
```

The `token` field is a secret. It is never logged or shown after initial confirmation.
