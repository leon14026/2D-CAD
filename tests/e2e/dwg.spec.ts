import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openExample, watchErrors } from './helpers';

const AC1015 = readFileSync('tests/fixtures/dwg/shapes-ac1015.dwg');
const CADKIT_BUDGET = 3 * 1024 * 1024;

test('opening the app does not fetch the DWG decoder', async ({ page }) => {
  const errors = watchErrors(page);
  const cadkit: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/cadkit/')) cadkit.push(req.url());
  });
  await page.goto('./?test');
  await page.waitForLoadState('networkidle');
  expect(cadkit).toEqual([]);
  expect(errors).toEqual([]);
});

test('opening the example does not fetch the DWG decoder', async ({ page }) => {
  const errors = watchErrors(page);
  const cadkit: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/cadkit/')) cadkit.push(req.url());
  });
  await openExample(page);
  expect(cadkit).toEqual([]);
  expect(errors).toEqual([]);
});

test('opening a DWG fetches the decoder within 3 MB gzipped and matches the fixture', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const bodies: Buffer[] = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/cadkit/')) return;
    bodies.push(Buffer.from(await res.body()));
  });
  await page.goto('./?test');
  const opened = await page.evaluate(async ({ bytes, name }) => {
    const api = window as unknown as {
      __archilite: { openFile: (b: number[], n: string) => Promise<boolean>; saveText: () => string };
    };
    const ok = await api.__archilite.openFile(bytes, name);
    return { ok, text: api.__archilite.saveText() };
  }, { bytes: [...AC1015], name: 'shapes-ac1015.dwg' });
  expect(opened.ok).toBe(true);
  const gzipped = bodies.reduce((n, b) => n + gzipSync(b, { level: 9 }).length, 0);
  expect(bodies.length, 'opening a DWG should fetch cadkit').toBeGreaterThan(0);
  expect(gzipped).toBeLessThanOrEqual(CADKIT_BUDGET);
  const doc = JSON.parse(opened.text) as {
    units: string;
    entities: Array<{ geom: { kind: string; start?: { x: number; y: number }; end?: { x: number; y: number }; center?: { x: number; y: number }; radius?: number; vertices?: Array<{ x: number; y: number; bulge: number }>; closed?: boolean } }>;
  };
  expect(doc.units).toBe('mm');
  expect(doc.entities).toHaveLength(4);
  const line = doc.entities.find((e) => e.geom.kind === 'segment')?.geom;
  expect(line?.start).toEqual({ x: 0, y: 0 });
  expect(line?.end).toEqual({ x: 100, y: 0 });
  await expect(page.locator('#al-toast')).toContainText('Opened shapes-ac1015.dwg');
  expect(errors).toEqual([]);
});

test('an out-of-range DWG version is refused in plain words', async ({ page }) => {
  const errors = watchErrors(page);
  const cadkit: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/cadkit/')) cadkit.push(req.url());
  });
  await page.goto('./?test');
  const bytes = Array.from('AC1009').map((c) => c.charCodeAt(0));
  const ok = await page.evaluate(async ({ data, name }) => {
    const api = window as unknown as { __archilite: { openFile: (b: number[], n: string) => Promise<boolean> } };
    return api.__archilite.openFile(data, name);
  }, { data: bytes, name: 'old.dwg' });
  expect(ok).toBe(false);
  await expect(page.locator('#al-toast')).toContainText('old.dwg could not be opened.');
  await expect(page.locator('#al-toast')).toContainText('AC1009');
  expect(cadkit).toEqual([]);
  expect(errors).toEqual([]);
});
