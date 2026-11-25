# Manual test backlog

Tests only you can do: real laptops and screens, other CAD programs, a ruler, legal checks.
Automated tests run in CI on every pull request; these complement them.

**How to use this file:** tick a box when a test passes and add the date and what you used, e.g.
`- [x] M0.1 … — 2026-11-26, work laptop, Edge 131, Intel Iris Xe`. If a test fails, leave it
unticked, note what you saw, and tell Claude. Claude adds new tests here for every phase but never
ticks them for you.

## Ready to test now

### Phase 0: foundations (live site)

- [ ] **M0.1 Work laptop, no dedicated GPU.** Open https://leon14026.github.io/2D-CAD/ on the work
      laptop. Expect: the page loads in a few seconds, the paper-coloured grid fills the window,
      with a green vertical axis, a red-brown horizontal axis and a small square at the centre.
      Note the browser and graphics chip (Windows: Task Manager → Performance → GPU).
- [ ] **M0.2 Other browsers.** Repeat M0.1 in Edge, Chrome and Firefox (and Safari on a Mac or
      iPhone if you have one). Expect: the same picture in each.
- [ ] **M0.3 Cursor readout.** Move the mouse to the small centre square. Expect X 0.000 and
      Y 0.000. Move right: X rises. Move up: Y rises. One major grid square is 10 mm.
- [ ] **M0.4 Zoom and resize.** Set browser zoom to 150% and 67%, then resize the window. Expect:
      grid lines stay sharp (not blurry), the centre square stays centred, and nothing flickers or
      goes blank.
- [x] **M0.5 Pages source.** Settings → Pages → Source shows GitHub Actions. 2026-11-25, confirmed
      by screenshot.
- [ ] **M0.6 Copyright holder (decision).** `LICENSE-MIT` says "the ArchiLite contributors". Decide
      whether to keep that or use your own name, and tell Claude if it should change.
- [ ] **M0.7 Trademark search (before any launch beyond GitHub).** Search "ArchiLite" in classes 9
      (software) and 42 (software services) on the Canadian Trademarks Database (CIPO) and USPTO.
      Expect: no live mark for CAD or design software. If one exists, the name is a one-line
      change in `src/app/brand.ts`.

### Phase 1: geometry kernel (engineering review)

Nothing new is visible in the app; these check the maths behind the tests.

- [ ] **M1.1 Spot-check the hand calculations.** Work these out by hand or calculator and compare
      with the expected values in the tests:
      1. Circles of radius 5 centred at (0, 0) and (8, 0) meet at (4, ±3).
         (`tests/unit/core/intersect.test.ts`)
      2. The circle through (0, 0), (2, 0), (0, 2) has centre (1, 1) and radius √2 ≈ 1.41421356.
         (`curves.test.ts`)
      3. A 10 × 4 slot with round ends has area 40 + 4π ≈ 52.5663706. (`polyline.test.ts`)
      4. Bulge 1 from (0, 0) to (2, 0) is a half circle through (1, −1). (`polyline.test.ts`)
      5. Mirroring (0, 0) in the line y = x + 1 gives (−1, 1). (`transform.test.ts`)
- [ ] **M1.2 Tolerance sanity (decision).** The kernel treats points as equal within 1e-9 × the
      drawing's size (1e-9 mm for small parts, 1e-5 mm across a 10 m drawing). Confirm that's tight
      enough for your work. Most machining needs about 0.001 mm.

## Coming with later phases

Claude moves these into "Ready to test now", with exact steps, when each phase lands.

- **Phase 2:** read the example drawing file and file-format guide; try broken files in the file
  inspector.
- **Phase 3:** pan and zoom a large drawing on the work laptop and judge smoothness; select by
  window and crossing.
- **Phase 4:** draw a part from one of your own sketches using typed coordinates and snaps; check
  the dimensions against your sketch.
- **Phase 5:** offset, trim, fillet and chamfer on a real part outline; check by measuring.
- **Phase 6:** dimension a part and compare every dimension with your own calculation; check that
  the dimension style matches what your courses or co-op use.
- **Phase 7:** open exported DXF files in LibreCAD and in Onshape or SolidWorks and measure 5
  features (target: 0.001 mm agreement). Print a 1:1 PDF and measure a 100 mm line with a ruler.
- **Phase 8:** run the example Python scripts on the work laptop. Check that the first Python load
  is acceptable and later loads are fast.
- **Phase 9:** draw a complete real part drawing start to finish in ArchiLite.
