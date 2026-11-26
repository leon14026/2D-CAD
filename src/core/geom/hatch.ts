/**
 * Regions and hatching.
 *
 * A region is bounded by loops: a circle or a closed polyline (which may have arc edges). A
 * hatch has one outer loop and any number of islands inside it. Areas are exact (circles by
 * pi r^2, polylines by the shoelace formula plus circular segments). Hatch lines are found by
 * cutting parallel lines with the loops and pairing the crossings (even-odd rule).
 */
import { cosSin } from './angle';
import { boundsOfPoints, unionBounds, type Bounds } from './bounds';
import { curveBounds, curveMagnitude, segment, type Circle, type Curve, type Segment } from './curves';
import { intersectCurves } from './intersect';
import { explodePolyline, polylineArea, type Polyline } from './polyline';
import type { Shape } from './shape';
import { tolFor } from './tolerance';
import { distance, dot, type Vec2 } from './vec';

/** The boundary of one region piece: a circle or a closed polyline. */
export type Loop = Circle | Polyline;

export function isLoop(s: Shape): s is Loop {
  return s.kind === 'circle' || (s.kind === 'polyline' && s.closed);
}

/** The curves that make up a loop's edge. */
export function loopCurves(l: Loop): readonly Curve[] {
  return l.kind === 'circle' ? [l] : explodePolyline(l);
}

/** Area enclosed by a loop (always positive). */
export function loopArea(l: Loop): number {
  return l.kind === 'circle' ? Math.PI * l.radius * l.radius : Math.abs(polylineArea(l));
}

export function loopBounds(l: Loop): Bounds {
  const curves = loopCurves(l);
  return curves.map(curveBounds).reduce(unionBounds);
}

/** Largest absolute coordinate in a loop; scales tolerances. */
export function loopMagnitude(l: Loop): number {
  return Math.max(...loopCurves(l).map(curveMagnitude));
}

/**
 * True if `p` is inside the loop (points on the edge may go either way). For a polyline this
 * is the vertex polygon's inside, flipped once for each arc edge whose circular segment holds p.
 */
export function pointInLoop(l: Loop, p: Vec2): boolean {
  if (l.kind === 'circle') return distance(l.center, p) < l.radius;
  const v = l.vertices;
  const n = v.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = v[j] as (typeof v)[number];
    const b = v[i] as (typeof v)[number];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  for (let i = 0; i < n; i++) {
    const a = v[i] as (typeof v)[number];
    const b = v[(i + 1) % n] as (typeof v)[number];
    if (a.bulge === 0 || (a.x === b.x && a.y === b.y)) continue;
    const chord = b.x - a.x;
    const chordY = b.y - a.y;
    const side = chord * (p.y - a.y) - chordY * (p.x - a.x);
    if (a.bulge > 0 ? side >= 0 : side <= 0) continue; // p is not on the arc's side of the chord
    const theta = 4 * Math.atan(a.bulge);
    const c = Math.hypot(chord, chordY);
    const r = c / (2 * Math.sin(Math.abs(theta) / 2));
    // Centre lies on the left of a->b for a minor ccw arc; |theta| > pi puts it on the other side.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const h = Math.sqrt(Math.max(0, r * r - (c / 2) * (c / 2)));
    const sign = (a.bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const cx = mx + (sign * -chordY * h) / c;
    const cy = my + (sign * chord * h) / c;
    if (Math.hypot(p.x - cx, p.y - cy) < r) inside = !inside;
  }
  return inside;
}

/** Area of an outer loop less its islands. */
export function regionArea(outer: Loop, islands: readonly Loop[]): number {
  return islands.reduce((sum, i) => sum - loopArea(i), loopArea(outer));
}

// ---------- hatch lines ----------

/** The most hatch lines one hatch may draw; beyond this the spacing is refused. */
export const MAX_HATCH_LINES = 20_000;

export interface HatchLines {
  readonly segments: readonly Segment[];
  /** Positions of dots (for dot patterns). */
  readonly dots: readonly Vec2[];
}

export type HatchKind = 'lines' | 'dots';

export interface ScanOptions {
  /** Direction of the lines, radians counter-clockwise from +x. */
  readonly angle: number;
  readonly spacing: number;
  /** Shifts the lines sideways by this fraction of the spacing (0 to 1). */
  readonly shift?: number;
  /** For dots: also place dots at this spacing along each line. */
  readonly dotSpacing?: number;
}

/** Offsets (along the line normal) where a line would touch a loop at a vertex or tangent. */
function criticalOffsets(loops: readonly Loop[], n: Vec2): number[] {
  const out: number[] = [];
  for (const l of loops) {
    if (l.kind === 'circle') {
      const c = dot(l.center, n);
      out.push(c - l.radius, c + l.radius);
      continue;
    }
    for (const v of l.vertices) out.push(dot(v, n));
    for (const c of loopCurves(l)) {
      if (c.kind === 'arc') {
        const k = dot(c.center, n);
        out.push(k - c.radius, k + c.radius);
      }
    }
  }
  return out;
}

/**
 * Parallel lines at `spacing`, lying on offsets that are whole multiples of the spacing from
 * the origin, cut to the region (outer loop less islands, or any set of loops by even-odd).
 * Throws RangeError if that would be more than MAX_HATCH_LINES lines.
 */
export function hatchLines(loops: readonly Loop[], opts: ScanOptions): HatchLines {
  const { angle, spacing } = opts;
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw new RangeError('hatch spacing must be more than 0');
  const d = cosSin(angle);
  const n: Vec2 = { x: -d.y, y: d.x };
  const box = loops.map(loopBounds).reduce(unionBounds);
  const corners = boundsOfPoints([
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]);
  const cs: Vec2[] = [
    { x: corners.minX, y: corners.minY },
    { x: corners.maxX, y: corners.minY },
    { x: corners.maxX, y: corners.maxY },
    { x: corners.minX, y: corners.maxY },
  ];
  const along = cs.map((p) => dot(p, d));
  const across = cs.map((p) => dot(p, n));
  const t0 = Math.min(...along) - 1;
  const t1 = Math.max(...along) + 1;
  const shift = opts.shift ?? 0;
  const first = Math.ceil(Math.min(...across) / spacing - shift);
  const last = Math.floor(Math.max(...across) / spacing - shift);
  if (last - first + 1 > MAX_HATCH_LINES) throw new RangeError(`that spacing would need more than ${MAX_HATCH_LINES} hatch lines`);
  const crit = criticalOffsets(loops, n);
  const mag = Math.max(...loops.map(loopMagnitude), spacing);
  const tol = tolFor(mag);
  const curves = loops.flatMap((l) => [...loopCurves(l)]);
  const segments: Segment[] = [];
  const dots: Vec2[] = [];
  for (let k = first; k <= last; k++) {
    let o = (k + shift) * spacing;
    // A line through a vertex or tangent point would count crossings twice or not at all.
    if (crit.some((c) => Math.abs(c - o) <= 1e-7 * mag)) o += spacing * 1e-5;
    const a: Vec2 = { x: n.x * o + d.x * t0, y: n.y * o + d.y * t0 };
    const b: Vec2 = { x: n.x * o + d.x * t1, y: n.y * o + d.y * t1 };
    const scan = segment(a, b);
    const ts: number[] = [];
    for (const c of curves) for (const p of intersectCurves(scan, c, tol)) ts.push(dot(p, d));
    ts.sort((x, y) => x - y);
    // An odd number of crossings means one was lost to rounding; leave that line out.
    const pairs = ts.length % 2 === 0 ? ts : [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const s = pairs[i] as number;
      const e = pairs[i + 1] as number;
      if (e - s <= tol) continue;
      segments.push(segment({ x: n.x * o + d.x * s, y: n.y * o + d.y * s }, { x: n.x * o + d.x * e, y: n.y * o + d.y * e }));
      if (opts.dotSpacing !== undefined) {
        const ds = opts.dotSpacing;
        for (let m = Math.ceil(s / ds); m * ds < e; m++) {
          const t = m * ds;
          if (t > s) dots.push({ x: n.x * o + d.x * t, y: n.y * o + d.y * t });
        }
      }
    }
  }
  return { segments, dots };
}
