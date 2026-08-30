---
name: eventmodeling-optimizing-stream-design
description: "Validate and fix event stream boundaries — is each stream anchored on a single business identity, or is it secretly a collection/log that will grow unbounded? Use when concerned about stream length, reviewing stream design before implementation, or when a stream feels like it's absorbing unrelated events. Do not use for: designing the initial event model structure (use eventmodeling-designing-event-models) or general architectural validation (use eventmodeling-validating-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
---

# Optimizing Stream Design

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already named the entity each stream is anchored on and confirmed every event in it belongs to that entity's own lifecycle. Interview when a stream's boundary feels unclear or it seems to be absorbing events from more than one concern.

**Interview Strategy**: This is a boundary question, not a performance question — establish what single business identity a stream is supposed to represent before judging whether it's well-designed.

### Critical Question

**Stream Identity** (Impact: Determines whether the stream is a real aggregate or a disguised collection/log)
- Question: "What one business entity does this stream represent the history of? Does every event in it belong to that entity's own lifecycle, or does it also pick up events from a broader category?"
- Why it matters: A stream with no single identity, or one that mixes in events belonging to other entities, is the root cause behind almost every stream-design complaint — not stream length itself.
- Follow-up triggers: If the answer names a category ("all orders", "system events") rather than one entity → that's Pattern 3/4 in `references/patterns.md` (Collection/Event Log anti-patterns) — walk through the fix directly.

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## Optimizing Stream Design (eventmodeling-optimizing-stream-design)

### Stream Identity Review
[Which streams were reviewed? What entity does each represent? Any that turned out to be a disguised collection/log?]

### Boundary Decisions
- Streams requiring redesign: [list or "None"]
- Streams confirmed well-bounded: [list]
```

Update Interview Trail:
```markdown
| Optimization | eventmodeling-optimizing-stream-design | Done | Stream identity review, boundary decisions |
```

---

## Stream Design Optimization

**Purpose**: Validate stream boundaries — confirm each stream is anchored on a single business entity's own lifecycle, and catch the two common anti-patterns (an unbounded collection, or an unrelated event log) before they get built.

**Applies To**: Any domain — e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After defining event streams in domain analysis
- Before implementing, to validate stream design
- When a stream feels like it's growing for reasons unrelated to one entity's own story
- When redesigning a stream whose boundary turned out to be wrong

**What It Does**:
1. Checks that each stream has a single, natural business identity
2. Identifies streams that are actually collections or logs in disguise
3. Recommends the correct stream boundary when one is wrong
4. Distinguishes "this stream is long because the entity has a long history" (fine) from "this stream is long because it's absorbing events that don't belong to it" (a boundary bug)

---

## Core Principle: Get the Identity Right

**Golden Rule**:
> If a stream feels like it's growing for the wrong reasons, first ask: "Does this stream actually have one business identity, or is it a collection/log wearing an aggregate's name?"

A long stream is not, by itself, evidence of a design problem — an account open for thirty years is correctly one long stream. What *is* always a design problem is a stream whose events don't all belong to the same entity's own lifecycle.

---

## Stream Boundary Review

For each stream in scope, work through:

### 1. Name the identity

What single business entity does this stream represent the history of? Write it down explicitly (e.g. `orderId`, not "orders").

### 2. Check every event against that identity

Does each event in the stream describe something that happened to *this* entity — not to a category of entities, not to the system in general? If any event fails this test, the boundary is wrong (see `references/patterns.md`'s Red Flags).

### 3. Classify the result

| Result | Meaning | Action |
|---|---|---|
| Every event belongs to one clear entity | Boundary is correct | Keep as-is, regardless of how long the history gets |
| Events span a category or "all X" | Pattern 3 (Collection) anti-pattern | Re-scope to the real per-entity identity; the category becomes a read model/query, not a stream |
| Events span unrelated concerns (users, orders, payments mixed) | Pattern 4 (Event Log) anti-pattern | Split into one stream per concern |
| Stream conflates an entity's active life with its historical record | Missing the Pattern 5 split | Separate active vs. archived/historical streams |

---

## Reference Files

**Aggregate Boundary Design**: See [patterns.md](references/patterns.md) for:
- 5 aggregate boundary patterns (single entity, composite, collection anti-pattern, event-log anti-pattern, historical)
- The stream boundary decision tree
- Red flags that indicate the boundary — not the volume — is wrong
- Tips for finding the right boundary

**Domain-Specific Guidance**: See [domain-patterns.md](references/domain-patterns.md) for:
- E-commerce patterns (orders, carts, accounts)
- Banking patterns (accounts, transactions, loans)
- SaaS patterns (subscriptions, workspaces, data collections)

---

## Quality Checklist

- [ ] Each stream is identified by a business entity identity (e.g., `orderId`), not a category or type
- [ ] Every event in a stream belongs to that one entity's own lifecycle — none of them describe a different entity or an unrelated system concern
- [ ] No stream is secretly a collection ("all X") or a log ("everything that happened") wearing an aggregate's name
- [ ] Command handler state is reconstructed from stream events — no persistent state stored outside the stream
- [ ] Each stream can be independently versioned and replayed without affecting other streams
- [ ] A stream that conflates an entity's active life with its historical record has been split (active vs. archived)
