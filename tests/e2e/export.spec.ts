import { expect, test } from '@playwright/test';
import { openExample, state, watchErrors } from './helpers';

test('export as DXF downloads a file, and that file opens again', async ({ page }) => {
  const errors = watchErrors(page);
  await openExample(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export as DXF' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await download.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    if (!s) throw new Error('no stream');
    for await (const c of s) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  });
  expect(text).toContain('SECTION');
  expect(text).toContain('CIRCLE');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('Start a new drawing');
  await page.keyboard.press('Enter');
  await page.locator('#al-file').setInputFiles({ name: 'bracket.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) });
  expect((await state(page)).entities).toBe(16);
  await expect(page.locator('#al-title')).toHaveText('Untitled');
  expect(errors).toEqual([]);
});

test('export as PDF and SVG from the command palette', async ({ page }) => {
  const errors = watchErrors(page);
  await openExample(page);
  const pdf = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('Export as PDF');
      await page.keyboard.press('Enter');
    })(),
  ]);
  expect(pdf[0].suggestedFilename()).toMatch(/\.pdf$/);
  const svg = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('Export as SVG');
      await page.keyboard.press('Enter');
    })(),
  ]);
  expect(svg[0].suggestedFilename()).toMatch(/\.svg$/);
  expect(errors).toEqual([]);
});

test('a DXF with %%u room names opens without the underline codes', async ({ page }) => {
  await page.goto('./?test');
  await page.locator('#al-file').setInputFiles({
    name: 'rooms.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(
      [
        '0',
        'SECTION',
        '2',
        'ENTITIES',
        '0',
        'TEXT',
        '8',
        '0',
        '10',
        '0',
        '20',
        '0',
        '40',
        '5',
        '1',
        '%%uGREAT ROOM',
        '0',
        'ENDSEC',
        '0',
        'EOF',
        '',
      ].join('\n'),
    ),
  });
  await expect(page.locator('#al-toast')).toContainText('Opened');
  const save = await page.evaluate(() => (window as unknown as { __archilite: { saveText(): string } }).__archilite.saveText());
  expect(save).toContain('GREAT ROOM');
  expect(save).not.toContain('%%u');
});

test('a bad DXF is refused with a plain message', async ({ page }) => {
  await page.goto('./?test');
  await page.locator('#al-file').setInputFiles({
    name: 'broken.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from('this is not a drawing'),
  });
  await expect(page.locator('#al-toast')).toContainText('could not be opened');
});

test('export as PNG downloads an image of the drawing', async ({ page }) => {
  const errors = watchErrors(page);
  await openExample(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export as PNG' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const stream = await download.createReadStream();
  expect(stream).toBeTruthy();
  const chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(Buffer.from(c));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(errors).toEqual([]);
});

test('a 100 mm line in a 1:1 PDF measures 283.4646 pt in the browser', async ({ page }) => {
  await page.goto('./?test');
  await page.keyboard.press('l');
  await page.keyboard.type('0,0');
  await page.keyboard.press('Enter');
  await page.keyboard.type('100,0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  expect((await state(page)).entities).toBe(1);
  const pdf = await page.evaluate(() => (window as unknown as { __archilite: { exportPdf(): string } }).__archilite.exportPdf());
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf)?.[1];
  expect(stream).toBeTruthy();
  const cm = /([0-9.-]+) 0 0 ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) cm/.exec(stream ?? '');
  const line = /([0-9.-]+) ([0-9.-]+) m ([0-9.-]+) ([0-9.-]+) l S/.exec(stream ?? '');
  expect(cm && line).toBeTruthy();
  const kx = Number(cm![1]);
  const ky = Number(cm![2]);
  const length = Math.hypot((Number(line![3]) - Number(line![1])) * kx, (Number(line![4]) - Number(line![2])) * ky);
  expect(length.toFixed(4)).toBe('283.4646');
});
