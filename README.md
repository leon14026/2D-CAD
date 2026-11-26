# ArchiLite

A lightweight, browser-based 2D CAD application for engineering drawings.

- **Runs in the browser, locally.** A static site with no server-side code. Drawings stay on your
  machine unless you export them.
- **No dedicated graphics card.** Drawing uses plain Canvas 2D. Every browser test runs in
  Chromium with the GPU switched off.
- **Lightweight.** The whole app is a few kilobytes today; CI enforces a 300 KB (gzipped) budget.
- **Engineering-grade accuracy.** Real units, true arcs, exact snaps, dimensions measured from
  geometry, checked against an independent Python oracle (from Phase 7).
- **Scriptable.** JavaScript and Python (via Pyodide, loaded only when needed) from Phase 8.

**Status:** Phase 2 (document model and file format) complete; Phase 3 (viewer) next. See [PROGRESS.md](PROGRESS.md)
for the current state, [ROADMAP.md](ROADMAP.md) for the phases and the tests each must pass, and
[TEST-BACKLOG.md](TEST-BACKLOG.md) for manual tests.

**Live site:** https://leon14026.github.io/2D-CAD/ · [file inspector](https://leon14026.github.io/2D-CAD/inspect.html)

**File format:** [docs/file-format.md](docs/file-format.md) (`.archilite`, plain JSON)

## Development

Nothing needs to be installed to *use* ArchiLite. To work on it locally you need Node.js 22.12+;
GitHub Actions runs every check on each pull request, so local setup is optional.

```sh
npm ci
npm run dev          # local dev server
npm run ci           # the full Phase gate: typecheck, unit tests, licence gate,
                     # brand guard, build, size budget, browser tests (GPU disabled)
```

Browser tests use Playwright's Chromium (`npx playwright install chromium`), or set `CHROME_PATH`
to an installed Chrome.

| Check | Command | What it proves |
|---|---|---|
| Typecheck | `npm run typecheck` | Strict TypeScript across app, tests and scripts |
| Unit and property tests | `npm run test:coverage` | Hand-calculated geometry to 1e-9, 10,000-case property tests, 100% kernel coverage, kernel isolated from the DOM; licence gate, brand guard and size budget behave as specified |
| Licence gate | `npm run license:check` | No copyleft or unlicensed dependencies |
| Brand guard | `npm run brand:check` | No third-party product names in the app |
| Size budget | `npm run size:check` | Built site ≤ 300 KB gzipped |
| Browser tests | `npm run test:e2e` | Works in Chromium with no GPU; no console errors; correct coordinates; the file inspector accepts good files, refuses bad ones with clear messages, and never runs file contents as HTML |

## Licence

ArchiLite is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your
option. Notices are in [NOTICE](NOTICE); third-party material is listed in
[ATTRIBUTION.md](ATTRIBUTION.md).

ArchiLite is an independent project and is not affiliated with, sponsored by or endorsed by
Autodesk, Inc. or the ArtCraft team. AutoCAD and DWG are trademarks of Autodesk, Inc. All other
trademarks belong to their respective owners.
