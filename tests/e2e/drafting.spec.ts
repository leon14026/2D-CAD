/**
 * Phase 4: drawing with snaps, tracking and typed input, in the real app with the GPU off.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOOL_BUTTONS } from '../../src/app/tools';
import { entitiesInDrawOrder, loadDocument } from '../../src/core/doc';
import type { Segment, Shape } from '../../src/core/geom';
import { REFERENCE_SHAPES, REFERENCE_STEPS, shapeDifference } from '../fixtures/reference-part';
import { openExample, state, toPage, watchErrors } from './helpers';

/** The rail button for a tool, by its name. */
const railName = (id: string) => (TOOL_BUTTONS.find((b) => b.id === id) as { label: string }).label;

async function shapes(page: Page): Promise<Shape[]> {
  const text = await page.evaluate(() => (window as unknown as { __archilite: { saveText(): string } }).__archilite.saveText());
  return entitiesInDrawOrder(loadDocument(text)).map((e) => e.geom);
}

async function newDrawing(page: Page): Promise<void> {
  await page.goto('./?test');
  await expect(page.locator('#al-count')).toHaveText('0 entities');
}

async function typeIn(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function hover(page: Page, x: number, y: number): Promise<void> {
  const p = await toPage(page, x, y);
  await page.mouse.move(p.x, p.y);
}

async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await toPage(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test('the reference part drawn by typed input alone matches its specification to 1e-9', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  for (const step of REFERENCE_STEPS) {
    if ('tool' in step) await page.getByRole('button', { name: railName(step.tool), exact: true }).click();
    else if ('type' in step) await typeIn(page, step.type);
    else if ('option' in step) await page.keyboard.press(step.option);
    else await page.keyboard.press('Enter');
  }
  await expect(page.locator('#al-count')).toHaveText(`${REFERENCE_SHAPES.length} entities`);
  const drawn = await shapes(page);
  drawn.forEach((s, i) => expect(shapeDifference(s, REFERENCE_SHAPES[i]!), `entity ${i + 1}`).toBeLessThanOrEqual(1e-9));
  expect((await state(page)).undo).toBe(REFERENCE_SHAPES.length);
  expect(errors).toEqual([]);
});

test('clicks snap to exact points: an intersection, an endpoint and a tangent', async ({ page }) => {
  const errors = watchErrors(page);
  await openExample(page);
  await page.keyboard.press('l');
  // The centre lines of the lower-left hole cross at (10, 10).
  await hover(page, 10.4, 10.3);
  await expect(page.locator('#al-entry')).toBeVisible();
  await clickAt(page, 10.4, 10.3);
  // The outline's straight bottom edge ends at (95, 0), where the corner arc begins.
  await clickAt(page, 94.6, 0.4);
  await page.keyboard.press('Enter');
  // From (30, 50), the tangent to the hole about (10, 50) of radius 4 touches at
  // (10 + 4 × 0.2, 50 + 4 × √0.96): cos = r / d = 4 / 20.
  await page.keyboard.press('l');
  await typeIn(page, '30,50');
  const tangent = { x: 10.8, y: 50 + 4 * Math.sqrt(0.96) };
  await clickAt(page, tangent.x + 0.03, tangent.y - 0.05);
  await page.keyboard.press('Escape');

  const added = (await shapes(page)).slice(16) as Segment[];
  expect(added).toEqual([
    { kind: 'segment', start: { x: 10, y: 10 }, end: { x: 95, y: 0 } },
    expect.objectContaining({ kind: 'segment', start: { x: 30, y: 50 } }),
  ]);
  expect(Math.hypot(added[1]!.end.x - tangent.x, added[1]!.end.y - tangent.y)).toBeLessThanOrEqual(1e-9);
  expect(errors).toEqual([]);
});

test('ortho keeps lines horizontal or vertical, by toggle or by holding Shift', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('Shift+O');
  await expect(page.locator('#al-ortho-toggle')).toHaveText('Ortho on');
  await page.keyboard.press('l');
  await typeIn(page, '0,0');
  await clickAt(page, 30, 7);
  await page.keyboard.press('Shift+O');
  await expect(page.locator('#al-ortho-toggle')).toHaveText('Ortho off');
  await hover(page, 33, 25);
  await page.keyboard.down('Shift');
  await hover(page, 32, 25);
  const p = await toPage(page, 32, 25);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  expect(await shapes(page)).toEqual([
    { kind: 'segment', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    { kind: 'segment', start: { x: 30, y: 0 }, end: { x: 30, y: 25 } },
  ]);
});

test('a single typed distance goes along the tracking line', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('Shift+S'); // snaps off, so only tracking acts
  await page.keyboard.press('l');
  await typeIn(page, '5,5');
  await hover(page, 40, 5.2); // near the 0° tracking line
  await expect(page.locator('.al-entry-readout')).toContainText('at 0.0°');
  await typeIn(page, '12.5');
  await page.keyboard.press('Escape');
  expect(await shapes(page)).toEqual([{ kind: 'segment', start: { x: 5, y: 5 }, end: { x: 17.5, y: 5 } }]);
});

test('tools start from the rail, the keyboard and the palette; Esc stops them', async ({ page }) => {
  await newDrawing(page);
  const circle = page.getByRole('button', { name: 'Circle', exact: true });
  await circle.click();
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.al-entry-prompt')).toHaveText('Centre');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).tool).toBeNull();
  await expect(page.locator('#al-entry')).toBeHidden();

  await page.keyboard.press('r');
  expect((await state(page)).tool).toBe('rectangle');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('draw a regular polygon');
  await page.keyboard.press('Enter');
  expect((await state(page)).tool).toBe('polygon');
  await expect(page.locator('.al-entry-prompt')).toHaveText('Number of sides');
  await expect(page.locator('.al-entry-keys')).toContainText('Use 6');
});

test('a right-click finishes a polyline; U and C work as shown', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('p');
  await typeIn(page, '0,0');
  await typeIn(page, '@10,0');
  await typeIn(page, '@0,10');
  await typeIn(page, '@5,5');
  await expect(page.locator('.al-entry-keys')).toContainText('Undo the last point');
  await page.keyboard.press('u');
  const p = await toPage(page, 50, 50);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  expect(await shapes(page)).toEqual([
    {
      kind: 'polyline',
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10, bulge: 0 },
      ],
      closed: false,
    },
  ]);
  expect((await state(page)).tool).toBeNull();
});

test('mistakes are explained beside the cursor and change nothing', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('l');
  await typeIn(page, '@5,5');
  await expect(page.locator('.al-entry-error')).toHaveText(/no last point yet/);
  await page.keyboard.press('Escape'); // clears the typed text
  await typeIn(page, '10,20,30');
  await expect(page.locator('.al-entry-error')).toHaveText(/isn't a point or a number/);
  await page.keyboard.press('Escape');
  await typeIn(page, '1,1');
  await expect(page.locator('.al-entry-error')).toBeHidden();
  await typeIn(page, '1,1');
  await expect(page.locator('.al-entry-error')).toHaveText('That is the same point as the last one.');
  expect((await state(page)).entities).toBe(0);
});

test('drawing on a locked layer is refused with the reason', async ({ page }) => {
  await newDrawing(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('lock layer default');
  await page.keyboard.press('Enter');
  await page.keyboard.press('c');
  await typeIn(page, '0,0');
  await typeIn(page, '5');
  await expect(page.locator('.al-entry-error')).toHaveText(/Layer "Default" is locked/);
  expect((await state(page)).entities).toBe(0);
});

test('snaps, ortho and tracking can be switched from the status bar', async ({ page }) => {
  await newDrawing(page);
  const snaps = page.locator('#al-snap-toggle');
  const polar = page.locator('#al-polar-toggle');
  await expect(snaps).toHaveText('Snaps on');
  await snaps.click();
  await expect(snaps).toHaveText('Snaps off');
  await expect(polar).toHaveText('Tracking 15°');
  await polar.click();
  await expect(polar).toHaveText('Tracking off');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('track angles every 45');
  await page.keyboard.press('Enter');
  await expect(polar).toHaveText('Tracking 45°');
});
