import { describe, expect, it } from 'vitest';
import { createSession, entitiesInDrawOrder, execute, newDocument, type Doc } from '../../../../src/core/doc';
import { arc, circle, polyline, segment, type Shape } from '../../../../src/core/geom';
import {
  arcCenterTool,
  arcTool,
  circleTool,
  DEFAULT_MEMORY,
  DRAW_TOOLS,
  drafting,
  EMPTY_STATE,
  feed,
  IN_A_LINE,
  lineTool,
  NOT_HERE,
  polygonTool,
  polylineTool,
  rectangleTool,
  SAME_POINT,
  startTool,
  type Drafting,
  type ToolContext,
  type ToolDef,
  type ToolId,
  type ToolInput,
  type ToolState,
} from '../../../../src/core/tools';
import { expectPoint } from '../helpers';

const P = (x: number, y: number): ToolInput => ({ kind: 'point', point: { x, y } });
const N = (value: number): ToolInput => ({ kind: 'number', value });
const O = (key: string): ToolInput => ({ kind: 'option', key });
const ENTER: ToolInput = { kind: 'enter' };
const PICK: ToolInput = { kind: 'pick', id: 1, point: { x: 0, y: 0 } };

/** Feeds inputs one by one; every input must be accepted. */
function run(id: ToolId, inputs: readonly ToolInput[], d: Drafting = drafting(createSession(newDocument()))): Drafting {
  let out = startTool(d, id);
  for (const i of inputs) {
    const r = feed(out, i);
    expect(r.error, JSON.stringify(i)).toBeNull();
    out = r.drafting;
  }
  return out;
}

const shapes = (d: Drafting | Doc): Shape[] => entitiesInDrawOrder('session' in d ? d.session.doc : d).map((e) => e.geom);

const ctx: ToolContext = { doc: newDocument(), selection: [], memory: DEFAULT_MEMORY };
const st = (patch: Partial<ToolState>): ToolState => ({ ...EMPTY_STATE, ...patch });

/** Checks that a tool refuses an input with the given reason and stays where it was. */
function refuses(tool: ToolDef, s: ToolState, input: ToolInput, reason: string | RegExp, c: ToolContext = ctx) {
  const r = tool.input(s, input, c);
  expect(r.state).toBe(s);
  expect(r.calls).toEqual([]);
  if (typeof reason === 'string') expect(r.error).toBe(reason);
  else expect(r.error).toMatch(reason);
}

describe('line', () => {
  it('chains lines from point to point, one entity each', () => {
    const d = run('line', [P(0, 0), P(10, 0), P(10, 5), ENTER]);
    expect(shapes(d)).toEqual([segment({ x: 0, y: 0 }, { x: 10, y: 0 }), segment({ x: 10, y: 0 }, { x: 10, y: 5 })]);
    expect(d.active).toBeNull();
  });

  it('C closes back to the first point; U undoes the last line', () => {
    const d = run('line', [P(0, 0), P(10, 0), P(10, 5), O('u'), P(0, 5), O('c')]);
    expect(shapes(d)).toEqual([
      segment({ x: 0, y: 0 }, { x: 10, y: 0 }),
      segment({ x: 10, y: 0 }, { x: 0, y: 5 }),
      segment({ x: 0, y: 5 }, { x: 0, y: 0 }),
    ]);
    expect(d.session.redoStack).toHaveLength(0);
  });

  it('closing when already back at the start adds nothing more', () => {
    expect(shapes(run('line', [P(0, 0), P(1, 0), P(0, 0), O('c')]))).toHaveLength(2);
  });

  it('prompts offer undo after one line and close after two', () => {
    expect(lineTool.prompt(EMPTY_STATE, ctx)).toEqual({ text: 'First point', accepts: 'point', options: [], enter: 'finish' });
    expect(lineTool.prompt(st({ step: 1, points: [{ x: 0, y: 0 }] }), ctx).options).toEqual([]);
    expect(lineTool.prompt(st({ step: 1, count: 1 }), ctx).options.map((o) => o.key)).toEqual(['u']);
    expect(lineTool.prompt(st({ step: 1, count: 2 }), ctx).options.map((o) => o.key)).toEqual(['u', 'c']);
  });

  it('refuses a repeated point, unknown options and numbers', () => {
    const s = st({ step: 1, points: [{ x: 1, y: 1 }] });
    refuses(lineTool, s, P(1, 1), SAME_POINT);
    refuses(lineTool, s, O('u'), NOT_HERE);
    refuses(lineTool, s, O('c'), NOT_HERE);
    refuses(lineTool, s, O('z'), NOT_HERE);
    refuses(lineTool, s, N(5), NOT_HERE);
  });

  it('previews a rubber band from the last point', () => {
    expect(lineTool.base(EMPTY_STATE)).toBeNull();
    expect(lineTool.preview(EMPTY_STATE, { x: 5, y: 5 }, ctx)).toEqual([]);
    const s = st({ step: 1, points: [{ x: 1, y: 1 }] });
    expect(lineTool.base(s)).toEqual({ x: 1, y: 1 });
    expect(lineTool.preview(s, { x: 5, y: 5 }, ctx)).toEqual([segment({ x: 1, y: 1 }, { x: 5, y: 5 })]);
    expect(lineTool.preview(s, { x: 1, y: 1 }, ctx)).toEqual([]);
  });
});

describe('polyline', () => {
  it('Enter makes one open polyline', () => {
    expect(shapes(run('polyline', [P(0, 0), P(10, 0), P(10, 5), ENTER]))).toEqual([
      polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], false),
    ]);
  });

  it('C closes it; U drops the last point', () => {
    expect(shapes(run('polyline', [P(0, 0), P(10, 0), P(9, 9), O('u'), P(10, 5), O('c')]))).toEqual([
      polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], true),
    ]);
  });

  it('ending on the first point before closing does not repeat that corner', () => {
    expect(shapes(run('polyline', [P(0, 0), P(10, 0), P(10, 5), P(0, 0), O('c')]))).toEqual([
      polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], true),
    ]);
  });

  it('fewer than two points makes nothing', () => {
    expect(shapes(run('polyline', [ENTER]))).toEqual([]);
    expect(shapes(run('polyline', [P(1, 1), ENTER]))).toEqual([]);
  });

  it('prompts, refusals and preview', () => {
    expect(polylineTool.prompt(EMPTY_STATE, ctx).text).toBe('First point');
    expect(polylineTool.prompt(st({ step: 1, points: [{ x: 0, y: 0 }] }), ctx).options).toEqual([]);
    expect(polylineTool.prompt(st({ step: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }), ctx).options.map((o) => o.key)).toEqual([
      'u',
      'c',
    ]);
    const two = st({ step: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    refuses(polylineTool, two, P(1, 0), SAME_POINT);
    refuses(polylineTool, two, O('c'), NOT_HERE);
    refuses(polylineTool, st({ step: 1, points: [{ x: 0, y: 0 }] }), O('u'), NOT_HERE);
    refuses(polylineTool, two, N(1), NOT_HERE);
    refuses(polylineTool, st({ step: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }] }), O('c'), /at least three corners/);
    expect(polylineTool.base(EMPTY_STATE)).toBeNull();
    expect(polylineTool.base(two)).toEqual({ x: 1, y: 0 });
    expect(polylineTool.preview(EMPTY_STATE, { x: 0, y: 0 }, ctx)).toEqual([]);
    expect(polylineTool.preview(two, { x: 2, y: 2 }, ctx)).toEqual([polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 2 }])]);
  });
});

describe('circle', () => {
  it('by radius, by a point on it, by diameter, and by the remembered radius', () => {
    const d = run('circle', [P(0, 0), N(4), P(10, 0), P(13, 4), P(20, 0), O('d'), N(8), P(30, 0), ENTER, ENTER]);
    expect(shapes(d)).toEqual([circle({ x: 0, y: 0 }, 4), circle({ x: 10, y: 0 }, 5), circle({ x: 20, y: 0 }, 4), circle({ x: 30, y: 0 }, 4)]);
    expect(d.memory.radius).toBe(4);
    expect(d.active).toBeNull();
  });

  it('prompts offer the remembered size, as a diameter when asked', () => {
    expect(circleTool.prompt(EMPTY_STATE, ctx).text).toBe('Centre');
    const s = st({ step: 1, points: [{ x: 0, y: 0 }] });
    expect(circleTool.prompt(s, ctx)).toEqual({
      text: 'Radius, or a point on the circle',
      accepts: 'pointOrNumber',
      options: [{ key: 'd', label: 'Type a diameter instead' }],
    });
    const remembered = { ...ctx, memory: { ...DEFAULT_MEMORY, radius: 2.5 } };
    expect(circleTool.prompt(s, remembered).defaultValue).toBe(2.5);
    const dia = circleTool.prompt({ ...s, flag: true }, remembered);
    expect(dia.defaultValue).toBe(5);
    expect(dia.options[0]?.label).toBe('Type a radius instead');
  });

  it('refuses a zero or negative size, and Enter with nothing to remember', () => {
    const s = st({ step: 1, points: [{ x: 0, y: 0 }] });
    refuses(circleTool, s, N(0), 'The size must be more than 0.');
    refuses(circleTool, s, N(-2), 'The size must be more than 0.');
    refuses(circleTool, s, P(0, 0), 'The size must be more than 0.');
    refuses(circleTool, s, ENTER, /Type a radius/);
    refuses(circleTool, s, O('x'), NOT_HERE);
    refuses(circleTool, s, PICK, NOT_HERE);
    refuses(circleTool, EMPTY_STATE, N(3), NOT_HERE);
  });

  it('previews the circle through the cursor', () => {
    const s = st({ step: 1, points: [{ x: 1, y: 1 }] });
    expect(circleTool.base(EMPTY_STATE)).toBeNull();
    expect(circleTool.base(s)).toEqual({ x: 1, y: 1 });
    expect(circleTool.preview(EMPTY_STATE, { x: 0, y: 0 }, ctx)).toEqual([]);
    expect(circleTool.preview(s, { x: 4, y: 5 }, ctx)).toEqual([circle({ x: 1, y: 1 }, 5)]);
    expect(circleTool.preview(s, { x: 1, y: 1 }, ctx)).toEqual([]);
  });
});

describe('arc through three points', () => {
  it('start, a point on the arc, end', () => {
    const d = run('arc', [P(80, 60), P(90, 70), P(100, 60), ENTER]);
    const [a] = shapes(d);
    expect(a?.kind).toBe('arc');
    const got = a as ReturnType<typeof arc>;
    expectPoint(got.center, { x: 90, y: 60 });
    expect(got.radius).toBeCloseTo(10, 12);
    expect(got.sweep).toBeCloseTo(-Math.PI, 12);
  });

  it('refuses repeated or collinear points and anything but points', () => {
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    const two = st({ step: 2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    refuses(arcTool, one, P(0, 0), /differ/);
    refuses(arcTool, two, P(1, 1), /differ/);
    refuses(arcTool, two, P(2, 2), IN_A_LINE);
    refuses(arcTool, two, N(2), NOT_HERE);
  });

  it('prompts and previews each step', () => {
    expect(arcTool.prompt(EMPTY_STATE, ctx).text).toBe('Start point');
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    const two = st({ step: 2, points: [{ x: -1, y: 0 }, { x: 0, y: 1 }] });
    expect(arcTool.prompt(one, ctx).text).toBe('A point on the arc');
    expect(arcTool.prompt(two, ctx).text).toBe('End point');
    expect(arcTool.base(EMPTY_STATE)).toBeNull();
    expect(arcTool.base(two)).toEqual({ x: 0, y: 1 });
    expect(arcTool.preview(EMPTY_STATE, { x: 1, y: 0 }, ctx)).toEqual([]);
    expect(arcTool.preview(one, { x: 1, y: 0 }, ctx)).toEqual([segment({ x: 0, y: 0 }, { x: 1, y: 0 })]);
    expect(arcTool.preview(two, { x: 1, y: 0 }, ctx)[0]?.kind).toBe('arc');
    expect(arcTool.preview(two, { x: 1, y: 2 }, ctx)).toEqual([]);
  });
});

describe('arc from its centre', () => {
  it('ends at a point, anticlockwise by default or clockwise with D, or turns a typed angle', () => {
    const d = run('arcCenter', [P(0, 0), P(10, 0), P(0, 10), P(0, 0), P(10, 0), O('d'), P(0, 10), P(5, 5), P(5, 15), N(-90), ENTER]);
    expect(shapes(d)).toEqual([
      arc({ x: 0, y: 0 }, 10, 0, Math.PI / 2),
      arc({ x: 0, y: 0 }, 10, 0, -1.5 * Math.PI),
      arc({ x: 5, y: 5 }, 10, Math.PI / 2, -Math.PI / 2),
    ]);
  });

  it('refuses a start on the centre, no turn, and angles outside 0° to 360°', () => {
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    const two = st({ step: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    refuses(arcCenterTool, EMPTY_STATE, N(1), NOT_HERE);
    refuses(arcCenterTool, one, N(1), NOT_HERE);
    refuses(arcCenterTool, one, P(0, 0), /must differ from the centre/);
    refuses(arcCenterTool, two, P(20, 0), /different direction/);
    refuses(arcCenterTool, two, P(0, 0), /different direction/);
    for (const v of [0, 360, -360, 400]) refuses(arcCenterTool, two, N(v), /more than 0° and less than 360°/);
    refuses(arcCenterTool, two, O('x'), NOT_HERE);
    refuses(arcCenterTool, two, PICK, NOT_HERE);
  });

  it('prompts and previews each step', () => {
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    const two = st({ step: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(arcCenterTool.prompt(EMPTY_STATE, ctx).text).toBe('Centre');
    expect(arcCenterTool.prompt(one, ctx).text).toBe('Start point');
    expect(arcCenterTool.prompt(two, ctx).options[0]?.label).toBe('Turn clockwise');
    expect(arcCenterTool.prompt({ ...two, flag: true }, ctx).options[0]?.label).toBe('Turn anticlockwise');
    expect(arcCenterTool.base(EMPTY_STATE)).toBeNull();
    expect(arcCenterTool.base(two)).toEqual({ x: 0, y: 0 });
    expect(arcCenterTool.preview(EMPTY_STATE, { x: 1, y: 1 }, ctx)).toEqual([]);
    expect(arcCenterTool.preview(one, { x: 1, y: 1 }, ctx)).toEqual([segment({ x: 0, y: 0 }, { x: 1, y: 1 })]);
    expect(arcCenterTool.preview(two, { x: 0, y: 5 }, ctx)).toEqual([arc({ x: 0, y: 0 }, 10, 0, Math.PI / 2)]);
    expect(arcCenterTool.preview(two, { x: 5, y: 0 }, ctx)).toEqual([]);
  });
});

describe('rectangle', () => {
  it('from two corners, again and again', () => {
    expect(shapes(run('rectangle', [P(0, 0), P(4, 3), P(10, 10), P(8, 12), ENTER]))).toEqual([
      polyline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], true),
      polyline([{ x: 10, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 12 }, { x: 10, y: 12 }], true),
    ]);
  });

  it('refuses a flat rectangle and non-points', () => {
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    refuses(rectangleTool, one, P(0, 5), /width and a height/);
    refuses(rectangleTool, one, P(5, 0), /width and a height/);
    refuses(rectangleTool, one, N(5), NOT_HERE);
  });

  it('prompts and previews', () => {
    const one = st({ step: 1, points: [{ x: 0, y: 0 }] });
    expect(rectangleTool.prompt(EMPTY_STATE, ctx).text).toBe('First corner');
    expect(rectangleTool.prompt(one, ctx).text).toBe('Opposite corner');
    expect(rectangleTool.base(EMPTY_STATE)).toBeNull();
    expect(rectangleTool.base(one)).toEqual({ x: 0, y: 0 });
    expect(rectangleTool.preview(EMPTY_STATE, { x: 1, y: 1 }, ctx)).toEqual([]);
    expect(rectangleTool.preview(one, { x: 0, y: 3 }, ctx)).toEqual([segment({ x: 0, y: 0 }, { x: 0, y: 3 })]);
    expect(rectangleTool.preview(one, { x: 0, y: 0 }, ctx)).toEqual([]);
    expect(rectangleTool.preview(one, { x: 2, y: 3 }, ctx)[0]?.kind).toBe('polyline');
  });
});

describe('polygon', () => {
  it('sides, then centre and corner (or radius), repeating with the same sides', () => {
    const d = run('polygon', [N(4), P(0, 0), P(10, 0), P(50, 50), N(5), ENTER]);
    expect(shapes(d)).toEqual([
      polyline([{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }], true),
      polyline([{ x: 55, y: 50 }, { x: 50, y: 55 }, { x: 45, y: 50 }, { x: 50, y: 45 }], true),
    ]);
    expect(d.memory.sides).toBe(4);
  });

  it('Enter takes the remembered number of sides', () => {
    const d = run('polygon', [ENTER, P(0, 0), N(1), ENTER]);
    expect((shapes(d)[0] as ReturnType<typeof polyline>).vertices).toHaveLength(6);
  });

  it('refuses bad side counts, a corner on the centre and a zero radius', () => {
    const one = st({ step: 1, values: [5] });
    const two = st({ step: 2, values: [5], points: [{ x: 0, y: 0 }] });
    for (const n of [2, 4.5, 1025]) refuses(polygonTool, EMPTY_STATE, N(n), /whole number of sides from 3 to 1024/);
    refuses(polygonTool, EMPTY_STATE, P(1, 1), NOT_HERE);
    refuses(polygonTool, one, N(1), NOT_HERE);
    refuses(polygonTool, two, P(0, 0), /must differ from the centre/);
    refuses(polygonTool, two, N(0), 'The size must be more than 0.');
    refuses(polygonTool, two, O('x'), NOT_HERE);
  });

  it('prompts and previews', () => {
    const one = st({ step: 1, values: [5] });
    const two = st({ step: 2, values: [3], points: [{ x: 0, y: 0 }] });
    expect(polygonTool.prompt(EMPTY_STATE, ctx)).toEqual({ text: 'Number of sides', accepts: 'number', options: [], defaultValue: 6 });
    expect(polygonTool.prompt(one, ctx).text).toBe('Centre');
    expect(polygonTool.prompt(two, ctx).accepts).toBe('pointOrNumber');
    expect(polygonTool.base(one)).toBeNull();
    expect(polygonTool.base(two)).toEqual({ x: 0, y: 0 });
    expect(polygonTool.preview(one, { x: 1, y: 1 }, ctx)).toEqual([]);
    expect(polygonTool.preview(two, { x: 0, y: 0 }, ctx)).toEqual([]);
    expect((polygonTool.preview(two, { x: 2, y: 0 }, ctx)[0] as ReturnType<typeof polyline>).vertices).toHaveLength(3);
  });
});

describe('every drawing tool', () => {
  it('starts empty and stops on Enter at its first step', () => {
    for (const tool of DRAW_TOOLS) {
      const s = tool.start(ctx);
      expect(s).toEqual(EMPTY_STATE);
      const first = tool.id === 'polygon' ? (tool.input(s, ENTER, ctx).state as ToolState) : s;
      expect(tool.input(first, ENTER, ctx).state, tool.id).toBeNull();
    }
  });

  it('refuses to draw on a locked layer, keeping its place', () => {
    let session = createSession(newDocument());
    session = execute(session, 'layer.update', { id: 1, locked: true }).session;
    const d = startTool(drafting(session), 'line');
    const first = feed(d, P(0, 0)).drafting;
    const r = feed(first, P(5, 5));
    expect(r.error).toMatch(/locked/);
    expect(r.drafting).toBe(first);
  });
});

