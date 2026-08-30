# Elaborating Scenarios — Worked Examples

Full worked Given-When-Then examples for each scenario category, all drawn from one Order/Payment domain so the shapes are easy to compare. The main SKILL.md keeps one compact example per category — this file has the complete set.

## 1. Command Scenarios (Given-When-Then)

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

## 2. Command Scenarios — State Validation

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

## 3. View Scenarios (Given-When-Then)

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

## 3b. List-type Read Model Scenarios

Expected rows and empty-list intent when the THEN readmodel is a list (`listElement: true`):

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

## 4. Error Path Scenarios

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

## 5. Compensation Scenarios

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
