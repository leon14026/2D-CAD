# ArchiLite

A lightweight, browser-based 2D CAD application for engineering drawings.

- **Runs in the browser, locally.** A static site with no server-side code. Drawings stay on your
  machine unless you export them.
- **No dedicated graphics card.** Drawing uses plain Canvas 2D. Every browser test runs in
  Chromium with the GPU switched off.
- **Lightweight.** The whole app is a few kilobytes today; CI enforces a 300 KB (gzipped) budget.
- **Engineering-grade accuracy.** Real units, true arcs, exact snaps, dimensions measured from
  geometry, checked against an independent Python oracle (hatch areas from Phase 6, exports from Phase 7).
- **Scriptable.** JavaScript and Python (via Pyodide, loaded only when needed) from Phase 8.
- **DWG later.** This build does not open DWG. Phase 10 will, read only, and only after you
  open one. Until then, export DXF from the other program and open that.

**Status:** Phase 8 (scripting) built: JavaScript and Python (`cad` API, script panel, Pyodide
on demand) on top of Phase 7's import and export. Phase 9 (blocks, sheets, constraints) is
stretch. See
[PROGRESS.md](PROGRESS.md)
for the current state, [ROADMAP.md](ROADMAP.md) for the phases and the tests each must pass, and
[TEST-BACKLOG.md](TEST-BACKLOG.md) for manual tests.

**Live site:** https://leon14026.github.io/2D-CAD/ · [file inspector](https://leon14026.github.io/2D-CAD/inspect.html)

**File format:** [docs/file-format.md](docs/file-format.md) (`.archilite`, plain JSON)

## Using it

| To | Do this |
|---|---|
| Find any command | Ctrl+K, then type |
| Open or save | Open / Save buttons, Ctrl+O / Ctrl+S, or drop a file on the drawing (.archilite or DXF) |
| Export | Export button, or Ctrl+K then "Export as DXF / SVG / PDF / PNG" |
| Zoom | Mouse wheel or pinch (about the cursor); F fits the drawing |
| Pan | Middle-drag, or hold Space and drag; arrow keys |
| Select | Click; Shift+click adds or removes |
| Select by box | Drag left to right (entirely inside) or right to left (inside or touching) |
| Show, hide or lock layers | Eye and padlock in the Layers panel; Ctrl+Z undoes |
| Draw | Tool rail on the left, or L line, P polyline, C circle, A arc, R rectangle, N polygon |
| Type a point | Just start typing: `x,y`, `@dx,dy` (from the last point), `@length<angle`, or one distance along the cursor direction; Enter |
| Finish or stop a tool | Enter or right-click finishes; Esc stops |
| Snaps, ortho, tracking | Status bar, or Shift+S, Shift+O, Shift+T; hold Shift for horizontal or vertical |
| Modify | Lower half of the tool rail, or M move, O offset, T trim, E extend; select something for more in the selection panel |
| Annotate | Last group on the tool rail, or D linear dimension, X text, H hatch; select a dimension, text or hatch to edit it in the selection panel |
| Delete | Delete key or the selection panel; Ctrl+Z brings it back |
| Panels, grid, lineweights | `[`, `]`, G, W |
| Run a script | Script button, backtick, or Ctrl+K then "script". JavaScript is local; the first Python run downloads Pyodide from this site |

Drawings are saved as `.archilite` files on your computer; nothing is uploaded.

## Development

Nothing needs to be installed to *use* ArchiLite. To work on it locally you need Node.js 22.12+;
GitHub Actions runs every check on each pull request, so local setup is optional.

```sh
npm ci
npm run dev          # local dev server
npm run ci           # the full Phase gate: typecheck, unit tests, licence gate,
                     # brand guard, hatch-area and DXF oracles, build, size budget, browser tests (GPU disabled)
```

The oracles need Python 3 with `shapely` and `ezdxf` (`pip install shapely ezdxf`). Browser tests serve
the built site, so run `npm run build` after changing any source before running them by hand.

Browser tests use Playwright's Chromium (`npx playwright install chromium`). Playwright is pinned to
1.63.0 so everyone renders with the same Chromium build as the approved screenshots.

| Check | Command | What it proves |
|---|---|---|
| Typecheck | `npm run typecheck` | Strict TypeScript across app, tests and scripts |
| Unit and property tests | `npm run test:coverage` | Hand-calculated geometry to 1e-9, 10,000-case property tests, 100% kernel coverage, kernel isolated from the DOM; licence gate, brand guard and size budget behave as specified |
| Licence gate | `npm run license:check` | No copyleft or unlicensed dependencies |
| Brand guard | `npm run brand:check` | No third-party product names in the app |
| Size budget | `npm run size:check` | Built site ≤ 300 KB gzipped |
| Browser tests | `npm run test:e2e` | Works in Chromium with no GPU; no console errors; correct coordinates; selection, pan, zoom, layers, palette, open, save and export behave; the file inspector refuses bad files clearly and never runs file contents as HTML |
| Performance | part of `test:e2e` | 20,000 entities pan and zoom at 30 fps or better with the GPU off |
| Screenshots | part of `test:e2e` | approved images still match |

## Licence

ArchiLite is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your
option. Notices are in [NOTICE](NOTICE); third-party material is listed in
[ATTRIBUTION.md](ATTRIBUTION.md).

ArchiLite is an independent project and is not affiliated with, sponsored by or endorsed by
Autodesk, Inc. or the ArtCraft team. AutoCAD and DWG are trademarks of Autodesk, Inc. All other
trademarks belong to their respective owners.
