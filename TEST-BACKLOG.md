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

### Phase 6: annotation

On the live site once PR #7 is merged. The Annotate group is the last group on the tool rail (and
a second column on a short screen). With nothing selected, the right-hand panel shows the
dimension style; select a dimension, text or hatch to see and edit its fields.

- [ ] **M6.1 Dimension a part and check every number.** Press R, type `0,0` Enter and `@120,80`
      Enter, then Esc. Press D (linear dimension), type `0,0` Enter, `120,0` Enter, `60,-12` Enter,
      then Esc: it should read **120.00**. Do the same up the left side (`0,0`, `0,80`, `-12,40`):
      **80.00**. Now try a part of your own from a course or co-op drawing, dimension every
      feature, and compare each number with your own calculation or the drawing.
- [ ] **M6.2 Round and angled dimensions.** Press C, type `30,30` Enter and `12` Enter, then Esc.
      Use the Diameter dimension button, click the circle, click where the line should go:
      **Ø24.00**. Radius dimension: **R12.00**. Draw two lines from `0,0`: one to `@50,0`, one to
      `@50<30`. Angle dimension: click the corner, then near the far end of each line (the end
      snaps), then where the arc goes: **30.0°**.
- [ ] **M6.3 Dimensions follow the geometry.** With the 120 × 80 plate dimensioned, select the
      rectangle only, then Scale in the selection panel (base `0,0`, factor `2`). The width
      should read **240.00** with no other action. Undo: back to **120.00**. Try Rotate and
      Mirror in the panel, and trimming a dimensioned line (T). Does anything ever show a number
      that disagrees with the drawing?
- [ ] **M6.4 Dimension style (decision).** With nothing selected, open "Dimension style" in the
      right-hand panel. The defaults are ISO-style: text height 3.5, arrows 3, 2 decimal places
      for lengths, 1 for angles. Do they match what your courses or co-op use? Change a value,
      Save style, and add a new dimension: it should use the new style, and older dimensions
      using that style change too. Tell Claude which defaults you'd want.
- [ ] **M6.5 Text and leaders.** Press X, click a point, type `6 mm steel plate` Enter. Click
      the text and change it in the panel; Ctrl+Z puts it back. Use the Leader tool: click the
      arrow point, click a second point, Enter, type a note, Enter. Does typing text feel
      natural? Does `\n` start a new line?
- [ ] **M6.6 Hatch and its area.** Draw R `0,0` `@60,40`, then C `15,20` radius `4` and C
      `45,20` radius `5`. Press H, click the rectangle's edge, click each circle's edge (the
      islands), then Enter twice. The plate hatches with both holes clear. Click the hatch: Area
      should read **2271.195** (60 × 40 − 16π − 25π). Try the pattern option (P), the angle (A)
      and the spacing (S), and a solid hatch.
- [ ] **M6.7 Title block.** Ctrl+K, type "title block", click or type `0,0`. An A4 sheet border and
      title block appear. Click the sheet's border, fill in the fields in the panel. Does the
      layout work for what you hand in (course or co-op)? Tell Claude what is missing (logo
      space, revision table, projection symbol, sheet number).
- [ ] **M6.8 Legibility on your screen.** At 100% browser zoom, are dimension text, arrows and
      the title block text readable without zooming in? Check on the work laptop and a second
      screen if you have one. Dimension text is drawn at its paper size at 1:1.
- [ ] **M6.9 Hatch under text (decision).** Dimension a hole inside a hatched area. Hatch lines
      run through the dimension text (legible, but not ISO-clean). Is that acceptable for now, or
      should text keep the hatch back before Phase 7?
- [ ] **M6.10 Tool rail on a small screen.** On the work laptop, are all the tools on the rail
      visible (second column if the window is short)? Does anything sit under the rail when you
      press F to fit?

### Phase 7: import and export

On the live site once this phase's PR is merged. Export is next to Save; Open and drop accept DXF
as well as `.archilite`.

- [ ] **M7.1 DXF in LibreCAD.** Load the example, Export as DXF, open the file in LibreCAD.
      Measure these five features (target: agree to 0.001 mm):
      1. Overall plate 100 × 60 mm.
      2. Corner radius 5 mm.
      3. Hole Ø 8 mm.
      4. Slot length 30 mm (between the centres of the round ends: 20 mm straight + two 5 mm radii).
      5. Hole inset: centre 10 mm from the two nearest edges.
- [ ] **M7.2 DXF in Onshape or SolidWorks.** Repeat M7.1 in Onshape or SolidWorks with the same
      file. Note anything that fails to appear (hatches, text, centre lines).
- [ ] **M7.3 Printed 1:1 PDF.** Start a new drawing. Press L, type `0,0` Enter, `100,0` Enter, Esc.
      Export as PDF. Print at 100% (no "fit to page"). Measure the line with a ruler: it should be
      100 mm. If you cannot print, open the PDF, set the page scale to 100% and check that the
      page's MediaBox is 283.46 pt per 100 mm of drawing plus margin.
- [ ] **M7.4 SVG in the browser.** Export the example as SVG and open the file. The plate should
      look like the drawing, y up, holes round not oval.
- [ ] **M7.5 PNG.** Export as PNG. The drawing should fill the image on paper colour, without the
      rulers or the tool rail.
- [ ] **M7.6 Open a DXF from elsewhere.** If you have a simple DXF from LibreCAD or another
      program (lines, circles, a polyline), Open it. Do the lengths in the selection panel match
      the other program? Note anything dropped (the toast will say how many objects were left out).
- [ ] **M7.7 Floorplan text, units and layer names.** Open a floorplan DXF that uses
      `%%u` room labels (GREAT ROOM, W.I.C.). Expect: those names without the `%%u`. The
      “PROVIDE 20 MIN. DOOR” note has no `\A1;` in front. If the
      status bar says mm but the rooms are in feet-and-inches, click the unit (or Ctrl+K
      "Treat drawing units as inches") so a 672 wall reads as inches, not millimetres — the
      numbers stay put. Hover a long xref layer name; the tooltip is the full name. A new
      linear dimension on a wall should measure the geometry you picked. Kitchen and bath
      fixtures that were block inserts should be there as lines, arcs and circles. Original
      dimensions and hatches are still left out; the toast says how many.

### Phase 8: scripting

- [ ] **M8.1 JavaScript bolt circle.** On the work laptop, open the live site (or this PR's
      Pages preview). Press Script. Leave JavaScript and "Bolt circle". Press Run. Expect: a
      Ø100 outline, Ø40 bore, six Ø8 holes on a Ø70 pitch, title "Bolt circle". Ctrl+Z removes
      all of it in one step. Repeat with Flange and Slot pattern.
- [ ] **M8.2 First Python load.** Switch the language to Python (the matching example should
      appear). Press Run. Note how long until the drawing appears. Expect: the same picture as
      M8.1, and a wait of a few seconds the first time only (Pyodide is about 12 MB from this
      site, not from another origin). If it never finishes, or the browser talks to another
      host, tell Claude.
- [ ] **M8.3 Later Python loads.** Start a new drawing. Run the Python flange, then the slot
      pattern. Expect: each run after the first is much quicker, still one undo step.
- [ ] **M8.4 Network calls from a script.** In JavaScript, replace the editor with
      `fetch('https://example.com')` and Run. Expect: a message that network access is blocked
      in scripts, and an empty drawing. Then run the Python bolt circle, press Ctrl+Z, and use
      "Load the example". Expect: the example loads (the page's own fetch still works).

### Phase 9: blocks, sheets, constraints

- [ ] **M9.1 A real part, start to finish.** On the work laptop, draw a plate with a rectangular
      outline, hold the sides horizontal and vertical and the width and height with constraints,
      turn one hole into a block, and insert the other holes. Add a second sheet and put another
      insert of the hole on it. Expect: dragging a corner keeps the rectangle a rectangle of the
      same size; switching sheets in the status bar hides the other sheet; exploding one insert
      does not change the others. Save, reopen, and check the numbers still match.
- [ ] **M9.2 Constraints after an edit.** Draw a line that is not quite horizontal. Horizontal
      constraint, then move one end with Move. Expect: the line lies flat again. Undo once:
      the move comes back, then the line flattens again. If it stays skewed, tell Claude.
- [ ] **M9.3 Block inserts in another program.** Export the plate from M9.1 as DXF. Open it in
      LibreCAD. Expect: the current sheet's lines and the exploded look of each insert (DXF has
      no ArchiLite blocks). Switch sheet, export again, and check the other sheet.
- [ ] **M9.4 Scripted block.** In the script panel, run a few lines that `cad.circle` a hole,
      `cad.block` it, `cad.insert` two copies, then `cad.sheet` and insert one more. Expect: one
      undo step removes all of it.

- [ ] **M9.5 Conflicting constraints are reported.** Draw a circle. Add a radius constraint of
      3, then another of 4. Expect: a red message "2 constraints could not be met (radius)" and
      a circle of radius about 3.5. Undo the second constraint: the message goes away and the
      radius is 3.

### Phase 10: DWG import (read only)

- [ ] **M10.1 A DWG from another program.** On the work laptop, export a simple drawing from
      LibreCAD (or Onshape or SolidWorks) as DWG, 2013 or 2018 if you can choose. Include a
      known length, a circle, an arc and a closed polyline. Open it in ArchiLite. Expect: the
      four shapes are there. Measure the same five features as M7.1 in the selection panel;
      they should agree with the other program to 0.001 mm. Note what the toast says was left
      out (hatches, dimensions until Phase 12, paper space). Opening the example first should
      not download the decoder; opening this file should.
- [ ] **M10.2 Encrypted or old DWG.** If you have a password-protected DWG, Open it. Expect: a
      plain-words refusal about encryption, and an empty drawing. A very old DWG (R12 / AC1009)
      should name the version and refuse without fetching the decoder.

### Phase 13: driving dimensions and editing constrained drawings

- [ ] **M13.1 Type a new number.** On the work laptop, draw a 100 mm line and an aligned
      dimension. Expect: the selection panel lists a Distance constraint at 100. Double-click
      the dimension, type 120, press Enter. Expect: the line is 120 mm and the dimension reads
      120.00. Ctrl+Z once: both are 100 again.
- [ ] **M13.2 Reference dimension.** With a dimension selected, set "Holds the drawing" to
      "No (reference)". Expect: the number is in brackets, for example (100.00), and scaling
      the line changes the number. Place a new dimension with **R** (Measure only) and check it
      never held the drawing.
- [ ] **M13.3 Joined L follows.** Draw a horizontal line and a vertical line that meet. Horizontal
      and vertical constraints on the legs, coincident at the corner. Move the vertical leg
      sideways. Expect: the horizontal leg grows or shrinks so they still meet, and both stay
      straight. Undo once: the move comes back.
- [ ] **M13.4 A fixed point refuses to move.** Fix the start of a line. Move the whole line.
      Expect: a plain-words message that names the constraint, and the line does not move.
- [ ] **M13.5 Show constraints.** Shift+C (or the command palette "Show constraints"). Expect:
      small hairline marks beside what they hold. Pick a mark: the selection panel names that
      constraint and highlights the geometry. Shift+C again hides the marks.

## Coming with later phases

Claude moves these into "Ready to test now", with exact steps, when each phase lands.

- **Phase 11:** on your iPhone (Safari) and on an Android phone (Chrome), open the live site.
  Load the example, pan with one finger, pinch to zoom, and draw a line by typing `0,0` then
  `100,0`. The selection sheet should read 100.000. Save, then open that file again. Note
  where the save went (Files, the share sheet, or a download). Phase 10 is not required for
  this.
- **Phase 12:** open the floorplan DXF. Treat units as inches. Expect: original wall
  dimensions that bind to geometry appear as ArchiLite dimensions (the garage 21′2″ × 20′10″
  walls read 254 and 250). Pick one, move the wall, and the number changes. A dimension that
  was overtyped in the other program is still left out. Hatches are still left out. Imported
  dimensions are reference until you switch them.
