# ArchiLite progress

**Now:** Phase 4 (precision drafting) is built and in review as [PR #5](https://github.com/leon14026/2D-CAD/pull/5);
Phase 5 (modify tools) is being built on top of it. Merge in order:
[PR #2](https://github.com/leon14026/2D-CAD/pull/2) (Phase 1), [PR #3](https://github.com/leon14026/2D-CAD/pull/3)
(Phase 2), [PR #4](https://github.com/leon14026/2D-CAD/pull/4) (Phase 3), then PR #5.

**Live site:** https://leon14026.github.io/2D-CAD/ (shows the last merged phase)

| Phase | Status | Pull request | Merged |
|---|---|---|---|
| 0. Foundations and compliance | Done | [#1](https://github.com/leon14026/2D-CAD/pull/1) | 2026-11-25 |
| 1. Geometry kernel | Done, gate passed in CI; awaiting merge | [#2](https://github.com/leon14026/2D-CAD/pull/2) | — |
| 2. Document model, file format, commands | Done, gate passed in CI; awaiting merge | [#3](https://github.com/leon14026/2D-CAD/pull/3) | — |
| 3. Viewer | Done, gate passed in CI; awaiting merge | [#4](https://github.com/leon14026/2D-CAD/pull/4) | — |
| 4. Precision drafting | Done, gate passed locally; awaiting CI and merge | [#5](https://github.com/leon14026/2D-CAD/pull/5) | — |
| 5. Modify tools | Not started | — | — |
| 6. Annotation | Not started | — | — |
| 7. Import and export | Not started | — | — |
| 8. Scripting (JavaScript, Python via Pyodide) | Not started | — | — |
| 9. Blocks, sheets, constraints (stretch) | Not started | — | — |

Manual tests waiting for you: see [TEST-BACKLOG.md](TEST-BACKLOG.md).

## Log

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
- Gate (passed locally):
  - The reference part (`tests/fixtures/reference-part.ts`), a plate with holes, a slot, a
    hexagon, a triangle and an arc, drawn by typed input alone, matches its hand-worked
    specification to 1e-9: in the engine, and again typed into the real app.
  - The snap matrix: every snap kind on all 5 entity types, with each of the 5 types crossing
    it, plus intersections for all 15 pairs of types at hand-calculated points.
  - 100% line coverage of `src/core`, now including `tools`. 794 unit and property tests.
  - 47 browser tests and 8 approved screenshots. The new screenshot shows a line being drawn,
    with a snap marker.
  - Performance with 20,000 entities: pan about 21 ms per frame, zoom about 23–28 ms; the budget
    is 33.3 ms.
- Found and fixed while building:
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
