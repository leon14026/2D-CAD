import { describe, expect, it } from 'vitest';
import { createSession, execute, newDocument } from '../../../../src/core/doc';
import { circle, segment } from '../../../../src/core/geom';
import {
  currentPrompt,
  DEFAULT_MEMORY,
  EMPTY_STATE,
  feed,
  startTool,
  TOOLS,
  type Drafting,
  type ToolId,
  type ToolInput,
} from '../../../../src/core/tools';

const P = (x: number, y: number): ToolInput => ({ kind: 'point', point: { x, y } });
const PICK = (id: number, x = 0, y = 0): ToolInput => ({ kind: 'pick', id, point: { x, y } });
const N = (value: number): ToolInput => ({ kind: 'number', value });
const T = (text: string): ToolInput => ({ kind: 'text', text });
const ENTER: ToolInput = { kind: 'enter' };

function blank(): Drafting {
  return { session: createSession(newDocument()), memory: DEFAULT_MEMORY, active: null };
}

function withShapes(...add: { geom: ReturnType<typeof segment> | ReturnType<typeof circle> }[]): Drafting {
  let session = createSession(newDocument());
  for (const a of add) session = execute(session, 'entity.add', a).session;
  return { session, memory: DEFAULT_MEMORY, active: null };
}

function go(d: Drafting, id: ToolId, inputs: ToolInput[], selection: number[] = []): Drafting {
  let cur = startTool(d, id, selection);
  for (const input of inputs) {
    const r = feed(cur, input, selection);
    expect(r.error, r.error ?? '').toBeNull();
    cur = r.drafting;
  }
  return cur;
}

function refused(d: Drafting, id: ToolId, input: ToolInput, why: string | RegExp, selection: number[] = []): void {
  const r = feed(startTool(d, id, selection), input, selection);
  if (typeof why === 'string') expect(r.error).toBe(why);
  else expect(r.error).toMatch(why);
}

describe('layout tools', () => {
  it('makes a block from a selection and inserts another copy', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    let d = go({ session: a.session, memory: DEFAULT_MEMORY, active: null }, 'block', [T('bar'), P(0, 0)], [a.result.id]);
    expect(d.session.doc.blocks[0]?.name).toBe('bar');
    expect(d.session.doc.inserts.size).toBe(1);
    d = go({ ...d, active: null }, 'insert', [P(20, 0)]);
    expect(d.session.doc.inserts.size).toBe(2);
  });

  it('adds horizontal, distance, radius, length and fix constraints on a fresh drawing', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const c = execute(a.session, 'entity.add', { geom: circle({ x: 5, y: 5 }, 2) });
    const d0: Drafting = { session: c.session, memory: DEFAULT_MEMORY, active: null };
    let d = go(d0, 'horizontal', [P(0, 0), P(10, 0)]);
    d = go({ ...d, active: null }, 'constrainDistance', [P(0, 0), P(10, 0), N(12)]);
    d = go({ ...d, active: null }, 'constrainRadius', [PICK(c.result.id, 7, 5), N(3)]);
    d = go({ ...d, active: null }, 'constrainLength', [PICK(a.result.id, 6, 0), N(15)]);
    const start = d.session.doc.entities.get(a.result.id);
    const g = start?.geom;
    const fixAt = g && g.kind === 'segment' ? g.start : { x: 0, y: 0 };
    d = go({ ...d, active: null }, 'fix', [P(fixAt.x, fixAt.y)]);
    expect(d.session.doc.constraints.size).toBeGreaterThanOrEqual(4);
  });

  it('refuses a block with no selection and a radius on a line', () => {
    refused(blank(), 'block', ENTER, /Select at least one object/);
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 1, y: 0 }) });
    refused({ session: a.session, memory: DEFAULT_MEMORY, active: null }, 'constrainRadius', PICK(a.result.id), /circle or an arc/);
  });

  it('refuses free points, a missing block name, and a length on a circle', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const circ = execute(a.session, 'entity.add', { geom: circle({ x: 5, y: 5 }, 2) });
    const d: Drafting = { session: circ.session, memory: DEFAULT_MEMORY, active: null };
    const first = startTool(d, 'coincident');
    const mid = feed(first, P(0, 0));
    expect(mid.error).toBeNull();
    expect(feed(mid.drafting, P(99, 99)).error).toMatch(/sit on drawn shapes/);
    refused(blank(), 'insert', T('  '), /Type the name of the block/);
    refused(d, 'constrainLength', PICK(circ.result.id), /Pick a line/);
    refused(d, 'constrainAngle', PICK(circ.result.id), /Pick a line/);
    refused(d, 'fix', P(99, 99), /sit on a drawn shape/);
    refused(d, 'midpointConstraint', P(99, 99), /sit on a drawn shape/);
  });

  it('adds parallel, concentric and tangent constraints from picks', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const b = execute(a.session, 'entity.add', { geom: segment({ x: 0, y: 2 }, { x: 8, y: 3 }) });
    const c1 = execute(b.session, 'entity.add', { geom: circle({ x: 2, y: 8 }, 1) });
    const c2 = execute(c1.session, 'entity.add', { geom: circle({ x: 6, y: 8 }, 1) });
    let d: Drafting = { session: c2.session, memory: DEFAULT_MEMORY, active: null };
    d = go(d, 'parallel', [PICK(a.result.id), PICK(b.result.id)]);
    d = go({ ...d, active: null }, 'concentric', [PICK(c1.result.id), PICK(c2.result.id)]);
    d = go({ ...d, active: null }, 'tangent', [PICK(c1.result.id), PICK(a.result.id)]);
    expect(d.session.doc.constraints.size).toBe(3);
  });

  it('covers remaining prompts, cancels and refusals', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const b = execute(a.session, 'entity.add', { geom: segment({ x: 0, y: 4 }, { x: 0, y: 12 }) });
    const c = execute(b.session, 'entity.add', { geom: circle({ x: 5, y: 5 }, 2) });
    const d0: Drafting = { session: c.session, memory: DEFAULT_MEMORY, active: null };
    const sel = [a.result.id];

    let d = startTool(blank(), 'block');
    expect(currentPrompt(d)?.text).toMatch(/Select the objects/);
    expect(feed(d, P(0, 0)).error).toBeTruthy();
    d = startTool(d0, 'block', sel);
    expect(currentPrompt(d)?.text).toMatch(/Type a name/);
    expect(feed(d, T('  '), sel).error).toMatch(/Type a name/);
    d = go(d0, 'block', [T('Q'), ENTER], sel);
    expect(d.active).toBeNull();
    expect(feed(go(d0, 'block', [T('Q')], sel), { kind: 'option', key: 'x' }).error).toBeTruthy();

    const made = go(d0, 'block', [T('Q'), P(0, 0)], sel);
    expect(
      TOOLS.insert.preview(
        { step: 0, points: [], values: [], picks: [], flag: false, count: 0, ids: [] },
        { x: 0, y: 0 },
        { doc: made.session.doc, selection: [], memory: made.memory },
      ),
    ).toEqual([]);
    expect(feed(startTool({ ...made, active: null }, 'insert'), ENTER).drafting.active).toBeNull();
    expect(feed(startTool({ ...made, active: null }, 'insert'), T('no')).error).toBeTruthy();
    expect(
      TOOLS.insert.input(
        { step: 1, points: [], values: [], picks: [], flag: false, count: 0, ids: [] },
        P(1, 1),
        { doc: newDocument(), selection: [], memory: DEFAULT_MEMORY },
      ).error,
    ).toMatch(/no block to insert/);

    const twoBlocks = runSessionWithTwoBlocks();
    d = startTool({ session: twoBlocks, memory: DEFAULT_MEMORY, active: null }, 'insert');
    expect(currentPrompt(d)?.text).toMatch(/Type the block name/);
    d = go({ session: twoBlocks, memory: DEFAULT_MEMORY, active: null }, 'insert', [T('Q'), P(1, 1)]);
    expect(d.session.doc.inserts.size).toBeGreaterThan(2);

    go(d0, 'vertical', [P(0, 4), P(0, 12)]);
    go(d0, 'equal', [PICK(a.result.id), PICK(b.result.id)]);
    go(d0, 'perpendicular', [PICK(a.result.id), PICK(b.result.id)]);
    go(d0, 'constrainAngle', [PICK(a.result.id), PICK(b.result.id), N(90)]);
    go(d0, 'midpointConstraint', [P(0, 0), PICK(b.result.id)]);
    go(d0, 'coincident', [ENTER]);
    expect(feed(startTool(d0, 'parallel'), PICK(a.result.id)).error).toBeNull();
    expect(feed(feed(startTool(d0, 'parallel'), PICK(a.result.id)).drafting, PICK(a.result.id)).error).toMatch(/two different/);
    expect(feed(startTool(d0, 'constrainDistance'), N(1)).error).toBeTruthy();
    const dist = feed(startTool(d0, 'constrainDistance'), P(0, 0));
    expect(feed(dist.drafting, N(1)).error).toBeTruthy();
    const dist2 = feed(dist.drafting, P(10, 0));
    expect(feed(dist2.drafting, N(0)).error).toMatch(/greater than 0/);
    expect(feed(dist2.drafting, P(1, 1)).error).toBeTruthy();
    expect(feed(startTool(d0, 'constrainRadius'), N(1)).error).toBeTruthy();
    expect(feed(feed(startTool(d0, 'constrainRadius'), PICK(c.result.id)).drafting, N(0)).error).toMatch(/greater than 0/);
    expect(feed(startTool(d0, 'constrainLength'), N(1)).error).toBeTruthy();
    expect(feed(feed(startTool(d0, 'constrainLength'), PICK(a.result.id)).drafting, N(0)).error).toMatch(/greater than 0/);
    expect(feed(startTool(d0, 'constrainAngle'), N(90)).error).toBeTruthy();
    expect(feed(feed(startTool(d0, 'constrainAngle'), PICK(a.result.id)).drafting, PICK(a.result.id)).error).toMatch(/two different/);
    expect(feed(go(d0, 'constrainAngle', [PICK(a.result.id), PICK(b.result.id)]), N(180)).error).toMatch(/between 0° and 180/);
    expect(feed(startTool(d0, 'fix'), N(1)).error).toBeTruthy();
    expect(feed(startTool(d0, 'midpointConstraint'), N(1)).error).toBeTruthy();
    expect(feed(feed(startTool(d0, 'midpointConstraint'), P(0, 0)).drafting, N(1)).error).toBeTruthy();
    expect(feed(feed(startTool(d0, 'midpointConstraint'), P(0, 0)).drafting, PICK(c.result.id)).error).toMatch(/Pick a line/);
    expect(TOOLS.horizontal.base({ step: 0, points: [], values: [], picks: [], flag: false, count: 0, ids: [] })).toBeNull();

    const ctx = { doc: made.session.doc, selection: sel, memory: made.memory };
    const cursor = { x: 0, y: 0 };
    const ids: ToolId[] = [
      'block',
      'insert',
      'coincident',
      'horizontal',
      'vertical',
      'parallel',
      'perpendicular',
      'equal',
      'concentric',
      'tangent',
      'constrainDistance',
      'constrainRadius',
      'constrainLength',
      'constrainAngle',
      'fix',
      'midpointConstraint',
    ];
    for (const id of ids) {
      const t = TOOLS[id];
      const s = t.start(ctx);
      t.prompt(s, ctx);
      t.base(s);
      t.preview(s, cursor, ctx);
      t.input(s, ENTER, ctx);
      t.input(s, N(1), ctx);
      t.prompt({ ...s, step: 1, points: [{ x: 0, y: 0 }], picks: [{ id: a.result.id, point: cursor }] }, ctx);
      t.prompt({ ...s, step: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], picks: [{ id: a.result.id, point: cursor }] }, ctx);
      t.base({ ...s, step: 1, points: [{ x: 0, y: 0 }] });
    }
    expect(feed(startTool(d0, 'block'), ENTER, sel).error).toBeNull();
    const namedInsert = feed(startTool({ session: twoBlocks, memory: DEFAULT_MEMORY, active: null }, 'insert'), T('Q'));
    expect(feed(namedInsert.drafting, ENTER).drafting.active).toBeNull();
    expect(feed(namedInsert.drafting, N(1)).error).toBeTruthy();
    const distFree = feed(feed(startTool(d0, 'constrainDistance'), P(99, 99)).drafting, P(98, 98));
    expect(feed(distFree.drafting, N(5)).error).toMatch(/sit on drawn shapes/);
  });

  it('editConstraint types a new number onto the selected driving dimension', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const dim = execute(a.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: a.result.id, end: 'start' },
        b: { kind: 'end', id: a.result.id, end: 'end' },
        at: { x: 5, y: -4 },
        style: 'ISO',
      },
    });
    const nid = dim.result.id;
    const cid = dim.session.doc.notes.get(nid)!.drive!;
    const d0: Drafting = { session: dim.session, memory: DEFAULT_MEMORY, active: null };
    expect(currentPrompt(startTool(d0, 'editConstraint', [nid]))?.text).toBe('New value');
    expect(currentPrompt(startTool(d0, 'editConstraint', [cid]))?.text).toBe('New value');
    expect(feed(startTool(d0, 'editConstraint', [cid]), N(16)).error).toBeNull();
    expect(feed(startTool(d0, 'editConstraint', [cid]), N(16)).drafting.session.doc.constraints.get(cid)?.body).toMatchObject({
      value: 16,
    });
    expect(feed(startTool(d0, 'editConstraint', [cid]), ENTER).drafting.active).toBeNull();
    expect(feed(startTool(blank(), 'editConstraint'), N(1)).error).toMatch(/Pick a driving dimension/);
    expect(currentPrompt(startTool(blank(), 'editConstraint'))?.text).toMatch(/Nothing to edit/);
    const horiz = execute(a.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.result.id, end: 'start' }, b: { kind: 'end', id: a.result.id, end: 'end' } },
    });
    const hid = [...horiz.session.doc.constraints.values()].find((c) => c.body.kind === 'horizontal')!.id;
    const ctxH = { doc: horiz.session.doc, selection: [hid], memory: DEFAULT_MEMORY };
    expect(TOOLS.editConstraint.input({ ...EMPTY_STATE, ids: [hid] }, N(1), ctxH).error).toMatch(/no value to change/);
    const ctx = { doc: dim.session.doc, selection: [cid], memory: DEFAULT_MEMORY };
    const t = TOOLS.editConstraint;
    const s = t.start(ctx);
    t.prompt(s, ctx);
    t.base(s);
    t.preview(s, { x: 0, y: 0 }, ctx);
    t.input(s, { kind: 'text', text: 'x' }, ctx);
    t.prompt({ ...EMPTY_STATE, ids: [hid] }, ctxH);
    t.prompt({ ...EMPTY_STATE, ids: [999_999] }, ctx);
    expect(t.input({ ...EMPTY_STATE, ids: [999_999] }, N(1), ctx).error).toMatch(/no value to change/);
    expect(
      TOOLS.block.input({ ...EMPTY_STATE, step: 2, ids: [a.result.id] }, P(0, 0), { doc: a.session.doc, selection: [], memory: DEFAULT_MEMORY }).calls[0]
        ?.params,
    ).toMatchObject({ name: 'Block' });
    const angA = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) });
    const angB = execute(angA.session, 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 0, y: 10 }) });
    const ang = execute(angB.session, 'constraint.add', { body: { kind: 'angle', a: angA.result.id, b: angB.result.id, value: Math.PI / 2 } });
    const aid = [...ang.session.doc.constraints.keys()][0]!;
    const dAng: Drafting = { session: ang.session, memory: DEFAULT_MEMORY, active: null };
    expect(currentPrompt(startTool(dAng, 'editConstraint', [aid]))?.defaultValue).toBe(90);
    expect(feed(startTool(dAng, 'editConstraint', [aid]), N(45)).error).toBeNull();
    const dH: Drafting = { session: horiz.session, memory: DEFAULT_MEMORY, active: null };
    expect(currentPrompt(startTool(dH, 'editConstraint', [hid]))?.text).toMatch(/Nothing to edit/);
  });
});

function runSessionWithTwoBlocks() {
  const a = execute(createSession(newDocument()), 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 1, y: 0 }) });
  const s1 = execute(a.session, 'block.create', { name: 'Q', ids: [a.result.id], at: { x: 0, y: 0 } }).session;
  const b = execute(s1, 'entity.add', { geom: segment({ x: 2, y: 0 }, { x: 3, y: 0 }) });
  return execute(b.session, 'block.create', { name: 'R', ids: [b.result.id], at: { x: 2, y: 0 } }).session;
}
