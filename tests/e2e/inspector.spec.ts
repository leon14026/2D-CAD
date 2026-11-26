import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { APP_NAME } from '../../src/app/brand';

const EXAMPLE = readFileSync('public/examples/bracket.archilite', 'utf8');

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function check(page: Page, text: string) {
  await page.locator('#al-text').fill(text);
  await page.getByRole('button', { name: 'Check' }).click();
}

test('the main page links to the inspector', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'File inspector' }).click();
  await expect(page).toHaveTitle(`${APP_NAME} · File inspector`);
});

test('the example loads and shows its layers, counts, sizes and areas', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./inspect.html');
  await page.getByRole('button', { name: 'Load example' }).click();
  const result = page.locator('#al-result');
  await expect(result).toContainText('Valid ArchiLite drawing');
  await expect(result).toContainText('Example bracket');
  await expect(result).toContainText('100.000 × 60.000 mm');
  await expect(result).toContainText('(0.000, 0.000) to (100.000, 60.000)');
  await expect(result).not.toContainText('-0.000');
  // Outline: 100 × 60 minus four corners of (1 − π/4) × 5² = 5978.540 mm².
  await expect(result).toContainText('5978.540');
  // Slot: 20 × 10 + π × 5² = 278.540 mm². Holes: Ø 8, area 50.265 mm².
  await expect(result).toContainText('278.540');
  await expect(result.getByText('Ø 8.000')).toHaveCount(4);
  const layerRows = result.locator('table').first().locator('tbody tr');
  await expect(layerRows).toHaveCount(3);
  await expect(layerRows.nth(1)).toContainText('Holes');
  await expect(result.locator('table').nth(1).locator('tbody tr')).toHaveCount(16);
  expect(errors).toEqual([]);
});

test('a file from a newer version is refused with a clear message', async ({ page }) => {
  await page.goto('./inspect.html');
  await check(page, EXAMPLE.replace('"version": 1', '"version": 2'));
  const result = page.locator('#al-result');
  await expect(result).toContainText('This file cannot be opened');
  await expect(result).toContainText('saved by a newer version of ArchiLite (file format 2)');
  await expect(result).toContainText('Location: version');
});

test('a broken field is refused with its location', async ({ page }) => {
  await page.goto('./inspect.html');
  await check(page, EXAMPLE.replace('"radius":4', '"radius":-4'));
  const result = page.locator('#al-result');
  await expect(result).toContainText('radius must be a positive finite number, got -4');
  await expect(result).toContainText('Location: entities[1].geom.radius');
});

test('text that is not JSON is refused', async ({ page }) => {
  await page.goto('./inspect.html');
  await check(page, 'this is not a drawing');
  await expect(page.locator('#al-result')).toContainText('not valid JSON');
});

test('opening a file from disk works', async ({ page }) => {
  await page.goto('./inspect.html');
  await page.locator('#al-file').setInputFiles({
    name: 'bracket.archilite',
    mimeType: 'application/json',
    buffer: Buffer.from(EXAMPLE),
  });
  await expect(page.locator('#al-result')).toContainText('Valid ArchiLite drawing');
  await expect(page.locator('#al-text')).toHaveValue(EXAMPLE);
});

test('file contents are shown as text, never run as HTML', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./inspect.html');
  const hostile = EXAMPLE.replace('"Example bracket"', JSON.stringify('<img src=x onerror="window.pwned=1">'));
  await check(page, hostile);
  const result = page.locator('#al-result');
  await expect(result).toContainText('<img src=x');
  await expect(result.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { pwned?: number }).pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});
