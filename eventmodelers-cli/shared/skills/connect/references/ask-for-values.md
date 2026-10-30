# Step 2 — Ask for missing values

If after Steps 0 and 1 any required field is still missing, **ask the user one question first**:

> "Do you have a config from the eventmodelers accounts page? (yes / no)"

**If the user answers yes:**
Stop asking questions. Show this hint and wait for them to paste:

> "Great — please paste your config from https://app.eventmodelers.ai/account here."

The paste may be either a JSON object, or a single comma-separated line of `key=value` pairs (as copied out of a URL query string), in any order, e.g.:
```
token=xxxxxxxx-...,boardId=xxxxxxxx-...,organizationId=xxxxxxxx-...,baseUrl=https://api.eventmodelers.ai
```

Parse either form immediately — accept both `orgId` and `organizationId` as the organization field. For the comma-separated form, split on commas and match each piece by its `key=` prefix (`token`, `boardId`, `organizationId`/`orgId`, `baseUrl`) rather than by position — do **not** assume a fixed field order, since the order the value was copied in and the order it's pasted in are not guaranteed to match. If a value has no recognizable `key=` prefix, treat it as an error and re-ask rather than guessing which field it belongs to. Apply all values, and proceed directly to Step 3.

**If the user answers no** (or pastes only a partial config), ask for each still-missing field one at a time, in this order: `token`, then `boardId`, then `orgId`. Wait for the answer before asking the next.

| Field | What to ask                                                                          |
|-------|--------------------------------------------------------------------------------------|
| `token` | "Please provide your eventmodelers API token (a UUID from your workspace settings)." |
| `boardId` | "Please provide the board ID you want to work with (the UUID from the board URL)."   |
| `orgId` | "Please provide your organization ID (the UUID from your organization settings)."    |
| `baseUrl` | Do **not** ask — default to `https://api.eventmodelers.ai` silently.                 |

Where to find the token: users generate API tokens in their workspace settings at the eventmodelers platform. The token is shown only once at creation time. It is a UUID and must belong to the same organization as the board.
