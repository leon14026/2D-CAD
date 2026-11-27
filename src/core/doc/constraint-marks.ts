/**
 * Hairline marks drawn beside constraints so they can be seen and picked. They are not
 * geometry: snaps and the modify commands ignore them.
 */
import { add, boundsOfPoints, midpoint, scale, sub, type Bounds, type Vec2 } from '../geom';
import { onCurrentSheet } from './sheets';
import { constraintEntityIds, type Constraint } from './constraints';
import { docEnv, resolveRef, type NoteEnv } from './notes';
import type { Doc } from './model';

/** Paper size of a constraint mark at 1:1, in drawing units. */
export const CONSTRAINT_MARK_SIZE = 2.5;

export interface ConstraintMark {
  readonly id: number;
  readonly segs: readonly (readonly [Vec2, Vec2])[];
  readonly at: Vec2;
  readonly bounds: Bounds;
}

function glyph(at: Vec2, segs: readonly (readonly [number, number, number, number])[]): ConstraintMark['segs'] {
  const s = CONSTRAINT_MARK_SIZE / 2;
  return segs.map(([x0, y0, x1, y1]) => [
    { x: at.x + x0 * s, y: at.y + y0 * s },
    { x: at.x + x1 * s, y: at.y + y1 * s },
  ]);
}

function kindGlyph(kind: Constraint['body']['kind']): readonly (readonly [number, number, number, number])[] {
  switch (kind) {
    case 'coincident':
      return [
        [-1, -1, 1, -1],
        [1, -1, 1, 1],
        [1, 1, -1, 1],
        [-1, 1, -1, -1],
      ];
    case 'horizontal':
      return [
        [-1.4, 0, 1.4, 0],
        [-1.4, -0.5, -1.4, 0.5],
        [1.4, -0.5, 1.4, 0.5],
      ];
    case 'vertical':
      return [
        [0, -1.4, 0, 1.4],
        [-0.5, -1.4, 0.5, -1.4],
        [-0.5, 1.4, 0.5, 1.4],
      ];
    case 'distance':
    case 'length':
      return [
        [-1.4, -0.6, -1.4, 0.6],
        [1.4, -0.6, 1.4, 0.6],
        [-1.4, 0, 1.4, 0],
      ];
    case 'fix':
      return [
        [-0.9, -0.9, 0.9, -0.9],
        [0.9, -0.9, 0.9, 0.9],
        [0.9, 0.9, -0.9, 0.9],
        [-0.9, 0.9, -0.9, -0.9],
        [-0.9, -0.9, 0.9, 0.9],
        [0.9, -0.9, -0.9, 0.9],
      ];
    case 'radius':
      return [
        [-1, 0, 1, 0],
        [0, -1, 0, 1],
        [-0.9, -0.4, 0.9, -0.4],
      ];
    case 'angle':
      return [
        [-1.2, -1, 0.2, -1],
        [-1.2, -1, -0.2, 1],
      ];
    case 'parallel':
      return [
        [-1.2, -0.5, 1.2, -0.5],
        [-1.2, 0.5, 1.2, 0.5],
      ];
    case 'perpendicular':
      return [
        [-1.2, -1, 1.2, -1],
        [0, -1, 0, 1.2],
      ];
    case 'equal':
      return [
        [-1.1, -0.4, 1.1, -0.4],
        [-1.1, 0.4, 1.1, 0.4],
      ];
    case 'concentric':
      return [
        [-0.6, -0.6, 0.6, -0.6],
        [0.6, -0.6, 0.6, 0.6],
        [0.6, 0.6, -0.6, 0.6],
        [-0.6, 0.6, -0.6, -0.6],
        [-1.2, -1.2, 1.2, -1.2],
        [1.2, -1.2, 1.2, 1.2],
        [1.2, 1.2, -1.2, 1.2],
        [-1.2, 1.2, -1.2, -1.2],
      ];
    case 'tangent':
      return [
        [-1.4, -1, 1.4, -1],
        [-0.7, -1, -0.7, 1],
        [0.7, -1, 0.7, 0.2],
      ];
    case 'midpoint':
      return [
        [-1.3, -0.8, 1.3, -0.8],
        [0, -0.8, 0, 1.1],
        [-0.6, 0.4, 0, 1.1],
        [0.6, 0.4, 0, 1.1],
      ];
  }
}

type AnchoredKind = 'coincident' | 'horizontal' | 'vertical' | 'distance' | 'fix' | 'midpoint';

function anchorOf(env: NoteEnv, c: Constraint & { body: Extract<Constraint['body'], { kind: AnchoredKind }> }): Vec2 {
  const b = c.body;
  try {
    switch (b.kind) {
      case 'coincident':
      case 'horizontal':
      case 'vertical':
      case 'distance':
        return midpoint(resolveRef(env, b.a), resolveRef(env, b.b));
      case 'fix':
      case 'midpoint':
        return resolveRef(env, b.a);
    }
  } catch {
    return { x: 0, y: 0 };
  }
}

function offsetFrom(p: Vec2, toward: Vec2): Vec2 {
  const d = sub(p, toward);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return add(p, { x: CONSTRAINT_MARK_SIZE, y: CONSTRAINT_MARK_SIZE });
  return add(p, scale({ x: d.x / len, y: d.y / len }, CONSTRAINT_MARK_SIZE * 1.2));
}

function entityPoint(env: NoteEnv, id: number): Vec2 | null {
  const e = env.entity(id);
  if (!e) return null;
  const g = e.geom;
  if (g.kind === 'segment') return midpoint(g.start, g.end);
  if (g.kind === 'circle' || g.kind === 'arc') return g.center;
  if (g.kind === 'polyline' && g.vertices.length > 0) {
    const v = g.vertices[0]!;
    return { x: v.x, y: v.y };
  }
  return null;
}

function markAnchor(env: NoteEnv, c: Constraint): Vec2 {
  const b = c.body;
  if (b.kind === 'coincident' || b.kind === 'horizontal' || b.kind === 'vertical' || b.kind === 'distance' || b.kind === 'fix' || b.kind === 'midpoint') {
    const at = anchorOf(env, c as Constraint & { body: Extract<Constraint['body'], { kind: AnchoredKind }> });
    return offsetFrom(at, { x: at.x - 1, y: at.y - 1 });
  }
  const ids = constraintEntityIds(c);
  const pts = ids.map((id) => entityPoint(env, id)).filter((p): p is Vec2 => p !== null);
  if (pts.length === 0) return { x: 0, y: 0 };
  const at = pts.length === 1 ? pts[0]! : midpoint(pts[0]!, pts[1]!);
  return offsetFrom(at, pts[0]!);
}

export function constraintMarks(doc: Doc): ConstraintMark[] {
  const env = docEnv(doc);
  const out: ConstraintMark[] = [];
  for (const c of [...doc.constraints.values()].sort((a, b) => a.id - b.id)) {
    if (!onCurrentSheet(doc, c)) continue;
    const at = markAnchor(env, c);
    const segs = glyph(at, kindGlyph(c.body.kind));
    const pts = segs.flatMap(([a, b]) => [a, b]);
    out.push({ id: c.id, segs, at, bounds: boundsOfPoints(pts) });
  }
  return out;
}

export function distanceToMark(mark: ConstraintMark, p: Vec2): number {
  let best = Infinity;
  for (const [a, b] of mark.segs) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return best;
}
