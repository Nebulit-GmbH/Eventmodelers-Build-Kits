# Your stack

**Variant: supabase-react-kit (direct table access)** — this app is meant to talk to
Supabase directly (Postgres tables via `@supabase/supabase-js`, RLS-backed auth), and
its `.build-kit` runtime subscribes to Supabase/PocketBase realtime for instant board
push notifications. See `react-kit` for the API-only sibling with no Supabase
integration at all.

TODO — this is a placeholder project scaffold, installed by `init --build-kit` for a
stack that isn't built into this CLI yet. Replace this file (and everything else under
`root/`) with a real minimal starter for your stack: build/dependency file, source
layout, a slices directory the skills in `.claude/skills/` generate into, and whatever
local infra (docker-compose, migrations, etc.) it needs to run.

See an existing stack's `templates/root/` in the eventmodelers-cli source —
`stacks/node`, `stacks/supabase`, `stacks/axon`, `stacks/cratis-csharp` — for the shape
a real one takes.

Once this is filled in and working, consider contributing it back as a first-class
stack: copy `.build-kit/`, `.claude/skills/`, and this `root/` scaffold into
`stacks/<name>/templates/` in the eventmodelers-cli repo and register it in `STACKS`
(cli.js) — see that repo's README, "Adding a stack".
