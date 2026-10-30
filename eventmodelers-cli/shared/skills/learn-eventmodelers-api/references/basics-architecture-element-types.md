## Architecture Overview

- **Framework**: Express.js + `@event-driven-io/emmett` (event sourcing)
- **Adapter**: `@event-driven-io/emmett-expressjs`
- **Database**: PostgreSQL via Knex
- **Storage / Auth**: Supabase
- **Route discovery**: Dynamic glob (`**/routes{,-*}.js`) loaded from `dist/src/slices`
- **Base URL** (local): `http://localhost:3000`

---

## Element Types

```typescript
MODEL_CONTEXT  // Context/domain modeling container
CHAPTER        // Timeline/sequence container — a "chapter" IS a timeline (chapterId === timelineId); the terms are used interchangeably across the API
ACTOR          // System participant (swimlane label)
AUTOMATION     // Automated action
SCREEN         // UI screen
COMMAND        // State-changing operation
EVENT          // Domain event
SPEC_ERROR     // Error scenario
TABLE          // Data table
READMODEL      // Query result / materialized view
SCENARIO       // GWT scenario
LANE           // Timeline row
SLICE_BORDER   // Slice boundary marker
MARKDOWN       // Free-text markdown note — the content type a `feedback` lane accepts (see §2)
VIDEO          // Embedded video (YouTube/Loom link in `data.url`). API/MCP-only — no palette button in
               // the UI, but renders on the board like any other node. Free-floating: create it via
               // `submit_node_events` with a position and no chapterId/cellId, same as a drawing.
```

---

## Field Types

Every field on a `COMMAND`, `EVENT`, `READMODEL`, `SCREEN`, or `TABLE` element (`meta.fields[]`) has a `type` from this exact set — the canonical source is the [event-modeling-spec schema](https://github.com/dilgerma/event-modeling-spec/blob/main/eventmodeling.schema.json) (`$defs.Field.properties.type`):

```typescript
String     // text
Boolean    // true / false
Int        // 32-bit integer
Long       // 64-bit integer
Double     // floating-point number
Decimal    // precise fixed-point number — prefer this over Double for money/currency
Date       // calendar date only, no time component (e.g. "2026-06-01")
DateTime   // date + time, ISO 8601 (e.g. "2026-06-01T09:00:00Z")
UUID       // universally unique identifier
Custom     // structured/nested value — use with `subfields` or `schema`
```

Other `Field` properties: `name`, `example`, `subfields[]` (nested `Field`s), `mapping`, `optional`, `technicalAttribute`, `generated`, `idAttribute`, `pii`, `tag` (the field's value tags the event for Dynamic Consistency Boundaries — DCB; see https://dcb.events), `schema`, `cardinality` (`"List"` | `"Single"`).

Use exactly these type names (case-sensitive) — not lowercase (`string`), synonyms (`Number`, `Text`, `Integer`), or types outside this set.

---

## Standard HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | OK with data |
| 201 | Created |
| 204 | No content |
| 400 | Validation error / bad input |
| 401 | Authentication required |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate) |
| 500 | Server error |

---
