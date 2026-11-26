/**
 * Phase 6 gate, as properties:
 * - over 500 random cases, every dimension shows exactly the value measured from its geometry
 *   (the value is worked out here from the raw coordinates, not by the code under test);
 * - dimensions follow their geometry through move, rotate, scale and mirror, and through
 *   trim and extend; undo puts everything back exactly.
 */
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  DEFAULT_DIM_STYLE,
  execute,
  formatLength,
  newDocument,
  resolveNotes,
  undo,
  type Doc,
  type NoteBody,
  type PointRef,
  type Session,
} from '../../../../src/core/doc';
import { arc, circle, polyline, segment, type Shape, type Transform, type Vec2 } from '../../../../src/core/geom';
import { PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';
import { seeded, type Rand } from './random-edits';

const CASES = 500;
const STYLE = 'ISO';
const seed = fc.integer({ min: 0, max: 2 ** 31 - 1 });
const P = (x: number, y: number): Vec2 => ({ x, y });
const between = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/** A point reference together with where it is, worked out from the coordinates we built. */
interface Spot {
  readonly ref: PointRef;
  readonly p: Vec2;
  readonly onGeometry: boolean;
}

interface Scene {
  readonly session: Session;
  readonly spots: readonly Spot[];
  readonly circle: { readonly id: number; readonly c: Vec2; readonly r: number };
  readonly arc: { readonly id: number; readonly c: Vec2; readonly r: number };
}

/** A segment, an open polyline, a circle and an arc at random places (ids 2 to 5). */
function scene(r: Rand): Scene {
  const point = () => P(between(r, -1000, 1000), between(r, -1000, 1000));
  const a = point();
  const b = point();
  const v = [point(), point(), point()];
  const c1 = point();
  const r1 = between(r, 1, 400);
  const c2 = point();
  const r2 = between(r, 1, 400);
  let s = createSession(newDocument());
  const add = (geom: Shape) => {
    s = execute(s, 'entity.add', { geom }).session;
  };
  add(segment(a, b));
  add(polyline(v.map((p) => ({ ...p, bulge: 0 })), false));
  add(circle(c1, r1));
  add(arc(c2, r2, between(r, 0, 6), between(r, 0.5, 5)));
  const spots: Spot[] = [
    { ref: { kind: 'end', id: 2, end: 'start' }, p: a, onGeometry: true },
    { ref: { kind: 'end', id: 2, end: 'end' }, p: b, onGeometry: true },
    { ref: { kind: 'mid', id: 2 }, p: P((a.x + b.x) / 2, (a.y + b.y) / 2), onGeometry: true },
    ...v.map((p, index): Spot => ({ ref: { kind: 'vertex', id: 3, index }, p, onGeometry: true })),
    { ref: { kind: 'center', id: 4 }, p: c1, onGeometry: true },
    { ref: { kind: 'center', id: 5 }, p: c2, onGeometry: true },
  ];
  return { session: s, spots, circle: { id: 4, c: c1, r: r1 }, arc: { id: 5, c: c2, r: r2 } };
}

/** Either a point of the geometry or a free point somewhere on the sheet. */
function spot(r: Rand, sc: Scene): Spot {
  if (r() < 0.65) return sc.spots[Math.floor(r() * sc.spots.length)]!;
  const p = P(between(r, -1000, 1000), between(r, -1000, 1000));
  return { ref: { kind: 'free', p }, p, onGeometry: false };
}

function otherThan(r: Rand, sc: Scene, s: Spot): Spot {
  for (;;) {
    const t = spot(r, sc);
    if (Math.hypot(t.p.x - s.p.x, t.p.y - s.p.y) > 1e-2) return t;
  }
}

const away = (r: Rand, from: Vec2): Vec2 => {
  const angle = between(r, 0, 2 * Math.PI);
  const d = between(r, 3, 1500);
  return P(from.x + d * Math.cos(angle), from.y + d * Math.sin(angle));
};

/** The angle the code should show: the arc runs from side a to side b counter-clockwise, or the other way round when `at` is on the far side. */
function angleBetween(v: Vec2, a: Vec2, b: Vec2, at: Vec2): number | null {
  const TAU = 2 * Math.PI;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  const ta = Math.atan2(a.y - v.y, a.x - v.x);
  const sweep = norm(Math.atan2(b.y - v.y, b.x - v.x) - ta);
  const m = norm(Math.atan2(at.y - v.y, at.x - v.x) - ta);
  if (sweep < 1e-3 || TAU - sweep < 1e-3 || m < 1e-6 || Math.abs(m - sweep) < 1e-6) return null; // too close to call by hand
  return m < sweep ? sweep : TAU - sweep;
}

/** What each dimension in a case should measure, worked out from the coordinates. */
interface Expect {
  readonly kind: 'linear' | 'aligned' | 'radius' | 'diameter' | 'angle';
  readonly body: NoteBody;
  readonly value: number;
  readonly text: string;
}

const fixed = (v: number, places: number) => v.toFixed(places).replace(/^-(0(\.0+)?)$/, '$1');

function dimensions(r: Rand, sc: Scene): Expect[] {
  const out: Expect[] = [];
  const dp = DEFAULT_DIM_STYLE.precision;
  const sa = spot(r, sc);
  const sb = otherThan(r, sc, sa);
  const horizontal = r() < 0.5;
  out.push({
    kind: 'linear',
    body: { kind: 'linear', orient: horizontal ? 'horizontal' : 'vertical', a: sa.ref, b: sb.ref, at: away(r, sa.p), style: STYLE },
    value: horizontal ? Math.abs(sb.p.x - sa.p.x) : Math.abs(sb.p.y - sa.p.y),
    text: fixed(horizontal ? Math.abs(sb.p.x - sa.p.x) : Math.abs(sb.p.y - sa.p.y), dp),
  });
  const ta = spot(r, sc);
  const tb = otherThan(r, sc, ta);
  const len = Math.hypot(tb.p.x - ta.p.x, tb.p.y - ta.p.y);
  out.push({ kind: 'aligned', body: { kind: 'aligned', a: ta.ref, b: tb.ref, at: away(r, ta.p), style: STYLE }, value: len, text: fixed(len, dp) });
  const round = r() < 0.5 ? sc.circle : sc.arc;
  out.push({ kind: 'radius', body: { kind: 'radius', target: round.id, at: away(r, round.c), style: STYLE }, value: round.r, text: `R${fixed(round.r, dp)}` });
  const round2 = r() < 0.5 ? sc.circle : sc.arc;
  out.push({ kind: 'diameter', body: { kind: 'diameter', target: round2.id, at: away(r, round2.c), style: STYLE }, value: 2 * round2.r, text: `Ø${fixed(2 * round2.r, dp)}` });
  for (let tries = 0; tries < 20; tries++) {
    const vtx = spot(r, sc);
    const s1 = otherThan(r, sc, vtx);
    const s2 = otherThan(r, sc, vtx);
    const at = away(r, vtx.p);
    const value = angleBetween(vtx.p, s1.p, s2.p, at);
    if (value === null) continue;
    out.push({
      kind: 'angle',
      body: { kind: 'angle', vertex: vtx.ref, a: s1.ref, b: s2.ref, at, style: STYLE },
      value,
      text: `${fixed((value * 180) / Math.PI, DEFAULT_DIM_STYLE.anglePrecision)}°`,
    });
    break;
  }
  return out;
}

function addAll(sc: Scene, dims: readonly Expect[]): { session: Session; ids: number[] } {
  let s = sc.session;
  const ids: number[] = [];
  for (const d of dims) {
    const res = execute(s, 'note.add', { body: d.body });
    s = res.session;
    ids.push(res.result.id);
  }
  return { session: s, ids };
}

function shown(doc: Doc, id: number): { value: number; text: string } {
  const res = resolveNotes(doc).get(id);
  if (!res?.ok || res.r.value === undefined || res.r.text === undefined) throw new Error(`note ${id} does not resolve: ${res?.ok === false ? res.why : 'missing'}`);
  return { value: res.r.value, text: res.r.text };
}

describe('every dimension shows the measured value (500 random cases)', PROPERTY_TIMEOUT, () => {
  it('value and text match a measurement worked out from the coordinates', () => {
    let angles = 0;
    let total = 0;
    fc.assert(
      fc.property(seed, (s) => {
        const r = seeded(s);
        const sc = scene(r);
        const dims = dimensions(r, sc);
        const { session, ids } = addAll(sc, dims);
        dims.forEach((d, i) => {
          const got = shown(session.doc, ids[i]!);
          if (!near(got.value, d.value)) throw new Error(`seed ${s}: ${d.kind} shows ${got.value}, measured ${d.value}`);
          // The text is the shown value to the style's places, and it is the measured value to those places.
          const places = d.kind === 'angle' ? DEFAULT_DIM_STYLE.anglePrecision : DEFAULT_DIM_STYLE.precision;
          const half = 0.5 * 10 ** -places + 1e-9;
          const numeric = Number(got.text.replace(/^[RØ]/, '').replace('°', ''));
          const want = d.kind === 'angle' ? (d.value * 180) / Math.PI : d.value;
          if (Math.abs(numeric - want) > half) throw new Error(`seed ${s}: ${d.kind} text ${got.text} is not ${want}`);
          if (d.kind !== 'angle' && got.text !== d.text && Math.abs(numeric - Number(d.text.replace(/^[RØ]/, ''))) > 1e-9) throw new Error(`seed ${s}: ${d.kind} text ${got.text} but ${d.text}`);
          if (d.kind === 'linear' || d.kind === 'aligned') expect(got.text).toBe(formatLength(got.value, DEFAULT_DIM_STYLE));
        });
        total += dims.length;
        angles += dims.filter((d) => d.kind === 'angle').length;
        return true;
      }),
      { numRuns: CASES, seed: PROPERTY_PARAMS.seed },
    );
    expect(total).toBeGreaterThan(CASES * 4);
    expect(angles).toBeGreaterThan(CASES * 0.9);
  });
});

// ---------- following the geometry ----------

function tp(t: Transform, p: Vec2): Vec2 {
  switch (t.kind) {
    case 'translate':
      return P(p.x + t.dx, p.y + t.dy);
    case 'rotate': {
      const c = Math.cos(t.angle);
      const sn = Math.sin(t.angle);
      const x = p.x - t.center.x;
      const y = p.y - t.center.y;
      return P(t.center.x + x * c - y * sn, t.center.y + x * sn + y * c);
    }
    case 'scale':
      return P(t.center.x + (p.x - t.center.x) * t.factor, t.center.y + (p.y - t.center.y) * t.factor);
    case 'mirror': {
      const dx = t.b.x - t.a.x;
      const dy = t.b.y - t.a.y;
      const k = ((p.x - t.a.x) * dx + (p.y - t.a.y) * dy) / (dx * dx + dy * dy);
      const fx = t.a.x + k * dx;
      const fy = t.a.y + k * dy;
      return P(2 * fx - p.x, 2 * fy - p.y);
    }
  }
}

function randomTransform(r: Rand): Transform {
  const c = P(between(r, -500, 500), between(r, -500, 500));
  switch (Math.floor(r() * 4)) {
    case 0:
      return { kind: 'translate', dx: between(r, -800, 800), dy: between(r, -800, 800) };
    case 1:
      return { kind: 'rotate', center: c, angle: between(r, -7, 7) };
    case 2:
      return { kind: 'scale', center: c, factor: between(r, 0.2, 4) };
    default:
      return { kind: 'mirror', a: c, b: away(r, c) };
  }
}

const scaleOf = (t: Transform) => (t.kind === 'scale' ? t.factor : 1);

/** The measurement after the transform, from the moved coordinates. `moved` says which references moved. */
function remeasure(d: Expect, sc: Scene, t: Transform, moved: (s: Spot) => boolean): number {
  const at = (ref: PointRef): Vec2 => {
    const s = sc.spots.find((x) => JSON.stringify(x.ref) === JSON.stringify(ref));
    if (s) return moved(s) ? tp(t, s.p) : s.p;
    if (ref.kind !== 'free') throw new Error('unknown reference');
    return moved({ ref, p: ref.p, onGeometry: false }) ? tp(t, ref.p) : ref.p;
  };
  const b = d.body;
  switch (b.kind) {
    case 'linear': {
      const p = at(b.a);
      const q = at(b.b);
      return b.orient === 'horizontal' ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y);
    }
    case 'aligned': {
      const p = at(b.a);
      const q = at(b.b);
      return Math.hypot(q.x - p.x, q.y - p.y);
    }
    case 'radius':
      return d.value * scaleOf(t);
    case 'diameter':
      return d.value * scaleOf(t);
    default:
      return d.value;
  }
}

describe('dimensions follow their geometry (500 random cases each)', PROPERTY_TIMEOUT, () => {
  it('select everything and move, rotate, scale or mirror: every dimension re-measures, and undo restores the drawing exactly', () => {
    fc.assert(
      fc.property(seed, (s) => {
        const r = seeded(s);
        const sc = scene(r);
        const dims = dimensions(r, sc);
        const { session, ids } = addAll(sc, dims);
        const t = randomTransform(r);
        const everything = [...session.doc.entities.keys(), ...session.doc.notes.keys()];
        const moved = execute(session, 'entity.transform', { ids: everything, transform: t });
        expect(moved.pruned).toBe(0);
        dims.forEach((d, i) => {
          const got = shown(moved.session.doc, ids[i]!);
          const want = remeasure(d, sc, t, () => true);
          if (!near(got.value, want)) throw new Error(`seed ${s}: ${d.kind} after ${t.kind} shows ${got.value}, measured ${want}`);
        });
        return isDeepStrictEqual(undo(moved.session).doc, session.doc);
      }),
      { numRuns: CASES, seed: PROPERTY_PARAMS.seed },
    );
  });

  it('move only the geometry: lengths and sizes follow it, the dimension lines stay put', () => {
    fc.assert(
      fc.property(seed, (s) => {
        const r = seeded(s);
        const sc = scene(r);
        const dims = dimensions(r, sc).filter((d) => d.kind !== 'angle');
        const { session, ids } = addAll(sc, dims);
        const t = randomTransform(r);
        const moved = execute(session, 'entity.transform', { ids: [...session.doc.entities.keys()], transform: t });
        expect(moved.pruned).toBe(0);
        dims.forEach((d, i) => {
          const got = shown(moved.session.doc, ids[i]!);
          const want = remeasure(d, sc, t, (x) => x.onGeometry);
          if (!near(got.value, want)) throw new Error(`seed ${s}: ${d.kind} after ${t.kind} shows ${got.value}, measured ${want}`);
        });
        return true;
      }),
      { numRuns: CASES, seed: PROPERTY_PARAMS.seed },
    );
  });
});

describe('dimensions follow trim, extend and other edits (hand-calculated)', () => {
  const lineAndWall = () => {
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: segment(P(0, 0), P(100, 0)) }).session; // id 2
    s = execute(s, 'entity.add', { geom: segment(P(40, -10), P(40, 10)) }).session; // id 3
    return s;
  };
  const dimToStart = (s: Session) => execute(s, 'note.add', { body: { kind: 'aligned', a: { kind: 'end', id: 2, end: 'end' }, b: { kind: 'free', p: P(0, 0) }, at: P(20, -10), style: STYLE } });

  it('trimming the line back to the wall shortens the dimension from 100 to 40', () => {
    const added = dimToStart(lineAndWall());
    expect(shown(added.session.doc, added.result.id).value).toBe(100);
    const trimmed = execute(added.session, 'entity.trim', { id: 2, pick: P(80, 0) });
    expect(trimmed.pruned).toBe(0);
    const after = shown(trimmed.session.doc, added.result.id);
    expect(after.value).toBeCloseTo(40, 9);
    expect(after.text).toBe('40.00');
    expect(isDeepStrictEqual(undo(trimmed.session).doc, added.session.doc)).toBe(true);
  });

  it('extending a short line to the wall lengthens the dimension from 30 to 40', () => {
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: segment(P(0, 0), P(30, 0)) }).session;
    s = execute(s, 'entity.add', { geom: segment(P(40, -10), P(40, 10)) }).session;
    const added = execute(s, 'note.add', { body: { kind: 'aligned', a: { kind: 'end', id: 2, end: 'end' }, b: { kind: 'free', p: P(0, 0) }, at: P(20, -10), style: STYLE } });
    expect(shown(added.session.doc, added.result.id).value).toBe(30);
    const extended = execute(added.session, 'entity.extend', { id: 2, pick: P(29, 0) });
    expect(shown(extended.session.doc, added.result.id).value).toBeCloseTo(40, 9);
  });

  it('a radius dimension follows when a circle is scaled', () => {
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: circle(P(0, 0), 5) }).session;
    const added = execute(s, 'note.add', { body: { kind: 'radius', target: 2, at: P(20, 0), style: STYLE } });
    const scaled = execute(added.session, 'entity.transform', { ids: [2], transform: { kind: 'scale', center: P(0, 0), factor: 3 } });
    const after = shown(scaled.session.doc, added.result.id);
    expect(after.value).toBe(15);
    expect(after.text).toBe('R15.00');
  });

  it('exploding a polyline removes a dimension on one of its corners, and undo brings it back', () => {
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: polyline([P(0, 0), P(10, 0), P(10, 10)].map((p) => ({ ...p, bulge: 0 })), false) }).session;
    const added = execute(s, 'note.add', {
      body: { kind: 'aligned', a: { kind: 'vertex', id: 2, index: 0 }, b: { kind: 'vertex', id: 2, index: 2 }, at: P(0, 20), style: STYLE },
    });
    const exploded = execute(added.session, 'entity.explode', { ids: [2] });
    expect(exploded.pruned).toBe(1);
    expect(exploded.session.doc.notes.size).toBe(0);
    const back = undo(exploded.session);
    expect(back.doc.notes.size).toBe(1);
    expect(isDeepStrictEqual(back.doc, added.session.doc)).toBe(true);
  });

  it('deleting the geometry removes the dimension; deleting the dimension leaves the geometry', () => {
    const added = dimToStart(lineAndWall());
    const gone = execute(added.session, 'entity.delete', { ids: [2] });
    expect(gone.pruned).toBe(1);
    expect(gone.session.doc.notes.size).toBe(0);
    const keep = execute(added.session, 'entity.delete', { ids: [added.result.id] });
    expect(keep.session.doc.entities.size).toBe(added.session.doc.entities.size);
    expect(keep.session.doc.notes.size).toBe(0);
  });

  it('copying the line does not copy the dimension on it', () => {
    const added = dimToStart(lineAndWall());
    const copied = execute(added.session, 'entity.copy', { ids: [2, added.result.id], transform: { kind: 'translate', dx: 0, dy: 50 } });
    expect(copied.session.doc.entities.size).toBe(added.session.doc.entities.size + 1);
    expect(copied.session.doc.notes.size).toBe(1);
  });
});
