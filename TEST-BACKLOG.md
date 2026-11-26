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

### Phase 2: document model and file format

Use the file inspector at https://leon14026.github.io/2D-CAD/inspect.html (live once PR #3 is
merged) or the "File inspector" link at the bottom right of the main page.

- [ ] **M2.1 Example drawing by hand.** Press "Load example". Check these against your own
      calculation:
      - Overall size: 100.000 × 60.000 mm.
      - Outline area: 100 × 60 minus four corner pieces of (1 − π/4) × 5² = **5978.540 mm²**.
      - Four holes at Ø 8.000, each 50.265 mm².
      - Slot area: 20 × 10 + π × 5² = **278.540 mm²**.
      - Layers: Outline (1 entity), Holes (5) and Centre lines (10).
- [ ] **M2.2 Read the file.** Open `public/examples/bracket.archilite` on GitHub. It should read
      sensibly with `docs/file-format.md` beside it: one layer or entity per line, units, layer
      names. Note anything confusing.
- [ ] **M2.3 Break it on purpose.** In the inspector, edit the text and press Check after each
      change. Expect a red "This file cannot be opened" with a plain message and a location:
      1. Change `"version": 1` to `2`. Expect the message to say a newer ArchiLite saved it.
      2. Change a hole's `"radius":4` to `-4`. Expect the location `entities[1].geom.radius`.
      3. Rename the Holes layer to `OUTLINE`. Expect that the name is already used.
      4. Delete a comma. Expect "not valid JSON".
      5. Change `"units": "mm"` to `"yd"`. Expect a list of allowed units.
- [ ] **M2.4 Open a file from disk.** Download `bracket.archilite` from GitHub (Raw → save), then
      use "Open file…". Expect "Valid ArchiLite drawing". Try this on the work laptop too.
- [ ] **M2.5 Style choices (decision).** Check the linetype names (continuous, dashed, dash-dot,
      dash-double-dot, dotted) and the ISO lineweights (0.13–2 mm) against what your courses or
      co-op drawings use. Tell Claude if you need others (for example 0.6 mm, or a "phantom"
      name).

### Phase 3: viewer

On the live site once PRs #2, #3 and #4 are merged. Press Ctrl+K and type to find any command.

- [ ] **M3.1 Smoothness on the work laptop (no dedicated GPU).** Ctrl+K → "Load the large test
      drawing (20,000 entities)". Pan (middle-drag, or hold Space and drag) and zoom (mouse
      wheel or pinch) around the whole grid. Expect: it follows your hand without visible
      stutter. Note the laptop, browser and graphics chip, and anything that feels slow.
- [ ] **M3.2 Touchpad (decision).** On the laptop's touchpad: two-finger scroll zooms (the usual
      CAD convention), pinch zooms, and Space + drag pans. Is that comfortable, or should
      two-finger scroll pan instead? Tell Claude which.
- [ ] **M3.3 Selection.** Load the example. Check each of these:
      1. Click the outline. Expect the selection panel to show area **5978.540**.
      2. Shift+click a hole. Expect it to be added; Shift+click it again to remove it.
      3. Drag left to right around the lower-left hole and its centre lines. Expect exactly those
         3 to be selected.
      4. Drag right to left across the slot. Expect the slot and its 2 centre lines.
      5. Press Esc. Expect the selection to clear.
- [ ] **M3.4 Numbers in the selection panel.** Check against your own working:
      - A hole: Ø 8.000, circumference **25.133**, area **50.265**.
      - The slot: area **278.540**, length **71.416**.
      - A centre line: length 12.000, angle 0° or 90°.
- [ ] **M3.5 Layers.** Hide Holes with the eye, lock Outline with the padlock, then press Ctrl+Z
      twice. Expect both undone. Click a layer name: it becomes current (blue bar). Ctrl+A
      skips hidden and locked layers.
- [ ] **M3.6 Save and reopen.** Hide a layer, press Ctrl+S, then open the downloaded file (Open,
      or drag it onto the drawing). Expect the layer still hidden. The orange dot by the title
      shows unsaved changes.
- [ ] **M3.7 Look and feel (decision).** The design uses B612 (a typeface made for aircraft cockpit
      displays), cool drafting-film paper, layout-fluid blue for selection, brass for the
      crossing box, and steel rulers. Tell Claude what to keep or change, including anything
      hard to read on your screens.
- [ ] **M3.8 High-DPI and scaling.** On a laptop with Windows display scaling at 125% or 150%,
      check that lines, grid and ruler labels stay sharp and that clicks land where you point.

### Phase 4: precision drafting

On the live site once PRs #2 to #5 are merged. The tool rail is at the left of the drawing; the
box beside the cursor shows what each tool wants next.

- [ ] **M4.1 A part from your own sketch.** Pick a simple part from a course or from work. Draw
      it using typed points only (`x,y`, `@dx,dy`, `@length<angle`) plus snaps. Then click each
      line and circle and check its length or diameter in the selection panel against your
      sketch.
- [ ] **M4.2 Typed input, step by step.** Start a new drawing (Ctrl+K → "Start a new drawing").
      1. Press R, type `0,0` Enter, then `@120,80` Enter, then Esc. Click the rectangle:
         width **120.000**, height **80.000**, area **9600.000**.
      2. Press C, type `15,15` Enter, `4` Enter, then Esc. Click the circle: Ø **8.000**.
      3. Press L, type `10,40` Enter, `@20<60` Enter, `@20<-60` Enter, then press C to close.
         Click each of the three lines: length **20.000**.
      4. Press N, type `6` Enter, `60,40` Enter, `10` Enter, Esc. Click the hexagon: its
         perimeter should be **60.000** (6 sides of 10).
- [ ] **M4.3 Snaps on your screen.** Start a line and move near ends, middles, centres and
      crossings of the example bracket. The point snaps within about 10 pixels, with a small
      square and a label. Decide: too sticky, too loose, or right? Does the label ever hide
      what you need?
- [ ] **M4.4 Tracking.** With a line started, move the cursor round: a dotted line appears every
      15°. Decide: keep 15° as the default, or prefer 45° or 90°? (Ctrl+K → "Track angles
      every …" to try them.)
- [ ] **M4.5 Keys.** L, P, C, A, R and N start tools. Shift+S, Shift+O and Shift+T switch snaps,
      ortho and tracking. Holding Shift forces horizontal or vertical. `[` and `]` hide the
      panels. Any of these awkward on your keyboard or against habits from other programs?
- [ ] **M4.6 The box beside the cursor.** Is it readable, and is it in the way near the edges of
      the drawing? Try a single typed distance: start a line, point the cursor in a direction,
      type `25` and Enter. Is that intuitive?
- [ ] **M4.7 Touchpad only.** Draw a polyline with a touchpad: tap to place points, two-finger
      tap (right-click) to finish. Does it work smoothly?

### Phase 5: modify tools

On the live site once PRs #2 to #6 are merged. The Modify group is the lower half of the tool
rail; select something to see more in the selection panel.

- [ ] **M5.1 Offset, trim, fillet and chamfer on a real outline.** Draw an outline from one of
      your parts (or load the example). Offset it 2 mm inside (O, type `2`, click the outline,
      click inside). Round two corners with Fillet (radius 3, click the two lines either side of
      each corner). Trim a centre line back to a hole (T, click the part to remove). Measure
      the results in the selection panel against your own working.
- [ ] **M5.2 Rounding a whole outline.** Press R, type `0,0` Enter and `@100,60` Enter, then Esc.
      Click the rectangle, then Round off in the selection panel, type `5` Enter. Click it again:
      length should be **2 × (90 + 50) + 2π × 5 = 311.416**.
- [ ] **M5.3 Arrays.** Draw a Ø8 hole at `10,10`. Select it, choose Array in the selection panel,
      and type 4 columns, 3 rows, 20, 15. Expect 12 holes, the last centred at (70, 40). Then
      try a polar array of 6 round a centre.
- [ ] **M5.4 Move, copy, rotate, mirror with typed values.** Select something and use each from
      the selection panel. Base point first, then `@dx,dy` or an angle in degrees. Mirror keeps
      the original unless you press K. Does each do what you expect?
- [ ] **M5.5 Join and explode.** Draw three lines end to end. Select them, Join; the selection
      panel should now show one polyline. Explode it back into three lines.
- [ ] **M5.6 Mistakes.** Try to trim something nothing crosses, fillet two parallel lines, and
      offset a small circle inwards by more than its radius. Is each message clear about what
      went wrong and what to do?
- [ ] **M5.7 Keys and layout (decision).** M move, O offset, T trim, E extend, Delete deletes.
      Copy, rotate, mirror and fillet are on the rail; scale, chamfer and the arrays are in the
      selection panel and the palette. Tell Claude what you'd want on keys or on the rail.

## Coming with later phases

Claude moves these into "Ready to test now", with exact steps, when each phase lands.

- **Phase 6:** dimension a part and compare every dimension with your own calculation; check that
  the dimension style matches what your courses or co-op use.
- **Phase 7:** open exported DXF files in LibreCAD and in Onshape or SolidWorks and measure 5
  features (target: 0.001 mm agreement). Print a 1:1 PDF and measure a 100 mm line with a ruler.
- **Phase 8:** run the example Python scripts on the work laptop. Check that the first Python load
  is acceptable and later loads are fast.
- **Phase 9:** draw a complete real part drawing start to finish in ArchiLite.
