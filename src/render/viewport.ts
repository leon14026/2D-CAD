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
