# Plan — `build-kit-cratis-csharp`

A real-time Claude/Ollama agent + skill kit that takes [Eventmodelers](https://eventmodelers.ai)
board slices and implements them as **Cratis** vertical slices in a .NET / C# project — the same
"ralph loop" automation the existing `build-kit-axon`, `build-kit-node`, and `build-kit-supabase`
kits provide, but targeting the Cratis stack ([cratis.io](https://www.cratis.io)).

This document is the implementation plan.

> **Status: implemented.** The kit is built — installer (`src/cli.js`), loop machinery
> (`templates/build-kit/`), the three Cratis build skills + `_shared/cratis-conventions.md`, the four
> platform skills, and the vendored Cratis Arc + Chronicle starter (`templates/root/`, from the
> canonical `dotnet new cratis` template) with a `CLAUDE.md`. Cratis conventions are **distilled** into
> the skills (decision #1 below), so the kit is self-contained. The decisions below record what was
> chosen; the sections after are the original design rationale.
>
> Resolved decisions: (1) **distill** Cratis conventions into the skills' `_shared/` doc — done.
> (2) Starter = **vendor** the canonical `dotnet new cratis` template (not hand-rolled). (3)
> **Full-stack per slice** — the backend prompt drives Backend → build → Specs → Frontend. (5)
> Translation is folded into `build-automation`.

---

## 1. Background — how the existing kits work

All three existing kits share one shape (verified against `build-kit-axon`, `build-kit-node`,
`build-kit-supabase`). A new Cratis kit must mirror it so it behaves identically from the
platform/installer/loop perspective and only differs where the *target framework* differs.

### 1.1 Package shape

```
build-kit-cratis-csharp/
├── package.json              ← npm package "@eventmodelers/build-kit-cratis-csharp"
├── README.md                 ← user-facing install + flow docs
├── src/cli.js                ← installer (commander: install / status / uninstall)
└── templates/                ← everything copied into the user's project
    ├── root/                 ← spread into the project ROOT (the starter app)
    ├── build-kit/            ← spread into  .build-kit-cratis-csharp/  (the loop machinery)
    └── .claude/skills/       ← spread into  .build-kit-cratis-csharp/.claude/skills/
```

### 1.2 Installer (`src/cli.js`) — copy almost verbatim

`build-kit-axon/src/cli.js` is framework-agnostic and can be reused with only string changes:

- Target folder name: `.build-kit-axon` → `.build-kit-cratis-csharp`.
- `templates/root/*` → project root; `templates/build-kit/*` → `.build-kit-cratis-csharp/`;
  rest → kit dir.
- Prompts for credentials (org ID, board ID, token), writes
  `.build-kit-cratis-csharp/.eventmodelers/config.json`.
- Adds the kit folder to root `.gitignore`.
- Writes `.claude/settings.json` with the Eventmodelers MCP server
  (`{baseUrl}/mcp`, default `https://api.eventmodelers.ai`).
- `npm install` inside the kit dir (the loop's realtime agent is Node, even though the *target*
  project is C#).
- `status` / `uninstall` commands unchanged except for the folder name.

**Decision:** fork `build-kit-axon/src/cli.js`, rename the constant, update the "Next steps"
banner. No structural changes.

### 1.3 The ralph loop machinery (`templates/build-kit/`) — mostly framework-agnostic

These come straight from the axon/node kits and are driven by `prompt.md` / `backend-prompt.md`,
which are the only files that mention framework-specific build/test commands:

| File | Reuse | Change needed |
|---|---|---|
| `ralph.sh`, `ralph.js`, `ralph-claude.js`, `ralph-ollama.js` | as-is | folder name only |
| `realtime-agent.js` | as-is | none (board listener, framework-neutral) |
| `code-export.mjs` | as-is | none (writes `.slices/` model to disk) |
| `lib/agent.sh`, `lib/ollama-agent.js` | as-is | none |
| `lib/prompt.md` (Phase 1: load slice) | as-is | none — pure platform/slice loading |
| `lib/backend-prompt.md` (Phase 2: build slice) | **rewrite** | dotnet commands + Cratis slice-type routing |
| `lib/AGENT.md` | seed fresh | start with Cratis learnings |
| `package.json` | as-is | name/desc only |

### 1.4 Skills (`templates/.claude/skills/`)

Two groups:

**Platform skills — copy verbatim** (identical across all kits, no framework knowledge):
- `connect/` — resolves board credentials from `.eventmodelers/config.json`.
- `load-slice/` — fetches slice definitions from the board API → `.slices/`.
- `update-slice-status/` — sets a slice's status on the board.
- `learn-eventmodelers-api/` — full Eventmodelers API reference.

**Build skills — author new for Cratis** (this is the real work, see §3):
- `build-state-change/` — write slice → Cratis `[Command]` + `[EventType]`.
- `build-state-view/` — read slice → Cratis `[ReadModel]` + projection + query.
- `build-automation/` — automation slice → Cratis `IReactor` + `ICommandPipeline`.
- (optional) `build-translation/` or fold translation into `build-automation` as axon does.

### 1.5 Slice-type routing (unchanged contract)

`backend-prompt.md` reads `slice.json` and routes by type — this contract is identical to axon and
maps cleanly onto the four Cratis slice types documented in the Cratis AI config:

| slice.json signal | Cratis slice type | Build skill |
|---|---|---|
| has `commands[]` | **State Change** | `build-state-change` |
| has `readModel{}` | **State View** | `build-state-view` |
| non-empty `processors[]` | **Automation** | `build-automation` |
| `sliceType === "TRANSLATION"` | **Translation** | reactor → command (in `build-automation`) |

---

## 2. The Cratis target — what the build skills must produce

Distilled from the shared Cratis AI config at `/Volumes/Code/Cratis/AI` (`.ai/rules/`,
`.ai/skills/`). The kit must be **self-contained**: it installs into arbitrary user projects, not
Cratis repos, so the essential conventions below must be embedded into the build skills'
`references/`, distilled from that config rather than symlinked to it.

### 2.1 Stack

- .NET / C# 13, ASP.NET Core. **Cratis Arc** for CQRS, **Cratis Chronicle** for event sourcing,
  **MongoDB** for read models.
- React + TypeScript (Vite), PrimeReact — generated from C# via **proxy generation** (`dotnet build`).
- Specs: xUnit + **Cratis.Specifications** + NSubstitute, in `for_*/when_*/and_*` BDD layout.

### 2.2 Non-negotiable Cratis conventions (vs. the Axon idioms the kit replaces)

| Concern | Axon kit produces | Cratis kit must produce |
|---|---|---|
| Slice layout | many files per slice, package-per-artifact | **ONE `.cs` file** per slice with ALL artifacts |
| Command | `record` + separate `@Component` handler | `[Command]` record with **`Handle()` on the record** — no handler class |
| Event | `@Event(namespace,name,version)` record | `[EventType]` record — **no arguments**, type name is the id; past tense; never nullable |
| Read model | `@QueryHandler` projection class | `[ReadModel]` record, **static** query methods, model-bound `[FromEvent<T>]`/`[Key]`, AutoMap on |
| Automation | `@EventHandler` → `CommandGateway` | `IReactor` (dispatch by first param event type) → `ICommandPipeline`; idempotent |
| IDs | `String` tag fields | `ConceptAs<T>` strongly-typed concepts (one file per shared concept) |
| Namespace | `de.eventmodelers.slices.<ctx>...` | `<Root>.<Feature>.<Slice>` — **drop the `.Features.` segment** |
| Build / test | `./mvnw compile` / `./mvnw test` | `dotnet build` (also generates TS proxies) / `dotnet test` |
| Sequencing | n/a | **Backend → `dotnet build` → Frontend** (proxies don't exist until backend compiles) |
| Copyright | none | MIT copyright header on every file |
| Spelling | n/a | American English everywhere |

### 2.3 Folder convention the skills must follow

```
Features/<Feature>/
├── <Feature>.tsx               ← composition page
├── <Concept>.cs                ← shared concepts (ConceptAs<T>)
└── <Slice>/
    ├── <Slice>.cs              ← ALL backend artifacts in ONE file
    ├── <Component>.tsx         ← React component(s)
    └── when_<behavior>/        ← integration specs
        └── and_<scenario>.cs
```

---

## 3. The build skills — design

Each build skill mirrors the structure of the axon `build-state-change/SKILL.md` (Discover
conventions → Understand input → Implement → Tests → Final verification against `slice.json`) but
emits Cratis code. Each gets a `references/` folder with full code patterns + a
`feature-flag-patterns.md` analog if Cratis uses one.

### 3.1 `build-state-change` (write slice)

Produces, in a single `Features/<Feature>/<Slice>/<Slice>.cs`:
1. Any new `ConceptAs<T>` ID types (or reference the `add-concept` pattern).
2. `[EventType]` records — no args, past tense, non-nullable, one purpose each.
3. `[Command]` record with `Handle()` directly on it; return single event / `(event,result)` /
   `Result<TSuccess,TError>` / `void`; event source from `[Key]` / `EventSourceId`-convertible /
   `ICanProvideEventSourceId`.
4. Validators / constraints; business rules via **DCB** = read-model parameter injected into
   `Handle()`.
5. Specs under `when_<behavior>/and_<scenario>.cs` covering happy path, each validation failure,
   each DCB business-rule violation, each constraint — one spec each.
6. Run `dotnet build` then `dotnet test`.

### 3.2 `build-state-view` (read slice)

Produces `[ReadModel]` record + model-bound projection (`[FromEvent<T>]`, `[Key]`, AutoMap on,
`.From<EventType>()`), **static** query methods on the record, reactive `ISubject<T>` queries for
real-time. Projections join **events, never read models**. Then `dotnet build` to emit the query
proxy, then the React list/detail component using the generated proxy + PrimeReact + `useWithPaging`.

### 3.3 `build-automation` (automation / translation slice)

Produces an `IReactor` (method dispatch by first-parameter event type), side effects only, writes
new events by executing a command via `ICommandPipeline` (never `IEventLog` directly), designed for
idempotency. Translation slices = a reactor that triggers commands in its own slice.

### 3.4 Optional frontend pass

The axon kit is backend-only per iteration; Cratis slices are full-stack. Decision point (§6): either
keep Phase 2 backend-only and add a `ui-prompt.md` follow-up (as axon hints at), or extend
`backend-prompt.md` to run the full **Backend → build → Frontend → composition** workflow per slice.
Recommended: **full-stack per slice**, because Cratis's value is end-to-end type safety and the
proxy-generation sequencing makes a split awkward.

---

## 4. The starter project (`templates/root/`)

The axon/node kits ship a runnable starter app so the agent has somewhere to write slices. The
Cratis kit needs a minimal **Cratis Arc + Chronicle ASP.NET Core** starter:

- `.csproj` / solution referencing Cratis Arc + Chronicle + MongoDB packages, `global.json`
  pinning the SDK, treat-warnings-as-errors.
- `Program.cs` wiring Cratis (Chronicle event store, MongoDB read-model store, proxy generation).
- `docker-compose.yml` for MongoDB (+ Chronicle if needed) — analogous to the axon compose file.
- A Vite + React + PrimeReact frontend skeleton wired to consume generated proxies.
- `Features/` root folder (empty, ready for slices).
- `CLAUDE.md` at root distilling the §2 conventions so any agent opening the project gets them.
- MIT `LICENSE` + copyright header convention.

**Open question for the team:** is there an existing Cratis "starter" / template repo we should
vendor here instead of hand-rolling one? (See §6.)

---

## 5. Build order / milestones

1. **Scaffold the package** — `package.json`, fork `src/cli.js` (rename to
   `.build-kit-cratis-csharp`), copy `templates/build-kit/*` and the four platform skills verbatim.
   *Outcome:* installer runs, loop boots, connects to a board, loads slices. No Cratis codegen yet.
2. **Starter project** (`templates/root/`) — minimal Cratis Arc + Chronicle app that builds and runs;
   `CLAUDE.md` with conventions.
3. **`build-state-change`** skill + `references/PATTERNS.md` (port the Cratis `new-vertical-slice` /
   `cratis-command` patterns). Rewrite `lib/backend-prompt.md` with dotnet build/test + routing.
4. **`build-state-view`** skill — projection/query + frontend proxy consumption.
5. **`build-automation`** skill — reactor + `ICommandPipeline`; handle translation.
6. **Frontend pass** — decide split vs full-stack (§3.4); add `ui-prompt.md` if split.
7. **README.md** — fork the axon README, swap folder name, dotnet commands, slice-type table.
8. **End-to-end test** — point at a real board, run the loop, confirm a slice goes
   Planned → InProgress → Done with compiling Cratis code + passing specs.

Milestone 1 is independently shippable (loop works, codegen is the only missing piece). 3–5 are the
core value and can land incrementally — one slice type at a time.

---

## 6. Open decisions (need input before/while building)

1. **Reuse vs. embed Cratis conventions.** The shared config at `/Volumes/Code/Cratis/AI` is the
   source of truth, but the kit installs into non-Cratis user repos. Plan assumes we **distill** the
   essential rules into the build skills' `references/`. Alternative: have the kit optionally drop in
   the full `.ai/` + `.claude/` config. *Recommend: distill (self-contained); link back to the AI
   repo in README.*
2. **Starter project source.** Hand-roll a minimal starter, or vendor an existing Cratis template/
   sample repo? Affects §4 scope significantly.
3. **Full-stack vs. backend-only per iteration** (§3.4). *Recommend: full-stack per slice.*
4. **Package name** — `@eventmodelers/build-kit-cratis-csharp` (assumed) and whether the CLI keeps
   the `ralph-li` internal name or gets a Cratis-specific one.
5. **Translation slice** — its own skill or folded into `build-automation` (as axon does)?
6. **MongoDB/Chronicle runtime** — does the loop's quality gate need `docker-compose up` running for
   specs, or are Cratis specs in-memory? Drives the Phase 2 test step.

---

## 7. What is reusable verbatim vs. new (summary)

| Component | Verbatim from axon/node | New for Cratis |
|---|---|---|
| `src/cli.js` | ✅ (rename only) | |
| `realtime-agent.js`, `code-export.mjs`, `ralph*.js`, `ralph.sh`, `lib/agent.sh` | ✅ | |
| `lib/prompt.md` (Phase 1) | ✅ | |
| Platform skills (`connect`, `load-slice`, `update-slice-status`, `learn-eventmodelers-api`) | ✅ | |
| `lib/backend-prompt.md` (Phase 2) | | 🔨 dotnet + Cratis routing |
| `build-state-change`, `build-state-view`, `build-automation` skills | | 🔨 full rewrite |
| `templates/root/` starter app + `CLAUDE.md` | | 🔨 Cratis Arc + Chronicle |
| `README.md` | structure ✅ | content for dotnet/Cratis |

The kit is ~70% reuse (loop + platform plumbing) and ~30% new (the Cratis build skills + starter) —
the new 30% is where all the framework knowledge from `/Volumes/Code/Cratis/AI` gets encoded.
