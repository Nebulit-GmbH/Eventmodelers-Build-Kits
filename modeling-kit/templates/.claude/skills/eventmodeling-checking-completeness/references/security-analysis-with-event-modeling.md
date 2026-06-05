# Security Analysis with Event Modeling

## Overview

Event Modeling makes security analysis uniquely transparent. By visualizing exactly where data flows through the system and which boundaries data crosses, security reviews become systematic instead of ad-hoc.

The article notes:

> "With an event model, the solution shows exactly where, and equally importantly, when sensitive data crosses boundaries. With traditional audits, the number of interviews with staff was time consuming and at risk of missing important areas."

## The Security Transparency Problem

### Traditional Security Review

```
Traditional approach:
  1. Meet with team members
  2. Ask: "Where does sensitive data go?"
  3. Answers vary, incomplete, hard to verify
  4. Risk: Miss important data flows
  5. Cost: Many interviews, hours of analysis
  6. Result: Uncertainty about coverage

Problems:
  - Different people have different mental models
  - Data flows not written down
  - Discoverable only through interviews
  - Risk of missing critical flows
  - Hard to audit compliance
```

### Event Modeling Security Review

```
Event Modeling approach:
  1. Review event model (visual, written)
  2. Identify which fields are sensitive
  3. Trace sensitive data flow
  4. Identify boundaries it crosses
  5. Specify encryption/protection requirements
  6. Verify against compliance
  7. Result: Complete, auditable, visual

Advantages:
  - All flows visible in one place
  - Data marked as sensitive/public
  - Boundaries explicit
  - Changes trackable
  - Compliance verification straightforward
```

## Identifying Sensitive Data

### Data Classification

```
In your event model, classify all fields:

 Highly Sensitive:
  - Social Security Number
  - Credit card number
  - Bank account number
  - Authentication tokens
  - Passwords
  - Medical records
  - Biometric data

🟡 Sensitive:
  - Email address
  - Phone number
  - Home address
  - Date of birth
  - IP address
  - Transaction history
  - Browsing history

🟢 Public:
  - Product names
  - Prices
  - Order status
  - Timestamps
  - User preferences (non-personal)
```

### Marking Data in Events

```
Event: CreateOrder

Fields and sensitivity:
  orderId: 🟢 Public (needed for display)
  customerId: 🟡 Sensitive (personal identifier)
  items: 🟢 Public (what they ordered)
  total: 🟢 Public (order amount)
  shippingAddress: 🟡 Sensitive (personal location)
  billingAddress: 🟡 Sensitive (personal location)
  paymentTokenId:  Highly Sensitive (payment reference)
  customerEmail: 🟡 Sensitive (personal contact)
  customerPhone: 🟡 Sensitive (personal contact)

--- Event: PaymentAuthorized

Fields and sensitivity:
  orderId: 🟢 Public
  paymentId: 🟡 Sensitive (transaction reference)
  authCode:  Highly Sensitive (can be used for disputes/refunds)
  amount: 🟢 Public
  cardLast4: 🟡 Sensitive (partial card info)
  timestamp: 🟢 Public
```

## Tracing Data Flow

### Sensitive Data Journey

```
Event: CreateOrder
   customerId: 🟡 Sensitive
      Stays in: Order stream (encrypted)
      Sent to: InventorySystem (internal)
      Sent to: NotificationSystem (internal)
      Displayed in: OrderStatusView (only to owner)
  
   shippingAddress: 🟡 Sensitive
      Stays in: Order stream (encrypted)
      Sent to: FulfillmentSystem (external!)
         Risk: Data leaves our domain
         Mitigation: Use separate address service
      Displayed in: OrderStatusView (only to owner)
  
   customerEmail: 🟡 Sensitive
       Stays in: Order stream (encrypted)
       Sent to: NotificationSystem (internal)
          Risk: Email stored in logs?
          Mitigation: Hash email, use secure templates
       Not displayed in UI 

--- Event: PaymentAuthorized
   authCode:  Highly Sensitive
      Received from: External PaymentGateway
      Stored in: Payment stream (encrypted, HSM-backed)
      Accessed by: RefundProcessor (needs authCode)
      Risk: Exposure = Unauthorized refunds
      Mitigation: Encrypt at rest, TLS in transit, access logging
  
   cardLast4: 🟡 Sensitive
       Received from: External PaymentGateway
       Stored in: Payment stream (encrypted)
       Displayed in: OrderStatusView (last 4 digits OK, not full card)
```

### Create a Sensitivity Matrix

```
| Event | Field | Sensitivity | Stored Where | Sent To | Display | Protection |
|-------|-------|------------|-------------|---------|---------|-----------|
| CreateOrder | customerId | 🟡 | Order stream | Inventory, Notify | OrderView | Encrypted, TLS |
| CreateOrder | shippingAddress | 🟡 | Order stream | Fulfillment | OrderView | Encrypted, TLS |
| PaymentAuthorized | authCode |  | Payment stream | Refund processor | Hidden | Encrypted, HSM, Access log |
| PaymentAuthorized | cardLast4 | 🟡 | Payment stream | Notification | Last 4 only | Encrypted, TLS |
| OrderStatusView | customerId | 🟡 | Read model | - | Owner only | Encrypted, Access control |
```

## Identifying Boundary Crossings

### System Boundaries

```
Your System Boundary:


 Your Core System                                    
                                                     
   Order Service                                  
      Stores: customerId, orderId, items        
                                                   
   Payment Service (internal)                    
      Stores: authCode, cardLast4               
                                                   
   Notification Service (internal)               
       Stores: customerEmail                     
                                                     

                                       
          BOUNDARY CROSSING            
         ↓                      ↓        ↓
          
     Fulfillment      Payment      Analytics
     (External)       Gateway      (Our     
                      (External)    external
     Receives:                     vendor)  
     shipping         Receives:             
     address          Amount       Receives:
     🟡               Token        customer 
                                 behavior 
           🟡       
                                       

Boundary Crossings:
  1. shippingAddress → Fulfillment (🟡 Sensitive)
     Risk: Data in external system
     Mitigation: Encrypted channel, data minimization

  2. authCode → PaymentGateway ( Highly sensitive in both directions)
     Risk: Highest - payment fraud
     Mitigation: PCI compliance, TLS only, never in logs

  3. Customer behavior → Analytics (🟡 Sensitive)
     Risk: Behavioral tracking, profiling
     Mitigation: Anonymization, consent, data minimization
```

## Compliance Requirements

### Map Events to Compliance

```
Regulation: GDPR (Europe)

Sensitive data: customerId, email, phone, address

GDPR Requirements:
  1. "Right to be forgotten": Delete all customer data on request
     Implementation: Create CustomerDataDeleted event
     Scope: Wipe from Order stream, Payment stream, all views

  2. "Data minimization": Only collect necessary data
     Review: Which fields in events are actually needed?
     Action: Remove unused fields

  3. "Explicit consent": Collect consent for non-essential data
     Review: Which fields require consent?
     Events: CustomerConsentGiven, CustomerConsentWithdrawn

  4. "Data transfer restrictions": Can't send to certain countries
     Boundary: PaymentGateway location (check compliance)
     Boundary: Analytics vendor location (check compliance)

--- Regulation: PCI DSS (Payment Card Industry)

Sensitive data: authCode, cardLast4, cardNumber (if stored)

PCI Requirements:
  1. "Encrypt at rest": authCode must be encrypted in storage
     Check: Event store encryption enabled? 

  2. "Encrypt in transit": Data sent via TLS only
     Check: All processors use HTTPS? 

  3. "No full card numbers": Never store full credit card
     Check: Event has only cardLast4? 

  4. "Access logging": Log all access to authCode
     Action: Add processor access logs for PaymentAuthorized events

  5. "Regular testing": Security audits
     Plan: Quarterly review of this matrix
```

## Creating Security Controls

### Control Framework

```
For each sensitive field, define controls:

Field: authCode ( Highly Sensitive)

Sensitivity: 4/4 (highest)

Data classification: Payment authorization

Controls:
   Encryption at Rest
    Type: AES-256
    Location: Event store
    Key: Hardware Security Module (HSM)
    Rotation: Annual

   Encryption in Transit
    Type: TLS 1.3
    Required: All access to authCode
    Pinning: Certificate pinning to payment gateway

   Access Control
    Who can read: RefundProcessor, RefundHandler
    Who can write: PaymentProcessor (external system)
    Logging: All reads logged with timestamp, user, purpose

   Audit Trail
    Tracked: Every access to authCode
    Retention: 7 years (compliance requirement)
    Review: Monthly audit of access logs

   Purpose Limitation
    Can be used for: Refund processing only
    Cannot be: Displayed in UI, sent in emails, logged

   Expiration
    Retention: 6 months after transaction
    Action: Automatic purge after retention period

--- Field: shippingAddress (🟡 Sensitive)

Sensitivity: 2/4 (medium)

Data classification: Personal location

Controls:
   Encryption at Rest
    Type: AES-256
    Key: Application-level encryption

   Encryption in Transit
    Type: TLS 1.3

   Access Control
    Who can read: FulfillmentService, OrderService, OrderOwner
    Who can write: CreateOrder command, UpdateOrder command

   Audit Trail
    Tracked: Access to addresses, modifications
    Retention: 2 years

   Purpose Limitation
    Can be used for: Order fulfillment, customer service
    Cannot be: Sold to third parties, used for marketing (without consent)

   Anonymization for Analytics
    When sending to Analytics: Geocode to region level only
    Never: Individual addresses to analytics
```

## Audit Trail & Compliance

### Compliance Checklist

```
Security Review Checklist (using Event Model)

 Sensitive data identified
  - All fields marked with sensitivity level
  - Classification agreed with security team

 Data flows mapped
  - Every sensitive field: origin, journey, destination
  - Boundary crossings identified

 Protections specified
  - Encryption requirements defined
  - Access controls documented
  - Audit logging configured

 Compliance verified
  - GDPR checks:  Consent,  Right to delete,  Data minimization
  - PCI checks:  Encryption,  Access control,  No full cards
  - SOC 2 checks:  Access logging,  Audit trail

 Controls implemented
  - Encryption:  Enabled
  - TLS:  All channels
  - Access logging:  All sensitive data
  - Monitoring:  Alerts on unauthorized access

 Testing scheduled
  - Penetration test: Quarterly
  - Access control audit: Monthly
  - Encryption key rotation: Annual
```

## Examples: Real Audit

### Before Event Modeling

```
Security auditor asks:
  "Where does customer email go?"

Team A: "It's in the order service database"
Team B: "It goes to the notification system"
Team C: "Not sure, might be in logs?"
Team D: "I think analytics uses it?"

Auditor result: "Insufficient documentation, cannot verify compliance"
Recommendation: "Complete audit required" (expensive, time-consuming)
```

### After Event Modeling

```
Security auditor:
  1. Reviews event model
  2. Looks up: Field "customerEmail" in CreateOrder event
  3. Sees: 🟡 Sensitive (marked in schema)
  4. Traces flow:
      Stored in: Order stream (encrypted, detailed in control matrix)
      Sent to: NotificationService (internal, over TLS)
      Stored in: Notification logs (PII removal configured)
      Not sent to: Analytics (marketing consent required, marked in schema)
      Deleted when: CustomerDeletionRequested event issued
  5. Verifies: All controls documented and implemented
  6. Result: "Compliant, controls adequate"

Time: 2 hours instead of 2 days
Confidence: High (all flows documented)
```

## Key Principles

1. **Visibility**: Mark sensitivity on every field
2. **Traceability**: Track sensitive data through all boundaries
3. **Compliance**: Map regulations to data flows
4. **Control**: Define protection for each sensitivity level
5. **Audit**: Document controls and verify implementation
6. **Change Tracking**: When event model changes, security review updates
7. **Testing**: Include security in compliance testing

## Summary

Event Modeling transforms security from:
- Interviews and guesswork
- Risk of missing flows
- Hard to verify compliance
- Expensive audits

To:
- Visual, documented data flows
- Complete traceability
- Systematic compliance verification
- Auditable, repeatable process
