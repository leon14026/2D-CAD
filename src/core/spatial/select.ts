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
  segment,
  shapeMagnitude,
  tolFor,
  type Bounds,
  type Curve,
  type Shape,
  type Vec2,
} from '../geom';
import { compareDrawOrder, findLayer, type Doc, type Entity } from '../doc';
import { DocIndex, entityBounds } from './doc-index';

export type BoxMode = 'window' | 'crossing';

export function isSelectable(doc: Doc, e: Entity): boolean {
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

/** Ids selected by a box, in drawing order. */
export function selectInBox(doc: Doc, box: Bounds, mode: BoxMode): number[] {
  const tol = tolFor(box.minX, box.minY, box.maxX, box.maxY);
  const index = DocIndex.of(doc);
  // Widen the index query by the largest tolerance any shape here could use, so shapes that sit
  // on the box edge within tolerance are not lost before the exact tests below.
  const reach = tolFor(box.minX, box.minY, box.maxX, box.maxY, index.magnitude);
  const query = { minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach };
  return index
    .query(query)
    .filter((e) => isSelectable(doc, e))
    .filter((e) => {
      const b = entityBounds(e);
      return mode === 'window' ? boxContains(box, b, tol) : shapeTouchesBox(e.geom, box, b);
    })
    .sort(compareDrawOrder)
    .map((e) => e.id);
}

/** Distance from a point to the nearest part of a shape. */
export function distanceToShape(s: Shape, p: Vec2): number {
  return Math.min(...curvesOf(s).map((c) => distanceToCurve(c, p)));
}

/** The entity nearest to `p` within `radius` (drawing units), or null. Ties go to the one drawn on top. */
export function pickAt(doc: Doc, p: Vec2, radius: number): number | null {
  const box = { minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius };
  let best: Entity | null = null;
  let bestDistance = Infinity;
  for (const e of DocIndex.of(doc).query(box)) {
    if (!isSelectable(doc, e)) continue;
    const d = distanceToShape(e.geom, p);
    if (d > radius) continue;
    if (d < bestDistance || (d === bestDistance && best && compareDrawOrder(e, best) > 0)) {
      best = e;
      bestDistance = d;
    }
  }
  return best ? best.id : null;
}
