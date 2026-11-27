import { expect, test } from '@playwright/test';
import { EXAMPLES, sourceOf } from '../../src/script/examples';
import { watchErrors } from './helpers';

type Hook = {
  runScript: (
    language: 'javascript' | 'python',
    source: string,
  ) => Promise<{ ok: boolean; log: string[]; error?: string; entities: number; undo: number }>;
  saveText: () => string;
  state: () => { entities: number; undo: number };
};

test('opening the app does not fetch Pyodide', async ({ page }) => {
  const errors = watchErrors(page);
  const pyodide: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/pyodide/')) pyodide.push(req.url());
  });
  await page.goto('./?test');
  await page.waitForLoadState('networkidle');
  expect(pyodide).toEqual([]);
  expect(errors).toEqual([]);
});

test('the Script button opens the panel without loading Python', async ({ page }) => {
  const pyodide: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/pyodide/')) pyodide.push(req.url());
  });
  await page.goto('./?test');
  await page.getByRole('button', { name: 'Script' }).click();
  await expect(page.getByRole('textbox', { name: 'Script' })).toBeVisible();
  await expect(page.locator('#al-script-panel')).toContainText('Bolt circle');
  expect(pyodide).toEqual([]);
});

test('a JavaScript bolt circle is one undo step and cannot fetch', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?test');
  const bolt = sourceOf(EXAMPLES[0]!, 'javascript');
  const drawn = await page.evaluate(async (source) => {
    const api = (window as unknown as { __archilite: Hook }).__archilite;
    return api.runScript('javascript', source);
  }, bolt);
  expect(drawn.ok).toBe(true);
  expect(drawn.entities).toBe(8);
  expect(drawn.undo).toBe(1);

  await page.keyboard.press('Control+z');
  const afterUndo = await page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.state());
  expect(afterUndo.entities).toBe(0);
  expect(afterUndo.undo).toBe(0);

  const blocked = await page.evaluate(async () => {
    const api = (window as unknown as { __archilite: Hook }).__archilite;
    return api.runScript('javascript', `fetch('https://example.com')`);
  });
  expect(blocked.ok).toBe(false);
  expect(blocked.error).toMatch(/blocked in scripts/);
  expect(blocked.entities).toBe(0);
  expect(errors).toEqual([]);
});

test('Python bolt circle matches JavaScript and loads Pyodide from this origin', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const external: string[] = [];
  const pyodide: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol !== 'data:' && url.host !== '127.0.0.1:4173') external.push(req.url());
    if (url.pathname.includes('/pyodide/')) pyodide.push(req.url());
  });
  await page.goto('./?test');
  const jsSource = sourceOf(EXAMPLES[0]!, 'javascript');
  const pySource = sourceOf(EXAMPLES[0]!, 'python');
  const js = await page.evaluate(async (source) => {
    const api = (window as unknown as { __archilite: Hook }).__archilite;
    const result = await api.runScript('javascript', source);
    return { ...result, file: api.saveText() };
  }, jsSource);
  await page.keyboard.press('Control+z');
  const py = await page.evaluate(async (source) => {
    const api = (window as unknown as { __archilite: Hook }).__archilite;
    const result = await api.runScript('python', source);
    return { ...result, file: api.saveText() };
  }, pySource);
  expect(js.ok).toBe(true);
  expect(py.ok).toBe(true);
  expect(py.file).toBe(js.file);
  // A Python run must not leave the page's own fetch replaced (the example loader uses it).
  const status = await page.evaluate(async () => (await fetch('./examples/bracket.archilite')).status);
  expect(status).toBe(200);
  expect(pyodide.length).toBeGreaterThan(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
