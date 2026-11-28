/**
 * Geometric and dimensional constraints. They are relations, not measured dimensions: a
 * distance constraint drives the geometry, while a dimension note only displays a length
 * unless it is a driving dimension (Phase 13), in which case the two are linked by id.
 *
 * After every command the solver runs to a fixed point. The same document always produces
 * the same result: constraints are applied in id order, a set number of times, with no
 * randomness. User edits pin the points the user just placed; if a constraint cannot be
 * kept, the edit is refused and nothing changes.
 */
import {
  add,
  angleOf,
  arc,
  circle,
  distance,
  midpoint,
  normalize,
  perp,
  polyline,
  scale,
  segment,
  sub,
  tolFor,
  type Segment,
  type Shape,
  type Vec2,
} from '../geom';
import { CommandError, type Draft } from './draft';
import type { Doc, Entity } from './model';
import { docEnv, resolveRef, type NoteEnv, type PointRef } from './notes';
import { onCurrentSheet } from './sheets';

export const MAX_SOLVE_ITERS = 48;

export type ConstraintBody =
  | { readonly kind: 'coincident'; readonly a: PointRef; readonly b: PointRef }
  | { readonly kind: 'horizontal'; readonly a: PointRef; readonly b: PointRef }
  | { readonly kind: 'vertical'; readonly a: PointRef; readonly b: PointRef }
  | {
      readonly kind: 'distance';
      readonly a: PointRef;
      readonly b: PointRef;
      readonly value: number;
      /** Omitted (or not set) means the straight-line distance. */
      readonly axis?: 'x' | 'y';
    }
  | { readonly kind: 'fix'; readonly a: PointRef; readonly p: Vec2 }
  | { readonly kind: 'midpoint'; readonly a: PointRef; readonly of: number }
  | { readonly kind: 'parallel'; readonly a: number; readonly b: number }
  | { readonly kind: 'perpendicular'; readonly a: number; readonly b: number }
  | { readonly kind: 'equal'; readonly a: number; readonly b: number }
  | { readonly kind: 'concentric'; readonly a: number; readonly b: number }
  | { readonly kind: 'tangent'; readonly a: number; readonly b: number }
  | { readonly kind: 'radius'; readonly target: number; readonly value: number }
  | { readonly kind: 'length'; readonly target: number; readonly value: number }
  | { readonly kind: 'angle'; readonly a: number; readonly b: number; readonly value: number };

export const CONSTRAINT_KINDS = [
  'coincident',
  'horizontal',
  'vertical',
  'distance',
  'fix',
  'midpoint',
  'parallel',
  'perpendicular',
  'equal',
  'concentric',
  'tangent',
  'radius',
  'length',
  'angle',
] as const;

export type ConstraintKind = ConstraintBody['kind'];

/** How a distance constraint is measured. Omitted on the body means `any`. */
export type DistanceAxis = 'any' | 'x' | 'y';

export function distanceAxis(b: Extract<ConstraintBody, { kind: 'distance' }>): DistanceAxis {
  return b.axis ?? 'any';
}

export interface Constraint {
  readonly id: number;
  readonly body: ConstraintBody;
  readonly sheet?: string;
  /** Driving dimension this constraint holds. Omitted when it is not linked to a note. */
  readonly note?: number;
}

export function constraintEntityIds(c: Constraint): number[] {
  const b = c.body;
  const ref = (r: PointRef): number[] => (r.kind === 'free' ? [] : [r.id]);
  switch (b.kind) {
    case 'coincident':
    case 'horizontal':
    case 'vertical':
    case 'distance':
      return [...ref(b.a), ...ref(b.b)];
    case 'fix':
      return ref(b.a);
    case 'midpoint':
      return [...ref(b.a), b.of];
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'concentric':
    case 'tangent':
    case 'angle':
      return [b.a, b.b];
    case 'radius':
    case 'length':
      return [b.target];
  }
}

function envOf(draft: Draft): NoteEnv {
  return draft.env();
}

/** Why this constraint can no longer be applied, or null if it still can. */
export function constraintProblem(env: NoteEnv, c: Constraint): string | null {
  try {
    residualOf(env, c.body);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'This constraint no longer applies.';
  }
}

function asSegment(e: Entity): Segment | null {
  return e.geom.kind === 'segment' ? e.geom : null;
}

function asRound(e: Entity): { center: Vec2; radius: number } | null {
  const g = e.geom;
  return g.kind === 'circle' || g.kind === 'arc' ? { center: g.center, radius: g.radius } : null;
}

function needEntity(env: NoteEnv, id: number, what: string): Entity {
  const e = env.entity(id);
  if (!e) throw new Error(`The ${what} (id ${id}) is gone.`);
  return e;
}

function needSegment(env: NoteEnv, id: number, what: string): Segment {
  const e = needEntity(env, id, what);
  const s = asSegment(e);
  if (!s) throw new Error(`Constraint "${what}" needs a line.`);
  return s;
}

function needRound(env: NoteEnv, id: number, what: string): { center: Vec2; radius: number } {
  const e = needEntity(env, id, what);
  const r = asRound(e);
  if (!r) throw new Error(`Constraint "${what}" needs a circle or an arc.`);
  return r;
}

function dirOf(s: Segment): Vec2 {
  return sub(s.end, s.start);
}

function unitDir(s: Segment): Vec2 {
  const d = dirOf(s);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) throw new Error('A zero-length line cannot take this constraint.');
  return { x: d.x / len, y: d.y / len };
}

function angleBetween(a: Segment, b: Segment): number {
  const da = unitDir(a);
  const db = unitDir(b);
  const c = Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y));
  return Math.acos(c);
}

/** Signed residual (distance, length or angle). Used by tests and by the solver's stop check. */
export function residualOf(env: NoteEnv, b: ConstraintBody): number {
  switch (b.kind) {
    case 'coincident':
      return distance(resolveRef(env, b.a), resolveRef(env, b.b));
    case 'horizontal':
      return Math.abs(resolveRef(env, b.a).y - resolveRef(env, b.b).y);
    case 'vertical':
      return Math.abs(resolveRef(env, b.a).x - resolveRef(env, b.b).x);
    case 'distance': {
      const a = resolveRef(env, b.a);
      const c = resolveRef(env, b.b);
      const span = b.axis === 'x' ? Math.abs(c.x - a.x) : b.axis === 'y' ? Math.abs(c.y - a.y) : distance(a, c);
      return Math.abs(span - b.value);
    }
    case 'fix':
      return distance(resolveRef(env, b.a), b.p);
    case 'midpoint':
      return distance(resolveRef(env, b.a), midpoint(needSegment(env, b.of, 'midpoint').start, needSegment(env, b.of, 'midpoint').end));
    case 'parallel': {
      const a = needSegment(env, b.a, 'parallel');
      const c = needSegment(env, b.b, 'parallel');
      return Math.abs(Math.abs(unitDir(a).x * unitDir(c).x + unitDir(a).y * unitDir(c).y) - 1);
    }
    case 'perpendicular': {
      const a = needSegment(env, b.a, 'perpendicular');
      const c = needSegment(env, b.b, 'perpendicular');
      return Math.abs(unitDir(a).x * unitDir(c).x + unitDir(a).y * unitDir(c).y);
    }
    case 'equal':
      return Math.abs(distance(needSegment(env, b.a, 'equal').start, needSegment(env, b.a, 'equal').end) - distance(needSegment(env, b.b, 'equal').start, needSegment(env, b.b, 'equal').end));
    case 'concentric':
      return distance(needRound(env, b.a, 'concentric').center, needRound(env, b.b, 'concentric').center);
    case 'tangent':
      return tangentResidual(env, b.a, b.b);
    case 'radius':
      return Math.abs(needRound(env, b.target, 'radius').radius - b.value);
    case 'length':
      return Math.abs(distance(needSegment(env, b.target, 'length').start, needSegment(env, b.target, 'length').end) - b.value);
    case 'angle':
      return Math.abs(angleBetween(needSegment(env, b.a, 'angle'), needSegment(env, b.b, 'angle')) - b.value);
  }
}

function tangentResidual(env: NoteEnv, a: number, b: number): number {
  const ea = needEntity(env, a, 'tangent');
  const eb = needEntity(env, b, 'tangent');
  const ra = asRound(ea);
  const rb = asRound(eb);
  const sa = asSegment(ea);
  const sb = asSegment(eb);
  if (ra && rb) {
    const d = distance(ra.center, rb.center);
    const ext = ra.radius + rb.radius;
    const inn = Math.abs(ra.radius - rb.radius);
    return Math.min(Math.abs(d - ext), Math.abs(d - inn));
  }
  const round = ra ?? rb;
  const line = sa ?? sb;
  if (!round || !line) throw new Error('A tangent needs a circle or arc and a line, or two circles.');
  const ab = sub(line.end, line.start);
  const len = Math.hypot(ab.x, ab.y);
  if (len === 0) throw new Error('A zero-length line cannot be tangent.');
  const n = perp({ x: ab.x / len, y: ab.y / len });
  const dist = Math.abs(n.x * (round.center.x - line.start.x) + n.y * (round.center.y - line.start.y));
  return Math.abs(dist - round.radius);
}

export function maxResidual(doc: Doc): number {
  const env = docEnv(doc);
  let max = 0;
  for (const c of doc.constraints.values()) {
    if (!onCurrentSheet(doc, c) && c.sheet !== undefined) continue;
    try {
      max = Math.max(max, residualOf(env, c.body));
    } catch {
      max = Math.max(max, Infinity);
    }
  }
  return max;
}

/** A constraint further from true than this (drawing units, or a ratio for angles) is "not met". */
export const CONSTRAINT_MET_TOL = 1e-6;

export interface UnmetConstraint {
  readonly id: number;
  readonly kind: ConstraintKind;
  readonly residual: number;
}

/**
 * The constraints on the current sheet that the solver left unsatisfied: conflicting
 * constraints, ones it could not reach in `MAX_SOLVE_ITERS` rounds, or ones whose geometry
 * cannot take them. The solver never reports this itself, so the app asks after each change.
 */
export function unmetConstraints(doc: Doc): UnmetConstraint[] {
  const env = docEnv(doc);
  const out: UnmetConstraint[] = [];
  for (const c of doc.constraints.values()) {
    if (!onCurrentSheet(doc, c)) continue;
    let residual: number;
    try {
      residual = residualOf(env, c.body);
    } catch {
      residual = Infinity;
    }
    if (!(residual <= CONSTRAINT_MET_TOL)) out.push({ id: c.id, kind: c.body.kind, residual });
  }
  return out.sort((a, b) => a.id - b.id);
}

function pointRole(ref: PointRef): string {
  if (ref.kind === 'end' && ref.end === 'start') return 'The start of this line';
  if (ref.kind === 'end' && ref.end === 'end') return 'The end of this line';
  if (ref.kind === 'center') return 'The centre of this circle';
  if (ref.kind === 'mid') return 'The middle of this line';
  if (ref.kind === 'vertex') return 'This corner';
  return 'This point';
}

/** Plain-words refusal when a user edit cannot keep a constraint. */
export function constraintRefuseMessage(c: Constraint): string {
  const id = c.id;
  const b = c.body;
  switch (b.kind) {
    case 'fix':
      return `${pointRole(b.a)} is fixed (constraint ${id}). Change or delete that constraint first.`;
    case 'distance':
      return `This distance is held at ${b.value} (constraint ${id}). Change or delete that constraint first.`;
    case 'length':
      return `This length is held at ${b.value} (constraint ${id}). Change or delete that constraint first.`;
    case 'radius':
      return `This radius is held at ${b.value} (constraint ${id}). Change or delete that constraint first.`;
    case 'horizontal':
      return `This line is held horizontal (constraint ${id}). Change or delete that constraint first.`;
    case 'vertical':
      return `This line is held vertical (constraint ${id}). Change or delete that constraint first.`;
    case 'angle':
      return `This angle is held (constraint ${id}). Change or delete that constraint first.`;
    default:
      return `${b.kind} (constraint ${id}) could not be kept. Change or delete that constraint first.`;
  }
}

export interface SolvePins {
  readonly points: ReadonlyMap<string, Vec2>;
  readonly radii: ReadonlyMap<number, number>;
}

function namedPoints(e: Entity): { readonly key: string; readonly p: Vec2 }[] {
  const g = e.geom;
  switch (g.kind) {
    case 'segment':
      return [
        { key: 'start', p: g.start },
        { key: 'end', p: g.end },
      ];
    case 'circle':
    case 'arc':
      return [{ key: 'center', p: g.center }];
    case 'polyline':
      return g.vertices.map((v, i) => ({ key: `v:${i}`, p: { x: v.x, y: v.y } }));
  }
}

function entityRadius(e: Entity): number | undefined {
  return e.geom.kind === 'circle' || e.geom.kind === 'arc' ? e.geom.radius : undefined;
}

function sameGeom(a: Shape, b: Shape): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Points (and radii) the command just placed: every named handle of an entity that already
 * existed and whose shape changed. The solver holds these still and moves the rest. An entity
 * that was only restyled (layer, colour, lineweight) places nothing, so it pins nothing.
 */
export function pinsFromDraft(draft: Draft): SolvePins {
  const points = new Map<string, Vec2>();
  const radii = new Map<number, number>();
  for (const id of draft.touchedEntityIds()) {
    const before = draft.base.entities.get(id);
    const after = draft.entity(id);
    if (!before || !after) continue;
    if (sameGeom(before.geom, after.geom)) continue;
    for (const h of namedPoints(after)) points.set(`${id}:${h.key}`, h.p);
    const r1 = entityRadius(after);
    if (r1 !== undefined) radii.set(id, r1);
  }
  return { points, radii };
}

function hasPins(pins: SolvePins): boolean {
  return pins.points.size > 0 || pins.radii.size > 0;
}

export function unmetOnDraft(draft: Draft): UnmetConstraint[] {
  const env = envOf(draft);
  const first = draft.sheets[0]?.name;
  const current = draft.settings.currentSheet;
  const out: UnmetConstraint[] = [];
  for (const c of draft.constraints()) {
    const name = c.sheet ?? first;
    if (name !== current) continue;
    let residual: number;
    try {
      residual = residualOf(env, c.body);
    } catch {
      residual = Infinity;
    }
    if (!(residual <= CONSTRAINT_MET_TOL)) out.push({ id: c.id, kind: c.body.kind, residual });
  }
  return out.sort((a, b) => (b.residual - a.residual) || a.id - b.id);
}

interface Handle {
  readonly id: number;
  readonly key: string;
}

function refHandle(ref: PointRef): Handle | null {
  if (ref.kind === 'free') return null;
  if (ref.kind === 'vertex') return { id: ref.id, key: `v:${ref.index}` };
  if (ref.kind === 'end') return { id: ref.id, key: ref.end };
  return { id: ref.id, key: ref.kind };
}

function push(map: Map<string, Vec2[]>, h: Handle | null, p: Vec2): void {
  if (!h) return;
  const k = `${h.id}:${h.key}`;
  const list = map.get(k);
  if (list) list.push(p);
  else map.set(k, [p]);
}

function avg(pts: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length;
  return { x: x / n, y: y / n };
}

function setLength(s: Segment, len: number): Segment {
  const mid = midpoint(s.start, s.end);
  const d = dirOf(s);
  const cur = Math.hypot(d.x, d.y);
  if (cur === 0 || len <= 0) return s;
  const u = scale(d, len / (2 * cur));
  return segment(sub(mid, u), add(mid, u));
}

function setDir(s: Segment, dir: Vec2): Segment {
  const mid = midpoint(s.start, s.end);
  const len = distance(s.start, s.end);
  if (len === 0) return s;
  const u = scale(normalize(dir), len / 2);
  return segment(sub(mid, u), add(mid, u));
}

function closerDir(want: Vec2, current: Vec2): Vec2 {
  const flip = { x: -want.x, y: -want.y };
  const d1 = (want.x - current.x) ** 2 + (want.y - current.y) ** 2;
  const d2 = (flip.x - current.x) ** 2 + (flip.y - current.y) ** 2;
  return d1 <= d2 ? want : flip;
}

function lineDistNormal(line: Segment, p: Vec2): { dist: number; side: Vec2 } {
  const ab = unitDir(line);
  const n = perp(ab);
  const signed = n.x * (p.x - line.start.x) + n.y * (p.y - line.start.y);
  return { dist: Math.abs(signed), side: signed >= 0 ? n : { x: -n.x, y: -n.y } };
}

function pinOf(pins: SolvePins, ref: PointRef): Vec2 | undefined {
  const h = refHandle(ref);
  return h ? pins.points.get(`${h.id}:${h.key}`) : undefined;
}

function pinHandle(pins: SolvePins, id: number, key: string): Vec2 | undefined {
  return pins.points.get(`${id}:${key}`);
}

function placeAtDistance(from: Vec2, toward: Vec2, value: number): Vec2 {
  const d = distance(from, toward);
  if (d === 0) return { x: from.x + value, y: from.y };
  return add(from, scale(sub(toward, from), value / d));
}

function propose(env: NoteEnv, b: ConstraintBody, pts: Map<string, Vec2[]>, radii: Map<number, number[]>, pins: SolvePins): void {
  const put = (ref: PointRef, p: Vec2) => push(pts, refHandle(ref), p);
  switch (b.kind) {
    case 'coincident': {
      const a = resolveRef(env, b.a);
      const c = resolveRef(env, b.b);
      const pa = pinOf(pins, b.a);
      const pb = pinOf(pins, b.b);
      if (pa && !pb) {
        put(b.b, pa);
        return;
      }
      if (pb && !pa) {
        put(b.a, pb);
        return;
      }
      if (pa && pb) return;
      put(b.b, a);
      return;
    }
    case 'horizontal': {
      const a = resolveRef(env, b.a);
      const c = resolveRef(env, b.b);
      const pa = pinOf(pins, b.a);
      const pb = pinOf(pins, b.b);
      if (pa && !pb) {
        put(b.b, { x: c.x, y: pa.y });
        return;
      }
      if (pb && !pa) {
        put(b.a, { x: a.x, y: pb.y });
        return;
      }
      if (pa && pb) return;
      put(b.b, { x: c.x, y: a.y });
      return;
    }
    case 'vertical': {
      const a = resolveRef(env, b.a);
      const c = resolveRef(env, b.b);
      const pa = pinOf(pins, b.a);
      const pb = pinOf(pins, b.b);
      if (pa && !pb) {
        put(b.b, { x: pa.x, y: c.y });
        return;
      }
      if (pb && !pa) {
        put(b.a, { x: pb.x, y: a.y });
        return;
      }
      if (pa && pb) return;
      put(b.b, { x: a.x, y: c.y });
      return;
    }
    case 'distance': {
      const a = resolveRef(env, b.a);
      const c = resolveRef(env, b.b);
      const pa = pinOf(pins, b.a);
      const pb = pinOf(pins, b.b);
      if (b.axis === 'x') {
        if (pa && !pb) {
          const sign = c.x >= pa.x ? 1 : -1;
          put(b.b, { x: pa.x + sign * b.value, y: c.y });
          return;
        }
        if (pb && !pa) {
          const sign = pb.x >= a.x ? 1 : -1;
          put(b.a, { x: pb.x - sign * b.value, y: a.y });
          return;
        }
        if (pa && pb) return;
        const sign = c.x >= a.x ? 1 : -1;
        put(b.b, { x: a.x + sign * b.value, y: c.y });
        return;
      }
      if (b.axis === 'y') {
        if (pa && !pb) {
          const sign = c.y >= pa.y ? 1 : -1;
          put(b.b, { x: c.x, y: pa.y + sign * b.value });
          return;
        }
        if (pb && !pa) {
          const sign = pb.y >= a.y ? 1 : -1;
          put(b.a, { x: a.x, y: pb.y - sign * b.value });
          return;
        }
        if (pa && pb) return;
        const sign = c.y >= a.y ? 1 : -1;
        put(b.b, { x: c.x, y: a.y + sign * b.value });
        return;
      }
      if (pa && !pb) {
        put(b.b, placeAtDistance(pa, c, b.value));
        return;
      }
      if (pb && !pa) {
        put(b.a, placeAtDistance(pb, a, b.value));
        return;
      }
      if (pa && pb) return;
      put(b.b, placeAtDistance(a, c, b.value));
      return;
    }
    case 'fix':
      put(b.a, b.p);
      return;
    case 'midpoint': {
      const s = needSegment(env, b.of, 'midpoint');
      put(b.a, midpoint(s.start, s.end));
      return;
    }
    case 'parallel': {
      const a = needSegment(env, Math.min(b.a, b.b), 'parallel');
      const c = needSegment(env, Math.max(b.a, b.b), 'parallel');
      const want = closerDir(unitDir(a), unitDir(c));
      const next = setDir(c, want);
      push(pts, { id: Math.max(b.a, b.b), key: 'start' }, next.start);
      push(pts, { id: Math.max(b.a, b.b), key: 'end' }, next.end);
      return;
    }
    case 'perpendicular': {
      const a = needSegment(env, Math.min(b.a, b.b), 'perpendicular');
      const c = needSegment(env, Math.max(b.a, b.b), 'perpendicular');
      const want = closerDir(perp(unitDir(a)), unitDir(c));
      const next = setDir(c, want);
      push(pts, { id: Math.max(b.a, b.b), key: 'start' }, next.start);
      push(pts, { id: Math.max(b.a, b.b), key: 'end' }, next.end);
      return;
    }
    case 'equal': {
      const a = needSegment(env, b.a, 'equal');
      const c = needSegment(env, b.b, 'equal');
      const len = (distance(a.start, a.end) + distance(c.start, c.end)) / 2;
      const na = setLength(a, len);
      const nc = setLength(c, len);
      push(pts, { id: b.a, key: 'start' }, na.start);
      push(pts, { id: b.a, key: 'end' }, na.end);
      push(pts, { id: b.b, key: 'start' }, nc.start);
      push(pts, { id: b.b, key: 'end' }, nc.end);
      return;
    }
    case 'concentric': {
      const a = needRound(env, b.a, 'concentric');
      const c = needRound(env, b.b, 'concentric');
      const pa = pinHandle(pins, b.a, 'center');
      const pb = pinHandle(pins, b.b, 'center');
      if (pa && !pb) {
        push(pts, { id: b.b, key: 'center' }, pa);
        return;
      }
      if (pb && !pa) {
        push(pts, { id: b.a, key: 'center' }, pb);
        return;
      }
      if (pa && pb) return;
      push(pts, { id: b.b, key: 'center' }, a.center);
      return;
    }
    case 'tangent': {
      proposeTangent(env, b.a, b.b, pts);
      return;
    }
    case 'radius': {
      needRound(env, b.target, 'radius');
      const list = radii.get(b.target);
      if (list) list.push(b.value);
      else radii.set(b.target, [b.value]);
      return;
    }
    case 'length': {
      const s = needSegment(env, b.target, 'length');
      const ps = pinHandle(pins, b.target, 'start');
      const pe = pinHandle(pins, b.target, 'end');
      if (ps && pe) return;
      if (ps && !pe) {
        push(pts, { id: b.target, key: 'end' }, placeAtDistance(ps, s.end, b.value));
        return;
      }
      if (pe && !ps) {
        push(pts, { id: b.target, key: 'start' }, placeAtDistance(pe, s.start, b.value));
        return;
      }
      const next = setLength(s, b.value);
      push(pts, { id: b.target, key: 'start' }, next.start);
      push(pts, { id: b.target, key: 'end' }, next.end);
      return;
    }
    case 'angle': {
      const low = Math.min(b.a, b.b);
      const high = Math.max(b.a, b.b);
      const a = needSegment(env, low, 'angle');
      const c = needSegment(env, high, 'angle');
      const current = angleOf(dirOf(c)) - angleOf(dirOf(a));
      const want = b.value;
      // Rotate the higher-id line so the unsigned angle matches.
      const sign = Math.sin(current) >= 0 ? 1 : -1;
      const target = angleOf(dirOf(a)) + sign * want;
      const next = setDir(c, { x: Math.cos(target), y: Math.sin(target) });
      push(pts, { id: high, key: 'start' }, next.start);
      push(pts, { id: high, key: 'end' }, next.end);
    }
  }
}

function proposeTangent(env: NoteEnv, a: number, b: number, pts: Map<string, Vec2[]>): void {
  const ea = needEntity(env, a, 'tangent');
  const eb = needEntity(env, b, 'tangent');
  const ra = asRound(ea);
  const rb = asRound(eb);
  const sa = asSegment(ea);
  const sb = asSegment(eb);
  if (ra && rb) {
    const d = distance(ra.center, rb.center);
    const ext = ra.radius + rb.radius;
    const inn = Math.abs(ra.radius - rb.radius);
    const target = Math.abs(d - inn) < Math.abs(d - ext) ? inn : ext;
    if (d === 0) {
      push(pts, { id: b, key: 'center' }, { x: ra.center.x + target, y: ra.center.y });
      return;
    }
    const u = scale(sub(rb.center, ra.center), target / (2 * d));
    const mid = midpoint(ra.center, rb.center);
    push(pts, { id: a, key: 'center' }, sub(mid, u));
    push(pts, { id: b, key: 'center' }, add(mid, u));
    return;
  }
  const roundId = ra ? a : b;
  const lineId = sa ? a : b;
  const round = ra ?? rb;
  const line = sa ?? sb;
  if (!round || !line) throw new Error('A tangent needs a circle or arc and a line, or two circles.');
  const { dist, side } = lineDistNormal(line, round.center);
  const next = add(round.center, scale(side, round.radius - dist));
  push(pts, { id: roundId, key: 'center' }, next);
  void lineId;
}

function mean(ns: readonly number[]): number {
  return ns.reduce((s, n) => s + n, 0) / ns.length;
}

function writeEntity(e: Entity, pts: Map<string, Vec2>, radius: number | undefined): Entity | null {
  const g = e.geom;
  const at = (key: string): Vec2 | undefined => pts.get(`${e.id}:${key}`);
  let geom: Shape = g;
  if (g.kind === 'segment') {
    const start = at('start') ?? g.start;
    const end = at('end') ?? g.end;
    const mid = at('mid');
    if (mid && !at('start') && !at('end')) {
      const d = sub(mid, midpoint(g.start, g.end));
      geom = segment(add(g.start, d), add(g.end, d));
    } else if (start.x !== g.start.x || start.y !== g.start.y || end.x !== g.end.x || end.y !== g.end.y) {
      if (start.x === end.x && start.y === end.y) return null;
      geom = segment(start, end);
    }
  } else if (g.kind === 'circle') {
    const center = at('center') ?? g.center;
    const r = radius ?? g.radius;
    if (center.x !== g.center.x || center.y !== g.center.y || r !== g.radius) geom = circle(center, r);
  } else if (g.kind === 'arc') {
    const center = at('center') ?? g.center;
    const r = radius ?? g.radius;
    if (center.x !== g.center.x || center.y !== g.center.y || r !== g.radius) {
      geom = arc(center, r, g.start, g.sweep);
    }
  } else if (g.kind === 'polyline') {
    let changed = false;
    const vertices = g.vertices.map((v, i) => {
      const p = at(`v:${i}`);
      if (!p) return v;
      changed = true;
      return { ...v, x: p.x, y: p.y };
    });
    if (changed) geom = polyline(vertices, g.closed);
  }
  if (geom === g) return null;
  return { ...e, geom };
}

/**
 * Applies every constraint on the current sheet to the draft, in id order, until the
 * residual stops shrinking or a fixed iteration count is reached. `pins` are handles the
 * user just placed: they stay put and the rest of the drawing follows.
 */
export function solveConstraints(draft: Draft, pins: SolvePins = { points: new Map(), radii: new Map() }): void {
  const list = [...draft.constraints()].filter((c) => {
    const first = draft.sheets[0]?.name;
    const name = c.sheet ?? first;
    return name === draft.settings.currentSheet;
  });
  if (list.length === 0) return;
  list.sort((a, b) => a.id - b.id);
  const env = envOf(draft);
  const effective = {
    points: new Map(pins.points),
    radii: new Map(pins.radii),
  };
  for (const c of list) {
    if (c.body.kind !== 'fix') continue;
    const h = refHandle(c.body.a);
    if (!h) continue;
    const key = `${h.id}:${h.key}`;
    if (!effective.points.has(key)) effective.points.set(key, c.body.p);
  }
  let last = Infinity;
  for (let iter = 0; iter < MAX_SOLVE_ITERS; iter++) {
    const pts = new Map<string, Vec2[]>();
    const radii = new Map<number, number[]>();
    for (const c of list) {
      try {
        propose(env, c.body, pts, radii, effective);
      } catch {
        // A constraint that cannot apply this iteration is skipped; prune happens separately.
      }
    }
    const averaged = new Map<string, Vec2>();
    for (const [k, v] of pts) averaged.set(k, avg(v));
    for (const [k, p] of effective.points) averaged.set(k, p);
    const radiusOf = new Map<number, number>();
    for (const [id, v] of radii) radiusOf.set(id, mean(v));
    for (const [id, r] of effective.radii) radiusOf.set(id, r);
    let moved = 0;
    const seen = new Set<number>();
    for (const key of averaged.keys()) seen.add(Number(key.slice(0, key.indexOf(':'))));
    for (const id of radiusOf.keys()) seen.add(id);
    for (const id of seen) {
      const e = draft.entity(id);
      const next = e ? writeEntity(e, averaged, radiusOf.get(id)) : null;
      if (!next) continue;
      draft.putEntity(next);
      moved += 1;
    }
    let res = 0;
    for (const c of list) {
      try {
        res = Math.max(res, residualOf(env, c.body));
      } catch {
        res = Math.max(res, last);
      }
    }
    if (res <= tolFor() || (moved === 0 && iter > 0) || (iter > 2 && res >= last)) return;
    last = res;
  }
}

/** Drops constraints whose geometry is gone, then re-solves what remains. */
export function pruneAndSolve(draft: Draft): number {
  const env = envOf(draft);
  let n = 0;
  for (const c of [...draft.constraints()]) {
    if (constraintProblem(env, c) !== null) {
      if (c.note !== undefined) draft.deleteNote(c.note);
      draft.deleteConstraint(c.id);
      n += 1;
    }
  }
  if ([...draft.constraints()].length === 0) return n;
  const pins = pinsFromDraft(draft);
  solveConstraints(draft, pins);
  if (hasPins(pins)) {
    // Refuse only what this edit broke or made worse. A constraint that could not be met before
    // (two that conflict, say) must not stop an unrelated edit; the status warning covers it.
    const was = new Map(unmetConstraints(draft.base).map((u) => [u.id, u.residual]));
    const broken = unmetOnDraft(draft).filter((u) => {
      const before = was.get(u.id);
      return before === undefined || u.residual > before + CONSTRAINT_MET_TOL;
    });
    if (broken.length > 0) {
      const c = draft.constraint(broken[0]!.id);
      throw new CommandError(c ? constraintRefuseMessage(c) : 'That change cannot keep the constraints.');
    }
  }
  return n;
}
