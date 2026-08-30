# Storyboarding Events — Worked Examples

These are conceptual worked examples (Order domain) illustrating the storyboard-design reasoning this step applies — useful for understanding the reasoning, but the actual mechanics live in the "Board Integration", "Mandatory Field Definitions", "Mandatory Screen Rendering", and "Timeline Placement Rules" sections of the main SKILL.md (rendering and placing screen nodes via the API), not in writing a document like this.

## 1. Identify UI Screens/Views — mockup example

```
Screen 1: Order Creation Form

 Place Your Order                

                                 
 Customer ID: [____________]     
                                 
 Items:                          
Product 1  Qty: [_]  Price: $_
Product 2  Qty: [_]  Price: $_
Product 3  Qty: [_]  Price: $_
                                 
 Total: $___                     
                                 
 Shipping Address:               
 [_____________________]         
 [_____________________]         
                                 
 [ Create Order ]                


Trigger: CreateOrder command
Result Events: OrderCreated
Data captured from UI:
  - customerId
  - items (products + quantities)
  - total
  - shippingAddress
```

## 2. Show State Transitions Between Screens — worked example

```
Screen 2: Order Confirmation
(After OrderCreated event)


 Order Confirmation              

                                 
 Order ID: #12345                
 Status: Draft                   
                                 
 Items: 3 products               
 Total: $150.00                  
                                 
 Shipping: 123 Main St           
                                 
 Payment Options:                
Credit Card                   
Bank Transfer                 
                                 
 [ Confirm Order ]               


Trigger: ConfirmOrder command
Result Events: OrderConfirmed
Data from UI:
  - orderId (from OrderCreated)
  - paymentMethod
```

## 3. Document All Data Fields — worked example

```
Screen: Order Status View

 Your Order Status               

 Order ID: #12345                 (from OrderCreated)
 Status: Confirmed               (from OrderConfirmed)
 Confirmed at: 2024-12-31 10:00   (from OrderConfirmed)
                                 
 Payment: Authorized             (from PaymentAuthorized)
 Auth Code: AUTH-789              (from PaymentAuthorized)
                                 
 Inventory: Reserved             (from InventoryReserved)
 Expected Ship: 2025-01-02        (from InventoryReserved)
                                 
 Shipped: Pending                 (awaiting OrderShipped)
 Tracking: -- (waiting for shipment)


Fields and their origins:
  orderId → OrderCreated event
  status → OrderConfirmed event
  confirmedAt → OrderConfirmed event
  paymentStatus → PaymentAuthorized event
  authCode → PaymentAuthorized event
  inventoryStatus → InventoryReserved event
  expectedShip → InventoryReserved event
  tracking → OrderShipped event (when available)
```

## 4. Show Data Flow Through Screens — worked example

```
Order Entry UI
   (user inputs)
   customerId
   items[]
   total
   shippingAddress
      ↓
      Command: CreateOrder
      ↓
      Event: OrderCreated
      ↓
      Order Status UI (displays)
       orderId (from event)
       items (from event)
       total (from event)
       shippingAddress (from event)
```

## 5. Organize Screens by Swimlane — worked example

```
Swimlane: Customer (Human Role)
   Screen 1: Order Entry Form
   Screen 2: Order Confirmation
   Screen 3: Order Status View
   Screen 4: Tracking View

Swimlane: Seller (Human Role)
   Screen 1: Order Fulfillment Dashboard
   Screen 2: Review Response Form
   Screen 3: Product Management

Swimlane: Support Agent (Human Role)
   Screen 1: Escalation Queue
   Screen 2: Manual Override Panel

Swimlane: Payment Processor (System Actor)
   Screen 1: Payment Verification (automated)
   Screen 2: Authorization Confirmation

Swimlane: Inventory System (System Actor)
   Screen 1: Reservation Todo List (internal)
   Screen 2: Availability Check

Swimlane: Fulfillment System (System Actor)
   Screen 1: Shipment Creation Todo
   Screen 2: Shipping Confirmation
```

## 6. Show Processor "Todo List" Pattern — worked example

```
Processor: InventoryReserver

Internal "Todo List" (based on received events):

 Inventory Reservation Todos     

                                 
Order-123: Reserve 2x Prod-1  (triggered by PaymentAuthorized)
Order-124: Reserve 3x Prod-2  (triggered by PaymentAuthorized)
Order-125: Reserve 1x Prod-3  (triggered by PaymentAuthorized)
                                 
 Processor checks todo items:    
 For each: Check availability    
          If available:  Mark done
          Reserve inventory      
          Produce event          
                                 


This todo list is driven by:
Events received → Items added to todo
Processor logic → Items processed
Success → InventoryReserved event produced + todo marked done
Failure → InventoryFailed event produced + todo marked failed
```

## Output Format — full worked example

```markdown
# Storyboard: [Domain Name]

## Swimlane Organization (from Role Catalog)

### Human Role Swimlanes

#### Customer Swimlane
- Screen 1: Order Entry Form
- Screen 2: Order Confirmation
- Screen 3: Order Status View

#### [Other Human Role Swimlanes — one per role in the catalog]

### System Actor Swimlanes

_(Narrative grouping only — these are not physical board lanes. Every automation below renders in the chapter's shared default actor lane; see "Placing Automations".)_

#### Payment Processor Swimlane
- Screen 1: Payment Verification (automated)
- [Shows what UI/views the processor interacts with]

#### [Other System Actor Swimlanes]

---

## Screen 1: [Screen Name]

### Mockup
```
[ASCII art mockup or description]
```

### Data Displayed
- Field 1: Description, source event
- Field 2: Description, source event

### User Actions (Commands)
- Action: [Action], produces: [Event]

### Business Rules
- Rule about what can/cannot be done on this screen

---

## Screen 2: [Screen Name]

[Repeat for each screen]

---

## Processor Todo Lists

### Processor: [Processor Name]

Internal "Todo List" pattern:
```
Triggered by: [Event type]
Todo action: [What needs to be done]
Success produces: [Event]
Failure produces: [Event]
```

[Repeat for each processor]

---

## Data Flow Diagram

[Show how data enters from UI and returns via events]

---

## Field Traceability Matrix

| Field | Screen | Source Event | Status |
|-------|--------|-------------|--------|
| orderId | Status View | OrderCreated |  |
| shipmentId | Status View | OrderShipped |  |
| customerId | All | OrderCreated |  |

---

## Missing Data Analysis

[Any fields without clear source or destination]
```
