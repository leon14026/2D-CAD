/**
 * Offset: a copy of a shape at a fixed distance to one side.
 *
 * Sides follow the direction of travel: positive distances go to the left. A circle counts as
 * anticlockwise, so its left is its inside.
 *
 * - Lines move along their left normal; circles and arcs change radius about the same centre.
 *   Every point of the result is exactly the distance from the original.
 * - Polylines offset edge by edge. Neighbouring offset edges are extended or cut back to meet,
 *   as a mitre. Where they can't meet (a line leaving an arc, or a very sharp turn), a round
 *   join about the original corner fills the gap; it is also at the set distance.
 * - An offset that would turn an edge inside out, or shrink an arc to nothing, is refused.
 */
import { ccwSweep } from './angle';
import { arc, arcEndPoint, arcStartPoint, circle, distanceToCurve, segment, type Arc, type Curve } from './curves';
import { pathOf } from './cut';
import { intersectCurves } from './intersect';
import { polyline, sweepToBulge, type Polyline } from './polyline';
import { shapeCurves, shapeMagnitude, type Shape } from './shape';
import { tolFor } from './tolerance';
import { add, angleOf, cross, distance, dot, normalize, perp, scale, sub, type Vec2 } from './vec';

export const OFFSET_TOO_LARGE = 'the distance is too large for this shape: part of it would turn inside out';

/** +1 if `p` is to the left of the shape's direction (inside a circle), -1 to the right, 0 on it. */
export function sideOf(s: Shape, p: Vec2): number {
  let nearest = shapeCurves(s)[0] as Curve;
  let best = Infinity;
  for (const c of shapeCurves(s)) {
    const d = distanceToCurve(c, p);
    if (d < best) {
      best = d;
      nearest = c;
    }
  }
  switch (nearest.kind) {
    case 'segment':
      return Math.sign(cross(sub(nearest.end, nearest.start), sub(p, nearest.start)));
    case 'circle':
      return Math.sign(nearest.radius - distance(p, nearest.center));
    case 'arc':
      return Math.sign(nearest.radius - distance(p, nearest.center)) * Math.sign(nearest.sweep);
  }
}

/** One curve offset by `d` to its left. Throws RangeError if a circle or arc would vanish. */
export function offsetCurve(c: Curve, d: number): Curve {
  switch (c.kind) {
    case 'segment': {
      const n = scale(perp(normalize(sub(c.end, c.start))), d);
      return segment(add(c.start, n), add(c.end, n));
    }
    case 'circle':
      if (!(c.radius - d > 0)) throw new RangeError(OFFSET_TOO_LARGE);
      return circle(c.center, c.radius - d);
    case 'arc': {
      const r = c.radius - Math.sign(c.sweep) * d;
      if (!(r > 0)) throw new RangeError(OFFSET_TOO_LARGE);
      return arc(c.center, r, c.start, c.sweep);
    }
  }
}

/** The shape offset by `d` to its left (negative: to its right). */
export function offsetShape(s: Shape, d: number): Shape {
  if (!Number.isFinite(d)) throw new RangeError('the offset distance must be finite');
  return s.kind === 'polyline' ? offsetPolyline(s, d) : offsetCurve(s, d);
}

/** The shape offset by `distance` towards the side `toward` is on. */
export function offsetToward(s: Shape, distance: number, toward: Vec2): Shape {
  const side = sideOf(s, toward);
  if (side === 0) throw new RangeError('the side point lies on the shape; pick a point to one side of it');
  return offsetShape(s, side * distance);
}

function startOf(c: Curve): Vec2 {
  return c.kind === 'segment' ? c.start : arcStartPoint(c as Arc);
}

function endOf(c: Curve): Vec2 {
  return c.kind === 'segment' ? c.end : arcEndPoint(c as Arc);
}

/**
 * Where two lines meet, if they aren't parallel. A horizontal line keeps its exact y and a
 * vertical one its exact x, so square corners come out exact.
 */
export function lineMeeting(a: Curve & { kind: 'segment' }, b: Curve & { kind: 'segment' }): Vec2 | null {
  const da = sub(a.end, a.start);
  const db = sub(b.end, b.start);
  const denom = cross(da, db);
  if (Math.abs(denom) <= 1e-12 * Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y)) return null;
  const t = cross(sub(b.start, a.start), db) / denom;
  let x = a.start.x + da.x * t;
  let y = a.start.y + da.y * t;
  if (da.y === 0) y = a.start.y;
  if (da.x === 0) x = a.start.x;
  if (db.y === 0) y = b.start.y;
  if (db.x === 0) x = b.start.x;
  return { x, y };
}

/** Where the lines or circles two curves lie on meet. */
function meetings(a: Curve, b: Curve, size: number, tol: number): Vec2[] {
  if (a.kind === 'segment' && b.kind === 'segment') {
    const p = lineMeeting(a, b);
    return p ? [p] : [];
  }
  return intersectCurves(support(a, 4 * size + 1), support(b, 4 * size + 1), tol);
}

/** The full line or circle a curve lies on, long enough to meet its neighbours. */
function support(c: Curve, reach: number): Curve {
  if (c.kind !== 'segment') return circle(c.center, c.radius);
  const u = normalize(sub(c.end, c.start));
  return segment(sub(c.start, scale(u, reach)), add(c.end, scale(u, reach)));
}

/** The same curve with new end points, keeping its centre and direction; null if it turned over. */
function reshaped(c: Curve, from: Vec2, to: Vec2): Curve | null {
  if (c.kind === 'segment') {
    return dot(sub(to, from), sub(c.end, c.start)) > 0 ? segment(from, to) : null;
  }
  const a = c as Arc;
  const a0 = angleOf(sub(from, a.center));
  const a1 = angleOf(sub(to, a.center));
  const sweep = a.sweep > 0 ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
  // A sweep that jumped by more than half a turn means the ends crossed over.
  if (sweep === 0 || Math.abs(sweep) > Math.abs(a.sweep) + Math.PI) return null;
  return arc(a.center, a.radius, a0, sweep);
}

function offsetPolyline(pl: Polyline, d: number): Polyline {
  const path = pathOf(pl);
  const n = path.curves.length;
  const size = shapeMagnitude(pl) + Math.abs(d);
  const tol = tolFor(size);
  const off = path.curves.map((c) => offsetCurve(c, d));
  const starts = off.map(startOf);
  const ends = off.map(endOf);
  const roundJoins: (Arc | null)[] = off.map(() => null);
  const joins = path.closed ? n : n - 1;
  // A mitre further than this from its corner is replaced by a round join.
  const mitreLimit = 100 * Math.abs(d) + tol;

  for (let k = 0; k < joins; k++) {
    const next = (k + 1) % n;
    const corner = path.points[next % path.points.length] as Vec2;
    const end = ends[k] as Vec2;
    const start = starts[next] as Vec2;
    if (distance(end, start) <= tol) {
      starts[next] = end;
      continue;
    }
    let meet: Vec2 | null = null;
    for (const p of meetings(off[k] as Curve, off[next] as Curve, size, tol)) {
      if (distance(p, corner) <= mitreLimit && (!meet || distance(p, corner) < distance(meet, corner))) meet = p;
    }
    if (meet) {
      ends[k] = meet;
      starts[next] = meet;
    } else {
      const ccw = cross(sub(end, corner), sub(start, corner)) > 0;
      const a0 = angleOf(sub(end, corner));
      const a1 = angleOf(sub(start, corner));
      roundJoins[k] = arc(corner, Math.abs(d), a0, ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0));
    }
  }

  const vertices: { x: number; y: number; bulge: number }[] = [];
  for (let k = 0; k < n; k++) {
    const c = reshaped(off[k] as Curve, starts[k] as Vec2, ends[k] as Vec2);
    if (!c) throw new RangeError(OFFSET_TOO_LARGE);
    const s = starts[k] as Vec2;
    vertices.push({ x: s.x, y: s.y, bulge: c.kind === 'arc' ? sweepToBulge(c.sweep) : 0 });
    const join = roundJoins[k];
    if (join) {
      const e = ends[k] as Vec2;
      vertices.push({ x: e.x, y: e.y, bulge: sweepToBulge(join.sweep) });
    }
  }
  if (!path.closed) {
    const e = ends[n - 1] as Vec2;
    vertices.push({ x: e.x, y: e.y, bulge: 0 });
  }
  return polyline(vertices, path.closed);
}
