/**
 * Phase 6: annotation tools in the real app with the GPU off.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loadDocument, notesInDrawOrder, resolveNotes, type Doc, type Note } from '../../src/core/doc';
import { clickWorld, drawAnnotateReference, drawReference, toPage, watchErrors } from './helpers';

const saveText = (page: Page) => page.evaluate(() => (window as unknown as { __archilite: { saveText(): string } }).__archilite.saveText());
const docOf = async (page: Page): Promise<Doc> => loadDocument(await saveText(page));
const notesOf = async (page: Page): Promise<Note[]> => notesInDrawOrder(await docOf(page));
const panel = (page: Page) => page.locator('#al-selection-panel');

async function newDrawing(page: Page): Promise<void> {
  await page.goto('./?test');
  await expect(page.locator('#al-count')).toHaveText('0 entities');
}

/** The text a dimension shows, measured from its geometry. */
function shown(doc: Doc, note: Note): string | undefined {
  const r = resolveNotes(doc).get(note.id);
  expect(r?.ok, `note ${note.id} resolves`).toBe(true);
  return r?.ok ? r.r.text : undefined;
}

const PLATE = [{ tool: 'rectangle' }, { type: '0,0' }, { type: '@60,40' }, { enter: true }] as const;

test('the reference drawing made with every annotation tool matches the approved drawing exactly', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawAnnotateReference(page);
  const made = JSON.parse(await saveText(page));
  const approved = JSON.parse(readFileSync('tests/fixtures/annotate-reference.archilite', 'utf8'));
  made.title = approved.title; // the engine test names its drawing
  expect(made).toEqual(approved);
  expect(errors).toEqual([]);
});

test('a dimension shows what its geometry measures, and changes when the geometry does', async ({ page }) => {
  const errors = watchErrors(page);
  await newDrawing(page);
  await drawReference(page, [...PLATE, { tool: 'dimLinear' }, { option: 'r' }, { type: '0,0' }, { type: '60,0' }, { type: '30,-10' }, { enter: true }]);
  let doc = await docOf(page);
  const [dim] = notesInDrawOrder(doc) as [Note];
  expect(dim.body.kind).toBe('linear');
  expect(shown(doc, dim)).toBe('(60.00)');

  // Selecting the dimension names what it measures.
  const p = await toPage(page, 12, -10);
  await page.mouse.click(p.x, p.y);
  await expect(panel(page)).toContainText('Linear dimension');
  await expect(panel(page)).toContainText('(60.00)');

  // Scaling the plate to twice its size makes the dimension read 120.00 without touching it.
  await drawReference(page, [{ select: [[30, 40]] }, { tool: 'scale' }, { type: '0,0' }, { type: '2' }]);
  doc = await docOf(page);
  expect(shown(doc, (notesInDrawOrder(doc) as [Note])[0])).toBe('(120.00)');
  expect(errors).toEqual([]);
});

test('text is typed into the box beside the cursor, edited in the panel, and undone', async ({ page }) => {
  await newDrawing(page);
  await drawReference(page, [{ tool: 'text' }, { type: '10,10' }, { type: '6 mm steel plate' }]);
  let [note] = await notesOf(page);
  expect(note?.body).toMatchObject({ kind: 'text', text: '6 mm steel plate', at: { x: 10, y: 10 } });

  await clickWorld(page, 11, 11);
  const field = panel(page).getByLabel('Text', { exact: true });
  await expect(field).toHaveValue('6 mm steel plate');
  await field.fill('Brass, 3 mm');
  await field.blur();
  [note] = await notesOf(page);
  expect(note?.body).toMatchObject({ text: 'Brass, 3 mm' });

  await page.getByRole('button', { name: 'Undo' }).click();
  [note] = await notesOf(page);
  expect(note?.body).toMatchObject({ text: '6 mm steel plate' });
});

test('a hatch leaves islands clear and reports its area in the panel', async ({ page }) => {
  await newDrawing(page);
  await drawReference(page, [
    ...PLATE,
    { tool: 'circle' }, { type: '30,20' }, { type: '5' }, { enter: true },
    { tool: 'hatch' }, { pick: [45, 0] }, { pick: [35, 20] }, { enter: true }, { enter: true },
  ]);
  await clickWorld(page, 10, 30);
  await expect(panel(page)).toContainText('Hatch');
  await expect(panel(page)).toContainText(/2,?321\.4/); // 60 × 40 − 25π = 2321.46
  const [hatch] = await notesOf(page);
  // The plate is entity 2, its four constraints are 3 to 6, so the circle is entity 7.
  expect(hatch?.body).toMatchObject({ kind: 'hatch', loops: [[2], [7]] });
});

test('the dimension style is edited in the panel, saved under a new name, and used by the next dimension', async ({ page }) => {
  await newDrawing(page);
  await panel(page).getByText('Dimension style: ISO').click();
  await panel(page).getByLabel('Style name').fill('Large');
  await panel(page).getByLabel('Text height').fill('5');
  await panel(page).getByRole('button', { name: 'Save style' }).click();
  let doc = await docOf(page);
  expect(doc.settings.currentDimStyle).toBe('Large');
  expect(doc.settings.dimStyles.find((s) => s.name === 'Large')?.textHeight).toBe(5);
  expect(doc.settings.dimStyles.find((s) => s.name === 'ISO')?.textHeight).toBe(3.5);

  await drawReference(page, [{ tool: 'line' }, { type: '0,0' }, { type: '40,0' }, { enter: true }, { tool: 'dimAligned' }, { type: '0,0' }, { type: '40,0' }, { type: '20,-8' }, { enter: true }]);
  doc = await docOf(page);
  expect((notesInDrawOrder(doc) as [Note])[0].body).toMatchObject({ kind: 'aligned', style: 'Large' });
});

test('title block fields are filled in from the panel', async ({ page }) => {
  await newDrawing(page);
  await drawReference(page, [{ tool: 'titleBlock' }, { type: '0,0' }]);
  await page.keyboard.press('Control+a');
  await expect(panel(page)).toContainText('Title block');
  const title = panel(page).getByLabel('Title', { exact: true });
  await title.fill('Bracket');
  await title.blur();
  const [block] = await notesOf(page);
  expect(block?.body).toMatchObject({ kind: 'titleBlock', size: 'A4', fields: { title: 'Bracket' } });
});

test('picking the wrong kind of object is refused in plain words and changes nothing', async ({ page }) => {
  await newDrawing(page);
  await drawReference(page, [{ tool: 'line' }, { type: '0,0' }, { type: '40,0' }, { enter: true }]);
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Radius dimension', exact: true }).click();
  await clickWorld(page, 20, 0);
  await expect(page.locator('.al-entry-error')).toHaveText('Pick a circle or an arc.');
  expect(await notesOf(page)).toEqual([]);
});
