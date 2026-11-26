/**
 * Annotation tools: dimensions, text, leaders, centre marks, hatches and title blocks.
 *
 * Dimensions tie themselves to the geometry: a point placed exactly on an end, corner, middle
 * or centre (which is where snaps put it) follows that entity when it changes.
 */
import {
  docEnv,
  HATCH_PATTERNS,
  HATCH_PATTERN_LABELS,
  EMPTY_TITLE_FIELDS,
  pickShapes,
  refAt,
  resolveNote,
  SHEET_SIZES,
  type Doc,
  type NoteBody,
  type PointRef,
} from '../doc';
import { degToRad, isLoop, segment, type Shape, type Vec2 } from '../geom';
import {
  EMPTY_STATE,
  last,
  next,
  NOT_HERE,
  refuse,
  samePoint,
  type CommandCall,
  type Prompt,
  type ToolContext,
  type ToolDef,
  type ToolOption,
  type ToolState,
} from './tool';

const addNote = (body: NoteBody): CommandCall => ({ id: 'note.add', params: { body } });

/** The lines of a note about to be made, for the rubber band. */
function previewBody(doc: Doc, body: NoteBody): Shape[] {
  const r = resolveNote(docEnv(doc), { id: 0, layer: 1, z: 0, color: 'byLayer', lineweight: 'byLayer', body });
  return r.ok ? pickShapes(r.r.prims) : [];
}

const ROUND_ONLY = 'Pick a circle or an arc.';
const SAME = 'That is the same point as the one before.';

function again(s: ToolState): ToolState {
  return { ...EMPTY_STATE, count: s.count + 1 };
}

const refs = (doc: Doc, points: readonly Vec2[]): PointRef[] => points.map((p) => refAt(doc, p));

// ---------- linear and aligned dimensions ----------

function twoPointDimension(id: 'dimLinear' | 'dimAligned', label: string): ToolDef {
  const body = (doc: Doc, points: readonly Vec2[], at: Vec2): NoteBody => {
    const [a, b] = refs(doc, points) as [PointRef, PointRef];
    const style = doc.settings.currentDimStyle;
    if (id === 'dimAligned') return { kind: 'aligned', a, b, at, style };
    const p1 = points[0] as Vec2;
    const p2 = points[1] as Vec2;
    // Placing the line above or below the points measures across; to the side, up and down.
    const horizontal = Math.abs(at.y - (p1.y + p2.y) / 2) >= Math.abs(at.x - (p1.x + p2.x) / 2);
    return { kind: 'linear', orient: horizontal ? 'horizontal' : 'vertical', a, b, at, style };
  };
  return {
    id,
    label,
    start: () => EMPTY_STATE,
    prompt: (s) => ({
      text: ['First point', 'Second point', 'Where the dimension line goes'][s.step] as string,
      accepts: 'point',
      options: [],
      enter: 'finish',
    }),
    base: (s) => (s.points.length > 0 ? last(s.points) : null),
    input(s, i, ctx) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
      if (s.step === 1) {
        if (samePoint(last(s.points), i.point)) return refuse(s, SAME);
        return next({ ...s, step: 2, points: [...s.points, i.point] });
      }
      return next(again(s), [addNote(body(ctx.doc, s.points, i.point))]);
    },
    preview(s, cursor, ctx) {
      if (s.step === 1) return samePoint(last(s.points), cursor) ? [] : [segment(last(s.points), cursor)];
      if (s.step === 2) return previewBody(ctx.doc, body(ctx.doc, s.points, cursor));
      return [];
    },
  };
}

export const dimLinearTool = twoPointDimension('dimLinear', 'Linear dimension');
export const dimAlignedTool = twoPointDimension('dimAligned', 'Aligned dimension');

// ---------- radius and diameter ----------

function roundDimension(id: 'dimRadius' | 'dimDiameter', label: string): ToolDef {
  const kind = id === 'dimRadius' ? 'radius' : 'diameter';
  const body = (ctx: ToolContext, target: number, at: Vec2): NoteBody => ({ kind, target, at, style: ctx.doc.settings.currentDimStyle });
  return {
    id,
    label,
    start: () => EMPTY_STATE,
    prompt: (s): Prompt =>
      s.step === 0
        ? { text: 'Pick a circle or an arc', accepts: 'pick', options: [], enter: 'finish' }
        : { text: kind === 'radius' ? 'Where the dimension goes' : 'Direction of the dimension line', accepts: 'point', options: [], enter: 'finish' },
    base: () => null,
    input(s, i, ctx) {
      if (i.kind === 'enter') return next(null);
      if (s.step === 0 && i.kind === 'pick') {
        const g = ctx.doc.entities.get(i.id)?.geom;
        if (!g || (g.kind !== 'circle' && g.kind !== 'arc')) return refuse(s, ROUND_ONLY);
        return next({ ...s, step: 1, picks: [i] });
      }
      if (s.step === 1 && i.kind === 'point') return next(again(s), [addNote(body(ctx, (s.picks[0] as { id: number }).id, i.point))]);
      return refuse(s, NOT_HERE);
    },
    preview: (s, cursor, ctx) => (s.step === 1 ? previewBody(ctx.doc, body(ctx, (s.picks[0] as { id: number }).id, cursor)) : []),
  };
}

export const dimRadiusTool = roundDimension('dimRadius', 'Radius dimension');
export const dimDiameterTool = roundDimension('dimDiameter', 'Diameter dimension');

// ---------- angle ----------

export const dimAngleTool: ToolDef = {
  id: 'dimAngle',
  label: 'Angle dimension',
  start: () => EMPTY_STATE,
  prompt: (s) => ({
    text: ['Corner of the angle', 'A point on the first side', 'A point on the second side', 'Where the arc goes'][s.step] as string,
    accepts: 'point',
    options: [],
    enter: 'finish',
  }),
  base: (s) => (s.points.length > 0 ? s.points[0] ?? null : null),
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    if (s.step < 3) {
      if (s.points.some((p) => samePoint(p, i.point))) return refuse(s, SAME);
      return next({ ...s, step: s.step + 1, points: [...s.points, i.point] });
    }
    const [vertex, a, b] = refs(ctx.doc, s.points) as [PointRef, PointRef, PointRef];
    return next(again(s), [addNote({ kind: 'angle', vertex, a, b, at: i.point, style: ctx.doc.settings.currentDimStyle })]);
  },
  preview(s, cursor, ctx) {
    const v = s.points[0];
    if (!v) return [];
    if (s.step < 3) return samePoint(v, cursor) ? [] : [segment(v, cursor)];
    const [vertex, a, b] = refs(ctx.doc, s.points) as [PointRef, PointRef, PointRef];
    return previewBody(ctx.doc, { kind: 'angle', vertex, a, b, at: cursor, style: ctx.doc.settings.currentDimStyle });
  },
};

// ---------- text and leaders ----------

const NEED_TEXT = 'Type the text, then press Enter.';

export const textTool: ToolDef = {
  id: 'text',
  label: 'Text',
  start: () => EMPTY_STATE,
  prompt: (s) =>
    s.step === 0
      ? { text: 'Where the text starts', accepts: 'point', options: [], enter: 'finish' }
      : { text: 'Type the text (\\n starts a new line)', accepts: 'text', options: [], enter: 'back' },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      return next({ ...s, step: 1, points: [i.point] });
    }
    if (i.kind === 'enter') return next(again(s));
    if (i.kind !== 'text') return refuse(s, NEED_TEXT);
    if (i.text === '') return refuse(s, NEED_TEXT);
    const style = ctx.doc.settings.dimStyles.find((st) => st.name === ctx.doc.settings.currentDimStyle);
    const body: NoteBody = { kind: 'text', at: s.points[0] as Vec2, height: style?.textHeight ?? 3.5, angle: 0, anchor: 'left', text: i.text };
    return next(again(s), [addNote(body)]);
  },
  preview(s, cursor) {
    const from = s.points[0];
    return s.step === 0 || !from || samePoint(from, cursor) ? [] : [segment(from, cursor)];
  },
};

export const leaderTool: ToolDef = {
  id: 'leader',
  label: 'Leader',
  start: () => EMPTY_STATE,
  prompt(s) {
    if (s.step === 0) return { text: 'Point the arrow at', accepts: 'point', options: [], enter: 'finish' };
    if (s.step === 1) return { text: 'Next point of the leader', accepts: 'point', options: [], enter: 'continue' };
    return { text: 'Type the note, or press Enter for none', accepts: 'text', options: [], enter: 'finish' };
  },
  base: (s) => (s.step < 2 && s.points.length > 0 ? last(s.points) : null),
  input(s, i, ctx) {
    const finish = (text: string) =>
      next(again(s), [addNote({ kind: 'leader', points: s.points, text, style: ctx.doc.settings.currentDimStyle })]);
    if (s.step === 0) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      return next({ ...s, step: 1, points: [i.point] });
    }
    if (s.step === 1) {
      if (i.kind === 'enter') return s.points.length >= 2 ? next({ ...s, step: 2 }) : refuse(s, 'A leader needs at least two points.');
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      if (samePoint(last(s.points), i.point)) return refuse(s, SAME);
      return next({ ...s, points: [...s.points, i.point] });
    }
    if (i.kind === 'enter') return finish('');
    if (i.kind !== 'text') return refuse(s, NEED_TEXT);
    return finish(i.text);
  },
  preview: (s, cursor) => (s.step === 1 && !samePoint(last(s.points), cursor) ? [segment(last(s.points), cursor)] : []),
};

// ---------- centre marks ----------

export const centreMarkTool: ToolDef = {
  id: 'centreMark',
  label: 'Centre mark',
  start: () => EMPTY_STATE,
  prompt: (s) => ({
    text: 'Pick a circle or an arc',
    accepts: 'pick',
    options: [{ key: 'l', label: s.flag ? 'Cross only' : 'Centre lines' }],
    enter: 'finish',
  }),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (i.kind === 'option' && i.key === 'l') return next({ ...s, flag: !s.flag });
    if (i.kind !== 'pick') return refuse(s, NOT_HERE);
    const g = ctx.doc.entities.get(i.id)?.geom;
    if (!g || (g.kind !== 'circle' && g.kind !== 'arc')) return refuse(s, ROUND_ONLY);
    const body: NoteBody = { kind: 'centre', target: i.id, extended: s.flag, style: ctx.doc.settings.currentDimStyle };
    return next({ ...s, count: s.count + 1 }, [addNote(body)]);
  },
  preview: () => [],
};

// ---------- hatch ----------

const HATCH_STATE = { PICK: 0, ISLANDS: 1, ANGLE: 10, SPACING: 11 } as const;

function hatchOptions(ctx: ToolContext): ToolOption[] {
  const m = ctx.memory;
  const options: ToolOption[] = [{ key: 'p', label: `Pattern: ${HATCH_PATTERN_LABELS[m.hatchPattern]}` }];
  if (m.hatchPattern !== 'solid') {
    options.push({ key: 'a', label: `Angle: ${m.hatchAngle}°` }, { key: 's', label: `Spacing: ${m.hatchSpacing}` });
  }
  return options;
}

export const hatchTool: ToolDef = {
  id: 'hatch',
  label: 'Hatch',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    if (s.step === HATCH_STATE.ANGLE) return { text: 'Hatch angle in degrees', accepts: 'number', options: [], defaultValue: ctx.memory.hatchAngle };
    if (s.step === HATCH_STATE.SPACING) return { text: 'Distance between hatch lines', accepts: 'number', options: [], defaultValue: ctx.memory.hatchSpacing };
    if (s.step === HATCH_STATE.PICK) return { text: 'Pick a closed shape to hatch', accepts: 'pick', options: hatchOptions(ctx), enter: 'finish' };
    return { text: 'Pick an island to leave clear, or Enter to hatch', accepts: 'pick', options: hatchOptions(ctx), enter: 'hatch' };
  },
  base: () => null,
  input(s, i, ctx) {
    const m = ctx.memory;
    const back = (s.values[0] ?? 0) as number;
    if (s.step === HATCH_STATE.ANGLE || s.step === HATCH_STATE.SPACING) {
      const value = i.kind === 'number' ? i.value : i.kind === 'enter' ? (s.step === HATCH_STATE.ANGLE ? m.hatchAngle : m.hatchSpacing) : null;
      if (value === null) return refuse(s, 'Type a number.');
      if (s.step === HATCH_STATE.SPACING && !(value > 0)) return refuse(s, 'The spacing must be more than 0.');
      const memory = s.step === HATCH_STATE.ANGLE ? { hatchAngle: value } : { hatchSpacing: value };
      return next({ ...s, step: back, values: [] }, [], { memory });
    }
    if (i.kind === 'option') {
      if (i.key === 'p') {
        const at = HATCH_PATTERNS.indexOf(m.hatchPattern);
        return next(s, [], { memory: { hatchPattern: HATCH_PATTERNS[(at + 1) % HATCH_PATTERNS.length] as typeof m.hatchPattern } });
      }
      if (m.hatchPattern !== 'solid' && i.key === 'a') return next({ ...s, step: HATCH_STATE.ANGLE, values: [s.step] });
      if (m.hatchPattern !== 'solid' && i.key === 's') return next({ ...s, step: HATCH_STATE.SPACING, values: [s.step] });
      return refuse(s, NOT_HERE);
    }
    if (i.kind === 'enter') {
      if (s.step === HATCH_STATE.PICK) return next(null);
      const loops = s.picks.map((p) => [p.id]);
      const body: NoteBody = { kind: 'hatch', loops, pattern: m.hatchPattern, spacing: m.hatchSpacing, angle: degToRad(m.hatchAngle) };
      return next(again(s), [addNote(body)]);
    }
    if (i.kind !== 'pick') return refuse(s, NOT_HERE);
    const g = ctx.doc.entities.get(i.id)?.geom;
    if (!g || !isLoop(g)) return refuse(s, 'That is not a closed shape. Pick a circle or a closed polyline (join separate lines first).');
    if (s.picks.some((p) => p.id === i.id)) return refuse(s, 'That shape is already part of this hatch.');
    return next({ ...s, step: HATCH_STATE.ISLANDS, picks: [...s.picks, i] });
  },
  preview: () => [],
};

// ---------- title block ----------

export const titleBlockTool: ToolDef = {
  id: 'titleBlock',
  label: 'Title block',
  start: () => EMPTY_STATE,
  prompt: (_s, ctx) => ({
    text: `Lower left corner of the ${ctx.memory.sheet} sheet`,
    accepts: 'point',
    options: [{ key: 's', label: `Sheet size: ${ctx.memory.sheet}` }],
    enter: 'finish',
  }),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (i.kind === 'option' && i.key === 's') {
      const at = SHEET_SIZES.indexOf(ctx.memory.sheet);
      return next(s, [], { memory: { sheet: SHEET_SIZES[(at + 1) % SHEET_SIZES.length] as typeof ctx.memory.sheet } });
    }
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    const body: NoteBody = { kind: 'titleBlock', at: i.point, size: ctx.memory.sheet, fields: EMPTY_TITLE_FIELDS };
    return next(null, [addNote(body)]);
  },
  preview: (_s, cursor, ctx) => previewBody(ctx.doc, { kind: 'titleBlock', at: cursor, size: ctx.memory.sheet, fields: EMPTY_TITLE_FIELDS }),
};
