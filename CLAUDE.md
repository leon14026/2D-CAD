# ArchiLite: instructions for Claude

ArchiLite is the owner's (GitHub: leon14026) browser-based 2D CAD application for engineering
drawings. It is a personal project. Live site: https://leon14026.github.io/2D-CAD/

**Read these first, every session:**

| File | What it is | Keep it up to date |
|---|---|---|
| `ROADMAP.md` | The plan: decisions, constraints, budgets, accuracy model, phases and their test gates, implementation notes | Tick gate boxes as they pass in CI; add implementation notes later phases need |
| `PROGRESS.md` | Where the project stands: phase table and dated log | Add an entry whenever a phase starts, a PR opens or merges, or a decision is made |
| `TEST-BACKLOG.md` | Manual tests only the owner can do (real laptops, other CAD programs, rulers, legal checks) | Add the owner's tests for every phase before its PR opens; never tick a box on the owner's behalf |
| `CLAUDE.md` | This file | Update when a convention changes |

## Hard constraints

1. **Browser-only and local.** Static site, no server code. Drawings never leave the machine unless exported.
2. **No dedicated GPU.** Canvas 2D only. Never use WebGL or WebGPU. Browser tests run in Chromium with
   `--disable-gpu --disable-software-rasterizer`.
3. **Lightweight.** ≤ 300 KB gzipped (enforced by `npm run size:check`). Zero runtime dependencies unless a
   phase justifies one and it passes the strict licence allowlist. Pyodide (Phase 8) loads only on demand.
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
- Run the whole gate locally before pushing: `npm run ci`. In the cloud workspace, Chrome is at
  `/usr/bin/google-chrome`, so run `CHROME_PATH=/usr/bin/google-chrome npm run ci`.
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
npm run build             # production build to dist/
npm run size:check        # 300 KB gzipped budget
npm run test:e2e          # Playwright, Chromium with GPU disabled
npm run ci                # all of the above, in CI order
```

## Code layout and rules

```text
src/core/      pure TypeScript: no DOM, no imports from outside src/core, no packages
  geom/        geometry kernel (Phase 1)
  doc/         document model, commands, undo/redo, file format (Phase 2)
src/render/    Canvas 2D drawing
src/ui/        ArchiLite interface, design tokens (theme.css, palette.ts)
src/app/       wiring; brand.ts holds the product name (the only place it is defined)
src/inspect/   file inspector page (inspect.html): owner's tool for checking .archilite files
public/        static files copied to the site as-is (examples/bracket.archilite)
docs/          file-format.md: the .archilite format, kept in step with src/core/doc/file.ts
tests/unit/    Vitest; tests/unit/core mirrors src/core
tests/e2e/     Playwright browser tests
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

## Testing conventions

- Hand-calculated tests use exact expected values worked out by hand, compared with `expectPoint` /
  `expectClose` from `tests/unit/core/helpers.ts` at 1e-9.
- Property tests use fast-check with `PROPERTY_PARAMS` from `tests/unit/core/arbitraries.ts`
  (10,000 runs, fixed seed) and `PROPERTY_TIMEOUT`. Build random data by construction, not with
  `.filter`, because filtering made one suite ten times slower.
- Coverage thresholds live in `vite.config.ts`. Do not lower them; add tests instead.
- Browser tests must also pass with no console errors and no requests to other origins.
- When a property test finds a bug, fix the code (not the test). Record the bug in `PROGRESS.md`,
  and in `ROADMAP.md` implementation notes if later phases should know about it.
