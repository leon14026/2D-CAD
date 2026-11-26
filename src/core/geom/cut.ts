/**
 * Trim and extend.
 *
 * A shape is handled as a path: a run of curves (a polyline's edges, or the curve itself) with
 * the exact points between them. Ends made by trimming or extending are the computed
 * intersection points themselves, so they lie on the cutting or boundary edge.
 */
import { normalizeAngle, TAU } from './angle';
import {
  arc,
  arcEndPoint,
  arcStartPoint,
  circle,
  closestPoint,
  pointOnCircle,
  segment,
  type Arc,
  type Curve,
} from './curves';
import { intersectCurves } from './intersect';
import { polyline, sweepToBulge } from './polyline';
import { shapeCurves, shapeMagnitude, type Shape } from './shape';
import { tolFor } from './tolerance';
import { angleOf, distance, dot, lengthSq, sub, type Vec2 } from './vec';

/** A shape as curves joined end to end. Curve k runs from points[k] to points[k + 1]. */
export interface Path {
  readonly curves: readonly Curve[];
  /** Exact points between curves: n + 1 for an open path, n for a closed one. */
  readonly points: readonly Vec2[];
  readonly closed: boolean;
}

export function pathOf(s: Shape): Path {
  switch (s.kind) {
    case 'segment':
      return { curves: [s], points: [s.start, s.end], closed: false };
    case 'arc':
      return { curves: [s], points: [arcStartPoint(s), arcEndPoint(s)], closed: false };
    case 'circle':
      return { curves: [s], points: [pointOnCircle(s.center, s.radius, 0)], closed: true };
    case 'polyline': {
      const curves: Curve[] = [];
      const points: Vec2[] = [];
      const n = s.vertices.length;
      const edges = s.closed ? n : n - 1;
      for (let i = 0; i < edges; i++) {
        const a = s.vertices[i] as Vec2;
        const b = s.vertices[(i + 1) % n] as Vec2;
        if (a.x === b.x && a.y === b.y) continue;
        if (points.length === 0) points.push({ x: a.x, y: a.y });
        curves.push(shapeCurves(s)[curves.length] as Curve);
        points.push({ x: b.x, y: b.y });
      }
      if (curves.length === 0) throw new RangeError('this polyline has no length');
      if (s.closed) points.pop();
      return { curves, points, closed: s.closed };
    }
  }
}

/** Where a point lies along a curve, from 0 at its start to 1 at its end (circles start at 0°). */
export function curveParam(c: Curve, p: Vec2): number {
  switch (c.kind) {
    case 'segment': {
      const d = sub(c.end, c.start);
      return Math.min(1, Math.max(0, dot(sub(p, c.start), d) / lengthSq(d)));
    }
    case 'circle':
      return normalizeAngle(angleOf(sub(p, c.center))) / TAU;
    case 'arc': {
      const a = angleOf(sub(p, c.center));
      const along = c.sweep > 0 ? normalizeAngle(a - c.start) : normalizeAngle(c.start - a);
      const span = Math.abs(c.sweep);
      if (along <= span) return along / span;
      // Just outside the arc (rounding): the nearer end.
      return TAU - along < along - span ? 0 : 1;
    }
  }
}

/** Position along a path: curve index plus the fraction along that curve. */
export function pathParam(path: Path, p: Vec2): number {
  let best = 0;
  let bestDistance = Infinity;
  path.curves.forEach((c, k) => {
    const q = closestPoint(c, p);
    const d = distance(q, p);
    if (d < bestDistance) {
      bestDistance = d;
      best = k + curveParam(c, q);
    }
  });
  return best;
}

interface Cut {
  readonly u: number;
  readonly point: Vec2;
}

/** Where other shapes cross the path, in order along it, without repeats or open ends. */
function cutsOf(path: Path, others: readonly Shape[], tol: number): Cut[] {
  const cuts: Cut[] = [];
  path.curves.forEach((c, k) => {
    for (const other of others) {
      for (const oc of shapeCurves(other)) {
        for (const p of intersectCurves(c, oc, tol)) cuts.push({ u: k + curveParam(c, p), point: p });
      }
    }
  });
  cuts.sort((a, b) => a.u - b.u);
  const out: Cut[] = [];
  const start = path.points[0] as Vec2;
  const end = path.points[path.points.length - 1] as Vec2;
  for (const cut of cuts) {
    if (out.some((o) => distance(o.point, cut.point) <= tol)) continue;
    if (!path.closed && (distance(cut.point, start) <= tol || distance(cut.point, end) <= tol)) continue;
    out.push(cut);
  }
  return out;
}

/** Part of a line or arc between fractions f0 and f1. (Circles are trimmed whole, in trimShape.) */
function subCurve(c: Curve, f0: number, f1: number, from: Vec2, to: Vec2): Curve {
  if (c.kind === 'segment') return segment(from, to);
  const a = c as Arc;
  return arc(a.center, a.radius, a.start + a.sweep * f0, a.sweep * (f1 - f0));
}

interface Piece {
  readonly curve: Curve;
  readonly from: Vec2;
  readonly to: Vec2;
}

/** The part of the path from u = ua to u = ub, starting exactly at `pa` and ending at `pb`. */
function extract(path: Path, ua: number, ub: number, pa: Vec2, pb: Vec2): Piece[] {
  const n = path.curves.length;
  const spans: { i: number; f0: number; f1: number; from: Vec2; to: Vec2 }[] = [];
  for (let k = Math.floor(ua); k < ub; k++) {
    const i = ((k % n) + n) % n;
    spans.push({
      i,
      f0: Math.max(0, ua - k),
      f1: Math.min(1, ub - k),
      from: k === Math.floor(ua) ? pa : (path.points[i] as Vec2),
      to: ub - k <= 1 ? pb : (path.points[(i + 1) % path.points.length] as Vec2),
    });
  }
  // Rounding can leave an empty span where a cut falls on a vertex: skip it.
  return spans
    .filter((s) => s.f1 > s.f0 && (s.from.x !== s.to.x || s.from.y !== s.to.y))
    .map((s) => ({ curve: subCurve(path.curves[s.i] as Curve, s.f0, s.f1, s.from, s.to), from: s.from, to: s.to }));
}

/** Turns pieces of a path back into a shape of the original's kind. */
function shapeOf(original: Shape, pieces: readonly Piece[]): Shape {
  if (original.kind !== 'polyline') return (pieces[0] as Piece).curve;
  const vertices = pieces.map((p) => ({ x: p.from.x, y: p.from.y, bulge: p.curve.kind === 'arc' ? sweepToBulge(p.curve.sweep) : 0 }));
  const lastPiece = pieces[pieces.length - 1] as Piece;
  vertices.push({ x: lastPiece.to.x, y: lastPiece.to.y, bulge: 0 });
  return polyline(vertices, false);
}

export type TrimResult =
  | { readonly ok: true; readonly pieces: Shape[] }
  | { readonly ok: false; readonly reason: 'no crossings' | 'one crossing on a closed shape' };

/**
 * Removes the part of `target` around `pick` that lies between the crossings with `cutters`
 * (or between a crossing and an open end). Returns what is left: up to two pieces.
 * A circle or closed polyline needs two crossings and becomes one open piece.
 */
export function trimShape(target: Shape, cutters: readonly Shape[], pick: Vec2): TrimResult {
  const tol = tolFor(shapeMagnitude(target), ...cutters.map(shapeMagnitude));
  const path = pathOf(target);
  const n = path.curves.length;
  const cuts = cutsOf(path, cutters, tol);
  if (cuts.length === 0) return { ok: false, reason: 'no crossings' };
  const u = pathParam(path, pick);
  const below = cuts.filter((c) => c.u <= u);
  const above = cuts.filter((c) => c.u > u);
  if (path.closed) {
    if (cuts.length < 2) return { ok: false, reason: 'one crossing on a closed shape' };
    const lo = below.length > 0 ? (below[below.length - 1] as Cut) : { ...(cuts[cuts.length - 1] as Cut), u: (cuts[cuts.length - 1] as Cut).u - n };
    const hi = above.length > 0 ? (above[0] as Cut) : { ...(cuts[0] as Cut), u: (cuts[0] as Cut).u + n };
    // Keep from the crossing after the pick, round to the one before it.
    if (target.kind === 'circle') return { ok: true, pieces: [arc(target.center, target.radius, TAU * hi.u, TAU * (lo.u + n - hi.u))] };
    return { ok: true, pieces: [shapeOf(target, extract(path, hi.u, lo.u + n, hi.point, lo.point))] };
  }
  const pieces: Shape[] = [];
  const lo = below[below.length - 1];
  const hi = above[0];
  if (lo) pieces.push(shapeOf(target, extract(path, 0, lo.u, path.points[0] as Vec2, lo.point)));
  if (hi) pieces.push(shapeOf(target, extract(path, hi.u, n, hi.point, path.points[path.points.length - 1] as Vec2)));
  return { ok: true, pieces };
}

export type ExtendResult =
  | { readonly ok: true; readonly shape: Shape }
  | { readonly ok: false; readonly reason: 'closed' | 'nothing ahead' };

/**
 * Lengthens the end of `target` nearer to `pick` until it meets the nearest of `boundaries`.
 * Lines carry straight on; arcs carry on round their circle. The new end is the intersection
 * point, so it lies on the boundary.
 */
export function extendShape(target: Shape, boundaries: readonly Shape[], pick: Vec2): ExtendResult {
  if (target.kind === 'circle' || (target.kind === 'polyline' && target.closed)) return { ok: false, reason: 'closed' };
  const tol = tolFor(shapeMagnitude(target), ...boundaries.map(shapeMagnitude));
  const path = pathOf(target);
  const n = path.curves.length;
  const atStart = pathParam(path, pick) < n / 2;
  const edge = (atStart ? path.curves[0] : path.curves[n - 1]) as Curve;
  const end = (atStart ? path.points[0] : path.points[n]) as Vec2;
  const others = boundaries.flatMap((b) => [...shapeCurves(b)]);
  let reach: number;
  if (edge.kind === 'segment') {
    // A line long enough to pass every boundary, from the end outwards.
    const away = atStart ? sub(edge.start, edge.end) : sub(edge.end, edge.start);
    const unit = Math.hypot(away.x, away.y);
    reach = 2 * (shapeMagnitude(target) + Math.max(0, ...boundaries.map(shapeMagnitude))) + 1;
    const ray = segment(end, { x: end.x + (away.x / unit) * reach, y: end.y + (away.y / unit) * reach });
    let best: Vec2 | null = null;
    let bestDistance = Infinity;
    for (const oc of others) {
      for (const p of intersectCurves(ray, oc, tol)) {
        const d = distance(end, p);
        if (d > tol && d < bestDistance) {
          best = p;
          bestDistance = d;
        }
      }
    }
    if (!best) return { ok: false, reason: 'nothing ahead' };
    return { ok: true, shape: withEnd(target, path, atStart, segment(atStart ? best : edge.start, atStart ? edge.end : best), best) };
  }
  // An arc carries on round its circle, in the direction it was already turning.
  const a = edge as Arc;
  const ring = circle(a.center, a.radius);
  const forward = atStart ? -Math.sign(a.sweep) : Math.sign(a.sweep);
  const endAngle = atStart ? a.start : a.start + a.sweep;
  const room = TAU - Math.abs(a.sweep);
  let best: Vec2 | null = null;
  let bestTurn = Infinity;
  for (const oc of others) {
    for (const p of intersectCurves(ring, oc, tol)) {
      const turn = normalizeAngle(forward * (angleOf(sub(p, a.center)) - endAngle));
      if (turn * a.radius > tol && turn < room && turn < bestTurn) {
        best = p;
        bestTurn = turn;
      }
    }
  }
  if (!best) return { ok: false, reason: 'nothing ahead' };
  const s = Math.sign(a.sweep);
  const longer = atStart ? arc(a.center, a.radius, a.start - s * bestTurn, a.sweep + s * bestTurn) : arc(a.center, a.radius, a.start, a.sweep + s * bestTurn);
  return { ok: true, shape: withEnd(target, path, atStart, longer, best) };
}

/** The target with its first or last curve replaced, ending exactly at `point`. */
function withEnd(target: Shape, path: Path, atStart: boolean, curve: Curve, point: Vec2): Shape {
  if (target.kind !== 'polyline') return curve;
  const n = path.curves.length;
  const pieces: Piece[] = path.curves.map((c, k) => ({ curve: c, from: path.points[k] as Vec2, to: path.points[k + 1] as Vec2 }));
  if (atStart) pieces[0] = { curve, from: point, to: path.points[1] as Vec2 };
  else pieces[n - 1] = { curve, from: path.points[n - 1] as Vec2, to: point };
  return shapeOf(target, pieces);
}
