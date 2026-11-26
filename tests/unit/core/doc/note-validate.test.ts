import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIM_STYLE,
  EMPTY_TITLE_FIELDS,
  MAX_FIELD_LENGTH,
  MAX_LEADER_POINTS,
  MAX_TEXT_LENGTH,
  readDimStyle,
  readNote,
  readNoteBody,
  readPointRef,
  ValidationError,
} from '../../../../src/core/doc';

const why = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.message;
    throw e;
  }
  return 'accepted';
};

const pt = (x: number, y: number) => ({ x, y });
const style = 'ISO';

describe('dimension styles', () => {
  it('read back exactly', () => {
    expect(readDimStyle({ ...DEFAULT_DIM_STYLE }, 's')).toEqual(DEFAULT_DIM_STYLE);
  });

  it('refuse sizes that are zero where they must not be, negative, huge, or places that are not whole', () => {
    const bad = (patch: object) => why(() => readDimStyle({ ...DEFAULT_DIM_STYLE, ...patch }, 's'));
    expect(bad({ textHeight: 0 })).toBe('s.textHeight: must be more than 0, not 0');
    expect(bad({ arrowSize: -1 })).toBe('s.arrowSize: must be more than 0, not -1');
    expect(bad({ extGap: -0.5 })).toBe('s.extGap: must be 0 or more, not -0.5');
    expect(bad({ extOver: 2e9 })).toBe('s.extOver: must be at most 1000000000, not 2000000000');
    expect(bad({ precision: 9 })).toBe('s.precision: must be a whole number from 0 to 8, not 9');
    expect(bad({ anglePrecision: 1.5 })).toBe('s.anglePrecision: must be a whole number from 0 to 8, not 1.5');
    expect(bad({ name: '' })).toContain('s.name');
    expect(bad({ centreMark: 'big' })).toContain('s.centreMark');
    expect(bad({ extra: 1 })).toContain('extra');
    expect(bad({ textGap: 0, extGap: 0, extOver: 0, centreOver: 0, precision: 0, anglePrecision: 8 })).toBe('accepted');
  });
});

describe('point references', () => {
  it('read every kind', () => {
    expect(readPointRef({ kind: 'free', p: pt(1, -0) }, 'r')).toEqual({ kind: 'free', p: pt(1, 0) });
    expect(readPointRef({ kind: 'end', id: 3, end: 'end' }, 'r')).toEqual({ kind: 'end', id: 3, end: 'end' });
    expect(readPointRef({ kind: 'vertex', id: 3, index: 2 }, 'r')).toEqual({ kind: 'vertex', id: 3, index: 2 });
    expect(readPointRef({ kind: 'mid', id: 3 }, 'r')).toEqual({ kind: 'mid', id: 3 });
    expect(readPointRef({ kind: 'center', id: 3 }, 'r')).toEqual({ kind: 'center', id: 3 });
  });

  it('refuse the wrong shape', () => {
    expect(why(() => readPointRef({ kind: 'corner' }, 'r'))).toContain('r.kind');
    expect(why(() => readPointRef({ kind: 'free' }, 'r'))).toContain('p');
    expect(why(() => readPointRef({ kind: 'end', id: 3, end: 'middle' }, 'r'))).toContain('r.end');
    expect(why(() => readPointRef({ kind: 'end', id: 0, end: 'end' }, 'r'))).toContain('r.id');
    expect(why(() => readPointRef({ kind: 'vertex', id: 3, index: -1 }, 'r'))).toBe('r.index: must be a whole number of 0 or more, not -1');
    expect(why(() => readPointRef({ kind: 'vertex', id: 3, index: 1.5 }, 'r'))).toContain('r.index');
    expect(why(() => readPointRef({ kind: 'mid', id: 3, index: 1 }, 'r'))).toContain('index');
    expect(why(() => readPointRef('end', 'r'))).toContain('r');
  });
});

describe('note bodies', () => {
  const ok = (body: object) => readNoteBody(body, 'b');
  const fields = { ...EMPTY_TITLE_FIELDS };

  it('read every kind and give back what they were given (with -0 made 0)', () => {
    const bodies = [
      { kind: 'linear', orient: 'vertical', a: { kind: 'free', p: pt(0, 0) }, b: { kind: 'mid', id: 2 }, at: pt(1, 1), style },
      { kind: 'aligned', a: { kind: 'free', p: pt(0, 0) }, b: { kind: 'center', id: 2 }, at: pt(1, 1), style },
      { kind: 'radius', target: 2, at: pt(1, 1), style },
      { kind: 'diameter', target: 2, at: pt(1, 1), style },
      { kind: 'angle', vertex: { kind: 'free', p: pt(0, 0) }, a: { kind: 'free', p: pt(1, 0) }, b: { kind: 'free', p: pt(0, 1) }, at: pt(1, 1), style },
      { kind: 'text', at: pt(1, 1), height: 3, angle: 0.5, anchor: 'right', text: 'hi' },
      { kind: 'leader', points: [pt(0, 0), pt(1, 1)], text: '', style },
      { kind: 'centre', target: 2, extended: true, style },
      { kind: 'hatch', loops: [[2], [3, 4]], pattern: 'cross', spacing: 2, angle: 1 },
      { kind: 'titleBlock', at: pt(0, 0), size: 'A2', fields },
    ];
    for (const b of bodies) expect(ok(b)).toEqual(b);
    expect((ok({ kind: 'radius', target: 2, at: pt(-0, -0), style }) as { at: { x: number } }).at.x).toBe(0);
    expect(Object.is((ok({ kind: 'radius', target: 2, at: pt(-0, 0), style }) as { at: { x: number } }).at.x, 0)).toBe(true);
  });

  it('refuse unknown kinds, missing and extra fields', () => {
    expect(why(() => ok({ kind: 'arrow' }))).toContain('b.kind');
    expect(why(() => ok({ kind: 'radius', target: 2, at: pt(1, 1) }))).toContain('style');
    expect(why(() => ok({ kind: 'radius', target: 2, at: pt(1, 1), style, text: 'x' }))).toContain('text');
    expect(why(() => ok({ kind: 'radius', target: 0, at: pt(1, 1), style }))).toContain('b.target');
    expect(why(() => ok({ kind: 'linear', orient: 'diagonal', a: { kind: 'mid', id: 2 }, b: { kind: 'mid', id: 3 }, at: pt(0, 0), style }))).toContain('b.orient');
  });

  it('text: not empty, not too long, a real height', () => {
    const text = (patch: object) => why(() => ok({ kind: 'text', at: pt(1, 1), height: 3, angle: 0, anchor: 'left', text: 'x', ...patch }));
    expect(text({ text: '   ' })).toBe('b.text: must not be empty');
    expect(text({ text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })).toBe(`b.text: must be at most ${MAX_TEXT_LENGTH} characters`);
    expect(text({ text: 'x'.repeat(MAX_TEXT_LENGTH) })).toBe('accepted');
    expect(text({ height: 0 })).toContain('b.height');
    expect(text({ anchor: 'middle' })).toContain('b.anchor');
    expect(text({ angle: NaN })).toContain('b.angle');
  });

  it('leaders: 2 to the limit, no repeated points', () => {
    const leader = (points: unknown[]) => why(() => ok({ kind: 'leader', points, text: 'x', style }));
    expect(leader([pt(0, 0)])).toBe('b.points: must have at least 2 points');
    expect(leader(Array.from({ length: MAX_LEADER_POINTS + 1 }, (_, i) => pt(i, 0)))).toBe(`b.points: must have at most ${MAX_LEADER_POINTS} points`);
    expect(leader([pt(0, 0), pt(0, 0)])).toBe('b.points[1]: is the same point as the one before it');
    expect(leader([pt(0, 0), pt(1, 0), pt(0, 0)])).toBe('accepted');
    expect(leader([pt(0, 0), 'x'])).toContain('b.points[1]');
  });

  it('hatches: boundaries listed, none twice, a known pattern and a real spacing', () => {
    const hatch = (patch: object) => why(() => ok({ kind: 'hatch', loops: [[2]], pattern: 'lines', spacing: 2, angle: 0, ...patch }));
    expect(hatch({ loops: [] })).toBe('b.loops: must have at least one boundary');
    expect(hatch({ loops: [[]] })).toBe('b.loops[0]: must list at least one id');
    expect(hatch({ loops: [Array.from({ length: 1001 }, (_, i) => i + 1)] })).toBe('b.loops[0]: must list at most 1000 ids');
    expect(hatch({ loops: [[2], [2]] })).toBe('b.loops: uses the same entity twice');
    expect(hatch({ loops: [[2, 3], [3]] })).toBe('b.loops: uses the same entity twice');
    expect(hatch({ pattern: 'brick' })).toContain('b.pattern');
    expect(hatch({ spacing: 0 })).toContain('b.spacing');
    expect(hatch({ loops: [[0]] })).toContain('b.loops[0][0]');
    expect(hatch({ loops: 'x' })).toContain('b.loops');
  });

  it('centre marks and title blocks', () => {
    expect(why(() => ok({ kind: 'centre', target: 2, extended: 'yes', style }))).toContain('b.extended');
    const block = (patch: object) => why(() => ok({ kind: 'titleBlock', at: pt(0, 0), size: 'A4', fields, ...patch }));
    expect(block({ size: 'B5' })).toContain('b.size');
    expect(block({ fields: { ...fields, title: 'x'.repeat(MAX_FIELD_LENGTH + 1) } })).toBe(`b.fields.title: must be at most ${MAX_FIELD_LENGTH} characters`);
    expect(block({ fields: { ...fields, extra: 'x' } })).toContain('extra');
    const { date: _drop, ...partial } = fields;
    expect(block({ fields: partial })).toContain('date');
  });
});

describe('whole notes', () => {
  const note = { id: 5, layer: 1, z: 5, color: 'byLayer', lineweight: 'byLayer', body: { kind: 'radius', target: 2, at: pt(1, 1), style } };

  it('read back', () => {
    expect(readNote(note, 'n')).toEqual(note);
    expect(readNote({ ...note, color: '#ff0000', lineweight: 0.5 }, 'n')).toMatchObject({ color: '#ff0000', lineweight: 0.5 });
  });

  it('say which part is wrong', () => {
    expect(why(() => readNote({ ...note, id: 0 }, 'n'))).toContain('n.id');
    expect(why(() => readNote({ ...note, layer: 'a' }, 'n'))).toContain('n.layer');
    expect(why(() => readNote({ ...note, z: 'a' }, 'n'))).toContain('n.z');
    expect(why(() => readNote({ ...note, color: 'red' }, 'n'))).toContain('n.color');
    expect(why(() => readNote({ ...note, lineweight: 7 }, 'n'))).toContain('n.lineweight');
    expect(why(() => readNote({ ...note, body: { kind: 'x' } }, 'n'))).toContain('n.body.kind');
    expect(why(() => readNote({ ...note, extra: 1 }, 'n'))).toContain('extra');
  });
});
