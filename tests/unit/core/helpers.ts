import { expect } from 'vitest';
import type { Vec2 } from '../../../src/core/geom';

/** Hand-calculated answers must match to 1e-9 (ROADMAP Phase 1 gate). */
export const TOL = 1e-9;

const fmt = (p: Vec2 | undefined) => (p ? `(${p.x}, ${p.y})` : 'undefined');

export function expectPoint(actual: Vec2 | undefined, expected: Vec2, tol = TOL): void {
  expect(actual, `expected a point near ${fmt(expected)}`).toBeDefined();
  const a = actual as Vec2;
  const d = Math.hypot(a.x - expected.x, a.y - expected.y);
  expect(d, `${fmt(a)} should be within ${tol} of ${fmt(expected)}`).toBeLessThanOrEqual(tol);
}

/** Same points in any order. */
export function expectPointSet(actual: readonly Vec2[], expected: readonly Vec2[], tol = TOL): void {
  expect(actual.length, `got ${actual.map(fmt).join(' ')}; wanted ${expected.map(fmt).join(' ')}`).toBe(
    expected.length,
  );
  for (const e of expected) {
    const hit = actual.some((a) => Math.hypot(a.x - e.x, a.y - e.y) <= tol);
    expect(hit, `missing ${fmt(e)} in ${actual.map(fmt).join(' ')}`).toBe(true);
  }
}

export function expectClose(actual: number, expected: number, tol = TOL): void {
  expect(Math.abs(actual - expected), `${actual} should be within ${tol} of ${expected}`).toBeLessThanOrEqual(tol);
}
