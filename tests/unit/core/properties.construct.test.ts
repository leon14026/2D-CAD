import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arcEndPoint,
  arcStartPoint,
  arcThrough,
  arcToBulge,
  bulgeToArc,
  closestPoint,
  convertLength,
  curveLength,
  distance,
  distanceToCurve,
  LENGTH_UNITS,
  normalizeAngle,
  pointAt,
  pointOnCircle,
  shapeMagnitude,
  TAU,
  tolFor,
  type Vec2,
} from '../../../src/core/geom';
import {
  angle,
  curveArb,
  farApart,
  point,
  PROPERTY_PARAMS,
  PROPERTY_TIMEOUT,
  radius,
  shapeArb,
} from './arbitraries';

describe('construction properties (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  it('arcThrough starts at p1, passes through p2 and ends at p3', () => {
    fc.assert(
      fc.property(point, radius, angle, angle, angle, (c, r, a1, a2, a3) => {
        const [p1, p2, p3] = [a1, a2, a3].map((a) => pointOnCircle(c, r, a)) as [Vec2, Vec2, Vec2];
        if (Math.min(distance(p1, p2), distance(p2, p3), distance(p1, p3)) < 1e-3 * r) return true;
        const a = arcThrough(p1, p2, p3);
        if (!a) return false;
        // A circle fitted to three close points is ill-conditioned; allow for it.
        const tol = 1e-6 * Math.max(1, shapeMagnitude(a));
        return distance(arcStartPoint(a), p1) <= tol && distance(arcEndPoint(a), p3) <= tol && distanceToCurve(a, p2) <= tol;
      }),
      PROPERTY_PARAMS,
    );
  });

  it('bulged edges end on their vertices and round-trip their bulge', () => {
    fc.assert(
      fc.property(point, point, fc.double({ min: -50, max: 50, noNaN: true }), (p1, p2, b) => {
        if (!farApart(p1, p2) || Math.abs(b) < 1e-3) return true;
        const a = bulgeToArc(p1, p2, b);
        const tol = 1e-9 * Math.max(1, shapeMagnitude(a));
        return (
          distance(arcStartPoint(a), p1) <= tol &&
          distance(arcEndPoint(a), p2) <= tol &&
          Math.abs(arcToBulge(a) - b) <= 1e-9 * Math.max(1, b * b)
        );
      }),
      PROPERTY_PARAMS,
    );
  });

  it('closestPoint is on the curve and no sample point is closer', () => {
    fc.assert(
      fc.property(curveArb, point, (c, p) => {
        const q = closestPoint(c, p);
        const tol = tolFor(shapeMagnitude(c), p.x, p.y);
        const best = distance(p, q);
        const samples = Array.from({ length: 33 }, (_, i) => pointAt(c, i / 32));
        return distanceToCurve(c, q) <= tol && samples.every((s) => best <= distance(p, s) + tol);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('curve length agrees with a fine chord approximation', () => {
    fc.assert(
      fc.property(curveArb, (c) => {
        const n = 2048;
        let approx = 0;
        for (let i = 0; i < n; i++) approx += distance(pointAt(c, i / n), pointAt(c, (i + 1) / n));
        const exact = curveLength(c);
        const tol = tolFor(shapeMagnitude(c));
        return approx <= exact + tol && exact - approx <= exact * 1e-5 + tol;
      }),
      PROPERTY_PARAMS,
    );
  });

  it('normalizeAngle lands in [0, 2π) and is congruent', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), (a) => {
        const n = normalizeAngle(a);
        const k = Math.round((a - n) / TAU);
        return n >= 0 && n < TAU && Math.abs(a - n - k * TAU) <= 1e-12 * Math.max(1, Math.abs(a));
      }),
      PROPERTY_PARAMS,
    );
  });

  it('unit conversion round-trips', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.constantFrom(...LENGTH_UNITS),
        fc.constantFrom(...LENGTH_UNITS),
        (v, a, b) => Math.abs(convertLength(convertLength(v, a, b), b, a) - v) <= 1e-12 * Math.max(1, Math.abs(v)),
      ),
      PROPERTY_PARAMS,
    );
  });

  it('the generators produce every shape kind', () => {
    const kinds = new Set(fc.sample(shapeArb, { numRuns: 500, seed: 1 }).map((s) => s.kind));
    expect([...kinds].sort()).toEqual(['arc', 'circle', 'polyline', 'segment']);
  });
});
