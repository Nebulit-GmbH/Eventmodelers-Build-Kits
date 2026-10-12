---
name: eventmodeling-information-completeness
description: The rule for where every field's value comes from. Use it whenever a field is added, renamed or reviewed on any element (SCREEN, HTML_SCREEN, COMMAND, EVENT, READMODEL, AUTOMATION), whether in a full modeling run, a one-off /attributes or /place-element call, or a fix. Each field either matches a same-named field on a connected upstream element, maps to a differently named field or a connected event, or is marked generated where the information starts. Anything else is a gap to close. Not a step of its own. Other skills reference it instead of restating it.
---

# Information Completeness

Information doesn't appear out of nowhere. Every field on every element either comes from an element **connected upstream** of it, or starts at this element. Check this **each time you add or rename a field**, before you write it. Don't leave it for a later completeness pass.

## The four valid states of a field

| Where the value comes from | What to write | Example |
|---|---|---|
| A connected upstream element has a field **with the same name** | nothing: no `mapping`, the same name *is* the mapping | `BikeReserved.bikeId` ← `ReserveBike.bikeId` |
| A connected upstream element has it **under a different name** | `mapping: "<sourceFieldName>"` (a sub-field as `"<field>.<subfield>"`) | `ReserveBike.endTime` with `mapping: "returnTime"` |
| It comes from one specific connected **event** (or other connected element), e.g. because several upstream elements carry the field | `mapping: "<EventTitle>"`, the element's title on its own | `ReservationView.expiresAt` with `mapping: "ReservationConfirmed"` |
| **Nothing upstream** supplies it: manual input typed into a screen, a session value, a generated id or timestamp, a value computed at this element | `generated: true` | `HTML_SCREEN "Reserve a Bike".startTime`, `BikeReserved.reservationId` |

These are the forms the board resolves. The field picker offers the connected fields and the event titles, and the Data Trail follows them. Write the field name or the element title **bare**. Combined forms like `"BikeReserved.bikeId"`, `"user-input"`, `"session:x"` or `"derived:..."` resolve to nothing.

## Upstream means inbound, per element type

Lineage always points to where the value comes **from**. It never points downstream.

| Element | Its upstream (where its fields can come from) |
|---|---|
| SCREEN / HTML_SCREEN | the READMODEL it displays. The COMMAND it submits is **downstream**: never map a screen field to it. |
| COMMAND | the SCREEN or AUTOMATION issuing it |
| EVENT | the COMMAND producing it |
| READMODEL | the EVENTs connected to it (`EVENT → READMODEL`) |
| AUTOMATION | the READMODEL (todo list) it reads |

So information typed into a form is `generated: true` **on the screen**. The command, event and read model then pick it up by the same name, or by a `mapping` where it's renamed. Contextual values a command's validation reads (current time or date, acting user, tenant) are `generated: true` on the **command**. Commands carry everything they need to validate (`eventmodeling-identifying-inputs` → "Command input is self-contained"), and the event takes a recorded time from there. Only an id the system creates when recording the fact is `generated: true` on the event. A count, sum or duration the projection calculates is `generated: true` on the read model.

## How to check a field

1. Look at the element's inbound neighbours, from the edges (`get_connected_nodes` `direction: "inbound"`, `includeFields: true`), or from the layout when the chapter is unwired.
2. Pick the row above that matches. One neighbour with the same name, and nothing to write, is the common case.
3. **No row fits → it's a gap.** The field is missing upstream, the connection is missing, or the element is missing. Close it: add the field upstream (and carry it through the chain the same way), add the connection, or add the element. Only when the source genuinely can't be decided from the model, apply the questioning rule.

`generated: true` means "this information starts here". It is never a way to say "I don't know where this comes from". Don't mark a field `generated` to make a gap go away, and don't invent a `generated` origin in the middle of a flow.

## Planned sources that aren't on the board yet

While storyboarding, a displayed screen field is often meant to come from a read model that hasn't been designed yet. Write `mapping: "<ReadModelTitle>"` anyway and flag it as a gap. `eventmodeling-identifying-outputs` groups screen fields by that title to design the read model. Once the read model is connected, a same-named field needs no mapping, and a differently named one gets `mapping: "<readModelFieldName>"`. A displayed field is never marked `generated` just because its read model is missing.

## Renames move the lineage too

Renaming a field breaks every downstream field that matched it by name, or that has `mapping: "<oldName>"`. In the same write, either rename those too or set their `mapping` to the new name. `/attributes` does this for a chain.

## Worked example — reserving a bike

```
HTML_SCREEN "Reserve a Bike"   bikeId (generated), startTime (generated), returnTime (generated),
                               customerId (generated, from session), bikeCategory (mapping "AvailableBikeView")
COMMAND     ReserveBike        bikeId, startTime, customerId (same names, no mapping), endTime (mapping "returnTime"),
                               requestedAt (generated: current time, read by "startTime must be in the future")
EVENT       BikeReserved       bikeId, startTime, endTime, customerId (same names), reservationId (generated),
                               reservedAt (mapping "requestedAt")
READMODEL   ActiveReservation  reservationId, bikeId, startTime (same names), expiresAt (mapping "ReservationConfirmed"),
                               minutesLeft (generated)
HTML_SCREEN "Reservation"      reservationId, startTime, expiresAt (same names, read model connected)
```

Every field on the way traces back to a `generated` origin. Nothing appears without a source.
