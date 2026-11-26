/**
 * The Phase 4 reference part: a 120 × 80 plate drawn by typed input alone. The unit test
 * feeds these steps to the drafting engine; the browser test types them into the app. Both
 * check the drawing against REFERENCE_SHAPES, worked out by hand, to 1e-9.
 */
import { arc, circle, polyline, segment, type Shape } from '../../src/core/geom';
import type { ToolId } from '../../src/core/tools';

export type ReferenceStep =
  | { readonly tool: ToolId }
  | { readonly type: string }
  | { readonly option: string }
  /** Enter with nothing typed. */
  | { readonly enter: true };

const t = (text: string): ReferenceStep => ({ type: text });
const ENTER: ReferenceStep = { enter: true };

export const REFERENCE_STEPS: readonly ReferenceStep[] = [
  // The plate.
  { tool: 'rectangle' }, t('0,0'), t('@120,80'), ENTER,
  // Four holes: a radius, a diameter, then the remembered radius twice.
  { tool: 'circle' }, t('15,15'), t('4'), t('105,15'), { option: 'd' }, t('8'), t('15,65'), ENTER, t('105,65'), ENTER, ENTER,
  // A slot: two straight sides and two half circles.
  { tool: 'line' }, t('45,35'), t('@30,0'), ENTER,
  { tool: 'arcCenter' }, t('75,40'), t('@0,-5'), t('180'), ENTER,
  { tool: 'line' }, t('75,45'), t('@-30,0'), ENTER,
  { tool: 'arcCenter' }, t('45,40'), t('@0,5'), t('180'), ENTER,
  // A hexagon of radius 6.
  { tool: 'polygon' }, t('6'), t('60,62'), t('6'), ENTER,
  // An equilateral triangle from polar input, closed with C.
  { tool: 'line' }, t('10,40'), t('@20<60'), t('@20<-60'), { option: 'c' },
  // An arc through three points.
  { tool: 'arc' }, t('80,60'), t('90,70'), t('100,60'), ENTER,
];

const r3 = Math.sqrt(3);

/** The drawing the steps must produce, in order, worked out by hand. */
export const REFERENCE_SHAPES: readonly Shape[] = [
  polyline([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 80 }], true),
  circle({ x: 15, y: 15 }, 4),
  circle({ x: 105, y: 15 }, 4),
  circle({ x: 15, y: 65 }, 4),
  circle({ x: 105, y: 65 }, 4),
  segment({ x: 45, y: 35 }, { x: 75, y: 35 }),
  arc({ x: 75, y: 40 }, 5, 1.5 * Math.PI, Math.PI),
  segment({ x: 75, y: 45 }, { x: 45, y: 45 }),
  arc({ x: 45, y: 40 }, 5, 0.5 * Math.PI, Math.PI),
  polyline(
    [
      { x: 66, y: 62 },
      { x: 63, y: 62 + 3 * r3 },
      { x: 57, y: 62 + 3 * r3 },
      { x: 54, y: 62 },
      { x: 57, y: 62 - 3 * r3 },
      { x: 63, y: 62 - 3 * r3 },
    ],
    true,
  ),
  segment({ x: 10, y: 40 }, { x: 20, y: 40 + 10 * r3 }),
  segment({ x: 20, y: 40 + 10 * r3 }, { x: 30, y: 40 }),
  segment({ x: 30, y: 40 }, { x: 10, y: 40 }),
  arc({ x: 90, y: 60 }, 10, Math.PI, -Math.PI),
];

/** Largest difference between two shapes' defining numbers, or Infinity if they differ in kind or shape. */
export function shapeDifference(a: Shape, b: Shape): number {
  if (a.kind !== b.kind) return Infinity;
  const diff = (x: number, y: number) => Math.abs(x - y);
  const pt = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.max(diff(p.x, q.x), diff(p.y, q.y));
  switch (a.kind) {
    case 'segment':
      return Math.max(pt(a.start, (b as typeof a).start), pt(a.end, (b as typeof a).end));
    case 'circle':
      return Math.max(pt(a.center, (b as typeof a).center), diff(a.radius, (b as typeof a).radius));
    case 'arc': {
      const o = b as typeof a;
      // Start angles are in [0, 2π); compare round the circle.
      const ds = Math.abs(((a.start - o.start + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return Math.max(pt(a.center, o.center), diff(a.radius, o.radius), ds * a.radius, diff(a.sweep, o.sweep) * a.radius);
    }
    case 'polyline': {
      const o = b as typeof a;
      if (a.closed !== o.closed || a.vertices.length !== o.vertices.length) return Infinity;
      return Math.max(...a.vertices.map((v, i) => Math.max(pt(v, o.vertices[i]!), diff(v.bulge, o.vertices[i]!.bulge))));
    }
  }
}
