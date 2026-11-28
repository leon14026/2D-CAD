/**
 * Phase 13: driving dimensions and constraint marks in the real app with the GPU off.
 */
import { expect, test, type Page } from '@playwright/test';
import { loadDocument, maxResidual, notesInDrawOrder, resolveNotes, type Doc, type Note } from '../../src/core/doc';
import { clickWorld, drawReference, state, toPage, watchErrors } from './helpers';

type Hook = {
  saveText(): string;
  toggleConstraints(): void;
  state(): { showConstraints: boolean; constraints: number; undo: number };
};

async function drawingClip(page: Page) {
  const b = await page.locator('#al-stage').boundingBox();
  if (!b) throw new Error('no stage');
  return { x: b.x + 24, y: b.y + 24, width: b.width - 24, height: b.height - 24 };
}

const saveText = (page: Page) => page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.saveText());
const docOf = async (page: Page): Promise<Doc> => loadDocument(await saveText(page));

async function newDrawing(page: Page): Promise<void> {
  await page.goto('./?test');
  await expect(page.locator('#al-count')).toHaveText('0 entities');
}

test('place a dimension, type a new number, undo restores it in one step', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'line' },
    { type: '0,0' },
    { type: '100,0' },
    { enter: true },
    { tool: 'dimAligned' },
    { type: '0,0' },
    { type: '100,0' },
    { type: '50,-12' },
    { enter: true },
  ]);
  let doc = await docOf(page);
  expect(doc.constraints.size).toBe(1);
  const [dim] = notesInDrawOrder(doc) as [Note];
  const shown = resolveNotes(doc).get(dim.id);
  expect(shown?.ok && shown.r.text).toBe('100.00');

  await clickWorld(page, 50, -12);
  await expect(page.locator('#al-entry')).toBeHidden();
  // ISO text sits 1 mm above the dimension line, 3.5 mm high; click the number, not the line.
  await clickWorld(page, 50, -12 + 1 + 1.75);
  await expect(page.locator('.al-entry-prompt')).toContainText('New value');
  await page.keyboard.type('120');
  await page.keyboard.press('Enter');
  doc = await docOf(page);
  const after = notesInDrawOrder(doc)[0] as Note;
  const text = resolveNotes(doc).get(after.id);
  expect(text?.ok && text.r.text).toBe('120.00');
  const line = [...doc.entities.values()].find((e) => e.geom.kind === 'segment');
  expect(line?.geom.kind).toBe('segment');
  if (line?.geom.kind === 'segment') {
    expect(Math.hypot(line.geom.end.x - line.geom.start.x, line.geom.end.y - line.geom.start.y)).toBeCloseTo(120, 9);
  }
  const undoBefore = (await state(page)).undo;
  await page.keyboard.press('Control+z');
  expect((await state(page)).undo).toBe(undoBefore - 1);
  doc = await docOf(page);
  const restored = notesInDrawOrder(doc)[0] as Note;
  const restoredText = resolveNotes(doc).get(restored.id);
  expect(restoredText?.ok && restoredText.r.text).toBe('100.00');
  expect(errors).toEqual([]);
});

test('constraint marks show and hide, and picking one in the panel highlights what it holds', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'line' },
    { type: '0,0' },
    { type: '40,0' },
    { enter: true },
    { tool: 'horizontal' },
    { type: '0,0' },
    { type: '40,0' },
  ]);
  expect((await state(page)).constraints).toBe(1);
  await page.keyboard.press('Shift+KeyC');
  expect(await page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.state().showConstraints)).toBe(true);
  await clickWorld(page, 20, 0);
  await expect(page.locator('#al-selection-panel')).toContainText('Horizontal');
  await page.locator('#al-selection-panel').locator('[data-constraint]').first().click();
  await expect(page.locator('#al-selection-panel')).toContainText('Horizontal');
  await page.keyboard.press('Shift+KeyC');
  expect(await page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.state().showConstraints)).toBe(false);
  expect(errors).toEqual([]);
});

test('a screenshot of constraint marks', async ({ page }) => {
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'line' },
    { type: '0,0' },
    { type: '40,0' },
    { enter: true },
    { tool: 'line' },
    { type: '40,0' },
    { type: '40,25' },
    { enter: true },
    { tool: 'horizontal' },
    { type: '0,0' },
    { type: '40,0' },
    { tool: 'vertical' },
    { type: '40,0' },
    { type: '40,25' },
  ]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.toggleConstraints());
  await page.mouse.move(5, 700);
  await expect(page).toHaveScreenshot('constraint-marks.png', { clip: await drawingClip(page) });
});

test('a reference dimension reads in brackets and does not hold the drawing', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'line' },
    { type: '0,0' },
    { type: '80,0' },
    { enter: true },
    { tool: 'dimAligned' },
    { option: 'r' },
    { type: '0,0' },
    { type: '80,0' },
    { type: '40,-10' },
    { enter: true },
  ]);
  const doc = await docOf(page);
  expect(doc.constraints.size).toBe(0);
  const [dim] = notesInDrawOrder(doc) as [Note];
  expect(dim.reference).toBe(true);
  const shown = resolveNotes(doc).get(dim.id);
  expect(shown?.ok && shown.r.text).toBe('(80.00)');
  expect(maxResidual(doc)).toBe(0);
  expect(errors).toEqual([]);
});
