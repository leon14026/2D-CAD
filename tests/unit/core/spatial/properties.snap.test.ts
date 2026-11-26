import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cross,
  distance,
  dot,
  perpendicularFeet,
  shapeMagnitude,
  sub,
  tangentPoints,
  tolFor,
  type Curve,
} from '../../../../src/core/geom';
import { findSnap, SNAP_KINDS, snapPoints, type SingleSnapKind } from '../../../../src/core/spatial';
import { arcArb, circleArb, curveArb, distanceToShape, point, PROPERTY_PARAMS, PROPERTY_TIMEOUT, shapeArb } from '../arbitraries';
import { docOf } from '../docs';

const SINGLE = SNAP_KINDS.filter((k): k is SingleSnapKind => k !== 'intersection' && k !== 'center');
const roundArb: fc.Arbitrary<Curve> = fc.oneof(circleArb, arcArb);

describe('snap properties (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  it('every snap point except a centre lies on its shape', () => {
    fc.assert(
      fc.property(shapeArb, fc.constantFrom(...SINGLE), point, point, (s, kind, cursor, from) => {
        const tol = 1e-9 * Math.max(1, shapeMagnitude(s), Math.abs(cursor.x), Math.abs(cursor.y), Math.abs(from.x), Math.abs(from.y)) * 4;
        for (const p of snapPoints(s, kind, cursor, from)) expect(distanceToShape(s, p)).toBeLessThanOrEqual(tol);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('tangent points: the radius there is at right angles to the line from the start point', () => {
    fc.assert(
      fc.property(roundArb, point, (c, from) => {
        if (c.kind === 'segment') return;
        const scale = Math.max(1, distance(from, c.center), c.radius);
        for (const t of tangentPoints(c, from)) {
          const radial = sub(t, c.center);
          const along = sub(from, t);
          expect(Math.abs(dot(radial, along)) / (c.radius * Math.max(distance(from, t), 1e-300))).toBeLessThanOrEqual(1e-6 * (scale / c.radius));
        }
      }),
      PROPERTY_PARAMS,
    );
  });

  it('perpendicular feet: the line from the start point meets the curve square on', () => {
    fc.assert(
      fc.property(curveArb, point, (c, from) => {
        const tol = tolFor(shapeMagnitude(c), from.x, from.y) * 1e3;
        for (const f of perpendicularFeet(c, from)) {
          const v = sub(from, f);
          if (c.kind === 'segment') {
            const d = sub(c.end, c.start);
            expect(Math.abs(dot(v, d)) / Math.hypot(d.x, d.y)).toBeLessThanOrEqual(tol);
          } else {
            // The foot, the centre and the start point are in line.
            const r = sub(f, c.center);
            expect(Math.abs(cross(r, v)) / c.radius).toBeLessThanOrEqual(tol);
          }
        }
      }),
      PROPERTY_PARAMS,
    );
  });

  it('a snap is always within the radius of the cursor, and on the entities it names', () => {
    fc.assert(
      fc.property(shapeArb, shapeArb, point, fc.double({ min: 0.01, max: 500, noNaN: true }), (a, b, cursor, radius) => {
        const { doc, ids } = docOf([a, b]);
        const hit = findSnap(doc, cursor, radius, { kinds: new Set(SNAP_KINDS), from: null });
        if (!hit) return;
        expect(distance(hit.point, cursor)).toBeLessThanOrEqual(radius);
        const tol = 1e-9 * Math.max(1, shapeMagnitude(a), shapeMagnitude(b), Math.abs(cursor.x), Math.abs(cursor.y)) * 1e3;
        for (const id of hit.ids) {
          const s = id === ids[0] ? a : b;
          if (hit.kind !== 'center') expect(distanceToShape(s, hit.point)).toBeLessThanOrEqual(tol);
        }
      }),
      PROPERTY_PARAMS,
    );
  });
});
