/**
 * Steel rules along the top and left of the drawing area, ticked in drawing units at the
 * current zoom, with the cursor's position marked on each.
 */
import { palette } from '../ui/palette';
import { chooseGridSpacing, gridIndices, majorEvery } from './grid';
import { screenToWorld, type Point, type Viewport } from './viewport';

/** Width of each rule in CSS pixels. */
export const RULER = 22;

const LABEL_GAP_PX = 56;

/** Shortest readable form of a tick value: 1250, 0.25, 1e-7. */
export function tickLabel(value: number): string {
  if (value === 0) return '0';
  const a = Math.abs(value);
  if (a >= 1e6 || a < 1e-4) return value.toExponential(0).replace('e+', 'e');
  return String(Number(value.toPrecision(6)));
}

interface Ticks {
  readonly spacing: number;
  readonly major: number;
  readonly labelEvery: number;
}

function ticksFor(vp: Viewport): Ticks {
  const spacing = chooseGridSpacing(vp.pxPerUnit, 6);
  const major = majorEvery(spacing);
  const majorPx = spacing * major * vp.pxPerUnit;
  const labelEvery = major * Math.max(1, [1, 2, 5, 10].find((k) => k * majorPx >= LABEL_GAP_PX) ?? 10);
  return { spacing, major, labelEvery };
}

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  height: number,
  dpr: number,
  units: string,
  cursor: Point | null,
): void {
  const t = ticksFor(vp);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = palette.ruler;
  ctx.fillRect(0, 0, width, RULER);
  ctx.fillRect(0, 0, RULER, height);
  ctx.strokeStyle = palette.rulerLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RULER, RULER - 0.5);
  ctx.lineTo(width, RULER - 0.5);
  ctx.moveTo(RULER - 0.5, RULER);
  ctx.lineTo(RULER - 0.5, height);
  ctx.stroke();

  ctx.fillStyle = palette.rulerInk;
  ctx.strokeStyle = palette.rulerInk;
  ctx.font = '10px B612, system-ui, sans-serif';
  ctx.textBaseline = 'top';

  // Top rule: x.
  const left = screenToWorld(vp, { x: RULER, y: 0 }).x;
  const right = screenToWorld(vp, { x: width, y: 0 }).x;
  ctx.beginPath();
  for (const k of gridIndices(left, right, t.spacing)) {
    const x = Math.round(vp.originX + k * t.spacing * vp.pxPerUnit) + 0.5;
    const len = k % t.major === 0 ? 10 : t.major === 10 && k % 5 === 0 ? 6 : 3;
    ctx.moveTo(x, RULER);
    ctx.lineTo(x, RULER - len);
    if (k % t.labelEvery === 0) ctx.fillText(tickLabel(k * t.spacing), x + 3, 2);
  }
  ctx.stroke();

  // Left rule: y, labels turned to read upwards.
  const bottom = screenToWorld(vp, { x: 0, y: height }).y;
  const top = screenToWorld(vp, { x: 0, y: RULER }).y;
  ctx.beginPath();
  for (const k of gridIndices(bottom, top, t.spacing)) {
    const y = Math.round(vp.originY - k * t.spacing * vp.pxPerUnit) + 0.5;
    const len = k % t.major === 0 ? 10 : t.major === 10 && k % 5 === 0 ? 6 : 3;
    ctx.moveTo(RULER, y);
    ctx.lineTo(RULER - len, y);
    if (k % t.labelEvery === 0) {
      ctx.save();
      ctx.translate(2, y - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(tickLabel(k * t.spacing), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();

  // Corner: the drawing units.
  ctx.fillStyle = palette.ruler;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.fillStyle = palette.rulerInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(units, RULER / 2, RULER / 2);

  if (cursor) {
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (cursor.x > RULER) {
      ctx.moveTo(Math.round(cursor.x) + 0.5, 0);
      ctx.lineTo(Math.round(cursor.x) + 0.5, RULER);
    }
    if (cursor.y > RULER) {
      ctx.moveTo(0, Math.round(cursor.y) + 0.5);
      ctx.lineTo(RULER, Math.round(cursor.y) + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}
