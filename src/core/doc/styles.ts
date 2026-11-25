/**
 * Line styles: colours, linetypes and lineweights. Entities can use their layer's value
 * ("byLayer") or set their own.
 *
 * ArchiLite defines its own linetypes from the element proportions of ISO 128-20 (lengths are
 * multiples of the line's width d). It does not use any other program's linetype files.
 */
import { readNumber, readOneOf, readString, ValidationError } from './validate';

export const BY_LAYER = 'byLayer';
export type ByLayer = typeof BY_LAYER;

/** A colour as lowercase "#rrggbb". */
export type Rgb = string;
export type ColorRef = ByLayer | Rgb;

export const LINETYPE_IDS = ['continuous', 'dashed', 'dash-dot', 'dash-double-dot', 'dotted'] as const;
export type LinetypeId = (typeof LINETYPE_IDS)[number];
export type LinetypeRef = ByLayer | LinetypeId;

export interface LinetypeDef {
  readonly id: LinetypeId;
  readonly label: string;
  /** ISO 128-20 line type number. */
  readonly iso: string;
  /**
   * Repeating pattern in multiples of the line width d: dash, gap, dash, gap, …
   * Empty means a continuous line. A dash of 0.5 is a dot.
   */
  readonly pattern: readonly number[];
}

export const LINETYPES: Readonly<Record<LinetypeId, LinetypeDef>> = Object.freeze({
  continuous: { id: 'continuous', label: 'Continuous', iso: '01', pattern: [] },
  dashed: { id: 'dashed', label: 'Dashed (hidden detail)', iso: '02', pattern: [12, 3] },
  'dash-dot': { id: 'dash-dot', label: 'Long dash, dot (centre lines)', iso: '04', pattern: [24, 3, 0.5, 3] },
  'dash-double-dot': {
    id: 'dash-double-dot',
    label: 'Long dash, double dot',
    iso: '05',
    pattern: [24, 3, 0.5, 3, 0.5, 3],
  },
  dotted: { id: 'dotted', label: 'Dotted', iso: '07', pattern: [0.5, 3] },
});

/** Standard line widths in millimetres on paper (ISO 128 series). */
export const LINEWEIGHTS_MM = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2] as const;
export type Lineweight = (typeof LINEWEIGHTS_MM)[number];
export type LineweightRef = ByLayer | Lineweight;

export const DEFAULT_LAYER_STYLE = Object.freeze({
  color: '#1f2a33',
  linetype: 'continuous' as LinetypeId,
  lineweight: 0.25 as Lineweight,
});

export function readRgb(v: unknown, path: string): Rgb {
  const s = readString(v, path);
  if (!/^#[0-9a-f]{6}$/.test(s)) throw new ValidationError(path, `must be a colour written as "#rrggbb" in lowercase, not "${s}"`);
  return s;
}

export function readColorRef(v: unknown, path: string): ColorRef {
  return v === BY_LAYER ? BY_LAYER : readRgb(v, path);
}

export function readLinetype(v: unknown, path: string): LinetypeId {
  return readOneOf(v, path, LINETYPE_IDS);
}

export function readLinetypeRef(v: unknown, path: string): LinetypeRef {
  return v === BY_LAYER ? BY_LAYER : readLinetype(v, path);
}

export function readLineweight(v: unknown, path: string): Lineweight {
  const n = readNumber(v, path);
  if (!(LINEWEIGHTS_MM as readonly number[]).includes(n)) {
    throw new ValidationError(path, `must be one of ${LINEWEIGHTS_MM.join(', ')} (mm), not ${n}`);
  }
  return n as Lineweight;
}

export function readLineweightRef(v: unknown, path: string): LineweightRef {
  return v === BY_LAYER ? BY_LAYER : readLineweight(v, path);
}

/** Layer and title text: trimmed, non-empty, at most `max` characters. */
export function readName(v: unknown, path: string, max: number): string {
  const s = readString(v, path).trim();
  if (s.length === 0) throw new ValidationError(path, 'must not be empty');
  if (s.length > max) throw new ValidationError(path, `must be at most ${max} characters`);
  return s;
}

