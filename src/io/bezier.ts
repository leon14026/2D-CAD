/**
 * Cubic Bézier approximations of circular arcs. SVG and PDF have no native arc that matches
 * our signed-sweep convention, so both draw through these cubics.
 */
import { cosSin, type Vec2 } from '../core/geom';

export interface Cubic {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
}

const QUARTER = Math.PI / 2;

/**
 * One cubic for the arc of a circle from `a0` to `a1` (signed, |a1 − a0| ≤ π/2).
 * The handle length is 4/3 tan(Δ/4), which is exact at the ends and very close in between.
 */
export function cubicArc(center: Vec2, radius: number, a0: number, a1: number): Cubic {
  const delta = a1 - a0;
  const k = (4 / 3) * Math.tan(delta / 4);
  const s0 = cosSin(a0);
  const s1 = cosSin(a1);
  return {
    p0: { x: center.x + radius * s0.x, y: center.y + radius * s0.y },
    p1: { x: center.x + radius * (s0.x - k * s0.y), y: center.y + radius * (s0.y + k * s0.x) },
    p2: { x: center.x + radius * (s1.x + k * s1.y), y: center.y + radius * (s1.y - k * s1.x) },
    p3: { x: center.x + radius * s1.x, y: center.y + radius * s1.y },
  };
}

/** Splits a signed sweep into cubics of at most a quarter turn each. */
export function arcCubics(center: Vec2, radius: number, start: number, sweep: number): Cubic[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER));
  const step = sweep / n;
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    out.push(cubicArc(center, radius, start + step * i, start + step * (i + 1)));
  }
  return out;
}

/** Four cubics for a full circle, starting at +x. */
export function circleCubics(center: Vec2, radius: number): Cubic[] {
  return arcCubics(center, radius, 0, 2 * Math.PI);
}
