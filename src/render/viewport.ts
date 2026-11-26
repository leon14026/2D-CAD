import type { Vec2 } from '../core/geom/vec';

/**
 * Mapping between screen space (CSS pixels, y down) and world space
 * (drawing units, y up, the usual engineering-drawing convention).
 */
export interface Viewport {
  /** Screen x of the world origin, in CSS pixels. */
  readonly originX: number;
  /** Screen y of the world origin, in CSS pixels. */
  readonly originY: number;
  /** CSS pixels per drawing unit. */
  readonly pxPerUnit: number;
}

export type Point = Vec2;

export function worldToScreen(vp: Viewport, p: Point): Point {
  return {
    x: vp.originX + p.x * vp.pxPerUnit,
    y: vp.originY - p.y * vp.pxPerUnit,
  };
}

export function screenToWorld(vp: Viewport, p: Point): Point {
  return {
    x: (p.x - vp.originX) / vp.pxPerUnit,
    y: (vp.originY - p.y) / vp.pxPerUnit,
  };
}

/** Zoom limits in CSS pixels per drawing unit: from a 1,000 km overview to a 1 nm close-up. */
export const MIN_PX_PER_UNIT = 1e-6;
export const MAX_PX_PER_UNIT = 1e6;

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The part of the world a screen of `width` × `height` CSS pixels shows. */
export function visibleWorld(vp: Viewport, width: number, height: number): Rect {
  const a = screenToWorld(vp, { x: 0, y: height });
  const b = screenToWorld(vp, { x: width, y: 0 });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Zooms by `factor` keeping the world point under `screen` fixed. The scale is clamped. */
export function zoomAt(vp: Viewport, screen: Point, factor: number): Viewport {
  const pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, vp.pxPerUnit * factor));
  const k = pxPerUnit / vp.pxPerUnit;
  return {
    originX: screen.x - (screen.x - vp.originX) * k,
    originY: screen.y - (screen.y - vp.originY) * k,
    pxPerUnit,
  };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, originX: vp.originX + dx, originY: vp.originY + dy };
}

/**
 * A viewport showing `world` centred in a `width` × `height` screen with `margin` CSS pixels
 * all round. A zero-size box (a single point) is shown at the current scale.
 */
export function fitRect(world: Rect, width: number, height: number, margin: number, current: Viewport): Viewport {
  const w = world.maxX - world.minX;
  const h = world.maxY - world.minY;
  const availW = Math.max(1, width - 2 * margin);
  const availH = Math.max(1, height - 2 * margin);
  let pxPerUnit = current.pxPerUnit;
  if (w > 0 || h > 0) pxPerUnit = Math.min(w > 0 ? availW / w : Infinity, h > 0 ? availH / h : Infinity);
  pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, pxPerUnit));
  const cx = (world.minX + world.maxX) / 2;
  const cy = (world.minY + world.maxY) / 2;
  return { originX: width / 2 - cx * pxPerUnit, originY: height / 2 + cy * pxPerUnit, pxPerUnit };
}

/**
 * Drawing scale as people say it for a screen at 96 CSS pixels per inch: "1:1" when 1 mm on
 * screen is 1 mm of drawing. `mmPerUnit` converts drawing units to millimetres.
 */
export function screenScaleLabel(vp: Viewport, mmPerUnit: number): string {
  const screenMmPerUnit = (vp.pxPerUnit * 25.4) / 96;
  const ratio = screenMmPerUnit / mmPerUnit;
  const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : Number(n.toPrecision(3)).toString());
  return ratio >= 1 ? `${fmt(ratio)}:1` : `1:${fmt(1 / ratio)}`;
}
