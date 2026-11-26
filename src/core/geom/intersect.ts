import { angleOf, cross, distance, dot, lengthSq, perp, scale, sub, add, type Vec2 } from './vec';
import {
  arcContainsAngle,
  curveEndpoints,
  curveMagnitude,
  distanceToCurve,
  type Arc,
  type Circle,
  type Curve,
  type Segment,
} from './curves';
import { explodePolyline } from './polyline';
import { shapeMagnitude, type Shape } from './shape';
import { tolFor } from './tolerance';

/**
 * Intersection points of two shapes.
 *
 * - Tangent contacts return one point.
 * - Overlapping collinear segments, or arcs on the same circle, return the endpoints of
 *   either curve that lie on the other (identical full circles return none).
 * - `tol` defaults to the kernel tolerance scaled to the shapes' size.
 */
export function intersect(a: Shape, b: Shape, tol?: number): Vec2[] {
  const t = tol ?? tolFor(shapeMagnitude(a), shapeMagnitude(b));
  const as = a.kind === 'polyline' ? explodePolyline(a) : [a];
  const bs = b.kind === 'polyline' ? explodePolyline(b) : [b];
  const points: Vec2[] = [];
  for (const ca of as) {
    for (const cb of bs) points.push(...intersectCurves(ca, cb, t));
  }
  return dedupe(points, t);
}

/** Intersection points of two primitive curves. */
export function intersectCurves(a: Curve, b: Curve, tol?: number): Vec2[] {
  const t = tol ?? tolFor(curveMagnitude(a), curveMagnitude(b));
  if (a.kind === 'segment') {
    if (b.kind === 'segment') return segmentSegment(a, b, t);
    return segmentRound(a, b, t);
  }
  if (b.kind === 'segment') return segmentRound(b, a, t);
  return roundRound(a, b, t);
}

function dedupe(points: readonly Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (!out.some((q) => distance(p, q) <= tol)) out.push(p);
  }
  return out;
}

/** Endpoints of either curve that lie on the other: the result for overlapping curves. */
function overlapEndpoints(a: Curve, b: Curve, tol: number): Vec2[] {
  const points = [
    ...curveEndpoints(a).filter((p) => distanceToCurve(b, p) <= tol),
    ...curveEndpoints(b).filter((p) => distanceToCurve(a, p) <= tol),
  ];
  return dedupe(points, tol);
}

function segmentSegment(a: Segment, b: Segment, tol: number): Vec2[] {
  const d1 = sub(a.end, a.start);
  const d2 = sub(b.end, b.start);
  const len1 = Math.sqrt(lengthSq(d1));
  const len2 = Math.sqrt(lengthSq(d2));

  // Collinear: both ends of b on a's line and both ends of a on b's line.
  const offB0 = Math.abs(cross(d1, sub(b.start, a.start))) / len1;
  const offB1 = Math.abs(cross(d1, sub(b.end, a.start))) / len1;
  const offA0 = Math.abs(cross(d2, sub(a.start, b.start))) / len2;
  const offA1 = Math.abs(cross(d2, sub(a.end, b.start))) / len2;
  if (Math.max(offB0, offB1, offA0, offA1) <= tol) return overlapEndpoints(a, b, tol);

  const denom = cross(d1, d2);
  if (Math.abs(denom) <= 1e-14 * len1 * len2) return []; // parallel, apart

  const w = sub(b.start, a.start);
  const t = cross(w, d2) / denom;
  const u = cross(w, d1) / denom;
  const tA = tol / len1;
  const tB = tol / len2;
  if (t < -tA || t > 1 + tA || u < -tB || u > 1 + tB) return [];
  const p = add(a.start, scale(d1, t));
  // Near-parallel crossings are ill-conditioned along the lines; only report a point that
  // really lies on both segments.
  return distanceToCurve(a, p) <= tol && distanceToCurve(b, p) <= tol ? [p] : [];
}

/** Parameters t where the infinite line p0 + t·d meets the circle; tangent gives one. */
function lineCircleParams(p0: Vec2, d: Vec2, center: Vec2, radius: number, tol: number): number[] {
  const dd = lengthSq(d);
  const tc = dot(sub(center, p0), d) / dd;
  const foot = add(p0, scale(d, tc));
  const h = distance(foot, center);
  if (h > radius + tol) return [];
  if (Math.abs(h - radius) <= tol) return [tc];
  const half = Math.sqrt((radius - h) * (radius + h)) / Math.sqrt(dd);
  return [tc - half, tc + half];
}

function segmentRound(s: Segment, c: Circle | Arc, tol: number): Vec2[] {
  const d = sub(s.end, s.start);
  const tS = tol / Math.sqrt(lengthSq(d));
  const points = lineCircleParams(s.start, d, c.center, c.radius, tol)
    .filter((t) => t >= -tS && t <= 1 + tS)
    .map((t) => add(s.start, scale(d, t)));
  return dedupe(filterOnRound(points, c, tol), tol);
}

function filterOnRound(points: Vec2[], c: Circle | Arc, tol: number): Vec2[] {
  if (c.kind === 'circle') return points;
  const angTol = tol / c.radius;
  return points.filter((p) => arcContainsAngle(c, angleOf(sub(p, c.center)), angTol));
}

/**
 * Height onto side `d` of the triangle with sides d, r1, r2: the half-distance between two
 * circle intersection points. Uses Kahan's stable form of Heron's formula, which stays
 * accurate for the thin triangles of near-tangent circles where r1² − a² cancels badly.
 */
export function triangleHeight(d: number, r1: number, r2: number): number {
  const [a, b, c] = [d, r1, r2].sort((x, y) => y - x) as [number, number, number];
  const p = (a + (b + c)) * (c - (a - b)) * (c + (a - b)) * (a + (b - c));
  return p <= 0 ? 0 : Math.sqrt(p) / (2 * d);
}

function roundRound(a: Circle | Arc, b: Circle | Arc, tol: number): Vec2[] {
  const dv = sub(b.center, a.center);
  const d = Math.sqrt(lengthSq(dv));
  const r1 = a.radius;
  const r2 = b.radius;

  if (d <= tol) {
    // Concentric: either the same circle (overlap) or no contact.
    return Math.abs(r1 - r2) <= tol ? overlapEndpoints(a, b, tol) : [];
  }
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];

  const along = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const unit = scale(dv, 1 / d);
  let points: Vec2[];
  if (Math.abs(d - (r1 + r2)) <= tol || Math.abs(d - Math.abs(r1 - r2)) <= tol) {
    // Tangent: one contact point on the line of centres.
    points = [add(a.center, scale(unit, Math.sign(along) * r1))];
  } else {
    const h = triangleHeight(d, r1, r2);
    const base = add(a.center, scale(unit, along));
    const offset = scale(perp(unit), h);
    points = [add(base, offset), sub(base, offset)];
  }
  return dedupe(filterOnRound(filterOnRound(points, a, tol), b, tol), tol);
}
