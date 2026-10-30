## Local prototype (Eventmodelers)

This folder holds a local, clickable prototype of one event model context. **The prototype is a reflection of the model, never the other way round.** The model is JSON on disk and the only source of truth; the page is derived from it and can be thrown away and rebuilt at any time. Every change a person asks for is made in the JSON first and only then reflected in the prototype — a change that exists only in the page is lost on the next rebuild and never reaches the board.

`/local-prototype` builds it (local files when they exist, otherwise it fetches a context from the board); running it is the CLI's `{{CLI}} run --prototype`. Every change request is handled with two skills, always in this order:

1. `local-prototype-model` — turn the prompt into edits of the model JSON (`.slices/`) and the local screens (`.prototype/screens/`).
2. `local-prototype-build` — reflect those edits in the prototype page.

The prototype player's buttons do not run anything — they record events in the control log (`.prototype/events/`): **Sync** → `SyncRequested`, **Fetch** → `FetchRequested`, **Rebuild** → `RebuildRequested`. **At the start of every run** (any prompt in this folder), check `{{CLI}} prototype events --pending`; when requests are open, work through them first with the `local-prototype-control` skill (`/local-prototype-control`), then carry on with what was asked. What is processed is recorded in the log too, so nothing is done twice. `{{CLI}} run --prototype` runs the same as an unattended loop. **Feedback is not handled here:** it is collected in the player and submitted to the platform, where its `/apply-feedback` applies it to the model — fetch the model again afterwards (`{{CLI}} prototype fetch`).

The board's own write tools (MCP: `create_slice`, `place_element`, `submit_node_events` …) are denied in this folder: you work on the local model; the board is written — with the conflict check — by `prototype sync` or `run --prototype --sync`. Reading the board stays yours.

Changes reach the board only through `{{CLI}} prototype sync`; you never talk to the board yourself.
