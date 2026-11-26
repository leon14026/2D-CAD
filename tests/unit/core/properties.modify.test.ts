/**
 * Phase 5 gate properties (10,000 cases each):
 * - offsets lie exactly at the set distance;
 * - trimmed and extended ends lie on the boundary edge;
 * - fillets are tangent at both ends.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arc,
  bulgeToArc,
  circle,
  cosSin,
  cross,
  distance,
  dot,
  explodePolyline,
  extendShape,
  filletLines,
  filletPolyline,
  normalize,
  offsetShape,
  pointAt,
  polyline,
  segment,
  shapeMagnitude,
  sub,
  TAU,
  tolFor,
  trimShape,
  type Arc,
  type Curve,
  type Polyline,
  type Shape,
  type Vec2,
} from '../../../src/core/geom';
import { arcArb, circleArb, distanceToShape, point, PROPERTY_PARAMS, PROPERTY_TIMEOUT, segmentArb } from './arbitraries';

const SAMPLES = [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1];

/** Distance from p to the infinite line or full circle the curve lies on. */
function supportDistance(c: Curve, p: Vec2): number {
  if (c.kind === 'segment') {
    const d = sub(c.end, c.start);
    return Math.abs(cross(d, sub(p, c.start))) / Math.hypot(d.x, d.y);
  }
  return Math.abs(distance(p, c.center) - c.radius);
}

/**
 * A convex polygon, anticlockwise, built by construction: 4 to 12 corners on a circle, the
 * gaps between them never more than 0.8 of a half turn.
 */
const convexArb: fc.Arbitrary<Polyline> = fc
  .tuple(point, fc.double({ min: 1, max: 1000, noNaN: true }), fc.double({ min: 0, max: TAU, noNaN: true }), fc.array(fc.double({ min: 1, max: 2, noNaN: true }), { minLength: 4, maxLength: 12 }))
  .map(([c, r, turn, weights]) => {
    const total = weights.reduce((a, b) => a + b);
    let a = turn;
    return polyline(
      weights.map((w) => {
        const p = cosSin(a);
        a += (w / total) * TAU;
        return { x: c.x + r * p.x, y: c.y + r * p.y };
      }),
      true,
    );
  });

/** The largest inward offset that keeps every edge: each edge shortens by d (cot(α/2) + cot(β/2)). */
function inwardLimit(pl: Polyline): number {
  const v = pl.vertices;
  const n = v.length;
  const cotHalf = (i: number) => {
    const back = normalize(sub(v[(i - 1 + n) % n] as Vec2, v[i] as Vec2));
    const on = normalize(sub(v[(i + 1) % n] as Vec2, v[i] as Vec2));
    return (1 + dot(back, on)) / Math.abs(cross(back, on));
  };
  let limit = Infinity;
  for (let i = 0; i < n; i++) limit = Math.min(limit, distance(v[i] as Vec2, v[(i + 1) % n] as Vec2) / (cotHalf(i) + cotHalf((i + 1) % n)));
  return limit;
}

describe('offset lies exactly at the set distance', PROPERTY_TIMEOUT, () => {
  it('lines, circles and arcs: every point of the offset', () => {
    fc.assert(
      fc.property(fc.oneof(segmentArb, circleArb, arcArb), fc.double({ min: -1, max: 1, noNaN: true }), (c, k) => {
        // Keep circles and arcs from shrinking to nothing.
        const d = c.kind === 'segment' ? k * 1000 : k * 0.99 * c.radius;
        if (d === 0) return;
        const off = offsetShape(c, d) as Curve;
        const tol = tolFor(shapeMagnitude(c), d) * 8;
        for (const t of SAMPLES) expect(Math.abs(supportDistance(c, pointAt(off, t)) - Math.abs(d))).toBeLessThanOrEqual(tol);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('convex polygons, inwards and outwards: each offset edge is the distance from its own edge, and the offset never comes closer', () => {
    fc.assert(
      fc.property(convexArb, fc.double({ min: 0.001, max: 0.95, noNaN: true }), fc.boolean(), (pl, k, outwards) => {
        const d = outwards ? k * 500 : k * inwardLimit(pl);
        const off = offsetShape(pl, outwards ? -d : d) as Polyline;
        const tol = tolFor(shapeMagnitude(pl), d) * 64;
        const original = explodePolyline(pl);
        const edges = explodePolyline(off);
        expect(off.closed).toBe(true);
        expect(edges).toHaveLength(original.length);
        edges.forEach((e, i) => {
          for (const t of SAMPLES) {
            const p = pointAt(e, t);
            expect(Math.abs(supportDistance(original[i] as Curve, p) - d)).toBeLessThanOrEqual(tol);
            expect(distanceToShape(pl, p)).toBeGreaterThanOrEqual(d - tol);
          }
        });
      }),
      PROPERTY_PARAMS,
    );
  });
});

/** Shapes that can cross a target near the origin: lines, circles and arcs of moderate size. */
const near = fc.record({ x: fc.double({ min: -100, max: 100, noNaN: true }), y: fc.double({ min: -100, max: 100, noNaN: true }) });
const smallRadius = fc.double({ min: 1, max: 100, noNaN: true });
const cutterArb: fc.Arbitrary<Shape> = fc.oneof(
  fc.tuple(near, near).filter(([a, b]) => distance(a, b) > 1).map(([a, b]) => segment(a, b)),
  fc.tuple(near, smallRadius).map(([c, r]) => circle(c, r)),
  fc.tuple(near, smallRadius, fc.double({ min: 0, max: TAU, noNaN: true }), fc.double({ min: 0.1, max: 6, noNaN: true })).map(([c, r, s, w]) => arc(c, r, s, w)),
);
const targetArb: fc.Arbitrary<Shape> = fc.oneof(
  cutterArb,
  fc.array(near, { minLength: 2, maxLength: 5 }).map((vs) => polyline(vs.map((v, i) => ({ x: v.x + i * 3, y: v.y })), false)),
);

function onSome(p: Vec2, shapes: readonly Shape[], tol: number): boolean {
  return shapes.some((s) => distanceToShape(s, p) <= tol);
}

function ends(s: Shape): Vec2[] {
  if (s.kind === 'segment') return [s.start, s.end];
  if (s.kind === 'arc') return [pointAt(s, 0), pointAt(s, 1)];
  if (s.kind === 'polyline') return [s.vertices[0] as Vec2, s.vertices[s.vertices.length - 1] as Vec2];
  return [];
}

describe('trimmed and extended ends lie on the boundary edge', PROPERTY_TIMEOUT, () => {
  it('trim: every new end is on a cutting edge; kept pieces lie on the original', () => {
    fc.assert(
      fc.property(targetArb, fc.array(cutterArb, { minLength: 1, maxLength: 3 }), near, (target, cutters, pick) => {
        const r = trimShape(target, cutters, pick);
        if (!r.ok) return;
        const tol = tolFor(shapeMagnitude(target), ...cutters.map(shapeMagnitude)) * 64;
        const oldEnds = ends(target);
        for (const piece of r.pieces) {
          for (const e of ends(piece)) {
            if (!oldEnds.some((o) => distance(o, e) <= tol)) expect(onSome(e, cutters, tol)).toBe(true);
          }
          for (const c of explodeAll(piece)) for (const t of SAMPLES) expect(distanceToShape(target, pointAt(c, t))).toBeLessThanOrEqual(tol);
        }
      }),
      PROPERTY_PARAMS,
    );
  });

  it('extend: the new end is on a boundary, and on the line or circle the end was following', () => {
    fc.assert(
      fc.property(fc.oneof(segmentArbNear(), arcArbNear()), fc.array(cutterArb, { minLength: 1, maxLength: 3 }), near, (target, boundaries, pick) => {
        const r = extendShape(target, boundaries, pick);
        if (!r.ok) return;
        const tol = tolFor(shapeMagnitude(target), ...boundaries.map(shapeMagnitude)) * 64;
        // The end that moved: the one furthest from where the target's ends were.
        const moved = (e: Vec2) => Math.min(...ends(target).map((o) => distance(o, e)));
        const [a, b] = ends(r.shape) as [Vec2, Vec2];
        const end = moved(a) >= moved(b) ? a : b;
        expect(onSome(end, boundaries, tol)).toBe(true);
        expect(supportDistance(target as Curve, end)).toBeLessThanOrEqual(tol);
      }),
      PROPERTY_PARAMS,
    );
  });
});

function explodeAll(s: Shape): Curve[] {
  return s.kind === 'polyline' ? explodePolyline(s) : [s];
}

function segmentArbNear(): fc.Arbitrary<Shape> {
  return fc.tuple(near, near).filter(([a, b]) => distance(a, b) > 1).map(([a, b]) => segment(a, b));
}

function arcArbNear(): fc.Arbitrary<Shape> {
  return fc.tuple(near, smallRadius, fc.double({ min: 0, max: TAU, noNaN: true }), fc.double({ min: 0.1, max: 5, noNaN: true }), fc.boolean()).map(([c, r, s, w, cw]) => arc(c, r, s, cw ? -w : w));
}

describe('fillets are tangent at both ends', PROPERTY_TIMEOUT, () => {
  it('two lines: the arc meets each line at its touching point, square to it, at the radius', () => {
    fc.assert(
      fc.property(point, fc.double({ min: 0, max: TAU, noNaN: true }), fc.double({ min: 0.05, max: Math.PI - 0.05, noNaN: true }), fc.double({ min: 1, max: 1000, noNaN: true }), fc.double({ min: 0.001, max: 0.9, noNaN: true }), (corner, turn, opening, length, k) => {
        // Two lines leaving `corner` at an angle `opening` apart, each `length` long.
        const u1 = cosSin(turn);
        const u2 = cosSin(turn + opening);
        const a = segment({ x: corner.x + u1.x * length, y: corner.y + u1.y * length }, { x: corner.x + u1.x * length * 0.01, y: corner.y + u1.y * length * 0.01 });
        const b = segment({ x: corner.x + u2.x * length * 0.01, y: corner.y + u2.y * length * 0.01 }, { x: corner.x + u2.x * length, y: corner.y + u2.y * length });
        // The largest radius whose touching points fit on the lines.
        const maxR = (length * 0.98 * Math.abs(cross(u1, u2))) / (1 + dot(u1, u2));
        const r = k * maxR;
        const f = filletLines(a, a.start, b, b.end, r);
        const fillet = f.join as Arc;
        const tol = tolFor(shapeMagnitude(a), shapeMagnitude(b)) * 1e3;
        const t1 = f.first.end;
        const t2 = f.second.start;
        expect(Math.abs(distance(fillet.center, t1) - r)).toBeLessThanOrEqual(tol);
        expect(Math.abs(distance(fillet.center, t2) - r)).toBeLessThanOrEqual(tol);
        expect(Math.abs(dot(sub(fillet.center, t1), u1))).toBeLessThanOrEqual(tol);
        expect(Math.abs(dot(sub(fillet.center, t2), u2))).toBeLessThanOrEqual(tol);
        expect(distance(pointAt(fillet, 0), t1)).toBeLessThanOrEqual(tol);
        expect(distance(pointAt(fillet, 1), t2)).toBeLessThanOrEqual(tol);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('polyline corners: each fillet arc is the radius from both its neighbouring edges', () => {
    fc.assert(
      fc.property(convexArb, fc.double({ min: 0.001, max: 0.95, noNaN: true }), (pl, k) => {
        // Every corner's touching points must fit: radius well inside the inward limit.
        const r = k * inwardLimit(pl);
        const f = filletPolyline(pl, r);
        const tol = tolFor(shapeMagnitude(pl)) * 1e3;
        const n = f.vertices.length;
        f.vertices.forEach((v, i) => {
          if (v.bulge === 0) return;
          const next = f.vertices[(i + 1) % n] as Vec2;
          const fillet = bulgeToArc(v, next, v.bulge);
          expect(Math.abs(fillet.radius - r)).toBeLessThanOrEqual(tol);
          const before = f.vertices[(i - 1 + n) % n] as Vec2;
          const after = f.vertices[(i + 2) % n] as Vec2;
          expect(Math.abs(supportDistance(segment(before, v), fillet.center) - r)).toBeLessThanOrEqual(tol);
          expect(Math.abs(supportDistance(segment(next, after), fillet.center) - r)).toBeLessThanOrEqual(tol);
        });
      }),
      PROPERTY_PARAMS,
    );
  });
});
