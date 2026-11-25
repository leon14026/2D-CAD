import { boundsOfPoints, unionBounds, type Bounds } from './bounds';
import {
  arc,
  curveBounds,
  curveLength,
  segment,
  type Arc,
  type Curve,
} from './curves';
import { angleOf, distance, isFiniteVec, magnitude, midpoint, perp, scale, sub, add, type Vec2 } from './vec';

/**
 * A polyline vertex. `bulge` describes the edge from this vertex to the next:
 * 0 is straight; otherwise bulge = tan(sweep / 4), positive for a counter-clockwise arc
 * (the same convention as DXF LWPOLYLINE).
 */
export interface PolylineVertex {
  readonly x: number;
  readonly y: number;
  readonly bulge: number;
}

export interface Polyline {
  readonly kind: 'polyline';
  readonly vertices: readonly PolylineVertex[];
  readonly closed: boolean;
}

export interface VertexInput {
  readonly x: number;
  readonly y: number;
  readonly bulge?: number;
}

export function polyline(vertices: readonly VertexInput[], closed = false): Polyline {
  if (vertices.length < 2) throw new RangeError('a polyline needs at least two vertices');
  const out: PolylineVertex[] = vertices.map((v, i) => {
    const bulge = v.bulge ?? 0;
    if (!isFiniteVec(v) || !Number.isFinite(bulge)) {
      throw new RangeError(`polyline vertex ${i} must have finite coordinates and bulge`);
    }
    return { x: v.x, y: v.y, bulge };
  });
  return { kind: 'polyline', vertices: out, closed };
}

/** The arc for a bulged edge from p1 to p2. Throws if bulge is 0 or the points coincide. */
export function bulgeToArc(p1: Vec2, p2: Vec2, bulge: number): Arc {
  if (bulge === 0) throw new RangeError('a zero bulge is a straight edge, not an arc');
  const chord = sub(p2, p1);
  const c = Math.hypot(chord.x, chord.y);
  if (c === 0) throw new RangeError('a bulged edge needs two distinct points');
  const sweep = 4 * Math.atan(bulge);
  // Centre sits on the chord's perpendicular bisector; see ROADMAP Phase 1 notes.
  const center = add(midpoint(p1, p2), scale(perp(chord), (1 - bulge * bulge) / (4 * bulge)));
  const radius = (c * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return arc(center, radius, angleOf(sub(p1, center)), sweep);
}

/** Bulge value for an arc used as a polyline edge from its start point to its end point. */
export function arcToBulge(a: Arc): number {
  return Math.tan(a.sweep / 4);
}

/** Number of edges: n - 1 for an open polyline, n for a closed one. */
export function edgeCount(pl: Polyline): number {
  return pl.closed ? pl.vertices.length : pl.vertices.length - 1;
}

/**
 * Splits a polyline into its edges as segments and arcs, in order.
 * Zero-length edges (repeated vertices) are skipped.
 */
export function explodePolyline(pl: Polyline): Curve[] {
  const n = pl.vertices.length;
  const out: Curve[] = [];
  for (let i = 0; i < edgeCount(pl); i++) {
    const a = pl.vertices[i] as PolylineVertex;
    const b = pl.vertices[(i + 1) % n] as PolylineVertex;
    if (a.x === b.x && a.y === b.y) continue;
    out.push(a.bulge === 0 ? segment(a, b) : bulgeToArc(a, b, a.bulge));
  }
  return out;
}

export function polylineLength(pl: Polyline): number {
  return explodePolyline(pl).reduce((sum, c) => sum + curveLength(c), 0);
}

/**
 * Signed enclosed area of a closed polyline: positive when it runs counter-clockwise.
 * Bulged edges add or remove their circular segment.
 */
export function polylineArea(pl: Polyline): number {
  if (!pl.closed) throw new RangeError('area is only defined for a closed polyline');
  const n = pl.vertices.length;
  let twiceArea = 0;
  let arcArea = 0;
  const o = pl.vertices[0] as PolylineVertex; // relative coordinates for precision
  for (let i = 0; i < n; i++) {
    const a = pl.vertices[i] as PolylineVertex;
    const b = pl.vertices[(i + 1) % n] as PolylineVertex;
    twiceArea += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
    if (a.bulge !== 0 && (a.x !== b.x || a.y !== b.y)) {
      const theta = 4 * Math.atan(a.bulge);
      const c = distance(a, b);
      const r = (c * (1 + a.bulge * a.bulge)) / (4 * Math.abs(a.bulge));
      arcArea += ((r * r) / 2) * (theta - Math.sin(theta));
    }
  }
  return twiceArea / 2 + arcArea;
}

export function polylineBounds(pl: Polyline): Bounds {
  const edges = explodePolyline(pl);
  if (edges.length === 0) return boundsOfPoints(pl.vertices);
  return edges.map(curveBounds).reduce(unionBounds);
}

export function polylineMagnitude(pl: Polyline): number {
  let m = 0;
  for (const c of explodePolyline(pl)) {
    if (c.kind === 'arc') m = Math.max(m, magnitude(c.center) + c.radius);
  }
  for (const v of pl.vertices) m = Math.max(m, magnitude(v));
  return m;
}
