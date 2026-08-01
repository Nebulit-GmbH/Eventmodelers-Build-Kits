# .agent-modeling-kit

Config directory for modeling-only projects — skills + agent loop, no backend scaffold.

## Running the agent

There's exactly one runtime mode for a modeling-kit install: a single warm Claude
process, kept alive across turns, that a prompt is written straight into as soon as
it's fetched off the board's queue. There is no cold-spawn loop and no `tasks.json`
file — that's what build-kit stacks (`node`, `supabase`, `axon`, `cratis-csharp`) use
instead, for their independent, self-contained slice-implementation tasks.

The loop itself lives in `@eventmodelers/cli`, not in this directory — start it from
the project root:

```bash
npx @eventmodelers/cli run --modeling
```

This requires a `boardId` in your config — a modeling agent always runs for exactly
one board:

```bash
npx @eventmodelers/cli connect board=<uuid>
```

## Files

| File | Purpose |
|------|---------|
| `lib/config.js` | Config-file-walk logic (`.eventmodelers/config.json` resolution) shared with the CLI's `run --modeling` runtime |

## Config

Credentials are stored in `.agent-modeling-kit/.eventmodelers/config.json` (written by `eventmodelers init-modeling`):

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "baseUrl": "https://api.eventmodelers.ai"
}
```

Claude skills live in `.claude/skills/` and are available inside any Claude Code session started from the project root.
