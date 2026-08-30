# Brainstorming Events — Worked Examples

These are conceptual worked examples of the reasoning this skill applies — useful for understanding the shape of a complete answer, but the actual mechanics are the numbered Workflow steps and board-placement rules in the main SKILL.md.

## Role Catalog (E-commerce domain)

A full worked Role Catalog, illustrating the level of detail expected for each human role and system actor (name, description, key actions, permission boundary; triggers and communication mechanism for system actors):

```text
## Role Catalog

### Human Roles

1. **Customer** - Description: End user who browses, purchases, and tracks orders
   - Key actions: Create order, confirm order, cancel order, submit review
   - Cannot: Manage inventory, process refunds, respond to reviews as seller

2. **Seller** - Description: Merchant who lists products and fulfills orders
   - Key actions: List product, confirm stock, respond to reviews, update pricing
   - Cannot: Place orders, approve own reviews, process payments

3. **Support Agent** - Description: Internal staff handling escalations and manual overrides
   - Key actions: Override order status, issue refunds, flag reviews
   - Cannot: Place orders on behalf of customers (unless impersonating)

### System Actors

1. **Payment Gateway** (external)
   - Triggers: Payment authorization, payment failure, refund confirmation
   - Communication: Webhooks

2. **Inventory System** (internal)
   - Triggers: Reserve inventory, release reservation
   - Communication: Event-driven
```
