---
name: eventmodeling-translating-external-events
description: "Translate external system events (webhooks, APIs, IoT) into domain events. Map technical data to business concepts. Use when integrating with external systems that emit events your domain needs to react to. Do not use for: modernizing legacy systems using the side-car pattern (use eventmodeling-integrating-legacy-systems) or designing command handlers for the translated events (use eventmodeling-designing-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Translating External Events

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

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

Document each external system and what it sends:

```
External System: Payment Gateway (Stripe)

Events received:
  - charge.succeeded
  - charge.failed
  - charge.refunded
  - charge.dispute.created

Example payload: charge.succeeded
{
  "id": "ch_1234567890",
  "amount": 15000,
  "currency": "usd",
  "customer": "cus_9876543210",
  "status": "succeeded",
  "created": 1640995200
}

External System: GPS Location Service (Google Maps)

Events received:
  - location_update
  - geofence_enter
  - geofence_exit

Example payload: geofence_exit
{
  "userId": "user-123",
  "geoFenceId": "hotel-front-entrance",
  "timestamp": 1640995200,
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

### 2. Analyze Technical Representation

Understand the raw data from external system:

```
External Event: charge.succeeded (Stripe)

Technical fields:
  - id: UUID of charge in Stripe (not meaningful to us)
  - amount: Integer cents (15000 = $150.00)
  - currency: ISO code ("usd")
  - customer: Stripe customer ID (not our customer ID)
  - status: String indicating success
  - created: Unix timestamp

Problems with using directly:
   We don't use Stripe customer IDs (we have our own customer IDs)
   Currency and amount require interpretation
   Status is one field in their model, we care about the fact it succeeded
   Stripe charge ID isn't the same as our order ID
   We need to correlate back to our Order stream
```

### 3. Define Domain Translation Rules

Map technical data to domain concepts:

```
Translation: External charge.succeeded → Domain PaymentAuthorized

Mapping rules:
  charge.id (Stripe) → paymentGatewayRef (store for reconciliation, don't use as primary)
  charge.customer (Stripe) → Look up: Which of OUR customers has this Stripe ID?
  charge.amount → paymentAmount (convert from cents)
  charge.currency → paymentCurrency
  created → timestamp
[NEED TO FIND] → orderId (Stripe doesn't tell us! This is critical—how do we know which order?)

Problem identified:
Stripe webhook comes with charge details but NOT our order ID.

Solutions:
A. Store Stripe charge ID in our Order when we initiate payment
     When webhook arrives: charge.id → Look up in OrderPaymentReference
     Find orderId → Create PaymentAuthorized event

B. Store custom metadata in Stripe charge
     When creating charge: Include our orderId in metadata
     When webhook arrives: Extract orderId from metadata

Choose A or B based on Stripe integration approach.
```

### 4. Handle Correlation

External systems often don't include your IDs. Establish correlation:

```
Pattern: Correlation via Reference Tracking

Our system flow:
  1. Order created in our system: order-123
  2. We initiate payment with Stripe:
     - Send amount, customer info
     - Receive charge ID: ch_1234567890
     - Store reference: OrderPaymentReference { orderId: order-123, stripeChargeId: ch_1234567890 }

When webhook arrives:
  1. Webhook: charge.succeeded { id: ch_1234567890, amount: 15000, ... }
  2. Look up: Find OrderPaymentReference where stripeChargeId = ch_1234567890
  3. Get orderId from reference
  4. Create PaymentAuthorized event: { orderId: order-123, amount: 150.00, ... }

Key insight: You must create the correlation bridge when initiating external action.
```

### 5. Define Translation Scenarios

Specify translation logic for each external event:

```
External Event: charge.succeeded
Trigger: Stripe webhook arrives with charge details
Precondition: OrderPaymentReference exists for this charge ID
Translation logic:
  1. Extract charge.id from webhook
  2. Look up OrderPaymentReference.orderId
  3. Validate order exists and is in Confirmed state
  4. Create domain event: PaymentAuthorized { orderId, amount, timestamp, ... }
Success: Domain event produced
Failure scenarios:
  - Charge ID not found in references → Log error, don't produce event (manual review)
  - Order not in Confirmed state → Log error, don't produce event
  - Duplicate webhook → Idempotent handling (check if event already exists)

--- External Event: geofence_exit
Trigger: Guest leaves hotel area (GPS geofence)
Precondition: Guest has opted in to location tracking
Translation logic:
  1. Extract userId and geoFenceId from webhook
  2. Validate guest is currently in hotel
  3. Check geofence_exit is "hotel-front-entrance" (not just any geofence)
  4. Create domain event: GuestLeftHotel { guestId: userId, timestamp, ... }
Success: Domain event produced
Failure scenarios:
  - Guest hasn't opted in → Don't produce event (respect privacy)
  - Guest not checked in → Don't produce event (shouldn't be in geofence)
  - Unknown geofence → Log error, don't produce event
```

### 6. Handle Duplicates and Ordering

External systems may send duplicate webhooks:

```
Problem: Stripe retries charge.succeeded webhook
Webhook 1: charge.succeeded { id: ch_123 } → Arrives at 10:00 AM
Webhook 2: charge.succeeded { id: ch_123 } → Arrives at 10:05 AM (retry)

Solution: Idempotent translation

Check before creating event:
  1. Extract external ID: ch_123
  2. Query: Does PaymentAuthorized event exist with paymentGatewayRef = ch_123?
  3. If yes: Do nothing (already processed)
  4. If no: Create event

This requires storing the external ID in the event:
PaymentAuthorized event {
    orderId: order-123,
    amount: 150.00,
    paymentGatewayRef: ch_123,  ← Store external ID for deduplication
    ...
  }
```

### 7. Handle Partial or Missing Information

External systems may not provide complete data:

```
External Event: geofence_exit

Available data:
  - userId 
  - geoFenceId 
  - timestamp 
  - latitude, longitude (raw GPS)

Missing data:
  - Guest name (not in webhook payload)
  - Reason for leaving (not tracked)
  - Expected return time (not available)

Handling strategy:
A. Translation enriches from our system:
     Domain event: GuestLeftHotel {
       guestId: userId,  ← From webhook
       timestamp: ...,   ← From webhook
       guestName: "John Smith",  ← Looked up from guest stream
       roomNumber: "502",  ← Looked up from guest stream
       geoFenceId: "front-entrance"  ← From webhook
     }

B. Some data we don't need:
     We ignore: latitude, longitude (we just care that guest left)

C. Some data we can infer:
     We can assume: Guest is now outside hotel
                    Cleaning crew can visit room
```

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

For reference, the full markdown structure is:

````markdown
# External Event Translation: [Domain Name]

## External Systems & Events

### System: [External System Name]

**Connection Type**: [Webhook/API polling/WebSocket/Streaming]

**Events Received**:
- event1_name
- event2_name
- event3_name

---

## Translation Rules

### External Event: [Event Name]

**Source System**: [System name]

**Technical Representation**:
```json
{
  "field1": "value",
  "field2": "value"
}
```

**Domain Translation**:
| External Field | Our Field | Mapping | Notes |
|---|---|---|---|
| externalId | n/a | Stored for deduplication | Reference only |
| customer | [lookup] | Look up our customer ID | Must correlate |

**Correlation Method**:
[How do we link back to our domain entities?]

**Domain Event Produced**:
- Event Name: [EventName]
- Fields: [List with sources]

**Translation Logic**:
```
1. Extract from webhook
2. Validate preconditions
3. Enrich from our system
4. Create domain event
```

**Success Scenario**:
[What success looks like]

**Failure Scenarios**:
- Scenario 1: Consequence
- Scenario 2: Consequence

**Duplicate Handling**: [Idempotent strategy]

--- [Repeat for each external event]

---

## Correlation Reference

Track how external IDs map to our domain:

| Our Entity | External System | External ID Field | Storage | Lookup |
|---|---|---|---|---|
| Order | Stripe | charge.id | OrderPaymentReference | By charge ID |
| Guest | GPS Service | userId | Guest stream | By userId |

---

## Failure & Recovery

### Webhook Arrives for Non-existent Order
**Symptom**: Stripe sends charge.succeeded for unknown order
**Cause**: Race condition or data inconsistency
**Detection**: OrderPaymentReference lookup returns nothing
**Recovery**: Log error, queue for manual review

### Duplicate Webhooks
**Symptom**: Same webhook received multiple times
**Cause**: Stripe retry mechanism or network duplication
**Detection**: Domain event already exists with same externalRef
**Recovery**: Idempotent check prevents duplicate event creation

---

## Testing Recommendations

- [ ] Test happy path: External event → Correct domain event
- [ ] Test missing correlation: External event arrives before our order created
- [ ] Test duplicate: Same webhook processed twice
- [ ] Test invalid data: Webhook with missing required fields
- [ ] Test partial data: Webhook with some fields missing
- [ ] Test ordering: Multiple webhooks arrive out of order
````

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
