/**
 * Typed coordinate entry, read from the box beside the cursor.
 *
 * | Typed        | Means                                                        |
 * |--------------|--------------------------------------------------------------|
 * | `x,y`        | the absolute point (x, y)                                    |
 * | `@dx,dy`     | dx, dy from the last point                                   |
 * | `@d<a`       | d along the direction a degrees (counter-clockwise from +x)  |
 * | `d<a`        | the same, measured from the origin                           |
 * | `d`          | a number: a radius, a count, or d along the cursor direction |
 */
import { degToRad, polarPoint, type Vec2 } from '../geom';

export type Typed =
  | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly relative: boolean }
  | { readonly kind: 'polar'; readonly distance: number; readonly degrees: number; readonly relative: boolean }
  | { readonly kind: 'number'; readonly value: number };

/** Typed text that isn't a point or a number, or can't be used where it was typed. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const POINT = new RegExp(String.raw`^(@)?\s*(${NUMBER})\s*,\s*(${NUMBER})$`);
const POLAR = new RegExp(String.raw`^(@)?\s*(${NUMBER})\s*<\s*(${NUMBER})$`);
const BARE = new RegExp(String.raw`^${NUMBER}$`);

export const INPUT_EXAMPLES = '10,20   @10,0   @25<45';

function finite(text: string): number {
  const n = Number(text);
  if (!Number.isFinite(n)) throw new InputError(`${text} is too large to use.`);
  return n + 0;
}

/** Reads typed text. Throws InputError, in plain words, if it isn't a point or a number. */
export function parseTyped(text: string): Typed {
  const t = text.trim();
  if (t === '') throw new InputError('Type a point or a number.');
  const point = POINT.exec(t);
  if (point) return { kind: 'point', relative: point[1] === '@', x: finite(point[2] as string), y: finite(point[3] as string) };
  const polar = POLAR.exec(t);
  if (polar) {
    return { kind: 'polar', relative: polar[1] === '@', distance: finite(polar[2] as string), degrees: finite(polar[3] as string) };
  }
  if (BARE.test(t)) return { kind: 'number', value: finite(t) };
  throw new InputError(`"${t}" isn't a point or a number. Try ${INPUT_EXAMPLES.split('   ').join(', or ')}.`);
}

/** What the current step of a tool takes. */
export type Accepts = 'point' | 'number' | 'pointOrNumber' | 'select' | 'pick' | 'text';

export interface TypedContext {
  readonly accepts: Accepts;
  /** The last point, which relative input starts from. */
  readonly base: Vec2 | null;
  /** Direction from the base towards the cursor (radians), for a bare distance. */
  readonly direction: number | null;
}

export type TypedValue =
  | { readonly kind: 'point'; readonly point: Vec2 }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'text'; readonly text: string };

/** Turns typed text into a point or a number for the step that is waiting for it. */
export function interpretTyped(text: string, ctx: TypedContext): TypedValue {
  // Text for a note: taken as typed. A typed \n means a new line.
  if (ctx.accepts === 'text') return { kind: 'text', text: text.trim().replaceAll('\\n', '\n') };
  const typed = parseTyped(text);
  const { accepts, base } = ctx;
  if (accepts === 'select' || accepts === 'pick') {
    throw new InputError(accepts === 'select' ? 'Select the objects first, then press Enter.' : 'Click an object to pick it.');
  }
  if (typed.kind === 'number') {
    if (accepts !== 'point') return { kind: 'number', value: typed.value };
    if (base && ctx.direction !== null) return { kind: 'point', point: polarPoint(base, typed.value, ctx.direction) };
    throw new InputError(`A single number needs a direction. Type a point such as ${INPUT_EXAMPLES.split('   ')[0]}.`);
  }
  if (accepts === 'number') throw new InputError('Type a number here, not a point.');
  if (typed.relative && !base) {
    throw new InputError('There is no last point yet, so type an absolute point such as 10,20.');
  }
  const from = typed.relative ? (base as Vec2) : { x: 0, y: 0 };
  if (typed.kind === 'point') return { kind: 'point', point: { x: from.x + typed.x, y: from.y + typed.y } };
  return { kind: 'point', point: polarPoint(from, typed.distance, degToRad(typed.degrees)) };
}
