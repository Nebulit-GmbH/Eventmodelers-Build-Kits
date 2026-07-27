# Facilitating Event Modeling Workshops

## Overview

Event Modeling is fundamentally a collaborative workshop process. This guide helps facilitators run efficient, effective workshops across all 7 steps.

## Pre-Workshop Preparation

### 1. Select Participants

**Required Roles**:
- **Product Owner/Domain Expert**: Business rules, priorities, constraints
- **Developers** (2-3): Technical feasibility, implementation concerns
- **QA/Tester** (1-2): Test coverage, edge cases
- **Facilitator** (1): Keeps pace, ensures shared understanding

**Optional Participants**:
- **UX Designer**: User workflows, interface considerations
- **Security Lead**: Sensitive data handling, compliance
- **Operations**: Deployment, monitoring, scaling
- **Customer/User**: Real-world perspective (for workshops with actual users)

**Group Size**: 5-8 people is ideal
- Too small: Miss perspectives
- Too large: Hard to facilitate

### 2. Pre-Workshop Communication

Send to participants before workshop:
```
Subject: Event Modeling Workshop - [Domain Name]

Hi team,

We're running an Event Modeling workshop to design the [Domain] system.

Date: [Date]
Duration: [Hours]
Location: [Physical/Virtual]

Please prepare by thinking about:
  - What workflows happen in this system?
  - What events could occur?
  - What's important about state changes?
  - Questions you have about requirements

No prior Event Modeling experience needed!

Looking forward to seeing you there.
```

### 3. Prepare Workspace

**Physical Workshop**:
```
Setup:
  - Large whiteboard or wall space (8+ feet wide)
  - Sticky notes (multiple colors for events, commands, views)
  - Markers (bold colors)
  - Timer visible
  - Cameras for documentation

Layout:
  - Stand-up around board
  - Facilitator at board
  - Everyone can see and contribute
```

**Virtual Workshop**:
```
Tools:
  - Miro, Figma, or similar
  - Video conference (Zoom, Teams, etc.)
  - Shared document (for notes)

Setup:
  - Everyone can see canvas
  - All can create/edit
  - Recording enabled (for reference)
  - Chat open for side discussions
```

### 4. Create Templates

Prepare sticky note templates or digital shapes:

```
Physical sticky notes:
[Green] Event: ________________

[Blue] Command: ________________

[Orange] View: ________________

Virtual shapes:
Same colors with text fields
```

## Workshop Facilitation by Step

### Step 1: Brainstorming Events (15-20 minutes)

**Objective**: Identify all domain events (state changes)

**Facilitation Flow**:

1. **Set Context** (2 min)
   ```
   "We're going to envision what this system does. Imagine it's running
   for years—what events happen? What important state changes?

   An event is something that changed the state. Not just something
   that happened, but something that MATTERS because it changed things.

   Everyone write down any events you think of."
   ```

2. **Free Brainstorm** (8-10 min)
   - Participants call out events
   - You write on board or digital canvas
   - No filtering yet! Capture everything
   - Encourage "What about..." questions
   - Example responses:
     - "Customer placed order" → Write: "OrderCreated"
     - "Order was confirmed" → Write: "OrderConfirmed"
     - "What about customer viewed page?" → "Let's capture it for now, we'll refine"

3. **Gentle Filtering** (5-7 min)
   ```
   "Now let's think about these. An event is something that actually
   changed the state. Let me ask about some:

   'Customer viewed catalog' - did this change anything?
   Person: Not really...
   You: Right, viewing doesn't change anything. But if they SELECTED
        an item, that changes their cart. That's 'ItemAddedToCart'.

   'System checked inventory' - did this change system state?
   Person: No, it's internal...
   You: Exactly, internal checks don't count. But when we ACTUALLY
        reserved inventory, that's a state change: 'InventoryReserved'.
   ```

4. **Capture Insights** - Add notes on WHY events matter
   - Identify stream roots (Order, Payment, Review, etc.)
   - Document any questions for domain expert

**Timing Guide**:
- Tight groups: 12-15 min
- Complex domains: 20-25 min
- Always watch time—keep moving

### Step 2: Plotting Events (Timeline)

**Objective**: Order events into a timeline (process flow)

**Facilitation Flow**:

1. **Establish Order** (5 min)
   ```
   "Let's put these events in order. What happens first?"

   Guide conversation:
   "Before we can confirm an order, what must happen?"
   → "Order must be created first"

   "So the sequence is?"
   → Lead to: OrderCreated → OrderConfirmed
   ```

2. **Handle Branches** (5 min)
   ```
   "Can different things happen from here?"

   "What if payment fails?"
   → "PaymentFailed event"
   → This creates branching paths

   Draw branching clearly:
   OrderConfirmed
     → PaymentAuthorized → (success path)
     → PaymentFailed → (failure path)
   ```

3. **Identify Parallel Flows** (5 min)
   ```
   "Do these happen at the same time or one after another?"

   Example:
   "Once payment is authorized, what happens?"
   → "Inventory reserved"
   → "Email sent"
   → Can these happen in parallel? Usually yes!
   ```

**Don't get stuck** on exact timing—the point is the logical flow.

### Step 3: Storyboarding (UI Mockups)

**Objective**: Visualize what users see

**Facilitation Flow**:

1. **Pick First Screen** (2 min)
   ```
   "Let's think about the UI. What's the first screen the user sees?"
   → "Order entry form"

   "Who draws?"
   → Can be anyone, or facilitator
   ```

2. **Draw and Label** (5 min)
   ```
   Draw on board:
   
    Order Entry Form     
   
    Customer: [_______] 
    Items: [___] [___]  
    [Submit]             
   

   Label each field:
   Customer ← from CreateOrder command
   Items ← user selection
   ```

3. **Trace Data** (3 min)
   ```
   "Where does this data go?"
   → "Into the event"
   → "Then what screen shows next?"
   → Draw: Confirmation screen with same data
   ```

4. **Identify Missing** (2 min)
   ```
   "Can we see everything we need on this screen?"
   → If missing: "We'll need to add that to the event"
   → Add to list of clarifications
   ```

**Time per screen**: 5-7 minutes (don't perfect, iterate)

### Step 4: Identifying Inputs (Commands)

**Objective**: Map user actions to commands

**Facilitation Flow**:

1. **Extract from Storyboards** (5 min)
   ```
   "Looking at the screens, what are users doing?"
   → "Clicking Submit" → "CreateOrder command"
   → "Selecting payment" → "ConfirmOrder command"

   Write commands clearly
   ```

2. **Identify Processor Inputs** (5 min)
   ```
   "What does the system do automatically?"
   → "Check payment gateway" → "AuthorizePayment command"
   → "Reserve inventory" → "ReserveInventory command"

   Mark these as [ Automation]
   ```

3. **Specify Data** (5 min)
   ```
   "For each command, what data does it need?"

   CreateOrder needs:
     - customerId (from form/session)
     - items (from form selection)
     - shippingAddress (from form)

   Write this clearly
   ```

4. **Validation Questions** (5 min)
   ```
   "What validation must pass?"

   CreateOrder:
     - Customer must exist
     - Items must not be empty
     - Address must be complete

   Write these as business rules
   ```

### Step 5: Identifying Outputs (Events & Views)

**Objective**: Specify events and read models

**Facilitation Flow**:

1. **Events from Commands** (5 min)
   ```
   "For each command, what event happens?"

   CreateOrder → OrderCreated (what fields?)
   Specify exactly what fields:
     - orderId (generated)
     - customerId (from command)
     - items (from command)
     - total (calculated)
   ```

2. **Read Models** (5 min)
   ```
   "What views do users need?"
   → "Order status view"
   → "Order list view"
   → "Order detail view"

   "What data in each?"
   → Status view: All order details
   → List view: Summary only
   ```

3. **Event → View Mapping** (5 min)
   ```
   "OrderCreated → Status View shows:"
   - orderId
   - items
   - total
   - status=Draft

   "OrderConfirmed → Status View updates:"
   - status=Confirmed
   - confirmedAt timestamp
   ```

### Step 6: Apply Conway's Law (System Boundaries)

**Objective**: Identify systems and responsibilities

**Facilitation Flow**:

1. **Ask the Question** (2 min)
   ```
   "Who does what?"

   "Is payment something WE do or does an external system?"
   → If external: PaymentGateway system
   ```

2. **Draw Boundaries** (5 min)
   ```
   Visually separate:

   Our System:
      Order service
      Inventory service
      Notification service

   External:
      Payment gateway
      Fulfillment provider
   ```

3. **Clarify Ownership** (5 min)
   ```
   "Which system owns each event?"

   OrderCreated → Our Order system
   PaymentAuthorized → Payment system (external) or our bridge?
   InventoryReserved → Our Inventory system
   ```

4. **Identify Team Structure** (5 min)
   ```
   "Who builds what?"

   → Team A: Order service
   → Team B: Payment processor
   → Team C: Inventory management

   Boundaries = team boundaries (Conway's Law)
   ```

### Step 7: Elaborating Scenarios (Given-When-Then)

**Objective**: Specify behavior with Gherkin format

**Facilitation Flow**:

1. **Happy Path First** (8 min)
   ```
   "Let's write the success case. What's the normal flow?"

   Scenario: Create order successfully
     Given: Customer exists, products exist
     When: Customer creates order with items
     Then: OrderCreated event produced, status=Draft

   Write on board/doc with team reviewing
   ```

2. **Failure Cases** (8 min)
   ```
   "What can go wrong?"

   Scenario: Reject with invalid customer
     Given: Customer ID doesn't exist
     When: CreateOrder attempted
     Then: Command rejected, no event

   → Quick, obvious failures
   → Don't overthink
   ```

3. **State Validation** (5 min)
   ```
   "What if the order is in wrong state?"

   Scenario: Can't confirm already-confirmed order
     Given: Order already in Confirmed state
     When: Confirm attempted again
     Then: Rejected
   ```

4. **Alternative Paths** (5 min)
   ```
   "Any different ways this could work?"

   Scenario: Can't confirm order with no payment method
   Scenario: Can retry if payment fails

   Capture alternatives quickly
   ```

**Time**: 5-7 min per command/view, don't perfect

## Facilitation Techniques

### Handling Different Personalities

**Quiet developers**:
- Direct question: "Alex, what do you think about this?"
- Don't embarrass, just engage
- "Good point, add that"

**Dominating voices**:
- Politely redirect: "Thanks, let me get input from others"
- "Interesting, let's capture that and check with the team"
- Keep energy high so they feel heard

**Skeptics**:
- Take seriously: "What's your concern?"
- Don't dismiss: "That's valid, let's think about it"
- Sometimes reveal real issues

**Idea-generators**:
- Capture everything: "Good ideas, adding them"
- Sort later: Don't slow momentum
- "We'll come back to that"

### Keeping Energy & Pace

```
Good pacing:
  - 5-7 min per item (not 20 min perfecting one detail)
  - Move quickly between steps
  - Regular breaks (every 45-60 min)
  - Stand, don't sit (keeps energy up)

Warning signs of bad pacing:
  - People checking phones
  - Someone talking endlessly
  - "Um... let me think..." (too hard)
  - Fatigue setting in

Recovery:
  - Take 10-min break
  - Change activity (switch from drawing to writing)
  - Refocus on goals: "We're 60% done, here's what we still need"
```

### Dealing with Disagreement

```
Situation: Two people disagree on event

Option A: "Both are valid? Can we combine?"
Option B: "Let's see if later steps clarify?"
Option C: "Let's note both and revisit"

Don't: Get stuck on one issue
Do: Keep moving, document decision

Decision-making:
  1. If there's a clear right answer → Use it
  2. If reasonable people disagree → Document both, move on
  3. If it doesn't matter now → Defer to implementation team
```

## Remote Workshop Adaptations

### Virtual vs. Physical

**Advantages of virtual**:
- Can record (perfect reference)
- Can save digital artifacts
- Easier for distributed teams
- Can use video recordings in onboarding

**Challenges**:
- Less natural interaction
- Harder to facilitate drawing
- Zoom fatigue
- Side conversations harder

**Adaptations**:
```
1. Shorter sessions (90 min instead of 4 hours)
2. More breaks (10 min every 30 min)
3. Structured input (everyone adds ideas before discussing)
4. Clearer roles (one person drawing, one taking notes)
5. Recording on (for those who can't attend live)
6. Async follow-up (give people time to digest)
```

## Post-Workshop

### Immediate (Same Day)

1. **Capture on Document** - Photograph/screenshot all artifacts
   - Type up handwritten notes
   - Create digital version of diagram

2. **Share with Team** - Everyone gets copy
   - Add notes: "Why did we choose this?"
   - Link to recordings

3. **Identify Gaps** - Note unclear items
   - Schedule quick follow-up if needed

### Follow-Up (1-2 Days)

1. **Distribute Summary** - What we covered
   - Key decisions
   - Outstanding questions

2. **Request Feedback** - Any clarifications needed?
   - Anything we missed?
   - Concerns?

3. **Next Steps** - Next workshop scheduled?
   - Who's doing design/implementation?
   - When do we start?

## Multi-Day Workshop Schedule

For large or complex projects:

```
Day 1 (Steps 1-3): 4 hours
  - 9am-10am: Brainstorming events (Step 1)
  - 10am-11am: Plotting timeline (Step 2)
  - Break: 11am-11:15am
  - 11:15am-1pm: Storyboarding (Step 3)
  - Lunch: 1pm-2pm

Day 2 (Steps 4-7): 4 hours
  - 9am-10am: Identifying inputs (Step 4)
  - 10am-11am: Identifying outputs (Step 5)
  - Break: 11am-11:15am
  - 11:15am-12:30pm: System boundaries (Step 6)
  - 12:30pm-1pm: Scenario planning (Step 7 intro)
  - Lunch/break

Day 3 (Scenarios & Polish): 3 hours
  - 9am-12pm: Elaborate scenarios (Step 7, detailed)
  - Document findings
  - Plan next steps
```

## Facilitation Checklist

### Before Workshop
- [ ] Invitations sent 1 week prior
- [ ] Right people confirmed attending
- [ ] Room/tech tested
- [ ] Materials prepared (sticky notes, markers, templates)
- [ ] Facilitator briefing done
- [ ] Objectives clear to all

### During Workshop
- [ ] Started on time
- [ ] Explained purpose and format
- [ ] Each step has clear objective
- [ ] Captured everything (photo/digital)
- [ ] Timing maintained (didn't get stuck)
- [ ] Everyone participated
- [ ] Energy and engagement stayed high
- [ ] Decisions documented
- [ ] Ended on time

### After Workshop
- [ ] Artifacts digitized and shared
- [ ] Summary created
- [ ] Gaps identified
- [ ] Feedback requested
- [ ] Next steps scheduled
- [ ] Team has clear deliverables

## Success Indicators

**Good workshop**:
- Everyone participated
- Decisions were made and documented
- Artifacts created and shared
- Team understands the model
- Clear next steps
- Energy was good throughout

**Needs improvement**:
- Some people quiet the whole time
- Unclear what we decided
- No clear artifacts
- "Are we building this in Java or Python?" (forgotten basics)
- People left tired/frustrated
