---
name: eventmodeling-applying-conways-law
description: "Step 6 of Event Modeling - Apply Conway's Law with swimlanes. Organize events into autonomous system parts that different teams can independently own. Use after defining inputs/outputs. Do not use for: planning feature slice implementation order (use eventmodeling-slicing-event-models) or defining command/read model boundaries (use eventmodeling-designing-event-models)."
allowed-tools:
  - AskUserQuestion
  - Write
  - Bash
---

# Applying Conway's Law

> **Before doing anything else**, invoke the `connect` skill — if not already connected — to resolve `TOKEN`, `BOARD_ID`, `ORG_ID`, and `BASE_URL`. Do not proceed until it has completed. Consult `learn-eventmodelers-api` only if you need to look up a specific endpoint or field this file doesn't cover — don't load it eagerly.

## Interview Phase (Optional)

**When to Interview**: Skip if the user has already specified: existing team structure, team responsibilities, and autonomous boundary preferences. Interview when team structure is unclear or organizational alignment hasn't been discussed.

**Interview Strategy**: Understand team organization and decision-making to design system boundaries that teams can own independently. Misalignment here creates bottlenecks and tight coupling later.

### Critical Questions

When team structure or boundaries are unclear:

1. **Team Structure & Ownership** (Impact: Determines how many swimlanes/systems to create)
   - Question: "How is your organization structured? (A) Single team owns everything, (B) Separate teams by domain (payments, inventory, etc.), (C) Separate teams by function (backend, frontend, etc.)"
   - Why it matters: Team structure directly shapes system boundaries; aligning them reduces coordination overhead
   - Follow-up triggers: If (B) → ask what each team owns; if (C) → discuss how to organize by domain instead

2. **Boundary Autonomy Level** (Impact: Determines coupling and inter-team communication patterns)
   - Question: "How much autonomy should each team have? (A) Very high (minimal cross-team communication), (B) Moderate (coordinate via events), (C) Low (frequent coupling acceptable)"
   - Why it matters: Highly autonomous teams need clean event-based boundaries; low autonomy might accept more coupling
   - Follow-up triggers: If (A) → strict event-driven design; if (C) → discuss why coupling is needed

3. **External System Integrations** (Impact: Determines if integrations become separate swimlanes or embedded in existing ones)
   - Question: "Do you need to integrate with external systems? (A) Payment processor, (B) Shipping provider, (C) Multiple external systems, (D) No external integrations?"
   - Why it matters: External systems often become separate swimlanes; knowing which ones matters for boundary design
   - Follow-up triggers: For each integration → ask "Who owns the integration—existing team or new team?"

### Interview Flow

**Conditional Entry**:
```
If user has provided:
  - Clear team structure (who owns what)
  - AND specified desired level of autonomy
  - AND identified external integrations

Then: Skip interview, proceed directly to swimlanes

Else: Conduct interview
```

**Phase 1: Organization Assessment** (Questions 1-2)
- Understand team structure
- Determine autonomy expectations
- Establish boundary philosophy

**Phase 2: Integration Mapping** (Question 3)
- Identify external systems
- Plan integration boundaries
- Finalize swimlane count

### Capturing Interview Findings

Append findings to the project's event modeling file:

**File**: `.trogonai/interviews/[project-name]/EVENTMODELING.md`

Use Write tool to add/update this section:

```markdown
## 6. Conway's Law (eventmodeling-applying-conways-law)

### Team Structure
- Team 1: [Name] - Owns [domain]
- Team 2: [Name] - Owns [domain]
- Team 3: [Name] - Owns [domain]

### Autonomy Goals
[High / Moderate / Low]

### Swimlanes
- [Swimlane 1]: [Team] owns [events]
- [Swimlane 2]: [Team] owns [events]
- [Swimlane 3]: [Team] owns [events]

### Cross-Team Communication
- [Team A] → [Team B] via [event]
- [Team B] → [Team C] via [event]
```

Update Interview Trail:
```markdown
| 6 | eventmodeling-applying-conways-law | [today] | Swimlanes defined, team boundaries confirmed |
```

---

## Workflow

Given all events, inputs, and outputs, organize by ownership:

> **This step's "swimlane" is the same boundary `eventmodeling-brainstorming-events` governs, described from the ownership angle instead of the board-mechanics angle.** That skill's Swimlane Rules restrict the board's actual `swimlane`-type lane to marking integration with another system — this step doesn't loosen that cap or add a lane per team. Under Conway's Law, "team" and "system" name the same boundary: a system this chapter's process integrates with is, by definition, owned by some other team. The diagrams below are a narrative/analysis device for documenting *who owns what* across those boundaries — not an instruction to create one board swimlane lane per team named here.

### 1. Identify System Boundaries
Determine what constitutes a separate system/bounded context: for each candidate system, name what it owns, list the events it produces, and note the state machine it's responsible for. A full worked example (Order/Payment/Inventory/Fulfillment domain) is in `references/examples.md`.

### 2. Create Swimlane Diagram
Lay the events out on a timeline with one row per team, showing which events each team owns and where coordination crosses from one team's row into another's. A full worked example is in `references/examples.md`.

### 3. Map Team Responsibilities
For each team, define: the commands they handle, the events they produce, the read models they maintain, and the other systems they call or depend on. A full worked example (Order/Payment/Inventory/Fulfillment teams) is in `references/examples.md`.

### 4. Identify Inter-System Communication
For each pair of systems that interact, document the triggering event, what the consuming system does in reaction (which command it issues), and the event that results. A full worked example is in `references/examples.md`.

### 5. Define System Interfaces
For each system, list the commands it accepts (and from where — UI, another system, a processor) and the events/read models it produces or provides to others. A full worked example is in `references/examples.md`.

### 6. Identify Processors vs Systems
For each autonomous processor/automation, document what triggers it, its logic, the command(s) it produces, and which system it lives in. A full worked example (Payment/Inventory/Fulfillment/Notification processors) is in `references/examples.md`.

## Output Format

Present the analysis as a markdown document titled "System Organization: [Domain Name]" with these sections: **System Boundaries** (one entry per system, giving its owning team, responsibilities, commands, events produced/consumed, read models, dependencies, and scope); **Event Flow Across System Boundaries** (a time-ordered diagram showing which system's events trigger the next system downstream); a **Team Responsibilities Matrix** (one row per team: commands, events, read models); **Inter-System Communication** (one entry per system pair: triggering event, reacting system/action, resulting command); a **Dependencies** table of external systems (what they're called for); and a closing **Independent Development** note on how the boundaries let each team build, scale, and deploy independently, coordinating only via events, processors, and shared read models. A full worked example of this document (Order/Payment/Inventory/Fulfillment domain) is in `references/examples.md`.

## Quality Checklist

- [ ] Each system has clear ownership
- [ ] System boundaries are well-defined
- [ ] Events map to systems
- [ ] Commands map to teams
- [ ] Cross-system communication is documented
- [ ] No circular dependencies
- [ ] Each team has independent scope
- [ ] Processors are explicitly assigned
- [ ] External systems identified
- [ ] System interfaces are clear

## Conway's Law Principle

**System architecture mirrors team structure**:
- Separate teams → Separate systems
- Each system owns events
- Communication through events
- Independent development possible
- Aligns with org chart

## Key Benefits

1. **Team Independence**: Each team owns their domain
2. **Clear Ownership**: No confusion about responsibility
3. **Scalable Architecture**: Systems can evolve independently
4. **Event-Driven**: Natural communication via events
5. **Deployment**: Each team deploys their system
