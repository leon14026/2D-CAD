/**
 * The Phase 6 reference drawing: a plate with two holes, an angled bracket and one of every kind
 * of annotation. Points are typed; objects are picked by clicking at the given drawing
 * coordinates, each at least 2 mm from anything else so a click can only mean one thing.
 *
 * tests/unit/core/tools/annotate-reference.test.ts runs these steps through the drafting engine;
 * tests/e2e/annotate.spec.ts types and clicks them into the app. Both must produce exactly the
 * approved drawing in annotate-reference.archilite.
 */
import type { ModifyStep } from './modify-reference';

const t = (text: string): ModifyStep => ({ type: text });
const ENTER: ModifyStep = { enter: true };
const pick = (x: number, y: number): ModifyStep => ({ pick: [x, y] });

// Where each hole's rim is clicked: 45° round from the centre of the Ø8 hole and 225° round from
// the centre of the Ø10 hole. Both are clear of the centre lines (which cross the rim at 0°, 90°,
// 180° and 270°) and of the dimension texts.
const RIM_A: [number, number] = [15 + 4 * Math.SQRT1_2, 20 + 4 * Math.SQRT1_2];
const RIM_B: [number, number] = [45 - 5 * Math.SQRT1_2, 20 - 5 * Math.SQRT1_2];

export const ANNOTATE_STEPS: readonly ModifyStep[] = [
  // A 60 × 40 plate with a Ø8 hole and a Ø10 hole.
  { tool: 'rectangle' }, t('0,0'), t('@60,40'), ENTER,
  { tool: 'circle' }, t('15,20'), t('4'), ENTER,
  { tool: 'circle' }, t('45,20'), t('5'), ENTER,
  // An angled bracket: two lines 45° apart from one corner.
  { tool: 'line' }, t('80,0'), t('110,0'), ENTER,
  { tool: 'line' }, t('80,0'), t('100,20'), ENTER,
  // Dimensions: across the plate, along the angled line, the 45° between the lines, and the holes.
  { tool: 'dimLinear' }, { option: 'r' }, t('0,0'), t('60,0'), t('30,-10'), ENTER,
  { tool: 'dimAligned' }, t('80,0'), t('100,20'), t('82,22'), ENTER,
  { tool: 'dimAngle' }, t('80,0'), t('110,0'), t('100,20'), t('105,8'), ENTER,
  { tool: 'dimDiameter' }, pick(...RIM_A), t('15,35'), ENTER,
  { tool: 'dimRadius' }, pick(...RIM_B), t('56,24'), ENTER,
  // A centre mark on the larger hole.
  { tool: 'centreMark' }, pick(...RIM_B), ENTER,
  // Text and a leader with its note.
  { tool: 'text' }, t('80,32'), t('6 mm steel plate'), ENTER,
  { tool: 'leader' }, t('45,40'), t('52,48'), ENTER, t('Break sharp edges'),
  // The plate hatched, leaving both holes clear: lines every 4 at 45°.
  { tool: 'hatch' }, { option: 's' }, t('4'), pick(45, 0), pick(...RIM_A), pick(...RIM_B), ENTER, ENTER,
  // A title block on an A4 sheet, with the plate near its middle.
  { tool: 'titleBlock' }, t('-120,-70'), ENTER,
];
