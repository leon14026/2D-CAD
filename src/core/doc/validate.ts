/**
 * Strict readers for untrusted data (files, script parameters). Every problem is reported
 * with the path to the offending value, e.g. "entities[3].geom.radius".
 */
import {
  arc,
  circle,
  mirror,
  polyline,
  rotate,
  scaleAbout,
  segment,
  translate,
  type Shape,
  type Transform,
  type Vec2,
} from '../geom';

export class ValidationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(path ? `${path}: ${reason}` : reason);
    this.name = 'ValidationError';
  }
}

export type Obj = Readonly<Record<string, unknown>>;

export function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

export function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return `text "${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  if (typeof v === 'object') return 'an object';
  return `${typeof v} ${String(v)}`;
}

/** A plain object whose keys are all in `required` or `optional`, with every required key present. */
export function readObject(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ValidationError(path, `must be an object, not ${describeValue(v)}`);
  }
  const o = v as Obj;
  for (const key of Object.keys(o)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new ValidationError(join(path, key), 'is not a recognised field');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(o, key)) throw new ValidationError(join(path, key), 'is missing');
  }
  return o;
}

export function readArray(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) throw new ValidationError(path, `must be a list, not ${describeValue(v)}`);
  return v;
}

/** A finite number, with -0 turned into 0. */
export function readNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(path, `must be a finite number, not ${describeValue(v)}`);
  }
  return v + 0;
}

export function readPositiveInteger(v: unknown, path: string): number {
  const n = readNumber(v, path);
  if (!Number.isSafeInteger(n) || n < 1) throw new ValidationError(path, `must be a whole number of 1 or more, not ${n}`);
  return n;
}

export function readString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ValidationError(path, `must be text, not ${describeValue(v)}`);
  return v;
}

export function readBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new ValidationError(path, `must be true or false, not ${describeValue(v)}`);
  return v;
}

export function readOneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(path, `must be one of ${allowed.map((a) => `"${a}"`).join(', ')}, not ${describeValue(v)}`);
  }
  return v as T;
}

export function readPoint(v: unknown, path: string): Vec2 {
  const o = readObject(v, path, ['x', 'y']);
  return { x: readNumber(o['x'], join(path, 'x')), y: readNumber(o['y'], join(path, 'y')) };
}

/** Runs a kernel constructor, turning its error (always a RangeError) into a ValidationError at `path`. */
function build<T>(path: string, make: () => T): T {
  try {
    return make();
  } catch (err) {
    throw new ValidationError(path, (err as Error).message);
  }
}

/** Replaces -0 with 0 everywhere in a shape so stored documents never contain -0. */
export function canonicalShape(s: Shape): Shape {
  const p = (v: Vec2): Vec2 => ({ x: v.x + 0, y: v.y + 0 });
  switch (s.kind) {
    case 'segment':
      return { kind: 'segment', start: p(s.start), end: p(s.end) };
    case 'circle':
      return { kind: 'circle', center: p(s.center), radius: s.radius };
    case 'arc':
      return { kind: 'arc', center: p(s.center), radius: s.radius, start: s.start + 0, sweep: s.sweep };
    case 'polyline':
      return {
        kind: 'polyline',
        vertices: s.vertices.map((v) => ({ x: v.x + 0, y: v.y + 0, bulge: v.bulge + 0 })),
        closed: s.closed,
      };
  }
}

export function readShape(v: unknown, path: string): Shape {
  const head = readObject(v, path, ['kind'], ['start', 'end', 'center', 'radius', 'sweep', 'vertices', 'closed']);
  const kind = readOneOf(head['kind'], join(path, 'kind'), ['segment', 'circle', 'arc', 'polyline'] as const);
  switch (kind) {
    case 'segment': {
      const o = readObject(v, path, ['kind', 'start', 'end']);
      const start = readPoint(o['start'], join(path, 'start'));
      const end = readPoint(o['end'], join(path, 'end'));
      return canonicalShape(build(path, () => segment(start, end)));
    }
    case 'circle': {
      const o = readObject(v, path, ['kind', 'center', 'radius']);
      const center = readPoint(o['center'], join(path, 'center'));
      const r = readNumber(o['radius'], join(path, 'radius'));
      return canonicalShape(build(join(path, 'radius'), () => circle(center, r)));
    }
    case 'arc': {
      const o = readObject(v, path, ['kind', 'center', 'radius', 'start', 'sweep']);
      const center = readPoint(o['center'], join(path, 'center'));
      const r = readNumber(o['radius'], join(path, 'radius'));
      const start = readNumber(o['start'], join(path, 'start'));
      const sweep = readNumber(o['sweep'], join(path, 'sweep'));
      return canonicalShape(build(path, () => arc(center, r, start, sweep)));
    }
    case 'polyline': {
      const o = readObject(v, path, ['kind', 'vertices', 'closed']);
      const list = readArray(o['vertices'], join(path, 'vertices'));
      const vertices = list.map((item, i) => {
        const vp = join(join(path, 'vertices'), i);
        const vo = readObject(item, vp, ['x', 'y'], ['bulge']);
        return {
          x: readNumber(vo['x'], join(vp, 'x')),
          y: readNumber(vo['y'], join(vp, 'y')),
          bulge: Object.hasOwn(vo, 'bulge') ? readNumber(vo['bulge'], join(vp, 'bulge')) : 0,
        };
      });
      const closed = readBoolean(o['closed'], join(path, 'closed'));
      return canonicalShape(build(join(path, 'vertices'), () => polyline(vertices, closed)));
    }
  }
}

export function readTransform(v: unknown, path: string): Transform {
  const head = readObject(v, path, ['kind'], ['dx', 'dy', 'center', 'angle', 'factor', 'a', 'b']);
  const kind = readOneOf(head['kind'], join(path, 'kind'), ['translate', 'rotate', 'scale', 'mirror'] as const);
  switch (kind) {
    case 'translate': {
      const o = readObject(v, path, ['kind', 'dx', 'dy']);
      const dx = readNumber(o['dx'], join(path, 'dx'));
      const dy = readNumber(o['dy'], join(path, 'dy'));
      return translate(dx, dy);
    }
    case 'rotate': {
      const o = readObject(v, path, ['kind', 'center', 'angle']);
      const center = readPoint(o['center'], join(path, 'center'));
      const angle = readNumber(o['angle'], join(path, 'angle'));
      return rotate(center, angle);
    }
    case 'scale': {
      const o = readObject(v, path, ['kind', 'center', 'factor']);
      const center = readPoint(o['center'], join(path, 'center'));
      const factor = readNumber(o['factor'], join(path, 'factor'));
      return build(join(path, 'factor'), () => scaleAbout(center, factor));
    }
    case 'mirror': {
      const o = readObject(v, path, ['kind', 'a', 'b']);
      const a = readPoint(o['a'], join(path, 'a'));
      const b = readPoint(o['b'], join(path, 'b'));
      return build(path, () => mirror(a, b));
    }
  }
}
