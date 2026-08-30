# Identifying Inputs — Worked Examples

These are conceptual worked examples (Order/Payment domain) illustrating the command-identification reasoning this step applies — useful for understanding the reasoning, but the actual mechanics live in the numbered Workflow sub-steps of the main SKILL.md (placing COMMAND nodes on the board via the API), not in writing a document like this.

## 1. Extract Commands from UI Actions

```text
Storyboard: Order Creation Screen
User action: Click "Create Order" button
  ↓
Command: CreateOrder
Input data from form:
    - customerId
    - items[] (product selections + quantities)
    - shippingAddress
Validation:
    - customerId must exist
    - items must not be empty
    - quantities must be > 0
Produces event: OrderCreated
```

## 2. Identify Processor Triggers

```text
Processor trigger: Payment gateway webhook received
  ↓
Command: AuthorizePayment (from Processor, not UI)
Input data from webhook:
    - orderId
    - paymentId
    - authorizationCode
Validation:
    - orderId must exist and be in Confirmed state
    - authorizationCode must be valid
Produces event: PaymentAuthorized
```

## 2b. Understand the Processor "Todo List" Pattern

```text
Event Stream (Domain events):
PaymentAuthorized → triggers Inventory system

Processor: InventoryReserver

Todo List:
When PaymentAuthorized event arrives:
    1. Add item to todo: "Reserve inventory for order-123"

Processor Logic (continuously):
FOR EACH todo item IN todo_list:
    - Check if inventory available
    - If yes: Reserve inventory, produce InventoryReserved event, mark done
    - If no: Produce InventoryFailed event, mark failed
    - If error: Keep in todo for retry

Example:
Event: PaymentAuthorized(orderId=order-123, items=[{prodId: P1, qty: 2}])
    ↓
Todo added: Reserve P1 qty 2
    ↓
Processor checks: P1 has 5 available, need 2 
    ↓
Action: Reserve 2 units
    ↓
Event produced: InventoryReserved(orderId=order-123, reserved=[...])
    ↓
Todo marked done
```

## 2c. Document Processor Automation (Gears Symbol)

```text
Command Catalog with Role Attribution (from Role Catalog):

UI-Issued Commands (attributed to specific human roles):
  1. CreateOrder (Order Entry screen) [ Customer]
  2. ConfirmOrder (Confirmation screen) [ Customer]
  3. CancelOrder (Status screen) [ Customer]
  4. RequestReturn (Order page) [ Customer]
  5. OverrideOrderStatus (Admin panel) [ Support Agent]

Processor-Issued Commands (attributed to system actors):
  6. AuthorizePayment (Payment gateway webhook) [ Payment Gateway]
  7. ReserveInventory (Triggered by PaymentAuthorized) [ Inventory System]
  8. CreateShipment (Triggered by InventoryReserved) [ Fulfillment System]
  9. NotifyCustomer (Triggered by multiple events) [ Notification Service]
```

## 3. Document Command Specifics

```text
Command: ConfirmOrder
Source: UI (user clicks button)
Input:
    orderId: string (from URL/context)
    paymentMethod: enum ('card' | 'transfer')
    [paymentDetails]: depends on method

Validation rules:
    - Order must exist
    - Order must be in Draft state
    - Payment method must be supported
    - Funds must be available (pre-check)

Preconditions (from stream state):
    - OrderCreated event exists
    - No ConfirmOrder previously processed

Success result: OrderConfirmed event

Failure results:
    - "Order not found" → Command rejected, no event
    - "Order already confirmed" → Command rejected, no event
    - "Payment method not supported" → Command rejected, no event
```

## 4. Create Command Catalog

```text
Command Catalog: Order System

### UI-Issued Commands

1. CreateOrder
   Source: User (Order Entry screen)
   Input: customerId, items[], shippingAddress
   Produces: OrderCreated event

2. ConfirmOrder
   Source: User (Confirmation screen)
   Input: orderId, paymentMethod
   Produces: OrderConfirmed event

3. CancelOrder
   Source: User (Status screen)
   Input: orderId, reason
   Produces: OrderCancelled event

### Processor-Issued Commands

4. AuthorizePayment
   Source: Payment Processor (webhook)
   Input: orderId, paymentId, authCode
   Produces: PaymentAuthorized event

5. FailPayment
   Source: Payment Processor (webhook)
   Input: orderId, paymentId, reason
   Produces: PaymentFailed event

6. ReserveInventory
   Source: Inventory Processor (triggered by PaymentAuthorized)
   Input: orderId, items[]
   Produces: InventoryReserved event

7. CreateShipment
   Source: Fulfillment Processor (triggered by InventoryReserved)
   Input: orderId, items[]
   Produces: OrderShipped event
```

## 5. Map Data Sources

```text
Command: ConfirmOrder

Data origin matrix:
  orderId
    ↑ Source: UI context (from OrderCreated, displayed to user)
    ↑ Captured: Hidden in URL or session
    ↑ Validation: Must match Order from stream

  paymentMethod
    ↑ Source: UI form selection
    ↑ Captured: User selects checkbox/radio
    ↑ Validation: Must be in allowed list

[paymentDetails] (conditional)
    ↑ Source: Depends on paymentMethod
    ↑ For 'card': Card number, CVV, expiry (from payment form)
    ↑ For 'transfer': Bank account, routing number (from form)
    ↑ Validation: Format and validity checks
```

## 6. Identify Implicit Context

```text
Command: ShipOrder
Explicit input (from UI/Processor):
    orderId
    shipmentId (from fulfillment system)

Implicit context (from stream state):
    Order must exist
    Order must be in InventoryReserved state
    Payment must be authorized (from PaymentAuthorized event)
    Inventory must be reserved (from InventoryReserved event)

These implicit checks use stream state:
    currentState.orderId === orderId 
    currentState.status === 'InventoryReserved' 
    currentState.paymentId exists 
    currentState.shipmentId can be set 
```

## Legacy markdown-document format (superseded — kept for reference only)

Older versions of this skill wrote the command catalog as a markdown document instead of placing nodes on the board. The actual mechanism today is the board API (the "Output Format" and "Creating a COMMAND node with fields" sections in the main SKILL.md) — this template is kept only so the shape of the information (what a complete command catalog covers) stays documented somewhere.

```markdown
# Inputs: [Domain Name]

## Commands Summary

| Command | Role/Actor | Source | Trigger | Input | Event |
|---------|------------|--------|---------|-------|-------|
| CreateOrder | Customer | UI | User action | customerId, items, address | OrderCreated |
| ConfirmOrder | Customer | UI | User action | orderId, paymentMethod | OrderConfirmed |
| CancelOrder | Customer | UI | User action | orderId, reason | OrderCancelled |
| AuthorizePayment | Payment Gateway | Processor | Webhook | orderId, paymentId | PaymentAuthorized |
| ReserveInventory | Inventory System | Processor | PaymentAuthorized event | orderId, items | InventoryReserved |
| ShipOrder | Fulfillment System | Processor | InventoryReserved event | orderId, shipmentId | OrderShipped |

---

## Detailed Commands

### Command: CreateOrder

**Source**: User (Order Entry screen)

**Input Data**:
- customerId: string
- items: Array<{productId: string, quantity: number}>
- shippingAddress: {street, city, state, zip}

**Validation**:
- customerId must exist in system
- items array must not be empty
- quantities must be > 0
- address fields must be non-empty

**Preconditions** (from stream state):
- Stream Order:X does not exist yet

**Success**: Produces OrderCreated event

**Failure**: Command rejected, no event
- "Customer not found"
- "Items invalid"
- "Address incomplete"

--- [Repeat for each command]

---

## Data Completeness Check

### Data Input → Event

Verify every command input becomes event data:

| Command Input | Event Data | Status |
|---------------|-----------|--------|
| customerId | orderId |  Stored in OrderCreated |
| items | items |  Stored in OrderCreated |
| shippingAddress | shippingAddress |  Stored in OrderCreated |

### Missing Data

Document any input that doesn't make it to events:
- None identified 

---

## Processor Commands

Document all processor-triggered commands:
[List each with source system and trigger condition]
```
