# ArchiLite roadmap

ArchiLite is a lightweight, browser-based 2D CAD application for engineering drawings. It runs
entirely in the browser from a static site (GitHub Pages), processes everything locally, and needs
no dedicated graphics card.

**Stage:** Phase 1 (geometry kernel). Phase 0 complete.

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
- **Fonts:** the UI uses system font stacks; no font files ship. Any future font must be OFL-1.1 or
  more permissive and listed in `ATTRIBUTION.md`.
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
- [ ] 150+ unit tests with hand-calculated answers, accurate to 1e-9.
- [ ] Property tests (10,000 random cases each): rotate 360° is identity; mirror twice is identity;
      move then move back is identity; intersection points lie on both curves.
- [ ] 100% line coverage of the kernel.
- [ ] Architecture guard: `src/core` imports nothing outside itself and uses no DOM globals.

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
format with schema validation, command registry.

Gate:
- [ ] Save → load round-trip produces an identical document.
- [ ] 1,000 random edits, all undone, return exactly to the starting state; redo replays exactly.
- [ ] Malformed or future-version files are rejected with a clear message.

### Phase 3 — Viewer (first usable app)

Builds: Canvas 2D renderer, world↔screen transform, grid, spatial index, pan/zoom, window and
crossing selection, ArchiLite UI shell and design system v0.

Gate:
- [ ] GPU-disabled Chromium: 20,000-entity drawing pans and zooms at ≥ 30 fps.
- [ ] Selection returns the correct entity IDs for window and crossing boxes.
- [ ] Screenshot comparison tests pass.

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
