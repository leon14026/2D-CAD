/**
 * Selection rules.
 *
 * - Window (box dragged left to right): entities lying entirely inside the box.
 * - Crossing (box dragged right to left): entities inside the box or touching its edges.
 * - Pick (click): the entity nearest the cursor within a radius; if two are equally near, the
 *   one drawn on top.
 *
 * Entities on hidden or locked layers are never selected.
 */
import {
  distanceToCurve,
  explodePolyline,
  intersect,
  loopCurves,
  pointInLoop,
  segment,
  shapeBounds,
  shapeMagnitude,
  tolFor,
  type Bounds,
  type Curve,
  type Shape,
  type Vec2,
} from '../geom';
import {
  compareDrawOrder,
  distanceToMark,
  docEnv,
  findLayer,
  hatchLoops,
  insertBounds,
  insertShapes,
  onCurrentSheet,
  pickShapes,
  resolveNotes,
  textBox,
  type ConstraintMark,
  type Doc,
  type Entity,
  type Note,
  type Resolved,
} from '../doc';
import { DocIndex, entityBounds } from './doc-index';

export type BoxMode = 'window' | 'crossing';

export function isSelectable(doc: Doc, e: { readonly layer: number }): boolean {
  const layer = findLayer(doc, e.layer);
  return layer !== undefined && layer.visible && !layer.locked;
}

/** Box from two corners in any order. */
export function boxFromCorners(a: Vec2, b: Vec2): Bounds {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function boxContains(outer: Bounds, inner: Bounds, tol = 0): boolean {
  return (
    inner.minX >= outer.minX - tol &&
    inner.maxX <= outer.maxX + tol &&
    inner.minY >= outer.minY - tol &&
    inner.maxY <= outer.maxY + tol
  );
}

function pointInBox(p: Vec2, box: Bounds, tol: number): boolean {
  return p.x >= box.minX - tol && p.x <= box.maxX + tol && p.y >= box.minY - tol && p.y <= box.maxY + tol;
}

function curvesOf(s: Shape): Curve[] {
  return s.kind === 'polyline' ? explodePolyline(s) : [s];
}

function keyPoints(s: Shape): Vec2[] {
  switch (s.kind) {
    case 'segment':
      return [s.start, s.end];
    case 'polyline':
      return [...s.vertices];
    default:
      return []; // circles and arcs are caught by the bounds and edge tests
  }
}

/** True if any part of the shape lies inside the box or on its edges. */
export function shapeTouchesBox(s: Shape, box: Bounds, bounds: Bounds): boolean {
  const tol = tolFor(shapeMagnitude(s), box.minX, box.minY, box.maxX, box.maxY);
  if (bounds.minX > box.maxX + tol || bounds.maxX < box.minX - tol) return false;
  if (bounds.minY > box.maxY + tol || bounds.maxY < box.minY - tol) return false;
  if (boxContains(box, bounds, tol)) return true;
  if (keyPoints(s).some((p) => pointInBox(p, box, tol))) return true;
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as Vec2;
    const b = corners[(i + 1) % 4] as Vec2;
    if (a.x === b.x && a.y === b.y) continue; // zero-width box: that side is a point
    if (intersect(s, segment(a, b), tol).length > 0) return true;
  }
  return false;
}

/** Ids selected by a box, in drawing order. Constraint marks are included when supplied. */
export function selectInBox(doc: Doc, box: Bounds, mode: BoxMode, marks: readonly ConstraintMark[] = []): number[] {
  const tol = tolFor(box.minX, box.minY, box.maxX, box.maxY);
  const index = DocIndex.of(doc);
  // Widen the index query by the largest tolerance any shape here could use, so shapes that sit
  // on the box edge within tolerance are not lost before the exact tests below.
  const reach = tolFor(box.minX, box.minY, box.maxX, box.maxY, index.magnitude);
  const query = { minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach };
  const hits: { id: number; z: number }[] = index
    .query(query)
    .filter((e) => isSelectable(doc, e) && onCurrentSheet(doc, e))
    .filter((e) => {
      const b = entityBounds(e);
      return mode === 'window' ? boxContains(box, b, tol) : shapeTouchesBox(e.geom, box, b);
    });
  for (const ins of index.queryInserts(query)) {
    if (!isSelectable(doc, ins) || !onCurrentSheet(doc, ins)) continue;
    const b = insertBounds(doc, ins);
    if (!b) continue;
    const hit =
      mode === 'window'
        ? boxContains(box, b, tol)
        : boxContains(box, b, tol) || insertShapes(doc, ins).some((s) => shapeTouchesBox(s, box, shapeBounds(s)));
    if (hit) hits.push(ins);
  }
  const resolved = resolveNotes(doc);
  for (const n of index.queryNotes(query)) {
    const r = resolved.get(n.id);
    if (!r?.ok || !isSelectable(doc, n) || !onCurrentSheet(doc, n)) continue;
    const b = r.r.bounds;
    const hit =
      mode === 'window'
        ? boxContains(box, b, tol)
        : boxContains(box, b, tol) ||
          (n.body.kind === 'hatch'
            ? b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY
            : pickShapes(r.r.prims).some((s) => shapeTouchesBox(s, box, shapeBounds(s))));
    if (hit) hits.push(n);
  }
  for (const m of marks) {
    const hit =
      mode === 'window'
        ? boxContains(box, m.bounds, tol)
        : boxContains(box, m.bounds, tol) || m.segs.some(([a, b]) => shapeTouchesBox(segment(a, b), box, m.bounds));
    if (hit) hits.push({ id: m.id, z: Number.NEGATIVE_INFINITY });
  }
  return hits.sort(compareDrawOrder).map((e) => e.id);
}

/** Distance from a point to the nearest part of a shape. */
export function distanceToShape(s: Shape, p: Vec2): number {
  return Math.min(...curvesOf(s).map((c) => distanceToCurve(c, p)));
}

/** How far a click at `p` is from a note: 0 inside a text box, `radius` inside a hatch, else the distance to its lines. */
function noteDistance(doc: Doc, n: Note, resolved: Resolved, p: Vec2, radius: number): number {
  let best = Infinity;
  for (const prim of resolved.prims) {
    if (prim.k === 'text') {
      const box = textBox(prim);
      if (pointInLoop({ kind: 'polyline', vertices: box.map((v) => ({ x: v.x, y: v.y, bulge: 0 })), closed: true }, p)) return 0;
    }
  }
  for (const s of pickShapes(resolved.prims)) best = Math.min(best, distanceToShape(s, p));
  if (n.body.kind === 'hatch') {
    const loops = hatchLoops(docEnv(doc), n.body);
    const outer = loops[0];
    if (outer && pointInLoop(outer, p) && !loops.slice(1).some((i) => pointInLoop(i, p))) best = Math.min(best, radius);
    for (const l of loops) for (const c of loopCurves(l)) best = Math.min(best, distanceToCurve(c, p));
    // A hatch lies under the geometry it fills: when a click is as near to a boundary as to the
    // hatch, the boundary wins. The nudge is far below anything the eye can tell apart.
    if (best < radius) best = Math.min(radius, best + radius * 1e-6);
  }
  return best;
}

/** The entity, note or constraint mark nearest to `p` within `radius` (drawing units), or null. Ties go to the one drawn on top. */
export function pickAt(doc: Doc, p: Vec2, radius: number, marks: readonly ConstraintMark[] = []): number | null {
  const box = { minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius };
  let best: { id: number; z: number } | null = null;
  let bestDistance = Infinity;
  const consider = (item: { id: number; z: number }, d: number) => {
    if (d > radius) return;
    if (d < bestDistance || (d === bestDistance && best && compareDrawOrder(item, best) > 0)) {
      best = item;
      bestDistance = d;
    }
  };
  const index = DocIndex.of(doc);
  for (const e of index.query(box)) {
    if (isSelectable(doc, e) && onCurrentSheet(doc, e)) consider(e, distanceToShape(e.geom, p));
  }
  for (const ins of index.queryInserts(box)) {
    if (!isSelectable(doc, ins) || !onCurrentSheet(doc, ins)) continue;
    const shapes = insertShapes(doc, ins);
    if (shapes.length === 0) continue;
    consider(ins, Math.min(...shapes.map((s) => distanceToShape(s, p))));
  }
  const resolved = resolveNotes(doc);
  for (const n of index.queryNotes(box)) {
    const r = resolved.get(n.id);
    if (r?.ok && isSelectable(doc, n) && onCurrentSheet(doc, n)) consider(n, noteDistance(doc, n, r.r, p, radius));
  }
  for (const m of marks) consider({ id: m.id, z: Number.NEGATIVE_INFINITY }, distanceToMark(m, p));
  return best ? (best as { id: number }).id : null;
}
