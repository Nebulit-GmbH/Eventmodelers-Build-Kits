# @eventmodelers/build-kit-cratis-csharp

Real-time Claude agent + skill kit that turns [Eventmodelers](https://eventmodelers.ai) board slices
into **Cratis** vertical slices in a .NET / C# project. Connect your board to an autonomous coding agent
that picks up slice status changes, implements the slice the Cratis way (Cratis Arc + Chronicle), runs
`dotnet build` / `dotnet test`, and marks the work done — all without manual intervention.

Built on [cratis.io](https://www.cratis.io). The Cratis conventions are distilled into the kit's skills
so the agent stays self-contained — it does not need the Cratis repos to know how to build a slice.

---

## What you get

- A ready-to-run **Cratis starter app** (Cratis Arc + Chronicle + MongoDB + React/PrimeReact) dropped
  into your project root, including an example vertical slice to learn from and a `CLAUDE.md` of
  conventions.
- The **ralph loop** — an autonomous agent that reacts to `slice:changed` events and implements slices.
- **Build skills** that encode the Cratis way:
  - `/build-state-change` — write slices → `[Command]` + `Handle()` + `[EventType]`
  - `/build-state-view` — read slices → `[ReadModel]` + projection/reducer + queries
  - `/build-automation` — automation / translation → `IReactor` + `ICommandPipeline`
- **Platform skills** (`/connect`, `/load-slice`, `/update-slice-status`, `/learn-eventmodelers-api`).

---

## How it works

```
Board (Eventmodelers)
  │  slice status → "Planned"
  ▼
Realtime Agent  ──────────────────► tasks.json
  │  listens on a board channel          │
  ▼                                      ▼
ralph loop ◄────────────────────── Phase 1: load slice  (/connect + /load-slice → .slices/)
  │
  ▼
Phase 2: build slice
  → set status "InProgress" on the board
  → route by slice type to /build-state-change | /build-state-view | /build-automation
  → implement ONE .cs slice file the Cratis way
  → dotnet build (also regenerates TypeScript proxies)  +  dotnet test  (slice only)
  → implement the React component(s) if UI-triggered, register in the composition page
  → commit, merge to main
  → set status "Done" on the board
```

---

## Prerequisites

- .NET SDK 9.0+ and Docker (for Chronicle + MongoDB via `docker-compose`).
- Node.js 18+ (the realtime agent and the starter frontend are Node/Vite).
- An Eventmodelers board (org ID, board ID, API token) — optional; the kit also works locally without a
  board (it just skips board sync).

---

## Step 1 — Install

Run the installer in your project directory:

```bash
npx @eventmodelers/build-kit-cratis-csharp install
```

It will:

- Copy the **Cratis starter app** into your project root (`CratisApp.csproj`, `Program.cs`,
  `docker-compose.yml`, the `.frontend/` shell, an example `SomeModule/SomeFeature/` slice, `CLAUDE.md`).
- Install the loop machinery and skills into `.build-kit-cratis-csharp/` (gitignored automatically).
- Prompt for board credentials (org ID, board ID, token) → `.build-kit-cratis-csharp/.eventmodelers/config.json`.
- Configure the Eventmodelers MCP server in `.build-kit-cratis-csharp/.claude/settings.json`.

| Path | Purpose |
|------|---------|
| `.build-kit-cratis-csharp/.claude/skills/build-state-change` | Write-slice skill (Cratis commands/events) |
| `.build-kit-cratis-csharp/.claude/skills/build-state-view` | Read-slice skill (read models/projections) |
| `.build-kit-cratis-csharp/.claude/skills/build-automation` | Automation/translation skill (reactors) |
| `.build-kit-cratis-csharp/.claude/skills/_shared/cratis-conventions.md` | The distilled Cratis conventions |
| `.build-kit-cratis-csharp/.claude/skills/{connect,load-slice,update-slice-status,learn-eventmodelers-api}` | Platform skills |
| `.build-kit-cratis-csharp/ralph-claude.js` / `ralph.sh` | The agent loop |
| `.build-kit-cratis-csharp/lib/prompt.md` / `backend-prompt.md` | Agent instructions |
| `.build-kit-cratis-csharp/lib/AGENT.md` | Accumulated learnings across iterations |

---

## Step 2 — Bring up the app

```bash
docker-compose up -d        # Chronicle + MongoDB + Aspire dashboard
dotnet build                # backend + TypeScript proxy generation
npm install                 # frontend deps
```

---

## Step 3 — Start the loop

```bash
# Claude (default)
node .build-kit-cratis-csharp/ralph-claude.js

# Local Ollama model (run `ollama serve` first)
OLLAMA_MODEL=qwen3:8b node .build-kit-cratis-csharp/ralph-ollama.js

# Target a custom project directory
node .build-kit-cratis-csharp/ralph-claude.js /path/to/project
```

Optionally start the realtime agent for automatic board notifications:

```bash
cd .build-kit-cratis-csharp && npm install && node realtime-agent.js
```

---

## Slice-type routing

The loop reads `slice.json` and routes by type:

| slice.json signal | Cratis slice type | Skill | Produces |
|---|---|---|---|
| has `commands[]` / `events[]` | State Change | `/build-state-change` | `[Command]` + `Handle()` + `[EventType]` |
| has `readModel` / `projections` / `queries` | State View | `/build-state-view` | `[ReadModel]` + projection/reducer + static queries |
| non-empty `processors[]` | Automation | `/build-automation` | `IReactor` |
| `sliceType === "TRANSLATION"` | Translation | `/build-automation` | `IReactor` → `ICommandPipeline.Execute(command)` |

---

## The Cratis way (what the skills enforce)

- ALL backend artifacts for a slice in ONE `.cs` file under `<Module>/<Feature>/<Slice>/`.
- `[Command]` records with `Handle()` on the record — never separate handler classes.
- `[EventType]` with NO arguments; past-tense, never-nullable events.
- `ConceptAs<T>` for every identity/value — no raw `Guid` / `string` in the domain.
- `[ReadModel]` records with `public static` query methods; observable queries return `ISubject<T>`.
- Reactors implement `IReactor`; new writes go through `ICommandPipeline`, never `IEventLog`.
- `dotnet build` generates the TypeScript proxies — Backend → build → Specs → Frontend → Composition.

Full detail: `.build-kit-cratis-csharp/.claude/skills/_shared/cratis-conventions.md`.

---

## CLI commands

```bash
npx @eventmodelers/build-kit-cratis-csharp install    # install and configure
npx @eventmodelers/build-kit-cratis-csharp status     # check what is installed
npx @eventmodelers/build-kit-cratis-csharp uninstall  # remove installed files
```

---

## Slice statuses

| Status | Meaning |
|--------|---------|
| `Created` | Slice exists on the board, not yet planned |
| `Planned` | Queued for the agent — triggers a build |
| `InProgress` | Agent is currently implementing |
| `Review` | Implementation complete, awaiting review |
| `Done` | Fully implemented and merged |
| `Blocked` | Waiting on an external dependency |

---

## License

MIT
