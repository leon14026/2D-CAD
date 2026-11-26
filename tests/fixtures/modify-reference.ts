/**
 * The Phase 5 reference drawing: a plate made with every modify tool. Points are typed; objects
 * are picked by clicking at the given drawing coordinates, each at least 2 mm from anything
 * else so a click can only mean one thing.
 *
 * tests/unit/core/tools/modify-reference.test.ts runs these steps through the drafting engine;
 * tests/e2e/modify.spec.ts types and clicks them into the app. Both must produce exactly the
 * approved drawing in modify-reference.archilite, and the hand-worked checks in
 * MODIFY_REFERENCE_CHECKS.
 */
import { arc, circle, polyline, segment, type Shape } from '../../src/core/geom';
import type { ToolId } from '../../src/core/tools';

export type ModifyStep =
  | { readonly tool: ToolId }
  | { readonly type: string }
  | { readonly option: string }
  | { readonly enter: true }
  /** Click an object at this point while a tool asks for a pick. */
  | { readonly pick: readonly [number, number] }
  /** Select exactly these objects, each clicked at a point (no tool active). */
  | { readonly select: readonly (readonly [number, number])[] }
  /** Join or explode what is selected. */
  | { readonly action: 'join' | 'explode' };

const t = (text: string): ModifyStep => ({ type: text });
const ENTER: ModifyStep = { enter: true };
const pick = (x: number, y: number): ModifyStep => ({ pick: [x, y] });

export const MODIFY_STEPS: readonly ModifyStep[] = [
  // A 120 × 80 plate with its four corners rounded to radius 10, one corner at a time.
  { tool: 'rectangle' }, t('0,0'), t('@120,80'), ENTER,
  { tool: 'fillet' }, t('10'), pick(20, 0), pick(0, 20), pick(100, 0), pick(120, 20), pick(120, 60), pick(100, 80), pick(20, 80), pick(0, 60), ENTER,
  // An inner outline 5 inside it.
  { tool: 'offset' }, t('5'), pick(60, 0), t('60,40'), ENTER,
  // One hole, arrayed 2 × 2.
  { tool: 'circle' }, t('20,20'), t('4'), ENTER,
  { select: [[24, 20]] },
  { tool: 'array' }, t('2'), t('2'), t('80'), t('40'),
  // A line extended to a vertical line, which is then trimmed inside a ring.
  { select: [] },
  { tool: 'line' }, t('30,40'), t('@25,0'), ENTER,
  { tool: 'line' }, t('60,10'), t('@0,60'), ENTER,
  { tool: 'extend' }, pick(54, 40), ENTER,
  { tool: 'circle' }, t('60,40'), t('10'), ENTER,
  { tool: 'trim' }, pick(60, 45), pick(60, 35), ENTER,
  // A radius-3 fillet and a 2 × 2 chamfer between pairs of lines.
  { tool: 'line' }, t('70,55'), t('@20,0'), ENTER,
  { tool: 'line' }, t('95,60'), t('@0,12'), ENTER,
  { tool: 'fillet' }, t('3'), pick(75, 55), pick(95, 68), ENTER,
  { tool: 'line' }, t('25,72'), t('@15,0'), ENTER,
  { tool: 'line' }, t('45,70'), t('@0,-10'), ENTER,
  { tool: 'chamfer' }, t('2'), ENTER, pick(30, 72), pick(45, 65), ENTER,
  // The filleted corner mirrored across the plate's centre line x = 60, keeping the original.
  { select: [[80, 55], [95, 65], [94.12132034355964, 55.87867965644036]] },
  { tool: 'mirror' }, t('60,0'), t('60,80'),
  // A small circle arrayed four times round the ring's centre.
  { select: [] },
  { tool: 'circle' }, t('60,62'), t('1.5'), ENTER,
  { select: [[61.5, 62]] },
  { tool: 'polarArray' }, t('60,40'), t('4'), ENTER,
  // A square turned 30°, doubled in size, moved down 2, then copied 90 to the left.
  { select: [] },
  { tool: 'polygon' }, t('4'), t('105,40'), t('@3,0'), ENTER,
  { select: [[106.5, 41.5]] },
  { tool: 'rotate' }, t('105,40'), t('30'),
  { tool: 'scale' }, t('105,40'), t('2'),
  { tool: 'move' }, t('105,40'), t('@0,-2'),
  { tool: 'copy' }, t('105,38'), t('@-90,0'), ENTER,
  // Two lines joined into one polyline, and the copied square exploded into its four sides.
  { select: [] },
  { tool: 'line' }, t('130,0'), t('@10,0'), t('@0,10'), ENTER,
  { select: [[135, 0], [140, 5]] },
  { action: 'join' },
  { select: [[16.098076211353316, 42.09807621135332]] },
  { action: 'explode' },
];

const k = Math.tan(Math.PI / 8);
const r3 = Math.sqrt(3);

/** Hand-worked checks: each is an entity id and the shape it must have, to 1e-9. */
export const MODIFY_REFERENCE_CHECKS: readonly { readonly id: number; readonly what: string; readonly shape: Shape }[] = [
  {
    id: 2,
    what: 'the plate, corners rounded to radius 10',
    shape: polyline(
      [
        { x: 0, y: 10, bulge: k },
        { x: 10, y: 0 },
        { x: 110, y: 0, bulge: k },
        { x: 120, y: 10 },
        { x: 120, y: 70, bulge: k },
        { x: 110, y: 80 },
        { x: 10, y: 80, bulge: k },
        { x: 0, y: 70 },
      ],
      true,
    ),
  },
  {
    id: 3,
    what: 'the inner outline, 5 inside, corner radius 5',
    shape: polyline(
      [
        { x: 5, y: 10, bulge: k },
        { x: 10, y: 5 },
        { x: 110, y: 5, bulge: k },
        { x: 115, y: 10 },
        { x: 115, y: 70, bulge: k },
        { x: 110, y: 75 },
        { x: 10, y: 75, bulge: k },
        { x: 5, y: 70 },
      ],
      true,
    ),
  },
  { id: 4, what: 'the first hole', shape: circle({ x: 20, y: 20 }, 4) },
  { id: 5, what: 'hole, one column across', shape: circle({ x: 100, y: 20 }, 4) },
  { id: 6, what: 'hole, one row up', shape: circle({ x: 20, y: 60 }, 4) },
  { id: 7, what: 'hole, across and up', shape: circle({ x: 100, y: 60 }, 4) },
  { id: 8, what: 'the line extended to x = 60', shape: segment({ x: 30, y: 40 }, { x: 60, y: 40 }) },
  { id: 9, what: 'the lower piece of the trimmed vertical line', shape: segment({ x: 60, y: 10 }, { x: 60, y: 30 }) },
  { id: 11, what: 'the upper piece of the trimmed vertical line', shape: segment({ x: 60, y: 50 }, { x: 60, y: 70 }) },
  { id: 12, what: 'first filleted line, cut back to the tangent point', shape: segment({ x: 70, y: 55 }, { x: 92, y: 55 }) },
  { id: 13, what: 'second filleted line, extended down to the tangent point', shape: segment({ x: 95, y: 58 }, { x: 95, y: 72 }) },
  { id: 14, what: 'the radius-3 fillet', shape: arc({ x: 92, y: 58 }, 3, 1.5 * Math.PI, 0.5 * Math.PI) },
  { id: 15, what: 'first chamfered line', shape: segment({ x: 25, y: 72 }, { x: 43, y: 72 }) },
  { id: 16, what: 'second chamfered line', shape: segment({ x: 45, y: 70 }, { x: 45, y: 60 }) },
  { id: 17, what: 'the chamfer', shape: segment({ x: 43, y: 72 }, { x: 45, y: 70 }) },
  { id: 18, what: 'mirrored first line', shape: segment({ x: 50, y: 55 }, { x: 28, y: 55 }) },
  { id: 19, what: 'mirrored second line', shape: segment({ x: 25, y: 58 }, { x: 25, y: 72 }) },
  { id: 20, what: 'mirrored fillet, now turning clockwise', shape: arc({ x: 28, y: 58 }, 3, 1.5 * Math.PI, -0.5 * Math.PI) },
  { id: 22, what: 'polar copy a quarter turn round', shape: circle({ x: 38, y: 40 }, 1.5) },
  { id: 23, what: 'polar copy a half turn round', shape: circle({ x: 60, y: 18 }, 1.5) },
  { id: 24, what: 'polar copy three quarters round', shape: circle({ x: 82, y: 40 }, 1.5) },
  {
    id: 25,
    what: 'the square: turned 30°, doubled, moved down 2',
    shape: polyline(
      [
        { x: 105 + 3 * r3, y: 41 },
        { x: 102, y: 38 + 3 * r3 },
        { x: 105 - 3 * r3, y: 35 },
        { x: 108, y: 38 - 3 * r3 },
      ],
      true,
    ),
  },
  { id: 27, what: 'the joined lines', shape: polyline([{ x: 130, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 10 }], false) },
  { id: 26, what: 'the copied square, exploded: its first side', shape: segment({ x: 15 + 3 * r3, y: 41 }, { x: 12, y: 38 + 3 * r3 }) },
  { id: 31, what: 'the copied square, exploded: its last side', shape: segment({ x: 18, y: 38 - 3 * r3 }, { x: 15 + 3 * r3, y: 41 }) },
];
