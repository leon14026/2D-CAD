# ArchiLite progress

**Now:** Phase 2 (document model) is built and in review as
[PR #3](https://github.com/leon14026/2D-CAD/pull/3). Merge [PR #2](https://github.com/leon14026/2D-CAD/pull/2)
(Phase 1) first, then PR #3. Next up: Phase 3, the viewer.

**Live site:** https://leon14026.github.io/2D-CAD/ (shows the last merged phase)

| Phase | Status | Pull request | Merged |
|---|---|---|---|
| 0. Foundations and compliance | Done | [#1](https://github.com/leon14026/2D-CAD/pull/1) | 2026-11-25 |
| 1. Geometry kernel | Done, gate passed in CI; awaiting merge | [#2](https://github.com/leon14026/2D-CAD/pull/2) | — |
| 2. Document model, file format, commands | Done, gate passed locally; awaiting CI and merge | [#3](https://github.com/leon14026/2D-CAD/pull/3) | — |
| 3. Viewer | Not started | — | — |
| 4. Precision drafting | Not started | — | — |
| 5. Modify tools | Not started | — | — |
| 6. Annotation | Not started | — | — |
| 7. Import and export | Not started | — | — |
| 8. Scripting (JavaScript, Python via Pyodide) | Not started | — | — |
| 9. Blocks, sheets, constraints (stretch) | Not started | — | — |

Manual tests waiting for you: see [TEST-BACKLOG.md](TEST-BACKLOG.md).

## Log

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
- Gate (passed locally):
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
