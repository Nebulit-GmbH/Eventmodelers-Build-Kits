---
name: eventmodeling-integrating-legacy-systems
description: "Apply Event Modeling to legacy systems using side-car pattern. Freeze old system, extract events, build new features without rewriting. Use when modernizing legacy applications. Do not use for: greenfield systems without existing legacy constraints (use eventmodeling-orchestrating-event-modeling) or translating inbound events from external APIs (use eventmodeling-translating-external-events)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Integrating Legacy Systems

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Critical - Not Optional)

**When to Interview**: This step is high-risk and often initiated prematurely. Always interview unless the user has explicit organizational buy-in for a freeze agreement AND has already assessed legacy system state and extraction feasibility.

**Interview Strategy**: Assess organizational readiness, understand legacy system constraints, and validate event extraction feasibility before designing the side-car. Poor planning here leads to costly integration failures.

### Critical Questions

Always conduct this interview unless all context is provided:

1. **Legacy System State & Documentation** (Impact: Determines how much reverse-engineering is needed; affects timeline dramatically)
   - Question: "Tell me about the legacy system: (A) Technology stack, (B) Age/last major update, (C) Database size/complexity, (D) Current users/traffic, (E) Known documentation or audit trails?"
   - Why it matters: Undocumented systems require exploration; modern systems may have better audit logs; scaling affects extraction approach
   - Follow-up triggers: If documentation is incomplete → ask for at least data schema; if no audit trail → ask about update_at timestamps; if very large → ask about partitioning strategy

2. **Organizational Freeze Agreement** (Impact: Most critical—determines if side-car is even feasible)
   - Question: "Has business leadership agreed to FREEZE the legacy system? Specifically: (A) No new features in legacy, (B) Only bug fixes permitted, (C) No schema changes?"
   - Why it matters: Without explicit freeze, teams keep modifying legacy → events become stale → side-car becomes incorrect → project fails
   - Follow-up triggers: If not frozen → ask "What would get stakeholder buy-in for freeze?"; if partially frozen → clarify exact boundaries

3. **Event Extraction Feasibility** (Impact: Determines if extraction is reverse-engineer-able or if it requires external data)
   - Question: "For event extraction: (A) Can you query the legacy database directly, (B) Is there an audit log/change tracking, (C) Will you use CDC (Change Data Capture), (D) Can you modify the legacy system for hooks?"
   - Why it matters: Direct query extraction is fastest but may be imperfect; CDC is cleaner but requires infrastructure; modified legacy defeats freeze
   - Follow-up triggers: If (A) → ask about query access and schema understanding; if (B) → ask format of audit log; if (C) → discuss CDC tool selection

4. **Integration Timeline & Staffing** (Impact: Determines realistic phase durations; affects approach choices)
   - Question: "What's your timeline? (A) Need new features within 3 months (aggressive), (B) 6-12 months (standard), (C) 18+ months (gradual). And team capacity: (A) Full team on side-car, (B) Part of team, (C) Skeleton crew?"
   - Why it matters: Aggressive timeline might skip historical extraction, reducing risk surface; team size affects whether extraction and side-car can happen in parallel
   - Follow-up triggers: If aggressive → ask "What's the MVP scope?"; if skeleton crew → ask "Can you backfill?"

5. **Risk Tolerance & Failure Recovery** (Impact: Determines safety margins and validation rigor)
   - Question: "How critical is the system? (A) Revenue-critical/zero downtime tolerance, (B) Important but can tolerate brief outages, (C) Low-risk migration path acceptable?"
   - Why it matters: Affects how much validation you need before user cutover; determines rollback strategy importance
   - Follow-up triggers: If (A) → propose comprehensive testing and gradual rollout; if (C) → can be more aggressive

### Interview Flow

**No Conditional Skip**: This interview is critical. Even if some context is provided, confirm all five dimensions.

**Phase 1: System Understanding** (Question 1)
- Document legacy system constraints
- Assess documentation gaps
- Plan information gathering

**Phase 2: Organizational Alignment** (Question 2)  CRITICAL
- Confirm freeze agreement (required)
- Document boundaries
- Identify stakeholders

**Phase 3: Technical Feasibility** (Question 3)
- Validate extraction approach
- Identify data challenges
- Plan extraction strategy

**Phase 4: Timeline & Staffing** (Questions 4-5)
- Set realistic phases
- Identify team structure
- Plan rollout phases

### Capturing Interview Findings

**REQUIRED**: Document findings in detail before proceeding:

```markdown
## Interview Findings: Legacy System Integration

**System Overview**:
- Name: [System name]
- Age: [X years]
- Tech: [Stack]
- Scale: [Users/Data size]
- Documentation: [State]

**Freeze Agreement** CRITICAL
- Status: [Agreed / Pending / Blocked]
- Boundaries: [What's frozen, what's allowed]
- Stakeholders signed off: [Yes/No - names if yes]

**Event Extraction Approach**:
- Method: [Direct query / CDC / Audit log / Hooks]
- Feasibility: [High / Medium / Low]
- Challenges: [List specific data challenges]

**Timeline & Staffing**:
- Target completion: [Date]
- Phase 1 duration: [Months]
- Team capacity: [% allocated to project]

**Risk Assessment**:
- Criticality: [High / Medium / Low]
- Acceptable downtime: [None / Minutes / Hours]
- Rollback strategy: [How to recover if side-car fails]

**Blockers or Concerns**:
- [Any showstoppers identified]
- [Questions for stakeholders]

**Green Light Status**:
- [ ] Freeze agreement obtained (REQUIRED)
- [ ] Extraction approach validated (REQUIRED)
- [ ] Team staffing confirmed (REQUIRED)
- [ ] Risk mitigation plan accepted (REQUIRED)

RECOMMENDATION: [Proceed with side-car / Resolve blockers first / Not recommended at this time - explain why]
```

**CRITICAL**: Write findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Append this section (place it in "Additional Steps" or create new section if legacy integration is primary):

```markdown
## Legacy System Integration (eventmodeling-integrating-legacy-systems)

### System Overview
[From Q1]
- Name: [System name]
- Age: [X years]
- Tech: [Stack]
- Scale: [Users/Data size]

### Freeze Agreement  CRITICAL
[From Q2]
- Status: [Agreed / Pending / Blocked]
- Boundaries: [What's frozen]
- Stakeholders: [Signed off: Yes/No]

### Event Extraction Approach
[From Q3]
- Method: [Direct query / CDC / Audit log / Hooks]
- Feasibility: [High / Medium / Low]
- Challenges: [Data challenges]

### Timeline & Staffing
[From Q4 & Q5]
- Target: [Date]
- Criticality: [High / Medium / Low]
- Rollback Strategy: [How to recover]

### Green Light Checklist
- [ ] Freeze agreement obtained (REQUIRED)
- [ ] Extraction approach validated (REQUIRED)
- [ ] Team staffing confirmed (REQUIRED)
- [ ] Risk mitigation accepted (REQUIRED)

**RECOMMENDATION**: [Proceed / Resolve blockers / Not recommended - why]
```

Update Interview Trail with integration-specific findings.

This section is the risk management document for high-risk integrations.

---

## The Side-Car Pattern

Instead of rewriting the legacy system, build new features alongside it:

```text
Traditional Approach (Risky):
Legacy System → Rewrite everything from scratch → New System
Problem: Risk of losing functionality, expensive, long timeline

Side-Car Approach (Safe):
  
   Legacy System (Frozen - no new changes)         
   - Still handles existing features              
   - Still processes existing users               
   - No modifications, no new bugs                 
  
               
               > Database (Event Source)
                    Query existing data
                    Extract domain events
               
               > Event Store (New)
                    Captured events
                    New event source of truth
               
  
   Side-Car System (New Event-Modeled Features) 
   - New functionality using events             
   - New UI/APIs                                
   - Runs in parallel with legacy               
                                                
   Contains:                                    
     Event Store (primary source of truth)   
     Commands/Handlers                       
     Read Models                             
     User-facing UIs/APIs                    
  

Result: Legacy system frozen, new features built safely alongside.
```

## Workflow

### 1. Analyze the Legacy System

Document what the legacy system does:

```text
Legacy System: Order Management (10-year-old monolith)

Current capabilities:
   Create orders
   Confirm orders
   Track shipments
   Process refunds
   Generate invoices

Known issues:
   No audit trail
   Hard to modify order status
   Performance degrades with large datasets
   No clear separation of concerns
   Tightly coupled to specific customer

Technology:
  - Database: MySQL (20+ GB)
  - Code: Monolithic Rails application
  - API: XML-based SOAP
  - Users: 500+ directly using legacy UI

Cost of rewrite:
  - Effort: 6-12 months
  - Risk: High (functionality gaps)
  - Cost: $500k+
```

### 2. Define the Freeze

Establish what won't change in the legacy system:

```text
Freeze Agreement with Business

We will NOT change:
   Legacy UI (users continue using it)
   Legacy database schema
   Legacy business logic
   Legacy APIs

We WILL do:
   Maintain legacy system (bug fixes, support)
   Extract events from legacy data
   Build new features in side-car
   Gradually migrate users to new features

Benefits:
   Zero risk to existing operations
   Can start immediately (no design cycle)
   Old users continue with familiar UI
   New users get modern features
   Can integrate both systems gradually

Timeline:
Year 1: Side-car handles new functionality
Year 2-3: Gradually migrate users
Year 3-4: Phase out legacy system
```

### 3. Extract Domain Events from Legacy Data

The legacy database is your event source:

```text
Legacy Database Schema:

Orders table:
  id, customer_id, status, created_at, updated_at, items_json, total, ...

Payments table:
  id, order_id, amount, status, gateway_ref, created_at, ...

Shipments table:
  id, order_id, carrier, tracking_num, delivered_at, created_at, ...

Event Extraction Strategy:

For Orders table:
When status = 'draft' and record exists
    → Extract: OrderCreated event (created_at, items_json, customer_id, ...)

When status = 'confirmed' and previous was 'draft'
    → Extract: OrderConfirmed event

When status = 'shipped' and previous was 'confirmed'
    → Extract: OrderShipped event

When status = 'cancelled'
    → Extract: OrderCancelled event

For Payments table:
When status = 'authorized'
    → Extract: PaymentAuthorized event (amount, gateway_ref, ...)

When status = 'failed'
    → Extract: PaymentFailed event

For Shipments table:
When delivered_at is populated
    → Extract: DeliveryConfirmed event

Key insight: Legacy tables contain the data that represents events that happened.
We reverse-engineer: State changes → Events.
```

### 4. Build Event Capture Pipeline

Create a process to extract events:

```text
Option A: One-time Historical Extraction (Catch-up)

Script:
  1. Query legacy Orders: SELECT * WHERE id > last_extracted_id
  2. For each record, reverse-engineer what events happened
  3. Create events in new Event Store
  4. Continue polling for changes

Process:
  order_id=123, status=confirmed, updated_at=2024-01-15
    → Determine: OrderCreated happened at created_at
    → Determine: OrderConfirmed happened at updated_at
    → Persist: { OrderCreated, OrderConfirmed } to Event Store

--- Option B: Real-time Sync (Ongoing)

Trigger on legacy writes:
  1. When legacy system creates/updates record
  2. Database trigger OR Change Data Capture (CDC)
  3. Event generated and sent to new system
  4. Both systems stay in sync

Benefits:
  - Zero delay between legacy action and event capture
  - Can serve new features in real-time
  - Cleaner integration

--- Option C: Hybrid (Start with historical, add real-time)

Year 1:
  - Historical extract existing 10 years of orders
  - New events captured in real-time

Advantage: Smooth onboarding, future-proof
```

### 5. Build the Side-Car System

Create new Event-Modeled system alongside legacy:

```text
New Side-Car System Architecture:


 Event Store (Source of Truth for new features)
 - OrderCreated                               
 - OrderConfirmed                             
 - PaymentAuthorized                          
 - OrderShipped                               
 - DeliveryConfirmed                          
 - CustomerCreated (new feature)
 - ReturnRequested (new feature)

         
         > Handlers (Process events)
             PaymentProcessor
             InventoryProcessor
             NotificationProcessor
         
         > Read Models (Projections)
             OrderStatusView
             CustomerDashboard (new!)
             ReturnStatusView (new!)
         
         > APIs & UIs (New user-facing)
              REST API
              GraphQL endpoint
              New web UI
              Mobile app
```

### 6. Handle Y-Valve User Traffic

Gradually redirect users from legacy to new:

```text
Phase 1: New features only in side-car
User action → Legacy system handles

Phase 2: Read model shown alongside legacy
User views → Legacy UI + New dashboards

Phase 3: New features accessible, legacy still available
User can: Use legacy OR new features
Gradual migration as users opt-in

Phase 4: Deprecation period
New features required
Legacy features deprecated
Legacy system in read-only mode

--- Y-Valve Pattern (Traffic Routing):

User Request
      
       Is this a NEW feature? → Route to Side-Car system
      
       Is user opted-in to new UI? → Route to Side-Car system
      
       Default → Route to Legacy system

Example code:
  if (isNewFeature(request)) {
    return sideCarSystem.handle(request);
  } else if (user.preferNewUI) {
    return sideCarSystem.handle(request);
  } else {
    return legacySystem.handle(request);
  }
```

### 7. Develop New Features in Side-Car

Use Event Modeling for new functionality:

```text
New Feature: Order Returns & Refunds

Legacy system has: Nothing (returns handled via email/phone)
New side-car feature: Self-service return management

Event Model for Returns:
Commands:
    - RequestReturn (from customer)
    - ApproveReturn (from support agent)
    - ProcessRefund (from payment system)

Events:
    - ReturnRequested
    - ReturnApproved
    - RefundInitiated
    - RefundCompleted

Views:
    - ReturnStatusView (by order)
    - ReturnQueueView (pending approvals)
    - RefundHistoryView (completed refunds)

Benefits:
   Built with modern Event Modeling patterns
   Clear contracts
   Easy to test
   Scalable architecture
   No need to modify legacy code
```

## Output Format

Present as:

```markdown
# Legacy System Integration: [Organization Name]

## Current Legacy System

**System Name**: [Name]
**Age**: [Years]
**Technology**: [Tech stack]
**Users**: [Count]
**Database Size**: [Size]

**Current Capabilities**:
- [Feature 1]
- [Feature 2]

**Known Issues**:
- [Issue 1]
- [Issue 2]

**Rewrite Impact**:
- Effort: [Months/Years]
- Risk: [Low/Medium/High]
- Cost: [Estimate]

---

## The Freeze Agreement

**What we won't change**:
- [Legacy UI]
- [Legacy database]
- [Legacy APIs]

**What we will do**:
- [Maintain legacy]
- [Extract events]
- [Build new features]

**Timeline**:
- [Phase 1]
- [Phase 2]
- [Phase 3]

---

## Event Extraction Strategy

### Source: [Legacy Table/System]

**Data available**:
- [Field 1]
- [Field 2]

**Events extracted**:
- [Event 1] when [condition]
- [Event 2] when [condition]

**Extraction logic**:
[Reverse-engineering approach]

---

## Side-Car System Architecture

### Events Captured from Legacy
- OrderCreated
- OrderConfirmed
- [Other events...]

### Events Generated by Side-Car
- CustomerCreated (new feature)
- ReviewSubmitted (new feature)
- [Other new events...]

### New Features Built
- [Feature 1]: Commands → Handlers → Events → Views
- [Feature 2]: Commands → Handlers → Events → Views

---

## User Migration Plan

### Phase 1: Read-Only Views
**Timeline**: [Duration]
**Users**: [Gradual rollout]
**Change**: New dashboards available alongside legacy

### Phase 2: New Features
**Timeline**: [Duration]
**Users**: [% of user base]
**Change**: New functionality accessible, legacy still primary

### Phase 3: Preference Switch
**Timeline**: [Duration]
**Users**: [Opt-in]
**Change**: Users choose new UI

### Phase 4: Deprecation
**Timeline**: [Duration]
**Change**: Legacy system read-only

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Data inconsistency | Event capture validation |
| User confusion | Gradual rollout, clear messaging |
| Operational overhead | Automated monitoring, alerts |
| Performance | Side-car scales independently |

```

## Quality Checklist

- [ ] Legacy system freeze agreement documented
- [ ] Freeze agreement signed by business stakeholders
- [ ] Event extraction strategy defined for all legacy data
- [ ] All legacy tables mapped to extractable events
- [ ] Event capture pipeline designed
- [ ] Side-car system architecture defined
- [ ] New features scoped clearly
- [ ] User migration plan documented
- [ ] Y-valve routing logic designed
- [ ] Parallel operation testing plan
- [ ] Deprecation timeline agreed
- [ ] Rollback plan in place

## Common Integration Patterns

### Pattern 1: Read Models from Legacy
```text
Legacy Database → Query → Extract state → Create Read Model for side-car
Benefit: New UI shows unified data (legacy + new)
```

### Pattern 2: Event Stream from Audit Logs
```text
Legacy audit log (if available) → Parse → Extract events → Event Store
Benefit: Complete history, less guesswork
```

### Pattern 3: Scheduled Sync
```text
Every N minutes → Query legacy changes → Generate events → Event Store
Benefit: Simple to implement, eventual consistency
```

### Pattern 4: Mirror-Write via Integration Boundary (Use with Caution)
```text
Default: Avoid dual-write. Keep side-car-only and sync via legacy events.

Exception: Dual-write is allowed only with an approved freeze exception.

Required controls when dual-write is approved:
- Route all writes through a controlled integration boundary (not direct DB access)
- Make every write idempotent (safe to replay on retry or failure)
- Add a reconciliation check and a documented rollback plan
- Document the owner, the sunset date, and the freeze exception approval

Without these controls: keep side-car-only.
```

## Key Principles

1. **Freeze First**: Establish clear freeze agreement before starting
2. **No Rewrites**: Side-car builds NEW features, doesn't duplicate legacy
3. **Gradual Migration**: Don't force everyone at once
4. **Dual Operation**: Both systems run in parallel indefinitely (your timeline)
5. **Clear Ownership**: Legacy team maintains legacy, side-car team owns new
6. **Event-Driven**: Use events as integration point
7. **User Choice**: Where possible, let users choose when to migrate

## When Side-Car Is Right

 **Use side-car when**:
- Legacy system works but is hard to modify
- Business needs new features quickly
- Rewrite would take 6+ months
- High risk of rewrite failure
- Users are comfortable with both systems
- Clear separation of old vs. new features

 **Don't use side-car when**:
- Legacy system is broken and needs fixes
- Complete integration required (tight coupling)
- Users only want one unified system
- Legacy holds critical IP that can't be replicated

## Anti-Patterns to Avoid

 **Hybrid approach**: Trying to modify legacy AND build side-car (confusion)
 **Forced unification**: Requiring all users to switch at once (disruption)
 **Incomplete event extraction**: Missing important legacy data in events
 **Tight coupling**: Side-car depends on legacy database directly (defeats purpose)
 **No clear separation**: Users don't know which system they're using (confusion)
