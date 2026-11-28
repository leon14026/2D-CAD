# ArchiLite: instructions for Claude

ArchiLite is the owner's (GitHub: leon14026) browser-based 2D CAD application for engineering
drawings. It is a personal project. Live site: https://leon14026.github.io/2D-CAD/

**Read these first, every session:**

| File | What it is | Keep it up to date |
|---|---|---|
| `ROADMAP.md` | The plan: decisions, constraints, budgets, accuracy model, phases and their test gates, implementation notes | Tick gate boxes as they pass in CI; add implementation notes later phases need |
| `PROGRESS.md` | Where the project stands: phase table and dated log | Add an entry whenever a phase starts, a PR opens or merges, or a decision is made |
| `TEST-BACKLOG.md` | Manual tests only the owner can do (real laptops, other CAD programs, rulers, legal checks) | Add the owner's tests for every phase before its PR opens; never tick a box on the owner's behalf |
| `MINOR-BACKLOG.md` | Small features that are not a phase | Add an item when it comes up; take one when a phase is not open |
| `CLAUDE.md` | This file | Update when a convention changes |

## Hard constraints

1. **Browser-only and local.** Static site, no server code. Drawings never leave the machine unless exported.
2. **No dedicated GPU.** Canvas 2D only. Never use WebGL or WebGPU. Browser tests run in Chromium with
   `--disable-gpu --disable-software-rasterizer`.
3. **Lightweight.** ≤ 300 KB gzipped (enforced by `npm run size:check`). Zero runtime dependencies unless a
   phase justifies one and it passes the strict licence allowlist. Pyodide (Phase 8) and the DWG decoder
   (Phase 10, `cadkit-wasm`) load only on demand and are outside that 300 KB.
4. **Original design.** ArchiLite's own name, palette, icons and layout. Command palette and cursor-side
   coordinate entry, not a ribbon or bottom command line. Do not imitate AutoCAD's look.
5. **Clean licensing.** MIT OR Apache-2.0. Never add: GPL/AGPL/LGPL code; Autodesk names in the product
   or UI; Autodesk icons, screenshots, SHX fonts, `.pat`, `.lin` or template files; ArtCraft/CADCraft
   names or logos. Code adapted from CADCraft (MIT OR Apache-2.0) needs a header naming the source file
   and an entry in `NOTICE`. Every shipped third-party item goes in `ATTRIBUTION.md`.
6. **Engineering-grade accuracy.** See "Accuracy model" in `ROADMAP.md`.

## Workflow

- **One branch and one pull request per phase**, named `phase-N-short-name`. Never commit to `main`.
  The owner merges using merge commits. Pages deploys from `main` (Settings → Pages → Source: GitHub Actions,
  confirmed 2026-11-25) only after the full gate passes again on `main`.
- If the previous phase's PR is still open, branch from it. Open the new PR against `main` and say
  in its description which PR must be merged first.
- **A phase is done only when every gate check in `ROADMAP.md` passes in CI.** Do not start the next
  phase's code before that.
- **Before opening or updating a phase PR**, update `ROADMAP.md`, `PROGRESS.md`, `TEST-BACKLOG.md`,
  the README status line and the phase label in `index.html` (`.al-pill`).
- Run the whole gate locally before pushing: `npm run ci`. The cloud workspace already has
  Playwright's Chromium at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; its CDN is blocked, so
  don't try `npx playwright install` there.
- **Playwright is pinned to 1.63.0** (Chromium 153.0.8010.12), the build both the cloud workspace
  and CI use, so screenshot baselines match exactly. Don't upgrade it unless the workspace's
  Chromium changes. If you do, regenerate the baselines
  (`npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots`) and look at every
  image before committing.
- **Text must render the same everywhere** for screenshots to match, so `playwright.config.ts`
  launches Chromium with `TEXT_SWITCHES` (`--font-render-hinting=none --disable-lcd-text
  --force-color-profile=srgb`) and its own font setup (`tests/e2e/fonts.conf`: Liberation as
  the only system fonts). The workspace's Chromium is a wrapper script that adds those switches
  by itself; GitHub's runner uses the stock browser, so never drop them from the config. Any
  text that changes per build (the build label) gets a fixed value before a screenshot.
- When a browser test fails in CI, the actual and diff screenshots are printed in the job log
  as base64 PNGs (the report artifact can't be downloaded from the workspace).
- After pushing, wait for the PR's "Phase gate" check to pass before reporting done.

### Commit and PR text

- End every commit message with `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.
- **Never add a `Claude-Session:` link line** to commit messages or PR descriptions. The repo is public.
- End PR descriptions with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and no
  session link.
- PR descriptions list what was built and the phase gate as a checklist.

## Commands

```sh
npm ci                    # install
npm run dev               # local dev server
npm run typecheck         # strict TypeScript (app, tests, scripts)
npm run test:coverage     # unit + property tests; fails if src/core coverage < 100% lines
npm test                  # same tests without coverage
npm run license:check     # licence gate (scripts/license-gate.mjs)
npm run brand:check       # brand guard (scripts/brand-guard.mjs)
npm run oracle:check      # hatch areas against shapely; exported DXF against ezdxf (Phase 7)
npm run build             # production build to dist/
npm run size:check        # 300 KB gzipped budget
npm run test:e2e          # Playwright, Chromium with GPU disabled; serves dist/, so run
                          # `npm run build` first after any source change
npm run ci                # all of the above, in CI order
```

## Code layout and rules

```text
src/core/      pure TypeScript: no DOM, no imports from outside src/core, no packages
  geom/        geometry kernel (Phase 1); hatch.ts: loops, areas, hatch lines (Phase 6)
  doc/         document model, commands, undo/redo, file format (Phase 2); modify commands
               in edit-commands.ts, shared command helpers in command-kit.ts (Phase 5);
               annotations ("notes") in notes.ts (model and resolve), note-validate.ts,
               note-commands.ts (Phase 6); sheets.ts, blocks.ts, constraints.ts,
               layout-commands.ts (Phase 9)
  spatial/     R-tree index, window/crossing/pick selection (Phase 3), snaps (Phase 4);
               inserts are indexed too (Phase 9)
  tools/       interactive tools as state machines, typed input, tracking, driver (Phase 4);
               modify tools in modify.ts (Phase 5), annotation tools in annotate.ts (Phase 6),
               blocks/inserts/constraints in layout.ts (Phase 9)
src/io/        DXF import/export, SVG, PDF (Phase 7); no runtime packages
src/script/    JavaScript API and Python runner (Phase 8). Mutations go through the command
               registry as one undo step. The Pyodide package is never imported from here.
src/render/    Canvas 2D: scene.ts (entities), notes.ts (annotations), view.ts (canvases), rulers,
               grid, viewport maths, png.ts (PNG export)
src/ui/        design system: theme.css tokens, palette.ts colours, fonts.css, dom.ts (el, icons),
               panels, command palette, rail.ts (tool rail), entry.ts (box beside the cursor),
               script-panel.ts
src/app/       store.ts (state), actions.ts (every user action), shell.ts (bars, shortcuts,
               palette list), interaction.ts (mouse), drafting.ts (tools on screen: snaps,
               tracking, keys), tools.ts (tool names, icons, keys), testing.ts (?test hook),
               python.ts (loads Pyodide from ./pyodide/ on demand);
               brand.ts holds the product name (the only place it is defined)
src/inspect/   file inspector page (inspect.html): owner's tool for checking .archilite files
public/        static files copied to the site as-is (examples/bracket.archilite)
docs/          file-format.md: the .archilite format, kept in step with src/core/doc/file.ts
tests/unit/    Vitest; tests/unit/core mirrors src/core; tests/unit/io covers DXF/SVG/PDF;
               tests/unit/script covers the JS/Python identity gate
tests/e2e/     Playwright browser tests
tests/oracle/  independent checks in Python (hatch areas against shapely; exported DXF against
               ezdxf + shapely), run in CI
scripts/       licence gate, brand guard, size budget (plain .mjs with JSDoc types)
```

- `tests/unit/architecture.test.ts` enforces the `src/core` rules.
- Geometry: world units are drawing units (mm by default), y up, angles in radians counter-clockwise
  from +x. Arcs have a start angle in [0, 2π) and a signed sweep. Shapes are immutable plain objects
  made by constructors that throw `RangeError` on bad input.
- Tolerance: `tolFor(...magnitudes)` = 1e-9 × max(1, size). Do not invent new epsilons. Use the
  kernel's.
- Every user action is a named command in the command registry (from Phase 2). The UI, keyboard,
  scripts and tests all go through it.
- Numbers stored in documents never include `-0`, `NaN` or `±Infinity`.
- Untrusted input (files, script parameters) is read only through `src/core/doc/validate.ts`
  readers, which report a path to the bad value. Pages render untrusted text with `textContent`,
  never `innerHTML`.
- A file-format change must bump `FILE_VERSION` if older versions could misread it, and must update
  `docs/file-format.md` and the example (`UPDATE_EXAMPLES=1 npx vitest run tests/unit/core/doc/example.test.ts`).
- Each new page is listed in `build.rollupOptions.input` in `vite.config.ts` and gets its own browser tests.
- Every user action goes in `src/app/actions.ts` and, if it changes the drawing, through a
  document command, so it can be undone. Then give it a key or a command-palette entry in
  `src/app/shell.ts`.
- Interactive tools live in `src/core/tools` as state machines (`ToolDef`): they ask for one
  thing at a time and return commands, never touching the document. Drive them through
  `drafting.ts` (`feed`, `feedTyped`) in both the app and tests. A new tool also gets an entry
  in `src/app/tools.ts` (rail button, palette label, key).
- Sheets, blocks and constraints (Phase 9) are document data: `pruneAndSolve` runs in
  `commitDraft` after every command. Bound point references only. Optional `sheet` is omitted
  on the first sheet. Inserts share the entity id space; sheets and blocks are named.
- A rectangle drawn with the Rectangle tool starts with four constraints (`entity.add` with
  `presets: true`, nothing else passes it). Constraints name polyline corners by number, so a
  command that changes a polyline's corner count lets those constraints go (`releaseRenumbered`),
  and a turn or mirror lets go the horizontal and vertical ones it made untrue (`releaseTurned`).
  Both count in `Executed.released` (tools: `Outcome.released`) and the app says so with
  `releasedMessage`. Constraint ids share the entity id space, so a tool-drawn rectangle uses the
  four ids after its own.
- Refusals are explained in plain words and change nothing: tools return `refuse(state, why)`,
  commands throw `CommandError`.
- Commands that split or rebuild an entity keep its layer, style and draw order, and the first
  piece keeps its id (`replaceWith` in `edit-commands.ts`).
- Annotations are notes (`Doc.notes`), not entities: they share ids, layers and draw order but are
  never geometry, so snaps and the modify commands ignore them. A dimension stores *where to
  measure* (point references), never the number: the number is measured from the geometry every
  time it is resolved. A note whose geometry is gone is removed in the same undo step.
- Dimension, text and hatch sizes are paper sizes at 1:1, set by the dimension style.
- Reference drawings are approved files compared exactly: `tests/fixtures/*.archilite`,
  refreshed only with `UPDATE_REFERENCES=1` and a look at the diff.
  - The step lists (`modify-reference.ts`, `annotate-reference.ts`) are replayed through the engine
    and through the real app. Every click in them must land at least 2 mm from any other object
    **and from any annotation's text**: a click inside a dimension's text picks the dimension.

## Design system (v0, Phase 3)

- Use the tokens in `src/ui/theme.css` and colours in `src/ui/palette.ts`. Don't add one-off
  colours.
- B612 is the only typeface shipped. Its digits are all one width, so it serves for numbers too.
  Code-like text uses the system monospace font.
- Copy is in sentence case, in plain words that describe what happens ("Load the example", not
  "Submit"). No ALL-CAPS labels and no "A · B" middle-dot strings.
- Icons are ArchiLite's own line drawings in `src/ui/dom.ts` (16 × 16, 1.6 stroke).
- The steel rulers are the one bold element. Keep everything else quiet.
- Look at screenshots of any visual change before committing it.
- Below 900px the side panels are hidden and cannot be opened. That is the desk layout
  squeezed, not the phone layout. Phase 11 (700px and under) is the plan for a phone browser:
  same page, tool strip, sheets, two-finger pan and pinch. Do not invent a second app for it.

## Performance rules

- In software rendering, line width dominates drawing cost: a hairline is about 5 times cheaper
  than a 2 px line, and rounded ends triple the cost again. Keep square ends, and keep the
  hairline and level-of-detail rules in `src/render/scene.ts`.
- `tests/e2e/performance.spec.ts` is the gate: 20,000 entities, average frame ≤ 33.3 ms with the
  GPU off. Run it after any rendering change and quote its numbers in the PR. GitHub's runners
  can be half as fast as the workspace, so keep local frames under about 20 ms.
- In the frame loop, per-entity work must be lookups only: no sorting, no string building, no
  new objects. Draw order and per-layer styles are cached (`scene.ts`). The test hook's
  `sceneStats()` gives the JavaScript share of a frame.

## Testing conventions

- Hand-calculated tests use exact expected values worked out by hand, compared with `expectPoint` /
  `expectClose` from `tests/unit/core/helpers.ts` at 1e-9.
- Property tests use fast-check with `PROPERTY_PARAMS` from `tests/unit/core/arbitraries.ts`
  (10,000 runs, fixed seed) and `PROPERTY_TIMEOUT`. Build random data by construction, not with
  `.filter`, because filtering made one suite ten times slower.
- Coverage thresholds live in `vite.config.ts`. Do not lower them; add tests instead.
- Independent oracles are Python scripts in `tests/oracle/` that read committed fixtures and check
  the numbers with a different implementation (`shapely` for hatch areas; `ezdxf` + `shapely` for
  exported DXF). Their packages are test tools only and never ship. Fixtures are refreshed only
  with a look at the diff.
- Screenshot clips start 2 px inside the ruler band (`drawingClip`): the rulers' tick marks
  overshoot it by a fraction of a pixel and caused a flake. Run a new screenshot test with
  `--repeat-each=5` before committing its baseline.
- Browser tests must also pass with no console errors and no requests to other origins.
- When a property test finds a bug, fix the code (not the test). Record the bug in `PROGRESS.md`,
  and in `ROADMAP.md` implementation notes if later phases should know about it.
