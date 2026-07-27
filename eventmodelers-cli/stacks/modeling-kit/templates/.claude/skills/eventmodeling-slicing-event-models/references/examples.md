# Event Modeling Slice Examples

## Table of Contents
- [Order Management — Deriving Slices from the Timeline](#order-management--deriving-slices-from-the-timeline)
- [Dependency Notes](#dependency-notes)
- [Creating These Slices via the API](#creating-these-slices-via-the-api)
- [Checklist for Slice Definition](#checklist-for-slice-definition)

---

## Order Management — Deriving Slices from the Timeline

Given these timeline elements (found via `spec-info`):

```
COMMAND    PlaceOrder                → produces OrderPlaced
COMMAND    ConfirmOrder              → produces OrderConfirmed
COMMAND    AuthorizePayment          → produces PaymentAuthorized
READMODEL  OrderDetailView           → projects OrderPlaced, OrderConfirmed
READMODEL  PaymentStatusView         → projects PaymentAuthorized
AUTOMATION ReserveInventoryOnPayment → consumes PaymentAuthorized, issues ReserveInventory
```

The resulting slices — one per element, never combined:

```
Slice: PlaceOrder                 type: state-change
Slice: ConfirmOrder                type: state-change
Slice: AuthorizePayment            type: state-change
Slice: OrderDetailView             type: state-view
Slice: PaymentStatusView           type: state-view
Slice: ReserveInventoryOnPayment   type: automation
```

Note there is no combined "Order Management" or "Payment Processing" slice — each command, read model, and automation gets its own slice.

---

## Dependency Notes

```
OrderDetailView            ← depends on events from PlaceOrder, ConfirmOrder
PaymentStatusView          ← depends on events from AuthorizePayment
ReserveInventoryOnPayment  ← depends on events from AuthorizePayment
```

No slice depends on another slice directly — only on the events it produces.

---

## Creating These Slices via the API

```bash
curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"state-change","nodes":{"swimlane":{"title":"PlaceOrder"}}}'

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"state-view","nodes":{"swimlane":{"title":"OrderDetailView"}}}'

curl -X POST $BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/timelines/$TL/slices \
  -H "x-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"automation","nodes":{"swimlane":{"title":"ReserveInventoryOnPayment"}}}'
```

---

## Checklist for Slice Definition

```
[ ] Slice contains exactly one COMMAND, READMODEL, or AUTOMATION — never a
    COMMAND and a READMODEL together
[ ] Slice name matches the element's title exactly
[ ] Slice type matches the element type (state-change / state-view / automation)
[ ] Dependencies recorded as "depends on events from X", not "depends on slice X"
[ ] No duplicate slice created for an element that already has one
```