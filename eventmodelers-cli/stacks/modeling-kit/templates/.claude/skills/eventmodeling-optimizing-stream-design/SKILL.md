---
name: eventmodeling-optimizing-stream-design
description: "Design event streams with proper stream identity to keep streams appropriately sized, avoid unnecessary snapshotting, and balance performance with simplicity. Use when concerned about stream length, planning performance, or validating stream design before implementation. Do not use for: designing the initial event model structure (use eventmodeling-designing-event-models) or general architectural validation (use eventmodeling-validating-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
---

# Optimizing Stream Design

## Interview Phase (Optional)

**When to Interview**: Skip if the user has specified: expected event frequency, stream lifetime, and growth patterns. Interview when stream length concerns exist but growth estimates are unclear.

**Interview Strategy**: Establish growth expectations and performance requirements before recommending snapshotting. Most snapshotting proposals stem from poor stream boundary design, not genuine volume — surface the estimates first to distinguish real performance concerns from design problems.

### Critical Questions

1. **Growth Estimates** (Impact: Determines if snapshotting is needed or if stream design should change)
   - Question: "Estimate events: (A) Per entity per day, (B) Lifetime total, (C) Growth over years. Example: 5-10 events/order, 1-10 million orders/year?"
   - Why it matters: Growth estimates reveal if streams will genuinely be too long or if design is wrong
   - Follow-up triggers: If estimates exceed 300 events per stream lifetime → ask "Is the stream identity correct? Could this stream be split by a narrower business entity?"

2. **Performance SLAs** (Impact: Determines acceptable latency and snapshotting decisions)
   - Question: "Performance requirements? (A) <100ms read latency, (B) <1s acceptable, (C) Eventual consistency OK?"
   - Why it matters: Strict SLAs might need snapshotting; loose SLAs often don't
   - Follow-up triggers: If (A) → ask "Which commands specifically need sub-100ms replay? Are those commands reading from a read model or replaying the stream directly?"

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Event frequency estimate (per entity per day or per transaction)
  - AND stream lifetime estimate (months or years)
  - AND read latency SLA (or confirmation that eventual consistency is acceptable)

Then: Skip interview, proceed directly to stream analysis

Else: Conduct interview
```

**Phase 1: Growth Estimation** (Question 1)
- Establish per-entity event volume
- Project lifetime stream length using the estimation formula
- Determine whether redesign or snapshotting analysis is warranted

**Phase 2: SLA Requirements** (Question 2)
- Identify read latency requirements per command
- Determine whether read models or direct stream replay satisfies the SLA
- Establish whether snapshotting is justified by SLA alone

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## Optimizing Stream Design (eventmodeling-optimizing-stream-design)

### Growth Estimates
[From Q1: Events per entity per day, lifetime total, annual growth]

### Performance SLAs
[From Q2: Latency requirements per command or view]

### Optimization Decisions
- Streams requiring redesign: [list or "None"]
- Streams where snapshotting is justified: [list or "None"]
- Streams within acceptable bounds: [list]
```

Update Interview Trail:
```markdown
| Optimization | eventmodeling-optimizing-stream-design | Done | Stream growth estimates, SLA review, snapshotting decisions |
```

---

## Stream Design Optimization

**Purpose**: Optimize event stream design by validating stream boundaries, estimating growth, and making snapshotting decisions based on design quality—not just size.

**Applies To**: Any domain - e-commerce, banking, SaaS, marketplace, healthcare, etc.

**When to Use**:
- After defining event streams in domain analysis
- When concerned about stream length or performance
- Before implementing to validate stream design
- During performance planning to determine snapshotting strategy
- When redesigning streams for scalability

**What It Does**:
1. Analyzes event stream design for proper event organization
2. Estimates stream growth over time
3. Identifies when snapshotting is genuinely needed vs. design issue
4. Recommends optimal stream identity boundaries
5. Balances performance optimization against complexity
6. Provides snapshotting strategy without over-engineering

---

## Core Principle: Design First, Snapshot Second

**Golden Rule**:
> If you find yourself needing to snapshot because the stream is too long, first ask: "Is my stream identity wrong?" Usually, the answer is yes.

Snapshotting is a **performance optimization**, not a design problem. Good stream design (proper identity boundaries) often eliminates the need for snapshotting entirely.

---

## Stream Design Analysis Framework

### 1. Estimate Stream Growth

**Formula**:
```
Estimated Stream Length (total events/instance) =
Events Per Aggregate Instance Per Year (events/instance/year)
  × Lifetime of Instance (years)
  × Annual Growth Factor (dimensionless year-over-year multiplier ≥ 1.0)
```

**Quick Examples**:

**E-commerce Order**: 8 events/year × 1.5 year lifetime = 8-16 events → NOT NEEDED

**Banking Account**: 100-200 events/year × 10 years = 1000-2000 events → CONSIDER AT 1000+

**Order Processing**: 100+ events/year × 5 years = 300-500+ events → PROBABLY NEEDED

**SaaS User**: 12-60 events/year × 5 years = 60-300 events → RARELY NEEDED

### 2. Identify Stream Length Categories

| Length | Status | Action | Snapshotting |
|--------|--------|--------|--------------|
| < 50 events | IDEAL | Keep as-is | NOT NEEDED  |
| 50-100 events | GOOD | Monitor growth | NOT NEEDED  |
| 100-300 events | ACCEPTABLE | Review boundary | CONSIDER if replayed |
| 300-1000 events | LONG | REDESIGN first | Only last resort |
| 1000+ events | CRITICAL | REDESIGN required | Won't help |

---

## Quick Decision Matrix

| Stream Length | Read Pattern | Frequency | Action |
|---|---|---|---|
| < 50 | Any | Any |  IDEAL - Keep as-is |
| 50-100 | Any | Any |  Good - Monitor |
| 100-300 | From Model | Any |  OK - No snapshot |
| 100-300 | Stream Replay | Low |  OK - Monitor |
| 100-300 | Stream Replay | High |  REDESIGN |
| 300-1000 | From Model | Any |  OK - No snapshot |
| 300-1000 | Stream Replay | Any |  REDESIGN |
| 1000+ | Any | Any |  CRITICAL - REDESIGN |

---

## Reference Files

**Aggregate Boundary Design**: See [patterns.md](references/patterns.md) for:
- 5 aggregate patterns (single entity, composite, collections, event logs, historical)
- Stream size decision tree
- Red flags that indicate redesign needed
- Tips for optimal stream design

**Snapshotting Strategy**: See [snapshotting.md](references/snapshotting.md) for:
- Criteria for when snapshotting is truly needed
- Context-based decision thresholds
- Snapshot frequency, versioning, and cleanup strategies
- Cost-benefit analysis

**Domain-Specific Guidance**: See [domain-patterns.md](references/domain-patterns.md) for:
- E-commerce patterns (orders, carts, accounts)
- Banking patterns (accounts, transactions, loans)
- SaaS patterns (subscriptions, workspaces, data collections)
- Implementation checklist

---

## Key Insights

### Why Snapshotting Usually Isn't the Answer

```
Before implementing snapshotting, ask:

1. Can I split this aggregate into smaller ones?
   → YES: Do that instead. Simpler, better design.

2. Can I reduce event granularity?
   → YES: Batch events or create coarser state changes.

3. Am I using a read model for this aggregate?
   → NO: Create a read model (cached projection).
      Stream size becomes irrelevant.

4. Have I measured actual replay latency?
   → NO: Measure first. Most systems exceed expectations.

If ANY of these is YES, do that before snapshotting.
Only after exhausting design improvements, consider snapshots.
```

### The Snapshotting Trade-off

```
Snapshotting Complexity ≈ 2-3x Complexity of Better Design

Before snapshot:  50 lines of code, simple, testable
With snapshots:   150+ lines, versioning, recovery logic, testing matrix

Better to redesign and keep streams < 300 events.
```

---

## Quality Checklist

- [ ] Each stream is identified by a business entity identity (e.g., `orderId`), not a category or type
- [ ] No stream grows unboundedly without a design reason — event frequency and stream lifetime estimated
- [ ] Streams under 1000 events require no snapshotting justification
- [ ] If snapshotting is proposed, all simpler alternatives (split stream, shorter lifetime) have been eliminated first
- [ ] Command handler state is reconstructed from stream events — no persistent state stored outside the stream
- [ ] Each stream can be independently versioned and replayed without affecting other streams

