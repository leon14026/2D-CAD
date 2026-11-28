# DWG fixtures (Phase 10)

These files were made by another program from `shapes.ts`, then committed. CI only
reads them; it does not install a DWG writer.

Geometry (millimetres, y up):

- Line from (0, 0) to (100, 0).
- Circle centre (50, 40), radius 10.
- Arc centre (0, 0), radius 20, start 0, sweep π/2 (ends at (0, 20)).
- Closed polyline (0, 0) → (30, 0) bulge 1 → (30, 20) → (0, 20).

Versions:

- `shapes-ac1015.dwg` — AC1015 (2000).
- `shapes-ac1027.dwg` — AC1027 (2013).

To rebuild (not part of `npm run ci`): convert `shapes.dxf` with a local DWG writer
that is not a project dependency. LibreDWG 0.14 `dwgwrite --as r2000` produced the
AC1015 file. Its `--as r2013` encode is not something `cadkit-wasm` 0.5.4 can read,
so the AC1027 file was made locally by adding the four shapes to a genuine 2013
drawing and writing it back with the same LibreDWG (never shipped). Look at the
imported geometry in the tests (1e-6 mm) before committing a refresh.
