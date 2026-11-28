/**
 * Tools for blocks, inserts and constraints. Sheets are switched from the command palette.
 */
import {
  constraintDisplayValue,
  constraintHasValue,
  constraintStoredValue,
  drivingNoteOf,
  refAt,
} from '../doc';
import { degToRad, radToDeg, type Vec2 } from '../geom';
import { EMPTY_STATE, NOT_HERE, next, refuse, type Prompt, type ToolContext, type ToolDef, type ToolInput, type ToolResult, type ToolState } from './tool';

const ask = (text: string, accepts: Prompt['accepts'], extra: Partial<Prompt> = {}): Prompt => ({
  text,
  accepts,
  options: [],
  ...extra,
});

const SELECT_FIRST = 'Select at least one object first, then press Enter.';

function takeSelection(s: ToolState, i: ToolInput, ctx: ToolContext): ToolResult {
  if (i.kind !== 'enter') return refuse(s, NOT_HERE);
  if (ctx.selection.length === 0) return refuse(s, SELECT_FIRST);
  return next({ ...s, step: 1, ids: [...ctx.selection] });
}

export const blockTool: ToolDef = {
  id: 'block',
  label: 'Block',
  start: (ctx) => (ctx.selection.length > 0 ? { ...EMPTY_STATE, step: 1, ids: [...ctx.selection] } : EMPTY_STATE),
  prompt: (s) =>
    s.step === 0
      ? ask('Select the objects to turn into a block, then press Enter', 'select', { enter: 'continue' })
      : s.step === 1
        ? ask('Type a name for the block', 'text')
        : ask('Base point (where the block is inserted)', 'point', { enter: 'finish' }),
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0) return takeSelection(s, i, ctx);
    if (s.step === 1) {
      if (i.kind !== 'text' || i.text.trim() === '') return refuse(s, 'Type a name for the block.');
      return next({ ...s, step: 2, flag: true, values: [] }, [], { memory: { blockName: i.text.trim() } });
    }
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    const name = ctx.memory.blockName ?? 'Block';
    return next(null, [{ id: 'block.create', params: { name, ids: s.ids, at: i.point } }]);
  },
  preview: () => [],
};

export const insertTool: ToolDef = {
  id: 'insert',
  label: 'Insert block',
  start: () => EMPTY_STATE,
  prompt: (s, ctx) => {
    if (s.step === 0 && ctx.doc.blocks.length === 1) return ask('Insertion point', 'point', { enter: 'finish' });
    if (s.step === 0) return ask('Type the block name', 'text');
    return ask('Insertion point', 'point', { enter: 'finish' });
  },
  base: () => null,
  input(s, i, ctx) {
    if (s.step === 0 && ctx.doc.blocks.length === 1) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      const name = ctx.doc.blocks[0]!.name;
      return next({ ...s, count: s.count + 1 }, [{ id: 'block.insert', params: { name, at: i.point } }]);
    }
    if (s.step === 0) {
      if (i.kind !== 'text' || i.text.trim() === '') return refuse(s, 'Type the name of the block to insert.');
      return next({ ...s, step: 1 }, [], { memory: { blockName: i.text.trim() } });
    }
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    const name = ctx.memory.blockName ?? ctx.doc.blocks[0]?.name;
    if (!name) return refuse(s, 'There is no block to insert. Make one first.');
    return next({ ...s, count: s.count + 1 }, [{ id: 'block.insert', params: { name, at: i.point } }]);
  },
  preview: () => [],
};

function twoRefConstraint(id: string, label: string, kind: 'coincident' | 'horizontal' | 'vertical'): ToolDef {
  return {
    id,
    label,
    start: () => EMPTY_STATE,
    prompt: (s) => (s.step === 0 ? ask('First point', 'point', { enter: 'finish' }) : ask('Second point', 'point', { enter: 'finish' })),
    base: (s) => (s.step === 1 ? (s.points[0] as Vec2) : null),
    input(s, i, ctx) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
      const a = refAt(ctx.doc, s.points[0] as Vec2);
      const b = refAt(ctx.doc, i.point);
      if (a.kind === 'free' || b.kind === 'free') return refuse(s, 'Those points must sit on drawn shapes.');
      return next(null, [{ id: 'constraint.add', params: { body: { kind, a, b } } }]);
    },
    preview: () => [],
  };
}

export const coincidentTool = twoRefConstraint('coincident', 'Coincident', 'coincident');
export const horizontalTool = twoRefConstraint('horizontal', 'Horizontal', 'horizontal');
export const verticalTool = twoRefConstraint('vertical', 'Vertical', 'vertical');

function twoLineConstraint(id: string, label: string, kind: 'parallel' | 'perpendicular' | 'equal' | 'tangent' | 'concentric'): ToolDef {
  const need = kind === 'concentric' ? 'Pick a circle or an arc' : kind === 'tangent' ? 'Pick a circle, an arc or a line' : 'Pick a line';
  return {
    id,
    label,
    start: () => EMPTY_STATE,
    prompt: (s) => (s.step === 0 ? ask(need, 'pick', { enter: 'finish' }) : ask(need, 'pick', { enter: 'finish' })),
    base: () => null,
    input(s, i) {
      if (i.kind === 'enter') return next(null);
      if (i.kind !== 'pick') return refuse(s, NOT_HERE);
      if (s.step === 0) return next({ ...s, step: 1, picks: [i] });
      const a = (s.picks[0] as { id: number }).id;
      const b = i.id;
      if (a === b) return refuse(s, 'Pick two different objects.');
      return next(null, [{ id: 'constraint.add', params: { body: { kind, a, b } } }]);
    },
    preview: () => [],
  };
}

export const parallelTool = twoLineConstraint('parallel', 'Parallel', 'parallel');
export const perpendicularTool = twoLineConstraint('perpendicular', 'Perpendicular', 'perpendicular');
export const equalTool = twoLineConstraint('equal', 'Equal', 'equal');
export const concentricTool = twoLineConstraint('concentric', 'Concentric', 'concentric');
export const tangentTool = twoLineConstraint('tangent', 'Tangent', 'tangent');

export const distanceConstraintTool: ToolDef = {
  id: 'constrainDistance',
  label: 'Distance constraint',
  start: () => EMPTY_STATE,
  prompt: (s) =>
    s.step === 0
      ? ask('First point', 'point', { enter: 'finish' })
      : s.step === 1
        ? ask('Second point', 'point')
        : ask('Distance', 'number'),
  base: (s) => (s.step === 1 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (s.step === 0) {
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      return next({ ...s, step: 1, points: [i.point] });
    }
    if (s.step === 1) {
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      return next({ ...s, step: 2, points: [...s.points, i.point] });
    }
    if (i.kind !== 'number' || !(i.value > 0)) return refuse(s, 'Type a distance greater than 0.');
    const a = refAt(ctx.doc, s.points[0] as Vec2);
    const b = refAt(ctx.doc, s.points[1] as Vec2);
    if (a.kind === 'free' || b.kind === 'free') return refuse(s, 'Those points must sit on drawn shapes.');
    return next(null, [{ id: 'constraint.add', params: { body: { kind: 'distance', a, b, value: i.value } } }]);
  },
  preview: () => [],
};

export const radiusConstraintTool: ToolDef = {
  id: 'constrainRadius',
  label: 'Radius constraint',
  start: () => EMPTY_STATE,
  prompt: (s) => (s.step === 0 ? ask('Pick a circle or an arc', 'pick', { enter: 'finish' }) : ask('Radius', 'number')),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (s.step === 0) {
      if (i.kind !== 'pick') return refuse(s, NOT_HERE);
      const g = ctx.doc.entities.get(i.id)?.geom;
      if (!g || (g.kind !== 'circle' && g.kind !== 'arc')) return refuse(s, 'Pick a circle or an arc.');
      return next({ ...s, step: 1, picks: [i] });
    }
    if (i.kind !== 'number' || !(i.value > 0)) return refuse(s, 'Type a radius greater than 0.');
    return next(null, [{ id: 'constraint.add', params: { body: { kind: 'radius', target: (s.picks[0] as { id: number }).id, value: i.value } } }]);
  },
  preview: () => [],
};

export const fixTool: ToolDef = {
  id: 'fix',
  label: 'Fix point',
  start: () => EMPTY_STATE,
  prompt: () => ask('Point to hold still', 'point', { enter: 'finish' }),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    const a = refAt(ctx.doc, i.point);
    if (a.kind === 'free') return refuse(s, 'That point must sit on a drawn shape.');
    return next(null, [{ id: 'constraint.add', params: { body: { kind: 'fix', a, p: i.point } } }]);
  },
  preview: () => [],
};

export const lengthConstraintTool: ToolDef = {
  id: 'constrainLength',
  label: 'Length constraint',
  start: () => EMPTY_STATE,
  prompt: (s) => (s.step === 0 ? ask('Pick a line', 'pick', { enter: 'finish' }) : ask('Length', 'number')),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (s.step === 0) {
      if (i.kind !== 'pick') return refuse(s, NOT_HERE);
      if (ctx.doc.entities.get(i.id)?.geom.kind !== 'segment') return refuse(s, 'Pick a line.');
      return next({ ...s, step: 1, picks: [i] });
    }
    if (i.kind !== 'number' || !(i.value > 0)) return refuse(s, 'Type a length greater than 0.');
    return next(null, [{ id: 'constraint.add', params: { body: { kind: 'length', target: (s.picks[0] as { id: number }).id, value: i.value } } }]);
  },
  preview: () => [],
};

export const angleConstraintTool: ToolDef = {
  id: 'constrainAngle',
  label: 'Angle constraint',
  start: () => EMPTY_STATE,
  prompt: (s) =>
    s.step === 0 ? ask('First line', 'pick', { enter: 'finish' }) : s.step === 1 ? ask('Second line', 'pick') : ask('Angle in degrees', 'number'),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (s.step < 2) {
      if (i.kind !== 'pick') return refuse(s, NOT_HERE);
      if (ctx.doc.entities.get(i.id)?.geom.kind !== 'segment') return refuse(s, 'Pick a line.');
      if (s.step === 0) return next({ ...s, step: 1, picks: [i] });
      if (i.id === (s.picks[0] as { id: number }).id) return refuse(s, 'Pick two different lines.');
      return next({ ...s, step: 2, picks: [...s.picks, i] });
    }
    if (i.kind !== 'number' || !(i.value > 0) || i.value >= 180) return refuse(s, 'Type an angle between 0° and 180°, not including the ends.');
    return next(null, [
      {
        id: 'constraint.add',
        params: {
          body: {
            kind: 'angle',
            a: (s.picks[0] as { id: number }).id,
            b: (s.picks[1] as { id: number }).id,
            value: degToRad(i.value),
          },
        },
      },
    ]);
  },
  preview: () => [],
};

export const midpointTool: ToolDef = {
  id: 'midpointConstraint',
  label: 'Midpoint',
  start: () => EMPTY_STATE,
  prompt: (s) => (s.step === 0 ? ask('Point that should sit at the middle', 'point', { enter: 'finish' }) : ask('Pick the line', 'pick')),
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    if (s.step === 0) {
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      const a = refAt(ctx.doc, i.point);
      if (a.kind === 'free') return refuse(s, 'That point must sit on a drawn shape.');
      return next({ ...s, step: 1, points: [i.point] });
    }
    if (i.kind !== 'pick') return refuse(s, NOT_HERE);
    if (ctx.doc.entities.get(i.id)?.geom.kind !== 'segment') return refuse(s, 'Pick a line.');
    const a = refAt(ctx.doc, s.points[0] as Vec2);
    return next(null, [{ id: 'constraint.add', params: { body: { kind: 'midpoint', a, of: i.id } } }]);
  },
  preview: () => [],
};

function constraintToEdit(ctx: ToolContext): number | null {
  for (const id of ctx.selection) {
    const c = ctx.doc.constraints.get(id) ?? drivingNoteOf(ctx.doc, id)?.constraint;
    if (c && constraintHasValue(c.body)) return c.id;
  }
  return null;
}

function displayForEdit(ctx: ToolContext, id: number): number | null {
  const c = ctx.doc.constraints.get(id);
  if (!c) return null;
  const v = constraintDisplayValue(ctx.doc, c);
  if (v === null) return null;
  return c.body.kind === 'angle' ? radToDeg(v) : v;
}

/** Click a driving dimension's number (or pick one) and type a new value. */
export const editConstraintTool: ToolDef = {
  id: 'editConstraint',
  label: 'Edit constraint',
  start: (ctx) => {
    const id = constraintToEdit(ctx);
    return id === null ? EMPTY_STATE : { ...EMPTY_STATE, ids: [id] };
  },
  prompt: (s, ctx) => {
    const id = s.ids[0];
    const shown = id !== undefined ? displayForEdit(ctx, id) : null;
    return ask(shown === null ? 'Nothing to edit. Pick a driving dimension first.' : 'New value', 'number', {
      ...(shown !== null ? { defaultValue: shown } : {}),
      enter: 'finish',
    });
  },
  base: () => null,
  input(s, i, ctx) {
    if (i.kind === 'enter') return next(null);
    const id = s.ids[0] ?? constraintToEdit(ctx);
    if (id === undefined || id === null) return refuse(s, 'Pick a driving dimension, then type a new number.');
    if (i.kind !== 'number') return refuse(s, NOT_HERE);
    const c = ctx.doc.constraints.get(id);
    if (!c || !constraintHasValue(c.body)) return refuse(s, 'This constraint has no value to change.');
    const value = c.body.kind === 'angle' ? degToRad(i.value) : constraintStoredValue(ctx.doc, c, i.value);
    return next(null, [{ id: 'constraint.setValue', params: { id, value } }]);
  },
  preview: () => [],
};
