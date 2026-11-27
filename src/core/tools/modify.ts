/**
 * Modify tools: move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer and
 * the two arrays.
 *
 * Tools that work on a selection use whatever is selected when they start; with nothing
 * selected, they first ask for a selection (select as usual, then Enter). Offset, trim, extend,
 * fillet and chamfer work on objects picked one at a time and repeat until Enter or Esc.
 */
import { insertShapes, type Entity } from '../doc';
import {
  angleOf,
  degToRad,
  mirror,
  offsetToward,
  rotate,
  sub,
  transformShape,
  translate,
  type Shape,
  type Transform,
  type Vec2,
} from '../geom';
import type { Accepts } from './input';
import { EMPTY_STATE, next, NOT_HERE, refuse, samePoint, type Prompt, type ToolContext, type ToolDef, type ToolInput, type ToolResult, type ToolState } from './tool';

const SELECT_FIRST = 'Select at least one object first, then press Enter.';

const ask = (text: string, accepts: Accepts, extra: Partial<Prompt> = {}): Prompt => ({ text, accepts, options: [], ...extra });

/** Starts a selection tool on what is selected, or asks for a selection. */
function startOnSelection(ctx: ToolContext): ToolState {
  return ctx.selection.length > 0 ? { ...EMPTY_STATE, step: 1, ids: [...ctx.selection] } : EMPTY_STATE;
}

const SELECT_PROMPT = ask('Select the objects, then press Enter', 'select', { enter: 'continue' });

/** Step 0 of a selection tool: Enter takes the selection. */
function takeSelection(s: ToolState, i: ToolInput, ctx: ToolContext): ToolResult {
  if (i.kind !== 'enter') return refuse(s, NOT_HERE);
  if (ctx.selection.length === 0) return refuse(s, SELECT_FIRST);
  return next({ ...s, step: 1, ids: [...ctx.selection] });
}

/** The selected shapes moved by a transform, for the preview. */
function moved(s: ToolState, ctx: ToolContext, t: Transform): Shape[] {
  return s.ids.flatMap((id) => {
    const e = ctx.doc.entities.get(id) as Entity | undefined;
    if (e) return [transformShape(t, e.geom)];
    const ins = ctx.doc.inserts.get(id);
    return ins ? insertShapes(ctx.doc, ins).map((g) => transformShape(t, g)) : [];
  });
}

const transformCall = (ids: readonly number[], t: Transform, copy: boolean) => ({ id: copy ? 'entity.copy' : 'entity.transform', params: { ids, transform: t } });

/** Move and copy: a base point, then where it goes. Copy keeps placing copies until Enter. */
function moveLike(id: 'move' | 'copy', label: string, copy: boolean): ToolDef {
  return {
    id,
    label,
    start: startOnSelection,
    prompt: (s) => (s.step === 0 ? SELECT_PROMPT : s.step === 1 ? ask('Base point', 'point', { enter: 'finish' }) : ask(copy ? 'Where the copy goes' : 'Where it goes', 'point', { enter: 'finish' })),
    base: (s) => (s.step === 2 ? (s.points[0] as Vec2) : null),
    input(s, i, ctx) {
      if (s.step === 0) return takeSelection(s, i, ctx);
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      if (s.step === 1) return next({ ...s, step: 2, points: [i.point] });
      const from = s.points[0] as Vec2;
      const call = transformCall(s.ids, translate(i.point.x - from.x, i.point.y - from.y), copy);
      return next(copy ? { ...s, count: s.count + 1 } : null, [call]);
    },
    preview: (s, cursor, ctx) => (s.step === 2 ? moved(s, ctx, translate(cursor.x - (s.points[0] as Vec2).x, cursor.y - (s.points[0] as Vec2).y)) : []),
  };
}

export const moveTool = moveLike('move', 'Move', false);
export const copyTool = moveLike('copy', 'Copy', true);

export const rotateTool: ToolDef = {
  id: 'rotate',
  label: 'Rotate',
  start: startOnSelection,
  prompt: (s) =>
    s.step === 0 ? SELECT_PROMPT : s.step === 1 ? ask('Centre to turn about', 'point', { enter: 'finish' }) : ask('Angle in degrees, or a point to turn towards', 'pointOrNumber', { enter: 'finish' }),
  base: (s) => (s.step === 2 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (i.kind === 'enter') return next(null);
    if (s.step === 1) return i.kind === 'point' ? next({ ...s, step: 2, points: [i.point] }) : refuse(s, NOT_HERE);
    const center = s.points[0] as Vec2;
    if (i.kind === 'number') return next(null, [transformCall(s.ids, rotate(center, degToRad(i.value)), false)]);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    if (samePoint(center, i.point)) return refuse(s, 'Point somewhere other than the centre to give a direction.');
    return next(null, [transformCall(s.ids, rotate(center, angleOf(sub(i.point, center))), false)]);
  },
  preview(s, cursor, ctx) {
    if (s.step !== 2 || samePoint(s.points[0] as Vec2, cursor)) return [];
    const center = s.points[0] as Vec2;
    return moved(s, ctx, rotate(center, angleOf(sub(cursor, center))));
  },
};

export const scaleTool: ToolDef = {
  id: 'scale',
  label: 'Scale',
  start: startOnSelection,
  prompt: (s) => (s.step === 0 ? SELECT_PROMPT : s.step === 1 ? ask('Base point (stays where it is)', 'point', { enter: 'finish' }) : ask('Scale factor', 'number', { enter: 'finish' })),
  base: (s) => (s.step === 2 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (i.kind === 'enter') return next(null);
    if (s.step === 1) return i.kind === 'point' ? next({ ...s, step: 2, points: [i.point] }) : refuse(s, NOT_HERE);
    if (i.kind !== 'number') return refuse(s, NOT_HERE);
    if (!(i.value > 0)) return refuse(s, 'The scale factor must be more than 0.');
    return next(null, [{ id: 'entity.transform', params: { ids: s.ids, transform: { kind: 'scale', center: s.points[0], factor: i.value } } }]);
  },
  preview: () => [],
};

export const mirrorTool: ToolDef = {
  id: 'mirror',
  label: 'Mirror',
  start: startOnSelection,
  prompt(s) {
    if (s.step === 0) return SELECT_PROMPT;
    const keep = { key: 'k', label: s.flag ? 'Keep the originals' : 'Remove the originals' };
    return s.step === 1 ? ask('First point of the mirror line', 'point', { options: [keep], enter: 'finish' }) : ask('Second point of the mirror line', 'point', { options: [keep], enter: 'finish' });
  },
  base: (s) => (s.step === 2 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (i.kind === 'enter') return next(null);
    if (i.kind === 'option' && i.key === 'k') return next({ ...s, flag: !s.flag });
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    if (s.step === 1) return next({ ...s, step: 2, points: [i.point] });
    const a = s.points[0] as Vec2;
    if (samePoint(a, i.point)) return refuse(s, 'The mirror line needs two different points.');
    return next(null, [transformCall(s.ids, mirror(a, i.point), !s.flag)]);
  },
  preview: (s, cursor, ctx) => (s.step === 2 && !samePoint(s.points[0] as Vec2, cursor) ? moved(s, ctx, mirror(s.points[0] as Vec2, cursor)) : []),
};

export const offsetTool: ToolDef = {
  id: 'offset',
  label: 'Offset',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    if (s.step === 0) return ask('Offset distance', 'number', ctx.memory.offset !== null ? { defaultValue: ctx.memory.offset } : {});
    if (s.step === 1) return ask('Pick an object to offset', 'pick', { enter: 'finish' });
    return ask('Click the side to offset towards', 'point', { enter: 'finish' });
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) {
      const d = i.kind === 'number' ? i.value : i.kind === 'enter' ? ctx.memory.offset : undefined;
      if (d === undefined) return refuse(s, NOT_HERE);
      if (d === null) return refuse(s, 'Type the offset distance.');
      if (!(d > 0)) return refuse(s, 'The distance must be more than 0.');
      return next({ ...s, step: 1, values: [d] }, [], { memory: { offset: d } });
    }
    if (i.kind === 'enter') return next(null);
    if (s.step === 1) return i.kind === 'pick' ? next({ ...s, step: 2, picks: [{ id: i.id, point: i.point }] }) : refuse(s, NOT_HERE);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    const pick = s.picks[0] as { id: number };
    return next({ ...s, step: 1, picks: [], count: s.count + 1 }, [{ id: 'entity.offset', params: { id: pick.id, distance: s.values[0], toward: i.point } }]);
  },
  preview(s, cursor, ctx) {
    if (s.step !== 2) return [];
    const e = ctx.doc.entities.get((s.picks[0] as { id: number }).id);
    if (!e) return [];
    try {
      return [offsetToward(e.geom, s.values[0] as number, cursor)];
    } catch {
      return []; // the cursor is on the object, or the offset would turn it inside out
    }
  },
};

/** Trim and extend: pick, pick, pick, each one a command. */
function pickTool(id: 'trim' | 'extend', label: string, text: string, command: string): ToolDef {
  return {
    id,
    label,
    start: () => EMPTY_STATE,
    prompt: () => ask(text, 'pick', { enter: 'finish' }),
    base: () => null,
    input(s, i) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'pick') return refuse(s, NOT_HERE);
      return next({ ...s, count: s.count + 1 }, [{ id: command, params: { id: i.id, pick: i.point } }]);
    },
    preview: () => [],
  };
}

export const trimTool = pickTool('trim', 'Trim', 'Pick the part to cut away', 'entity.trim');
export const extendTool = pickTool('extend', 'Extend', 'Pick near the end to lengthen', 'entity.extend');

export const filletTool: ToolDef = {
  id: 'fillet',
  label: 'Fillet',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    if (s.step === 0) return ask('Fillet radius (0 for a sharp corner)', 'number', { defaultValue: ctx.memory.fillet });
    return ask(s.step === 1 ? 'Pick the first line' : 'Pick the second line', 'pick', { enter: 'finish' });
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) {
      const r = i.kind === 'number' ? i.value : i.kind === 'enter' ? ctx.memory.fillet : null;
      if (r === null) return refuse(s, NOT_HERE);
      if (!(r >= 0)) return refuse(s, 'The radius must be 0 or more.');
      return next({ ...s, step: 1, values: [r] }, [], { memory: { fillet: r } });
    }
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'pick') return refuse(s, NOT_HERE);
    if (s.step === 1) return next({ ...s, step: 2, picks: [{ id: i.id, point: i.point }] });
    const first = s.picks[0] as { id: number; point: Vec2 };
    return next({ ...s, step: 1, picks: [], count: s.count + 1 }, [
      { id: 'entity.fillet', params: { first, second: { id: i.id, point: i.point }, radius: s.values[0] } },
    ]);
  },
  preview: () => [],
};

export const chamferTool: ToolDef = {
  id: 'chamfer',
  label: 'Chamfer',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    const remembered = ctx.memory.chamfer;
    if (s.step === 0) return ask('Distance along the first line', 'number', remembered !== null ? { defaultValue: remembered } : {});
    if (s.step === 1) return ask('Distance along the second line', 'number', { defaultValue: s.values[0] as number });
    return ask(s.step === 2 ? 'Pick the first line' : 'Pick the second line', 'pick', { enter: 'finish' });
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step < 2) {
      const fallback = s.step === 0 ? ctx.memory.chamfer : (s.values[0] as number);
      const d = i.kind === 'number' ? i.value : i.kind === 'enter' ? fallback : undefined;
      if (d === undefined) return refuse(s, NOT_HERE);
      if (d === null) return refuse(s, 'Type the chamfer distance.');
      if (!(d >= 0)) return refuse(s, 'The distance must be 0 or more.');
      return next({ ...s, step: s.step + 1, values: [...s.values, d] }, [], s.step === 0 ? { memory: { chamfer: d } } : {});
    }
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'pick') return refuse(s, NOT_HERE);
    if (s.step === 2) return next({ ...s, step: 3, picks: [{ id: i.id, point: i.point }] });
    const first = s.picks[0] as { id: number; point: Vec2 };
    return next({ ...s, step: 2, picks: [], count: s.count + 1 }, [
      { id: 'entity.chamfer', params: { first, second: { id: i.id, point: i.point }, distance1: s.values[0], distance2: s.values[1] } },
    ]);
  },
  preview: () => [],
};

/** Reads a whole number of at least `min` at the current step, or refuses. */
function wholeNumber(s: ToolState, i: ToolInput, min: number, what: string): number | ToolResult {
  if (i.kind !== 'number') return refuse(s, NOT_HERE);
  if (!Number.isInteger(i.value) || i.value < min) return refuse(s, `The number of ${what} must be a whole number of ${min} or more.`);
  return i.value;
}

export const arrayTool: ToolDef = {
  id: 'array',
  label: 'Rectangular array',
  start: startOnSelection,
  prompt(s) {
    switch (s.step) {
      case 0:
        return SELECT_PROMPT;
      case 1:
        return ask('Number of columns (across)', 'number');
      case 2:
        return ask('Number of rows (up)', 'number');
      case 3:
        return ask('Distance between columns', 'number');
      default:
        return ask('Distance between rows', 'number');
    }
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (i.kind === 'enter') return next(null);
    if (s.step <= 2) {
      const n = wholeNumber(s, i, 1, s.step === 1 ? 'columns' : 'rows');
      if (typeof n !== 'number') return n;
      if (s.step === 2 && n * (s.values[0] as number) < 2) return refuse(s, 'An array needs more than one column or row.');
      return next({ ...s, step: s.step + 1, values: [...s.values, n] });
    }
    if (i.kind !== 'number') return refuse(s, NOT_HERE);
    if (s.step === 3) return next({ ...s, step: 4, values: [...s.values, i.value] });
    const [columns, rows, dx] = s.values as [number, number, number];
    return next(null, [{ id: 'entity.array', params: { ids: s.ids, kind: 'rectangular', columns, rows, dx, dy: i.value } }]);
  },
  preview: () => [],
};

export const polarArrayTool: ToolDef = {
  id: 'polarArray',
  label: 'Polar array',
  start: startOnSelection,
  prompt(s) {
    if (s.step === 0) return SELECT_PROMPT;
    if (s.step === 1) return ask('Centre of the array', 'point', { enter: 'finish' });
    if (s.step === 2) return ask('Number of items, the original included', 'number');
    return ask('Angle to fill, in degrees', 'number', { defaultValue: 360 });
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (s.step === 1) {
      if (i.kind === 'enter') return next(null);
      return i.kind === 'point' ? next({ ...s, step: 2, points: [i.point] }) : refuse(s, NOT_HERE);
    }
    if (s.step === 2) {
      const n = wholeNumber(s, i, 2, 'items');
      return typeof n === 'number' ? next({ ...s, step: 3, values: [n] }) : n;
    }
    const angle = i.kind === 'number' ? i.value : i.kind === 'enter' ? 360 : null;
    if (angle === null) return refuse(s, NOT_HERE);
    if (angle === 0 || Math.abs(angle) > 360) return refuse(s, 'The angle must be between -360° and 360°, and not 0.');
    return next(null, [{ id: 'entity.array', params: { ids: s.ids, kind: 'polar', count: s.values[0], center: s.points[0], angle, rotate: true } }]);
  },
  preview: () => [],
};

/** Round or cut every corner of the selected polylines, all the same size. */
function cornersTool(id: 'roundCorners' | 'cutCorners', label: string, text: string, command: string): ToolDef {
  return {
    id,
    label,
    start: startOnSelection,
    prompt: (s, ctx) => (s.step === 0 ? SELECT_PROMPT : ask(text, 'number', ctx.memory.fillet > 0 ? { defaultValue: ctx.memory.fillet } : { enter: 'finish' })),
    base: () => null,
    input(s, i, ctx) {
      if (s.step === 0) return takeSelection(s, i, ctx);
      const size = i.kind === 'number' ? i.value : i.kind === 'enter' && ctx.memory.fillet > 0 ? ctx.memory.fillet : null;
      if (size === null) return i.kind === 'enter' ? next(null) : refuse(s, NOT_HERE);
      if (!(size > 0)) return refuse(s, 'The size must be more than 0.');
      const polylines = s.ids.filter((eid) => ctx.doc.entities.get(eid)?.geom.kind === 'polyline');
      if (polylines.length === 0) return refuse(s, 'Only polylines have corners. Select a polyline first.');
      return next(
        null,
        polylines.map((eid) => ({ id: command, params: { id: eid, size } })),
        { memory: { fillet: size } },
      );
    },
    preview: () => [],
  };
}

export const roundCornersTool = cornersTool('roundCorners', 'Round every corner', 'Radius for every corner', 'polyline.fillet');
export const cutCornersTool = cornersTool('cutCorners', 'Cut every corner', 'Distance back along each edge', 'polyline.chamfer');

export const MODIFY_TOOLS: readonly ToolDef[] = Object.freeze([
  moveTool,
  copyTool,
  rotateTool,
  scaleTool,
  mirrorTool,
  offsetTool,
  trimTool,
  extendTool,
  filletTool,
  chamferTool,
  arrayTool,
  polarArrayTool,
  roundCornersTool,
  cutCornersTool,
]);
