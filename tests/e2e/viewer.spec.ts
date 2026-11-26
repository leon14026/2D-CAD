import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { clickWorld, dragWorld, EX, openExample, state, toPage, watchErrors } from './helpers';

const EXAMPLE = readFileSync('public/examples/bracket.archilite', 'utf8');

test('cold start: interactive within 2 seconds', async ({ page }) => {
  await page.goto('./');
  const ready = await page.evaluate(() => performance.getEntriesByName('archilite-ready')[0]?.startTime ?? Infinity);
  test.info().annotations.push({ type: 'cold start', description: `${ready.toFixed(0)} ms` });
  expect(ready).toBeLessThan(2000);
});

test('the example opens fitted, with its layers listed', async ({ page }) => {
  const errors = watchErrors(page);
  await openExample(page);
  await expect(page.locator('#al-title')).toHaveText('Example bracket');
  await expect(page.locator('#al-empty')).toBeHidden();
  const layers = page.locator('.al-layer');
  await expect(layers).toHaveCount(3);
  await expect(layers.nth(0)).toContainText('Outline1');
  await expect(layers.nth(1)).toContainText('Holes5');
  await expect(layers.nth(2)).toContainText('Centre lines10');
  // The whole 100 × 60 plate is on screen.
  const corner = await toPage(page, 100, 60);
  const origin = await toPage(page, 0, 0);
  const area = await page.locator('#al-overlay').boundingBox();
  expect(origin.x).toBeGreaterThan(area!.x + 22);
  expect(corner.x).toBeLessThan(area!.x + area!.width);
  expect(corner.y).toBeGreaterThan(area!.y + 22);
  expect(errors).toEqual([]);
});

test('click picks the nearest line; Shift adds and removes; Esc clears', async ({ page }) => {
  await openExample(page);
  await clickWorld(page, 50, 0);
  expect((await state(page)).selection).toEqual([EX.outline]);
  await expect(page.locator('#al-selection-panel')).toContainText('Polyline');
  await expect(page.locator('#al-selection-panel')).toContainText('5978.540');
  // The hole's rim at 45°, clear of its centre lines, which cross the rim at 0°, 90°, 180° and 270°.
  const rim = 10 + 4 * Math.SQRT1_2;
  await clickWorld(page, rim, rim, ['Shift']);
  expect((await state(page)).selection).toEqual([EX.outline, EX.holes[0]]);
  await clickWorld(page, rim, rim, ['Shift']);
  expect((await state(page)).selection).toEqual([EX.outline]);
  await page.keyboard.press('Escape');
  expect((await state(page)).selection).toEqual([]);
  await clickWorld(page, 30, 40); // empty paper
  expect((await state(page)).selection).toEqual([]);
});

test('window selection (left to right) takes only what is entirely inside', async ({ page }) => {
  await openExample(page);
  await dragWorld(page, [3, 17], [17, 3]);
  expect((await state(page)).selection).toEqual([EX.holes[0], ...EX.hole1Lines]);
  // A box over half the hole takes nothing (its right edge stays clear of the centre line at x = 10).
  await dragWorld(page, [3, 17], [9.5, 3]);
  expect((await state(page)).selection).toEqual([]);
});

test('crossing selection (right to left) also takes what it touches', async ({ page }) => {
  await openExample(page);
  await dragWorld(page, [58, 36], [42, 24]);
  expect((await state(page)).selection).toEqual([EX.slot, ...EX.slotLines]);
  await expect(page.locator('#al-count')).toHaveText('3 of 16 selected');
  // Shift + box adds to the selection.
  await page.keyboard.down('Shift');
  await dragWorld(page, [3, 17], [17, 3]);
  await page.keyboard.up('Shift');
  expect((await state(page)).selection).toEqual([EX.holes[0], EX.slot, ...EX.hole1Lines, ...EX.slotLines].sort((a, b) => a - b));
});

test('select all, hidden and locked layers', async ({ page }) => {
  await openExample(page);
  await page.keyboard.press('Control+a');
  expect((await state(page)).selection).toEqual(EX.all);
  await page.getByRole('button', { name: 'Hide layer Holes' }).click();
  await page.keyboard.press('Control+a');
  expect((await state(page)).selection).toHaveLength(11);
  await page.getByRole('button', { name: 'Lock layer Outline' }).click();
  await page.keyboard.press('Control+a');
  expect((await state(page)).selection).toHaveLength(10);
  await clickWorld(page, 50, 0); // a locked line can't be picked
  expect((await state(page)).selection).toEqual([]);
  // Both layer changes are ordinary undoable edits.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  expect((await state(page)).selection).toEqual(EX.all);
  await page.keyboard.press('Control+y');
  await expect(page.getByRole('button', { name: 'Show layer Holes' })).toBeVisible();
});

test('wheel zooms about the cursor; middle-drag and Space-drag pan; F fits', async ({ page }) => {
  await openExample(page);
  const fitted = (await state(page)).viewport;
  const p = await toPage(page, 90, 50);
  await page.mouse.move(p.x, p.y);
  const before = [await page.locator('#al-coord-x').textContent(), await page.locator('#al-coord-y').textContent()];
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await state(page)).viewport.pxPerUnit).toBeGreaterThan(fitted.pxPerUnit * 1.2);
  await page.mouse.move(p.x + 1, p.y);
  await page.mouse.move(p.x, p.y);
  // The same world point is still under the cursor (to the readout's 0.001).
  const tol = 1 / (await state(page)).viewport.pxPerUnit;
  const after = [await page.locator('#al-coord-x').textContent(), await page.locator('#al-coord-y').textContent()];
  expect(Math.abs(Number(after[0]) - Number(before[0]))).toBeLessThanOrEqual(tol);
  expect(Math.abs(Number(after[1]) - Number(before[1]))).toBeLessThanOrEqual(tol);

  const v0 = (await state(page)).viewport;
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p.x - 120, p.y + 40, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const v1 = (await state(page)).viewport;
  // Browsers report mouse positions in single precision, so compare to 0.001 px.
  expect(v1.originX - v0.originX).toBeCloseTo(-120, 3);
  expect(v1.originY - v0.originY).toBeCloseTo(40, 3);
  expect((await state(page)).selection).toEqual([]); // panning never selects

  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await state(page)).viewport.originX - v1.originX).toBeCloseTo(60, 3);

  await page.keyboard.press('f');
  const refit = (await state(page)).viewport;
  expect(refit.pxPerUnit).toBeCloseTo(fitted.pxPerUnit, 9);
  expect(refit.originX).toBeCloseTo(fitted.originX, 6);
});

test('hovering highlights the line under the cursor', async ({ page }) => {
  await openExample(page);
  const p = await toPage(page, 50, 60);
  await page.mouse.move(p.x, p.y + 1);
  await expect.poll(async () => (await state(page)).hover).toBe(EX.outline);
  const q = await toPage(page, 30, 40);
  await page.mouse.move(q.x, q.y);
  await expect.poll(async () => (await state(page)).hover).toBeNull();
});

test('command palette: Ctrl+K, type, Enter', async ({ page }) => {
  await openExample(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('grid');
  await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#al-grid-toggle')).toHaveText('Grid off');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('no such command');
  await expect(page.getByText('No command matches')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Save downloads the drawing exactly as it was opened', async ({ page }) => {
  await openExample(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('example-bracket.archilite');
  expect(readFileSync(await file.path(), 'utf8')).toBe(EXAMPLE);
  await expect(page.locator('#al-toast')).toContainText('Saved example-bracket.archilite');
});

test('an edit marks the drawing unsaved; saving clears the mark', async ({ page }) => {
  await openExample(page);
  await expect(page.locator('#al-dirty')).toBeHidden();
  await page.getByRole('button', { name: 'Hide layer Holes' }).click();
  await expect(page.locator('#al-dirty')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await download;
  await expect(page.locator('#al-dirty')).toBeHidden();
});

test('opening a damaged file explains why and keeps the current drawing', async ({ page }) => {
  await openExample(page);
  await page.locator('#al-file').setInputFiles({
    name: 'broken.archilite',
    mimeType: 'application/json',
    buffer: Buffer.from(EXAMPLE.replace('"version": 2', '"version": 3')),
  });
  const toast = page.locator('#al-toast');
  await expect(toast).toContainText('broken.archilite could not be opened.');
  await expect(toast).toContainText('saved by a newer version of ArchiLite');
  await expect(page.locator('#al-title')).toHaveText('Example bracket');
});

test('opening a file from disk shows it fitted', async ({ page }) => {
  await page.goto('./?test');
  await page.locator('#al-file').setInputFiles({ name: 'bracket.archilite', mimeType: 'application/json', buffer: Buffer.from(EXAMPLE) });
  await expect(page.locator('#al-file-name')).toHaveText('bracket.archilite');
  expect((await state(page)).entities).toBe(16);
});

test('panels can be hidden and shown', async ({ page }) => {
  await openExample(page);
  await page.keyboard.press('[');
  await expect(page.locator('#al-layers-panel')).toBeHidden();
  await page.keyboard.press(']');
  await expect(page.locator('#al-selection-panel')).toBeHidden();
  await page.keyboard.press('[');
  await page.keyboard.press(']');
  await expect(page.locator('#al-layers-panel')).toBeVisible();
  await expect(page.locator('#al-selection-panel')).toBeVisible();
});

test('the large test drawing loads from the command palette', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?test');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('large test');
  await page.keyboard.press('Enter');
  await expect(page.locator('#al-count')).toHaveText('20000 entities', { timeout: 30_000 });
  await expect(page.locator('#al-title')).toHaveText('Bracket grid 50 × 25');
});
