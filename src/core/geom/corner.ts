/**
 * Fillets and chamfers: rounding or cutting off the corner where two straight lines meet.
 *
 * - Two separate lines: each is picked on the part to keep. Both are cut back (or extended)
 *   to where the fillet arc or chamfer line starts. A zero radius or distance just makes
 *   them meet in a sharp corner.
 * - Polyline corners: any vertex between two straight edges.
 *
 * A fillet arc of radius r between lines meeting at angle θ touches each line at r / tan(θ/2)
 * from the corner. Its centre is on the bisector, r / sin(θ/2) from the corner, so the
 * radius to each touching point is square to that line: the arc is tangent at both ends.
 */
import { ccwSweep } from './angle';
import { arc, segment, type Curve, type Segment } from './curves';
import { lineMeeting } from './offset';
import { polyline, sweepToBulge, type Polyline, type PolylineVertex } from './polyline';
import { tolFor } from './tolerance';
import { add, angleOf, cross, distance, dot, magnitude, normalize, perp, scale, sub, type Vec2 } from './vec';

export interface CornerResult {
  readonly first: Segment;
  readonly second: Segment;
  /** The fillet arc or chamfer line, or null for a sharp corner. */
  readonly join: Curve | null;
}

interface Frame {
  /** Where the two lines (extended) meet. */
  readonly corner: Vec2;
  /** Unit directions from the corner along the parts to keep. */
  readonly u1: Vec2;
  readonly u2: Vec2;
  /** The far end of each kept part, and how far along it is from the corner. */
  readonly far1: Vec2;
  readonly far2: Vec2;
  readonly reach1: number;
  readonly reach2: number;
  readonly tol: number;
}

/**
 * How far from the corner a fillet of radius r touches lines in directions u and w:
 * r / tan(θ/2), written as r (1 + cos θ) / sin θ so that a square corner gives exactly r.
 */
function tangentDistance(u: Vec2, w: Vec2, r: number): number {
  return (r * (1 + dot(u, w))) / Math.abs(cross(u, w));
}

function keptSide(s: Segment, pick: Vec2, corner: Vec2, tol: number): { u: Vec2; far: Vec2; reach: number } {
  const along = normalize(sub(s.end, s.start));
  const side = dot(sub(pick, corner), along);
  const u = side >= 0 ? along : scale(along, -1);
  const far = dot(sub(s.start, corner), u) >= dot(sub(s.end, corner), u) ? s.start : s.end;
  const reach = dot(sub(far, corner), u);
  if (reach <= tol) throw new RangeError('pick each line on the part you want to keep');
  return { u, far, reach };
}

function frame(a: Segment, pickA: Vec2, b: Segment, pickB: Vec2): Frame {
  const corner = lineMeeting(a, b);
  if (!corner) throw new RangeError('the lines are parallel, so they never meet in a corner');
  const tol = tolFor(magnitude(a.start), magnitude(a.end), magnitude(b.start), magnitude(b.end), magnitude(corner));
  const k1 = keptSide(a, pickA, corner, tol);
  const k2 = keptSide(b, pickB, corner, tol);
  return {
    corner,
    u1: k1.u,
    u2: k2.u,
    far1: k1.far,
    far2: k2.far,
    reach1: k1.reach,
    reach2: k2.reach,
    tol,
  };
}

/** The segment from its kept far end to `to`, in the segment's original direction. */
function keep(s: Segment, far: Vec2, to: Vec2): Segment {
  return far === s.start ? segment(s.start, to) : segment(to, s.end);
}

/** The shorter arc about `center` from p to q. */
function shortArc(center: Vec2, radius: number, p: Vec2, q: Vec2) {
  const a0 = angleOf(sub(p, center));
  const a1 = angleOf(sub(q, center));
  const sweep = cross(sub(p, center), sub(q, center)) > 0 ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
  return arc(center, radius, a0, sweep);
}

/** Rounds the corner between two lines with an arc of `radius` (0: a sharp corner). */
export function filletLines(a: Segment, pickA: Vec2, b: Segment, pickB: Vec2, radius: number): CornerResult {
  if (!(radius >= 0) || !Number.isFinite(radius)) throw new RangeError('the radius must be 0 or more');
  const f = frame(a, pickA, b, pickB);
  if (radius === 0) return { first: keep(a, f.far1, f.corner), second: keep(b, f.far2, f.corner), join: null };
  const t = tangentDistance(f.u1, f.u2, radius);
  if (t >= f.reach1 - f.tol || t >= f.reach2 - f.tol) throw new RangeError('the radius is too large for these lines');
  const t1 = add(f.corner, scale(f.u1, t));
  const t2 = add(f.corner, scale(f.u2, t));
  // Square off the first line at its touching point, towards the second: tangent by construction.
  const center = add(t1, scale(perp(f.u1), radius * Math.sign(cross(f.u1, f.u2))));
  return { first: keep(a, f.far1, t1), second: keep(b, f.far2, t2), join: shortArc(center, radius, t1, t2) };
}

/** Cuts the corner between two lines: `d1` back along the first, `d2` along the second. */
export function chamferLines(a: Segment, pickA: Vec2, b: Segment, pickB: Vec2, d1: number, d2: number): CornerResult {
  if (!(d1 >= 0) || !(d2 >= 0) || !Number.isFinite(d1) || !Number.isFinite(d2)) {
    throw new RangeError('the chamfer distances must be 0 or more');
  }
  const f = frame(a, pickA, b, pickB);
  if (d1 >= f.reach1 - f.tol || d2 >= f.reach2 - f.tol) throw new RangeError('the distances are too large for these lines');
  const p1 = add(f.corner, scale(f.u1, d1));
  const p2 = add(f.corner, scale(f.u2, d2));
  const join = d1 === 0 && d2 === 0 ? null : segment(p1, p2);
  return { first: keep(a, f.far1, p1), second: keep(b, f.far2, p2), join };
}

interface PolyCorner {
  readonly index: number;
  readonly at: Vec2;
  /** Unit directions from the corner back along the incoming edge and on along the outgoing. */
  readonly back: Vec2;
  readonly on: Vec2;
  /** Angle between the two edges at the corner, in (0, π). */
  readonly angle: number;
  /** +1 for a left (anticlockwise) turn, -1 for a right turn. */
  readonly turn: number;
}

/** The corner at vertex i, or null if it isn't between two straight edges with a real turn. */
export function polylineCorner(pl: Polyline, i: number): PolyCorner | null {
  const n = pl.vertices.length;
  if (!Number.isInteger(i) || i < 0 || i >= n) return null;
  if (!pl.closed && (i === 0 || i === n - 1)) return null;
  const prev = pl.vertices[(i - 1 + n) % n] as PolylineVertex;
  const v = pl.vertices[i] as PolylineVertex;
  const next = pl.vertices[(i + 1) % n] as PolylineVertex;
  if (prev.bulge !== 0 || v.bulge !== 0) return null;
  const inV = sub(v, prev);
  const outV = sub(next, v);
  if ((inV.x === 0 && inV.y === 0) || (outV.x === 0 && outV.y === 0)) return null;
  const back = normalize(scale(inV, -1));
  const on = normalize(outV);
  const c = cross(normalize(inV), on);
  if (Math.abs(c) <= 1e-12) return null; // straight on, or doubling back
  return { index: i, at: { x: v.x, y: v.y }, back, on, angle: Math.atan2(Math.abs(cross(back, on)), dot(back, on)), turn: Math.sign(c) };
}

/** Corners to work on: the ones asked for (each must be a real corner), or every one there is. */
function cornersOf(pl: Polyline, which: readonly number[] | undefined): PolyCorner[] {
  if (which) {
    return which.map((i) => {
      const c = polylineCorner(pl, i);
      if (!c) throw new RangeError(`vertex ${i + 1} is not a corner between two straight edges`);
      return c;
    });
  }
  const all = pl.vertices.map((_, i) => polylineCorner(pl, i)).filter((c): c is PolyCorner => c !== null);
  if (all.length === 0) throw new RangeError('this polyline has no corners between two straight edges');
  return all;
}

/**
 * Rebuilds a polyline with some corners replaced: each replaced corner becomes two vertices
 * `cut` back along its edges, joined by an arc (bulge) or a straight line.
 */
function rebuild(pl: Polyline, corners: readonly PolyCorner[], cut: (c: PolyCorner) => number, bulgeOf: (c: PolyCorner) => number): Polyline {
  const n = pl.vertices.length;
  const byIndex = new Map(corners.map((c) => [c.index, c]));
  const tol = tolFor(...pl.vertices.map(magnitude));
  // Each edge must have room for the cuts at both its ends.
  for (let i = 0; i < (pl.closed ? n : n - 1); i++) {
    const a = pl.vertices[i] as PolylineVertex;
    const b = pl.vertices[(i + 1) % n] as PolylineVertex;
    const ca = byIndex.get(i);
    const cb = byIndex.get((i + 1) % n);
    const need = (ca ? cut(ca) : 0) + (cb ? cut(cb) : 0);
    if (need > distance(a, b) + tol) {
      const at = ca ?? (cb as PolyCorner);
      throw new RangeError(`the size is too large for the edges at the corner (${at.at.x}, ${at.at.y})`);
    }
  }
  const out: PolylineVertex[] = [];
  const push = (v: PolylineVertex) => {
    const prev = out[out.length - 1];
    // A cut that used up a whole edge lands on the previous vertex: keep one, with the new bulge.
    if (prev && distance(prev, v) <= tol) out[out.length - 1] = { x: prev.x, y: prev.y, bulge: v.bulge };
    else out.push(v);
  };
  pl.vertices.forEach((v, i) => {
    const c = byIndex.get(i);
    if (!c) return push(v);
    const t = cut(c);
    const p1 = add(c.at, scale(c.back, t));
    const p2 = add(c.at, scale(c.on, t));
    push({ x: p1.x, y: p1.y, bulge: bulgeOf(c) });
    push({ x: p2.x, y: p2.y, bulge: v.bulge });
  });
  if (pl.closed && out.length > 1 && distance(out[0] as PolylineVertex, out[out.length - 1] as PolylineVertex) <= tol) {
    const lastV = out.pop() as PolylineVertex;
    out[0] = { ...(out[0] as PolylineVertex), bulge: lastV.bulge };
  }
  return polyline(out, pl.closed);
}

/** Rounds polyline corners with arcs of `radius`: the given vertices, or every corner. */
export function filletPolyline(pl: Polyline, radius: number, which?: readonly number[]): Polyline {
  if (!(radius > 0) || !Number.isFinite(radius)) throw new RangeError('the radius must be more than 0');
  const corners = cornersOf(pl, which);
  return rebuild(
    pl,
    corners,
    (c) => tangentDistance(c.back, c.on, radius),
    // The arc turns through π − θ, the same way the corner turned.
    (c) => sweepToBulge(c.turn * (Math.PI - c.angle)),
  );
}

/** Cuts polyline corners off `distance` back along each edge: the given vertices, or every corner. */
export function chamferPolyline(pl: Polyline, distanceBack: number, which?: readonly number[]): Polyline {
  if (!(distanceBack > 0) || !Number.isFinite(distanceBack)) throw new RangeError('the distance must be more than 0');
  return rebuild(pl, cornersOf(pl, which), () => distanceBack, () => 0);
}
