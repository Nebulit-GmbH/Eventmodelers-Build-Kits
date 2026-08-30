# Identifying Outputs — Worked Examples

These are conceptual worked examples of the read-model design thinking this step applies — useful for understanding the reasoning, but the actual mechanics live in the numbered Step 5a–5i sections of the main SKILL.md (placing nodes on the board via the API), not in writing a document like this.

## Conceptual walkthrough — mapping events to a read model (Order domain)

### 1. Map Event Data to UI Screens

```
Screen: Order Status View
Displays data from events:
  orderId ← OrderCreated event
  customerId ← OrderCreated event
  items ← OrderCreated event
  total ← OrderCreated event
  status ← OrderConfirmed event (or OrderCancelled)
  confirmedAt ← OrderConfirmed event
  paymentId ← PaymentAuthorized event
  shipmentId ← OrderShipped event
  shippedAt ← OrderShipped event

This screen is a projection of these events:
  - OrderCreated
  - OrderConfirmed
  - PaymentAuthorized
  - OrderShipped
```

### 2. Define Read Models

```
ReadModel: OrderStatusView
Purpose: UI displays current order status
Events subscribed: OrderCreated, OrderConfirmed, PaymentAuthorized, OrderShipped, OrderCancelled
Data:
{
  orderId: string (from OrderCreated)
  customerId: string (from OrderCreated)
  status: enum (from events: Draft → Confirmed → Authorized → Shipped → Delivered)
  createdAt: Date (from OrderCreated)
  confirmedAt: Date (from OrderConfirmed)
  paymentId: string (from PaymentAuthorized)
  shipmentId: string (from OrderShipped)
  shippedAt: Date (from OrderShipped)
}
```

### 3. Document Event → Data Mapping

```
Event: OrderCreated
Provides to UI/Processors:
  orderId
  customerId
  items[]
  total
  shippingAddress
  createdAt

Event: OrderConfirmed
Provides to UI/Processors:
  orderId (link to stream)
  paymentMethod (user selected method)
  confirmedAt (timestamp)
  paymentId (payment system reference)

Event: PaymentAuthorized
Provides to UI/Processors:
  orderId (link to stream)
  paymentId
  authCode
  authorizedAt (timestamp)
  amount (verified amount)

Event: OrderShipped
Provides to UI/Processors:
  orderId (link to stream)
  shipmentId
  shippedAt (timestamp)
  carrier (shipping company)
  trackingNumber (for delivery tracking)
```

### 4. Create Output Catalog

```
ReadModel Catalog: Order System

1. OrderStatusReadModel
   Purpose: UI shows current order status
   Events: OrderCreated, OrderConfirmed, PaymentAuthorized, OrderShipped, OrderCancelled
   Data: orderId, status, createdAt, confirmedAt, paymentId, shipmentId
   Consumed by:
     - Order Status screen (UI)
     - Customer Dashboard (UI)
     - Order Processing Processor (decides if can ship)

2. OrderListReadModel
   Purpose: UI lists all orders for a customer
   Events: OrderCreated, OrderConfirmed, OrderCancelled
   Data: orderId, customerId, total, status, createdAt
   Consumed by:
     - Customer Order History (UI)
     - Order Search/Filter (UI)

3. PaymentStatusReadModel
   Purpose: UI shows payment status
   Events: OrderConfirmed, PaymentAuthorized, PaymentFailed
   Data: orderId, paymentId, status, authCode, failureReason, timestamp
   Consumed by:
     - Payment Status screen (UI)
     - Accounting Processor (reconciliation)

4. ShipmentTrackingReadModel
   Purpose: UI shows tracking information
   Events: OrderShipped, DeliveryConfirmed
   Data: orderId, shipmentId, trackingNumber, carrier, shippedAt, estimatedDelivery
   Consumed by:
     - Order Tracking screen (UI)
     - Customer notifications (Processor)
```

### 5. Identify Missing Data

```
Question: What if UI needs "estimated delivery date"?
Event: OrderShipped has carrier + trackingNumber
Action needed: Add estimatedDelivery to OrderShipped event
  (or compute from carrier info)

Question: What if UI needs to show "payment method" on status?
Event: OrderConfirmed has paymentMethod
Action needed: Include paymentMethod in relevant read models

Question: What if UI needs "item descriptions"?
Event: OrderCreated has items[]
But: items[] only has productId
Action needed: Enrich with product descriptions from catalog
  (via join with product service)
```

### 6. Processor Outputs

```
Processor: Inventory System
Consumes from read models:
  - Orders in "PaymentAuthorized" status
  - Items and quantities needed
Produces commands:
  - ReserveInventory

Processor: Fulfillment System
Consumes from read models:
  - Orders in "InventoryReserved" status
  - Items and quantities
  - Shipping address
Produces commands:
  - CreateShipment

Processor: Notification System
Consumes from read models:
  - OrderCreated (sends confirmation)
  - OrderConfirmed (sends receipt)
  - OrderShipped (sends tracking)
  - DeliveryConfirmed (sends thank you)
Does not produce commands (info-only)
```

## Legacy markdown-document format (superseded — kept for reference only)

Older versions of this skill wrote the read model catalog as a markdown document instead of placing nodes on the board. The actual mechanism today is the board API (Step 5a–5i in the main SKILL.md) — this template is kept only so the shape of the information (what a complete read-model catalog covers) stays documented somewhere.

```markdown
# Outputs: [Domain Name]

## Read Models Summary

| ReadModel | Purpose | Events | Consumed By |
|-----------|---------|--------|-------------|
| OrderStatus | Show order state | OrderCreated, OrderConfirmed | UI, Processor |
| OrderList | List orders | OrderCreated, OrderCancelled | UI |
| PaymentStatus | Payment info | OrderConfirmed, PaymentAuthorized | UI, Accounting |
| Shipment Tracking | Track delivery | OrderShipped, DeliveryConfirmed | UI, Notifications |

---

## Detailed Read Models

### ReadModel: OrderStatusView

**Purpose**: Order Status screen displays current order state

**Events subscribed**:
- OrderCreated
- OrderConfirmed
- PaymentAuthorized
- OrderShipped
- OrderCancelled
- DeliveryConfirmed

**Data**:
```
{
  orderId: string
  customerId: string
  status: 'Draft' | 'Confirmed' | 'Authorized' | 'Shipped' | 'Delivered' | 'Cancelled'
  items: Array<{productId, quantity, unitPrice}>
  total: number
  shippingAddress: Address

  createdAt: Date
  confirmedAt: Date
  paymentId: string
  paymentMethod: 'card' | 'transfer'
  authorizedAt: Date

  shipmentId: string
  carrier: string
  trackingNumber: string
  shippedAt: Date
  estimatedDelivery: Date
}
```

**Update Logic**:
- OrderCreated: Insert with status='Draft'
- OrderConfirmed: Update status='Confirmed'
- PaymentAuthorized: Update status='Authorized', set paymentId
- OrderShipped: Update status='Shipped', set shipmentId, carrier, trackingNumber
- DeliveryConfirmed: Update status='Delivered'
- OrderCancelled: Update status='Cancelled'

**Consumed By**:
- Order Status Screen (displays)
- Order Processing Processor (checks status)
- Notification System (sends updates)

--- [Repeat for each read model]

---

## Data Completeness Check

### Events → UI Needs

Verify all UI needs have event sources:

| UI Need | Event Source | Status |
|---------|-------------|--------|
| Order status | OrderConfirmed, OrderShipped |  |
| Tracking number | OrderShipped |  |
| Order items | OrderCreated |  |
| Estimated delivery | OrderShipped |  |
| Cancellation reason | OrderCancelled |  |

### Missing Data

Identify UI needs without event sources:
- None identified

---

## Processor Consumption

### Processors and their reads:

| Processor | Reads From | Writes Commands |
|-----------|-----------|-----------------|
| Inventory | OrderStatusView (Authorized) | ReserveInventory |
| Fulfillment | OrderStatusView (InventoryReserved) | CreateShipment |
| Notification | OrderStatusView (all) | None (info-only) |
| Accounting | PaymentStatusView | None (reporting) |
```
