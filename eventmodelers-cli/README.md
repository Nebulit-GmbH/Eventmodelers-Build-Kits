# @eventmodelers/cli

One CLI, real-time Claude agent, and skill kit for the [Eventmodelers](https://eventmodelers.ai) platform — pick a stack, scaffold it, connect it to a board.

This CLI covers two audiences. If you just want a project connected to a board and an agent working slices, **Getting started** below is all you need — `init`, `run`, `fetch`, and a couple of read-only helpers. Everything under **Power users** is for customizing the install itself (bridging to another spec framework, CI-driven installs, multi-project config, hooks, adding a new stack) — skip it until you actually need it.

## Getting started

### Quick start

```bash
npx @eventmodelers/cli init
```

Running without `--stack` shows an arrow-key picker. Or go straight to a stack:

```bash
npx @eventmodelers/cli init --stack node            # Node.js / TypeScript
npx @eventmodelers/cli init --stack supabase         # Supabase
npx @eventmodelers/cli init --stack axon             # Axon Framework (Java/Kotlin)
npx @eventmodelers/cli init --stack opencqrs         # OpenCQRS (Java, EventSourcingDB)
npx @eventmodelers/cli init --stack umadb            # UmaDB (Java)
npx @eventmodelers/cli init --stack kurrent          # Kurrent (Java, KurrentDB)
npx @eventmodelers/cli init --stack react            # React (frontend, board-polling sync) — TODO-marked, not yet filled in
npx @eventmodelers/cli init --stack supabase-react   # React + Supabase (frontend, UI-only, realtime sync)
```

The installer prompts for your API token, Organization ID, and Board ID from [app.eventmodelers.ai/account](https://app.eventmodelers.ai/account), scaffolds the stack into your project, and writes `.eventmodelers/config.json` with your credentials.

### Common scenarios

**Starting from scratch on a new project:**

```bash
npx @eventmodelers/cli init --stack node
```

Answer the credential prompts once — the stack's scaffold, skills, and agent loop are all installed in this one step.

**Trying it out before you have a board of your own:**

```bash
npx @eventmodelers/cli init --stack node --demo
```

`--demo` additionally writes a ready-made model into the kit's `.slices/` — the **Understanding Eventsourcing** context, a 16-slice shopping cart covering every slice type (state change, state view, automation, translation). It's ordinary fetched slice data in exactly the shape `fetch` writes, so the build skills, `activate-context`, `set-slice-status`, and the agent loop all work against it immediately, with no board connected. Build one with `/build-state-change` in Claude Code, or start `run` and let the agent work the queue.

Nothing downstream treats it specially: `fetch --context <name>` replaces it with your own board whenever you're ready. `--demo` is skipped (with a message) if `.slices/` already holds slices, so it can never overwrite fetched work.

**Already initialized — you just want the agent to start working the board:**

```bash
npx @eventmodelers/cli run
```

`run` doesn't re-configure anything. It finds whatever kit dir `init` already created in this project and starts its agent loop (`ralph-claude.js`) against your existing `.eventmodelers/config.json`.

Each agent turn is capped at 60 minutes by default so a hung agent can't stall the loop: it gets SIGTERM, then SIGKILL 10s later, and a slice that keeps timing out is Blocked by the stuck-slice guard. Change the cap with `"turnTimeoutMinutes"` in `.eventmodelers/config.json` or `RALPH_TURN_TIMEOUT_MIN` for one run; `0` turns it off.

**Pulling the latest board state without starting an agent** — e.g. to inspect a context's slices, or in a script:

```bash
npx @eventmodelers/cli fetch --context <name>
```

This writes the current slice/event/command detail for that context to disk and prints a summary — no agent loop, no listener, just a one-shot pull.

**Checking what's installed or which credentials are active:**

```bash
npx @eventmodelers/cli status   # what's installed in this project
npx @eventmodelers/cli config   # the fully resolved config (file + env), token masked
```

### What gets installed

```
your-project/
├── .eventmodelers/
│   └── config.json                ← your token + org/board (gitignored) — shared by every kit in this project
├── .build-kit/                    ← agent runner (name is .agent-modeling-kit/ for the modeling-kit stack)
│   ├── ralph-claude.js            ← realtime agent + task loop
│   ├── ralph-local-ai.js          ← same, via a local/self-hosted model
│   ├── ralph-exec.js              ← same, via an external agent command (Codex CLI, OpenCode, …)
│   ├── ralph.sh                   ← bash-only loop (no realtime)
│   ├── lib/                       ← stack-specific agent prompts + helpers
│   └── .slices/                   ← board slices, written by `fetch`/`listen` (or pre-seeded by `init --demo`)
├── .claude/
│   └── skills/                    ← eventmodelers skills for Claude Code
├── src/ … (or the stack's own layout)
└── CLAUDE.md                      ← agent instructions
```

The six backend stacks (`node`, `supabase`, `axon`, `opencqrs`, `umadb`, `kurrent`) also scaffold a real project skeleton into your project root (`templates/root/`) — source layout, build files, migrations, etc.

`react` and `supabase-react` are two more registered stacks (installable the same way). `supabase-react` is real, filled-in content — a Vite + React 19 + TypeScript scaffold that authenticates and issues command POSTs via a Supabase session (`src/lib/api.ts`/`src/lib/supabase.ts`), plus `init-style-guide`/`learn-styleguide` skills so generated UI stays on-brand. It's UI-only: `.build-kit/CLAUDE.md` only routes `STATE_CHANGE`/`STATE_VIEW` slices to `build-state-change`/`build-state-view` — an `AUTOMATION` slice has no UI counterpart and gets flagged via `request-feedback` instead, since it belongs to whichever backend stack is installed alongside this one. It needs no overrides at all and uses `shared/build-kit`'s realtime agent as-is.

`react` (the plain-REST/board-polling variant, no Supabase) is still in the same state as a fresh `init --build-kit` scaffold — CLAUDE.md, the `build-*` skills, and `templates/root/` are all TODO-marked placeholders, not real content, pending an equivalent reference implementation. It overrides `lib/ralph.js` (+ `ralph-claude.js`/`ralph-local-ai.js`/`package.json`/`README.md`) for board-polling sync. Fill in the TODOs (and add a real `templates/root/` scaffold) against an actual project before relying on it.

## Skills

Use skills in Claude Code with `/skill-name`:

| Skill | Description |
|-------|-------------|
| `/connect` | Set up board connection |
| `/timeline` | Live event storming facilitator |
| `/wdyt` | Business analyst review of your event model |
| `/storyboard` | Build a full visual storyboard |
| `/html-screen` | Design individual real HTML/CSS screens (default) |
| `/storyboard-screen` | Design individual wireframe/sketch screens (explicit request only) |
| `/place-element` | Place commands/events/read models on the board |
| `/learn-eventmodelers-api` | Full API reference for agent use |
| `/attributes` | Add/rename attributes across a chain of elements |
| `/examples` | Add example data to element fields |
| `/update-slice-status` | Update slice status on the board |
| `/load-slice` | Persist board slices to disk (backend stacks) |
| `/build-state-change`, `/build-state-view`, `/build-automation`, `/build-webhook` | Implement a slice's command/view/automation/webhook (backend stacks) |
| `/request-feedback` | Post a comment and mark a slice `Blocked` when it's genuinely ambiguous (backend stacks) |

Which skills install depends on the chosen stack — see `stacks/<name>/templates/.claude/skills/`. `/connect`, `/learn-eventmodelers-api`, `/update-slice-status`, and `/request-feedback` have no stack-specific content and install into every stack from `shared/skills/` instead.

## Everyday commands

```bash
npx @eventmodelers/cli init --stack <name>          # scaffold a stack + install + configure (alias: install)
npx @eventmodelers/cli init --stack <name> --demo   # same, plus a ready-made demo model in the kit's .slices/ to build against
npx @eventmodelers/cli re-init                      # refresh an already-installed kit's scripts/skills only — never touches the root scaffold
npx @eventmodelers/cli run                          # start the agent loop (ralph-claude.js) from the installed kit dir
npx @eventmodelers/cli run --local-ai [target]      # board work only via a local/self-hosted model (ralph-local-ai.js) — does NOT build slices; build locally with --exec
npx @eventmodelers/cli run --exec "<command>"        # same, via an external agent harness (ralph-exec.js) — agent tracing needs its JSON flag, e.g. "codex exec --json --full-auto"
npx @eventmodelers/cli run --bash                   # bash-only loop, no realtime (ralph.sh)
npx @eventmodelers/cli run --local                  # skip platform config/credential lookup entirely — local-only, no board sync
npx @eventmodelers/cli run --modeling               # modeling-kit: warm Claude process driven by the board's prompt queue
npx @eventmodelers/cli run --standalone             # same, plus acting on board changes unprompted — and needs no install at all
npx @eventmodelers/cli run --standalone --board-id <uuid>  # …from any directory, against any board (see Power users)
npx @eventmodelers/cli run --id <id> --name <label>  # override this run's agent identity (id + display name); `init --name` persists a name instead
npx @eventmodelers/cli fetch --context <name>                     # pull full slice detail for one context on the board into <kit-dir>/.slices/
npx @eventmodelers/cli fetch --context <name> --slice-id <id>     # same, then print just that slice
npx @eventmodelers/cli fetch --context <name> --slice-title <title> # same, then print just the slice matching this title
npx @eventmodelers/cli stacks                       # list available stacks
npx @eventmodelers/cli status                       # check what's installed
npx @eventmodelers/cli config                       # print the fully resolved config (file + env), token masked
```

`run` is a thin dispatcher — it just finds the installed kit dir (whatever it's named for the stack) and execs the runner file already sitting in it. The agent loop's actual logic stays in the scaffolded `<kit-dir>/`, not in this package, since you (and the agent itself, via `AGENT.md`) may customize those files per project.

`fetch` calls `slicedata?contextName=<name>` for the required `--context` (full slice detail — commands/events/readmodels/screens/processors/specifications/comments), and writes `.slices/<context>/<slice>/slice.json`, `index.json`, and `context.json`. It does not fetch screen images (those only arrive via `listen`'s push, see Power users). Unlike every other command, `fetch` also works with no kit installed at all — it only needs credentials, not kit-specific files. If credentials are missing, it prompts the same way `init-config` does. `--slice-id`/`--slice-title` still fetch and persist the whole context, then just print the one slice you asked about. `init --demo` seeds that same `.slices/` layout from a bundled example context instead of from a board, for trying the kit out before connecting one.

---

## Power users

Everything below customizes *how the install itself works* — skills-only installs, bridging to another spec framework, CI-driven/non-interactive installs, multi-project config sharing, hooks that replace the AI executor, MCP registration for other harnesses, and adding a new stack. Casual usage never needs this section.

### Skills-only / no backend scaffold

```bash
npx @eventmodelers/cli init-modeling                 # skills + agent loop only, no backend scaffold
npx @eventmodelers/cli init --build-kit              # blank build-kit scaffold for a stack not built into this CLI yet
```

`init-modeling` isn't a stack — it's the option for when you don't want a backend scaffolded at all, just the skills and the agent loop. `init --build-kit` isn't one of the four either — it installs the same `.build-kit/` + skills shape as a real stack, but with TODO-marked placeholders instead of real content, for integrating a stack this CLI doesn't support yet (see "Adding a stack" below).

**Building a new kit for an unsupported stack:**

```bash
npx @eventmodelers/cli init --build-kit --demo
```

This scaffolds `.build-kit/CLAUDE.md`, `lib/prompt.md`, `lib/backend-prompt.md`, and the `build-*` skills with TODO placeholders instead of real content. Fill in the TODOs against the actual stack you're integrating (build/test commands, file layout, framework idioms) while building something real with it, then follow "Adding a stack" below to promote it to a first-class stack once it works.

`--demo` is what gives you something to build *against* while you do that: it seeds the kit's `.slices/` with the ready-made 16-slice **Understanding Eventsourcing** model (see "Trying it out before you have a board of your own" above), so you don't need a board, credentials, or a connected project to exercise the kit you're writing. With it in place the whole loop is:

```bash
npx @eventmodelers/cli run --local
```

and the agent starts building — `--local` skips platform config and credential lookup entirely, so it works straight out of `init` with nothing connected. Every TODO you fill in gets exercised on the next iteration against real slice data covering all four slice types (state change, state view, automation, translation), which is exactly the coverage a new stack's `build-*` skills need before it's worth promoting.

Installing both a build stack and `init-modeling` into the same project reuses this one `.eventmodelers/config.json` — run whichever `init` command second and it finds the existing config already satisfies the required fields and skips straight past the credential prompt.

### The modeling agent — `run --modeling` and `--standalone`

A modeling-kit install has one runtime: a warm Claude process the CLI keeps alive across
turns and feeds directly over stdin, so a prompt typed (or spoken) on the board is picked up
with no cold start and no `tasks.json` round trip.

```bash
npx @eventmodelers/cli run --modeling               # react to prompts sent to this board
npx @eventmodelers/cli run --standalone             # …and to board changes, on its own initiative
```

`--standalone` implies `--modeling`, so you never need both. To drive either one with a local
model instead of Claude, see [Running the modeling agent on a local model](#running-the-modeling-agent-on-a-local-model).

**No install required.** A modeling agent never touches the directory it was started from —
it works against the board over MCP/REST — so it doesn't need a kit scaffolded there. When
the current directory has no modeling kit, `run --modeling`/`run --standalone` fall back to a
single global install under `~/.eventmodelers/kit`, initialized on first use and refreshed
when you upgrade the CLI. Pass `--global` to prefer it even when a local kit does exist.

```bash
npx @eventmodelers/cli run --standalone --board-id <uuid>   # from any directory, nothing written there
```

**Which board?** When `--board-id` isn't given, the agent asks for it on start, pre-filled
with whatever the config resolved to — press Enter to accept it, or paste a different board
id. A board inherited from a config file can be arbitrarily stale, and which board a run
drives is the one thing worth confirming. Skipped when there's no one to ask (`--print`, or a
non-interactive stdin), where the resolved value stands on its own.

**Credentials are per board, not per directory.** The first time this machine runs a board it
asks one more question — does this board get credentials of its own, or does it use your
account-wide ones? Answer once and it's remembered: either the board's credentials or a
`useGlobal` marker lands in `~/.eventmodelers/boards/<board>.json`, and you're not asked
again. If the credentials you paste name a *different* board than the one asked about — an easy
way to end up there is a stale `boardId` in `~/.eventmodelers/config.json` — the run switches
to the pasted board and leaves a pointer behind for the one it asked about, so the question is
asked once rather than on every start. The question is skipped entirely when the answer is
already implied (credentials given on the command line) or when there's no one to ask
(`--print`, or a non-interactive stdin such as CI or a process supervisor).

To configure a board up front instead, paste the blob from
[app.eventmodelers.ai/account](https://app.eventmodelers.ai/account):

```bash
npx @eventmodelers/cli init-config --credentials "token=<uuid>,boardId=<uuid>,organizationId=<uuid>,baseUrl=https://api.eventmodelers.ai"
npx @eventmodelers/cli run --standalone --board-id <uuid>    # all it needs from here on
```

`--credentials` also takes the equivalent JSON, or `-` to read either from stdin, so a token
need never appear in your shell history or in `ps`. `run` accepts it too, for configuring and
starting in one command. Resolution order for a run is `--credentials` and the individual
`--token`/`--organization-id`/`--board-id`/`--base-url` flags, then `EVENTMODELERS_*` env vars,
then `~/.eventmodelers/boards/<board>.json`, then the usual `.eventmodelers/config.json` walk,
and finally the account's default board. Whatever a run resolves is saved back to the
per-board file (`0600`, in a `0700` directory). The agent id is *not* stored there — a standalone
run mints a fresh one each time, so two ad-hoc agents on one board stay two agents (see
[Naming an agent](#naming-an-agent)). One machine can therefore drive several boards, across
several accounts, at once.
The global kit itself holds no credentials at all — the token reaches `claude` through the
spawned process's environment.

A kit installed in the current directory still wins by default and behaves exactly as before,
reading its own `.eventmodelers/config.json`.

A `--standalone` session also warms itself up: the moment the agent process comes up — before
any prompt or board change — it gets one `SESSION_START` turn in which it reads its instruction
file, runs `/connect`, and reads the board's outline, then answers `READY` and waits. Nothing is
written to the board there; the point is that the first person to send a prompt isn't the one
paying for the connect and the board read. A plain `--modeling` session has no warm-up turn and
does that setup on its first prompt, as before.

Without `--standalone` the agent only ever answers direct messages. With it, the loop also
subscribes to the board's own change channel — the same one the canvas and the build agents
use — and the agent becomes a background collaborator on the board: when it falls quiet after
someone edits it, and again whenever the board has simply been sitting still for a while
(`EVENTMODELERS_STANDALONE_IDLE_MS`), the agent gets a turn nobody asked for.

What it does with that turn is *not* "react to the last event". The changed nodes are a
notification telling it where to look. The agent itself analyses all of them against the model
as a whole — each changed area in its slice and chain, plus whatever else is still obviously
unfinished — and decides what needs doing. Then it fans the work out: **one subagent per piece
of work that needs doing, all dispatched in parallel** (pieces sharing a slice or chain are
merged into one agent, so no two agents write to the same area). The decision stays with the
main agent; each subagent is an executor that carries out the one piece it was given, invoking
the matching skill for its own target — example data on a freshly placed element, the specs
(GWT scenarios or a storyline) for a new command or read model, a missing attribute on the rest
of the chain, a screen for an empty SCREEN node, a question comment on a gap.

That fill-in work is deliberately not gated on the human being done. It is additive, scoped to
one element or chain, and cheap to undo, so the agent does it while they keep modeling — a node
placed a minute ago is the best target for it, not a reason to wait (the loop already waited for
the board to fall quiet before taking the turn at all). Only the other tier — board-wide sweeps,
renames, deletions, re-shaping, slice statuses — gets a comment first instead of being done, and
an unanswered comment parks that one sweep rather than the modeling work. Nothing needing doing
means no agents are spawned at all: the turn adds nothing and answers `NOOP`.

All of that lives in its own instruction file, `.agent-modeling-kit/CLAUDE-STANDALONE.md`,
which the agent reads only once a self-directed turn actually arrives: a `--modeling` session
without `--standalone` never loads it, and neither does a prompt turn inside a standalone
session — a turn someone asked for does what was asked and nothing more.

`--max-agents <n>` caps that fan-out, so an unattended turn's cost stays bounded — default 5:

```bash
npx @eventmodelers/cli run --standalone --board-id <uuid> --max-agents 3
```

Work sharing a slice or chain is merged into one agent first (that part is about not clobbering
the board, not about the cap); if more pieces are still left than the cap allows, the agent
dispatches the most valuable ones and leaves the rest for a later turn. `--max-agents 1` means
no subagents at all: the turn does the single most valuable piece itself. The cap rides along in
the turn's own instructions rather than being enforced from outside — the `claude` process is
what spawns the agents — so it's a budget the agent is told to keep, not a hard ceiling.

Every event that arrives is remembered until a turn carries it — including events that land
while a turn is running. Its own writes come back on that same channel, and each event says who
made it (`agent_id` from the writer's `x-agent-id` header, `user_id` for a browser), so the
agent's own echo is recognized exactly: a burst that is nothing but its own writes is dropped
without spending a turn, and one that is mixed lists its own lines marked as such. Only a write
that reached the platform with neither id falls back to the echo window's guess and is labelled
"possibly your own". The lane is damped on timing on top of that: it waits for a quiet period (but not forever), waits
out the echo window of its last turn, never fires twice in quick succession, and widens that
floor each time it answers `NOOP`, so a finished board goes quiet by itself. Override the
windows if the defaults don't suit your board:

| Env var | Default | What it controls |
|---|---|---|
| `EVENTMODELERS_STANDALONE_DEBOUNCE_MS` | `2500` | quiet period before buffered board changes turn into a turn — long enough to coalesce one gesture (a placement, a drag) into a single turn |
| `EVENTMODELERS_STANDALONE_MAX_WAIT_MS` | `90000` | cap on that quiet period, so a board being edited continuously still gets a turn |
| `EVENTMODELERS_STANDALONE_ECHO_WINDOW_MS` | `0` (off) | after a turn, how long an *unattributed* incoming change is labelled as probably the agent's own echo. Off because every event carries `agent_id`/`user_id`, which answers the same question exactly and costs no delay; set it only on a backend whose writes arrive unattributed (the run log names the origin of every change) |
| `EVENTMODELERS_STANDALONE_MIN_INTERVAL_MS` | `60000` | floor between two self-directed turns — a runaway-loop guard, so a change written from a browser session skips it (a person is not a loop; another agent's write still waits) |
| `EVENTMODELERS_STANDALONE_BACKOFF_CAP_MS` | `900000` | ceiling that floor doubles up to while turns keep answering `NOOP` |
| `EVENTMODELERS_STANDALONE_IDLE_MS` | `900000` | with nothing happening at all, how long before the agent reviews the model anyway (`0` disables it) |

Direct prompts always outrank the agent's own initiative — a self-directed turn waits while
anything from the prompt queue is running, and the changes it was about keep accumulating
meanwhile.

### Running the modeling agent on a local model

`--local-ai` works on the modeling loop too, not just build kits:

```bash
npx @eventmodelers/cli run --standalone --local-ai                 # bare flag = Ollama on localhost:11434
npx @eventmodelers/cli run --standalone --local-ai vllm            # vLLM on localhost:8000
LOCAL_AI_URL=http://gpu-box:8000/v1 LOCAL_AI_MODEL=Qwen/Qwen3-8B \
  npx @eventmodelers/cli run --standalone --local-ai               # any OpenAI-compatible server
```

Two wire dialects cover the field, and the preset picks both the URL and the dialect:
`ollama` speaks Ollama's native `POST /api/chat`, while `vllm`/`lmstudio`/`llamacpp` speak the
OpenAI-compatible `POST /v1/chat/completions` that vLLM, LM Studio, llama.cpp-server, TGI and
SGLang all serve. Everything above the transport is identical, which is why anything
OpenAI-compatible works by pointing `LOCAL_AI_URL` at it. The `LOCAL_AI_*` vars are the same
ones a build kit's local runner reads (`LOCAL_AI_TARGET`, `LOCAL_AI_URL`, `LOCAL_AI_API`,
`LOCAL_AI_MODEL`, `LOCAL_AI_API_KEY`, `LOCAL_AI_NUM_CTX`), or set them once as `localAi` in
`.eventmodelers/config.json` — env wins over the file, the file over the preset:

```json
{
  "boardId": "...",
  "token": "...",
  "localAi": {
    "target": "ollama",
    "url": "http://localhost:11434",
    "model": "qwen3.5:9b",
    "numCtx": 49152
  }
}
```

**What you get and what you don't.** The loop around the turn is unchanged — the prompt queue,
the standalone board-change lane with all its damping, the idle review, the alive-ping, and the
platform's full MCP tool set, which the runner loads once per session. What a local model
cannot bring along is the part that isn't a wire format: the **skills** (`/place-element`,
`/timeline`, the `eventmodeling-*` methodology) and the **subagent fan-out**. Those are Claude
Code features. So a self-directed turn on a local model does the most valuable piece of work
itself, inline, with the board tools, instead of dispatching one agent per piece — the board
rules it needs are stated in the runner's own system prompt (`lib/modeling-local-ai.js`) rather
than read from `.agent-modeling-kit/CLAUDE.md`. `--max-agents` has nothing to cap and is ignored.

Give it room: the platform's MCP tool schemas alone run to ~16k tokens, so Ollama's default
`num_ctx` of 4096 would silently truncate the tool block and leave the model inventing tool
names. The runner raises it to 49152 by default (`LOCAL_AI_NUM_CTX`) and warns when the schemas
still fill more than 60% of it. On an OpenAI-compatible server the context is fixed at launch
instead, so start it accordingly (vLLM: `--max-model-len 49152`, llama.cpp: `-c 49152`) —
overflow there surfaces as an HTTP 400, which the runner reports with that advice attached.
A turn is capped at 24 tool iterations, which ends a model that has lost the plot without
ending the session.

Wanting the *full* Claude modeling agent (skills, subagents and all) on local weights is a
different thing, and `anthropicBaseUrl` below is that path — but note that it needs a server
speaking Anthropic's own `/v1/messages`, which Ollama does not serve. Pointing it straight at
`localhost:11434` gets you a 404; a translating proxy has to sit in between.

### Running headless, in a container

`run` normally confirms which board it is about to drive and where that board's credentials
come from. Those questions are worth one keystroke at a terminal and fatal anywhere else, so
`--non-interactive` turns them off: the board and credentials that resolve from flags,
`EVENTMODELERS_*` env vars and the config files are taken as final, and an incomplete set fails
the run with the reason instead of being interviewed for.

A missing TTY already implied this, which covers CI and most process supervisors — but not a
container started with `-it`, or a loop started from a terminal: stdin is a TTY nobody is
watching, and the run stops on a question forever. Pass the flag rather than relying on how
stdin happens to be wired.

```bash
docker run --rm \
  -e EVENTMODELERS_TOKEN=<token> \
  -e EVENTMODELERS_ORGANIZATION_ID=<uuid> \
  -e EVENTMODELERS_BOARD_ID=<uuid> \
  -e LOCAL_AI_URL=http://host.docker.internal:11434 \
  node:20 npx -y @eventmodelers/cli run --standalone --local-ai --non-interactive
```

Two things a container needs that a laptop already had:

- **A writable `HOME`.** With no kit in the working directory the agent installs one under
  `~/.eventmodelers/kit` and keeps per-board credentials in `~/.eventmodelers/boards/` (`0600`,
  in a `0700` directory). Run as a user whose home exists and is writable, or mount a volume
  there to keep the kit across restarts instead of reinstalling it on every boot.
- **A reachable model server.** `localhost` inside the container is the container, not the host
  — point `LOCAL_AI_URL` at `host.docker.internal` (Docker Desktop), the host's LAN address, or
  the service name if Ollama/vLLM is a sibling container.

`EVENTMODELERS_TOKEN` now also answers the credentials question on its own, the way
`EVENTMODELERS_BOARD_ID` always answered the board question — an env var that wins over every
config file anyway makes asking where the credentials come from moot. So a fully env-driven run
is silent even without the flag; pass it anyway, so a half-set environment fails loudly instead
of waiting for an answer.

### Installing skills globally

By default, skills are copied into the project's own `.claude/skills/`. Pass `--global` to `init` or `init-modeling` to install them into `~/.claude/skills/` instead — available in every project without re-running the installer each time:

```bash
npx @eventmodelers/cli init-modeling --global
```

Everything else (the kit dir, project scaffold, credentials, MCP registration) still targets the current directory as usual — `--global` only changes where skills land.

### Bridging to another spec framework

If you drive development with a different spec/task framework (Spec Kitty today; more later) instead of build-kit's own code generation, a **bridge** kit keeps that framework's artifacts in sync with the board instead of writing application code:

```bash
npx @eventmodelers/cli init --bridge --target spec-kitty
npx @eventmodelers/cli bridge
```

`init --bridge` installs a `.bridge-kit/` (mirrors `.build-kit/`'s realtime + task-queue loop) plus only the skills for the chosen `--target` (`shared/bridge/<target>/`) — a `spec-kitty` bridge never installs Kiro's skills, and vice versa. `bridge` starts the loop: on every board slice change (not just "Planned", unlike build-kit), it regenerates that framework's spec artifacts from the current board state. It doesn't build code and doesn't claim slices.

For `spec-kitty`, that sync is deterministic and stops well short of writing Spec Kitty's own artifacts — `lib/adapters/spec-kitty-adapter.js` fetches full slice detail and restates it as a plain markdown mission brief (one section per slice, its scenarios verbatim, nothing invented), then calls `spec-kitty intake --force` to install it at `.kittify/mission-brief.md`. It deliberately doesn't create the mission, write `spec.md`, or author work packages — Spec Kitty's own `/spec-kitty.specify` → `/spec-kitty.plan` → `/spec-kitty.tasks` pipeline does that, because those steps need real judgment (work package boundaries, which files a WP owns, which agent profile fits) that only makes sense with actual codebase context, which this adapter doesn't have. What it replaces is Spec Kitty's *interactive discovery interview*: `/spec-kitty.specify`'s own "Brief Context Detection" step reads `.kittify/mission-brief.md` when present and extracts requirements from it instead of asking the user, so the event model — not a live Q&A — becomes the input. No LLM call happens in this adapter's own path, and `bridge` picks it automatically whenever a target has one (`--claude` forces the Claude runner instead). Targets without a static adapter yet fall back to Claude re-running `bridge-<target>-specify`; pass `--local-ai` for the local-model runner instead (same caveat as build-kit's `--local-ai`: `lib/local-ai-agent.js` is shared as-is).

Don't want the standing loop at all? `fetch` can call the same adapter for a single one-shot sync, no `.bridge-kit/` install required:

```bash
npx @eventmodelers/cli fetch --context Ticketing --spec-kitty
```

Either way, `spec-kitty init` (Spec Kitty's own project setup) has to have already been run in the project root — the adapter checks for `.kittify/` first and stops with the exact command to run if it's missing, rather than failing deep inside a cryptic `spec-kitty` CLI error. After the sync, run `/spec-kitty.specify` in your coding agent to turn the brief into an actual mission (the plain `spec-kitty specify` CLI command only scaffolds — brief detection is in the agent-driven prompt).

### Overriding the executor with a hook

Claude is only the default — some teams don't want an AI agent in this loop at all, e.g. they'd rather just commit + push the board export and let a CI pipeline own the actual translation. `--hook` replaces the AI executor with an arbitrary shell command, run once per batch of slice changes:

```bash
npx @eventmodelers/cli init --bridge --target spec-kitty --hook "git add .slices && git commit -m sync && git push"
npx @eventmodelers/cli bridge
```

`init --bridge --hook` persists the command to `.bridge-kit/bridge.json` — a plain, **committed** file (unlike `.eventmodelers/config.json`, which is gitignored for credentials) since the hook is project policy meant to be shared by every teammate and CI runner, not per-machine state. `bridge --hook "<command>"` overrides it for a single run without touching that file. Only one executor runs per invocation — `--local-ai`, `--hook`, and `--claude` are mutually exclusive.

The hook command runs with `BRIDGE_TASK_COUNT`, `BRIDGE_SLICE_ID`/`_TITLE`/`_STATUS` (the most recent change in the batch), and `BRIDGE_BATCH_FILE` (path to the full batch as JSON) in its environment. It's invoked once per batch, not once per slice — any change that arrives while the hook is still running is left queued for the next batch rather than dropped.

### Claude execution & config resolution

During install you can optionally point the agent at a local LLM server instead of the default
Claude Code endpoint, and/or pin a specific model. This is the *other* local-model route: it
keeps Claude Code (and so the skills and subagents) and swaps only the endpoint behind it, which
means the server has to speak Anthropic's own `/v1/messages` — a vLLM deployment fronted for it,
or a translating proxy. Ollama's native API isn't that, so for Ollama use `--local-ai` above
instead:

```
🧠 Configuring Claude execution (optional)...
  ● None — use the default Claude Code endpoint
  ○ Local vLLM   (http://localhost:8000)
  ○ Local Ollama (http://localhost:11434)
  ○ Custom…
```

Both are stored alongside your credentials in the project root's `.eventmodelers/config.json`:

```json
{
  "organizationId": "...",
  "boardId": "...",
  "token": "...",
  "anthropicBaseUrl": "http://localhost:8000",
  "model": "claude-sonnet-5",
  "subagentModel": "sonnet"
}
```

`model` is what the agent session itself runs on. `subagentModel` (default `sonnet`) is what the
subagents it fans a turn out to run on — the session model does the judging (which parts of the
board need work, what each piece is, who owns what), and by the time an agent is dispatched
what's left is execution against a written brief, which doesn't need the expensive model. Set
them to the same value to turn that split off. `subagentModel` reaches the agents as the `model`
argument of the `Agent` tool, so it takes one of that tool's short aliases (`sonnet`, `opus`,
`haiku`) — not a full model id like `model` does.

Beyond the one-time install bootstrap, each stack's own `ralph.js`/`ralph-claude.js` governs how config is re-read at runtime — check `<kit-dir>/lib/` for the specifics of the stack you installed.

### Hierarchical config resolution

`init`/`init-modeling` write credentials to the project root's `.eventmodelers/config.json` by default — that's why a build stack and `init-modeling` in the same project automatically share one file instead of each holding their own copy.

`init`, `status`, and `config` all resolve config the same way: they walk up from the current directory looking for a `.eventmodelers/config.json` in an ancestor directory (shared defaults), then layer the installed kit dir's own `<kit-dir>/.eventmodelers/config.json` on top, if one exists there (a per-kit override) — any field that file also sets wins. If that walk reaches the filesystem root without finding anything, `~/.eventmodelers/config.json` is checked once more as a last resort — this matters for projects that don't live under `$HOME` at all (e.g. `/tmp/foo`), which the walk-up would otherwise never reach.

That walk-up (plus the home-dir fallback) means you can keep one shared config above all your checkouts and only override what's actually per-project — typically just `boardId`. The easiest way to set that shared file up is:

```bash
npx @eventmodelers/cli init-config --global   # writes organizationId + token to ~/.eventmodelers/config.json
```

```
~/.eventmodelers/config.json                                    ← shared: organizationId, token
~/projects/checkout-app/.eventmodelers/config.json               ← { "boardId": "<checkout-app-board>" }
~/projects/billing-app/.eventmodelers/config.json                ← { "boardId": "<billing-app-board>" }
```

Running any command from inside `~/projects/checkout-app` resolves `organizationId`/`token` from `~/.eventmodelers/config.json` (`baseUrl` defaults to `https://api.eventmodelers.ai` if nobody sets it) and `boardId` from the project's own file — switch to `~/projects/billing-app` and only the board changes. `npx @eventmodelers/cli status` and `npx @eventmodelers/cli config` both list every file that contributed, in override order, so you can see exactly where each value came from.

`init-config` (without `--global`) is the same credential-only flow targeted at the current directory — useful when you want to (re)configure credentials without re-running a full `init`/`init-modeling` install:

```bash
npx @eventmodelers/cli init-config                      # interactive, writes to ./.eventmodelers/config.json
npx @eventmodelers/cli init-config --board-id <uuid>     # non-interactive, just overrides one field
npx @eventmodelers/cli init-config --credentials "token=...,boardId=...,organizationId=...,baseUrl=..."  # configure ONE board (~/.eventmodelers/boards/<board>.json), no prompts
npx @eventmodelers/cli init-config --credentials -        # same, read from stdin (keeps the token out of shell history)
npx @eventmodelers/cli init-config --name ci-builder     # name the agent this config's runs identify as
```

### Naming an agent

Every agent identifies itself to the platform with an `agentId`, and the board's live-agent view shows that bare uuid. A **project install** mints one on first use and reuses it on every restart (`agentIds` in the project root's `.eventmodelers/config.json`). A **standalone/global run** mints a fresh one per run instead: nothing stops two ad-hoc agents running for one board, and since the heartbeat is keyed on `(token, agentId, agentType)`, a shared id would make the second agent replace the first — one agent visible however many are running, and their board writes indistinguishable.

`--name` gives an agent a readable label instead of the uuid — accepted by `init`, `re-init`, and `init-config`, saved into `config.json` as `agentName`, and sent with every heartbeat from then on:

```bash
npx @eventmodelers/cli init --stack node --name ci-builder     # persisted for every later run of this kit
npx @eventmodelers/cli init-config --name martins-laptop       # same, without re-installing
npx @eventmodelers/cli run --name one-off-check                # override for a single run, nothing written
npx @eventmodelers/cli run --id <id>                           # pin ONE identity across restarts
```

`run --id` is what you want when an agent has to keep the same identity every time it starts: a supervisor that already knows the id, a second agent of the same type in one *project* (which would otherwise share the project's single minted id), or an agent a board has starred as its **preferred agent** — that star addresses prompts to one id, so an agent whose id changes per run loses it on restart. `run --id`/`run --name` are per-run only: nothing is written to disk.

#### Working only what you were addressed (`--exclusive`)

By default an agent claims two kinds of prompt: the ones addressed to its own id, and every prompt nobody addressed to anyone. That's right for the single agent on a board, and wrong for a dedicated one — a specialist sitting next to a general agent, or an agent a supervisor drives by id, ends up answering whatever the queue happens to hold. `--exclusive` drops that second kind:

```bash
npx @eventmodelers/cli run --standalone --board-id <uuid> --id <agent-uuid> --exclusive
```

Only prompts carrying this agent's id are worked. Anything untargeted is handed straight back to the queue (status `ADDED`) for another agent to take — the addressee filter lives in the queue's claim query, which hands an agent its own prompts *and* the untargeted ones, so claiming is the only way to find out which arrived. An exclusive run therefore claims as usual and gives back what wasn't meant for it, once it has walked past it to its own work.

Pair it with `--id`: a `--standalone`/`--global` run mints a fresh id per run, so prompts addressed to the previous run's id are never claimed. `--exclusive` applies to the prompt queue only — a `--standalone` agent's self-directed turns are nobody's prompt, and it keeps taking them.

### Env vars and `--config` (scripted/CI installs)

Every config field can be set via an `EVENTMODELERS_*` env var instead of the interactive prompts — these always win over whatever's in `config.json`, so a fully env-driven install never prompts for credentials or Claude execution settings:

| Env var | Config field |
|---------|--------------|
| `EVENTMODELERS_ORGANIZATION_ID` | `organizationId` |
| `EVENTMODELERS_BOARD_ID` | `boardId` |
| `EVENTMODELERS_TOKEN` | `token` |
| `EVENTMODELERS_BASE_URL` | `baseUrl` |
| `EVENTMODELERS_ANTHROPIC_BASE_URL` | `anthropicBaseUrl` |
| `EVENTMODELERS_MODEL` | `model` |
| `EVENTMODELERS_SUBAGENT_MODEL` | `subagentModel` |
| `EVENTMODELERS_AGENT_NAME` | `agentName` |

```bash
EVENTMODELERS_ORGANIZATION_ID=... EVENTMODELERS_BOARD_ID=... EVENTMODELERS_TOKEN=... \
  npx @eventmodelers/cli init --stack node
```

`init`, `init-modeling`, and `init-config` also accept the same four fields as direct flags — handy for a one-off override without exporting env vars, and they win over both the config file and env vars:

```bash
npx @eventmodelers/cli init --stack node \
  --organization-id ... --board-id ... --token ... --base-url https://api.eventmodelers.ai
```

`--config <path>` points every command at an explicit `config.json`, bypassing the kit-dir/parent-directory resolution entirely:

```bash
npx @eventmodelers/cli --config ../shared/config.json status
```

Run `npx @eventmodelers/cli config` at any time to see the fully resolved config (file + env overrides merged, token masked).

`--config <path>` and `--print` are global flags accepted by every command. `--print` skips the "connect MCP globally?" prompt during `init-mcp` and just prints the `claude mcp add` command instead of running it — combined with the env vars or direct flags above, `--print` makes both `init` and `init-mcp` fully non-interactive:

```bash
EVENTMODELERS_ORGANIZATION_ID=... EVENTMODELERS_BOARD_ID=... EVENTMODELERS_TOKEN=... \
  npx @eventmodelers/cli --print init --stack node
```

### MCP for other harnesses

`init`/`init-modeling` scaffold and configure credentials, but don't register the MCP server — run that as a separate step once you're ready to connect a harness:

```bash
npx @eventmodelers/cli init-mcp
```

It writes the MCP server into `.claude/settings.json` for Claude Code. For other coding agents it follows the same principle [Playwright MCP](https://playwright.dev/mcp/installation) uses per client — one shared server, but a different registration mechanism per harness: a real CLI install command where one exists, and printed manual steps where it doesn't (no risky guessing at unverified config-file formats):

```
? Connect the MCP globally to another harness?
  ● Skip
  ○ Claude Code   claude mcp add eventmodelers --transport http <url>
  ○ VS Code       code --add-mcp '{"name":"eventmodelers","type":"http","url":"<url>"}'
```

Cursor and Windsurf don't have a safe scriptable install, so the installer prints their manual setup steps instead of writing anything. Pass `--print` to always print every harness's command/steps instead of prompting.

### `listen` — push-based slice export

```bash
npx @eventmodelers/cli listen                       # start the code-export listener (code-export.mjs) from the installed kit dir
npx @eventmodelers/cli listen --port 4000            # same, on a different port
```

`listen` is a dispatcher for `<kit-dir>/code-export.mjs` — a local HTTP server (port 3001 by default) that the eventmodelers board UI posts slice/screen data to, which then gets written under `<kit-dir>/.slices/`. Unlike `fetch`, it does receive screen images, since the board UI pushes them directly.

### Re-init — refresh scripts/skills without touching your app

```bash
npx @eventmodelers/cli re-init                      # refresh the installed build kit (.build-kit/) + its skills
npx @eventmodelers/cli re-init --modeling            # refresh the modeling kit (.agent-modeling-kit/) + its skills
npx @eventmodelers/cli re-init --stack supabase      # override which stack to refresh from (manifest missing/stale, or switching stacks)
```

`re-init` re-runs `init` against whichever stack `install-manifest.json` says was installed (no need to pass `--stack` again), but skips step 2 of `init` entirely — the root project scaffold (`package.json`, `src/`, `server.ts`, `docker-compose.yml`, etc.) and the root `CLAUDE.md` router are never touched. Use it after upgrading the CLI to pick up fixes to `ralph.js`/`ralph.sh`/skills without re-scaffolding a project you've since built on top of.

You don't have to remember to: on startup every command prints a 💡 hint (on stderr) when a newer CLI is on npm, or when a kit in the current directory was installed by an older CLI than the one running — naming the exact `re-init` command to run. The npm lookup happens at most once a day (cached in `~/.eventmodelers/update-check.json`, 1.5 s timeout, silent when offline). Set `EVENTMODELERS_NO_UPDATE_CHECK=1` to turn it off; it is also off when `CI` is set.

Pass `--stack <name>` to override the stack instead of relying on the manifest — useful if the manifest is missing/stale, or you want to point a `.build-kit` install at a different built-in stack's templates. It's mutually exclusive with `--modeling`.

Credentials are left alone unless you pass `--force` — same rule `init` already follows when everything required is already configured. `--global` defaults to however skills were originally installed; pass it explicitly to move them.

If the kit dir predates install-manifest.json tracking, or was installed via `init --git <url>` (a community/custom stack, not one of the built-in `STACKS` keys), and you don't pass `--stack` yourself, `re-init` can't tell what to re-copy and tells you to re-run the original `init` command by hand instead.

### Uninstall

Every `init`/`init-modeling` run writes an install manifest into `<kit-dir>/.eventmodelers/install-manifest.json` recording exactly what it put down. `uninstall` reads that manifest back and removes only:

- the kit dir (`.build-kit/` or `.agent-modeling-kit/`)
- the skills it copied — from `.claude/skills/` normally, or `~/.claude/skills/` if it was installed with `--global`
- the `eventmodelers` entry it added to `.claude/settings.json`'s `mcpServers`, if `init-mcp` was ever run for this project (the rest of that file, and the file itself, is left in place)

It deliberately **never** touches the root project scaffold (`package.json`, `src/`, `server.ts`, migrations, `docker-compose.yml`, etc.) — that's your actual application code, not tooling, so `uninstall` won't delete it even though `init` wrote it.

If a kit dir predates this tracking (no manifest present), `uninstall` falls back to only removing the kit dir itself and tells you so — any skills or MCP registration from that older install need to be cleaned up by hand.

Registering the MCP server with another harness (`claude mcp add`, `code --add-mcp`, or the manual Cursor/Windsurf steps) happens outside this project's files, so `uninstall` doesn't attempt to undo it — remove it yourself in that harness if you connected one.

```bash
npx @eventmodelers/cli uninstall                    # remove the one installed kit dir (errors if more than one is present)
npx @eventmodelers/cli uninstall --build-kit         # remove .build-kit/ specifically
npx @eventmodelers/cli uninstall --modeling-kit      # remove .agent-modeling-kit/ specifically
```

### Adding a stack

Each stack lives under `stacks/<name>/templates/` with `.claude/` (skills), `root/` (spread into the project root), and either `build-kit/` (backend stacks) or `kit/` (modeling-only) for the agent runner. Files identical across all backend stacks live once in `shared/build-kit/` and get layered in automatically — only put stack-specific overrides under `stacks/<name>/templates/build-kit/`. Skills with no stack-specific content (`connect`, `learn-eventmodelers-api`, `update-slice-status`, `request-feedback`) work the same way via `shared/skills/` — a new stack gets them for free without copying anything; add a skill there only once it needs a stack-specific fork.

The demo model `init --demo` installs is shared the same way, in `shared/demo-slices/` — a verbatim `fetch --format json` tree (`current_context.json` plus `<context>/{context,index,config}.json` and `<slice>/slice.json`), copied as-is into the kit's `.slices/`. It's stack-agnostic board data, so a new stack gets `--demo` for free. To replace or extend it, `fetch` a context into an empty directory and copy the result in, then update `DEMO_CONTEXT_NAME`/`DEMO_SLICE_COUNT` in `cli.js` (used only for the line `init` prints).

Once your `init --build-kit` scaffold (see above) works against a real backend, promote it to a first-class stack:

1. Copy `.build-kit/` → `stacks/<name>/templates/build-kit/`, `.claude/skills/build-*` → `stacks/<name>/templates/.claude/skills/`, and whatever `root/` scaffold you built → `stacks/<name>/templates/root/`.
2. Add an entry for `<name>` to the `STACKS` object in `cli.js` (`label`, `kitSubdir: 'build-kit'`, `kitDirName: '.build-kit'`, `useShared: true`, `needsBoardId: true`).
3. Add it to this README's stack list, the "What gets installed" section, and the `stacks` command's output (generated from `STACKS`, so nothing to add there beyond the entry itself).

## Contributors

| Contributor | Contribution |
|-------------|-------------|
| [Yordis Pietro](https://github.com/TrogonStack/trogonai) | All `eventmodeling-*` skills |