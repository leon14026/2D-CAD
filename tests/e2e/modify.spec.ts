/**
 * Phase 5: modify tools in the real app with the GPU off.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { entitiesInDrawOrder, loadDocument } from '../../src/core/doc';
import type { Shape } from '../../src/core/geom';
import { drawModifyReference, state, toPage, watchErrors } from './helpers';

const saveText = (page: Page) => page.evaluate(() => (window as unknown as { __archilite: { saveText(): string } }).__archilite.saveText());

async function shapes(page: Page): Promise<Shape[]> {
  return entitiesInDrawOrder(loadDocument(await saveText(page))).map((e) => e.geom);
}

async function newDrawing(page: Page): Promise<void> {
  await page.goto('./?test');
  await expect(page.locator('#al-count')).toHaveText('0 entities');
}

async function typeIn(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await toPage(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test('the reference drawing made with every modify tool matches the approved drawing exactly', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawModifyReference(page);
  const made = JSON.parse(await saveText(page));
  const approved = JSON.parse(readFileSync('tests/fixtures/modify-reference.archilite', 'utf8'));
  made.title = approved.title; // the engine test names its drawing
  expect(made).toEqual(approved);
  expect(errors).toEqual([]);
});

test('trim by clicking the part to cut away; Enter stops', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('l');
  await typeIn(page, '0,0');
  await typeIn(page, '@40,0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await typeIn(page, '20,-10');
  await typeIn(page, '@0,20');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('t');
  await expect(page.locator('.al-entry-prompt')).toHaveText('Pick the part to cut away');
  await clickAt(page, 30, 0);
  await page.keyboard.press('Enter');
  expect(await shapes(page)).toEqual([
    { kind: 'segment', start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
    { kind: 'segment', start: { x: 20, y: -10 }, end: { x: 20, y: 10 } },
  ]);
  expect((await state(page)).tool).toBeNull();
});

test('a pick on empty space, or on something that can’t be trimmed, is explained', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('c');
  await typeIn(page, '0,0');
  await typeIn(page, '10');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('t');
  await clickAt(page, 0, 0);
  await expect(page.locator('.al-entry-error')).toHaveText(/Nothing there to pick/);
  await clickAt(page, 10, 0);
  await expect(page.locator('.al-entry-error')).toHaveText(/Nothing crosses this object there/);
  expect((await state(page)).undo).toBe(1);
});

test('the selection panel moves, deletes and joins; Delete and Ctrl+Z work', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('l');
  await typeIn(page, '0,0');
  await typeIn(page, '@10,0');
  await typeIn(page, '@0,10');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await clickAt(page, 5, 0);
  const panel = page.getByRole('group', { name: 'Change the selection' });
  await expect(panel.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Move', exact: true }).click();
  await typeIn(page, '0,0');
  await typeIn(page, '@0,-5');
  expect((await shapes(page))[0]).toEqual({ kind: 'segment', start: { x: 0, y: -5 }, end: { x: 10, y: -5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await panel.getByRole('button', { name: 'Join', exact: true }).click();
  expect(await shapes(page)).toEqual([
    { kind: 'polyline', vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }], closed: false },
  ]);
  await page.keyboard.press('Delete');
  expect((await state(page)).entities).toBe(0);
  await expect(page.locator('#al-toast')).toContainText('Ctrl+Z brings it back');
  await page.keyboard.press('Control+z');
  expect((await state(page)).entities).toBe(1);
});

test('a selection tool started with nothing selected asks for a selection, then Enter goes on', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('c');
  await typeIn(page, '0,0');
  await typeIn(page, '5');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.al-entry-prompt')).toHaveText('Select the objects, then press Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.al-entry-error')).toHaveText(/Select at least one object/);
  await clickAt(page, 5, 0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.al-entry-prompt')).toHaveText('Base point');
  await typeIn(page, '0,0');
  await typeIn(page, '@20,0');
  await typeIn(page, '@40,0');
  await page.keyboard.press('Enter');
  expect(await shapes(page)).toEqual([
    { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 },
    { kind: 'circle', center: { x: 20, y: 0 }, radius: 5 },
    { kind: 'circle', center: { x: 40, y: 0 }, radius: 5 },
  ]);
});
