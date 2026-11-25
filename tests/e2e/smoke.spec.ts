import { expect, test, type Page } from '@playwright/test';
import { APP_NAME } from '../../src/app/brand';
import { hexToRgb, palette, type PaletteKey } from '../../src/ui/palette';

/** Collects console errors and uncaught exceptions for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Counts canvas pixels that exactly match each palette colour. */
async function countPaletteColours(page: Page): Promise<Record<PaletteKey, number> & { total: number }> {
  const targets = Object.fromEntries(
    Object.entries(palette).map(([key, hex]) => [key, hexToRgb(hex)]),
  ) as Record<PaletteKey, [number, number, number]>;
  return page.evaluate((colours) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#al-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('canvas missing');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const counts: Record<string, number> = { total: canvas.width * canvas.height };
    for (const key of Object.keys(colours)) counts[key] = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (const [key, [r, g, b]] of Object.entries(colours)) {
        if (data[i] === r && data[i + 1] === g && data[i + 2] === b) {
          counts[key] = (counts[key] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, targets) as Promise<Record<PaletteKey, number> & { total: number }>;
}

test('loads with its own name and no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page).toHaveTitle(APP_NAME);
  await expect(page.locator('#al-name')).toHaveText(APP_NAME);
  await expect(page.locator('#al-build')).toHaveText(/^v\d+\.\d+\.\d+ · \S+$/);
  expect(errors).toEqual([]);
});

test('test browser really has no GPU path (WebGL unavailable)', async ({ page }) => {
  // Guards the test itself: if this fails, the "no GPU" claim of the other tests is void.
  await page.goto('./');
  const gpu = await page.evaluate(() => {
    const probe = document.createElement('canvas');
    return {
      webgl: probe.getContext('webgl') !== null,
      webgl2: probe.getContext('webgl2') !== null,
    };
  });
  expect(gpu).toEqual({ webgl: false, webgl2: false });
});

test('draws paper, grid and both axes with Canvas 2D and no GPU', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('#al-canvas');
    return Boolean(c && c.dataset['originX']);
  });
  const counts = await countPaletteColours(page);
  expect(counts.paper / counts.total).toBeGreaterThan(0.5);
  expect(counts.gridMinor).toBeGreaterThan(1000);
  expect(counts.gridMajor).toBeGreaterThan(100);
  expect(counts.axisX).toBeGreaterThan(100);
  expect(counts.axisY).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('cursor readout reports world coordinates in mm, y up', async ({ page }) => {
  await page.goto('./');
  const canvas = page.locator('#al-canvas');
  await expect(canvas).toHaveAttribute('data-origin-x', /\d+/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  const ox = Number(await canvas.getAttribute('data-origin-x'));
  const oy = Number(await canvas.getAttribute('data-origin-y'));
  const scale = Number(await canvas.getAttribute('data-px-per-unit'));

  await page.mouse.move(box.x + ox, box.y + oy);
  await expect(page.locator('#al-coord-x')).toHaveText('0.000');
  await expect(page.locator('#al-coord-y')).toHaveText('0.000');

  // 10 mm right and 5 mm up.
  await page.mouse.move(box.x + ox + 10 * scale, box.y + oy - 5 * scale);
  await expect(page.locator('#al-coord-x')).toHaveText('10.000');
  await expect(page.locator('#al-coord-y')).toHaveText('5.000');

  // 25 mm left and 12.5 mm down.
  await page.mouse.move(box.x + ox - 25 * scale, box.y + oy + 12.5 * scale);
  await expect(page.locator('#al-coord-x')).toHaveText('-25.000');
  await expect(page.locator('#al-coord-y')).toHaveText('-12.500');
});

test('redraws correctly after the window is resized', async ({ page }) => {
  await page.goto('./');
  await page.setViewportSize({ width: 700, height: 500 });
  await expect
    .poll(async () => Number(await page.locator('#al-canvas').getAttribute('data-origin-x')))
    .toBe(350);
  const counts = await countPaletteColours(page);
  expect(counts.axisX).toBeGreaterThan(100);
  expect(counts.axisY).toBeGreaterThan(100);
});

test('uses relative asset URLs so it works under /<repo>/ on GitHub Pages', async ({ request }) => {
  const html = await (await request.get('./')).text();
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
  const assets = refs.filter((r) => !r.startsWith('data:') && !r.startsWith('http'));
  expect(assets.length).toBeGreaterThan(0);
  for (const ref of assets) expect(ref.startsWith('./')).toBe(true);
});

test('makes no network requests outside its own origin', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol !== 'data:' && url.host !== '127.0.0.1:4173') external.push(req.url());
  });
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
});
