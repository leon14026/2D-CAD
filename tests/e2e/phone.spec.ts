/**
 * Phase 11 gate: the same site at 390×844 with touch. Desk tests stay on the desktop project.
 */
import { expect, test, type Page } from '@playwright/test';
import { EX, openExample, state, watchErrors } from './helpers';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
});

async function overlayPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('#al-overlay').boundingBox();
  if (!box) throw new Error('no drawing area');
  return { x: box.x + x, y: box.y + y };
}

/** Two synthetic touch pointers, so the app's pinch handler (not the browser's) runs. */
async function pinch(page: Page, centre: { x: number; y: number }, from: number, to: number): Promise<void> {
  const startA = await overlayPoint(page, centre.x - from / 2, centre.y);
  const startB = await overlayPoint(page, centre.x + from / 2, centre.y);
  const endA = await overlayPoint(page, centre.x - to / 2, centre.y);
  const endB = await overlayPoint(page, centre.x + to / 2, centre.y);
  await page.evaluate(
    async ({ startA, startB, endA, endB }) => {
      const el = document.querySelector('#al-overlay');
      if (!el) throw new Error('no overlay');
      const fire = (type: string, id: number, p: { x: number; y: number }, buttons: number) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: p.x,
            clientY: p.y,
            buttons,
            bubbles: true,
            cancelable: true,
            isPrimary: id === 1,
          }),
        );
      };
      fire('pointerdown', 1, startA, 1);
      fire('pointerdown', 2, startB, 1);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        fire(
          'pointermove',
          1,
          { x: startA.x + (endA.x - startA.x) * t, y: startA.y + (endA.y - startA.y) * t },
          1,
        );
        fire(
          'pointermove',
          2,
          { x: startB.x + (endB.x - startB.x) * t, y: startB.y + (endB.y - startB.y) * t },
          1,
        );
      }
      fire('pointerup', 1, endA, 0);
      fire('pointerup', 2, endB, 0);
    },
    { startA, startB, endA, endB },
  );
}

test('the example opens fitted; pan, pinch, tap, line, layers sheet and save', async ({ page }) => {
  const errors = watchErrors(page);
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol !== 'data:' && url.host !== '127.0.0.1:4173') external.push(req.url());
  });

  await openExample(page);
  await expect(page.locator('body')).toHaveClass(/al-phone/);
  await expect(page.locator('#al-file-actions')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Draw' })).toHaveAttribute('aria-selected', 'true');

  const corner = await page.evaluate(() => {
    const hook = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite;
    const vp = hook.state().viewport;
    const overlay = document.querySelector('#al-overlay');
    const box = overlay?.getBoundingClientRect();
    if (!box) throw new Error('no overlay');
    return {
      x: box.x + vp.originX + 100 * vp.pxPerUnit,
      y: box.y + vp.originY - 60 * vp.pxPerUnit,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    };
  });
  expect(corner.x).toBeGreaterThan(corner.left + 22);
  expect(corner.x).toBeLessThan(corner.right);
  expect(corner.y).toBeGreaterThan(corner.top + 22);
  expect(corner.y).toBeLessThan(corner.bottom);

  const fitted = (await state(page)).viewport;
  const overlay = await page.locator('#al-overlay').boundingBox();
  if (!overlay) throw new Error('no overlay');
  const from = { x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 30, { steps: 8 });
  await page.mouse.up();
  const panned = (await state(page)).viewport;
  expect(panned.originX).toBeCloseTo(fitted.originX + 80, 0);
  expect(panned.originY).toBeCloseTo(fitted.originY + 30, 0);
  expect(panned.pxPerUnit).toBeCloseTo(fitted.pxPerUnit, 6);
  expect((await state(page)).selection).toEqual([]);

  const mid = { x: overlay.width / 2, y: overlay.height / 2 };
  const worldBefore = await page.evaluate(([x, y]) => {
    const vp = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite.state().viewport;
    return { x: (x - vp.originX) / vp.pxPerUnit, y: (vp.originY - y) / vp.pxPerUnit };
  }, [mid.x, mid.y] as const);
  await pinch(page, mid, 80, 160);
  const zoomed = (await state(page)).viewport;
  expect(zoomed.pxPerUnit).toBeGreaterThan(panned.pxPerUnit * 1.5);
  const worldAfter = await page.evaluate(([x, y]) => {
    const vp = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite.state().viewport;
    return { x: (x - vp.originX) / vp.pxPerUnit, y: (vp.originY - y) / vp.pxPerUnit };
  }, [mid.x, mid.y] as const);
  expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(0.2);
  expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(0.2);

  await page.keyboard.press('f');
  const outline = await page.evaluate(() => {
    const vp = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite.state().viewport;
    const box = document.querySelector('#al-overlay')?.getBoundingClientRect();
    if (!box) throw new Error('no overlay');
    return { x: box.x + vp.originX + 50 * vp.pxPerUnit, y: box.y + vp.originY - 0 * vp.pxPerUnit };
  });
  await page.mouse.click(outline.x, outline.y);
  expect((await state(page)).selection).toEqual([EX.outline]);

  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Line', exact: true }).click();
  expect((await state(page)).tool).toBe('line');
  const place = await page.evaluate(() => {
    const vp = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite.state().viewport;
    const box = document.querySelector('#al-overlay')?.getBoundingClientRect();
    if (!box) throw new Error('no overlay');
    return { x: box.x + vp.originX + 20 * vp.pxPerUnit, y: box.y + vp.originY - 70 * vp.pxPerUnit };
  });
  await page.mouse.click(place.x, place.y);
  await expect(page.locator('.al-entry-prompt')).toContainText(/next|end|point/i);
  expect((await state(page)).tool).toBe('line');
  await page.keyboard.press('Escape');

  await page.keyboard.press('[');
  await expect(page.locator('#al-layers-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Hide layer Centre lines' }).click();
  await expect(page.getByRole('button', { name: 'Show layer Centre lines' })).toBeVisible();
  await page.locator('.al-sheet-backdrop').click();
  await expect(page.locator('#al-layers-panel')).toBeHidden();

  const expected = await page.evaluate(() => (window as unknown as { __archilite: { saveText: () => string } }).__archilite.saveText());
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(download.suggestedFilename()).toMatch(/\.archilite$/);
  const body = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    if (!stream) throw new Error('no stream');
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  });
  expect(body).toBe(expected);
  await expect(page.locator('#al-toast')).toContainText('Saved');

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('select with a box is a command, not a drag', async ({ page }) => {
  await openExample(page);
  const overlay = await page.locator('#al-overlay').boundingBox();
  if (!overlay) throw new Error('no overlay');
  await page.mouse.move(overlay.x + 40, overlay.y + 80);
  await page.mouse.down();
  await page.mouse.move(overlay.x + 200, overlay.y + 200, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).selection).toEqual([]);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('Select with a box');
  await page.keyboard.press('Enter');
  const hole = await page.evaluate(() => {
    const vp = (window as unknown as { __archilite: { state: () => { viewport: { originX: number; originY: number; pxPerUnit: number } } } })
      .__archilite.state().viewport;
    const box = document.querySelector('#al-overlay')?.getBoundingClientRect();
    if (!box) throw new Error('no overlay');
    const at = (x: number, y: number) => ({ x: box.x + vp.originX + x * vp.pxPerUnit, y: box.y + vp.originY - y * vp.pxPerUnit });
    return { a: at(3, 17), b: at(17, 3) };
  });
  await page.mouse.move(hole.a.x, hole.a.y);
  await page.mouse.down();
  await page.mouse.move(hole.b.x, hole.b.y, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).selection).toEqual([EX.holes[0], ...EX.hole1Lines]);
});
