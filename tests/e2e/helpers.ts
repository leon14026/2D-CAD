import { expect, type Page } from '@playwright/test';

export interface ViewState {
  entities: number;
  selection: number[];
  viewport: { originX: number; originY: number; pxPerUnit: number };
  hover: number | null;
  undo: number;
  tool: string | null;
}

type Hook = {
  openText(text: string): boolean;
  state(): ViewState;
  timeFrames(frames: number, kind: 'pan' | 'zoom'): number[];
  lastDrawn(): number;
};

/** Collects console errors and uncaught exceptions for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

export async function state(page: Page): Promise<ViewState> {
  return page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.state());
}

export async function openText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((t) => (window as unknown as { __archilite: Hook }).__archilite.openText(t), text);
}

export async function timeFrames(page: Page, frames: number, kind: 'pan' | 'zoom'): Promise<number[]> {
  return page.evaluate(([n, k]) => (window as unknown as { __archilite: Hook }).__archilite.timeFrames(n, k), [frames, kind] as const);
}

export async function lastDrawn(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __archilite: Hook }).__archilite.lastDrawn());
}

/** Opens the app with the test hook and loads the example bracket. */
export async function openExample(page: Page): Promise<void> {
  await page.goto('./?test');
  await page.getByRole('button', { name: 'Load the example' }).click();
  await expect(page.locator('#al-count')).toHaveText('16 entities');
  await page.evaluate(() => document.fonts.ready);
}

/** Page coordinates of a world point, from the current viewport. */
export async function toPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('#al-overlay').boundingBox();
  if (!box) throw new Error('no drawing area');
  const { viewport: vp } = await state(page);
  return { x: box.x + vp.originX + x * vp.pxPerUnit, y: box.y + vp.originY - y * vp.pxPerUnit };
}

/** Drags with the left button between two world points. */
export async function dragWorld(page: Page, from: [number, number], to: [number, number], release = true): Promise<void> {
  const a = await toPage(page, ...from);
  const b = await toPage(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (release) await page.mouse.up();
}

export async function clickWorld(page: Page, x: number, y: number, modifiers: ('Shift')[] = []): Promise<void> {
  const p = await toPage(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Example bracket ids (see tests/unit/core/doc/example-bracket.ts). */
export const EX = {
  outline: 5,
  holes: [6, 7, 8, 9],
  slot: 10,
  hole1Lines: [11, 12],
  slotLines: [19, 20],
  all: Array.from({ length: 16 }, (_, i) => i + 5),
} as const;

/**
 * Draws the Phase 5 reference drawing (tests/fixtures/modify-reference.ts) through the app's
 * own controls: rail buttons (or the command palette for tools not on the rail), typed values,
 * clicks on objects, and the selection panel's Join and Explode buttons.
 */
export async function drawModifyReference(page: Page): Promise<void> {
  const { MODIFY_STEPS } = await import('../fixtures/modify-reference');
  const { DRAW_BUTTONS, MODIFY_BUTTONS, TOOL_BUTTONS } = await import('../../src/app/tools');
  const onRail = new Set([...DRAW_BUTTONS, ...MODIFY_BUTTONS].map((b) => b.id));
  const click = async (x: number, y: number, shift = false) => {
    const p = await toPage(page, x, y);
    await page.mouse.move(p.x, p.y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    if (shift) await page.keyboard.up('Shift');
  };
  for (const step of MODIFY_STEPS) {
    if ('tool' in step) {
      const button = TOOL_BUTTONS.find((b) => b.id === step.tool) as { label: string; palette: string };
      if (onRail.has(step.tool)) {
        await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: button.label, exact: true }).click();
      } else {
        await page.keyboard.press('Control+k');
        await page.keyboard.type(button.palette);
        await page.keyboard.press('Enter');
      }
    } else if ('type' in step) {
      await page.keyboard.type(step.type);
      await page.keyboard.press('Enter');
    } else if ('option' in step) {
      await page.keyboard.press(step.option);
    } else if ('enter' in step) {
      await page.keyboard.press('Enter');
    } else if ('pick' in step) {
      await page.keyboard.press('f'); // everything on screen, so every pick lands
      await click(step.pick[0], step.pick[1]);
    } else if ('select' in step) {
      await page.keyboard.press('Escape'); // clears the selection
      await page.keyboard.press('f');
      for (const [i, [x, y]] of step.select.entries()) await click(x, y, i > 0);
      expect((await state(page)).selection).toHaveLength(step.select.length);
    } else {
      await page.getByRole('group', { name: 'Change the selection' }).getByRole('button', { name: step.action === 'join' ? 'Join' : 'Explode', exact: true }).click();
    }
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
}
