/**
 * Random-shape generators and helpers shared by the property tests.
 * Coordinates span ±1e4 drawing units; radii 1e-2 to 1e4.
 */
import fc from 'fast-check';
import {
  arc,
  circle,
  distance,
  distanceToCurve,
  explodePolyline,
  mirror,
  pointAt,
  polyline,
  rotate,
  scaleAbout,
  segment,
  shapeMagnitude,
  TAU,
  tolFor,
  translate,
  type Curve,
  type Polyline,
  type Shape,
  type Transform,
  type Vec2,
} from '../../../src/core/geom';

/** 10,000 cases per property (ROADMAP Phase 1 gate), with a fixed seed so CI is repeatable. */
export const PROPERTY_PARAMS = { numRuns: 10_000, seed: 20261125 } as const;

/** Property suites run 10,000 cases; give them room on slow CI machines. */
export const PROPERTY_TIMEOUT = { timeout: 300_000 } as const;

export const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true });
export const point = fc.record({ x: coord, y: coord });
export const radius = fc.double({ min: 1e-2, max: 1e4, noNaN: true, noDefaultInfinity: true });
export const angle = fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true });
export const sweep = fc
  .tuple(fc.double({ min: 1e-2, max: TAU - 1e-2, noNaN: true }), fc.boolean())
  .map(([s, neg]) => (neg ? -s : s));

export const farApart = (a: Vec2, b: Vec2) => distance(a, b) > 1e-2;

export const segmentArb = fc
  .tuple(point, point)
  .filter(([a, b]) => farApart(a, b))
  .map(([a, b]) => segment(a, b));
export const circleArb = fc.tuple(point, radius).map(([c, r]) => circle(c, r));
export const arcArb = fc.tuple(point, radius, angle, sweep).map(([c, r, s, w]) => arc(c, r, s, w));
export const curveArb: fc.Arbitrary<Curve> = fc.oneof(segmentArb, circleArb, arcArb);

const bulge = fc.oneof(
  fc.constant(0),
  fc.double({ min: -3, max: 3, noNaN: true }).filter((b) => Math.abs(b) > 1e-3),
);

type RawVertex = { x: number; y: number; bulge: number };

/**
 * Moves any vertex that nearly repeats its predecessor (or, when closed, the first vertex)
 * so every edge is a real edge. Built by construction rather than by rejection, which is
 * far faster when the generator favours edge values such as 0.
 */
function separate(vs: RawVertex[], closed: boolean): RawVertex[] {
  const out: RawVertex[] = [];
  for (const v of vs) {
    const prev = out[out.length - 1];
    out.push(prev && !farApart(v, prev) ? { ...v, x: prev.x + 1, y: prev.y + 0.5 } : v);
  }
  const first = out[0] as RawVertex;
  const last = out[out.length - 1] as RawVertex;
  if (closed && out.length > 1 && !farApart(first, last)) {
    out[out.length - 1] = { ...last, x: last.x - 0.75, y: last.y + 1.25 };
  }
  return out;
}

const rawVertices = (minLength: number) =>
  fc.array(fc.record({ x: coord, y: coord, bulge }), { minLength, maxLength: 6 });

export const polylineArb: fc.Arbitrary<Polyline> = fc
  .tuple(rawVertices(2), fc.boolean())
  .map(([vs, closed]) => polyline(separate(vs, closed), closed));

export const closedPolylineArb: fc.Arbitrary<Polyline> = rawVertices(3).map((vs) => polyline(separate(vs, true), true));

export const shapeArb: fc.Arbitrary<Shape> = fc.oneof(curveArb, polylineArb);

export const mirrorArb: fc.Arbitrary<Transform> = fc
  .tuple(point, point)
  .filter(([a, b]) => farApart(a, b))
  .map(([a, b]) => mirror(a, b));

export const transformArb: fc.Arbitrary<Transform> = fc.oneof(
  fc.tuple(coord, coord).map(([dx, dy]) => translate(dx, dy)),
  fc.tuple(point, angle).map(([c, a]) => rotate(c, a)),
  fc.tuple(point, fc.double({ min: 0.01, max: 100, noNaN: true })).map(([c, k]) => scaleAbout(c, k)),
  mirrorArb,
);

const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

export function curvesOf(s: Shape): Curve[] {
  return s.kind === 'polyline' ? explodePolyline(s) : [s];
}

export function samplePoints(s: Shape): Vec2[] {
  return curvesOf(s).flatMap((c) => SAMPLES.map((t) => pointAt(c, t)));
}

export function distanceToShape(s: Shape, p: Vec2): number {
  return Math.min(...curvesOf(s).map((c) => distanceToCurve(c, p)));
}

/** Two shapes describe the same geometry if their sample points coincide. */
export function sameGeometry(a: Shape, b: Shape, tol: number): boolean {
  const pa = samplePoints(a);
  const pb = samplePoints(b);
  return pa.length === pb.length && pa.every((p, i) => distance(p, pb[i] as Vec2) <= tol);
}

/** Tolerance after a transform that can move geometry up to ~4e4 from the origin. */
export const tolAfter = (...shapes: Shape[]) => tolFor(4e4, ...shapes.map(shapeMagnitude));
