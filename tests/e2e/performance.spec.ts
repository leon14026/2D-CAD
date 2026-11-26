/**
 * Phase 3 gate: a 20,000-entity drawing pans and zooms at 30 frames a second or better in
 * Chromium with the GPU switched off (software rendering only).
 *
 * Each frame is timed from the view change until its pixels are ready (getImageData waits for
 * them), so this measures drawing, not just issuing drawing calls.
 */
import { expect, test } from '@playwright/test';
import { bigDrawingText } from '../fixtures/big-drawing';
import { lastDrawn, openText, state, timeFrames, watchErrors } from './helpers';

const BUDGET_MS = 1000 / 30;
const FRAMES = 60;

const summary = (t: number[]) => {
  const sorted = [...t].sort((a, b) => a - b);
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  return { avg, p95: sorted[Math.floor(sorted.length * 0.95)] as number, max: sorted[sorted.length - 1] as number };
};

test.describe('20,000 entities, GPU disabled', () => {
  test.setTimeout(180_000);

  test('pans and zooms at 30 fps or better', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./?test');
    const text = bigDrawingText(); // 50 × 25 brackets × 16 entities
    const t0 = Date.now();
    expect(await openText(page, text)).toBe(true);
    const openMs = Date.now() - t0;
    expect((await state(page)).entities).toBe(20_000);
    expect(await lastDrawn(page)).toBe(20_000); // fitted: every entity is on screen

    await timeFrames(page, 5, 'pan'); // warm up
    const pan = summary(await timeFrames(page, FRAMES, 'pan'));
    const zoom = summary(await timeFrames(page, FRAMES, 'zoom'));
    const report = `open ${openMs} ms; pan avg ${pan.avg.toFixed(1)} ms (${(1000 / pan.avg).toFixed(0)} fps), p95 ${pan.p95.toFixed(1)}, max ${pan.max.toFixed(1)}; zoom avg ${zoom.avg.toFixed(1)} ms (${(1000 / zoom.avg).toFixed(0)} fps), p95 ${zoom.p95.toFixed(1)}, max ${zoom.max.toFixed(1)}`;
    test.info().annotations.push({ type: 'performance', description: report });
    console.log(`[performance] ${report}`);

    expect(pan.avg).toBeLessThanOrEqual(BUDGET_MS);
    expect(zoom.avg).toBeLessThanOrEqual(BUDGET_MS);
    expect(errors).toEqual([]);
  });
});
