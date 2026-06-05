# Snapshotting Strategy

## Contents
- Criteria for Snapshotting
- Context-Based Decision Thresholds
- Snapshotting Downsides
- Snapshot Frequency & Versioning
- Snapshot Cleanup Strategies

---

## When Snapshotting is Actually Needed

### Conservative First Approach: Keep Streams Short

**Default Principle**: Prefer shorter streams over snapshotting
- Shorter streams = simpler code, easier debugging, fewer bugs
- Snapshotting = added complexity that's hard to get right
- Most systems don't actually need snapshotting if designed well

### Criteria: Snapshotting Only When ALL Are True

```
1.  Stream length > 100 events (conservative default) AND
2.  You've measured latency and it exceeds SLA AND
3.  The latency problem IS stream replay (not read model) AND
4.  Aggregate boundary is already optimal (can't split further) AND
5.  You have operational capability to maintain snapshots
```

**If ANY criteria fail**: Don't snapshot. Redesign instead.

### Context-Based Thresholds (Ask These Questions)

Instead of assuming a fixed number, ask about your actual business context:

**Question 1: How is this aggregate read?**
```
"From stream replay" (loaded every time)
  → Conservative threshold: 50-100 events
  → Reason: Replay latency compounds

"From read model/cache" (projection loaded once)
  → Conservative threshold: Not relevant (stream size doesn't matter!)
  → Reason: You're not replaying on each read
```

**Question 2: What's your read latency requirement?**
```
"Immediate/real-time" (< 50ms, user-facing)
  → Conservative threshold: 50 events max
  → Reason: Strict SLA, no room for slowness

"Normal web response" (100-500ms, typical page load)
  → Conservative threshold: 100-300 events
  → Reason: Some latency acceptable if not critical path

"Background/batch operations" (seconds to minutes)
  → Conservative threshold: Not a concern
  → Reason: Speed doesn't matter for batch work
```

**Question 3: How often is this aggregate read?**
```
"Very frequent" (> 100 reads/second)
  → Use threshold ÷ 5 (contention matters more)
  → Reason: Concurrent replays degrade badly

"Normal frequency" (1-10 reads/second)
  → Use stated threshold
  → Reason: Single-digit concurrency manageable

"Rare" (< 1 read per minute)
  → Use threshold × 2-3 (who cares about latency?)
  → Reason: Speed doesn't matter if rarely accessed
```

### If User Doesn't Know (Most Common Case)

**Guidance**: Be conservative AND use conversation context
```
Default position:
  → Start with 100 events as safe threshold
  → This prevents 90% of problems
  → Better to redesign early than add snapshotting later

If user says "I don't know my requirements":
  → Use context from earlier conversation
  → Review: What did domain analysis say?
  → Check: What's the business criticality?
  → Ask: Is this user-facing or backend?

Example Decision Logic:
Domain: E-commerce (user-facing) + No explicit SLA
    → Use 100-event threshold (conservative for user-facing)

Domain: Bank transfers (critical) + No explicit SLA
    → Use 50-event threshold (very conservative, safety margin)

Domain: Analytics (batch) + No explicit SLA
    → Use 1000+ threshold (performance doesn't matter)
```

---

## Snapshotting Downsides to Consider

```
Complexity Cost:
  - Extra code path (snapshot loading logic)
  - Testing complexity (snapshot + delta replay)
  - Snapshot versioning challenges
  - Potential for bugs in snapshot recovery

Operational Cost:
  - Storage overhead (original events + snapshots)
  - Cleanup and archival strategies
  - Debugging difficulty (was it the snapshot?)
  - Migration burden if snapshot format changes

Performance Cost:
  - Snapshot creation cost
  - Storage I/O for snapshots
  - Memory usage during snapshot loading
  - Synchronization between events and snapshots

Rule of Thumb:
Complexity of snapshotting ≈ 2-3x complexity of solving with better design
```

---

## Snapshotting Strategy (When Actually Needed)

### If You Decide Snapshotting is Necessary:

#### Snapshot Frequency Decision:

```
Rule: Snapshot every N events where N = √(Total Estimated Events)

Example:
If stream will eventually reach 10,000 events:
N = √10,000 = 100
Snapshot every 100 events
Result: 100 snapshots + max 100 events to replay = manageable

If stream reaches 100,000 events (red flag):
N = √100,000 = 316
Snapshot every 316 events
Result: 316 snapshots = storage issue, redesign needed
```

**Better Rule**: Snapshot when read latency exceeds acceptable threshold

```
Measure:
1. Measure event replay time for current stream length
2. If > acceptable latency (e.g., 50ms), snapshot
3. Snapshot frequency = whatever makes latency acceptable
4. Re-measure after snapshot implementation

Example:
- Stream: 2000 events
- Replay time: 120ms (acceptable if reads are occasional)
- Snapshot needed? NO 
- Decision: Monitor, implement snapshotting only if latency > 200ms
```

#### Snapshot Versioning:

```
 DON'T: Version snapshots, migrate old formats
 DO: Version aggregates instead

Pattern:
Aggregate Version 1: Stream 1
Aggregate Version 2: New Stream with different structure

Reason: Snapshots are just optimization, not part of model
          If snapshot format needs to change, it means your aggregate changed
          → Create new aggregate version with new stream instead
```

#### Snapshot Cleanup:

```
 Good Strategy: Snapshot + Event Log
  - Keep original events (immutable, source of truth)
  - Keep snapshots (performance optimization)
  - No special cleanup needed (both are authoritative together)

 Bad Strategy: Snapshot + Purge Old Events
  - Destroys event history
  - Makes auditing impossible
  - Complicates recovery
  - Only do if regulatory rules require it

 Alternative: Archive Old Events
  - Keep all events for audit trail
  - Archive to slower storage if needed
  - Snapshot in hot storage for performance
  - Best of both worlds
```
