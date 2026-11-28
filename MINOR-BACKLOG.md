# Minor backlog

Small features that are not a phase. Each item is real work, but it does not have its own
gate in `ROADMAP.md` and it does not block Phases 10–13.

Add an item when it comes up and is too small for a phase. Take one when a phase is not
open. A fix that belongs inside an open phase stays on that phase's branch.

## Open

### Polyline fillet radius dimension

Radius and diameter dimensions only pick a circle or an arc entity. Filleting two lines
creates an arc, so that radius can be dimensioned today. Rounding a polyline corner stores
the fillet as a bulge on that polyline, not as its own arc, so the radius tool refuses it.

What to build: let `dimRadius` / `dimDiameter` pick a bulged polyline edge, bind the note to
that edge (entity id and vertex), and measure the bulge radius from the geometry every time,
like any other dimension. Do not copy the number. A click must land on the arc of the bulge,
not only on a vertex.

Not in this item: exploding the bulge into a separate arc (that would break the polyline).
Driving the number so the corner rebuilds is only possible after Phase 13, and is the same
item if that phase has already merged.

## Done

None yet.
