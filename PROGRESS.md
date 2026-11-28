# ArchiLite progress

**Now:** Phases 1 to 9 are merged and live. Phase 12 (live DXF dimensions) is in this pull
request. Phase 13 (driving dimensions) is in [#21](https://github.com/leon14026/2D-CAD/pull/21)
and does not wait on this one. The Phase 11 phone plan is on `main`
([#11](https://github.com/leon14026/2D-CAD/pull/11)).

**Live site:** https://leon14026.github.io/2D-CAD/ (shows the last merged phase)

| Phase | Status | Pull request | Merged |
|---|---|---|---|
| 0. Foundations and compliance | Done | [#1](https://github.com/leon14026/2D-CAD/pull/1) | 2026-11-25 |
| 1. Geometry kernel | Done | [#2](https://github.com/leon14026/2D-CAD/pull/2) | 2026-11-26 |
| 2. Document model, file format, commands | Done | [#3](https://github.com/leon14026/2D-CAD/pull/3) | 2026-11-26 |
| 3. Viewer | Done | [#4](https://github.com/leon14026/2D-CAD/pull/4) | 2026-11-26 |
| 4. Precision drafting | Done | [#5](https://github.com/leon14026/2D-CAD/pull/5) | 2026-11-26 |
| 5. Modify tools | Done | [#6](https://github.com/leon14026/2D-CAD/pull/6) | 2026-11-26 |
| 6. Annotation | Done | [#7](https://github.com/leon14026/2D-CAD/pull/7) | 2026-11-26 |
| 7. Import and export | Done | [#8](https://github.com/leon14026/2D-CAD/pull/8) | 2026-11-26 |
| 8. Scripting (JavaScript, Python via Pyodide) | Done | [#9](https://github.com/leon14026/2D-CAD/pull/9) | 2026-11-26 |
| 9. Blocks, sheets, constraints (stretch) | Done | [#12](https://github.com/leon14026/2D-CAD/pull/12) | 2026-11-26 |
| 10. DWG import (read only) | Not started | — | — |
| 11. Phone browser | In progress | [#26](https://github.com/leon14026/2D-CAD/pull/26) | — |
| 12. Live DXF dimensions | Done | [#23](https://github.com/leon14026/2D-CAD/pull/23) | 2026-11-27 |
| 13. Driving dimensions and editing constrained drawings | In progress | [#21](https://github.com/leon14026/2D-CAD/pull/21) (merged), [#24](https://github.com/leon14026/2D-CAD/pull/24) (merged), rectangle presets [#28](https://github.com/leon14026/2D-CAD/pull/28) | — |

Manual tests waiting for you: see [TEST-BACKLOG.md](TEST-BACKLOG.md).

## Log

### 2026-11-27: Phase 11 (phone browser) started

- Same site at 700px and under: bottom tool strip, sheets, one-finger pan, two-finger pinch.
  Independent of Phase 10, 12 and 13; branched from `main`. PR [#26](https://github.com/leon14026/2D-CAD/pull/26).
- Local gate: 1,214 unit tests, 80 browser tests (including 390×844 phone), 125.6 KB gzipped.
  20,000-entity pan 8.4 ms avg (119 fps), zoom 12.3 ms avg (82 fps).

### 2026-11-27: Phase 13: rectangle presets

- Owner decision: shapes get preset constraints, like a sketch in a parametric CAD program.
  Branch `phase-13-shape-presets`, pull request [#28](https://github.com/leon14026/2D-CAD/pull/28),
  built on [#21](https://github.com/leon14026/2D-CAD/pull/21); #21 must merge first.
- Built: a rectangle drawn with the tool holds each side horizontal or vertical (four
  constraints, one undo step). Typing a new width or height now works from every side and
  either end of it; before this, three of the four click orders were refused or grew the wrong way.
- Solver fix found on the way: a one-axis constraint (horizontal, vertical, a distance along x
  or y) now votes on its own axis only. Before, a typed width landed about 6e-10 short
  (`-19.999999999418` for `-20`); now it is exact.
- Rounding, cutting, joining, exploding, turning and mirroring a preset rectangle are not
  refused. They let the constraints go and say so; Ctrl+Z brings them back. A turned
  dimension stays, in brackets.
- Reference drawings: the plate in both is drawn with the Rectangle tool, so every later id is
  four higher. Same geometry, same notes; the hand-worked checks and the two approved files
  were renumbered and compared with the old ones first.
- Not done, for the owner to decide: copies, arrays and offsets of a rectangle are plain;
  scaling a dimensioned shape is still refused; the Polygon tool has no presets (its equal
  sides need constraints on one polyline's edges); lines drawn exactly horizontal or vertical
  get no constraint.

### 2026-11-27: Click a dimension's number to redimension

- SolidWorks-style: placing a dimension already holds the drawing (Phase 13). A click on the
  number now opens the entry box to type a new size. A click on the dimension lines only
  selects. Double-click anywhere on the dimension still edits.

### 2026-11-27: Phase 13 started

- Driving dimensions, `constraint.setValue`, distance `axis`, solver pins that refuse a
  conflicting edit, constraint marks, FILE_VERSION 4. Independent of Phases 10–12.
- Review fix: the refusal check looked at every constraint on the sheet and pinned every
  touched entity, whether or not its shape changed. With two constraints that could never
  both be met, moving an unrelated line, or only changing a line's lineweight, was refused
  with a message about the other line. An edit is now refused only for a constraint it broke
  or made worse, and a restyle pins nothing.
- Known and left for the owner: a rectangle is one closed polyline with no horizontal or
  vertical constraints, so typing a new width for a dimension between two of its corners moves
  only the second corner. Phase 13 plans no automatic horizontal/vertical constraints.
  (Resolved the same day: see "Phase 13: rectangle presets" below.)

### 2026-11-27: Phase 12 started

- DXF `DIMENSION` becomes an ArchiLite note bound to geometry (where to measure, never the
  stored number). Overrides, ordinates, unbound defpoints and hatches stay skipped.
  Independent of Phases 10, 11 and 13.
- Review fix: a horizontal or vertical dimension inside a block insert kept its pre-turn axis,
  so a 100 mm line inserted at 90 degrees read 0.00 (and at 45 degrees 70.71). The measuring
  direction now travels through the insert's transform with the points. A direction that ends
  up off both axes is skipped and counted, like any other dimension ArchiLite cannot hold.

### 2026-11-27: Phase 13 planned

- Owner report: a dimension should also constrain, its number should be editable, and
  constrained things cannot be edited. All three reproduced at the engine level (see Phase 13
  in `ROADMAP.md`): placing a dimension adds no constraint, there is no command to change a
  constraint's value, and editing constrained geometry is silently bent (a length-10 line
  scaled by 2 is moved, a fixed-start line moved by (5, 3) becomes a stretch, a joined L bends to
  x 12.4 instead of 14).
- Plan only: no app code. Phase 13 does not wait for Phase 10, 11 or 12.

### 2026-11-27: MTEXT markup follow-up merged

- PR [#17](https://github.com/leon14026/2D-CAD/pull/17) merged to `main`. Alignment, font,
  height and paragraph commands are dropped; `\P` is a newline; `\S1#2;` becomes `1/2`;
  `\U+XXXX` becomes that character.

### 2026-11-27: Review of #17 (MTEXT commands)

- Found: `\U+00B1`-style escapes (how other programs write ±, °, ⌀ in MTEXT) fell into the
  generic "command ends at `;`" rule and either swallowed the text up to the next `;` or left
  `+00B1` in the note.
- Fixed: `\U+XXXX` becomes that character; control codes are dropped.

### 2026-11-27: Phase 12 plan merged

- PR [#16](https://github.com/leon14026/2D-CAD/pull/16) merged to `main`. Docs only; a DXF
  `DIMENSION` is not a live note yet. Independent of Phase 10 (DWG) and Phase 11 (phone).

### 2026-11-27: DXF INSERT explode merged

- PR [#15](https://github.com/leon14026/2D-CAD/pull/15) merged to `main`. Kitchen and bath
  fixtures from DXF `INSERT` explode on import. Dimensions and hatches stay skipped.

### 2026-11-27: Phase 11 plan merged

- PR [#11](https://github.com/leon14026/2D-CAD/pull/11) merged to `main`. Docs only; no phone
  layout yet. Phase 10 (DWG) and Phase 11 (phone) still do not depend on each other.

### 2026-11-26: DXF MTEXT markup

- Follow-up on #15, PR [#17](https://github.com/leon14026/2D-CAD/pull/17).
- Floorplan MTEXT still showed `\A1;` before “PROVIDE 20 MIN. DOOR”
  and a font command on a shear-panel note. Import now drops alignment, font, height and
  paragraph commands; `\P` is a newline; stacked `\S1#2;` becomes `1/2`.

### 2026-11-26: Phase 12 (live DXF dimensions) planned

- Decision, not code. Recorded in PR [#16](https://github.com/leon14026/2D-CAD/pull/16).
  Option 2 from the floorplan review: a DXF `DIMENSION` becomes an
  ArchiLite note that stores where to measure, never the other program's number. Unbound
  defpoints, text overrides, and ordinate dims stay skipped. Hatches stay skipped.
- Independent of Phase 10 (DWG) and Phase 11 (phone). DWG import will use the same mapper
  once this phase has merged. Needs Phase 7, and INSERT explode so fixture geometry can bind.

### 2026-11-26: Review of #15 (DXF INSERT explode)

- Found: explosion repeated a block once per INSERT with no limit. Ten inserts of a block
  that holds ten inserts, seven levels deep, is a million lines from about 3 KB of text
  (4 s to open); one level more ran out of memory. A rows-and-columns INSERT array imported
  one copy and dropped the others without a word.
- Fixed: explosion counts objects and inserts as it goes and refuses the file past 200,000 of
  either, in plain words. Array inserts are skipped and counted.

### 2026-11-26: DXF INSERT explode

- Follow-up on #13, PR [#15](https://github.com/leon14026/2D-CAD/pull/15). Merge #8 then #9
  then #12 then #13 first.
- Kitchen and bath fixtures on the floorplan DXF were INSERT and were skipped. Import now
  reads the BLOCKS section and explodes INSERT (including nested inserts) into
  LINE/CIRCLE/ARC/LWPOLYLINE/TEXT/MTEXT. Missing blocks, cycles, and non-uniform X/Y scale
  are skipped and counted. DIMENSION and HATCH stay skipped.
- The same floorplan now opens as 916 entities and 98 notes, with 89 objects left out.
  Local gate: 1,188 unit tests, 76 browser tests, 122.1 KB gzipped.

### 2026-11-26: Phase 11 (phone browser) planned

- Decision, not code. Recorded in PR #11. The phone is the same site at 700px or narrower: drawing full screen,
  tool strip along the bottom, layers and selection as sheets, two-finger pan and pinch.
  One finger pans when no tool is active, and places a point when a tool wants one.
- It does not use Phase 9 or Phase 10. DWG can be skipped and done later, or done first.
  A phone build without DWG is complete.
- The gate is an emulated 390×844 touch browser in CI, plus the owner's iPhone and Android
  phone (`TEST-BACKLOG.md`). The 300 KB budget and the desk screenshots stay.

### 2026-11-26: DXF text codes, units control, layer-name tooltips

- Follow-up on Phase 9, PR [#13](https://github.com/leon14026/2D-CAD/pull/13). Merge #8 then
  #9 then #12 first.
- After opening a floorplan DXF: room names were showing `%%u`, the file was tagged
  millimetres while drawn in inches with no UI to relabel, and xref layer names ellipsed
  without a tooltip of the full name.
- TEXT/MTEXT drop `%%u`/`%%o` and map `%%c`/`%%d`/`%%p` to Ø/°/±. Status bar unit cycles the
  label without scaling; palette has treat-as and scale-to for each unit. Layer buttons title
  the full name. Local gate: 1,183 unit tests, 75 browser tests, 121.4 KB gzipped.

### 2026-11-26: Review of #12 (Phase 9)

- Found: the constraint solver stopped quietly after 48 rounds or when it stopped improving,
  and nothing told the user when constraints conflicted or were not reached. A conflicting
  pair (radius 3 and radius 4) just left a compromise circle.
- Fixed: `unmetConstraints` in `src/core/doc/constraints.ts`, and a status message from
  `src/app/constraint-warning.ts` after any change that leaves one unmet (M9.5).

### 2026-11-26: Phase 9 gate passed in CI

- Phase gate on #12 is green (Ubuntu runner: 73 browser tests; pan 21.6 ms, zoom 24.7 ms
  per frame). Merge #8 then #9 first.

### 2026-11-26: Phase 9 (blocks, sheets, constraints) started

- Phase 8's PR #9 is still open, so this branch starts from
  `cursor/phase-8-scripting-487f`. Merge #8 then #9 first. This phase is PR #12.
- Built:
  - **Sheets.** Named paper sizes (`Sheet 1` by default). Membership is `obj.sheet ??` the
    first sheet. Status bar button cycles sheets; command palette adds and switches.
  - **Blocks.** Named definitions in local coordinates; inserts share the entity id space.
    Create consumes the selection and leaves an insert. Explode reuses the insert id for the
    first piece. No nested blocks.
  - **Constraints.** Coincident, horizontal, vertical, distance, fix, midpoint, parallel,
    perpendicular, equal, concentric, tangent, radius, length, angle. Re-solved in
    `commitDraft` after every edit, in id order, until the residual stops shrinking.
  - **File format 3.** Version 1 and 2 files still open.
- Decisions:
  - Sheets and blocks are named, not ids. Optional `sheet` is omitted on the first sheet.
  - No extra runtime package. The solver is projection / Gauss-Seidel, deterministic, no
    randomness. Bound point references only.
  - Layout tools sit on the rail (block, insert, coincident, horizontal, vertical, distance);
    the rest are in the command palette.
- Gate (passed in CI, Ubuntu runner: 73 browser tests; pan 21.6 ms, zoom 24.7 ms per frame):
  - Constraints re-solve to the same `saveDocument` after `constraint.solve`.
  - A constrained plate (80 × 50, four hole inserts, a Layout sheet) is built start to finish
    through the command registry and opened in the app.
  - 1,182 unit tests; 73 browser tests; `app-window` refreshed for the Layout rail, sheet
    button and Phase 9 pill (`--repeat-each=5`). 100% line coverage of `src/core` (branches
    98.12%). Size 120.9 KB of 300 KB.
  - Performance with 20,000 entities, GPU off: pan 8.4 ms, zoom 12.4 ms per frame on the
    workspace; pan 21.6 ms, zoom 24.7 ms on the GitHub runner.

### 2026-11-26: Phase 8 (scripting) started

- Phase 7's PR #8 is still open, so this branch starts from
  `cursor/phase-7-import-export-487f`. Merge #8 first. This phase is PR #9.
- Built:
  - **`cad` API** over the command registry: line, circle, arc (degrees), rect, polyline
    (DXF bulges), layer, polar, title, run, print. A script is one undo step.
  - **Script panel** (Script button, backtick, command palette). JavaScript is the default;
    Python loads Pyodide from `./pyodide/` on this origin the first time a Python script runs.
  - **Examples:** bolt circle, flange, slot pattern, each in JavaScript and Python.
- Decisions:
  - Pyodide 0.29.5 (MPL-2.0), unmodified, copied at build time. Not imported into the main
    bundle. `ws` comes with the npm package for Node tests; the page never loads it.
  - Scripts get a best-effort network guard, not a sandbox: JS shadows `fetch`/XHR/WebSocket/
    Worker; Python gets a guarded `js` module and refusing HTTP modules for the length of one
    run, then the real ones are put back (the first version overwrote the page's `fetch`, so
    "Load the example" failed after any Python run). Scripts run with the page's own access and
    can get past the JS guard; the script panel says so.
- Gate (passed in CI, Ubuntu runner: 70 browser tests; pan 10.3 ms, zoom 15.1 ms per frame):
  - JS and Python examples write identical `.archilite` files (`saveDocument`).
  - JS `fetch` and Python `js.fetch` / `urllib` are refused (best effort); the drawing is
    unchanged, and the page's own `fetch` still works after a Python run.
  - Opening the app, and opening the script panel on JavaScript, does not request
    `/pyodide/`. Size 111.9 KB of 300 KB (Pyodide is 12 MB under `dist/pyodide/`, excluded).
  - 1,142 unit tests; 70 browser tests; `app-window` refreshed for the Script button and
    Phase 8 pill (`--repeat-each=5`). 100% line coverage of `src/core` (branches 99.41%).
  - Performance with 20,000 entities, GPU off: pan 7.5 ms, zoom 11.5 ms per frame on the
    workspace; pan 10.3 ms, zoom 15.1 ms on the GitHub runner.

### 2026-11-26: Phase 10 (DWG import) planned

- Decision, not code. DWG import is its own phase. It is read only, and it is not next
  (Phase 8 is next).
- Method: on-demand `cadkit-wasm` (MIT OR Apache-2.0), pinned when the phase is built.
  LibreDWG and libdxfrw stay out (GPL). No cloud converter, and no DWG decoder written in
  this repo. ArchiLite maps model-space lines, circles, arcs, polylines and text the same
  way DXF import does, and explodes block inserts. The gate and the 3 MB on-demand budget
  are in `ROADMAP.md`.
- Until that phase, export DXF from the other program and open that.

### 2026-11-26: Phase 7 (import and export) started

- Phase 6's PR #7 was merged to `main`. This branch starts from that.
- Built:
  - **DXF** text R2000 (AC1015): export LINE, CIRCLE, ARC, LWPOLYLINE (with bulges), layers,
    linetypes; notes as the same primitives the screen draws, plus a HATCH whose boundary is
    the hatch's loops so areas survive. Import of those types and simple TEXT/MTEXT; unknown
    objects skipped and counted; binary DXF refused.
  - **SVG** at 1:1 millimetre size; y converted in JavaScript so a viewer that ignores
    transforms still measures true sizes. Circles and arcs are cubics so a y-flip cannot
    reverse sweep.
  - **PDF** at 1:1 (`72/25.4` pt per millimetre). A 100 mm line is 283.4646 pt. Helvetica
    (a standard PDF font) so the file stays small; the scale is the gate, not the typeface.
  - **PNG** from the Canvas 2D painter: paper colour, no grid, rulers or tool rail.
  - **In the app:** Export next to Save (DXF, SVG, PDF, PNG); Open and drop accept `.dxf`;
    palette entries; a refused DXF is explained in the toast.
- Decisions:
  - No new runtime package. `ezdxf` is CI-only, like `shapely`.
  - Native `.archilite` stays in `src/core/doc/file.ts`. DXF/SVG/PDF live in `src/io`; PNG
    in `src/render/png.ts` because it needs a canvas.
  - Hatch under dimension text is unchanged: exports match the screen (see Phase 6).
  - Notes do not round-trip as dimensions: they export as exploded line work, text and
    hatches. Geometry round-trips.
- Gate (passed in CI, Ubuntu 26.04 runner: 66 browser tests; pan 17.4 ms, zoom 23.5 ms per frame):
  - **ezdxf + shapely:** 100 mm line at (0,0)–(100,0); bracket outline 5978.539816 mm² and
    slot 278.539816 mm² with four Ø8 holes; annotate hatch 2400 − 41π. Worst hatch-oracle
    relative difference still 4.12e-11.
  - **PDF:** 100 mm line measures 283.4646 pt (unit test and in the browser).
  - 1,128 unit and property tests; 66 browser tests; 10 approved screenshots (`app-window`
    refreshed for the Export button and Phase 7 pill). 100% line coverage of `src/core`
    (branches 99.41%).
  - Size 103.8 KB of 300 KB. Performance with 20,000 entities, GPU off: pan 7.8 ms, zoom
    11.8 ms per frame on the workspace; pan 17.4 ms, zoom 23.5 ms on the GitHub runner.
- Found and fixed while building:
  - LWPOLYLINE group 42 (bulge) is written on every vertex. Omitting zero bulges shifted
    later non-zero bulges onto the wrong vertices on import.
  - PDF has no `arc` operator; dots and circles are cubic Béziers. The file is ASCII so a
    UTF-8 download keeps xref offsets equal to byte offsets.

### 2026-11-26: Phase 6 (annotation) complete, PR #7

- Started after PRs #2 to #6 were merged to `main` at your request, so the branch starts from
  `main`.
- Built:
  - **Notes**, a second kind of object in the drawing (`Doc.notes`) for everything that explains
    the geometry: linear, aligned, radius, diameter and angle dimensions, text, leaders, centre
    marks, hatches and title blocks. They share ids, layers and draw order with entities.
  - **Dimensions are associative.** A dimension stores where to measure (an end, a vertex, a
    midpoint, a centre, or a free point), never the number. The number is measured from the
    geometry every time, so it can't disagree with the drawing, and it follows the geometry
    when it is moved, scaled, trimmed or edited. Delete the geometry and the dimension goes
    with it; undo brings both back.
  - **Dimension styles** with ISO-style defaults (text 3.5, arrows 3, 2 decimal places), editable
    in the selection panel and saved under their own or a new name.
  - **Hatch** with ArchiLite's own patterns (solid, lines, cross lines, paired lines, dots),
    with islands left clear; its area is exact (outer area less the islands').
  - **Title blocks** on A4 to A0 sheets (own layout, eight fields filled in from the panel).
  - **File format 2** (`docs/file-format.md`). Version 1 files still open.
  - **In the app:** an Annotate group on the tool rail; D, X and H for linear dimension, text and
    hatch; palette entries for every tool; a selection panel that shows what a note measures and
    lets you edit its fields.
- Decisions:
  - A dimension's line position (`at`) stays where it was when only the geometry moves; it moves
    with the geometry when both are selected.
  - Copying a selection copies text, leaders and title blocks but not dimensions, centre marks
    or hatches (they belong to their geometry; the copy of the geometry needs its own).
  - Where a hatch and a boundary are equally near a click, the boundary is picked.
  - The tool rail continues in a second column on short windows instead of scrolling, so no
    tool is hidden; fit leaves room for it.
- Gate (passed in CI, Ubuntu 26.04 runner: 61 browser tests; pan 12.2 ms, zoom 17.1 ms per frame):
  - **500 random cases:** every dimension (linear, aligned, radius, diameter, angle) shows
    exactly the value measured from its geometry.
  - **500 random cases each:** dimensions follow their geometry after move, rotate, scale and
    mirror, and undo restores the drawing exactly. Trim, extend, explode, delete and copy are
    checked with hand-calculated cases (trimming a line from 100 to 40 makes its dimension read
    40.00, and so on).
  - **Hatch areas** match `shapely` in 60 seeded cases (rectangles, regular polygons, circles,
    rounded rectangles and slots, each with circular islands); worst relative difference
    4.12e-11. CI runs the check in its own step.
  - **Reference drawing** (`tests/fixtures/annotate-reference.ts`), one of every annotation:
    through the engine it equals the approved file exactly and every number it shows equals its
    hand-worked value (60.00, 28.28, 45.0°, Ø8.00, R5.00, hatch area 2400 − 41π); typed and
    clicked into the real app it equals the same file exactly.
  - 100% line coverage of `src/core` (branches 99.41%). 1,110 unit and property tests; 61
    browser tests; 10 approved screenshots (new: the annotation reference drawing).
  - Performance with 20,000 entities, GPU off: pan 10.5 ms, zoom 17.7 ms per frame on the
    workspace. 95.1 KB of the 300 KB budget.
- Found and fixed while building:
  - **Clicking a hatch's edge picked the hatch** instead of the line under it. A hatch lies
    under geometry, so a boundary now wins a tie. (My first fix clamped every hatch distance,
    which made a click inside an island pick the hatch; the bias now applies only inside the
    pick radius.)
  - **The text tool crashed** drawing its preview when the cursor sat on the text's first point.
  - **The tool rail ran off the bottom** of a 720 px window once the Annotate group was added,
    hiding five tools behind a scroll. It now wraps into a second column, and fit measures the
    rail so the drawing doesn't start underneath it.
  - **A screenshot flaked** (about 1 run in 6) because the clip's first pixel row caught the
    ruler's tick marks. The clip now starts 2 px inside the ruler band.
  - Two browser tests were too loose for the new panel (`getByRole('option')` also matched the
    dimension-style list; a click at a hole's rim also hit its centre line) and the "newer
    version" tests used file version 2, which is now the current version; they use 3.
- Known limitation: hatch lines run under dimension text rather than stopping short of it (see
  ROADMAP.md). Text stays legible but isn't ISO-clean.

### 2026-11-25: Phase 5 (modify tools) complete, PR #6

- Started once Phase 4's gate passed in CI, on a branch from it.
- Built:
  - **Geometry** (`src/core/geom`):
    - offset, with mitre and round joins;
    - trim and extend on exact intersection points;
    - fillet and chamfer for two lines and for polyline corners;
    - join (chaining pieces end to end in any order and direction) and explode.
  - **Ten new undoable commands** (`src/core/doc/edit-commands.ts`): offset, trim, extend,
    fillet, chamfer, round or cut every polyline corner, arrays (rectangular and polar), join
    and explode.
  - **Fourteen tools:** move, copy, rotate, scale, mirror, offset, trim, extend, fillet,
    chamfer, both arrays, and round or cut every corner.
    - Selection tools use what is selected, or ask for a selection first.
    - Pick tools take clicks on objects and repeat until Enter.
  - **In the app:** a Modify group on the tool rail; buttons in the selection panel (move,
    copy, rotate, scale, mirror, arrays, join, explode, round off, delete); the Delete key;
    palette entries for everything.
- Decisions:
  - Keys: M move, O offset, T trim, E extend, Delete deletes the selection. The other modify
    tools are on the rail, in the selection panel and in the command palette.
  - Mirror keeps the originals unless K is pressed.
  - Fillet's default radius is 0, which joins two lines in a sharp corner.
- Gate (passed in CI, Ubuntu 26.04 runner: 53 browser tests; pan 10.9 ms, zoom 15.6 ms per frame):
  - **Offsets:** 10,000-case property tests. Each offset line, circle and arc is at exactly the
    set distance. Each edge of an offset convex polygon, inwards and outwards, is the distance
    from its own edge, and no part of the offset comes closer.
  - **Trim and extend:** every new end lies on a cutting or boundary edge (10,000 random
    cases each, mixing lines, circles, arcs and polylines).
  - **Fillets:** tangent at both ends (radius square to each line, at the radius), for two
    lines and for every corner of random convex polygons.
  - **Reference drawing** (`tests/fixtures/modify-reference.ts`), made with every modify tool:
    - through the engine, it equals the approved file exactly, and all 25 hand-worked shapes
      to 1e-9;
    - typed and clicked into the real app, it equals the same file exactly.
  - 100% line coverage of `src/core`. 934 unit and property tests; 52 browser tests; 9 approved
    screenshots (new: the reference drawing).
- Found and fixed while building:
  - **Trimming a circle** kept only half of the remaining arc when the kept part wrapped past
    0°. Circles are now trimmed as one arc.
  - **Fillet points** came out at 2.0000000000000004 instead of 2 at a square corner, because
    tan(π/4) is not exactly 1 in floating point. The tangent distance now uses
    r (1 + cos θ) / sin θ, and the centre is set square off the first tangent point, so square
    corners are exact and tangency holds by construction.
  - **Mitres** were computed on long extended lines and lost digits (11.000000000000007).
    Lines now meet by a direct formula that keeps horizontal and vertical lines' exact
    coordinates.
  - **Half-circle bulges** were 0.9999999999999999; `sweepToBulge` now gives exactly ±1.
  - A Phase 2 test used `entity.explode` as its example of an unknown command; it now uses a
    made-up name.

### 2026-11-25: Phase 4 (precision drafting) complete, PR #5

- Owner asked for Phases 4 and 5 in one go. Each still gets its own branch and pull request, and
  Phase 5 starts only after Phase 4's gate passes in CI.
- Built:
  - **Drafting engine** (`src/core/tools`, pure and fully tested): typed points and numbers,
    ortho and polar tracking, and tools as state machines that return undoable commands.
  - **Seven drawing tools:** line, polyline, circle, arc through three points, arc from its
    centre, rectangle and regular polygon.
  - **Analytic snaps** (`src/core/spatial/snap.ts`): endpoint, intersection, midpoint, centre,
    quadrant, perpendicular, tangent and nearest.
  - **In the app:** a tool rail and a box beside the cursor that shows the prompt, takes typed
    input, gives the distance and angle from the last point, and explains refusals.
    - Snap markers with their names, and dotted brass tracking lines.
    - Status bar toggles for snaps, ortho and tracking; command palette entries for every tool,
      snap kind and tracking angle.
- Decisions:
  - Single-letter keys start tools: L line, P polyline, C circle, A arc, R rectangle,
    N polygon.
  - The panel toggles moved from L and P to `[` and `]`. Shift+S, Shift+O and Shift+T toggle
    snaps, ortho and tracking; holding Shift forces ortho.
  - Tracking is on at 15° by default. Snaps are on by default, all except nearest.
- Gate (passed in CI, Ubuntu 26.04 runner: pan 18.1 ms, zoom 27.3 ms per frame):
  - The reference part (`tests/fixtures/reference-part.ts`), a plate with holes, a slot, a
    hexagon, a triangle and an arc, drawn by typed input alone, matches its hand-worked
    specification to 1e-9: in the engine, and again typed into the real app.
  - The snap matrix: every snap kind on all 5 entity types, with each of the 5 types crossing
    it, plus intersections for all 15 pairs of types at hand-calculated points.
  - 100% line coverage of `src/core`, now including `tools`. 795 unit and property tests.
  - 47 browser tests and 8 approved screenshots. The new screenshot shows a line being drawn,
    with a snap marker.
  - Performance with 20,000 entities: pan about 11 ms per frame, zoom about 17 ms; the budget
    is 33.3 ms.
- Found and fixed while building:
  - **Speed:** the first CI run failed the performance gate: zoom averaged 34.6 ms per frame on a
    slow runner, against 33.3 ms. Timing showed two thirds of each frame was JavaScript, not
    drawing. Three changes cut frames by about 45% (pan 21 → 11 ms, zoom 24 → 17 ms locally),
    with all 8 screenshots unchanged:
    - Draw order is sorted once per drawing, not every frame.
    - Entities that take their style from their layer skip building a text key per entity.
    - When the whole drawing is on screen, the spatial index isn't searched.
    - Also, shapes smaller than 16 px on screen are drawn without their dash pattern, which
      can't be seen at that size.
  - **Tracking:** a vertical line through (1.1, 2.2) came out at y = -30.000000000000004 rather
    than -30, from projecting through the base point. On horizontal and vertical lines the
    tracker now keeps the cursor's own coordinate, so axis-aligned points are exact.
  - **Viewer tests:** two had boundaries that depended on rounding. Moving the fitted view (for
    the rail) exposed them: a selection box edge sat exactly on a centre line, and a pan was
    compared at 1e-6 px when browsers report mouse positions in single precision. Both now test
    what they meant to test.

### 2026-11-25: Phase 3 (viewer) complete, PR #4

- Built:
  - The first usable app: open, view, pan, zoom and select drawings.
  - Spatial index (`src/core/spatial`) with window, crossing and pick selection.
  - Canvas 2D renderer with culling, batching and level of detail.
  - Steel-rule rulers.
  - Layers panel: show, hide, lock and set current, all undoable.
  - Selection properties panel.
  - Command palette (Ctrl+K), keyboard shortcuts, open, save and drag-and-drop.
  - A 20,000-entity test drawing, generated at build time.
- Design system v0: drafting film, graphite, layout-fluid blue, brass, and the B612 typeface
  (OFL-1.1), the first third-party item shipped. Added to `NOTICE` and `ATTRIBUTION.md`, with
  its licence text.
- Gate (passed locally):
  - 20,000 entities with the GPU disabled: pan about 20 ms per frame (45–53 fps), zoom about
    23 ms (41–43 fps). Budget: 33.3 ms.
  - Selection correct in hand cases, in 10,000-case property tests against brute force, and
    with real mouse drags.
  - 7 approved screenshots.
  - Cold start under 2 s.
  - 100% line coverage of `src/core`.
  - The app downloads as 64 KB.
- Found and fixed while building:
  - **Speed:** thick lines with rounded ends made 20,000-entity frames take 55–70 ms in software
    rendering. Square ends, hairlines under 1.5 px and hairlines for shapes under 16 px on
    screen brought frames to about 20 ms.
  - **Selection:** a property test caught the spatial-index pre-filter missing a shape that
    sat exactly on a box edge (within tolerance).
  - **Legibility:** B612 Mono puts its decimal point at the left of a wide slot ("5978. 540"), so
    it was dropped. B612's own digits are all one width.
  - **Design:** the warm cream paper colour from earlier phases is the most common
    AI-generated default, so it was replaced with a cool drafting-film colour.
  - **Architecture guard:** it flagged the word "window" (window selection) inside a string;
    it now ignores comments and strings, with a test proving it still catches real use.
  - **Performance test:** it let the drawing drift off screen, so frames looked cheaper than
    they were. Each timing run now starts fitted and swings back and forth.
- Playwright is pinned to 1.63.0 so CI uses the same Chromium build (153) as the screenshot
  baselines.
- **First CI run:** everything passed except the whole-window screenshot, where 6,385 pixels
  of text differed. In CI, pan averaged 30.9 ms and zoom 27.2 ms, within the 33.3 ms budget
  (GitHub's runners are slower than the workspace).
  - Cause, found by printing CI's screenshot into the job log and comparing: the
    workspace's Chromium is a wrapper script that silently adds
    `--font-render-hinting=none --disable-lcd-text --force-color-profile=srgb`, and GitHub's
    runner runs the stock browser. Every piece of text came out slightly wider in CI; lines
    and shapes matched exactly. Running the unwrapped browser here reproduced CI's 5,236
    differing pixels exactly.
  - Smaller causes: the workspace swaps in its own fonts (Anonymous Pro for Consolas, Inter
    for sans-serif), and the build label's commit id differs per build.
  - Fix: `playwright.config.ts` now passes those switches itself and points Chromium at its
    own font setup (`tests/e2e/fonts.conf`); the build label gets a fixed text in that
    screenshot. A wrong first guess (the runner's Ubuntu version) was tried and reverted.
  - CI now prints failed screenshots into the job log, since the report artifact can't be
    downloaded from the workspace.
- **Gate passed in CI** (Ubuntu 26.04 runner): 37 browser tests, all 7 screenshots matching.
  With 20,000 entities and the GPU off, pan averaged 23.7 ms per frame (42 fps) and zoom
  25.9 ms (39 fps), against a budget of 33.3 ms; the app was ready in 574 ms. Across the five
  CI runs, pan ranged from 17.2 to 30.9 ms and zoom from 18.7 to 27.2 ms, so GitHub's
  machines vary by run.

### 2026-11-25: Phase 2 (document model) complete, PR #3

- Built `src/core/doc`:
  - Drawings with layers and entities, sharing one id space.
  - Colours, ArchiLite's own linetypes (ISO 128-20 proportions) and ISO lineweights, each
    settable per layer or per entity.
  - 11 validated commands, with undo/redo that stores only the changes (limit 1,000 steps).
  - The `.archilite` file format: canonical JSON, one layer or entity per line, versioned, strict
    validation with errors that name the exact field.
- Also added:
  - An example bracket drawing, built entirely by commands.
  - The file-format guide (`docs/file-format.md`).
  - A file inspector page (`/inspect.html`) for checking files in the browser.
- Gate (passed in CI):
  - 10,000 random documents round-trip exactly.
  - 20 sequences of 1,000 random edits undo and redo exactly, checked at every step.
  - 35+ named malformed files are refused with clear messages.
  - 20,000 randomly damaged files either load cleanly or are refused; none crash.
  - 100% line coverage of `src/core`.
- Found while building:
  - The inspector's error box reused the main page's status-bar class name and rendered sideways.
  - The extents printed "-0.000".
  - Both fixed; a browser test now guards the second.

### 2026-11-25: Phase 2 started

- Branched from the Phase 1 branch because PR #2 is still open.
- Added `CLAUDE.md`, `PROGRESS.md` and `TEST-BACKLOG.md` (to Phase 1's PR, so they land with it).
- You confirmed GitHub Pages is set to Source: GitHub Actions. The built-in branch build that ran
  once on the Phase 0 merge should not run again.

### 2026-11-25: Phase 1 (geometry kernel) complete, PR #2

- Built `src/core/geom`:
  - Shapes: lines, circles, signed-sweep arcs, and polylines with DXF-style bulges.
  - Constructions: 3-point circle and arc, arc from a centre.
  - Measurements: length, bounds, closest point, signed polyline area.
  - Intersections for every shape pair.
  - Transforms: translate, rotate, scale, mirror, with inverses.
  - Units: mm, cm, m, in and ft, using exact micrometre factors.
  - Tolerance model: 1e-9 × size.
- Gate (all passed in CI):
  - 254 hand-calculated tests, accurate to 1e-9.
  - 16 property tests × 10,000 cases.
  - 100% line, statement and function coverage.
  - Architecture guard: the kernel uses no DOM and imports nothing outside itself.
- Bugs that property tests found and fixed:
  - Closest point overflowed to Infinity for points about 1e-323 from a circle's centre.
  - The same calculation lost precision for subnormal offsets, landing 0.3% off the circle.
  - The snap to exact 90° steps was too wide (1e-12 rather than 1e-14) and could move a point by
    ~1e-9.
- Hardening: circle–circle intersection uses Kahan's stable Heron formula for near-tangent circles.
- Property tests ran in 157 s; building random polylines by construction instead of by rejection
  brought them under 12 s.

### 2026-11-25: Phase 0 (foundations and compliance) complete, PR #1, merged

- Decisions: build our own TypeScript engine (no CADCraft fork); name ArchiLite; licence MIT OR
  Apache-2.0; Python via Pyodide.
- Built:
  - Licence files, `NOTICE` and `ATTRIBUTION.md`.
  - Licence gate, brand guard and 300 KB size budget.
  - Canvas 2D app shell with a mm grid and cursor readout.
  - CI on pull requests; Pages deploy from `main` after the gate.
- Gate (all passed):
  - 98 unit tests.
  - 7 browser tests in GPU-disabled Chromium.
  - Licence gate proven to reject GPL.
  - Live site loads.
- Bug found and fixed: grid indices could be `-0`, so the axis line was drawn as an ordinary grid
  line.
- Name check: no existing software called ArchiLite. The nearest names in the same field are
  ARCHLine.XP LT and Archicad. Run a trademark search before any launch beyond GitHub (see
  TEST-BACKLOG M0.7).
