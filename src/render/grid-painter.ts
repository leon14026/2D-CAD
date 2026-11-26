import { palette } from '../ui/palette';
import { chooseGridSpacing, gridIndices, majorEvery } from './grid';
import { screenToWorld, type Viewport } from './viewport';

/** Minimum on-screen gap between minor grid lines, in CSS pixels. */
export const MIN_MINOR_GAP_PX = 8;

export interface Surface {
  readonly ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
}

/** Snap a CSS-pixel coordinate to the centre of a device pixel so 1-px lines stay crisp. */
function crisp(cssPx: number, dpr: number): number {
  return Math.round(cssPx * dpr) + 0.5;
}

/**
 * Paints paper, grid and axes using plain Canvas 2D calls. Works with or
 * without GPU acceleration: no WebGL, no WebGPU, no shaders.
 */
export function paintSheet(surface: Surface, vp: Viewport, showGrid = true): void {
  const { ctx, width, height, dpr } = surface;
  const devW = Math.round(width * dpr);
  const devH = Math.round(height * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.setLineDash([]);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, devW, devH);

  if (showGrid) paintGrid(surface, vp);
  paintAxes(surface, vp);
}

function paintGrid(surface: Surface, vp: Viewport): void {
  const { ctx, width, height, dpr } = surface;
  const devW = Math.round(width * dpr);
  const devH = Math.round(height * dpr);
  const spacing = chooseGridSpacing(vp.pxPerUnit, MIN_MINOR_GAP_PX);
  const every = majorEvery(spacing);
  const topLeft = screenToWorld(vp, { x: 0, y: 0 });
  const bottomRight = screenToWorld(vp, { x: width, y: height });

  const xs = gridIndices(topLeft.x, bottomRight.x, spacing);
  const ys = gridIndices(bottomRight.y, topLeft.y, spacing);

  ctx.lineWidth = 1;
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? palette.gridMajor : palette.gridMinor;
    ctx.beginPath();
    for (const k of xs) {
      if (k === 0 || (k % every === 0) !== major) continue;
      const x = crisp(vp.originX + k * spacing * vp.pxPerUnit, dpr);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, devH);
    }
    for (const k of ys) {
      if (k === 0 || (k % every === 0) !== major) continue;
      const y = crisp(vp.originY - k * spacing * vp.pxPerUnit, dpr);
      ctx.moveTo(0, y);
      ctx.lineTo(devW, y);
    }
    ctx.stroke();
  }
}

function paintAxes(surface: Surface, vp: Viewport): void {
  const { ctx, width, height, dpr } = surface;
  const devW = Math.round(width * dpr);
  const devH = Math.round(height * dpr);
  const ox = crisp(vp.originX, dpr);
  const oy = crisp(vp.originY, dpr);

  ctx.strokeStyle = palette.axisX;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(devW, oy);
  ctx.stroke();

  ctx.strokeStyle = palette.axisY;
  ctx.beginPath();
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, devH);
  ctx.stroke();

  const r = Math.round(4 * dpr);
  ctx.strokeStyle = palette.origin;
  ctx.beginPath();
  ctx.rect(ox - r, oy - r, 2 * r, 2 * r);
  ctx.stroke();
}
