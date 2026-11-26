import { describe, expect, it } from 'vitest';
import { createSession, newDocument, type Doc } from '../../../../src/core/doc';
import { circle, rectangle, segment } from '../../../../src/core/geom';
import {
  arrayTool,
  chamferTool,
  copyTool,
  cutCornersTool,
  DEFAULT_MEMORY,
  drafting,
  EMPTY_STATE,
  extendTool,
  feed,
  filletTool,
  MODIFY_TOOLS,
  mirrorTool,
  moveTool,
  NOT_HERE,
  offsetTool,
  polarArrayTool,
  rotateTool,
  roundCornersTool,
  scaleTool,
  startTool,
  trimTool,
  type ToolContext,
  type ToolDef,
  type ToolInput,
  type ToolMemory,
  type ToolState,
} from '../../../../src/core/tools';
import { docOf } from '../docs';

const P = (x: number, y: number): ToolInput => ({ kind: 'point', point: { x, y } });
const N = (value: number): ToolInput => ({ kind: 'number', value });
const O = (key: string): ToolInput => ({ kind: 'option', key });
const PICK = (id: number, x = 0, y = 0): ToolInput => ({ kind: 'pick', id, point: { x, y } });
const ENTER: ToolInput = { kind: 'enter' };

const st = (patch: Partial<ToolState>): ToolState => ({ ...EMPTY_STATE, ...patch });

function ctxOf(doc: Doc = newDocument(), selection: number[] = [], memory: Partial<ToolMemory> = {}): ToolContext {
  return { doc, selection, memory: { ...DEFAULT_MEMORY, ...memory } };
}

/** The commands a tool returns for an input; the input must be accepted. */
function calls(tool: ToolDef, s: ToolState, i: ToolInput, c: ToolContext = ctxOf()) {
  const r = tool.input(s, i, c);
  expect(r.error, JSON.stringify(i)).toBeUndefined();
  return r;
}

function refuses(tool: ToolDef, s: ToolState, i: ToolInput, reason: string | RegExp, c: ToolContext = ctxOf()) {
  const r = tool.input(s, i, c);
  expect(r.state).toBe(s);
  expect(r.calls).toEqual([]);
  if (typeof reason === 'string') expect(r.error).toBe(reason);
  else expect(r.error).toMatch(reason);
}

const line = (): { doc: Doc; ids: number[] } => docOf([segment({ x: 0, y: 0 }, { x: 10, y: 0 }), rectangle({ x: 20, y: 0 }, { x: 30, y: 10 })]);

describe('tools that work on a selection', () => {
  const selectionTools = [moveTool, copyTool, rotateTool, scaleTool, mirrorTool, arrayTool, polarArrayTool, roundCornersTool, cutCornersTool];

  it('start on what is selected, or ask for a selection first', () => {
    for (const t of selectionTools) {
      expect(t.start(ctxOf(newDocument(), [4, 5])), t.id).toEqual(st({ step: 1, ids: [4, 5] }));
      const s = t.start(ctxOf());
      expect(s).toEqual(EMPTY_STATE);
      expect(t.prompt(s, ctxOf())).toEqual({ text: 'Select the objects, then press Enter', accepts: 'select', options: [], enter: 'continue' });
      refuses(t, s, ENTER, /Select at least one object first/);
      refuses(t, s, P(1, 1), NOT_HERE);
      expect(calls(t, s, ENTER, ctxOf(newDocument(), [7])).state).toEqual(st({ step: 1, ids: [7] }));
    }
  });

  it('Enter at the second step stops, except where it takes a default', () => {
    for (const t of [moveTool, copyTool, rotateTool, scaleTool, mirrorTool, arrayTool, polarArrayTool]) {
      expect(t.input(st({ step: 1, ids: [1] }), ENTER, ctxOf()).state, t.id).toBeNull();
    }
  });
});

describe('move and copy', () => {
  it('move: base point, then where it goes; one command', () => {
    const s1 = st({ step: 1, ids: [2] });
    expect(moveTool.prompt(s1, ctxOf()).text).toBe('Base point');
    const s2 = calls(moveTool, s1, P(1, 1)).state as ToolState;
    expect(moveTool.prompt(s2, ctxOf()).text).toBe('Where it goes');
    expect(moveTool.base(s2)).toEqual({ x: 1, y: 1 });
    expect(moveTool.base(s1)).toBeNull();
    const r = calls(moveTool, s2, P(4, 5));
    expect(r.state).toBeNull();
    expect(r.calls).toEqual([{ id: 'entity.transform', params: { ids: [2], transform: { kind: 'translate', dx: 3, dy: 4 } } }]);
    refuses(moveTool, s2, N(3), NOT_HERE);
  });

  it('copy keeps placing copies until Enter', () => {
    const s2 = st({ step: 2, ids: [2], points: [{ x: 0, y: 0 }] });
    expect(copyTool.prompt(s2, ctxOf()).text).toBe('Where the copy goes');
    const r = calls(copyTool, s2, P(5, 0));
    expect(r.calls[0]?.id).toBe('entity.copy');
    expect(r.state).toEqual({ ...s2, count: 1 });
    expect(copyTool.input(s2, ENTER, ctxOf()).state).toBeNull();
  });

  it('previews the selection where it would go; missing entities are skipped', () => {
    const { doc, ids } = line();
    const s2 = st({ step: 2, ids: [ids[0]!, 999], points: [{ x: 0, y: 0 }] });
    expect(moveTool.preview(s2, { x: 1, y: 2 }, ctxOf(doc))).toEqual([segment({ x: 1, y: 2 }, { x: 11, y: 2 })]);
    expect(moveTool.preview(st({ step: 1, ids: [ids[0]!] }), { x: 1, y: 2 }, ctxOf(doc))).toEqual([]);
  });
});

describe('rotate, scale and mirror', () => {
  const s2 = st({ step: 2, ids: [2], points: [{ x: 0, y: 0 }] });

  it('rotate by a typed angle or towards a point', () => {
    expect(rotateTool.prompt(st({ step: 1 }), ctxOf()).text).toBe('Centre to turn about');
    expect(rotateTool.prompt(s2, ctxOf()).accepts).toBe('pointOrNumber');
    expect(calls(rotateTool, st({ step: 1, ids: [2] }), P(3, 3)).state).toEqual(st({ step: 2, ids: [2], points: [{ x: 3, y: 3 }] }));
    expect(calls(rotateTool, s2, N(90)).calls[0]?.params).toEqual({ ids: [2], transform: { kind: 'rotate', center: { x: 0, y: 0 }, angle: Math.PI / 2 } });
    expect(calls(rotateTool, s2, P(0, 5)).calls[0]?.params).toEqual({ ids: [2], transform: { kind: 'rotate', center: { x: 0, y: 0 }, angle: Math.PI / 2 } });
    refuses(rotateTool, s2, P(0, 0), /other than the centre/);
    refuses(rotateTool, s2, O('x'), NOT_HERE);
    refuses(rotateTool, st({ step: 1, ids: [2] }), N(3), NOT_HERE);
    expect(rotateTool.base(s2)).toEqual({ x: 0, y: 0 });
    expect(rotateTool.base(st({ step: 1 }))).toBeNull();
  });

  it('rotate previews the turn towards the cursor', () => {
    const { doc, ids } = line();
    const s = st({ step: 2, ids: [ids[0]!], points: [{ x: 0, y: 0 }] });
    expect(rotateTool.preview(s, { x: 0, y: 3 }, ctxOf(doc))).toEqual([segment({ x: 0, y: 0 }, { x: 0, y: 10 })]);
    expect(rotateTool.preview(s, { x: 0, y: 0 }, ctxOf(doc))).toEqual([]);
    expect(rotateTool.preview(st({ step: 1 }), { x: 0, y: 3 }, ctxOf(doc))).toEqual([]);
  });

  it('scale by a factor about a base point', () => {
    expect(scaleTool.prompt(st({ step: 1 }), ctxOf()).text).toMatch(/Base point/);
    expect(scaleTool.prompt(s2, ctxOf()).accepts).toBe('number');
    expect(calls(scaleTool, st({ step: 1, ids: [2] }), P(1, 1)).state).toMatchObject({ step: 2 });
    expect(calls(scaleTool, s2, N(2)).calls[0]).toEqual({ id: 'entity.transform', params: { ids: [2], transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 2 } } });
    refuses(scaleTool, s2, N(0), /more than 0/);
    refuses(scaleTool, s2, P(1, 1), NOT_HERE);
    refuses(scaleTool, st({ step: 1, ids: [2] }), N(1), NOT_HERE);
    expect(scaleTool.base(s2)).toEqual({ x: 0, y: 0 });
    expect(scaleTool.base(st({ step: 1 }))).toBeNull();
    expect(scaleTool.preview(s2, { x: 1, y: 1 }, ctxOf())).toEqual([]);
  });

  it('mirror keeps the originals unless K is pressed', () => {
    expect(mirrorTool.prompt(st({ step: 1 }), ctxOf()).options).toEqual([{ key: 'k', label: 'Remove the originals' }]);
    expect(mirrorTool.prompt({ ...s2, flag: true }, ctxOf()).options).toEqual([{ key: 'k', label: 'Keep the originals' }]);
    expect(calls(mirrorTool, st({ step: 1, ids: [2] }), P(0, 0)).state).toMatchObject({ step: 2 });
    expect(calls(mirrorTool, s2, P(0, 10)).calls[0]?.id).toBe('entity.copy');
    const removing = calls(mirrorTool, s2, O('k')).state as ToolState;
    expect(calls(mirrorTool, removing, P(0, 10)).calls[0]?.id).toBe('entity.transform');
    refuses(mirrorTool, s2, P(0, 0), /two different points/);
    refuses(mirrorTool, s2, N(1), NOT_HERE);
    expect(mirrorTool.base(s2)).toEqual({ x: 0, y: 0 });
    expect(mirrorTool.base(st({ step: 1 }))).toBeNull();
  });

  it('mirror previews across the line to the cursor', () => {
    const { doc, ids } = line();
    const s = st({ step: 2, ids: [ids[0]!], points: [{ x: 0, y: -5 }] });
    expect(mirrorTool.preview(s, { x: 0, y: 5 }, ctxOf(doc))).toEqual([segment({ x: 0, y: 0 }, { x: -10, y: 0 })]);
    expect(mirrorTool.preview(s, { x: 0, y: -5 }, ctxOf(doc))).toEqual([]);
  });
});

describe('offset', () => {
  it('distance, then pick, then side; repeats until Enter', () => {
    expect(offsetTool.prompt(EMPTY_STATE, ctxOf())).toEqual({ text: 'Offset distance', accepts: 'number', options: [] });
    expect(offsetTool.prompt(EMPTY_STATE, ctxOf(newDocument(), [], { offset: 3 })).defaultValue).toBe(3);
    const s1 = calls(offsetTool, EMPTY_STATE, N(2));
    expect(s1.memory).toEqual({ offset: 2 });
    expect(calls(offsetTool, EMPTY_STATE, ENTER, ctxOf(newDocument(), [], { offset: 3 })).state).toMatchObject({ step: 1, values: [3] });
    const picked = calls(offsetTool, s1.state as ToolState, PICK(5, 1, 0)).state as ToolState;
    expect(offsetTool.prompt(s1.state as ToolState, ctxOf()).accepts).toBe('pick');
    expect(offsetTool.prompt(picked, ctxOf()).accepts).toBe('point');
    const r = calls(offsetTool, picked, P(1, 4));
    expect(r.calls).toEqual([{ id: 'entity.offset', params: { id: 5, distance: 2, toward: { x: 1, y: 4 } } }]);
    expect(r.state).toMatchObject({ step: 1, picks: [], count: 1 });
    expect(offsetTool.input(s1.state as ToolState, ENTER, ctxOf()).state).toBeNull();
    expect(offsetTool.base(picked)).toBeNull();
  });

  it('explains what it needs', () => {
    refuses(offsetTool, EMPTY_STATE, ENTER, 'Type the offset distance.');
    refuses(offsetTool, EMPTY_STATE, N(0), /more than 0/);
    refuses(offsetTool, EMPTY_STATE, P(1, 1), NOT_HERE);
    refuses(offsetTool, st({ step: 1, values: [2] }), P(1, 1), NOT_HERE);
    refuses(offsetTool, st({ step: 2, values: [2], picks: [{ id: 1, point: { x: 0, y: 0 } }] }), N(1), NOT_HERE);
  });

  it('previews the offset towards the cursor, or nothing when it can’t', () => {
    const { doc, ids } = docOf([circle({ x: 0, y: 0 }, 5)]);
    const s = st({ step: 2, values: [2], picks: [{ id: ids[0]!, point: { x: 5, y: 0 } }] });
    expect(offsetTool.preview(s, { x: 9, y: 0 }, ctxOf(doc))).toEqual([circle({ x: 0, y: 0 }, 7)]);
    expect(offsetTool.preview({ ...s, values: [6] }, { x: 1, y: 0 }, ctxOf(doc))).toEqual([]);
    expect(offsetTool.preview({ ...s, picks: [{ id: 99, point: { x: 0, y: 0 } }] }, { x: 9, y: 0 }, ctxOf(doc))).toEqual([]);
    expect(offsetTool.preview(st({ step: 1 }), { x: 9, y: 0 }, ctxOf(doc))).toEqual([]);
  });
});

describe('trim and extend', () => {
  it('each pick is one command; Enter stops', () => {
    for (const [t, command] of [[trimTool, 'entity.trim'], [extendTool, 'entity.extend']] as const) {
      expect(t.prompt(EMPTY_STATE, ctxOf()).accepts).toBe('pick');
      const r = calls(t, EMPTY_STATE, PICK(4, 2, 3));
      expect(r.calls).toEqual([{ id: command, params: { id: 4, pick: { x: 2, y: 3 } } }]);
      expect(r.state).toMatchObject({ count: 1 });
      refuses(t, EMPTY_STATE, P(1, 1), NOT_HERE);
      expect(t.input(EMPTY_STATE, ENTER, ctxOf()).state).toBeNull();
      expect(t.base(EMPTY_STATE)).toBeNull();
      expect(t.preview(EMPTY_STATE, { x: 0, y: 0 }, ctxOf())).toEqual([]);
    }
  });
});

describe('fillet and chamfer', () => {
  it('fillet: radius (remembered, 0 by default), then two picks; repeats', () => {
    expect(filletTool.prompt(EMPTY_STATE, ctxOf()).defaultValue).toBe(0);
    const s1 = calls(filletTool, EMPTY_STATE, N(3));
    expect(s1.memory).toEqual({ fillet: 3 });
    expect(calls(filletTool, EMPTY_STATE, ENTER).state).toMatchObject({ step: 1, values: [0] });
    const s2 = calls(filletTool, s1.state as ToolState, PICK(1, 1, 0)).state as ToolState;
    expect(filletTool.prompt(s1.state as ToolState, ctxOf()).text).toBe('Pick the first line');
    expect(filletTool.prompt(s2, ctxOf()).text).toBe('Pick the second line');
    const r = calls(filletTool, s2, PICK(2, 0, 1));
    expect(r.calls).toEqual([{ id: 'entity.fillet', params: { first: { id: 1, point: { x: 1, y: 0 } }, second: { id: 2, point: { x: 0, y: 1 } }, radius: 3 } }]);
    expect(r.state).toMatchObject({ step: 1, picks: [] });
    refuses(filletTool, EMPTY_STATE, N(-1), /0 or more/);
    refuses(filletTool, EMPTY_STATE, P(1, 1), NOT_HERE);
    refuses(filletTool, s2, P(1, 1), NOT_HERE);
    expect(filletTool.input(s2, ENTER, ctxOf()).state).toBeNull();
    expect(filletTool.base(s2)).toBeNull();
    expect(filletTool.preview(s2, { x: 0, y: 0 }, ctxOf())).toEqual([]);
  });

  it('chamfer: two distances (the second defaults to the first), then two picks', () => {
    expect(chamferTool.prompt(EMPTY_STATE, ctxOf())).toEqual({ text: 'Distance along the first line', accepts: 'number', options: [] });
    expect(chamferTool.prompt(EMPTY_STATE, ctxOf(newDocument(), [], { chamfer: 1.5 })).defaultValue).toBe(1.5);
    refuses(chamferTool, EMPTY_STATE, ENTER, 'Type the chamfer distance.');
    const a = calls(chamferTool, EMPTY_STATE, ENTER, ctxOf(newDocument(), [], { chamfer: 1.5 }));
    expect(a.memory).toEqual({ chamfer: 1.5 });
    const s1 = a.state as ToolState;
    expect(chamferTool.prompt(s1, ctxOf()).defaultValue).toBe(1.5);
    const s2 = calls(chamferTool, s1, ENTER).state as ToolState;
    expect(s2).toMatchObject({ step: 2, values: [1.5, 1.5] });
    expect(calls(chamferTool, s1, N(4)).memory).toBeUndefined();
    const s3 = calls(chamferTool, s2, PICK(1)).state as ToolState;
    expect(chamferTool.prompt(s2, ctxOf()).text).toBe('Pick the first line');
    expect(chamferTool.prompt(s3, ctxOf()).text).toBe('Pick the second line');
    expect(calls(chamferTool, s3, PICK(2)).calls[0]).toEqual({
      id: 'entity.chamfer',
      params: { first: { id: 1, point: { x: 0, y: 0 } }, second: { id: 2, point: { x: 0, y: 0 } }, distance1: 1.5, distance2: 1.5 },
    });
    refuses(chamferTool, s1, N(-1), /0 or more/);
    refuses(chamferTool, s1, PICK(1), NOT_HERE);
    refuses(chamferTool, s2, N(1), NOT_HERE);
    expect(chamferTool.input(s2, ENTER, ctxOf()).state).toBeNull();
    expect(chamferTool.base(s2)).toBeNull();
    expect(chamferTool.preview(s2, { x: 0, y: 0 }, ctxOf())).toEqual([]);
  });
});

describe('arrays', () => {
  it('rectangular: columns, rows, then the two spacings', () => {
    let s = st({ step: 1, ids: [3] });
    const texts: string[] = [];
    for (const v of [3, 2, 10]) {
      texts.push(arrayTool.prompt(s, ctxOf()).text);
      s = calls(arrayTool, s, N(v)).state as ToolState;
    }
    texts.push(arrayTool.prompt(s, ctxOf()).text);
    expect(texts).toEqual(['Number of columns (across)', 'Number of rows (up)', 'Distance between columns', 'Distance between rows']);
    const r = calls(arrayTool, s, N(-5));
    expect(r.calls).toEqual([{ id: 'entity.array', params: { ids: [3], kind: 'rectangular', columns: 3, rows: 2, dx: 10, dy: -5 } }]);
    expect(r.state).toBeNull();
    expect(arrayTool.base(s)).toBeNull();
    expect(arrayTool.preview(s, { x: 0, y: 0 }, ctxOf())).toEqual([]);
  });

  it('rectangular: refuses non-whole numbers and a single copy', () => {
    const s1 = st({ step: 1, ids: [3] });
    refuses(arrayTool, s1, N(0), /whole number of 1 or more/);
    refuses(arrayTool, s1, N(1.5), /whole number of 1 or more/);
    refuses(arrayTool, s1, P(1, 1), NOT_HERE);
    refuses(arrayTool, st({ step: 2, ids: [3], values: [1] }), N(1), /more than one column or row/);
    refuses(arrayTool, st({ step: 3, ids: [3], values: [2, 1] }), P(1, 1), NOT_HERE);
  });

  it('polar: centre, number of items, angle (360 by default)', () => {
    const s1 = st({ step: 1, ids: [3] });
    expect(polarArrayTool.prompt(s1, ctxOf()).text).toBe('Centre of the array');
    const s2 = calls(polarArrayTool, s1, P(5, 5)).state as ToolState;
    expect(polarArrayTool.prompt(s2, ctxOf()).text).toMatch(/Number of items/);
    const s3 = calls(polarArrayTool, s2, N(6)).state as ToolState;
    expect(polarArrayTool.prompt(s3, ctxOf()).defaultValue).toBe(360);
    expect(calls(polarArrayTool, s3, ENTER).calls[0]?.params).toEqual({ ids: [3], kind: 'polar', count: 6, center: { x: 5, y: 5 }, angle: 360, rotate: true });
    expect(calls(polarArrayTool, s3, N(-90)).calls[0]?.params).toMatchObject({ angle: -90 });
    refuses(polarArrayTool, s3, N(0), /between -360° and 360°/);
    refuses(polarArrayTool, s3, N(361), /between -360° and 360°/);
    refuses(polarArrayTool, s3, P(1, 1), NOT_HERE);
    refuses(polarArrayTool, s2, N(1), /whole number of 2 or more/);
    refuses(polarArrayTool, s1, N(1), NOT_HERE);
    expect(polarArrayTool.input(s1, ENTER, ctxOf()).state).toBeNull();
    expect(polarArrayTool.base(s1)).toBeNull();
    expect(polarArrayTool.preview(s1, { x: 0, y: 0 }, ctxOf())).toEqual([]);
  });
});

describe('round or cut every corner', () => {
  it('one command per selected polyline, at the typed size; other shapes are left alone', () => {
    const { doc, ids } = line();
    const s1 = st({ step: 1, ids });
    expect(roundCornersTool.prompt(s1, ctxOf(doc))).toEqual({ text: 'Radius for every corner', accepts: 'number', options: [], enter: 'finish' });
    expect(roundCornersTool.prompt(s1, ctxOf(doc, [], { fillet: 2 })).defaultValue).toBe(2);
    const r = calls(roundCornersTool, s1, N(1), ctxOf(doc));
    expect(r.calls).toEqual([{ id: 'polyline.fillet', params: { id: ids[1], size: 1 } }]);
    expect(r.memory).toEqual({ fillet: 1 });
    expect(calls(cutCornersTool, s1, ENTER, ctxOf(doc, [], { fillet: 2 })).calls).toEqual([{ id: 'polyline.chamfer', params: { id: ids[1], size: 2 } }]);
    expect(roundCornersTool.input(s1, ENTER, ctxOf(doc)).state).toBeNull();
  });

  it('explains a missing polyline or a bad size', () => {
    const { doc, ids } = line();
    refuses(roundCornersTool, st({ step: 1, ids: [ids[0]!] }), N(1), /Only polylines have corners/, ctxOf(doc));
    refuses(roundCornersTool, st({ step: 1, ids }), N(0), /more than 0/, ctxOf(doc));
    refuses(roundCornersTool, st({ step: 1, ids }), O('x'), NOT_HERE, ctxOf(doc));
    expect(roundCornersTool.base(st({ step: 1 }))).toBeNull();
    expect(roundCornersTool.preview(st({ step: 1 }), { x: 0, y: 0 }, ctxOf(doc))).toEqual([]);
  });
});

describe('modify tools through the driver', () => {
  it('a trim pick on empty space is refused by the command, keeping the tool where it was', () => {
    const { session, ids } = docOf([segment({ x: 0, y: 0 }, { x: 10, y: 0 })]);
    const d = startTool(drafting(session), 'trim');
    const r = feed(d, PICK(ids[0]!, 5, 0));
    expect(r.error).toMatch(/Nothing crosses this object/);
    expect(r.drafting).toBe(d);
  });

  it('every modify tool has a label and a unique id', () => {
    expect(new Set(MODIFY_TOOLS.map((t) => t.id)).size).toBe(MODIFY_TOOLS.length);
    for (const t of MODIFY_TOOLS) expect(t.label.length).toBeGreaterThan(0);
  });

  it('a selection tool started with nothing selected asks first', () => {
    const d = startTool(drafting(createSession(newDocument())), 'move');
    expect(d.active?.state.step).toBe(0);
  });
});
