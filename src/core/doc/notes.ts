/**
 * Notes: everything on a drawing that is not geometry. Dimensions, text, leaders, centre marks,
 * hatches and title blocks. A note shares the id space and layers with entities.
 *
 * Dimensions, centre marks and hatches are associative: they refer to entities by id (and to
 * points on them by name), and are measured from the geometry every time they are drawn. The
 * measured value is never stored, so it cannot disagree with the geometry or be overtyped.
 */
import {
  boundsOfPoints,
  ccwSweep,
  cosSin,
  curveBounds,
  distance,
  hatchLines,
  isLoop,
  joinShapes,
  loopBounds,
  midpoint,
  normalizeAngle,
  normalize,
  perp,
  polyline,
  radToDeg,
  regionArea,
  segment,
  sub,
  add,
  scale,
  arc as makeArc,
  arcEndPoint,
  arcMidPoint,
  arcStartPoint,
  unionBounds,
  transformPoint,
  ANGULAR_TOL,
  TAU,
  type Bounds,
  type Loop,
  type Shape,
  type Transform,
  type Vec2,
} from '../geom';
import type { Doc, Entity } from './model';
import type { ColorRef, LineweightRef } from './styles';

// ---------- styles ----------

/**
 * How dimensions look. The defaults follow ISO practice: 3.5 mm text above an unbroken
 * dimension line, closed filled arrows, extension lines with a gap at the feature and a short
 * overshoot past the dimension line.
 */
export interface DimStyle {
  readonly name: string;
  readonly textHeight: number;
  readonly arrowSize: number;
  readonly extGap: number;
  readonly extOver: number;
  readonly textGap: number;
  /** Decimal places for lengths. */
  readonly precision: number;
  /** Decimal places for angles, in degrees. */
  readonly anglePrecision: number;
  /** Arm length of a centre mark's cross. */
  readonly centreMark: number;
  /** How far centre lines run past the circle. */
  readonly centreOver: number;
}

export const DEFAULT_DIM_STYLE_NAME = 'ISO';

export const DEFAULT_DIM_STYLE: DimStyle = Object.freeze({
  name: DEFAULT_DIM_STYLE_NAME,
  textHeight: 3.5,
  arrowSize: 3,
  extGap: 1,
  extOver: 2,
  textGap: 1,
  precision: 2,
  anglePrecision: 1,
  centreMark: 2.5,
  centreOver: 2,
});

export const MAX_STYLE_NAME = 32;
export const MAX_DIM_STYLES = 50;

// ---------- note bodies ----------

/** A point a dimension measures from: free, or tied to a named point on an entity. */
export type PointRef =
  | { readonly kind: 'free'; readonly p: Vec2 }
  | { readonly kind: 'end'; readonly id: number; readonly end: 'start' | 'end' }
  | { readonly kind: 'vertex'; readonly id: number; readonly index: number }
  | { readonly kind: 'mid'; readonly id: number }
  | { readonly kind: 'center'; readonly id: number };

export const HATCH_PATTERNS = ['solid', 'lines', 'cross', 'double', 'dots'] as const;
export type HatchPattern = (typeof HATCH_PATTERNS)[number];

export const HATCH_PATTERN_LABELS: Readonly<Record<HatchPattern, string>> = Object.freeze({
  solid: 'Solid',
  lines: 'Lines',
  cross: 'Cross lines',
  double: 'Paired lines',
  dots: 'Dots',
});

export const SHEET_SIZES = ['A4', 'A3', 'A2', 'A1', 'A0'] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];

/** Landscape sheet sizes in millimetres (ISO 216). */
export const SHEET_MM: Readonly<Record<SheetSize, { readonly w: number; readonly h: number }>> = Object.freeze({
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
});

export const TITLE_FIELDS = ['title', 'number', 'scale', 'revision', 'material', 'drawnBy', 'date', 'company'] as const;
export type TitleField = (typeof TITLE_FIELDS)[number];
export type TitleFields = Readonly<Record<TitleField, string>>;

export const TITLE_FIELD_LABELS: Readonly<Record<TitleField, string>> = Object.freeze({
  title: 'Title',
  number: 'Drawing number',
  scale: 'Scale',
  revision: 'Revision',
  material: 'Material',
  drawnBy: 'Drawn by',
  date: 'Date',
  company: 'Company',
});

export const EMPTY_TITLE_FIELDS: TitleFields = Object.freeze({
  title: '',
  number: '',
  scale: '',
  revision: '',
  material: '',
  drawnBy: '',
  date: '',
  company: '',
});

export const MAX_TEXT_LENGTH = 2000;
export const MAX_FIELD_LENGTH = 200;
export const MAX_LEADER_POINTS = 50;

export type NoteBody =
  | {
      readonly kind: 'linear';
      readonly orient: 'horizontal' | 'vertical';
      readonly a: PointRef;
      readonly b: PointRef;
      readonly at: Vec2;
      readonly style: string;
    }
  | { readonly kind: 'aligned'; readonly a: PointRef; readonly b: PointRef; readonly at: Vec2; readonly style: string }
  | { readonly kind: 'radius' | 'diameter'; readonly target: number; readonly at: Vec2; readonly style: string }
  | {
      readonly kind: 'angle';
      readonly vertex: PointRef;
      readonly a: PointRef;
      readonly b: PointRef;
      readonly at: Vec2;
      readonly style: string;
    }
  | {
      readonly kind: 'text';
      readonly at: Vec2;
      readonly height: number;
      readonly angle: number;
      readonly anchor: 'left' | 'center' | 'right';
      readonly text: string;
    }
  | { readonly kind: 'leader'; readonly points: readonly Vec2[]; readonly text: string; readonly style: string }
  | { readonly kind: 'centre'; readonly target: number; readonly extended: boolean; readonly style: string }
  | {
      readonly kind: 'hatch';
      /** The outer boundary first, then islands. Each is entity ids that form one closed loop. */
      readonly loops: readonly (readonly number[])[];
      readonly pattern: HatchPattern;
      readonly spacing: number;
      readonly angle: number;
    }
  | { readonly kind: 'titleBlock'; readonly at: Vec2; readonly size: SheetSize; readonly fields: TitleFields };

export type NoteKind = NoteBody['kind'];
export const NOTE_KINDS: readonly NoteKind[] = [
  'linear',
  'aligned',
  'radius',
  'diameter',
  'angle',
  'text',
  'leader',
  'centre',
  'hatch',
  'titleBlock',
];

export interface Note {
  readonly id: number;
  readonly layer: number;
  readonly z: number;
  readonly color: ColorRef;
  readonly lineweight: LineweightRef;
  readonly body: NoteBody;
}

export function isDimension(b: NoteBody): boolean {
  return b.kind === 'linear' || b.kind === 'aligned' || b.kind === 'radius' || b.kind === 'diameter' || b.kind === 'angle';
}

// ---------- drawing instructions ----------

/** What a note draws. Renderers and exporters read these; they know nothing about notes. */
export type Prim =
  | { readonly k: 'seg'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly k: 'arc'; readonly center: Vec2; readonly radius: number; readonly start: number; readonly sweep: number }
  /** A filled arrow: its tip, and the unit direction from the tip back along the line. */
  | { readonly k: 'arrow'; readonly tip: Vec2; readonly dir: Vec2; readonly size: number }
  | {
      readonly k: 'text';
      readonly at: Vec2;
      readonly height: number;
      readonly angle: number;
      readonly anchor: 'left' | 'center' | 'right';
      readonly baseline: 'bottom' | 'middle';
      readonly text: string;
    }
  | { readonly k: 'dot'; readonly p: Vec2 }
  | { readonly k: 'fill'; readonly loops: readonly Loop[] };

/** Width of one character as a share of the text height. Used for boxes, not for drawing. */
export const TEXT_ADVANCE = 0.62;
/** Distance between lines of text as a share of the text height. */
export const LINE_SPACING = 1.4;

export interface Resolved {
  readonly prims: readonly Prim[];
  /** Box around everything drawn. */
  readonly bounds: Bounds;
  /** The measured value: millimetres (or drawing units) for lengths, radians for angles. */
  readonly value?: number;
  /** The text a dimension shows. */
  readonly text?: string;
  /** The area a hatch covers. */
  readonly area?: number;
}

export type ResolveResult = { readonly ok: true; readonly r: Resolved } | { readonly ok: false; readonly why: string };

/** What a note needs to look up: entities and styles. A Doc and a command's working copy both provide it. */
export interface NoteEnv {
  entity(id: number): Entity | undefined;
  dimStyle(name: string): DimStyle | undefined;
}

export function docEnv(doc: Doc): NoteEnv {
  return {
    entity: (id) => doc.entities.get(id),
    dimStyle: (name) => doc.settings.dimStyles.find((s) => s.name === name),
  };
}

// ---------- measuring ----------

class Broken extends Error {}

function broken(why: string): never {
  throw new Broken(why);
}

/** The point a reference names right now, or throws Broken. */
export function resolveRef(env: NoteEnv, ref: PointRef): Vec2 {
  if (ref.kind === 'free') return ref.p;
  const e = env.entity(ref.id);
  if (!e) return broken(`The geometry it was measuring (id ${ref.id}) is gone.`);
  const g = e.geom;
  switch (ref.kind) {
    case 'end':
      if (g.kind === 'segment') return ref.end === 'start' ? g.start : g.end;
      if (g.kind === 'arc') return ref.end === 'start' ? arcStartPoint(g) : arcEndPoint(g);
      if (g.kind === 'polyline' && !g.closed) {
        const v = ref.end === 'start' ? g.vertices[0] : g.vertices[g.vertices.length - 1];
        return { x: (v as Vec2).x, y: (v as Vec2).y };
      }
      return broken('The end it was measuring no longer exists.');
    case 'vertex': {
      if (g.kind !== 'polyline') return broken('The corner it was measuring no longer exists.');
      const v = g.vertices[ref.index];
      if (!v) return broken('The corner it was measuring no longer exists.');
      return { x: v.x, y: v.y };
    }
    case 'mid':
      if (g.kind === 'segment') return midpoint(g.start, g.end);
      if (g.kind === 'arc') return arcMidPoint(g);
      return broken('The middle it was measuring no longer exists.');
    case 'center':
      if (g.kind === 'circle' || g.kind === 'arc') return g.center;
      return broken('The centre it was measuring no longer exists.');
  }
}

/**
 * Finds a reference for a point: if it sits exactly on an end, corner, middle or centre of an
 * entity, the reference follows that entity; otherwise it is a free point.
 */
export function refAt(doc: Doc, p: Vec2): PointRef {
  const same = (q: Vec2) => q.x === p.x && q.y === p.y;
  const entities = [...doc.entities.values()].sort((a, b) => a.id - b.id);
  const env = docEnv(doc);
  // Every candidate is built from the entity itself, so each one resolves.
  const tryRef = (ref: PointRef): boolean => same(resolveRef(env, ref));
  for (const e of entities) {
    const g = e.geom;
    const candidates: PointRef[] = [];
    if (g.kind === 'segment' || g.kind === 'arc') {
      candidates.push({ kind: 'end', id: e.id, end: 'start' }, { kind: 'end', id: e.id, end: 'end' }, { kind: 'mid', id: e.id });
    }
    if (g.kind === 'circle' || g.kind === 'arc') candidates.push({ kind: 'center', id: e.id });
    if (g.kind === 'polyline') g.vertices.forEach((_, index) => candidates.push({ kind: 'vertex', id: e.id, index }));
    const hit = candidates.find(tryRef);
    if (hit) return hit;
  }
  return { kind: 'free', p: { x: p.x + 0, y: p.y + 0 } };
}

function requireStyle(env: NoteEnv, name: string): DimStyle {
  const s = env.dimStyle(name);
  if (!s) return broken(`The dimension style "${name}" does not exist.`);
  return s;
}

function requireRound(env: NoteEnv, id: number): { center: Vec2; radius: number } {
  const e = env.entity(id);
  if (!e) return broken(`The circle or arc it was measuring (id ${id}) is gone.`);
  if (e.geom.kind !== 'circle' && e.geom.kind !== 'arc') return broken('What it was measuring is no longer a circle or an arc.');
  return { center: e.geom.center, radius: e.geom.radius };
}

/** A number shown to `places` decimal places, always with a point and a minus sign as "-" (never "-0.00"). */
export function formatNumber(value: number, places: number): string {
  const s = value.toFixed(places);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

export function formatLength(value: number, style: DimStyle): string {
  return formatNumber(value, style.precision);
}

export function formatAngle(radians: number, style: DimStyle): string {
  return `${formatNumber(radToDeg(radians), style.anglePrecision)}°`;
}

function uprightAngle(direction: Vec2): number {
  let a = Math.atan2(direction.y, direction.x);
  if (a > Math.PI / 2 + 1e-12 || a <= -Math.PI / 2 + 1e-12) a = normalizeAngle(a + Math.PI);
  return a > Math.PI ? a - TAU : a;
}

function arrowPair(q1: Vec2, q2: Vec2, size: number, prims: Prim[]): void {
  const span = distance(q1, q2);
  if (span === 0) return;
  const t = normalize(sub(q2, q1));
  if (span >= 2 * size) {
    prims.push({ k: 'seg', a: q1, b: q2 }, { k: 'arrow', tip: q1, dir: t, size }, { k: 'arrow', tip: q2, dir: scale(t, -1), size });
  } else {
    // Too short for arrows inside: they sit outside, pointing in, on short stubs of line.
    const stub = 1.5 * size;
    prims.push(
      { k: 'seg', a: q1, b: q2 },
      { k: 'seg', a: sub(q1, scale(t, stub)), b: q1 },
      { k: 'seg', a: q2, b: add(q2, scale(t, stub)) },
      { k: 'arrow', tip: q1, dir: scale(t, -1), size },
      { k: 'arrow', tip: q2, dir: t, size },
    );
  }
}

function textAbove(centre: Vec2, direction: Vec2, text: string, style: DimStyle, prims: Prim[]): void {
  const angle = uprightAngle(direction);
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  prims.push({
    k: 'text',
    at: add(centre, scale(up, style.textGap)),
    height: style.textHeight,
    angle,
    anchor: 'center',
    baseline: 'bottom',
    text,
  });
}

function extensionLine(from: Vec2, to: Vec2, style: DimStyle, prims: Prim[]): void {
  const len = distance(from, to);
  if (len === 0) return;
  const u = normalize(sub(to, from));
  const start = add(from, scale(u, Math.min(style.extGap, len)));
  prims.push({ k: 'seg', a: start, b: add(to, scale(u, style.extOver)) });
}

interface Measured {
  readonly prims: Prim[];
  readonly value: number;
  readonly text: string;
}

function measureLinear(env: NoteEnv, body: NoteBody & { kind: 'linear' | 'aligned' }): Measured {
  const style = requireStyle(env, body.style);
  const p1 = resolveRef(env, body.a);
  const p2 = resolveRef(env, body.b);
  let q1: Vec2;
  let q2: Vec2;
  let value: number;
  if (body.kind === 'aligned') {
    if (p1.x === p2.x && p1.y === p2.y) return broken('The two points are the same point.');
    const u = normalize(sub(p2, p1));
    const n = perp(u);
    const off = (body.at.x - p1.x) * n.x + (body.at.y - p1.y) * n.y;
    q1 = add(p1, scale(n, off));
    q2 = add(p2, scale(n, off));
    value = distance(p1, p2);
  } else if (body.orient === 'horizontal') {
    q1 = { x: p1.x, y: body.at.y };
    q2 = { x: p2.x, y: body.at.y };
    value = Math.abs(p2.x - p1.x);
  } else {
    q1 = { x: body.at.x, y: p1.y };
    q2 = { x: body.at.x, y: p2.y };
    value = Math.abs(p2.y - p1.y);
  }
  const prims: Prim[] = [];
  extensionLine(p1, q1, style, prims);
  extensionLine(p2, q2, style, prims);
  arrowPair(q1, q2, style.arrowSize, prims);
  const text = formatLength(value, style);
  const dir = distance(q1, q2) > 0 ? sub(q2, q1) : body.kind === 'linear' && body.orient === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  textAbove(midpoint(q1, q2), dir, text, style, prims);
  return { prims, value, text };
}

function measureRound(env: NoteEnv, body: NoteBody & { kind: 'radius' | 'diameter' }): Measured {
  const style = requireStyle(env, body.style);
  const { center, radius } = requireRound(env, body.target);
  const toward = sub(body.at, center);
  if (toward.x === 0 && toward.y === 0) return broken('Place the dimension away from the centre.');
  const u = normalize(toward);
  const prims: Prim[] = [];
  if (body.kind === 'radius') {
    const p = add(center, scale(u, radius));
    const tail = distance(p, body.at) > 0 ? normalize(sub(body.at, p)) : u;
    prims.push({ k: 'arrow', tip: p, dir: tail, size: style.arrowSize });
    if (distance(p, body.at) > 0) prims.push({ k: 'seg', a: p, b: body.at });
    const text = `R${formatLength(radius, style)}`;
    textAbove(distance(p, body.at) > 0 ? midpoint(p, body.at) : p, tail, text, style, prims);
    return { prims, value: radius, text };
  }
  const p1 = add(center, scale(u, radius));
  const p2 = sub(center, scale(u, radius));
  arrowPair(p1, p2, style.arrowSize, prims);
  const text = `Ø${formatLength(2 * radius, style)}`;
  textAbove(center, u, text, style, prims);
  return { prims, value: 2 * radius, text };
}

function measureAngle(env: NoteEnv, body: NoteBody & { kind: 'angle' }): Measured {
  const style = requireStyle(env, body.style);
  const v = resolveRef(env, body.vertex);
  const pa = resolveRef(env, body.a);
  const pb = resolveRef(env, body.b);
  const ra = sub(pa, v);
  const rb = sub(pb, v);
  if ((ra.x === 0 && ra.y === 0) || (rb.x === 0 && rb.y === 0)) return broken('A side of the angle has no length.');
  const R = distance(v, body.at);
  if (R === 0) return broken('Place the angle dimension away from its corner.');
  const alpha = normalizeAngle(Math.atan2(ra.y, ra.x));
  const beta = normalizeAngle(Math.atan2(rb.y, rb.x));
  const gamma = normalizeAngle(Math.atan2(body.at.y - v.y, body.at.x - v.x));
  const s1 = ccwSweep(alpha, beta);
  if (s1 < ANGULAR_TOL || TAU - s1 < ANGULAR_TOL) return broken('The two sides point the same way.');
  const direct = ccwSweep(alpha, gamma) <= s1;
  const start = direct ? alpha : beta;
  const sweep = direct ? s1 : TAU - s1;
  const prims: Prim[] = [];
  const dir = (a: number): Vec2 => cosSin(a);
  for (const [p, ang] of [
    [pa, alpha],
    [pb, beta],
  ] as const) {
    const d = distance(v, p);
    if (d < R) {
      const u = dir(ang);
      prims.push({ k: 'seg', a: add(v, scale(u, d + Math.min(style.extGap, R - d))), b: add(v, scale(u, R + style.extOver)) });
    }
  }
  prims.push({ k: 'arc', center: v, radius: R, start, sweep });
  const a0 = add(v, scale(dir(start), R));
  const a1 = add(v, scale(dir(start + sweep), R));
  const t0 = { x: -Math.sin(start), y: Math.cos(start) };
  const t1 = { x: Math.sin(start + sweep), y: -Math.cos(start + sweep) };
  prims.push({ k: 'arrow', tip: a0, dir: t0, size: style.arrowSize }, { k: 'arrow', tip: a1, dir: t1, size: style.arrowSize });
  const mid = start + sweep / 2;
  const text = formatAngle(sweep, style);
  textAbove(add(v, scale(dir(mid), R)), { x: -Math.sin(mid), y: Math.cos(mid) }, text, style, prims);
  return { prims, value: sweep, text };
}

function textPrims(at: Vec2, height: number, angle: number, anchor: 'left' | 'center' | 'right', text: string, baseline: 'bottom' | 'middle'): Prim[] {
  const down = { x: Math.sin(angle), y: -Math.cos(angle) };
  return text.split('\n').map((line, i) => ({
    k: 'text' as const,
    at: add(at, scale(down, i * LINE_SPACING * height)),
    height,
    angle,
    anchor,
    baseline,
    text: line,
  }));
}

function measureLeader(env: NoteEnv, body: NoteBody & { kind: 'leader' }): Measured {
  const style = requireStyle(env, body.style);
  const pts = body.points;
  const prims: Prim[] = [];
  for (let i = 0; i + 1 < pts.length; i++) prims.push({ k: 'seg', a: pts[i] as Vec2, b: pts[i + 1] as Vec2 });
  const tip = pts[0] as Vec2;
  const next = pts[1] as Vec2;
  prims.push({ k: 'arrow', tip, dir: normalize(sub(next, tip)), size: style.arrowSize });
  if (body.text !== '') {
    const end = pts[pts.length - 1] as Vec2;
    const prev = pts[pts.length - 2] as Vec2;
    const right = end.x >= prev.x;
    const at = { x: end.x + (right ? style.textGap : -style.textGap), y: end.y };
    prims.push(...textPrims(at, style.textHeight, 0, right ? 'left' : 'right', body.text, 'middle'));
  }
  return { prims, value: 0, text: body.text };
}

function measureCentre(env: NoteEnv, body: NoteBody & { kind: 'centre' }): Measured {
  const style = requireStyle(env, body.style);
  const { center: c, radius } = requireRound(env, body.target);
  const m = body.extended ? radius + style.centreOver : style.centreMark;
  const prims: Prim[] = [
    { k: 'seg', a: { x: c.x - m, y: c.y }, b: { x: c.x + m, y: c.y } },
    { k: 'seg', a: { x: c.x, y: c.y - m }, b: { x: c.x, y: c.y + m } },
  ];
  return { prims, value: 0, text: '' };
}

/** The loop a list of entity ids forms: one closed shape, or pieces that join into one. */
export function loopOf(env: NoteEnv, ids: readonly number[]): Loop {
  const shapes: Shape[] = ids.map((id) => {
    const e = env.entity(id);
    if (!e) return broken(`A hatch boundary (id ${id}) is gone.`);
    return e.geom;
  });
  if (shapes.length === 1) {
    const s = shapes[0] as Shape;
    if (isLoop(s)) return s;
  }
  try {
    const joined = joinShapes(shapes);
    if (joined.closed) return joined;
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  return broken('The hatch boundary is no longer a closed shape.');
}

/** The loops of a hatch as they stand now: the outer boundary first, then the islands. */
export function hatchLoops(env: NoteEnv, body: NoteBody & { kind: 'hatch' }): Loop[] {
  return body.loops.map((ids) => loopOf(env, ids));
}

function measureHatch(env: NoteEnv, body: NoteBody & { kind: 'hatch' }): Measured & { area: number } {
  const loops = hatchLoops(env, body);
  const outer = loops[0] as Loop;
  const area = regionArea(outer, loops.slice(1));
  const prims: Prim[] = [];
  if (body.pattern === 'solid') {
    prims.push({ k: 'fill', loops });
  } else {
    const lines = (angle: number, shift = 0, dots?: number): ReturnType<typeof hatchLines> => {
      try {
        return hatchLines(loops, { angle, spacing: body.spacing, shift, ...(dots !== undefined && { dotSpacing: dots }) });
      } catch (err) {
        throw err instanceof RangeError ? new Broken(err.message) : err;
      }
    };
    const push = (h: ReturnType<typeof hatchLines>) => {
      for (const s of h.segments) prims.push({ k: 'seg', a: s.start, b: s.end });
    };
    switch (body.pattern) {
      case 'lines':
        push(lines(body.angle));
        break;
      case 'cross':
        push(lines(body.angle));
        push(lines(body.angle + Math.PI / 2));
        break;
      case 'double':
        push(lines(body.angle));
        push(lines(body.angle, 0.25));
        break;
      case 'dots':
        for (const p of lines(body.angle, 0, body.spacing).dots) prims.push({ k: 'dot', p });
        break;
    }
  }
  return { prims, value: area, text: '', area };
}

/** Where the title block sits inside its sheet. */
export const SHEET_MARGIN = { left: 20, other: 10 } as const;
export const TITLE_BLOCK_MM = { w: 180, rows: [14, 9, 9, 8] } as const;

function measureTitleBlock(body: NoteBody & { kind: 'titleBlock' }): Measured {
  const { w, h } = SHEET_MM[body.size];
  const o = body.at;
  const prims: Prim[] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const c = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ] as const;
    for (let i = 0; i < 4; i++) prims.push({ k: 'seg', a: c[i] as Vec2, b: c[(i + 1) % 4] as Vec2 });
  };
  rect(o.x, o.y, o.x + w, o.y + h);
  const ix0 = o.x + SHEET_MARGIN.left;
  const iy0 = o.y + SHEET_MARGIN.other;
  const ix1 = o.x + w - SHEET_MARGIN.other;
  const iy1 = o.y + h - SHEET_MARGIN.other;
  rect(ix0, iy0, ix1, iy1);
  const bw = TITLE_BLOCK_MM.w;
  const total = TITLE_BLOCK_MM.rows.reduce((s, r) => s + r, 0);
  const bx = ix1 - bw;
  const by = iy0;
  rect(bx, by, ix1, by + total);
  // Rows from the top; cells are [x offset, width, field].
  const rows: readonly (readonly (readonly [number, number, TitleField])[])[] = [
    [[0, 180, 'title']],
    [
      [0, 100, 'number'],
      [100, 40, 'scale'],
      [140, 40, 'revision'],
    ],
    [
      [0, 100, 'material'],
      [100, 40, 'drawnBy'],
      [140, 40, 'date'],
    ],
    [[0, 180, 'company']],
  ];
  let top = by + total;
  rows.forEach((cells, r) => {
    const rh = TITLE_BLOCK_MM.rows[r] as number;
    const bottom = top - rh;
    if (r > 0) prims.push({ k: 'seg', a: { x: bx, y: top }, b: { x: ix1, y: top } });
    for (const [dx, cw, field] of cells) {
      if (dx > 0) prims.push({ k: 'seg', a: { x: bx + dx, y: bottom }, b: { x: bx + dx, y: top } });
      prims.push(...textPrims({ x: bx + dx + 0.8, y: top - 2.6 }, 1.8, 0, 'left', TITLE_FIELD_LABELS[field], 'bottom'));
      const value = body.fields[field];
      if (value !== '') {
        const big = field === 'title';
        prims.push({ k: 'text', at: { x: bx + dx + 1.2, y: bottom + 1.2 }, height: big ? 5 : 3.5, angle: 0, anchor: 'left', baseline: 'bottom', text: value });
      }
    }
    top = bottom;
  });
  return { prims, value: 0, text: '' };
}

// ---------- bounds of drawing instructions ----------

/** The corners of the box a text prim fills, using the character width estimate. */
export function textBox(p: Extract<Prim, { k: 'text' }>): Vec2[] {
  const w = p.text.length * TEXT_ADVANCE * p.height;
  const x0 = p.anchor === 'left' ? 0 : p.anchor === 'center' ? -w / 2 : -w;
  const y0 = p.baseline === 'bottom' ? 0 : -p.height / 2;
  const u = { x: Math.cos(p.angle), y: Math.sin(p.angle) };
  const n = { x: -u.y, y: u.x };
  const at = (x: number, y: number): Vec2 => ({ x: p.at.x + u.x * x + n.x * y, y: p.at.y + u.y * x + n.y * y });
  return [at(x0, y0), at(x0 + w, y0), at(x0 + w, y0 + p.height), at(x0, y0 + p.height)];
}

export function arrowCorners(p: Extract<Prim, { k: 'arrow' }>): [Vec2, Vec2, Vec2] {
  const base = add(p.tip, scale(p.dir, p.size));
  const side = scale(perp(p.dir), p.size / 6);
  return [p.tip, add(base, side), sub(base, side)];
}

export function primBounds(p: Prim): Bounds {
  switch (p.k) {
    case 'seg':
      return boundsOfPoints([p.a, p.b]);
    case 'arc':
      return curveBounds(makeArc(p.center, p.radius, normalizeAngle(p.start), p.sweep));
    case 'arrow':
      return boundsOfPoints(arrowCorners(p));
    case 'text':
      return boundsOfPoints(textBox(p));
    case 'dot':
      return boundsOfPoints([p.p]);
    case 'fill':
      return p.loops.map(loopBounds).reduce(unionBounds);
  }
}

export function primsBounds(prims: readonly Prim[]): Bounds | null {
  return prims.length === 0 ? null : prims.map(primBounds).reduce(unionBounds);
}

/** The shapes a click or a selection box tests against for a note. Dots and fills have none. */
export function pickShapes(prims: readonly Prim[]): Shape[] {
  const out: Shape[] = [];
  for (const p of prims) {
    if (p.k === 'seg') out.push(segment(p.a, p.b));
    else if (p.k === 'arc') out.push(makeArc(p.center, p.radius, normalizeAngle(p.start), p.sweep));
    else if (p.k === 'arrow') out.push(polyline(arrowCorners(p), true));
    else if (p.k === 'text') out.push(polyline(textBox(p), true));
  }
  return out;
}

// ---------- resolving ----------

/** Draws a note from the geometry as it stands now. Fails, with a reason, if its geometry is gone. */
export function resolveNote(env: NoteEnv, note: Note): ResolveResult {
  try {
    const b = note.body;
    let m: Measured & { area?: number };
    switch (b.kind) {
      case 'linear':
      case 'aligned':
        m = measureLinear(env, b);
        break;
      case 'radius':
      case 'diameter':
        m = measureRound(env, b);
        break;
      case 'angle':
        m = measureAngle(env, b);
        break;
      case 'text':
        m = { prims: textPrims(b.at, b.height, b.angle, b.anchor, b.text, 'bottom'), value: 0, text: b.text };
        break;
      case 'leader':
        m = measureLeader(env, b);
        break;
      case 'centre':
        m = measureCentre(env, b);
        break;
      case 'hatch':
        m = measureHatch(env, b);
        break;
      case 'titleBlock':
        m = measureTitleBlock(b);
        break;
    }
    const bounds = primsBounds(m.prims);
    if (!bounds) return { ok: false, why: 'It draws nothing.' };
    const r: Resolved = {
      prims: m.prims,
      bounds,
      ...(isDimension(b) && { value: m.value, text: m.text }),
      ...(m.area !== undefined && { area: m.area }),
    };
    return { ok: true, r };
  } catch (err) {
    if (err instanceof Broken) return { ok: false, why: err.message };
    throw err;
  }
}

const resolvedCache = new WeakMap<Doc, ReadonlyMap<number, ResolveResult>>();

/** Every note of a document, drawn from its geometry. Computed once per document object. */
export function resolveNotes(doc: Doc): ReadonlyMap<number, ResolveResult> {
  let map = resolvedCache.get(doc);
  if (!map) {
    const env = docEnv(doc);
    const m = new Map<number, ResolveResult>();
    for (const n of doc.notes.values()) m.set(n.id, resolveNote(env, n));
    map = m;
    resolvedCache.set(doc, map);
  }
  return map;
}

/** The ids of notes that can no longer be drawn from their geometry. */
export function brokenNotes(env: NoteEnv, notes: Iterable<Note>): Note[] {
  const out: Note[] = [];
  for (const n of notes) if (!resolveNote(env, n).ok) out.push(n);
  return out;
}

/** Ids of the entities a note refers to. */
export function noteEntityIds(n: Note): number[] {
  const b = n.body;
  const ref = (r: PointRef): number[] => (r.kind === 'free' ? [] : [r.id]);
  switch (b.kind) {
    case 'linear':
    case 'aligned':
      return [...ref(b.a), ...ref(b.b)];
    case 'angle':
      return [...ref(b.vertex), ...ref(b.a), ...ref(b.b)];
    case 'radius':
    case 'diameter':
    case 'centre':
      return [b.target];
    case 'hatch':
      return b.loops.flat();
    default:
      return [];
  }
}

/** True if the note refers to this entity. */
export function noteUsesEntity(n: Note, id: number): boolean {
  return noteEntityIds(n).includes(id);
}

/**
 * Why a note can no longer be drawn from its geometry, or null if it still can. A hatch only
 * has its boundaries checked, which is cheaper than drawing all its lines.
 */
export function noteProblem(env: NoteEnv, note: Note): string | null {
  if (note.body.kind === 'hatch') {
    try {
      hatchLoops(env, note.body);
      return null;
    } catch (err) {
      if (err instanceof Broken) return err.message;
      throw err;
    }
  }
  const r = resolveNote(env, note);
  return r.ok ? null : r.why;
}

/** Moves a note's own points (not the geometry it refers to) by a transform. Text stays upright and the same size. */
export function transformNote(t: Transform, n: Note): Note {
  const p = (v: Vec2): Vec2 => {
    const q = transformPoint(t, v);
    return { x: q.x + 0, y: q.y + 0 };
  };
  const ref = (r: PointRef): PointRef => (r.kind === 'free' ? { kind: 'free', p: p(r.p) } : r);
  const b = n.body;
  let body: NoteBody;
  switch (b.kind) {
    case 'linear':
      body = { ...b, a: ref(b.a), b: ref(b.b), at: p(b.at) };
      break;
    case 'aligned':
      body = { ...b, a: ref(b.a), b: ref(b.b), at: p(b.at) };
      break;
    case 'angle':
      body = { ...b, vertex: ref(b.vertex), a: ref(b.a), b: ref(b.b), at: p(b.at) };
      break;
    case 'radius':
    case 'diameter':
      body = { ...b, at: p(b.at) };
      break;
    case 'text':
    case 'titleBlock':
      body = { ...b, at: p(b.at) };
      break;
    case 'leader':
      body = { ...b, points: b.points.map(p) };
      break;
    case 'centre':
    case 'hatch':
      return n;
  }
  return { ...n, body };
}

/** Notes made only of their own points, so a copy of one still makes sense on its own. */
export function isFreeNote(n: Note): boolean {
  return n.body.kind === 'text' || n.body.kind === 'leader' || n.body.kind === 'titleBlock';
}
