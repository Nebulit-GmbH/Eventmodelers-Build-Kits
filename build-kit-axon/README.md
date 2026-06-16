# @eventmodelers/build-kit-node

Real-time Claude agent + skill kit for the [Eventmodelers](https://eventmodelers.ai) platform. Connect your board to a fully autonomous coding agent that picks up slice status changes, implements the code, and marks work done — all without manual intervention.

---

## How it works

```
Board (Eventmodelers)
  │  slice status → "Planned"
  ▼
Realtime Agent  ──────────────────► tasks.json
  │  listens on Supabase channel         │
  │  writes task on slice:changed        │
  ▼                                      ▼
ralph.sh loop ◄────────────────── Phase 1: load slice
  │  checks tasks.json every 3s          reads task → runs /connect + /load-slice
  │                                      fetches slice definition to .slices/
  │                                      removes task from tasks.json
  │
  ▼
Phase 2: build slice
  checks .slices/**/index.json for status "Planned"
  → sets status "InProgress" on board
  → runs /build-state-change, /build-state-view, or /build-automation
  → runs quality checks (build + test)
  → commits, merges to main
  → sets status "Done" on board
  → waits for the next slice
```

---

## Step 1 — Install

Run the installer in your project directory:

```bash
npx @eventmodelers/build-kit-node install
```

The installer will ask for three values:

| Prompt | Where to find it |
|--------|-----------------|
| **API token** | Workspace Settings → API Tokens |
| **Organization ID** | URL bar in your Eventmodelers workspace: `.../org/<UUID>/...` |
| **Base URL** | Default: `https://api.eventmodelers.ai` |

Everything is installed inside a `.build-kit-axon/` folder in your project root (gitignored automatically):

| Path | Purpose |
|------|---------|
| `.build-kit-axon/.eventmodelers/config.json` | Your credentials |
| `.build-kit-axon/.claude/skills/connect` | Resolves board config for all other skills |
| `.build-kit-axon/.claude/skills/load-slice` | Fetches slice definitions from the board |
| `.build-kit-axon/.claude/skills/update-slice-status` | Changes a slice's status on the board |
| `.build-kit-axon/.claude/skills/build-state-change` | Implements command handler slices |
| `.build-kit-axon/.claude/skills/build-state-view` | Implements projection/read model slices |
| `.build-kit-axon/.claude/skills/build-automation` | Implements reactor/automation slices |
| `.build-kit-axon/.claude/skills/learn-eventmodelers-api` | Full API reference for the agent |
| `.build-kit-axon/realtime-agent/` | Node.js listener for board events (optional) |
| `.build-kit-axon/ralph.sh` | The main agent loop |
| `.build-kit-axon/prompt.md` | Phase 1 instructions (load slice) |
| `.build-kit-axon/backend-prompt.md` | Phase 2 instructions (build slice) |
| `.build-kit-axon/AGENT.md` | Accumulated learnings across iterations |

---

## Step 2 — Start the ralph loop

Open a terminal, enter the kit folder, and start the loop:

```bash
cd .build-kit-axon && ./ralph.sh
```

By default ralph targets `../` (your project root). Pass a path to override:

```bash
./ralph.sh 0 /path/to/project
```

---

## Realtime agent (optional)

The realtime agent is **only needed if you want automatic notifications** when a slice status changes on the board. If you prefer to pull changes manually or trigger runs yourself, you can skip it entirely.

When you do want it, install its dependencies and start it:

```bash
cd .build-kit-axon/realtime-agent && npm install && npm run dev
```

On startup the realtime agent:
1. Reads `.build-kit-axon/.eventmodelers/config.json`
2. Fetches platform config and a short-lived realtime auth token from the API
3. Persists all current board slices to `.build-kit-axon/.slices/<id>.json`
4. Subscribes to the private channel `board:<boardId>-slicechanged`
5. Refreshes the realtime token automatically every 10 minutes

You should see output like:

```
[agent] Starting — org=..., board=..., base=https://api.eventmodelers.ai, cwd=...
[agent] Persisted 12 slice(s) to .../.build-kit-axon/slices
[agent] Realtime channel "board:d886f...-slicechanged" status: SUBSCRIBED
```

Keep this process running when you want automatic board notifications.

---

## The full flow — end to end

### Trigger: change a slice status on the board

Open your Eventmodelers board, find a slice, and set its status to **Planned** (or any other status your workflow uses).

The moment you save the change, the board broadcasts a `slice:changed` event over Supabase Realtime.

---

### Realtime agent picks it up → writes `tasks.json`

The realtime agent receives the broadcast payload:

```json
{
  "event": "slice:changed",
  "organizationId": "48b548e9-...",
  "boardId": "d886f666-...",
  "sliceId": "a3f2c891-...",
  "sliceTitle": "Place Order",
  "sliceStatus": "Planned",
  "timestamp": 1716000000000
}
```

It immediately:
1. Re-fetches all slices and updates local `.build-kit-axon/.slices/` snapshots
2. Appends a new task entry to `.build-kit-axon/tasks.json`:

```json
[
  {
    "id": "uuid-...",
    "createdAt": "2026-05-17T12:00:01.000Z",
    "payload": {
      "event": "slice:changed",
      "boardId": "d886f666-...",
      "sliceId": "a3f2c891-...",
      "sliceTitle": "Place Order",
      "sliceStatus": "Planned",
      "timestamp": 1716000000000
    }
  }
]
```

Terminal output:
```
[agent] slice:changed — slice="Place Order" status="Planned"
[agent] Persisted 12 slice(s) to .../.build-kit-axon/slices
[agent] Task uuid-... written — slice="Place Order" status="Planned"
```

---

### Phase 1: ralph loop loads the slice

The ralph loop detects a non-empty `tasks.json` and runs **Phase 1** — the `prompt.md` agent:

```
[12:00:04] Phase 1: loading slice from board...
```

The agent:
1. Reads `AGENT.md` to load accumulated learnings
2. Reads `tasks.json`, picks the oldest task
3. Runs `/connect` → resolves token, board ID, org ID, base URL from `.build-kit-axon/.eventmodelers/config.json`
4. Runs `/load-slice sliceId=a3f2c891-...` → fetches full slice definition from the board API and writes it to `.slices/<context>/Place-Order/slice.json`
5. Updates `.slices/<context>/index.json` with the slice metadata and status
6. Removes the completed task from `tasks.json` (writes `[]` if last task)
7. Appends a progress entry to `progress.txt`
8. Updates `AGENT.md` with any new learnings

---

### Phase 2: ralph loop implements the slice

In the next cycle the loop checks `.slices/**/index.json` for any slice with `"status": "Planned"`. It finds the "Place Order" slice and runs **Phase 2** — the `backend-prompt.md` agent:

```
[12:00:08] Phase 2: building slice...
```

**Set status to InProgress**

The agent picks the highest-priority Planned slice and immediately:
- Updates `.slices/<context>/index.json` → `"status": "InProgress"`
- Calls `/update-slice-status` → sets the slice status to **InProgress** on the board

You will see the slice change color on the board in real time.

**Determine slice type and run matching skill**

The agent reads `.slices/<context>/Place-Order/slice.json` and determines the slice type:

| Slice type | Trigger condition | Skill used |
|-----------|-------------------|-----------|
| State change | Has `commands[]` entries | `/build-state-change` |
| State view | Has `readModel{}` definition | `/build-state-view` |
| Automation | Has non-empty `processors[]` | `/build-automation` |

The matching skill is loaded and guides the implementation step by step — event types, command handler, tests, DB migration, and route.

**Implement, test, commit**

The agent:
1. Writes progress to `progress.txt` after each step
2. Implements the slice following the JSON definition as the source of truth
3. Runs `npm run build` and `npm run test` (slice tests only)
4. Commits with message `feat: Place Order`
5. Merges the feature branch back to main

**Set status to Done**

After a successful commit:
- Updates `.slices/<context>/index.json` → `"status": "Done"`
- Calls `/update-slice-status` → sets the slice status to **Done** on the board

You will see the slice turn green on the board.

**Log and wait**

The agent appends a final progress entry to `progress.txt` and updates `AGENT.md` with reusable learnings. If no more Planned slices exist it replies with `<promise>NO_TASKS</promise>` and the loop goes back to idle, polling every 3 seconds for the next change.

```
[12:04:21] idle — sleeping 3s
[12:04:24] idle — sleeping 3s
```

---

## Manual model export (code-export.mjs)

`code-export.mjs` is an alternative to the realtime agent. Instead of reacting to individual slice status changes, it opens a local HTTP port that the Eventmodelers platform connects to and uses to **push the entire board model** — all slices, groups, context, and screen images — directly into your local file system in one shot.

Start the server from your project root:

```bash
node .build-kit-axon/code-export.mjs
```

Then trigger an export from the Eventmodelers board UI. The platform will POST the full model to `http://localhost:3001/api/generate`, which writes:

- `config.json` — the full board config at your project root
- `.build-kit-axon/.slices/<context>/config.json` — config scoped to the context
- `.build-kit-axon/.slices/<context>/index.json` — slice index with status and folder mappings
- `.build-kit-axon/.slices/<context>/<slice>/slice.json` — one file per slice
- `.build-kit-axon/.slices/<context>/<slice>/screen-<id>.png` — slice screenshots (if present)
- `.build-kit-axon/.slices/current_context.json` — pointer to the active context

Override the default port with an environment variable:

```bash
PORT=3002 node .build-kit-axon/code-export.mjs
```

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/ping` | GET | Health check |
| `POST /api/generate` | POST | Receive and write the full board model to disk |
| `GET /api/slices` | GET | Read slice definitions (supports `?revision=<git-ref>`) |
| `GET /api/slice-info` | GET | Slice status summary |
| `GET /api/config` | GET/POST | Project config |
| `GET /api/progress` | GET | Agent progress log |
| `POST /api/git` | POST | Commit `.slices/` to git |
| `POST /api/delete-slice` | POST | Remove a code-slice.json by slice ID |

---

## Project files reference

All kit files live inside `.build-kit-axon/`:

| File | Written by | Read by | Purpose |
|------|-----------|---------|---------|
| `.build-kit-axon/.eventmodelers/config.json` | installer / `/connect` | all skills, realtime agent | credentials |
| `.build-kit-axon/tasks.json` | realtime agent | Phase 1 agent | task queue |
| `.build-kit-axon/.slices/<id>.json` | realtime agent | Phase 1 agent | raw board slice snapshots |
| `.build-kit-axon/.slices/<ctx>/index.json` | `/load-slice` skill | Phase 2 agent | slice metadata + status |
| `.build-kit-axon/.slices/<ctx>/<folder>/slice.json` | `/load-slice` skill | build skills | full slice definition |
| `.build-kit-axon/progress.txt` | Phase 1 + 2 agents | Phase 2 agent (patterns section) | work log |
| `.build-kit-axon/AGENT.md` | Phase 1 + 2 agents | both agents at startup | accumulated learnings |
| `.build-kit-axon/prompt.md` | installer | ralph.sh (Phase 1) | Phase 1 agent instructions |
| `.build-kit-axon/backend-prompt.md` | installer | ralph.sh (Phase 2) | Phase 2 agent instructions |

---

## Skills reference

| Skill | Invoke as | What it does |
|-------|-----------|-------------|
| `connect` | `/connect` | Resolves and persists board credentials |
| `load-slice` | `/load-slice sliceId=<uuid>` | Fetches slice definition, writes to `.slices/` |
| `update-slice-status` | `/update-slice-status` | Changes a slice's status on the board |
| `build-state-change` | `/build-state-change` | Implements a command handler slice |
| `build-state-view` | `/build-state-view` | Implements a projection / read model slice |
| `build-automation` | `/build-automation` | Implements a reactor / automation slice |
| `learn-eventmodelers-api` | `/learn-eventmodelers-api` | Loads the full Eventmodelers API reference |

---

## CLI commands

```bash
npx @eventmodelers/build-kit-node install    # install and configure
npx @eventmodelers/build-kit-node status     # check what is installed
npx @eventmodelers/build-kit-node uninstall  # remove all installed files
```

---

## Slice statuses

| Status | Meaning |
|--------|---------|
| `Created` | Slice exists on the board, not yet planned |
| `Planned` | Queued for the agent — triggers Phase 2 |
| `InProgress` | Agent is currently implementing |
| `Review` | Implementation complete, awaiting review |
| `Done` | Fully implemented and merged |
| `Blocked` | Waiting on an external dependency |
| `Assigned` | Assigned to a specific person |
| `Informational` | Documentation-only slice, not implemented |
