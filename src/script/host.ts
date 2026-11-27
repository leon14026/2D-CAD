/**
 * The drawing API scripts see. Every mutation goes through the command registry, so a script
 * is one undo step and uses the same validation as the UI.
 */
import {
  CommandError,
  runCommandOnDraft,
  type Draft,
} from '../core/doc';
import { arc, circle, cosSin, degToRad, polyline, rectangle, segment, vec, type Shape } from '../core/geom';

export interface CadApi {
  /** Runs any registered command. Returns the command's result (for `entity.add`, `{ id }`). */
  run(id: string, params: unknown): unknown;
  line(x1: number, y1: number, x2: number, y2: number): number;
  circle(x: number, y: number, r: number): number;
  /** Angles in degrees, counter-clockwise from +x. Sweep may be negative. */
  arc(x: number, y: number, r: number, startDeg: number, sweepDeg: number): number;
  rect(x1: number, y1: number, x2: number, y2: number): number;
  /**
   * Each point is `[x, y]`, `[x, y, bulge]`, or `{ x, y, bulge? }`. Bulge is the DXF
   * convention (tan of a quarter of the sweep); 1 is a semicircle.
   */
  polyline(points: unknown, closed?: unknown): number;
  /** Adds the layer if needed and makes it current. Returns its id. */
  layer(name: string): number;
  title(text: string): void;
  /** A point `radius` from `(x, y)` at `angleDeg`. Quarter turns are exact. */
  polar(x: number, y: number, radius: number, angleDeg: number): { x: number; y: number };
  print(...args: unknown[]): void;
}

export function createCad(draft: Draft, log: string[]): CadApi {
  const add = (geom: Shape): number => {
    const result = runCommandOnDraft(draft, 'entity.add', { geom }) as { id: number };
    return result.id;
  };
  const geom = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof RangeError) throw new CommandError(err.message);
      throw err;
    }
  };

  return {
    run(id, params) {
      return runCommandOnDraft(draft, id, params);
    },
    line(x1, y1, x2, y2) {
      return geom(() => add(segment(vec(num(x1, 'x1'), num(y1, 'y1')), vec(num(x2, 'x2'), num(y2, 'y2')))));
    },
    circle(x, y, r) {
      return geom(() => add(circle(vec(num(x, 'x'), num(y, 'y')), num(r, 'r'))));
    },
    arc(x, y, r, startDeg, sweepDeg) {
      return geom(() =>
        add(
          arc(
            vec(num(x, 'x'), num(y, 'y')),
            num(r, 'r'),
            degToRad(num(startDeg, 'start')),
            degToRad(num(sweepDeg, 'sweep')),
          ),
        ),
      );
    },
    rect(x1, y1, x2, y2) {
      return geom(() =>
        add(rectangle(vec(num(x1, 'x1'), num(y1, 'y1')), vec(num(x2, 'x2'), num(y2, 'y2')))),
      );
    },
    polyline(points, closed) {
      return geom(() => add(polyline(readPoints(points), asBoolean(closed, false))));
    },
    layer(name) {
      const key = String(name).trim().toLowerCase();
      if (!key) throw new CommandError('layer() needs a name');
      const existing = draft.layers.find((l) => l.name.toLowerCase() === key);
      if (existing) {
        runCommandOnDraft(draft, 'layer.setCurrent', { id: existing.id });
        return existing.id;
      }
      const { id } = runCommandOnDraft(draft, 'layer.add', { name: String(name) }) as { id: number };
      runCommandOnDraft(draft, 'layer.setCurrent', { id });
      return id;
    },
    title(text) {
      runCommandOnDraft(draft, 'doc.setTitle', { title: String(text) });
    },
    polar(x, y, radius, angleDeg) {
      const cx = num(x, 'x');
      const cy = num(y, 'y');
      const r = num(radius, 'radius');
      const cs = cosSin(degToRad(num(angleDeg, 'angle')));
      return { x: cx + r * cs.x, y: cy + r * cs.y };
    },
    print(...args) {
      log.push(args.map(formatPrint).join(' '));
    },
  };
}

function num(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new CommandError(`${name} must be a finite number`);
  return n;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function formatPrint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(toPlain(value));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Turns a Pyodide proxy (or any array-like) into a real array. */
export function asList(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value != null && typeof value === 'object') {
    const o = value as { toJs?: (opts?: object) => unknown; length?: number };
    if (typeof o.toJs === 'function') return asList(o.toJs({ create_pyproxies: false }), path);
    if (typeof o.length === 'number' && Number.isInteger(o.length) && o.length >= 0) {
      return Array.from(o as ArrayLike<unknown>);
    }
  }
  throw new CommandError(`${path} must be a list of points`);
}

function toPlain(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(toPlain);
  const o = value as { toJs?: (opts?: object) => unknown };
  if (typeof o.toJs === 'function') return toPlain(o.toJs({ create_pyproxies: false }));
  return value;
}

function readPoints(raw: unknown): { x: number; y: number; bulge?: number }[] {
  return asList(raw, 'points').map((item, i) => readPoint(item, i));
}

function readPoint(raw: unknown, i: number): { x: number; y: number; bulge?: number } {
  const path = `points[${i}]`;
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && !hasLength(raw)) {
    const o = toPlain(raw) as { x?: unknown; y?: unknown; bulge?: unknown };
    if (o && typeof o === 'object' && 'x' in o && 'y' in o) {
      const bulge = o.bulge === undefined ? undefined : num(o.bulge, `${path}.bulge`);
      return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`), ...(bulge !== undefined && { bulge }) };
    }
  }
  const a = asList(raw, path);
  if (a.length < 2 || a.length > 3) throw new CommandError(`${path} must be [x, y] or [x, y, bulge]`);
  const bulge = a.length === 3 ? num(a[2], `${path} bulge`) : undefined;
  return { x: num(a[0], `${path} x`), y: num(a[1], `${path} y`), ...(bulge !== undefined && { bulge }) };
}

function hasLength(value: object): boolean {
  return typeof (value as { length?: unknown }).length === 'number';
}
