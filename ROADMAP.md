# ArchiLite roadmap

ArchiLite is a lightweight, browser-based 2D CAD application for engineering drawings. It runs
entirely in the browser from a static site (GitHub Pages), processes everything locally, and needs
no dedicated graphics card.

**Stage:** see [PROGRESS.md](PROGRESS.md) for where the project stands and
[TEST-BACKLOG.md](TEST-BACKLOG.md) for the owner's manual tests. Working conventions for Claude are in
[CLAUDE.md](CLAUDE.md).

## Decisions (recorded 2026-11-25)

| Decision | Choice | Why |
|---|---|---|
| Engine | Our own TypeScript engine; no fork | CADCraft (the inspiration) is ~320k lines of Rust targeting full AutoCAD parity, ships a ~13 MB WebAssembly build and renders through WebGPU/WebGL2. That conflicts with "lightweight", "no dedicated GPU" and "inspired, not copied". |
| Name | ArchiLite | Owner's choice. Defined once in `src/app/brand.ts` so it is a one-line change if a trademark search ever requires it. |
| Licence | MIT OR Apache-2.0 | Same terms as CADCraft, so any algorithm adapted from it needs no relicensing; Apache-2.0 adds an explicit patent grant. |
| Python scripting | Pyodide (CPython in WebAssembly), lazy-loaded | Real Python running locally in the browser; downloaded only when the script panel is opened. |
| Rendering | Canvas 2D | Works with integrated graphics or pure software rendering. |
| Hosting | GitHub Pages, built by GitHub Actions | Static files only; nothing to install on the user's machine. |

## Constraints (non-negotiable)

1. **Browser-only and local.** No server-side code. Drawings never leave the machine unless the user
   exports them.
2. **No dedicated GPU.** Every automated browser test runs in Chromium with the GPU disabled.
3. **Lightweight.** Budgets below are enforced in CI.
4. **Original design.** Own name, palette, icons, layout and interaction model (command palette and
   cursor-side coordinate entry, not a ribbon and bottom command line).
5. **Clean licensing.** Only permissively licensed code and assets ship; see Compliance.
6. **Engineering-grade accuracy.** See Accuracy model.

## Budgets (enforced in CI)

| Budget | Limit | Enforced from |
|---|---|---|
| App download (JS + CSS + HTML, gzipped, excluding Pyodide and the DWG decoder) | ≤ 300 KB | Phase 0 |
| Runtime dependencies shipped to users | 0 until a phase justifies one; each must pass the strict allowlist | Phase 0 |
| Pan/zoom on a 20,000-entity drawing, Chromium with GPU disabled | ≥ 30 fps | Phase 3 |
| Cold start to interactive | ≤ 2 s on a typical laptop | Phase 3 |
| Pyodide | loaded only on demand; never part of the base budget | Phase 8 |
| DWG decoder | loaded only when a `.dwg` is opened; ≤ 3 MB transferred; never part of the base budget | Phase 10 |

## Accuracy model

- Geometry is stored in real drawing units (mm by default, inch optional) as IEEE-754 doubles —
  never in screen pixels.
- Arcs and circles are stored as true arcs (centre, radius, start/end angle), never as polylines.
- Transforms are applied to defining points; matrices are never compounded across edits.
- Snaps are computed analytically (endpoint, midpoint, centre, intersection, perpendicular,
  tangent, quadrant, nearest), not by pixel picking.
- Dimension values are always measured from geometry and cannot be overtyped.
- Tolerance: linear `1e-9 × max(1, drawing extent)`; angular `1e-12` rad.
- Independent oracle: exported DXF is checked in CI by Python (`ezdxf`, `shapely`), not only by our
  own code.

## Architecture

```text
src/
  core/      geometry kernel, document model, commands  — no DOM; runs in Node, browser or a worker
  io/        DXF, SVG, PDF (native .archilite stays in core/doc)
  render/    Canvas 2D renderer, viewport transform, spatial index, PNG export
  ui/        ArchiLite's own interface and design tokens
  script/    JavaScript API and the Pyodide bridge (same commands as the UI)
  app/       wiring, brand constants, entry point
```

Rule: nothing in `core/` imports from `render/`, `ui/` or the DOM. Every user action is a named
command with typed parameters, so the UI, keyboard, scripts and tests all go through one path.

## Compliance

- **Licence files:** `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ATTRIBUTION.md`.
- **Licence gate (CI):** runtime dependencies must be on a strict permissive allowlist; development
  tools must carry a licence and must not be strong copyleft (GPL, AGPL, LGPL, SSPL and similar).
  The gate has its own tests proving it rejects a GPL package.
- **Brand guard (CI):** application source and UI must not use Autodesk, AutoCAD, ArtCraft or
  CADCraft names. They may appear only in nominative statements in documentation
  (`README.md`, `NOTICE`, `ROADMAP.md`, `ATTRIBUTION.md`).
- **Never use:** the ArtCraft/CADCraft names or logos (their trademark licence requires forks to
  remove them); Autodesk names in the product name; Autodesk icons, screenshots, ribbon layout,
  SHX fonts, `.pat` hatch files or `.lin` linetype files; GPL-licensed libraries (LibreDWG, for
  example, is GPL-3.0 and would force ArchiLite to be GPL).
- **Adapted code:** any algorithm adapted from CADCraft (MIT OR Apache-2.0) keeps a header naming
  the source file and copyright holder, and is listed in `NOTICE`.
- **Fonts:** the UI uses B612 (OFL-1.1), shipped as WOFF2 with its licence text, listed in
  `ATTRIBUTION.md` and `NOTICE`. Any other font must be OFL-1.1 or more permissive and listed the
  same way. Code-like text (file contents, key names) uses the system's monospace font.
- **Interoperability:** ArchiLite reads and writes DXF, a publicly documented format. DWG import
  is Phase 10: read only, on demand, through a permissive decoder. DWG export stays out of scope.
  LibreDWG stays forbidden.
- **Name:** before any public launch beyond GitHub, run a trademark search for "ArchiLite" in
  classes 9 and 42 on the Canadian (CIPO) and US (USPTO) registers.

## Phases

Each phase ends with a gate. The next phase does not start until every gate check passes.

### Phase 0 — Foundations and compliance

Builds: licence files and notices, README with disclaimer, Vite + TypeScript app shell with a
Canvas 2D page, CI workflow, GitHub Pages deploy workflow, licence gate, brand guard, size budget.

Gate:
- [x] Typecheck, unit tests, licence gate, brand guard, build and size budget pass in CI.
- [x] Licence gate tests prove a GPL dependency is rejected.
- [x] Browser test: the built page loads in Chromium with the GPU disabled, the canvas draws, and
      there are no console errors.
- [x] The GitHub Pages URL loads (https://leon14026.github.io/2D-CAD/).

### Phase 1 — Geometry kernel (no UI)

Builds: vectors and points, lines, circles, arcs, polylines with bulges, intersections, distances
and angles, transforms, tolerance model, units.

Gate:
- [x] 150+ unit tests with hand-calculated answers, accurate to 1e-9 (254).
- [x] Property tests (10,000 random cases each): rotate 360° is identity; mirror twice is identity;
      move then move back is identity; intersection points lie on both curves (16 properties).
- [x] 100% line coverage of the kernel (enforced in CI).
- [x] Architecture guard: `src/core` imports nothing outside itself and uses no DOM globals.

Implementation notes (for later phases):
- Shapes are immutable plain objects: `segment`, `circle`, `arc` (start angle in [0, 2π) plus a
  signed sweep, positive = counter-clockwise, 0 < |sweep| < 2π) and `polyline` (vertices with
  DXF-style bulges). Constructors validate input and throw `RangeError`.
- Bulge `b` on edge p1→p2: sweep = 4·atan(b); radius = c(1 + b²) / (4|b|) for chord length c;
  centre = midpoint + perp(p2 − p1) × (1 − b²) / (4b), where perp is the left normal.
- `cosSin` snaps to exact values at whole quarter turns (window `QUARTER_TURN_SNAP` = 1e-14
  relative), so rotating by 90° gives exact coordinates.
- Circle–circle intersections use Kahan's stable Heron formula (`triangleHeight`), which stays
  accurate for near-tangent circles.
- Points are projected onto circles with a scaled normalisation that stays accurate for tiny
  (subnormal) offsets; property tests found the naive version overflowing and losing precision.
- Overlapping curves (collinear segments, arcs on the same circle) report the endpoints of either
  curve that lie on the other.

### Phase 2 — Document model, native file format, commands

Builds: entity store, layers, linetypes, lineweights, colours, undo/redo, versioned JSON file
format with schema validation, command registry. Added: an example drawing
(`public/examples/bracket.archilite`), the file-format guide (`docs/file-format.md`) and a file
inspector page (`inspect.html`) so the owner can test files in a browser.

Gate:
- [x] Save → load round-trip produces an identical document (10,000 random documents, plus
      hand-built edge cases).
- [x] 1,000 random edits, all undone, return exactly to the starting state; redo replays exactly
      (20 sequences of 1,000 edits, checked at every step).
- [x] Malformed or future-version files are rejected with a clear message (35+ named cases, plus
      20,000 randomly damaged files that must load cleanly or be refused, never crash).
- [x] 100% line coverage of `src/core` (kernel and document model).

Implementation notes (for later phases):
- `src/core/doc` holds the document: `Doc` (settings, `nextId`, layers, entities),
  `Session` (doc plus undo/redo stacks) and the command registry (`COMMANDS`). Everything is
  immutable; `execute(session, id, params)` returns a new session plus the command's result.
- Every command validates its parameters (even from typed callers) and throws `CommandError`
  with a plain message. A failed or no-op command leaves the session object unchanged.
- Undo stores changes (before/after per entity, plus layers, settings and `nextId`), not
  whole documents. Default limit: 1,000 steps.
- Commands: `entity.add`, `entity.delete`, `entity.transform`, `entity.copy`,
  `entity.setProps`, `layer.add`, `layer.update`, `layer.delete`, `layer.setCurrent`,
  `doc.setTitle`, `doc.setUnits` (with `convert` to keep real sizes or relabel only).
- Locked layers: entities on them can't be added, changed or deleted, except by
  `doc.setUnits`, which rescales the whole drawing.
- Layers and entities share one id space. New entities get `z = id`. Draw order is z, then id.
- Linetypes are ArchiLite's own, from ISO 128-20 proportions; lineweights are the ISO series in
  mm on paper. Layer names are unique ignoring case.
- Untrusted data (files, script parameters) goes through `src/core/doc/validate.ts`, which reports
  a path such as `entities[3].geom.radius`.
- The example drawing is built by commands in `tests/unit/core/doc/example-bracket.ts`. Run
  `UPDATE_EXAMPLES=1 npx vitest run tests/unit/core/doc/example.test.ts` to regenerate it after
  a format change.
- The inspector builds its page with `textContent` only, never `innerHTML`, because file
  contents are untrusted.

### Phase 3 — Viewer (first usable app)

Builds: Canvas 2D renderer, world↔screen transform, grid, spatial index, pan/zoom, window and
crossing selection, ArchiLite UI shell and design system v0. Added:
- steel-rule rulers;
- layers panel (show, lock, set current: all undoable);
- selection properties panel;
- command palette (Ctrl+K);
- open, save, drag-and-drop and the examples;
- keyboard shortcuts;
- a 20,000-entity test drawing generated at build time.

Gate:
- [x] GPU-disabled Chromium: 20,000-entity drawing pans and zooms at ≥ 30 fps (average frame
      ≤ 33.3 ms, every entity on screen, timed until the pixels are ready).
- [x] Selection returns the correct entity IDs for window and crossing boxes (hand cases,
      10,000-case property tests against brute force, and real mouse drags in the browser).
- [x] Screenshot comparison tests pass (7 approved images).
- [x] Cold start to interactive ≤ 2 s.
- [x] 100% line coverage of `src/core` (now including `spatial`).

Implementation notes (for later phases):
- **Spatial index:** `src/core/spatial`.
  - `PackedRTree` is a static, STR-packed R-tree.
  - `DocIndex.of(doc)` builds one index per document object, rebuilt after each edit (about
    44 ms for 20,000 entities).
  - Entity bounds are cached per geometry object, so unchanged shapes are not measured again.
  - If editing large drawings feels slow, make the index incremental.
- **Selection rules:** `select.ts`.
  - Window: entirely inside the box. Crossing: inside or touching.
  - Pick: the nearest entity within 6 px; ties go to the entity drawn on top.
  - Hidden and locked layers are never selected.
  - The index pre-filter is widened by the drawing's tolerance; a property test caught it missing
    a shape exactly on a box edge.
- **Rendering:** `src/render/scene.ts`.
  - Coordinates are converted to device pixels in JavaScript (doubles).
  - Consecutive entities with the same style share one path and one stroke.
  - Entities are culled by the index.
  - Square line ends; lines under 1.5 px and shapes under 16 px on screen are drawn as hairlines;
    anything under 1 px is drawn as a dot.
  - Why: in software rendering, a 1.9 px line with rounded ends costs about 14 times as much as
    a hairline. Before this rule, 20,000 entities took 55–70 ms a frame; after it, about 20 ms.
- **Views:** a main canvas (paper, grid, entities) and an overlay canvas (rulers, hover, selection
  box). Hover and drag feedback redraw only the overlay.
- **App state:** `src/app/store.ts`, a single immutable state object with subscribers.
  - All user actions live in `src/app/actions.ts`; buttons, keys and the palette all call it.
  - Layer show, hide and lock are document commands, so they can be undone.
- **Test hook:** `src/app/testing.ts` (`window.__archilite`) is installed only when the URL has
  `?test`. Browser tests use it to load large drawings and time frames.
- **Design system v0:** `src/ui/theme.css`.
  - Colours: drafting film `#e9edeb`, graphite ink `#1d2a33`, layout-fluid blue `#2a3fb0` for
    selection and focus, brass `#a8740f` for the crossing box.
  - Steel rules along the drawing area's edges.
  - Typeface: B612, whose digits are all one width, so numbers never jitter.
  - Copy is in sentence case: no ALL-CAPS labels and no "A · B" meta strings.
- **Screenshots:** Playwright is pinned to 1.63.0 (Chromium 153.0.8010.12), the same build in
  the cloud workspace and in CI, so approved images match exactly.
  - Upgrading Playwright means regenerating them:
    `npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots`.
  - Then look at every image before committing.
  - Text rendering must match too. The workspace's Chromium is a wrapper script that adds
    `--font-render-hinting=none --disable-lcd-text --force-color-profile=srgb`; GitHub's
    runner uses the stock browser. `playwright.config.ts` passes those switches itself
    (`TEXT_SWITCHES`) and points Chromium at `tests/e2e/fonts.conf`, so system fonts and
    smoothing are the same everywhere. Text that changes per build (the build label) gets a
    fixed value before a screenshot. Lines and shapes were never affected.

### Phase 4 — Precision drafting

Builds: line, polyline, circle, arc, rectangle, polygon; all snaps; ortho and polar tracking;
typed absolute, relative (`@dx,dy`) and polar (`@d<a`) input. Added:
- two arc tools (through three points, and from the centre with a typed angle);
- a single typed distance along the cursor or tracking direction;
- a tool rail and a box beside the cursor for typed input, prompts and errors.

Gate:
- [x] A reference part drawn by typed input alone matches its specification to 1e-9.
- [x] Every snap type is tested against every pair of entity types.

Implementation notes (for later phases):
- **Tools are pure state machines** in `src/core/tools` (no DOM).
  - Each asks for one thing at a time (`Prompt.accepts`: point, number, point or number, a
    selection, or a pick) and returns document commands. It never edits the drawing itself, so
    every object is one undo step.
  - `drafting.ts` runs tools against a session: `feed` (click, number, option, Enter) and
    `feedTyped` (text). A refused input changes nothing and explains why in plain words. The
    app and the tests both drive tools through it.
  - Every tool shares one state shape (`ToolState`: step, points, values, picks, flag, count).
  - Values tools remember (last radius, polygon sides) live in `ToolMemory`. Phase 5 adds its
    own (offset distance, fillet radius).
- **Typed input:** `input.ts`.
  - Forms: `x,y`, `@dx,dy`, `@d<a`, `d<a`, and a bare number.
  - A bare number is a value where the step wants one (radius, sides, angle). Where it wants a
    point, it is a distance along the tracking line, or towards the cursor.
  - Angles are typed in degrees. Quarter turns are exact: `cosSin` snaps them.
- **Snaps:** `src/core/spatial/snap.ts`.
  - All analytic: endpoint (every polyline vertex), midpoint, centre, quadrant, intersection,
    perpendicular and tangent from the last point, and nearest.
  - The nearest snap point within 10 px wins; ties go by the order in `SNAP_KINDS` (endpoint
    first).
  - With nearest off, a cursor resting on a circle or arc snaps to its centre.
  - Snaps see visible layers, locked ones included.
  - Nearest is off by default.
- **Tracking:** `tracking.ts`.
  - Ortho is horizontal or vertical. Polar is every 15°, 30°, 45° or 90° within 8 px.
  - On horizontal and vertical lines, the cursor's other coordinate is kept, so no rounding
    creeps in.
  - Order of precedence: a snap wins over tracking.
- **Keys:** a tool sees keys first.
  - Digits, `@`, `.`, `+` and `-` start typing in the box.
  - The tool's option letters apply. Enter (or a right-click) finishes; Esc stops.
  - Any other letter starts that tool: L line, P polyline, C circle, A arc, R rectangle,
    N polygon.
  - Shift+S, Shift+O and Shift+T toggle snaps, ortho and tracking. Holding Shift forces
    ortho.
  - The panel toggles moved from L and P to `[` and `]`.
- **Layout:** the tool rail sits inside the drawing area's left edge. "Zoom to fit" leaves room
  for it (`RAIL_WIDTH` in `actions.ts`).
- **Rendering speed:** after a slow CI runner failed the 30 fps gate, timing showed two thirds of
  each frame was JavaScript.
  - `scene.ts` now caches the draw order per drawing, and styles per layer for entities that
    use their layer's style.
  - It skips the index search when everything is on screen.
  - It draws shapes under 16 px without their dash pattern.
  - Result: frames 45% faster (pan about 11 ms, zoom about 17 ms locally). Keep per-entity
    work in the frame loop to lookups, never string building or sorting.

### Phase 5 — Modify tools

Builds: move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array, join,
explode. Added:
- rounding or cutting every corner of a polyline at once;
- delete (Delete key);
- buttons in the selection panel for everything that works on a selection.

Gate:
- [x] Offsets lie exactly at the set distance.
- [x] Trimmed and extended ends lie on the boundary edge.
- [x] Fillets are tangent at both ends; reference drawings match.

Implementation notes (for later phases):
- **Geometry** lives in `src/core/geom`:
  - `offset.ts`: lines move along their left normal; circles and arcs change radius.
    - Polylines offset edge by edge, then neighbours are extended or cut back to meet (a
      mitre). Where they can't meet, or the mitre would be over 100× the distance away, a round
      join about the original corner fills the gap.
    - An offset that turns an edge over or shrinks an arc to nothing is refused.
    - Sides follow the direction of travel: positive is left; a circle's left is its inside.
  - `cut.ts`: trim and extend work on a path (a shape's curves plus the exact points between
    them, skipping zero-length polyline edges).
    - New ends are the computed intersection points themselves.
    - A circle or closed polyline needs two crossings to trim and becomes one open piece.
    - Extending carries a line straight on and an arc round its circle.
  - `corner.ts`: fillet and chamfer for two lines, and for polyline corners between straight
    edges.
    - The tangent distance is r (1 + cos θ) / sin θ rather than r / tan(θ/2), and the centre is
      set square off the first tangent point. Square corners come out exact, and tangency
      holds by construction.
  - `chain.ts`: join chains lines, arcs and open polylines end to end in any order and
    direction, and closes the loop if it returns to its start.
  - `sweepToBulge` gives exactly ±1 for half turns.
- **Commands** are in `src/core/doc/edit-commands.ts`:
  - `entity.offset`, `entity.trim`, `entity.extend`, `entity.fillet`, `entity.chamfer`,
    `polyline.fillet`, `polyline.chamfer`, `entity.array`, `entity.join` and
    `entity.explode`.
  - Shared building blocks are in `command-kit.ts`.
  - Pieces keep their source's layer, style and draw order; the first piece keeps its id.
  - Trim cuts back to every shown entity whose bounds touch the target, unless `edges` names
    them. Extend looks at every shown entity.
  - One array makes at most 100,000 copies.
  - Fillet or chamfer of one polyline's two neighbouring edges works on that corner.
- **Tools** (`src/core/tools/modify.ts`):
  - Selection tools (move, copy, rotate, scale, mirror, arrays, round or cut every corner) use
    the current selection, or first ask for one: select, then Enter.
  - Offset, trim, extend, fillet and chamfer ask for picks (`accepts: 'pick'`); a click picks
    the nearest object within 6 px. They repeat until Enter or Esc.
  - Remembered values: offset distance, fillet radius, chamfer distance.
- **Reference drawing:** `tests/fixtures/modify-reference.ts` uses every modify tool, with typed
  points and clicks on objects.
  - Drawn through the engine and again through the real app, it must equal the approved file
    `tests/fixtures/modify-reference.archilite` exactly, and 25 hand-worked shapes to 1e-9.
  - Refresh it with `UPDATE_REFERENCES=1 npx vitest run tests/unit/core/tools/modify-reference.test.ts`.

### Phase 6 — Annotation

Builds: associative linear, aligned, angular, radius and diameter dimensions; dimension styles with
ISO-style defaults; text; leaders; centre marks; ArchiLite's own hatch patterns; ArchiLite's own
title blocks.

Gate:
- [x] Over 500 random cases, every dimension shows exactly the measured value.
- [x] Dimensions follow their geometry after modify operations.
- [x] Hatch areas match `shapely`.

Implementation notes (for later phases):
- **Notes are a second kind of object.** `Doc.notes` (a map, like `entities`) holds every
  annotation: dimensions, text, leaders, centre marks, hatches and title blocks. Notes share the
  id space, layers and draw order with entities but are never geometry: snaps, trim, offset and
  the other modify commands ignore them.
  - `src/core/doc/notes.ts`: the model, the dimension styles, and `resolveNote` (a note and the
    drawing in, drawing primitives out).
  - `note-validate.ts`: the readers for untrusted input. `note-commands.ts`: `note.add`,
    `note.edit`, `dimstyle.set` and `dimstyle.use`, all undoable.
  - `src/core/geom/hatch.ts`: loops, even-odd areas and hatch lines.
  - `src/core/tools/annotate.ts`: the tools. `src/render/notes.ts`: drawing them.
- **Dimensions store where to measure, never the number.** A dimension holds point references
  (`free`, `end`, `vertex`, `mid`, `center`) and is measured from the geometry every time it is
  resolved, so it can't disagree with the drawing. `refAt` ties a point that lies exactly on an
  entity's end, vertex, midpoint or centre to that feature, which is how clicking a snap makes a
  dimension associative.
- **Resolved notes are cached per document** (`resolveNotes`); a change to the document makes a new
  cache. A note that no longer resolves is never drawn.
- **After a command, notes that point at something gone are removed in the same undo step.** Undo
  brings both back. `execute` reports how many notes it removed in `pruned`.
- **Transforming notes.** A transformed free note (text, leader, title block) moves with the
  selection. A dimension, centre mark or hatch is associative and is moved by its geometry, so
  it is not copied on its own. Moving geometry alone leaves a dimension's `at` (where the line
  is placed) where it was; moving the dimension together with the geometry moves `at` too.
- **Hatch.**
  - A hatch is an outer boundary minus islands. A boundary is a circle, a closed polyline, or
    several pieces that join end to end. Area is the outer area minus the islands.
  - Lines are found by even-odd scanlines across all the boundaries at once, with a tiny nudge
    where a line would pass exactly through a vertex. A hatch makes at most 20,000 lines
    (`MAX_HATCH_LINES`); more is refused in words (widen the spacing).
  - **Picking.** A hatch lies under geometry, so when a click is as near to a boundary as to
    the hatch, the boundary wins (`doc-index.ts`, a bias of radius × 1e-6). A first version
    clamped every hatch distance, which made a click in an island pick the hatch; the bias only
    applies below the pick radius.
  - **Known limitation:** hatch lines run under dimension text instead of stopping short of it,
    so text over a hatch is legible but not ISO-clean. A text mask is a later improvement, and
    Phase 7's exports should draw the same thing the screen does.
- **Dimension styles.** The default is `ISO` (text 3.5, arrow 3, extension gap 1 and overrun 2,
  text gap 1, 2 decimal places for lengths, 1 for angles, centre mark 2.5, centre overrun 2).
  Sizes are paper sizes at 1:1. Editing a style changes every dimension that uses it.
- **File format 2** adds `dimStyles`, `currentDimStyle` and `notes`. Version 1 files still open.
  See `docs/file-format.md`.
- **Tools** (keys D, X, H; the rest on the rail, the palette and the selection panel): linear,
  aligned, radius, diameter, angle, text, leader, hatch, centre mark, title block.
  - Text prompts take any character as the start of typing (`accepts: 'text'`); `\n` types a new
    line.
  - Remembered values: hatch pattern, angle and spacing; sheet size.
- **Selection panel.** Selecting one note shows what it measures and its fields; edits go
  through `note.edit`. With nothing selected the panel shows the dimension style in use, which
  can be edited and saved under its own or a new name.
- **Reference drawing:** `tests/fixtures/annotate-reference.ts` uses every annotation tool.
  - Drawn through the engine and again through the real app, it must equal the approved file
    `tests/fixtures/annotate-reference.archilite` exactly, and every number it shows must equal
    its hand-worked value (60.00, 28.28, 45.0°, Ø8.00, R5.00, hatch area 2400 − 41π).
  - Refresh it with `UPDATE_REFERENCES=1 npx vitest run tests/unit/core/tools/annotate-reference.test.ts`.
  - Clicks on objects must land at least 2 mm from every other object **and from every
    annotation text box**: a click inside a dimension's text picks the dimension.
- **Hatch oracle.** `tests/fixtures/hatch-cases.json` holds 60 seeded cases (made by
  `tests/fixtures/hatch-cases.ts`) with the area ArchiLite reports.
  `tests/oracle/check_hatch_areas.py` recomputes each area with `shapely` from very fine
  polygons and fails if any differs by more than 2e-8 of itself. CI runs it in its own step
  with a pinned `shapely` in a throwaway virtual environment; `shapely` is not part of the app.
- **The tool rail now wraps into a second column** when the drawing area is short, instead of
  scrolling, so no tool is hidden. Fit measures the rail's real width (`railWidth()` in
  `actions.ts`) to keep the drawing clear of it.

### Phase 7 — Import and export

Builds: DXF import and export, SVG, PDF at true scale, PNG.

Gate:
- [x] CI Python oracle (`ezdxf` + `shapely`) verifies lengths, areas and positions of every
      exported test drawing.
- [x] A 100 mm line in a 1:1 PDF measures 283.4646 pt.
- [ ] Manual: open an export in LibreCAD and in Onshape or SolidWorks, measure 5 features, agree to
      0.001 mm.

Implementation notes (for later phases):
- **`src/io`** holds DXF, SVG and PDF. Native `.archilite` stays in `src/core/doc/file.ts`. PNG
  uses the Canvas 2D painter (`src/render/png.ts`) because it needs a canvas. No new runtime
  package: DXF, SVG and PDF are written here. `ezdxf` is CI-only, like `shapely`.
- **DXF** is the R2000 (AC1015) text form. Geometry is LINE, CIRCLE, ARC and LWPOLYLINE (with
  bulges). Notes export as the same primitives the screen draws (lines, arrows, text) plus a
  HATCH whose boundary is the hatch's loops, so areas survive. Import reads those entity types
  and simple TEXT/MTEXT (`%%c`/`%%d`/`%%p` become Ø/°/±; `%%u`/`%%o` toggles are dropped;
  MTEXT `\A1;` / `\F…;` / `\P` markup is dropped or becomes a newline).
  INSERT is exploded into those same types (nested inserts included; layer 0 takes the
  insert's layer). Non-uniform X/Y scale, rows-and-columns INSERT arrays, missing blocks,
  DIMENSION, HATCH and the rest are skipped and counted (DIMENSION becomes a live note in
  Phase 12). Explosion stops at 200,000 objects or 200,000 inserts and refuses the file in
  plain words (a 3 KB file of nested blocks can ask for a million lines). Binary DXF is
  refused. After open, the status bar unit label cycles the name without scaling (a
  millimetre-tagged inch drawing becomes inches); Ctrl+K also has "Scale the drawing to …".
- **SVG and PDF** are 1:1. One millimetre on the drawing is one millimetre on the page. PDF user
  space is scaled by `72/25.4` pt per millimetre, so a 100 mm line is 283.4646… pt. PDF text uses
  Helvetica (a standard PDF font) so the file stays small; the scale is the gate, not the typeface.
- **Hatch under dimension text** is unchanged: exports match the screen (see Phase 6).

### Phase 8 — Scripting (JavaScript and Python via Pyodide)

Builds: scripting API over the command registry, script panel, Pyodide lazy loader and Python
binding, example scripts (bolt circle, flange, slot pattern).

Gate:
- [x] The same script in JavaScript and Python produces an identical document.
- [x] Scripts cannot call `fetch`, XHR, sockets or workers by accident (best-effort guard, not a
      sandbox: scripts run with the page's access, and the script panel says so), and a Python
      run leaves the page's own `fetch` intact.
- [x] Loading Pyodide does not change the base download budget or startup time.

Implementation notes (for later phases):
- **`src/script`** is the drawing API (`cad.line`, `cad.circle`, `cad.arc`, `cad.rect`,
  `cad.polyline`, `cad.layer`, `cad.polar`, `cad.title`, `cad.run`, `cad.print`). Every call
  goes through `runCommandOnDraft`, and the whole script is one undo step (`script.run`).
  Angles in the API are degrees; the kernel stays in radians. `cad.polar` uses `cosSin`, so
  quarter turns are exact in both languages.
- **JavaScript** runs in `new Function` with `fetch`, XHR, WebSocket and Worker shadowed.
  **Python** is Pyodide 0.29.5, copied to `dist/pyodide/` at build and fetched from the same
  origin only when a Python script runs (`src/app/python.ts`). The interpreter's `js.fetch` and
  `urllib` are patched; the page's real `fetch` is left alone so Pyodide can load its wasm.
- **Not in the base budget.** `scripts/size-budget.mjs` already skips `pyodide/`. Opening the
  app, or the script panel on JavaScript, must not request those files.
- **Examples** (bolt circle, flange, slot pattern) live in `src/script/examples.ts`. The
  identity gate compares `saveDocument` of the JS run against the Python run.

### Phase 9 (stretch) — Blocks, sheets, constraints

Builds: reusable blocks, multi-sheet layouts, geometric and dimensional constraints.

Gate:
- [x] Constraints re-solve to the same result after every edit.
- [x] A real part drawing is produced start to finish in ArchiLite.

Implementation notes (for later phases):
- **File format 3.** `Doc.sheets`, `Doc.blocks`, `Doc.inserts` and `Doc.constraints`. Sheets and
  blocks are named like dimension styles, not ids. Inserts and constraints share the entity/note
  id space. `sheet` on an entity, note, insert or constraint is omitted when it is the first
  sheet. Version 1 and 2 files open with one A4 sheet called "Sheet 1" and empty blocks.
- **Solver.** `pruneAndSolve` runs in `commitDraft` after every command. Constraints apply in id
  order, Gauss-Seidel style, up to `MAX_SOLVE_ITERS` (48). The stop test is `tolFor(mag, res)` —
  do not pass the previous residual into `tolFor` (an infinite last residual would stop after
  one iteration). The same document always produces the same result.
  The solver stops quietly when constraints conflict or cannot be reached, so the app asks
  `unmetConstraints` after every change and shows "N constraints could not be met" (anything
  further than `CONSTRAINT_MET_TOL`, 1e-6, from true). Added in review of #12.
- **No extra runtime package.** Blocks, sheets and constraints are TypeScript in `src/core/doc`
  (`blocks.ts`, `sheets.ts`, `constraints.ts`, `layout-commands.ts`) and tools in
  `src/core/tools/layout.ts`. Bound `PointRef`s only: a constraint cannot name a free point.
- **Scripts.** `cad.block`, `cad.insert`, `cad.sheet`, `cad.useSheet` on the host. The plate in
  `tests/unit/core/doc/constrained-plate.ts` is the start-to-finish part drawing.

### Phase 10 — DWG import (read only)

Builds: open a `.dwg` into the same kind of document DXF import already produces. No DWG writer.

This phase does not start until Phase 7's gate has passed in CI. It does not wait for Phase 9
or Phase 11, and Phase 11 does not wait for it. Either can follow Phase 8.

Method:

- **On-demand `cadkit-wasm`** (MIT OR Apache-2.0, the same terms as ArchiLite), version pinned
  when the phase is built. It reads DWG from AC1014 (R14) through AC1032 (2018), which is what
  current programs still write, and it does not write DWG. Its own rules are clean-room: no GPL
  CAD code and no vendor SDK. It stays a runtime dependency (the licence gate checks it). It is
  not copied into `src/`.
- **Loaded only for a DWG.** `openFile` looks at the first six bytes. `AC10` means DWG, and only
  then does the page fetch the decoder. A `.dxf` or `.archilite` never downloads it. The base
  300 KB budget does not include it. Its own budget is ≤ 3 MB transferred (the package is about
  2.6 MB of WebAssembly today). `scripts/size-budget.mjs` excludes that chunk the way it will
  exclude Pyodide.
- **ArchiLite still owns the document.** The decoder's model-space entities are mapped with the
  same rules as DXF import: lines, circles, arcs, polylines with bulges, and simple text become
  entities and text notes. Layers, units, colour, linetype and lineweight follow that mapping.
  Block inserts in model space are exploded into those entities, so a drawing that is only
  inserts is not empty. There is no block editing here (that is Phase 9). Paper layouts,
  hatches, splines, ellipses, solids, images and proxies are skipped and counted. Dimensions
  use the Phase 12 mapper when that phase has merged, and are skipped until then. The toast
  says how many. Encrypted files, and versions outside AC1014–AC1032, are refused in plain words.
- **Not the alternatives.** LibreDWG is GPL-3.0 and libdxfrw is GPL; either would fail the
  licence gate. A vendor SDK is not our licence and is not a static page. A cloud converter
  would send the drawing off the machine. A decoder written in this repo would reimplement a
  paged, checksummed, LZ77-compressed container (Reed-Solomon as well on the 2007 generation);
  a wrong bit is a wrong length, and that is the failure this phase is not allowed to ship.
  Smaller MIT readers exist, but they do not publish a provenance record we can check, so they
  are not the plan. If `cadkit-wasm` fails the licence gate, the 3 MB budget, or a geometry
  fixture, the phase stops. It does not switch to a GPL library.

Gate:

- [ ] Committed DWG fixtures, made by another program and reviewed as a diff, for a 100 mm line,
      a circle, an arc and a closed polyline with a bulge, in AC1015 and in AC1027 or AC1032.
      Import matches the hand-calculated geometry to 1e-6 mm. CI does not install a GPL tool to
      do this.
- [ ] The base download stays ≤ 300 KB. Opening a DWG is what fetches the decoder, and that
      fetch is ≤ 3 MB. Opening the example does not fetch it.
- [ ] Manual: open a DWG from LibreCAD or from Onshape or SolidWorks, measure 5 features, agree
      to 0.001 mm (`TEST-BACKLOG.md`).

### Phase 11 — Phone browser

Builds: the same site, usable in a phone browser. Same document, same commands, same Canvas 2D
painter. No second app, no install step, no store listing.

This phase does not use anything from Phase 9 or Phase 10. It can be built as soon as Phase 8
has merged, and Phase 10 can be built before it, after it, or left for later. A phone build
without DWG or live DXF dimensions is complete.

What a phone gets today: below 900px the layer and selection panels are removed
(`theme.css`) and there is no control that brings them back. A one-finger drag on empty
paper starts a selection box (`interaction.ts` keeps a single pointer). Pinch is not a
gesture. The top bar is a desk bar. Typed coordinates sit beside a cursor the phone does not
have.

Method:

- **One page.** `index.html` stays the app. A phone is a width of 700px or less
  (`matchMedia`), which adds a class on `body`. A wider window, including a touch laptop and
  a tablet in landscape, keeps the desk layout. The class changes layout and gestures only.
  Geometry, commands, and the file format stay as they are.
- **The drawing fills the screen.** The top bar keeps the mark, the title, undo, redo, and
  the command search. Open, Save, Export, and Script stay in the command palette, which is
  already the menu. The tool rail becomes one horizontal strip of the current group (Draw,
  Modify, or Annotate) with targets at least 44px, over the bottom of the drawing. Fit
  measures that strip the way it already measures the rail's width. Layers and the selection
  are the existing panels, opened as sheets from the palette. The script panel is a sheet
  too. The steel rulers stay. The status line keeps X, Y, the unit, and the scale, and uses
  the safe area (`viewport-fit=cover`). The coordinate box anchors to the visual viewport so
  the on-screen keyboard does not cover it. The grammar is unchanged: `x,y`, `@dx,dy`,
  `@length<angle`.
- **Gestures.** Two fingers drag to pan, and pinch to zoom about the midpoint (`zoomAt`).
  With no tool, one finger also pans, and a tap picks. Box selection is a palette command,
  so a drag is not a window by accident. With a tool that wants a point, a tap places it and
  two fingers still pan and zoom. The snap marker is drawn above the finger; the hit is the
  touch itself. The canvas keeps `touch-action: none` and does not open the browser menu.
- **Files stay on the phone.** Open keeps the file input. Save uses the file-picker API when
  the browser has it, otherwise the share sheet with one file, otherwise the download used on
  the desk. A toast says which one happened. Nothing is uploaded.
- **Python is still on demand.** The first Python run on a phone says that it downloads about
  12 MB from this site, then loads the same `./pyodide/` files. JavaScript scripts do not
  load them.

Gate:

- [ ] Playwright with a 390×844 touch viewport: the example opens fitted, one finger pans, a
      pinch zooms about the fingers, a tap selects the outline, the line tool places a point,
      the layers sheet hides a layer, and Save writes the same `.archilite` bytes as the desk.
      No console errors and no request to another origin.
- [ ] The desk screenshots and the 20,000-entity frame budget are unchanged. The phone layout
      adds no per-entity work in the frame loop. The download stays ≤ 300 KB, with no new
      runtime package.
- [ ] Manual: on an iPhone in Safari and on an Android phone in Chrome, type a 100 mm line,
      read 100.000 in the selection sheet, save, and open that file again
      (`TEST-BACKLOG.md`).

### Phase 12 — Live DXF dimensions

Builds: DXF `DIMENSION` becomes an ArchiLite dimension note (where to measure, never the
number). Hatches stay skipped.

This phase does not start until Phase 7's gate has passed in CI. It does not wait for
Phase 9, Phase 10, or Phase 11. INSERT explode (#15) should already be in, so defpoints can
bind to exploded fixture geometry as well as walls. DWG import (Phase 10) uses the same
mapper once this phase has merged.

Method:

- **Bind, do not copy the number.** A DXF `DIMENSION` has defpoints (groups 13/14, and 10
  for the dimension line). Each defpoint is bound with the existing `refAt` to an end, mid,
  centre or vertex on imported geometry, using `tolFor`. Both ends must bind. The note is
  `linear`, `aligned`, `radius`, `diameter` or `angle` from the DXF dim type (group 70).
  The displayed length is resolved from the geometry every time, like any ArchiLite
  dimension. Group 42 (the stored measurement) and group 1 (the text, including `<>`) are
  never copied into the document.
- **Skip rather than fake it.** A defpoint that is not on a named point, an ordinate
  dimension (no ArchiLite kind), or a dimension whose text is an override (group 1 set and
  not `<>`) is skipped and counted. Do not fall back to a free `PointRef`: that would
  freeze one end. Do not explode the anonymous `*D` block into lines and text: that would
  draw a dead number next to the live one.
- **ArchiLite look.** The note uses the current dimension style (ISO by default). Do not
  import another program's dim style, arrows or fonts. Text placement `at` comes from the
  DXF dimension-line point.
- **Hatches stay skipped.** A DXF `HATCH` is a finished fill. Mapping its loops onto
  ArchiLite hatch notes is a later stretch, not this phase.

Gate:

- [ ] A committed DXF fixture: a 100 mm horizontal line and a linear `DIMENSION` between
      its ends. Import is one entity and one linear note; `resolveNotes` reads 100; the
      saved document has no stored length. Moving an end to 140 mm makes the note read 140.
      A dimension whose text is `OVER` is skipped. Hand-calculated to 1e-9. The floorplan
      itself is not committed.
- [ ] Manual: open the floorplan DXF, treat units as inches, pick an imported garage
      dimension (254 or 250), move the wall, and watch the number change (`TEST-BACKLOG.md`).
      Overridden text and hatches are still left out.

### Phase 13 — Driving dimensions and editing constrained drawings

Builds: a dimension you place also holds the drawing to that number, you can type a new number
to resize the part, constraints can be seen and edited, and editing constrained geometry
either works or is refused in plain words instead of quietly bending the drawing.

This phase needs Phase 6 (dimensions) and Phase 9 (constraints), both merged. It does not wait
for Phase 10, 11 or 12 and can be built before them.

What is wrong today (found and reproduced 2026-11-26; each is a gate check below):

1. **A dimension holds nothing.** Placing a dimension adds no constraint. A dimension is a
   read-only measurement, and there is no way to type a new number into it.
2. **Constraints cannot be seen or edited.** The only commands are `constraint.add`,
   `constraint.delete` and `constraint.solve`. Nothing draws a constraint, the selection panel
   does not list them, and changing a value means deleting the constraint and adding it again.
3. **Editing constrained geometry misbehaves without a word.** A line with a length constraint
   of 10, scaled by 2, stays 10 long but jumps to x 5 to 15 (the edit is ignored and the line is
   moved). A line with a fixed start, moved by (5, 3), turns into a stretch from (0, 0) to
   (15, 3). Moving the vertical leg of a joined L (horizontal and vertical constraints) by 4
   bends both legs to a compromise (the horizontal leg ends at x 12.4, not 14). The solver
   settles on whatever it reaches and nothing tells the user.

Method:

- **Driving dimensions.** Placing a linear, aligned, radius, diameter or angle dimension also
  adds the matching constraint (`distance`, `radius`, `angle`; see the horizontal and vertical
  note below) at the value that is measured right now, so placing one never moves anything.
  The dimension note still stores only where to measure, never the number (Phase 6 rule). The
  number lives in the constraint. The two are linked by id, so deleting one asks about the
  other, and both go in the same undo step.
- **Reference dimensions.** A dimension can be marked "reference": it measures only, adds no
  constraint, and is drawn in brackets, for example (100). The dimension tools get a
  driving/reference switch, driving by default. Dimensions imported from DXF (Phase 12) are
  reference until the user switches them.
- **Typing a new number.** Double-click a driving dimension, or pick it and use its row in the
  selection panel, to get the entry box beside the cursor (`src/ui/entry.ts`). Enter sets the
  value (`constraint.setValue`, a new command) and the drawing re-solves in the same undo step.
  The existing Distance, Radius, Length and Angle constraint tools keep asking for a typed value.
- **Horizontal and vertical distances.** A horizontal or vertical linear dimension measures the
  x or y gap, which `distance` (straight-line length) cannot hold. `distance` gets an `axis`
  (`any`, `x` or `y`; omitted means `any`). This changes the file format, so `FILE_VERSION`
  becomes 4, `docs/file-format.md` and the example are updated, and version 3 files still open
  unchanged.
- **See and edit constraints.** Constraints are drawn as small hairline marks beside what they
  hold, with a "Show constraints" switch (key and palette entry). They are marks, not
  geometry: snaps and the modify commands ignore them, like notes. A mark can be picked. The
  selection panel lists the constraints on the picked objects, each with its kind, its value
  (editable) and a Delete button. A `fix` constraint shows its point and can be edited too.
- **Editing constrained geometry.** What the user drags or moves is what they asked for. The
  solver is given the points the user just placed as temporary pins and moves the rest to keep
  the constraints. Then, one of two outcomes, never a third:
  - every constraint can be met: the change is committed, with the rest of the drawing
    following (in the joined L above, the horizontal leg follows to x 14); or
  - one cannot be met (a fixed point moved, a length stretched): the change is refused,
    nothing changes, and the message names the constraint in plain words ("The start of this
    line is fixed (constraint 4). Change or delete that constraint first.").
  This covers grips, move, rotate, scale and stretch. A user edit never leaves a compromise
  shape. (The 1e-6 "could not be met" warning from Phase 9 stays for the cases where a
  constraint was never reachable, such as ones loaded from a file.)
- **Shape presets (added 2026-11-27 at the owner's request, as in a parametric CAD sketch).** A
  rectangle drawn with the Rectangle tool also adds four constraints in the same undo step: each
  side horizontal or vertical (`entity.add` with `presets: true`). They are ordinary constraints
  on the polyline's corners, so the file format does not change. Typing a new width or height
  works from either end of a side: the corner you clicked first stays and the far side moves.
  A change that makes a preset untrue is not refused. It lets the constraint go and says so:
  - turning or mirroring shapes so that horizontal, vertical or horizontal/vertical-distance
    constraints that only hold those shapes are no longer true. A dimension among them stays,
    in brackets, as a reference dimension;
  - rounding, cutting, joining or exploding a polyline, which renumbers its corners. A
    dimension on those corners is removed with them.
  The message reads "Let go of 4 constraints that this change made untrue. Ctrl+Z brings them
  back." Copies, arrays, offsets, and rectangles from scripts or imported files have no presets.
- **Same rules as before.** Constraints still apply in id order and the same document gives the
  same result. Use `tolFor`; no new epsilons. Commands are named, undoable and reachable from
  scripts (`cad.setConstraint`). Marks use hairlines and keep the frame budget (run the
  performance gate and quote it in the PR).

Not in this phase: degrees-of-freedom counting or colouring ("fully constrained"), values
written as equations (for example width = 2 × height), and auto-applied geometric constraints
other than the rectangle's four above (the Line, Polyline and Polygon tools add none; a polygon's
equal sides cannot be held yet because `equal` takes line ids, not one polyline's edges). Each is
a later stretch.

Gate:

- [x] A 100 mm line with a driving aligned dimension: placing it adds exactly one constraint of
      100 and no coordinate changes (compared to 1e-9). A reference dimension adds none and
      draws as (100).
- [x] `constraint.setValue` to 120 leaves the line exactly 120 long (1e-9) and moves what is
      attached to it. On the constrained plate in `tests/unit/core/doc/constrained-plate.ts`,
      widening 80 to 100 moves the right edge and the holes that are constrained to it.
      Hand-calculated values.
- [x] A value the other constraints forbid (radius 3 and radius 4 on one circle) is refused,
      the document is unchanged, and the message names the constraint.
- [x] The three misbehaviours above are fixed, with hand-calculated results: scaling the
      length-10 line by 2 is refused and the line is unchanged; moving the fixed-start line is
      refused and the line is unchanged; moving the vertical leg of the joined L by 4 gives a
      horizontal leg from (0, 0) to (14, 0) and a vertical leg from (14, 0) to (14, 10).
- [x] Property test (fast-check, `PROPERTY_PARAMS`): a random constrained rectangle given a new
      width has that width to `tolFor`, every constraint is met, and undo restores the
      original exactly.
- [x] Round trip: a version 4 file with an axis distance reads back the same; a version 3 file
      opens unchanged. Coverage stays 100% on `src/core`.
- [x] Browser (Chromium, GPU off, no console errors): place a dimension, double-click it, type
      120, Enter, and the part resizes; Ctrl+Z restores it in one step. Constraint marks show
      and hide. Picking a constraint in the panel highlights what it holds. A screenshot
      baseline of the marks. The performance gate still passes.
- [x] Manual tests in `TEST-BACKLOG.md` (M13) are written for the owner.
- [x] Shape presets: a rectangle drawn with the tool starts with four constraints (horizontal,
      vertical, horizontal, vertical on its corners) in one undo step; `presets` is refused for
      anything that is not an upright rectangle and changes nothing.
- [x] A new width or height typed into a dimension on a preset rectangle works from every side
      and from either end, with the corner clicked first unmoved and exact results (eight
      hand-worked cases, no `-0`, residual 0). Property test (`PROPERTY_PARAMS`): random
      rectangle, side, end and value.
- [x] Rounding, cutting, exploding or turning a preset rectangle is not refused: the constraints
      are let go with the message above, and one undo brings them back. A half turn and a mirror
      across a horizontal line keep them. Turning a dimensioned rectangle keeps the dimension, in
      brackets. Hand-calculated turn of 30°.
- [x] Browser (Chromium, GPU off, no console errors): draw a rectangle, dimension its bottom side
      from the right-hand end, type 120, round two corners (message, constraints gone), Ctrl+Z
      (constraints back); turn a new rectangle 30° (message).

Implementation notes (for later phases):
- **Shape presets.** `entity.add` takes `presets: true` for an upright, square-cornered
  four-corner closed polyline and adds `rectanglePresets` in the same draft; anything else is
  refused. The rectangle tool is the only caller. Constraint ids share the id space, so each
  tool-drawn rectangle uses four ids after its own. Scripts, imports, copies and arrays make
  plain polylines. `Executed.released` (and `Outcome.released` for tools) counts constraints let
  go so the app can say so; constraints dropped because their shape was deleted are not counted.
- **Corner numbers.** Constraints name a polyline corner by number. `pruneAndSolve` first lets go
  of any constraint that names a corner of a polyline whose corner count changed in this command
  (`releaseRenumbered`), then drops constraints whose geometry is gone. A turn or mirror calls
  `releaseTurned` after moving the shapes. Moving only one end of a constraint away from a part
  that stays put is still refused.
- **Solver votes.** A constraint that controls one axis (horizontal, vertical, a distance along x
  or y) votes on that axis only, so it is not diluted by other constraints' "stay where you
  are". Without this a width typed on a rectangle converged to about 6e-10 instead of exactly.
- **Typing a distance.** `constraint.setValue` on a `distance` pins the first point where it is
  and the second at the new distance (`pinsForDistanceEdit`), so whatever is joined to the second
  point follows, whichever way round its neighbouring constraints were written.
- **Known gaps.** Scaling a dimensioned shape is refused (held values are not scaled). Copies of a
  constrained shape are not constrained.
- **File format 4.** `distance.axis` (`x` or `y`; omitted is the straight-line length), `note.drive`
  / `constraint.note` as a bidirectional link, `note.reference: true` for measure-only dimensions.
  Version 3 files open unchanged. A mismatch between `drive` and `note` is refused at load.
- **Driving by default.** `note.add` on a linear, aligned, radius, diameter or angle dimension
  also adds the matching constraint at the value measured now, unless `reference: true`. Free
  points cannot drive. A diameter stores a radius; the UI shows twice that. Angle driving needs
  two line ids and a sweep in (0, π).
- **Solver pins.** `pinsFromDraft` holds every named handle of entities the command touched (not
  only the points that moved), so scale-around-an-endpoint cannot slide the unmoved end. Fix
  constraints join the pin set unless a user pin already holds that handle. `propose` for
  coincident, horizontal, vertical, distance, length and concentric is pin-aware: one pin moves
  the other handle; both pins skip. With neither pin, those constraints move only the second
  handle so a driving dimension can stretch a rectangle instead of averaging both ends. Pins
  overwrite averaged proposals. `pruneAndSolve` refuses if pins leave a constraint unmet.
  `constraint.setValue` / `setFix` re-solve without user pins and refuse if unmet. A user edit
  never leaves a compromise shape.
- **Marks.** `constraintMarks` are hairline glyphs, not geometry. Snaps and modify commands ignore
  them. `pickAt` / `selectInBox` take an optional marks list. Shift+C toggles them.

## Out of scope for v1

DWG export, 3D, AutoLISP compatibility, full ISO/ASME certification, real-time collaboration,
a native phone app. DWG import is Phase 10. The phone browser is Phase 11. Live DXF dimensions
are Phase 12. Frozen DXF dimension graphics (exploded `*D` blocks) stay out.
