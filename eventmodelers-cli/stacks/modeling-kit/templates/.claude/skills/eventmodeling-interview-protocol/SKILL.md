---
name: eventmodeling-interview-protocol
description: Shared procedure for deciding whether to ask the user clarifying questions before an event-modeling step proceeds, and how to record what was decided. Not a step of its own — referenced by other eventmodeling-* skills' Interview Phase section. Do not use standalone.
---

# Interview Protocol

Shared by every event-modeling step that has an "Interview Phase" section. A step's own SKILL.md defines only what's specific to it — when to interview and its Critical Questions. Everything below is common to all of them.

## When to ask

Missing information, or something ambiguous that this step needs? Ask the user — using the step's own Critical Questions as a guide, via `AskUserQuestion` where appropriate. Follow any listed follow-up trigger based on the answer.

Already have everything the step needs? Skip straight to the step's own workflow — don't ask questions whose answers you already have.

**Unless told not to ask** (an autonomous/unattended run, or the user has said not to stop for questions): don't block. Proceed with the most reasonable assumption for anything missing, and say so plainly in this step's findings below — visibly, so it can be corrected later. Never silently guess.

## Recording the outcome

Append to the project's event modeling file: `.trogonai/interviews/[project-name]/EVENTMODELING.md`, under a section for this step:

```markdown
## <Step Number>. <Step Name> (<skill-name>)
[What was asked and decided — or, if nothing was asked, what was assumed and why]
```

Then add or update this step's row in the `## Interview Trail` table (create it if this is the first step to run):

```markdown
| <Step Number> | <skill-name> | Done | <one-line summary of key outputs> |
```
