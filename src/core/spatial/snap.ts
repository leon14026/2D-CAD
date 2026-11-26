/**
 * Object snaps: exact points on existing geometry, worked out analytically (never by reading
 * pixels). The cursor only chooses which point; the point itself comes from the geometry.
 *
 * - Endpoint: ends of lines and arcs, and every polyline vertex.
 * - Midpoint: middle of a line, an arc or a polyline edge.
 * - Centre: centre of a circle, an arc or a bulged polyline edge.
 * - Quadrant: the 0°, 90°, 180° and 270° points of a circle or arc.
 * - Intersection: where two entities cross.
 * - Perpendicular and tangent: from the point the next line starts at ("from").
 * - Nearest: the closest point on any entity.
 *
 * Snapping looks at entities on visible layers, locked ones included.
 */
import {
  arcMidPoint,
  closestPoint,
  curveEndpoints,
  distance,
  distanceToCurve,
  intersect,
  midpoint,
  perpendicularFeet,
  quadrantPoints,
  shapeCurves,
  tangentPoints,
  tolFor,
  type Curve,
  type Shape,
  type Vec2,
} from '../geom';
import type { Doc, Entity } from '../doc';
import { DocIndex, isVisible } from './doc-index';

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'intersection'
  | 'perpendicular'
  | 'tangent'
  | 'nearest';

/** Every snap kind, in priority order: when two snap points are equally near, the earlier wins. */
export const SNAP_KINDS: readonly SnapKind[] = Object.freeze([
  'endpoint',
  'intersection',
  'midpoint',
  'center',
  'quadrant',
  'perpendicular',
  'tangent',
  'nearest',
]);

export const SNAP_LABELS: Readonly<Record<SnapKind, string>> = Object.freeze({
  endpoint: 'Endpoint',
  intersection: 'Intersection',
  midpoint: 'Midpoint',
  center: 'Centre',
  quadrant: 'Quadrant',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'Nearest',
});

/** Snaps on when a drawing opens: all but nearest, which would catch almost every click. */
export const DEFAULT_SNAPS: ReadonlySet<SnapKind> = new Set(SNAP_KINDS.filter((k) => k !== 'nearest'));

export interface SnapHit {
  readonly kind: SnapKind;
  readonly point: Vec2;
  /** The entity, or the two entities for an intersection. */
  readonly ids: readonly number[];
}

export interface SnapOptions {
  readonly kinds: ReadonlySet<SnapKind>;
  /** The point the next line or arc starts from; perpendicular and tangent need it. */
  readonly from?: Vec2 | null;
}

/** Snap kinds that come from a single shape. */
export type SingleSnapKind = Exclude<SnapKind, 'intersection'>;

/** The snap points of one kind on one shape. `cursor` is used only by nearest. */
export function snapPoints(s: Shape, kind: SingleSnapKind, cursor: Vec2, from: Vec2 | null = null): Vec2[] {
  if (kind === 'endpoint' && s.kind === 'polyline') return s.vertices.map((v) => ({ x: v.x, y: v.y }));
  const curves = shapeCurves(s);
  if (kind === 'nearest') {
    let best: Vec2 | null = null;
    let bestDistance = Infinity;
    for (const c of curves) {
      const p = closestPoint(c, cursor);
      const d = distance(p, cursor);
      if (d < bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best ? [best] : [];
  }
  return curves.flatMap((c) => curvePoints(c, kind, from));
}

function curvePoints(c: Curve, kind: Exclude<SingleSnapKind, 'nearest'>, from: Vec2 | null): Vec2[] {
  switch (kind) {
    case 'endpoint':
      return curveEndpoints(c);
    case 'midpoint':
      if (c.kind === 'segment') return [midpoint(c.start, c.end)];
      return c.kind === 'arc' ? [arcMidPoint(c)] : [];
    case 'center':
      return c.kind === 'segment' ? [] : [c.center];
    case 'quadrant':
      return quadrantPoints(c);
    case 'perpendicular':
      return from ? perpendicularFeet(c, from) : [];
    case 'tangent':
      return from ? tangentPoints(c, from) : [];
  }
}

/** Kinds found by looking at each shape on its own, in priority order. */
const POINT_KINDS = SNAP_KINDS.filter(
  (k): k is Exclude<SingleSnapKind, 'nearest'> => k !== 'intersection' && k !== 'nearest',
);

/**
 * The best snap point within `radius` (drawing units) of the cursor, or null.
 *
 * The nearest snap point of any enabled kind wins; ties go to the kind earlier in SNAP_KINDS.
 * If there is none, a cursor resting on a circle or arc snaps to its centre (when centre is on
 * and nearest is off), and otherwise nearest applies, if it is on.
 */
export function findSnap(doc: Doc, cursor: Vec2, radius: number, options: SnapOptions): SnapHit | null {
  const { kinds } = options;
  if (kinds.size === 0) return null;
  const from = options.from ?? null;
  const box = { minX: cursor.x - radius, minY: cursor.y - radius, maxX: cursor.x + radius, maxY: cursor.y + radius };
  const near = DocIndex.of(doc).query(box).filter((e) => isVisible(doc, e));
  const eps = tolFor(cursor.x, cursor.y, radius);

  const found: { best: Candidate | null } = { best: null };
  const consider = (kind: SnapKind, point: Vec2, ids: readonly number[]) => {
    const d = distance(point, cursor);
    if (d > radius) return;
    const rank = SNAP_KINDS.indexOf(kind);
    const best = found.best;
    if (!best || d < best.d - eps || (d <= best.d + eps && rank < best.rank)) found.best = { hit: { kind, point, ids }, d, rank };
  };

  for (const e of near) {
    for (const kind of POINT_KINDS) {
      if (!kinds.has(kind)) continue;
      for (const p of snapPoints(e.geom, kind, cursor, from)) consider(kind, p, [e.id]);
    }
  }
  if (kinds.has('intersection')) {
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i] as Entity;
        const b = near[j] as Entity;
        for (const p of intersect(a.geom, b.geom)) consider('intersection', p, [a.id, b.id]);
      }
    }
  }
  // A function, so the checks below see what `consider` has stored since.
  const bestHit = (): SnapHit | null => found.best?.hit ?? null;
  if (bestHit()) return bestHit();

  if (kinds.has('center') && !kinds.has('nearest')) return centreByEdge(near, cursor, radius);
  if (kinds.has('nearest')) {
    for (const e of near) {
      for (const p of snapPoints(e.geom, 'nearest', cursor)) consider('nearest', p, [e.id]);
    }
  }
  return bestHit();
}

interface Candidate {
  readonly hit: SnapHit;
  readonly d: number;
  readonly rank: number;
}

/** The centre of the circle or arc whose edge the cursor rests on (the closest one). */
function centreByEdge(near: readonly Entity[], cursor: Vec2, radius: number): SnapHit | null {
  let hit: SnapHit | null = null;
  let bestDistance = Infinity;
  for (const e of near) {
    for (const c of shapeCurves(e.geom)) {
      if (c.kind === 'segment') continue;
      const d = distanceToCurve(c, cursor);
      if (d <= radius && d < bestDistance) {
        hit = { kind: 'center', point: c.center, ids: [e.id] };
        bestDistance = d;
      }
    }
  }
  return hit;
}
