# Domain-Specific Stream Boundary Patterns

## Contents
- E-commerce patterns
- Banking patterns
- SaaS patterns

Each entry shows a well-scoped boundary for that domain: what identity it's anchored on, and why that identity — not a category or a time window — is the right one.

---

## E-commerce Domain

**Order Aggregate**:
```
Identity: orderId
Lifetime: 1-3 years
Boundary: Everything that happens to this one order
Reason for this boundary: the order has a clear owner (one customer,
one checkout) and a natural end (delivered, cancelled, refunded)
```

**Shopping Cart Aggregate**:
```
Identity: cartId (or customerId, if a customer has exactly one active cart)
Lifetime: 30 minutes to 2 years (varies widely by product)
Boundary: Items added/removed for this one cart
Watch for: an "abandoned" cart and an "active" cart are different
lifecycles — split into separate streams if their behavior diverges
(e.g. abandoned-cart recovery vs. active checkout flow)
```

**User Account Aggregate**:
```
Identity: userId
Lifetime: 5-10+ years
Boundary: Profile and account-level state for this one user
Watch for: account state, preferences, and session history are three
different concerns with different change frequency — split them
(UserProfile / UserPreferences / UserSessions) rather than bundling
```

---

## Banking Domain

**Account Aggregate**:
```
Identity: accountId
Lifetime: 10-50+ years
Boundary: Deposits, withdrawals, and fees for this one account
Watch for: an account spanning decades is still one identity — the
boundary is correct even though the stream is long-lived; don't
split it just because it accumulates many events over a long life
```

**Transaction Aggregate**:
```
Identity: transactionId
Lifetime: 1-2 months (then archived)
Boundary: Requested → Processing → Settled, for this one transaction
Reason for this boundary: a transaction is a short, self-contained
lifecycle — treat it as its own stream, not folded into the account
```

**Loan Aggregate**:
```
Identity: loanId
Lifetime: 5-30 years
Boundary: Payments, rate changes, and modifications for this one loan
Watch for: "active loan" and "completed loan" are different
lifecycles with different access patterns — consider splitting into
ActiveLoan vs. CompletedLoan if their consumers genuinely differ
```

---

## SaaS Domain

**Subscription Aggregate**:
```
Identity: subscriptionId
Lifetime: 1-5+ years
Boundary: Created, Upgraded, Downgraded, Cancelled — for this one subscription
Reason for this boundary: a subscription has one clear owner and a
well-defined lifecycle
```

**User Workspace Aggregate**:
```
Identity: workspaceId
Lifetime: 2-5+ years
Boundary: Members added, roles changed, settings updated — for this one workspace
Watch for: workspace-level settings and individual member activity
are different concerns — keep member activity in its own stream if
it needs independent access patterns
```

**Data Collection Aggregate**:
```
Identity: depends on what's actually being tracked as one thing
Watch for: this is the domain most likely to hide a Pattern 3
("Collection") anti-pattern — ask explicitly: "are all these data
points about the same business entity?"
  → If NO, the boundary is wrong: split by whatever entity each
    data point actually belongs to.
  → If YES, the boundary is fine even if the stream accumulates a
    lot of events — that's a volume question, not a boundary one.
```
