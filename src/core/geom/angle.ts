import { ANGULAR_TOL } from './tolerance';
import type { Vec2 } from './vec';

export const TAU = 2 * Math.PI;
export const HALF_PI = Math.PI / 2;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Maps any angle to [0, 2π). */
export function normalizeAngle(angle: number): number {
  let r = angle % TAU;
  if (r < 0) r += TAU;
  if (r >= TAU) r -= TAU;
  return r + 0; // turns -0 into 0
}

/** Counter-clockwise sweep from `from` to `to`, in [0, 2π). */
export function ccwSweep(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/**
 * Window for snapping to exact quarter turns: wide enough to absorb the rounding in values
 * like 270 × π / 180 or −π/2 + 2π (a few ulps), narrow enough that snapping moves a point by
 * far less than the linear tolerance.
 */
export const QUARTER_TURN_SNAP = 1e-14;

/**
 * If `angle` is a whole number of quarter turns (to within rounding error), returns that
 * number; otherwise null.
 */
export function quarterTurns(angle: number): number | null {
  const k = Math.round(angle / HALF_PI);
  return Math.abs(angle - k * HALF_PI) <= QUARTER_TURN_SNAP * Math.max(1, Math.abs(angle)) ? k : null;
}

/**
 * cos and sin of an angle, exact at whole quarter turns, so that rotating by 90°
 * gives (0, 1) and not (6.1e-17, 1).
 */
export function cosSin(angle: number): Vec2 {
  const k = quarterTurns(angle);
  if (k !== null) {
    switch (((k % 4) + 4) % 4) {
      case 0:
        return { x: 1, y: 0 };
      case 1:
        return { x: 0, y: 1 };
      case 2:
        return { x: -1, y: 0 };
      default:
        return { x: 0, y: -1 };
    }
  }
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** True if `angle` lies on the sweep from `start` (signed: positive is counter-clockwise). */
export function sweepContains(start: number, sweep: number, angle: number, tol: number = ANGULAR_TOL): boolean {
  const along = sweep >= 0 ? normalizeAngle(angle - start) : normalizeAngle(start - angle);
  return along <= Math.abs(sweep) + tol || along >= TAU - tol;
}
