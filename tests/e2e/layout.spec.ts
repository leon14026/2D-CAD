/**
 * Phase 9: blocks, sheets and constraints in the real app with the GPU off.
 */
import { expect, test, type Page } from '@playwright/test';
import { loadDocument, maxResidual, saveDocument, type Doc } from '../../src/core/doc';
import { buildConstrainedPlate } from '../unit/core/doc/constrained-plate';
import { drawReference, lastDrawn, openText, state, watchErrors } from './helpers';

type Hook = { saveText(): string };

const saveText = (page: Page) => page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.saveText());
const docOf = async (page: Page): Promise<Doc> => loadDocument(await saveText(page));

async function newDrawing(page: Page): Promise<void> {
  await page.goto('./?test');
  await expect(page.locator('#al-count')).toHaveText('0 entities');
}

async function runPalette(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type(label);
  await expect(dialog.getByRole('option', { name: label, exact: true })).toBeVisible();
  await dialog.getByRole('option', { name: label, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
}

test('the constrained plate opens, switches sheets and keeps its constraints after an edit', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?test');
  const plate = saveDocument(buildConstrainedPlate().doc);
  expect(await openText(page, plate)).toBe(true);
  await expect(page.locator('#al-title')).toHaveText('Constrained plate');
  await expect(page.locator('#al-sheet')).toHaveText('Sheet 1');
  expect((await state(page)).inserts).toBe(5);
  expect((await state(page)).constraints).toBeGreaterThan(0);
  expect(maxResidual(await docOf(page))).toBeLessThan(1e-6);
  const onSheet1 = await lastDrawn(page);

  await page.locator('#al-sheet').click();
  await expect(page.locator('#al-sheet')).toHaveText('Layout');
  expect((await state(page)).sheet).toBe('Layout');
  const onLayout = await lastDrawn(page);
  expect(onLayout).toBeGreaterThan(0);
  expect(onLayout).toBeLessThan(onSheet1);

  await page.locator('#al-sheet').click();
  await expect(page.locator('#al-sheet')).toHaveText('Sheet 1');

  await drawReference(page, [{ select: [[72, 12]] }, { tool: 'move' }, { type: '68,12' }, { type: '60,12' }]);
  const after = await docOf(page);
  expect(maxResidual(after)).toBeLessThan(1e-6);
  expect([...after.inserts.values()].some((ins) => ins.at.x === 60 && ins.at.y === 12)).toBe(true);
  expect(errors).toEqual([]);
});

test('a horizontal constraint restores after the line is moved', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'line' },
    { type: '0,0' },
    { type: '40,8' },
    { enter: true },
    { tool: 'fix' },
    { type: '0,0' },
    { tool: 'horizontal' },
    { type: '0,0' },
    { type: '40,8' },
  ]);
  let doc = await docOf(page);
  expect(doc.constraints.size).toBe(2);
  expect(maxResidual(doc)).toBeLessThan(1e-4);
  const line = [...doc.entities.values()].find((e) => e.geom.kind === 'segment');
  expect(line?.geom.kind).toBe('segment');
  if (line?.geom.kind === 'segment') {
    expect(Math.abs(line.geom.start.y - line.geom.end.y)).toBeLessThan(1e-4);
    expect(Math.abs(line.geom.start.x)).toBeLessThan(1e-4);
    expect(Math.abs(line.geom.start.y)).toBeLessThan(1e-4);
  }

  await drawReference(page, [{ select: [[20, 0]] }, { tool: 'move' }, { type: '40,0' }, { type: '40,15' }]);
  doc = await docOf(page);
  expect(maxResidual(doc)).toBeLessThan(1e-4);
  const moved = [...doc.entities.values()].find((e) => e.geom.kind === 'segment');
  if (moved?.geom.kind === 'segment') {
    expect(Math.abs(moved.geom.start.y - moved.geom.end.y)).toBeLessThan(1e-4);
    expect(Math.abs(moved.geom.start.y)).toBeLessThan(1e-4);
  }
  expect(errors).toEqual([]);
});

test('a block insert is drawn, copied onto a second sheet, and exploded', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [
    { tool: 'circle' },
    { type: '10,10' },
    { type: '4' },
    { enter: true },
    { select: [[14, 10]] },
    { tool: 'block' },
    { type: 'hole' },
    { type: '10,10' },
    { tool: 'insert' },
    { type: '40,10' },
  ]);
  expect((await state(page)).entities).toBe(0);
  expect((await state(page)).inserts).toBe(2);
  await expect(page.locator('#al-count')).toHaveText('0 entities, 2 inserts');

  await runPalette(page, 'Add a sheet');
  await expect(page.locator('#al-sheet')).toHaveText('Sheet 2');
  await drawReference(page, [{ tool: 'insert' }, { type: '20,20' }]);
  expect((await state(page)).inserts).toBe(3);
  expect((await state(page)).sheet).toBe('Sheet 2');
  expect(await lastDrawn(page)).toBe(1);

  await page.locator('#al-sheet').click();
  await expect(page.locator('#al-sheet')).toHaveText('Sheet 1');
  await drawReference(page, [{ select: [[14, 10]] }, { action: 'explode' }]);
  expect((await state(page)).entities).toBe(1);
  expect((await state(page)).inserts).toBe(2);
  expect(errors).toEqual([]);
});
