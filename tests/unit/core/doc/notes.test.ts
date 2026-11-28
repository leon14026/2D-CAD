import { describe, expect, it } from 'vitest';
import {
  arrowCorners,
  brokenNotes,
  createSession,
  DEFAULT_DIM_STYLE,
  docEnv,
  execute,
  formatAngle,
  formatLength,
  formatNumber,
  newDocument,
  noteEntityIds,
  noteProblem,
  noteUsesEntity,
  pickShapes,
  primBounds,
  primsBounds,
  refAt,
  resolveNote,
  resolveNotes,
  resolveRef,
  textBox,
  type Doc,
  type Note,
  type NoteBody,
  type PointRef,
  type Prim,
  type Session,
} from '../../../../src/core/doc';
import { arc, circle, degToRad, polyline, segment, type Shape, type Vec2 } from '../../../../src/core/geom';
import { expectClose, expectPoint } from '../helpers';

const P = (x: number, y: number): Vec2 => ({ x, y });
const free = (x: number, y: number): PointRef => ({ kind: 'free', p: P(x, y) });
const STYLE = 'ISO';

/** A document with the given shapes (ids 2, 3, ...) and a way to draw notes against it. */
function withShapes(...shapes: Shape[]): { doc: Doc; session: Session } {
  let session = createSession(newDocument());
  for (const geom of shapes) session = execute(session, 'entity.add', { geom }).session;
  return { doc: session.doc, session };
}

function draw(doc: Doc, body: NoteBody) {
  const note: Note = { id: 99, layer: 1, z: 99, color: 'byLayer', lineweight: 'byLayer', body };
  const r = resolveNote(docEnv(doc), note);
  if (!r.ok) throw new Error(r.why);
  return r.r;
}

const segs = (prims: readonly Prim[]) => prims.filter((p): p is Extract<Prim, { k: 'seg' }> => p.k === 'seg');
const arrows = (prims: readonly Prim[]) => prims.filter((p): p is Extract<Prim, { k: 'arrow' }> => p.k === 'arrow');
const texts = (prims: readonly Prim[]) => prims.filter((p): p is Extract<Prim, { k: 'text' }> => p.k === 'text');

describe('number formatting', () => {
  it('rounds to the style’s places and never shows a minus sign on zero', () => {
    expect(formatNumber(25, 2)).toBe('25.00');
    expect(formatNumber(1.005, 2)).toBe('1.00'); // 1.005 is just under in binary
    expect(formatNumber(-0.001, 2)).toBe('0.00');
    expect(formatNumber(-0.004, 0)).toBe('0');
    expect(formatNumber(-1.5, 1)).toBe('-1.5');
    expect(formatLength(12.3456, { ...DEFAULT_DIM_STYLE, precision: 3 })).toBe('12.346');
    expect(formatAngle(Math.PI / 2, DEFAULT_DIM_STYLE)).toBe('90.0°');
  });
});

describe('linear dimensions (hand-calculated)', () => {
  const { doc } = withShapes();

  it('horizontal: 40 mm between (0,0) and (40,0), line 10 above', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(0, 0), b: free(40, 0), at: P(20, 10), style: STYLE });
    expect(r.value).toBe(40);
    expect(r.text).toBe('40.00');
    const s = segs(r.prims);
    // Extension lines start 1 from the point and run 2 past the dimension line.
    expectPoint(s[0]?.a, P(0, 1));
    expectPoint(s[0]?.b, P(0, 12));
    expectPoint(s[1]?.a, P(40, 1));
    expectPoint(s[1]?.b, P(40, 12));
    // Dimension line and its two arrows, tips on the extension lines.
    expectPoint(s[2]?.a, P(0, 10));
    expectPoint(s[2]?.b, P(40, 10));
    const a = arrows(r.prims);
    expectPoint(a[0]?.tip, P(0, 10));
    expectPoint(a[0]?.dir, P(1, 0));
    expectPoint(a[1]?.tip, P(40, 10));
    expectPoint(a[1]?.dir, P(-1, 0));
    // Text sits 1 above the middle of the line, upright.
    const t = texts(r.prims)[0] as Extract<Prim, { k: 'text' }>;
    expectPoint(t.at, P(20, 11));
    expect(t.angle).toBe(0);
    expect(t.text).toBe('40.00');
    expect(t.height).toBe(3.5);
  });

  it('measures across even when the points are not level', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(2, 3), b: free(-8, 9), at: P(0, 20), style: STYLE });
    expect(r.value).toBe(10);
    const s = segs(r.prims);
    expectPoint(s[2]?.a, P(2, 20));
    expectPoint(s[2]?.b, P(-8, 20));
  });

  it('vertical: 25 mm, line 10 to the left; text reads upwards', () => {
    const r = draw(doc, { kind: 'linear', orient: 'vertical', a: free(0, 0), b: free(0, 25), at: P(-10, 12), style: STYLE });
    expect(r.value).toBe(25);
    expect(r.text).toBe('25.00');
    const t = texts(r.prims)[0] as Extract<Prim, { k: 'text' }>;
    expectClose(t.angle, Math.PI / 2);
    expectPoint(t.at, P(-11, 12.5));
  });

  it('aligned: 50 mm along a 3-4-5 slope, line 10 off to the left', () => {
    const r = draw(doc, { kind: 'aligned', a: free(0, 0), b: free(30, 40), at: P(-8, 6), style: STYLE });
    expectClose(r.value ?? NaN, 50);
    expect(r.text).toBe('50.00');
    const s = segs(r.prims);
    expectPoint(s[2]?.a, P(-8, 6));
    expectPoint(s[2]?.b, P(22, 46));
    const t = texts(r.prims)[0] as Extract<Prim, { k: 'text' }>;
    expectClose(t.angle, Math.atan2(4, 3));
  });

  it('text never reads upside down', () => {
    const r = draw(doc, { kind: 'aligned', a: free(30, 40), b: free(0, 0), at: P(-8, 6), style: STYLE });
    const t = texts(r.prims)[0] as Extract<Prim, { k: 'text' }>;
    expectClose(t.angle, Math.atan2(4, 3));
    const leftward = draw(doc, { kind: 'aligned', a: free(10, 0), b: free(0, 0), at: P(5, 5), style: STYLE });
    expect((texts(leftward.prims)[0] as Extract<Prim, { k: 'text' }>).angle).toBe(0);
    const down = draw(doc, { kind: 'linear', orient: 'vertical', a: free(0, 10), b: free(0, 0), at: P(5, 5), style: STYLE });
    expectClose((texts(down.prims)[0] as Extract<Prim, { k: 'text' }>).angle, Math.PI / 2);
  });

  it('a span shorter than two arrows puts the arrows outside, on stubs', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(0, 0), b: free(4, 0), at: P(2, 8), style: STYLE });
    const a = arrows(r.prims);
    expectPoint(a[0]?.dir, P(-1, 0));
    expectPoint(a[1]?.dir, P(1, 0));
    expect(segs(r.prims)).toHaveLength(5); // 2 extension lines, the dimension line and 2 stubs
    expect(r.text).toBe('4.00');
  });

  it('a zero span draws only extension lines and the text', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(5, 0), b: free(5, 9), at: P(5, 4), style: STYLE });
    expect(r.value).toBe(0);
    expect(r.text).toBe('0.00');
    expect(arrows(r.prims)).toHaveLength(0);
    const v = draw(doc, { kind: 'linear', orient: 'vertical', a: free(1, 5), b: free(9, 5), at: P(4, 5), style: STYLE });
    expect(v.value).toBe(0);
  });

  it('a dimension line on the feature itself has no extension lines', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(0, 0), b: free(10, 0), at: P(5, 0), style: STYLE });
    expect(segs(r.prims)).toHaveLength(1);
  });

  it('an extension line shorter than the gap starts at the feature', () => {
    const r = draw(doc, { kind: 'linear', orient: 'horizontal', a: free(0, 0), b: free(10, 0), at: P(5, 0.5), style: STYLE });
    expectPoint(segs(r.prims)[0]?.a, P(0, 0.5));
  });

  it('aligned dimension of identical points is refused', () => {
    const result = resolveNote(docEnv(doc), { id: 1, layer: 1, z: 1, color: 'byLayer', lineweight: 'byLayer', body: { kind: 'aligned', a: free(1, 1), b: free(1, 1), at: P(0, 0), style: STYLE } });
    expect(result).toEqual({ ok: false, why: 'The two points are the same point.' });
  });

  it('uses the style: precision and text height', () => {
    const d = createSession(newDocument());
    const styled = execute(d, 'dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, name: 'Fine', precision: 4, textHeight: 5 } }).session.doc;
    const r = draw(styled, { kind: 'aligned', a: free(0, 0), b: free(1, 1), at: P(0, 3), style: 'Fine' });
    expect(r.text).toBe('1.4142');
    expect(texts(r.prims)[0]?.height).toBe(5);
    expect(resolveNote(docEnv(doc), { id: 1, layer: 1, z: 1, color: 'byLayer', lineweight: 'byLayer', body: { kind: 'aligned', a: free(0, 0), b: free(1, 1), at: P(0, 3), style: 'Nope' } })).toEqual({
      ok: false,
      why: 'The dimension style "Nope" does not exist.',
    });
  });
});

describe('radius and diameter dimensions (hand-calculated)', () => {
  const { doc } = withShapes(circle(P(10, 10), 5), arc(P(0, 0), 12.5, 0, Math.PI));

  it('radius: arrow at the circle, line out to the chosen point', () => {
    const r = draw(doc, { kind: 'radius', target: 2, at: P(20, 10), style: STYLE });
    expect(r.value).toBe(5);
    expect(r.text).toBe('R5.00');
    const a = arrows(r.prims);
    expectPoint(a[0]?.tip, P(15, 10));
    expectPoint(a[0]?.dir, P(1, 0));
    expectPoint(segs(r.prims)[0]?.b, P(20, 10));
    expectPoint(texts(r.prims)[0]?.at, P(17.5, 11));
  });

  it('radius with the point inside the circle points the arrow inward', () => {
    const r = draw(doc, { kind: 'radius', target: 2, at: P(12, 10), style: STYLE });
    expectPoint(arrows(r.prims)[0]?.dir, P(-1, 0));
  });

  it('radius with the point on the circle draws only an arrow and text', () => {
    const r = draw(doc, { kind: 'radius', target: 2, at: P(10, 15), style: STYLE });
    expect(segs(r.prims)).toHaveLength(0);
    expectPoint(arrows(r.prims)[0]?.dir, P(0, 1));
  });

  it('diameter: a line through the centre, arrows on both sides, Ø text', () => {
    const r = draw(doc, { kind: 'diameter', target: 2, at: P(10, 30), style: STYLE });
    expect(r.value).toBe(10);
    expect(r.text).toBe('Ø10.00');
    const a = arrows(r.prims);
    expectPoint(a[0]?.tip, P(10, 15));
    expectPoint(a[1]?.tip, P(10, 5));
  });

  it('works on an arc too, using its circle', () => {
    const r = draw(doc, { kind: 'diameter', target: 3, at: P(1, 0), style: STYLE });
    expect(r.value).toBe(25);
    expect(r.text).toBe('Ø25.00');
    expect(draw(doc, { kind: 'radius', target: 3, at: P(0, 20), style: STYLE }).text).toBe('R12.50');
  });

  it('a small circle puts the diameter arrows outside', () => {
    const small = withShapes(circle(P(0, 0), 2)).doc;
    const r = draw(small, { kind: 'diameter', target: 2, at: P(0, 5), style: STYLE });
    expectPoint(arrows(r.prims)[0]?.dir, P(0, 1));
  });

  it('refuses a position on the centre, and things that are not round', () => {
    const lines = withShapes(segment(P(0, 0), P(1, 0)), circle(P(0, 0), 1)).doc;
    const note = (body: NoteBody): Note => ({ id: 1, layer: 1, z: 1, color: 'byLayer', lineweight: 'byLayer', body });
    expect(resolveNote(docEnv(lines), note({ kind: 'radius', target: 3, at: P(0, 0), style: STYLE }))).toEqual({ ok: false, why: 'Place the dimension away from the centre.' });
    expect(resolveNote(docEnv(lines), note({ kind: 'radius', target: 2, at: P(3, 0), style: STYLE }))).toEqual({
      ok: false,
      why: 'What it was measuring is no longer a circle or an arc.',
    });
    expect(resolveNote(docEnv(lines), note({ kind: 'radius', target: 77, at: P(3, 0), style: STYLE }))).toEqual({
      ok: false,
      why: 'The circle or arc it was measuring (id 77) is gone.',
    });
  });
});

describe('angle dimensions (hand-calculated)', () => {
  const { doc } = withShapes();
  const angle = (at: Vec2, a = free(10, 0), b = free(0, 10)): Extract<NoteBody, { kind: 'angle' }> => ({ kind: 'angle', vertex: free(0, 0), a, b, at, style: STYLE });

  it('90° when the arc is placed between the sides', () => {
    const r = draw(doc, angle(P(7, 7)));
    expectClose(r.value ?? NaN, Math.PI / 2);
    expect(r.text).toBe('90.0°');
    const arcPrim = r.prims.find((p) => p.k === 'arc') as Extract<Prim, { k: 'arc' }>;
    expectClose(arcPrim.radius, Math.hypot(7, 7));
    expectClose(arcPrim.start, 0);
    expectClose(arcPrim.sweep, Math.PI / 2);
  });

  it('270° when the arc is placed on the other side', () => {
    const r = draw(doc, angle(P(-7, -7)));
    expectClose(r.value ?? NaN, (3 * Math.PI) / 2);
    expect(r.text).toBe('270.0°');
    const arcPrim = r.prims.find((p) => p.k === 'arc') as Extract<Prim, { k: 'arc' }>;
    expectClose(arcPrim.start, Math.PI / 2);
  });

  it('extension lines run only where the side stops short of the arc', () => {
    const r = draw(doc, angle(P(7, 7), free(4, 0), free(0, 10)));
    expect(segs(r.prims)).toHaveLength(1); // the first side ends at 4, before the arc at 9.9; the second at 10
    expectPoint(segs(r.prims)[0]?.a, P(5, 0));
    expectPoint(segs(r.prims)[0]?.b, P(Math.hypot(7, 7) + 2, 0));
  });

  it('a 60° angle between a 30° and a 90° side, with a reflex partner', () => {
    const a = P(10 * Math.cos(degToRad(30)), 10 * Math.sin(degToRad(30)));
    expectClose(draw(doc, angle(P(1, 5), { kind: 'free', p: a }, free(0, 4))).value ?? NaN, degToRad(60));
    expectClose(draw(doc, angle(P(5, -1), { kind: 'free', p: a }, free(0, 4))).value ?? NaN, degToRad(300));
  });

  it('arrows sit on the arc ends, pointing along it', () => {
    const r = draw(doc, angle(P(7, 7)));
    const a = arrows(r.prims);
    const R = Math.hypot(7, 7);
    expectPoint(a[0]?.tip, P(R, 0));
    expectPoint(a[0]?.dir, P(0, 1));
    expectPoint(a[1]?.tip, P(0, R));
    expectPoint(a[1]?.dir, P(1, 0));
  });

  it('refuses sides with no length, equal sides and an arc on the corner', () => {
    const note = (body: NoteBody): Note => ({ id: 1, layer: 1, z: 1, color: 'byLayer', lineweight: 'byLayer', body });
    const why = (body: NoteBody) => {
      const r = resolveNote(docEnv(doc), note(body));
      return r.ok ? null : r.why;
    };
    expect(why(angle(P(7, 7), free(0, 0)))).toBe('A side of the angle has no length.');
    expect(why(angle(P(7, 7), free(5, 5), free(1, 1)))).toBe('The two sides point the same way.');
    expect(why(angle(P(0, 0)))).toBe('Place the angle dimension away from its corner.');
    expect(why(angle(P(7, 7), free(10, 0), free(0, 0)))).toBe('A side of the angle has no length.');
  });
});

describe('references follow geometry', () => {
  const { doc } = withShapes(segment(P(0, 0), P(10, 0)), polyline([{ x: 20, y: 0 }, { x: 30, y: 5 }, { x: 40, y: 0 }], false), circle(P(50, 50), 4), arc(P(0, 20), 5, 0, Math.PI / 2));

  it('refAt finds ends, corners, middles and centres, and falls back to a free point', () => {
    expect(refAt(doc, P(0, 0))).toEqual({ kind: 'end', id: 2, end: 'start' });
    expect(refAt(doc, P(10, 0))).toEqual({ kind: 'end', id: 2, end: 'end' });
    expect(refAt(doc, P(5, 0))).toEqual({ kind: 'mid', id: 2 });
    expect(refAt(doc, P(30, 5))).toEqual({ kind: 'vertex', id: 3, index: 1 });
    expect(refAt(doc, P(50, 50))).toEqual({ kind: 'center', id: 4 });
    expect(refAt(doc, P(5, 20))).toEqual({ kind: 'end', id: 5, end: 'start' });
    expect(refAt(doc, P(3.5, 20))).toEqual({ kind: 'free', p: P(3.5, 20) });
    expect(refAt(doc, P(-0, 7))).toEqual({ kind: 'free', p: P(0, 7) });
  });

  it('refAt with a tolerance binds a point that is only close', () => {
    expect(refAt(doc, P(1e-10, 0))).toEqual({ kind: 'free', p: P(1e-10, 0) });
    expect(refAt(doc, P(1e-10, 0), 1e-9)).toEqual({ kind: 'end', id: 2, end: 'start' });
  });

  it('resolveRef reads the points now, and says what is missing', () => {
    const env = docEnv(doc);
    expectPoint(resolveRef(env, { kind: 'end', id: 2, end: 'end' }), P(10, 0));
    expectPoint(resolveRef(env, { kind: 'end', id: 3, end: 'start' }), P(20, 0));
    expectPoint(resolveRef(env, { kind: 'end', id: 3, end: 'end' }), P(40, 0));
    expectPoint(resolveRef(env, { kind: 'end', id: 5, end: 'end' }), P(0, 25));
    expectPoint(resolveRef(env, { kind: 'mid', id: 5 }), P(5 * Math.cos(Math.PI / 4), 20 + 5 * Math.sin(Math.PI / 4)));
    expectPoint(resolveRef(env, { kind: 'center', id: 5 }), P(0, 20));
    const why = (ref: PointRef) => {
      try {
        resolveRef(env, ref);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(why({ kind: 'end', id: 4, end: 'start' })).toBe('The end it was measuring no longer exists.');
    expect(why({ kind: 'vertex', id: 2, index: 0 })).toBe('The corner it was measuring no longer exists.');
    expect(why({ kind: 'vertex', id: 3, index: 9 })).toBe('The corner it was measuring no longer exists.');
    expect(why({ kind: 'mid', id: 4 })).toBe('The middle it was measuring no longer exists.');
    expect(why({ kind: 'center', id: 2 })).toBe('The centre it was measuring no longer exists.');
    expect(why({ kind: 'center', id: 99 })).toBe('The geometry it was measuring (id 99) is gone.');
  });

  it('a closed polyline has no ends', () => {
    const closed = withShapes(polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true)).doc;
    expect(() => resolveRef(docEnv(closed), { kind: 'end', id: 2, end: 'start' })).toThrow();
  });

  it('a dimension follows its geometry when it is moved, rotated or scaled', () => {
    let s = withShapes(segment(P(0, 0), P(30, 0)), segment(P(0, 0), P(0, 40))).session;
    const dim: NoteBody = { kind: 'aligned', a: refAt(s.doc, P(30, 0)), b: refAt(s.doc, P(0, 40)), at: P(40, 40), style: STYLE };
    const id = execute(s, 'note.add', { body: dim, reference: true });
    s = id.session;
    expectClose(resolveNotes(s.doc).get(id.result.id)?.ok ? (resolveNotes(s.doc).get(id.result.id) as { ok: true; r: { value?: number } }).r.value ?? NaN : NaN, 50);
    s = execute(s, 'entity.transform', { ids: [2, 3], transform: { kind: 'scale', center: P(0, 0), factor: 2 } }).session;
    const r = resolveNotes(s.doc).get(id.result.id) as { ok: true; r: { value: number; text: string } };
    expectClose(r.r.value, 100);
    expect(r.r.text).toBe('(100.00)');
  });
});

describe('broken notes', () => {
  it('lists the notes whose geometry is gone', () => {
    const { session } = withShapes(circle(P(0, 0), 3));
    const body: NoteBody = { kind: 'radius', target: 2, at: P(5, 0), style: STYLE };
    const n: Note = { id: 50, layer: 1, z: 50, color: 'byLayer', lineweight: 'byLayer', body };
    const gone = { ...session.doc, entities: new Map() };
    expect(brokenNotes(docEnv(session.doc), [n])).toEqual([]);
    expect(brokenNotes(docEnv(gone), [n])).toEqual([n]);
    expect(noteProblem(docEnv(gone), n)).toBe('The circle or arc it was measuring (id 2) is gone.');
    expect(noteProblem(docEnv(session.doc), n)).toBeNull();
  });

  it('knows which entities a note uses', () => {
    const mk = (body: NoteBody): Note => ({ id: 9, layer: 1, z: 9, color: 'byLayer', lineweight: 'byLayer', body });
    const end = (id: number): PointRef => ({ kind: 'end', id, end: 'start' });
    expect(noteEntityIds(mk({ kind: 'linear', orient: 'horizontal', a: end(2), b: free(0, 0), at: P(0, 0), style: STYLE }))).toEqual([2]);
    expect(noteEntityIds(mk({ kind: 'angle', vertex: end(2), a: end(3), b: end(4), at: P(0, 0), style: STYLE }))).toEqual([2, 3, 4]);
    expect(noteEntityIds(mk({ kind: 'centre', target: 7, extended: false, style: STYLE }))).toEqual([7]);
    expect(noteEntityIds(mk({ kind: 'hatch', loops: [[5], [6, 8]], pattern: 'solid', spacing: 1, angle: 0 }))).toEqual([5, 6, 8]);
    expect(noteEntityIds(mk({ kind: 'text', at: P(0, 0), height: 1, angle: 0, anchor: 'left', text: 'x' }))).toEqual([]);
    expect(noteUsesEntity(mk({ kind: 'radius', target: 7, at: P(0, 0), style: STYLE }), 7)).toBe(true);
    expect(noteUsesEntity(mk({ kind: 'radius', target: 7, at: P(0, 0), style: STYLE }), 8)).toBe(false);
  });
});

describe('text, leaders, centre marks', () => {
  const { doc } = withShapes(circle(P(10, 10), 5));

  it('text: one prim per line, stacked downwards', () => {
    const r = draw(doc, { kind: 'text', at: P(0, 0), height: 2, angle: 0, anchor: 'left', text: 'ab\ncd' });
    const t = texts(r.prims);
    expect(t.map((x) => x.text)).toEqual(['ab', 'cd']);
    expectPoint(t[0]?.at, P(0, 0));
    expectPoint(t[1]?.at, P(0, -2.8));
    // The box: 2 characters of 0.62 × 2 wide, 2 tall.
    expectClose(r.bounds.maxX, 2.48);
    expectClose(r.bounds.minY, -2.8);
  });

  it('rotated text is stacked along the rotated down direction', () => {
    const r = draw(doc, { kind: 'text', at: P(0, 0), height: 1, angle: Math.PI / 2, anchor: 'center', text: 'a\nb' });
    expectPoint(texts(r.prims)[1]?.at, P(1.4, 0));
  });

  it('text boxes honour anchor and baseline', () => {
    const base = { k: 'text', at: P(0, 0), height: 2, angle: 0, anchor: 'left', baseline: 'bottom', text: 'abcd' } as const;
    expect(textBox(base)).toEqual([P(0, 0), P(4.96, 0), P(4.96, 2), P(0, 2)]);
    expect(textBox({ ...base, anchor: 'center', baseline: 'middle' })[0]).toEqual(P(-2.48, -1));
    expect(textBox({ ...base, anchor: 'right' })[0]).toEqual(P(-4.96, 0));
  });

  it('a leader points an arrow at its first point and puts the note beside its last', () => {
    const r = draw(doc, { kind: 'leader', points: [P(0, 0), P(10, 10), P(20, 10)], text: 'Ø5 THRU', style: STYLE });
    expectPoint(arrows(r.prims)[0]?.tip, P(0, 0));
    expectClose(arrows(r.prims)[0]?.dir.x ?? NaN, Math.SQRT1_2);
    const t = texts(r.prims)[0] as Extract<Prim, { k: 'text' }>;
    expectPoint(t.at, P(21, 10));
    expect(t.anchor).toBe('left');
    const left = draw(doc, { kind: 'leader', points: [P(0, 0), P(-10, 5)], text: 'x', style: STYLE });
    expect((texts(left.prims)[0] as Extract<Prim, { k: 'text' }>).anchor).toBe('right');
    expect(texts(draw(doc, { kind: 'leader', points: [P(0, 0), P(-10, 5)], text: '', style: STYLE }).prims)).toHaveLength(0);
  });

  it('a centre mark is a cross, or lines that run past the circle', () => {
    const cross = draw(doc, { kind: 'centre', target: 2, extended: false, style: STYLE });
    expectPoint(segs(cross.prims)[0]?.a, P(7.5, 10));
    expectPoint(segs(cross.prims)[0]?.b, P(12.5, 10));
    const lines = draw(doc, { kind: 'centre', target: 2, extended: true, style: STYLE });
    expectPoint(segs(lines.prims)[1]?.a, P(10, 3));
    expectPoint(segs(lines.prims)[1]?.b, P(10, 17));
    const none = resolveNote(docEnv(doc), { id: 1, layer: 1, z: 1, color: 'byLayer', lineweight: 'byLayer', body: { kind: 'centre', target: 9, extended: false, style: STYLE } });
    expect(none.ok).toBe(false);
  });
});

describe('title block', () => {
  const { doc } = withShapes();
  const fields = { title: 'Bracket', number: 'AL-001', scale: '1:1', revision: 'A', material: 'Al 6061', drawnBy: 'L', date: '', company: '' };

  it('draws the sheet, the border and a 180 mm block in the lower right corner', () => {
    const r = draw(doc, { kind: 'titleBlock', at: P(0, 0), size: 'A4', fields });
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 297, maxY: 210 });
    const s = segs(r.prims);
    // Sheet and border rectangles come first (4 + 4), then the block outline (4).
    expectPoint(s[0]?.a, P(0, 0));
    expectPoint(s[4]?.a, P(20, 10));
    expectPoint(s[8]?.a, P(287 - 180, 10));
    // Filled-in fields appear as text; empty ones draw nothing but their label.
    const values = texts(r.prims).filter((t) => t.height >= 3.5).map((t) => t.text);
    expect(values).toEqual(['Bracket', 'AL-001', '1:1', 'A', 'Al 6061', 'L']);
    expect(texts(r.prims).filter((t) => t.height === 1.8)).toHaveLength(8);
  });

  it('sizes follow ISO 216', () => {
    for (const [size, w, h] of [['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]] as const) {
      const r = draw(doc, { kind: 'titleBlock', at: P(100, 100), size, fields });
      expect(r.bounds).toEqual({ minX: 100, minY: 100, maxX: 100 + w, maxY: 100 + h });
    }
  });
});

describe('drawing instructions', () => {
  it('bounds and pick shapes cover every kind', () => {
    const prims: Prim[] = [
      { k: 'seg', a: P(0, 0), b: P(1, 1) },
      { k: 'arc', center: P(0, 0), radius: 2, start: 0, sweep: Math.PI },
      { k: 'arrow', tip: P(0, 0), dir: P(1, 0), size: 3 },
      { k: 'text', at: P(0, 0), height: 1, angle: 0, anchor: 'left', baseline: 'bottom', text: 'a' },
      { k: 'dot', p: P(5, 5) },
      { k: 'fill', loops: [circle(P(0, 0), 1)] },
    ];
    expect(primsBounds([])).toBeNull();
    expect(primsBounds(prims)).toEqual({ minX: -2, minY: -1, maxX: 5, maxY: 5 });
    expect(primBounds(prims[4] as Prim)).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(pickShapes(prims).map((s) => s.kind)).toEqual(['segment', 'arc', 'polyline', 'polyline']);
    const [tip, b, c] = arrowCorners(prims[2] as Extract<Prim, { k: 'arrow' }>);
    expectPoint(tip, P(0, 0));
    expectPoint(b, P(3, 0.5));
    expectPoint(c, P(3, -0.5));
  });
});

describe('resolveNotes', () => {
  it('is computed once per document', () => {
    const { session } = withShapes(circle(P(0, 0), 3));
    const s = execute(session, 'note.add', { body: { kind: 'radius', target: 2, at: P(5, 0), style: STYLE } }).session;
    expect(resolveNotes(s.doc)).toBe(resolveNotes(s.doc));
  });
});
