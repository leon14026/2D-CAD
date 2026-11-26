/**
 * Ortho and polar tracking: while placing the next point, the cursor is pulled onto lines
 * from the last point at fixed angles.
 *
 * - Ortho: always horizontal or vertical, whichever is closer to the cursor.
 * - Polar: every multiple of a step angle (15°, 30°, 45° or 90°), when the cursor comes within
 *   `reach` of that line.
 *
 * Points on a tracking line are built from exact directions, so horizontal and vertical lines
 * have exactly equal coordinates.
 */
import { angleOf, cosSin, cross, dot, HALF_PI, normalizeAngle, sub, type Vec2 } from '../geom';

export interface TrackingOptions {
  readonly ortho: boolean;
  /** Polar step angle in radians, or null for no polar tracking. */
  readonly polarStep: number | null;
  /** How near (in drawing units) the cursor must be to a polar line to follow it. */
  readonly reach: number;
}

export interface Tracked {
  readonly point: Vec2;
  /** The tracking direction in radians, in [0, 2π), or null if the cursor is free. */
  readonly angle: number | null;
}

export const POLAR_STEPS_DEGREES: readonly number[] = Object.freeze([15, 30, 45, 90]);

function along(base: Vec2, cursor: Vec2, angle: number): Tracked {
  const dir = cosSin(angle); // exact at quarter turns
  // On a horizontal or vertical line, keep the cursor's own coordinate: no rounding creeps in.
  if (dir.y === 0) return { point: { x: cursor.x, y: base.y }, angle };
  if (dir.x === 0) return { point: { x: base.x, y: cursor.y }, angle };
  const t = dot(sub(cursor, base), dir);
  return { point: { x: base.x + dir.x * t, y: base.y + dir.y * t }, angle };
}

/** Where the next point goes, given the last point and the cursor. */
export function track(base: Vec2, cursor: Vec2, options: TrackingOptions): Tracked {
  const v = sub(cursor, base);
  if (v.x === 0 && v.y === 0) return { point: cursor, angle: null };
  if (options.ortho) {
    const angle = Math.abs(v.x) >= Math.abs(v.y) ? (v.x >= 0 ? 0 : Math.PI) : v.y >= 0 ? HALF_PI : 3 * HALF_PI;
    return along(base, cursor, angle);
  }
  const step = options.polarStep;
  if (step === null || !(step > 0)) return { point: cursor, angle: null };
  const angle = normalizeAngle(Math.round(angleOf(v) / step) * step);
  const dir = cosSin(angle);
  if (dot(v, dir) <= 0 || Math.abs(cross(dir, v)) > options.reach) return { point: cursor, angle: null };
  return along(base, cursor, angle);
}
