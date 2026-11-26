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
| App download (JS + CSS + HTML, gzipped, excluding Pyodide) | ≤ 300 KB | Phase 0 |
| Runtime dependencies shipped to users | 0 until a phase justifies one; each must pass the strict allowlist | Phase 0 |
| Pan/zoom on a 20,000-entity drawing, Chromium with GPU disabled | ≥ 30 fps | Phase 3 |
| Cold start to interactive | ≤ 2 s on a typical laptop | Phase 3 |
| Pyodide | loaded only on demand; never part of the base budget | Phase 8 |

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
  io/        native JSON format, DXF, SVG, PDF, PNG
  render/    Canvas 2D renderer, viewport transform, spatial index
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
- **Interoperability:** ArchiLite reads and writes DXF, a publicly documented format. DWG is out of
  scope.
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
typed absolute, relative (`@dx,dy`) and polar (`@d<a`) input.

Gate:
- [ ] A reference part drawn by typed input alone matches its specification to 1e-9.
- [ ] Every snap type is tested against every pair of entity types.

### Phase 5 — Modify tools

Builds: move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array, join,
explode.

Gate:
- [ ] Offsets lie exactly at the set distance.
- [ ] Trimmed and extended ends lie on the boundary edge.
- [ ] Fillets are tangent at both ends; reference drawings match.

### Phase 6 — Annotation

Builds: associative linear, aligned, angular, radius and diameter dimensions; dimension styles with
ISO-style defaults; text; leaders; centre marks; ArchiLite's own hatch patterns; ArchiLite's own
title blocks.

Gate:
- [ ] Over 500 random cases, every dimension shows exactly the measured value.
- [ ] Dimensions follow their geometry after modify operations.
- [ ] Hatch areas match `shapely`.

### Phase 7 — Import and export

Builds: DXF import and export, SVG, PDF at true scale, PNG.

Gate:
- [ ] CI Python oracle (`ezdxf` + `shapely`) verifies lengths, areas and positions of every
      exported test drawing.
- [ ] A 100 mm line in a 1:1 PDF measures 283.4646 pt.
- [ ] Manual: open an export in LibreCAD and in Onshape or SolidWorks, measure 5 features, agree to
      0.001 mm.

### Phase 8 — Scripting (JavaScript and Python via Pyodide)

Builds: scripting API over the command registry, script panel, Pyodide lazy loader and Python
binding, example scripts (bolt circle, flange, slot pattern).

Gate:
- [ ] The same script in JavaScript and Python produces an identical document.
- [ ] Scripts have no network access.
- [ ] Loading Pyodide does not change the base download budget or startup time.

### Phase 9 (stretch) — Blocks, sheets, constraints

Builds: reusable blocks, multi-sheet layouts, geometric and dimensional constraints.

Gate:
- [ ] Constraints re-solve to the same result after every edit.
- [ ] A real part drawing is produced start to finish in ArchiLite.

## Out of scope for v1

DWG, 3D, AutoLISP compatibility, full ISO/ASME certification, real-time collaboration.
