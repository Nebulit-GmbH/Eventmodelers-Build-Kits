---
name: eventmodeling-optimizing-stream-design
description: "Validate and fix an entity's event timeline boundary — is it anchored on a single business identity, or is it secretly a collection/log that will grow unbounded? Use when concerned about a timeline mixing concerns, reviewing timeline boundaries, or when a timeline feels like it's absorbing unrelated events. Do not use for: designing the initial event model structure (use eventmodeling-designing-event-models) or general model validation (use eventmodeling-validating-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
---

# Optimizing Stream Design

This step applies the shared element rules in **`eventmodeling-core-rules`** — read it once per session if you haven't already; it defines what a COMMAND/EVENT/READMODEL/SCREEN/AUTOMATION is, how each is named, and the anti-patterns to reject, so this step doesn't restate them.

## Timeline Boundary Optimization

**Purpose**: Validate timeline boundaries — confirm each entity's event timeline is anchored on a single business entity's own lifecycle, and catch the two common anti-patterns (an unbounded collection, or an unrelated event log) before they get modeled further.

**Applies To**: Any domain — e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After defining events in domain analysis
- When a timeline feels like it's growing for reasons unrelated to one entity's own story
- When redesigning a timeline whose boundary turned out to be wrong

**What It Does**:
1. Checks that each timeline has a single, natural business identity
2. Identifies timelines that are actually collections or logs in disguise
3. Recommends the correct boundary when one is wrong
4. Distinguishes "this timeline is long because the entity has a long history" (fine) from "this timeline is long because it's absorbing events that don't belong to it" (a boundary bug)

---

## Core Principle: Get the Identity Right

**Golden Rule**:
> If a timeline feels like it's growing for the wrong reasons, first ask: "Does this timeline actually have one business identity, or is it a collection/log wearing an entity's name?"

A long timeline is not, by itself, evidence of a design problem — an account open for thirty years is correctly one long timeline. What *is* always a design problem is a timeline whose events don't all belong to the same entity's own lifecycle.

---

## Timeline Boundary Review

For each entity's timeline in scope, work through:

### 1. Name the identity

What single business entity does this timeline represent the history of? Write it down explicitly (e.g. `orderId`, not "orders").

### 2. Check every event against that identity

Does each event on the timeline describe something that happened to *this* entity — not to a category of entities, not to the system in general? If any event fails this test, the boundary is wrong (see `references/patterns.md`'s Red Flags).

### 3. Classify the result

| Result | Meaning | Action |
|---|---|---|
| Every event belongs to one clear entity | Boundary is correct | Keep as-is, regardless of how long the history gets |
| Events span a category or "all X" | Pattern 3 (Collection) anti-pattern | Re-scope to the real per-entity identity; the category becomes a read model/query, not an event timeline |
| Events span unrelated concerns (users, orders, payments mixed) | Pattern 4 (Event Log) anti-pattern | Split into one timeline per concern |
| Timeline conflates an entity's active life with its historical record | Missing the Pattern 5 split | Separate active vs. archived/historical timelines |

---

## Reference Files

**Timeline Boundary Design**: See [patterns.md](references/patterns.md) for:
- 5 boundary patterns (single entity, composite, collection anti-pattern, event-log anti-pattern, historical)
- The timeline boundary decision tree
- Red flags that indicate the boundary — not the volume — is wrong
- Tips for finding the right boundary

**Domain-Specific Guidance**: See [domain-patterns.md](references/domain-patterns.md) for:
- E-commerce patterns (orders, carts, accounts)
- Banking patterns (accounts, transactions, loans)
- SaaS patterns (subscriptions, workspaces, data collections)

---

## Quality Checklist

- [ ] Each timeline is identified by a business entity identity (e.g., `orderId`), not a category or type
- [ ] Every event on a timeline belongs to that one entity's own lifecycle — none of them describe a different entity or an unrelated system concern
- [ ] No timeline is secretly a collection ("all X") or a log ("everything that happened") wearing an entity's name
- [ ] A timeline that conflates an entity's active life with its historical record has been split (active vs. archived)
