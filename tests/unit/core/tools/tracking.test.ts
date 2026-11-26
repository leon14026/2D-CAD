import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cosSin, cross, degToRad, distance, normalizeAngle, sub } from '../../../../src/core/geom';
import { POLAR_STEPS_DEGREES, track } from '../../../../src/core/tools';
import { point, PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';

const free = { ortho: false, polarStep: null, reach: 1 };
const ortho = { ortho: true, polarStep: null, reach: 1 };
const polar = (deg: number, reach = 1) => ({ ortho: false, polarStep: degToRad(deg), reach });

describe('ortho', () => {
  const base = { x: 1.1, y: 2.2 };
  it('goes horizontal or vertical, whichever is nearer, keeping the other coordinate exact', () => {
    expect(track(base, { x: 9, y: 3 }, ortho)).toEqual({ point: { x: 9, y: 2.2 }, angle: 0 });
    expect(track(base, { x: -9, y: 3 }, ortho)).toEqual({ point: { x: -9, y: 2.2 }, angle: Math.PI });
    expect(track(base, { x: 1.5, y: 30 }, ortho)).toEqual({ point: { x: 1.1, y: 30 }, angle: Math.PI / 2 });
    expect(track(base, { x: 1.5, y: -30 }, ortho)).toEqual({ point: { x: 1.1, y: -30 }, angle: 1.5 * Math.PI });
  });

  it('a 45° cursor counts as horizontal', () => {
    expect(track({ x: 0, y: 0 }, { x: 3, y: 3 }, ortho).angle).toBe(0);
  });

  it('wins over polar tracking', () => {
    expect(track({ x: 0, y: 0 }, { x: 10, y: 5.8 }, { ...ortho, polarStep: degToRad(30) }).angle).toBe(0);
  });
});

describe('polar tracking', () => {
  it('follows the nearest multiple of the step when close enough', () => {
    const r = track({ x: 0, y: 0 }, { x: 10, y: 5.9 }, polar(30));
    expect(r.angle).toBeCloseTo(Math.PI / 6, 15);
    expect(distance(r.point, { x: 10, y: 10 / Math.sqrt(3) })).toBeLessThan(0.3);
    expect(Math.abs(cross(cosSin(Math.PI / 6), r.point))).toBeLessThan(1e-12);
  });

  it('lets go when the cursor is further than the reach', () => {
    expect(track({ x: 0, y: 0 }, { x: 10, y: 3 }, polar(30, 0.5))).toEqual({ point: { x: 10, y: 3 }, angle: null });
  });

  it('horizontal and vertical tracking lines are exact', () => {
    expect(track({ x: 0.3, y: 0.7 }, { x: 0.35, y: 9 }, polar(15))).toEqual({ point: { x: 0.3, y: 9 }, angle: Math.PI / 2 });
    expect(track({ x: 0.3, y: 0.7 }, { x: -8, y: 0.71 }, polar(45))).toEqual({ point: { x: -8, y: 0.7 }, angle: Math.PI });
  });

  it('does nothing with no step, a zero step, a step pointing away, or the cursor on the last point', () => {
    expect(track({ x: 0, y: 0 }, { x: 10, y: 0.1 }, free)).toEqual({ point: { x: 10, y: 0.1 }, angle: null });
    expect(track({ x: 0, y: 0 }, { x: 10, y: 0.1 }, polar(0))).toEqual({ point: { x: 10, y: 0.1 }, angle: null });
    // A whole-turn step only has the 0° line, which points away from this cursor.
    expect(track({ x: 0, y: 0 }, { x: -10, y: 0 }, polar(360))).toEqual({ point: { x: -10, y: 0 }, angle: null });
    expect(track({ x: 2, y: 2 }, { x: 2, y: 2 }, ortho)).toEqual({ point: { x: 2, y: 2 }, angle: null });
  });

  it('offers 15°, 30°, 45° and 90° steps', () => {
    expect(POLAR_STEPS_DEGREES).toEqual([15, 30, 45, 90]);
  });

  it('property: a tracked point lies on its tracking line, ahead of the last point, within reach of the cursor', PROPERTY_TIMEOUT, () => {
      fc.assert(
        fc.property(point, point, fc.constantFrom(...POLAR_STEPS_DEGREES), fc.double({ min: 0.01, max: 100, noNaN: true }), (base, cursor, step, reach) => {
          const r = track(base, cursor, polar(step, reach));
          if (r.angle === null) return;
          const v = sub(r.point, base);
          const dir = cosSin(r.angle);
          const size = Math.max(1, Math.abs(base.x), Math.abs(base.y), Math.abs(cursor.x), Math.abs(cursor.y));
          expect(Math.abs(cross(dir, v))).toBeLessThanOrEqual(1e-9 * size);
          expect(v.x * dir.x + v.y * dir.y).toBeGreaterThan(0);
          expect(distance(r.point, cursor)).toBeLessThanOrEqual(reach * (1 + 1e-9) + 1e-9 * size);
          const k = r.angle / degToRad(step);
          expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
          expect(r.angle).toBe(normalizeAngle(r.angle));
        }),
        PROPERTY_PARAMS,
      );
  });
});
