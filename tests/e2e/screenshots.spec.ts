/**
 * Screenshot comparisons against approved images in screenshots.spec.ts-snapshots/.
 * The images are made with the same pinned Chromium build CI uses (Playwright 1.63.0).
 * After an intended visual change, refresh them with:
 *   npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots
 */
import { expect, test, type Page } from '@playwright/test';
import { bigDrawingText } from '../fixtures/big-drawing';
import { dragWorld, drawModifyReference, openExample, openText, toPage } from './helpers';

/** The drawing area without the rulers, which carry text. */
async function drawingClip(page: Page) {
  const b = await page.locator('#al-stage').boundingBox();
  if (!b) throw new Error('no stage');
  return { x: b.x + 22, y: b.y + 22, width: b.width - 22, height: b.height - 22 };
}

async function parkMouse(page: Page) {
  await page.mouse.move(5, 700); // over the status bar: no hover highlight
}

test('the example bracket, fitted', async ({ page }) => {
  await openExample(page);
  await parkMouse(page);
  await expect(page).toHaveScreenshot('example-fit.png', { clip: await drawingClip(page) });
});

test('a window selection highlights its entities', async ({ page }) => {
  await openExample(page);
  await dragWorld(page, [3, 17], [17, 3]);
  await parkMouse(page);
  await expect(page).toHaveScreenshot('example-window-selected.png', { clip: await drawingClip(page) });
});

test('the crossing box while dragging', async ({ page }) => {
  await openExample(page);
  await dragWorld(page, [58, 36], [42, 24], false);
  await expect(page).toHaveScreenshot('example-crossing-box.png', { clip: await drawingClip(page) });
  await page.mouse.up();
});

test('a hidden layer is not drawn', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Hide layer Centre lines' }).click();
  await parkMouse(page);
  await expect(page).toHaveScreenshot('example-centre-lines-hidden.png', { clip: await drawingClip(page) });
});

test('close up: a hole and its dash-dot centre lines', async ({ page }) => {
  await openExample(page);
  const p = await toPage(page, 7, 7);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -600);
  await page.mouse.wheel(0, -600);
  await parkMouse(page);
  await expect(page).toHaveScreenshot('example-close-up.png', { clip: await drawingClip(page) });
});

test('20,000 entities, fitted', async ({ page }) => {
  await page.goto('./?test');
  await openText(page, bigDrawingText());
  await parkMouse(page);
  await expect(page).toHaveScreenshot('bracket-grid-20k.png', { clip: await drawingClip(page) });
});

test('drawing a line: the preview, a snap marker and the box beside the cursor', async ({ page }) => {
  await openExample(page);
  await page.keyboard.press('l');
  await page.keyboard.type('30,64');
  await page.keyboard.press('Enter');
  // Near where the upper-right hole meets its horizontal centre line.
  const p = await toPage(page, 86.3, 49.6);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.al-entry-readout')).toBeVisible();
  await expect(page).toHaveScreenshot('drafting-line-snap.png', { clip: await drawingClip(page) });
});

test('the Phase 5 reference drawing, made with every modify tool', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?test');
  await drawModifyReference(page);
  await parkMouse(page);
  await expect(page).toHaveScreenshot('modify-reference.png', { clip: await drawingClip(page) });
});

test('the whole window: panels, rulers and status bar', async ({ page }) => {
  await openExample(page);
  await dragWorld(page, [58, 36], [42, 24]);
  const p = await toPage(page, 90, 50);
  await page.mouse.move(p.x, p.y);
  // The build label carries the commit id, which differs on every machine and shifts the
  // status bar. smoke.spec.ts checks its real format; here it gets a fixed text.
  await page.locator('#al-build').evaluate((label) => {
    label.textContent = 'v0.0.0 [build]';
  });
  await expect(page).toHaveScreenshot('app-window.png');
});
