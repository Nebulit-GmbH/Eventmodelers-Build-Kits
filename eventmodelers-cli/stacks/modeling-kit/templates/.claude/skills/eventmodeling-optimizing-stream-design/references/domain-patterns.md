# Domain-Specific Stream Size Patterns

## Contents
- E-commerce patterns
- Banking patterns
- SaaS patterns
- Implementation checklist

---

## E-commerce Domain

**Order Aggregate**:
```
Events: 5-20
Lifetime: 1-3 years
Frequency: 1 event per few days
Stream Length: 8-60 events
Snapshotting: NOT NEEDED 
Reason: Short entity lifetime, low frequency, few state changes
```

**Shopping Cart Aggregate**:
```
Events: 5-50+ (add/remove items many times)
Lifetime: 30 minutes to 2 years (varies widely)
Frequency: 1-10 events per hour (if active)
Stream Length: 10-500+ events (depends on user behavior)
Snapshotting: RARELY (only for frequent shoppers) 
Strategy: Split abandoned vs. active carts if too long
```

**User Account Aggregate**:
```
Events: 2-10 per year (profile updates, settings changes)
Lifetime: 5-10+ years
Frequency: Very low (events measured in months apart)
Stream Length: 10-100 events
Snapshotting: NOT NEEDED 
Reason: Infrequent events, long lifetime, many separate streams
```

---

## Banking Domain

**Account Aggregate**:
```
Events: 50-500+ per year (deposits, withdrawals, fees)
Lifetime: 10-50+ years
Frequency: 0.1-2 events per day
Stream Length: 500-25,000+ events
Snapshotting: MAYBE (at 5000+) 
Strategy: Consider splitting by time period or account type
Alternative: Snapshotting might be justified for regulatory access needs
```

**Transaction Aggregate**:
```
Events: 1-5 (Requested → Processing → Settled)
Lifetime: 1-2 months (then archived)
Frequency: Single transaction, short lifecycle
Stream Length: 2-5 events
Snapshotting: NEVER NEEDED 
Reason: Tiny, immutable after completion
```

**Loan Aggregate**:
```
Events: 100-500+ (payments, rate changes, modifications)
Lifetime: 5-30 years
Frequency: 1-5 events per month
Stream Length: 1000-10,000+ events
Snapshotting: CONSIDER AT 5000 
Strategy: Split by loan product, payment period, or status
Example: ActiveLoan vs. CompletedLoan aggregates
```

---

## SaaS Domain

**Subscription Aggregate**:
```
Events: 2-20 (Created, Upgraded, Downgraded, Cancelled)
Lifetime: 1-5+ years
Frequency: 1-5 events per year
Stream Length: 5-100 events
Snapshotting: NOT NEEDED 
Reason: Low frequency, well-defined lifecycle
```

**User Workspace Aggregate**:
```
Events: 10-100+ (members added, roles changed, settings updated)
Lifetime: 2-5+ years
Frequency: 0.5-5 events per month
Stream Length: 10-500 events
Snapshotting: NOT NEEDED 
Reason: Moderate frequency, small discrete events
```

**Data Collection Aggregate**:
```
Events: 100-10,000+ (data points added, processed, analyzed)
Lifetime: 1-5+ years
Frequency: 1-1000+ events per day (varies wildly)
Stream Length: 100-50,000+ events
Snapshotting: PROBABLY 
Strategy: Split by data type, time period, or processing stage
Question: Are all these events about the same business entity?
         → If NO, split the aggregate
         → If YES, snapshotting might be needed
```

---

## Implementation Checklist

Before implementing snapshotting, answer ALL of these:

```
Design Questions:
[ ] Does this aggregate have a single business identity?
[ ] Can I split this into smaller aggregates?
[ ] Are there natural lifecycle phases (archived vs. active)?
[ ] Is event granularity appropriate (not too fine)?

Performance Questions:
[ ] Have I measured replay latency?
[ ] Does latency exceed acceptable threshold?
[ ] Is the problem snaphotting will solve?
[ ] Or is it a design problem?

Cost-Benefit Questions:
[ ] How many writes per second?
[ ] How many reads per second?
[ ] What's the read latency requirement (SLA)?
[ ] Is snapshotting complexity worth the benefit?

Operational Questions:
[ ] How will I version snapshots?
[ ] How will I test snapshot recovery?
[ ] How will I monitor snapshot health?
[ ] Can I implement this given current skills?
```

**If ANY question suggests redesign is better**: Redesign first, snapshot never.

**If ALL questions support snapshotting**: Proceed with implementation.
