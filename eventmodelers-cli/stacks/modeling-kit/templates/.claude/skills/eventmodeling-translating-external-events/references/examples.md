# Translating External Events — Worked Examples

These are conceptual worked examples of the translation reasoning this skill applies — useful for understanding the reasoning, but the actual mechanics are the numbered Workflow steps in the main SKILL.md.

## 1. Identify External Event Sources

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

## 2. Analyze Technical Representation

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

## 3. Define Domain Translation Rules

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

## 4. Handle Correlation

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

## 5. Define Translation Scenarios

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

## 6. Handle Duplicates and Ordering

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

## 7. Handle Partial or Missing Information

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

## Legacy markdown structure (superseded — kept for reference only)

Older versions of this skill wrote the translation analysis as a standalone markdown document. The actual output mechanism today is placing each translated domain event on the board (see "Output Format" in the main SKILL.md) — this template is kept only so the shape of the information (what a complete translation write-up covers) stays documented somewhere.

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
