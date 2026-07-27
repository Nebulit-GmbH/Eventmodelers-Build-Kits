# Eventmodelers Build Kits

[`eventmodelers-cli`](./eventmodelers-cli) connects an [Eventmodelers](https://eventmodelers.ai) board to an autonomous coding agent that picks up slice status changes, implements the code, and marks work done — for any of the stacks below.

```bash
npx @eventmodelers/cli init --stack node
```

## Official stacks

| Stack key | Stack |
|-----|-------|
| `node` | Node.js / TypeScript |
| `supabase` | Supabase |
| `axon` | Axon Framework (Java/Kotlin) |
| `cratis-csharp` | Cratis (.NET/C#) |

Not a stack, but also built in: `npx @eventmodelers/cli init-modeling` installs skills + the agent loop only, with no backend scaffold.

Previously these shipped as five separate npm packages (`build-kit-node`, `build-kit-axon`, `build-kit-supabase`, `build-kit-cratis-csharp`, `agent-modeling-kit`) with near-duplicated installer code. They're now templates inside the single `eventmodelers-cli` package — see [`eventmodelers-cli/README.md`](./eventmodelers-cli/README.md).

## Unofficial / community kits

These are not maintained in this repo and follow no guaranteed structure — link only, use at your own judgment.

| Stack | Repo | Notes |
|-------|------|-------|
| .NET | [Powerworks/K9DatingApp](https://github.com/Powerworks/K9DatingApp/) | Community reference for event modeling in .NET; not adapted to the build-kit skill/installer pattern used by the official kits above. |
