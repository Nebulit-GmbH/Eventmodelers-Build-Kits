---
name: eventmodeling-elaborating-scenarios
description: "Step 7 of Event Modeling - Elaborate scenarios using Given-When-Then format. Specify behavior of commands and views. Each spec tied to exactly one command or view. Use after defining systems and boundaries. Do not use for: architectural validation (use eventmodeling-validating-event-models) or verifying field completeness across the model (use eventmodeling-checking-completeness)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Elaborating Scenarios

> **Before doing anything else**, invoke the `connect` skill to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Then invoke the `learn-eventmodelers-api` skill to load the full API reference. Do not proceed until both skills have been loaded.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: scenario coverage depth (happy path + validation + state violations), known edge cases to include, and stakeholders available for review. Interview when coverage goals are unclear or edge cases haven't been identified.

**Interview Strategy**: Align on scenario depth and coverage strategy to avoid under-specification or excessive documentation. Identify stakeholders who can validate business rules.

### Critical Questions

When scenario coverage is uncertain:

1. **Scenario Depth & Coverage Goals** (Impact: Determines scope—happy path only vs. comprehensive coverage)
   - Question: "How comprehensive should scenario coverage be? (A) Happy path + basic validation, (B) All command variations, (C) Comprehensive including edge cases and error paths"
   - Why it matters: Affects time investment and implementation complexity; production code needs (C), design validation might use (A) or (B)
   - Follow-up triggers: If (C) → ask "How many scenarios per command is reasonable?"; if (A) → clarify MVP vs. production distinction

2. **Known Edge Cases & Business Rules** (Impact: Ensures critical scenarios aren't missed)
   - Question: "What specific edge cases or business rules are critical to test? (e.g., 'order cancellation within 24 hours', 'payment decline recovery')"
   - Why it matters: Business rules often generate overlooked scenarios; edge cases reveal missing events
   - Follow-up triggers: For each rule → ask "What scenarios demonstrate this rule? What happens when it's violated?"

3. **Testing & Automation Strategy** (Impact: Shapes scenario detail and executable format)
   - Question: "Will these scenarios be: (A) Automated tests, (B) Manual QA reference, (C) Documentation only?"
   - Why it matters: Automated tests need precise Given/When/Then; documentation can be more narrative
   - Follow-up triggers: If (A) → ask about test framework; if (B) → ask about QA process

4. **Stakeholder Review & Validation** (Impact: Determines who validates business logic correctness)
   - Question: "Who will review and validate scenarios? (A) Product Owner, (B) QA/Tester, (C) Multiple roles, (D) Engineering only?"
   - Why it matters: Multi-role review catches business logic errors; single role may miss perspective
   - Follow-up triggers: If (A) only → ask "Will PO have time for detailed review?"; if (C) → plan review workshop

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Clear scenario coverage goals (happy path + validation + state violations)
  - AND identified edge cases or known business rules to test
  - AND specified who will review/validate scenarios

Then: Skip interview, proceed directly to scenario elaboration

Else: Conduct interview
```

**Phase 1: Coverage Planning** (Questions 1-2)
- Determine depth (happy path vs. comprehensive)
- Identify critical edge cases to cover
- Establish coverage priorities

**Phase 2: Implementation & Review** (Questions 3-4)
- Decide on automation vs. documentation
- Confirm stakeholder availability
- Plan review workflow

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## 9. Scenarios (eventmodeling-elaborating-scenarios)

### Coverage Goals
[From Q1: Happy path / Comprehensive / Deep]

### Critical Edge Cases
[From Q2]
- Edge case 1: [Case] → [Why important]
- Edge case 2: [Case] → [Why important]

### Business Rules Requiring Scenarios
[From Q2]
- Rule 1: [Statement] → Success + Failure scenarios
- Rule 2: [Statement] → Success + Failure scenarios

### Testing Strategy
[From Q3: Automated / Manual / Documentation]

### Review & Validation
[From Q4: Who reviews, when, workflow]

### Key Scenario Specifications
[GWT format scenarios for critical commands and views]

---

## Validation & Completeness

### Validated
- [ ] All fields traced (completeness check)
- [ ] Events are immutable
- [ ] State projections deterministic
- [ ] Model ready for code generation

**Validation Date**: [Date]
```

Update Interview Trail:
```markdown
| 9 | eventmodeling-elaborating-scenarios |  [today] | Scenario coverage, testing strategy, edge cases |
```

At this point, EVENTMODELING.md is complete and ready for implementation!

---

## Workshop Facilitation Guide

**Context**: Scenarios are created in a collaborative workshop with multiple stakeholders. Use this approach for rapid, real-time scenario creation:

### Before the Workshop

**Participants** (required roles):
- **Product Owner/Domain Expert**: Knows business rules, priorities, edge cases
- **Developer**: Technical feasibility, implementation concerns
- **QA/Tester**: Test coverage, edge cases, error scenarios
- **Facilitator**: Keeps pace, ensures shared understanding, captures scenarios

**Setup**:
- Whiteboard or collaborative tool (Miro, Figma, etc.)
- Sticky notes or digital cards for scenarios
- Previously completed steps: Events timeline and system boundaries
- Timer for time-boxing per command/view

### During Workshop (Per Command/View)

**Rapid Cycle** (15-20 min per command):
1. **Happy Path First**: "What's the normal success case?" (Product Owner leads)
   - Facilitator writes scenario live
   - All roles review in real-time
   - Adjust based on feedback

2. **Validation Failures**: "What could go wrong with inputs?" (Developer/QA)
   - Common: invalid format, missing fields, invalid references
   - Quick scenarios, add to board

3. **State Violations**: "What if system is in wrong state?" (Domain Expert)
   - Example: "Can't confirm if already confirmed"
   - These are business rules, often overlooked

4. **Alternative Paths**: "Are there other ways this could work?" (Product Owner)
   - Different paths through the same command
   - Different outcomes based on business logic

5. **Error Handling**: "What if external systems fail?" (Developer)
   - Payment decline, inventory unavailable
   - Recovery/retry scenarios

6. **Compensation**: "Can this be undone?" (Domain Expert)
   - Cancellation, reversal, refund flows
   - Often reveal missing events

**Review Style**:
- Each scenario read aloud by facilitator
- Quick check: "Is this right?" (Everyone nods or speaks up)
- Move forward—don't perfect, iterate later
- Target: 3-5 scenarios per command, 10-20 minutes per command

### Multi-Role Review

As scenarios are written, ensure each role checks:
- **Product Owner**: "Is this the right business behavior?"
- **Developer**: "Can we implement this? Need system state? Edge cases?"
- **QA**: "Can we test this? Is it clear enough?"
- **Facilitator**: "Do we have enough detail for coding?"

### Common Workshop Mistakes to Avoid

 **Perfectionism**: Don't spend 30 minutes on one scenario. Capture and move.
 **Missing roles**: One person can't represent all perspectives.
 **Too technical**: Use domain language, not code. Adjust in implementation.
 **Incomplete givens**: "Given an order" is too vague. Specify state.
 **Unclear events**: Every scenario must show what event is produced (or why not).

### Tips for Rapid Creation

 **Use templates**: Have sticky note templates with Given/When/Then pre-printed
 **Parallel work**: Different people write different scenarios simultaneously
 **Capture edge cases**: When someone says "What if...?" → immediately capture as scenario
 **Reference past decisions**: Point to event timeline and boundary diagrams
 **Record decisions**: Why did we choose this behavior? (Helps implementers later)

## Scenario Types

**Do not reduce scenarios to a simple good-case / bad-case pair.** For each command, ask the questions below and write a scenario for every answer that the business case supports. Which types apply and how many scenarios each type generates is always determined by the domain — not by a fixed count or a static rule.

| # | Type | Question to ask |
|---|------|----------------|
| 1 | **Happy Path** | "What is the normal success case?" |
| 2 | **Validation Failure** | "What invalid or missing inputs should be rejected?" |
| 3 | **State Violation** | "What if the system is in a state that makes this command invalid?" |
| 4 | **Duplicate Action** | "What if this command is issued again after it already succeeded?" |
| 5 | **Alternative Path** | "Are there different valid outcomes depending on context?" |
| 6 | **External Failure** | "What if an external system or scheduler fails during this command?" |
| 7 | **Compensation** | "Can this be undone or reversed? What triggers the cleanup?" |

Work through each question with the domain in mind. If the answer is "that situation cannot occur in this business" then no scenario is needed for that type — but that judgment must come from the domain, not from a desire to write fewer scenarios.

## Workflow

For each command and view, write scenarios in Given-When-Then format:

### 1. Command Scenarios (Given-When-Then)
Specify command behavior:

```
Feature: Order Creation

Scenario: Create order successfully
Given a customer with ID "cust-123"
And products exist with IDs ["prod-1", "prod-2"]
And customer has valid shipping address
When the customer creates an order with items:
    | productId | quantity | unitPrice |
    | prod-1    | 2        | 50.00    |
    | prod-2    | 1        | 30.00    |
Then the order should be created with status "Draft"
And the total should be calculated as 130.00
And an "OrderCreated" event is produced with:
    | field | value |
    | orderId | {uuid} |
    | customerId | cust-123 |
    | items | [...] |
    | total | 130.00 |
    | status | Draft |

Scenario: Reject order with invalid customer
Given a customer ID "invalid-cust"
And no customer exists with that ID
When the customer tries to create an order
Then the command should be rejected
And the rejection reason is "Customer not found"
And no event is produced

Scenario: Reject order with empty items
Given a customer with ID "cust-123"
And an empty items list []
When the customer tries to create an order
Then the command should be rejected
And the rejection reason is "Order must contain items"
And no event is produced

Scenario: Reject order with invalid address
Given a customer with ID "cust-123"
And an incomplete shipping address (missing city)
When the customer tries to create an order
Then the command should be rejected
And the rejection reason is "Invalid shipping address"
And no event is produced
```

### 2. Command Scenarios - State Validation
Specify how stream state affects command:

```
Feature: Order Confirmation

Scenario: Confirm order in Draft state
Given an order "order-456" in Draft state
And OrderCreated event exists
And no OrderConfirmed event exists
When the customer confirms the order with payment method "card"
Then the order should be confirmed
And an "OrderConfirmed" event is produced with:
    | field | value |
    | orderId | order-456 |
    | paymentMethod | card |
    | confirmedAt | {timestamp} |

Scenario: Reject confirming already-confirmed order
Given an order "order-456" in Confirmed state
And OrderConfirmed event already exists
When the customer tries to confirm the order again
Then the command should be rejected
And the rejection reason is "Order already confirmed"
And no OrderConfirmed event is produced

Scenario: Reject confirming cancelled order
Given an order "order-456" in Cancelled state
And OrderCancelled event exists
When the customer tries to confirm the order
Then the command should be rejected
And the rejection reason is "Cannot confirm cancelled order"
And no event is produced
```

### 3. View Scenarios (Given-When-Then)
Specify how read models display data:

```
Feature: Order Status View

Scenario: Display order after creation
Given an OrderCreated event with:
    | field | value |
    | orderId | order-789 |
    | customerId | cust-123 |
    | items | [{...}] |
    | total | 150.00 |
When the OrderStatusView processes this event
Then the view should display:
    | field | value |
    | Order ID | order-789 |
    | Status | Draft |
    | Total | $150.00 |
    | Items | 3 products |
    | Created | {date} |

Scenario: Update status after confirmation
Given an OrderCreated event already processed
And OrderStatusView showing status "Draft"
When an OrderConfirmed event is received with:
    | field | value |
    | orderId | order-789 |
    | confirmedAt | 2024-12-31T10:00:00Z |
Then the view should update to display:
    | field | value |
    | Status | Confirmed |
    | Confirmed Date | 12/31/2024 10:00 AM |

Scenario: Accumulate payment information
Given OrderConfirmed event processed (status=Confirmed)
When a PaymentAuthorized event arrives with:
    | field | value |
    | orderId | order-789 |
    | paymentId | pay-123 |
    | authCode | AUTH-456 |
Then the view should accumulate:
    | field | value |
    | Payment ID | pay-123 |
    | Auth Code | AUTH-456 |
    | Payment Status | Authorized |
```

### 3b. List-type Read Model Scenarios
Specify expected rows and empty-list intent when the THEN readmodel is a list (`listElement: true`):

```
Feature: Product Catalog

Scenario: Products list shows all created products
Given a ProductCreated event with name "Shoes", index "0", family_id "22222..."
And a ProductCreated event with name "Clothing", index "1", family_id "33333..."
When the ProductList view processes these events
Then the list should contain:
    | name     | index | family_id |
    | Shoes    | 0     | 22222...  |
    | Clothing | 1     | 33333...  |

Scenario: Products list is empty after last item is deleted
Given a ProductDeleted event for the last remaining item
When the ProductList view processes this event
Then the list should be empty
```

### 4. Error Path Scenarios
Specify how system handles failures:

```
Feature: Payment Authorization Failure

Scenario: Handle declined payment
Given an order "order-001" in Confirmed state
And customer initiates payment
When the payment gateway declines the card
Then a PaymentFailed event is produced with:
    | field | value |
    | orderId | order-001 |
    | reason | Card declined |
    | timestamp | {now} |

Scenario: Update order view on payment failure
Given OrderStatusView shows status "Confirmed"
When PaymentFailed event arrives for order-001
Then the view should update:
    | field | value |
    | Payment Status | Failed |
    | Failure Reason | Card declined |
    | Retry Available | Yes |

Scenario: Allow retry after payment failure
Given a PaymentFailed event exists
And order status is still "Confirmed"
When customer retries payment
Then the new AuthorizePayment command is accepted
And can produce new PaymentAuthorized event
```

### 5. Compensation Scenarios
Specify rollback/cancellation flows:

```
Feature: Order Cancellation

Scenario: Cancel order in Draft state
Given an order "order-555" in Draft state
And only OrderCreated event exists
When customer cancels the order with reason "Changed mind"
Then an OrderCancelled event is produced with:
    | field | value |
    | orderId | order-555 |
    | reason | Changed mind |
    | cancelledAt | {timestamp} |

Scenario: Cannot cancel completed order
Given an order "order-555" in Delivered state
And DeliveryConfirmed event exists
When customer tries to cancel
Then the command should be rejected
And the rejection reason is "Cannot cancel delivered order"

Scenario: Trigger compensation on cancellation
Given an order in Confirmed state
And PaymentAuthorized event exists
When OrderCancelled event is produced
Then a RefundPayment command should be automatically triggered
And RefundInitiated event should follow
```

## Output Format

Present as:

````markdown
# Scenarios: [Domain Name]

## Commands

### Command: CreateOrder

**Description**: Customer creates a new order with items and shipping address.

#### Scenario 1: Successful Order Creation
```gherkin
Given a customer with ID "cust-123"
And products ["prod-1", "prod-2"] exist in catalog
And the shipping address is valid
When the customer creates an order:
  | customerId | cust-123 |
  | items | [{productId: prod-1, qty: 2}, {productId: prod-2, qty: 1}] |
  | shippingAddress | {street, city, state, zip} |
Then the command succeeds
And an "OrderCreated" event is produced with all input data
And the order status is "Draft"
```

#### Scenario 2: Reject with Invalid Customer
```gherkin
Given a customer ID "invalid" that doesn't exist
When the customer tries to create an order
Then the command is rejected
And the error is "Customer not found"
And no event is produced
```

[Continue for each scenario]

---

### Command: ConfirmOrder

**Description**: Customer confirms order and selects payment method.

#### Scenario 1: Confirm Draft Order
```gherkin
Given an order in "Draft" state
And OrderCreated event exists
When the customer confirms with paymentMethod="card"
Then an "OrderConfirmed" event is produced
And the order status becomes "Confirmed"
```

#### Scenario 2: Prevent Duplicate Confirmation
```gherkin
Given an order already in "Confirmed" state
And OrderConfirmed event already exists
When the customer tries to confirm again
Then the command is rejected
And the error is "Order already confirmed"
And no new event is produced
```

---

## Views

### View: OrderStatusView

**Description**: Real-time order status display showing accumulated event data.

#### Scenario 1: Initial Display After Creation
```gherkin
Given an OrderCreated event with id, customer, items, total, address
When the view processes this event
Then the view displays:
  - Order ID: order-123
  - Status: Draft
  - Total: $150.00
  - Items: 3 products
  - Customer: cust-456
```

#### Scenario 2: Update on Confirmation
```gherkin
Given the view displaying status="Draft"
When an OrderConfirmed event arrives
Then the view updates to:
  - Status: Confirmed
  - Confirmed At: {timestamp}
  - Payment Method: (from event)
```

#### Scenario 3: Accumulate Payment Data
```gherkin
Given status="Confirmed"
When PaymentAuthorized event arrives
Then the view shows:
  - Payment Status: Authorized
  - Auth Code: (from event)
  - Payment ID: (from event)
```

---

## Error Paths

### Scenario: Payment Decline
```gherkin
Given an order in "Confirmed" state
When payment gateway declines
Then PaymentFailed event is produced
And OrderStatusView updates to show:
  - Payment Status: Failed
  - Retry Available: true
```

---

## Compensation Flows

### Scenario: Order Cancellation with Refund
```gherkin
Given an order in "Confirmed" state
And PaymentAuthorized event exists
When OrderCancelled event is produced
Then a RefundPayment command is triggered
And RefundInitiated event follows
And inventory reservation is released
```
````

## Post Scenarios to Board

After designing all scenarios, post them to the board using the timeline/column API. Do this for every command and view that has scenarios.

### Step 1 — Identify the target timeline and column

Fetch all CHAPTER nodes to find the timeline:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER" \
  -H "x-token: $TOKEN"
```

If there is more than one chapter, ask the user which timeline to target.

For each command or view being specified, find its column: fetch the chapter node and read `meta.timelineData.columns`. Match the column to the COMMAND or READMODEL node that occupies the interaction row in that column. If the user named the slice, find the SLICE_BORDER node with that title to get its `colId`.

### Step 2 — Load valid step elements

For each target timeline, call spec-info to discover the node IDs that may appear in given/when/then:

```bash
curl -s "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/spec-info" \
  -H "x-token: $TOKEN"
# → { timelineId, elements: [{ id, title, type }] }
```

Build a lookup map: `title (lowercase) → { id, type }`. Use this to resolve scenario step names to node IDs.

### Step 3 — Resolve step IDs

For each scenario step (given/when/then items), match the step title against the spec-info lookup. If a title matches unambiguously, use that node's `id`. If a title is ambiguous or unmatched, log it and skip that step item rather than failing — the scenario can still be posted with fewer steps.

See `learn-eventmodelers-api` for the full step item format, scenario object shapes, and edge cases (SPEC_ERROR, multiple spec rows).

### Step 4 — Post all scenarios for a column in one call

Group all scenarios for the same column and POST them as an array. The SCENARIO spec node is created automatically — no pre-creation needed.

```bash
curl -s -X POST \
  "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/columns/$COL/scenarios" \
  -H "x-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[...scenario objects...]'
# → 201 { specNodeId, scenarios (all), added (count), isNewNode }
```

On `409` (duplicate title) or `400` (validation error), log the error and retry without the offending scenario. On `404`, check that the timeline and column IDs are correct.

**Rules enforced by the server (do not pre-validate — let the server reject):**
- `given`: EVENTs only
- `when`: at most one COMMAND; empty when `then` contains a READMODEL
- `then`: EVENTs only OR exactly one READMODEL — never mixed
- All step node IDs must belong to the same timeline

### Step 4b — List-type readmodel scenario fields

When `then` contains a READMODEL whose `listElement` property is `true`, add two fields **at the scenario level** (not inside `then`):

**`examples`** — one object per expected row, keyed by the readmodel's snake_case field names. Without this the spec node renders with no expected output and the scenario is unverifiable.

**`expectEmptyList: true`** — when the expected result is an empty list (e.g. after a delete). Do not leave `examples: []` without this flag — an empty array alone is ambiguous ("no data provided yet" vs. "intentionally empty").

Non-empty list scenario:
```json
{
  "id": "<uuid>",
  "title": "Products list shows created items",
  "given": [{"id":"<eventNodeId>","title":"ProductCreated","type":"EVENT"}],
  "when":  [],
  "then":  [{"id":"<readmodelNodeId>","title":"ProductList","type":"READMODEL"}],
  "examples": [
    { "name": "Shoes",    "index": "0", "family_id": "22222..." },
    { "name": "Clothing", "index": "1", "family_id": "33333..." }
  ]
}
```

Empty list scenario:
```json
{
  "id": "<uuid>",
  "title": "No products remain after deletion",
  "given": [{"id":"<eventNodeId>","title":"ProductDeleted","type":"EVENT"}],
  "when":  [],
  "then":  [{"id":"<readmodelNodeId>","title":"ProductList","type":"READMODEL"}],
  "expectEmptyList": true,
  "examples": []
}
```

### Step 5 — Report back

After posting, tell the user:
- How many scenarios were posted successfully (per command/view)
- Any scenarios skipped due to duplicate title or unresolvable step IDs
- The `specNodeId` of each spec node created or updated

---

## Quality Checklist

**Per command — all 7 scenario types considered (skip only with explicit reason):**
- [ ] **Happy Path** — normal success case written
- [ ] **Validation Failure** — invalid/missing input rejected (or marked N/A with reason)
- [ ] **State Violation** — command issued in wrong system state (or marked N/A with reason)
- [ ] **Duplicate Action** — second issuance after success handled (or marked N/A with reason)
- [ ] **Alternative Path** — different valid outcomes captured (or marked N/A with reason)
- [ ] **External Failure** — external system failure handled (or marked N/A with reason)
- [ ] **Compensation** — reversal/undo flow written (or marked N/A with reason)

**No command has only 2 scenarios unless all other types were reviewed and found inapplicable.**

**Format and posting:**
- [ ] State preconditions are explicit in Given (not just "Given an order")
- [ ] Actions are clear in When
- [ ] Outcomes are verifiable in Then (event produced or rejection with reason)
- [ ] Every view has at least one update scenario
- [ ] All scenarios posted to board spec cells via the `/scenarios` API
- [ ] **Workshop facilitation approach documented**
- [ ] **All stakeholder roles (PO, Dev, QA, Domain Expert) perspectives captured**
- [ ] **Edge cases suggested by participants captured**
- [ ] **Why behind business rules documented (not just the what)**

## Gherkin Best Practices

```
Good:
Given an order in "Draft" state
When the customer confirms the order
Then the status changes to "Confirmed"

Bad:
Given order
When stuff happens
Then it works

Good:
And an OrderConfirmed event is produced with:
    | field | value |
    | orderId | order-123 |

Bad:
And an event is produced

Good:
Then the command is rejected
And the error is "Customer not found"

Bad:
Then there's an error
```

## Scenario Organization

1. **Happy Path**: Successful execution
2. **Validation Failures**: Invalid inputs
3. **State Violations**: Wrong pre-conditions
4. **Duplicate Actions**: Already processed
5. **Alternative Paths**: Different branches
6. **Error Handling**: Failures and recovery
7. **Compensation**: Rollback and cleanup

## Key Principles

1. **One Scenario = One Test**: Each scenario is testable
2. **Explicit Preconditions**: State is clear in "Given"
3. **Clear Actions**: "When" describes user/processor action
4. **Verifiable Outcomes**: "Then" checks results
5. **Event-Centric**: Every scenario produces or updates events
6. **Business Language**: Use domain terms, not technical jargon
