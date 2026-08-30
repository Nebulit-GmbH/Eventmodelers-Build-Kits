---
name: eventmodeling-translating-external-events
description: "Translate external system events (webhooks, APIs, IoT) into domain events. Map technical data to business concepts. Use when integrating with external systems that emit events your domain needs to react to. Do not use for: designing command handlers for the translated events (use eventmodeling-designing-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Translating External Events

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has specified: external systems involved, webhook/API formats, and domain mapping. Interview when external systems haven't been fully cataloged or translation rules are unclear.

**Interview Strategy**: Catalog all external systems and understand their event formats before defining translation rules. Missing correlation strategies — how external IDs map back to domain entities — are the most common source of integration failures, so surface them early.

### Critical Questions

1. **External System Details** (Impact: Determines what translation rules to create)
   - Question: "Which external systems send events? For each: (A) System name, (B) Event types, (C) Data format (JSON/XML), (D) Authentication needed?"
   - Why it matters: Translation rules depend entirely on what the external system sends
   - Follow-up triggers: For each system → ask "Does their payload include your internal entity ID, or do you need a correlation reference table?"

2. **Domain Mapping Complexity** (Impact: Determines if translation is straightforward or complex)
   - Question: "For the most complex integration: Does the external event data: (A) Map directly to domain concept, (B) Need aggregation/multiple events, (C) Need data from another system to map?"
   - Why it matters: Simple 1-to-1 mappings vs. complex multi-source translations affect design
   - Follow-up triggers: If (B) or (C) → ask "What data must you look up from your own system to complete the translation? How do you handle arrival before that data exists?"

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Full list of external systems with event types
  - AND sample payload formats for each event type
  - AND correlation strategy (how to link external IDs to domain entity IDs)

Then: Skip interview, proceed directly to translation rule design

Else: Conduct interview
```

**Phase 1: External System Catalog** (Question 1)
- Enumerate all systems that send events into the domain
- Document event types and payload formats for each
- Identify authentication and delivery mechanisms (webhook, polling, streaming)

**Phase 2: Mapping Complexity Assessment** (Question 2)
- Identify which integrations require enrichment from domain data
- Surface correlation gaps (external ID ≠ domain ID)
- Flag multi-source aggregations for deeper design attention

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## Translating External Events (eventmodeling-translating-external-events)

### External Systems Catalog
[From Q1: System names, event types, formats, auth mechanisms]

### Mapping Complexity
[From Q2: Direct mappings vs. complex enrichment needs, correlation gaps]

### Correlation Strategies
- [System A]: correlates via [reference field / lookup table]
- [System B]: correlates via [metadata in external payload]

### High-Risk Integrations
- [System needing multi-source data]: [risk description]
```

Update Interview Trail:
```markdown
| Ext. Events | eventmodeling-translating-external-events | Done | External systems cataloged, correlation strategies defined |
```

---

## Workflow

### 1. Identify External Event Sources

For each external system, document its name, the events it sends, and a sample payload for each event type. Do this for every system your domain integrates with before moving on. A full worked example (Stripe payment webhooks, GPS geofence events) is in `references/examples.md`.

### 2. Analyze Technical Representation

For each external event, list its raw technical fields and call out what's wrong with using them directly: opaque IDs that mean nothing to your domain, values needing unit/format conversion, a single technical field standing in for a business fact, and — critically — IDs that don't match your own entity IDs and therefore need correlation. A full worked example (Stripe `charge.succeeded`) is in `references/examples.md`.

### 3. Define Domain Translation Rules

Map each technical field to the domain concept it should become, and flag any domain field the external payload doesn't supply at all. When a required field (like your own internal ID) is missing, decide how to obtain it — typically either by storing a reference to the external ID when you initiate the external action, or by embedding your own ID as metadata that the external system echoes back. A full worked example (Stripe charge → `PaymentAuthorized`) is in `references/examples.md`.

### 4. Handle Correlation

External systems rarely include your own entity IDs, so the correlation bridge must be created on **your** side, at the moment you initiate the external action — store a reference record mapping your entity ID to the external ID you receive back. When the external event later arrives, look up that reference to recover your entity ID before creating the domain event. A full worked example (Order ↔ Stripe charge reference tracking) is in `references/examples.md`.

### 5. Define Translation Scenarios

For each external event, specify: its trigger, any precondition that must hold, the translation logic as an ordered list of steps, what a success looks like, and every failure scenario (e.g. missing correlation, invalid state, duplicate delivery) with its handling. A full worked example (Stripe `charge.succeeded`, GPS `geofence_exit`) is in `references/examples.md`.

### 6. Handle Duplicates and Ordering

External systems commonly redeliver the same event (e.g. webhook retries). Translation must be idempotent: before creating a domain event, check whether one already exists for that external ID, and only create it if not. This requires storing the external ID on the resulting domain event so the check has something to query against. A full worked example (duplicate Stripe webhook delivery) is in `references/examples.md`.

### 7. Handle Partial or Missing Information

External payloads are often incomplete. For each field the domain event needs, classify it as: enrich (look it up from your own system), ignore (not needed for this domain), or infer (a safe assumption follows from the event itself). Document the classification explicitly rather than leaving a field's source implicit. A full worked example (GPS `geofence_exit` enrichment) is in `references/examples.md`.

## Output Format

After completing the translation analysis, **place each translated domain event on the board** using the `place-element` skill:

| Parameter | Value |
|-----------|-------|
| `elementType` | `EVENT` |
| `title` | `<DomainEventName>` (translated name, not the external event name) |
| `boardId` | `BOARD_ID` |
| `timelineId` | the existing chapter/timeline |

Then present the full translation rules as text to the user.

---

Older versions of this skill wrote the translation rules as a standalone markdown document rather than placing translated events on the board; that legacy format is kept in `references/examples.md` for reference only — it is not the actual output mechanism (see "Output Format" above).

## Quality Checklist

- [ ] Every external event type has translation rules
- [ ] Correlation mechanism defined (how to link back to domain entities)
- [ ] External IDs captured for deduplication
- [ ] Missing data handled (enrichment from our system)
- [ ] Duplicate webhook handling implemented (idempotent)
- [ ] Failure scenarios documented
- [ ] Manual review process for unhandled cases
- [ ] No raw external IDs leak into domain model
- [ ] All external data validated before translation
- [ ] Timestamp handling is consistent
- [ ] Sensitive data from external systems handled properly

## Common Translation Patterns

### Pattern 1: Webhook to Event (Simple Mapping)
```
External webhook → Validate → Map fields → Create domain event
Example: Payment gateway → PaymentAuthorized
```

### Pattern 2: Webhook with Correlation Lookup
```
External webhook → Extract correlation ID → Look up our entity →
Enrich data → Create domain event
Example: GPS location + guestId → Look up guest room → GuestLeftHotel
```

### Pattern 3: API Polling (Scheduled Fetch)
```
Scheduled job → Call external API → Extract events →
Translate → Create domain events
Example: Inventory availability check every 5 minutes
```

### Pattern 4: Webhook with Missing Context
```
External webhook (partial data) → Extract what we have →
Query our system for missing context → Enrich → Create domain event
Example: Order confirmation from third-party fulfillment with only order ID
```

## Key Principles

1. **Correlation First**: Always establish how to link external events to domain entities
2. **No Leakage**: Don't expose external IDs/data structures in your event model
3. **Translate Intent**: Translate the business meaning, not just map fields
4. **Idempotent**: Always handle duplicate external events gracefully
5. **Validate Always**: Verify external data before trusting it
6. **Enrich from Source**: Look up context from your system, not external system
7. **Default Gracefully**: Handle missing data with sensible defaults or explicit failure

## Integration Patterns to Avoid

 **Direct External IDs**: Using Stripe charge ID as our primary ID
 **No Correlation**: Translating events without way to correlate back
 **Schema Leakage**: Exposing external JSON structure in domain events
 **Unvalidated Data**: Trusting external data without verification
 **Duplicate Processing**: No idempotent check, processes same webhook twice
