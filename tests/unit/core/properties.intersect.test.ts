import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  circle,
  distance,
  intersect,
  pointOnCircle,
  segment,
  shapeMagnitude,
  sub,
  tolFor,
  type Vec2,
} from '../../../src/core/geom';
import {
  angle,
  curveArb,
  distanceToShape,
  point,
  PROPERTY_PARAMS,
  PROPERTY_TIMEOUT,
  radius,
  shapeArb,
} from './arbitraries';

describe('intersection properties (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  it('every intersection point lies on both shapes', () => {
    fc.assert(
      fc.property(shapeArb, shapeArb, (a, b) => {
        const tol = tolFor(shapeMagnitude(a), shapeMagnitude(b));
        return intersect(a, b).every((p) => distanceToShape(a, p) <= 2 * tol && distanceToShape(b, p) <= 2 * tol);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('argument order does not matter', () => {
    fc.assert(
      fc.property(curveArb, curveArb, (a, b) => {
        const tol = tolFor(shapeMagnitude(a), shapeMagnitude(b));
        const ab = intersect(a, b);
        const ba = intersect(b, a);
        return ab.length === ba.length && ab.every((p) => ba.some((q) => distance(p, q) <= 4 * tol));
      }),
      PROPERTY_PARAMS,
    );
  });

  it('two segments built to cross at P intersect exactly at P', () => {
    fc.assert(
      fc.property(
        point,
        angle,
        fc.double({ min: 0.05, max: Math.PI - 0.05, noNaN: true }),
        fc.double({ min: 1, max: 1e3, noNaN: true }),
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        (p, a1, between, len, f1, f2) => {
          const through = (dirAngle: number, f: number) => {
            const d = { x: Math.cos(dirAngle) * len, y: Math.sin(dirAngle) * len };
            return segment(sub(p, { x: d.x * f, y: d.y * f }), { x: p.x + d.x * (1 - f), y: p.y + d.y * (1 - f) });
          };
          const hits = intersect(through(a1, f1), through(a1 + between, f2));
          return hits.length === 1 && distance(hits[0] as Vec2, p) <= tolFor(2e4);
        },
      ),
      PROPERTY_PARAMS,
    );
  });

  it('a segment built to cross a circle at P finds P', () => {
    fc.assert(
      fc.property(point, radius, angle, fc.double({ min: 0.1, max: Math.PI - 0.1, noNaN: true }), (c, r, at, cut) => {
        const p = pointOnCircle(c, r, at);
        const dirAngle = at + Math.PI / 2 + cut; // `cut` radians away from the tangent
        const dir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
        // Short enough that the line's second crossing lies outside the segment.
        const half = Math.min(r * Math.sin(cut) * 0.5, 1e3);
        const s = segment({ x: p.x - dir.x * half, y: p.y - dir.y * half }, { x: p.x + dir.x * half, y: p.y + dir.y * half });
        const tol = tolFor(shapeMagnitude(circle(c, r)));
        return intersect(s, circle(c, r)).some((q) => distance(q, p) <= 10 * tol);
      }),
      PROPERTY_PARAMS,
    );
  });
});
