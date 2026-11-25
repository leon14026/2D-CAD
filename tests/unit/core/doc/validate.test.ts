import { describe, expect, it } from 'vitest';
import {
  canonicalShape,
  describeValue,
  readArray,
  readBoolean,
  readColorRef,
  readLinetypeRef,
  readLineweightRef,
  readName,
  readNumber,
  readObject,
  readOneOf,
  readPoint,
  readPositiveInteger,
  readShape,
  readString,
  readTransform,
  ValidationError,
} from '../../../../src/core/doc';

/** Expects a ValidationError at `path` whose reason contains `text`. */
function rejects(fn: () => unknown, path: string, text: string | RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    const e = err as ValidationError;
    expect(e.path).toBe(path);
    expect(e.reason).toMatch(text);
    return;
  }
  throw new Error('expected a ValidationError');
}

describe('describeValue', () => {
  it.each([
    [null, 'null'],
    [[1], 'a list'],
    ['abc', 'text "abc"'],
    [{}, 'an object'],
    [3, 'number 3'],
    [true, 'boolean true'],
    [undefined, 'undefined undefined'],
  ])('%o → %s', (v, text) => {
    expect(describeValue(v)).toBe(text);
  });

  it('shortens long text', () => {
    expect(describeValue('x'.repeat(100))).toBe(`text "${'x'.repeat(40)}…"`);
  });
});

describe('primitive readers', () => {
  it('readObject', () => {
    expect(readObject({ a: 1 }, 'p', ['a'])).toEqual({ a: 1 });
    expect(readObject({ a: 1, b: 2 }, 'p', ['a'], ['b'])).toEqual({ a: 1, b: 2 });
    rejects(() => readObject(null, 'p', []), 'p', /must be an object, not null/);
    rejects(() => readObject([], 'p', []), 'p', /not a list/);
    rejects(() => readObject('x', '', []), '', /not text/);
    rejects(() => readObject({ a: 1, c: 3 }, 'p', ['a']), 'p.c', /not a recognised field/);
    rejects(() => readObject({}, 'p', ['a']), 'p.a', /is missing/);
    rejects(() => readObject(JSON.parse('{"__proto__": {"x": 1}}'), 'p', []), 'p.__proto__', /not a recognised field/);
  });

  it('readArray', () => {
    expect(readArray([1, 2], 'p')).toEqual([1, 2]);
    rejects(() => readArray({}, 'p'), 'p', /must be a list/);
  });

  it('readNumber turns -0 into 0 and refuses non-finite values', () => {
    expect(Object.is(readNumber(-0, 'p'), 0)).toBe(true);
    expect(readNumber(2.5, 'p')).toBe(2.5);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      rejects(() => readNumber(bad, 'n'), 'n', /finite number/);
    }
  });

  it('readPositiveInteger', () => {
    expect(readPositiveInteger(7, 'p')).toBe(7);
    for (const bad of [0, -1, 1.5, 2 ** 60]) rejects(() => readPositiveInteger(bad, 'i'), 'i', /whole number/);
  });

  it('readString, readBoolean, readOneOf', () => {
    expect(readString('a', 'p')).toBe('a');
    rejects(() => readString(1, 's'), 's', /must be text/);
    expect(readBoolean(false, 'p')).toBe(false);
    rejects(() => readBoolean('true', 'b'), 'b', /true or false/);
    expect(readOneOf('mm', 'u', ['mm', 'in'])).toBe('mm');
    rejects(() => readOneOf('yd', 'u', ['mm', 'in']), 'u', /one of "mm", "in"/);
    rejects(() => readOneOf(3, 'u', ['mm']), 'u', /number 3/);
  });

  it('readPoint', () => {
    expect(readPoint({ x: 1, y: -0 }, 'p')).toEqual({ x: 1, y: 0 });
    rejects(() => readPoint({ x: 1 }, 'p'), 'p.y', /missing/);
    rejects(() => readPoint({ x: 1, y: 'a' }, 'p'), 'p.y', /finite number/);
  });
});

describe('style readers', () => {
  it('colour', () => {
    expect(readColorRef('byLayer', 'c')).toBe('byLayer');
    expect(readColorRef('#00ff7a', 'c')).toBe('#00ff7a');
    rejects(() => readColorRef('#00FF7A', 'c'), 'c', /lowercase/);
    rejects(() => readColorRef('red', 'c'), 'c', /#rrggbb/);
  });

  it('linetype', () => {
    expect(readLinetypeRef('dash-dot', 't')).toBe('dash-dot');
    expect(readLinetypeRef('byLayer', 't')).toBe('byLayer');
    rejects(() => readLinetypeRef('CENTER', 't'), 't', /one of "continuous"/);
  });

  it('lineweight', () => {
    expect(readLineweightRef(0.35, 'w')).toBe(0.35);
    expect(readLineweightRef('byLayer', 'w')).toBe('byLayer');
    rejects(() => readLineweightRef(0.3, 'w'), 'w', /0\.13, 0\.18, 0\.25/);
  });

  it('names are trimmed, non-empty and bounded', () => {
    expect(readName('  Holes ', 'n', 10)).toBe('Holes');
    rejects(() => readName('   ', 'n', 10), 'n', /must not be empty/);
    rejects(() => readName('x'.repeat(11), 'n', 10), 'n', /at most 10 characters/);
  });
});

describe('readShape', () => {
  it.each([
    [{ kind: 'segment', start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }],
    [{ kind: 'circle', center: { x: 1, y: 2 }, radius: 3 }],
    [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 2, start: 1, sweep: -2 }],
    [{ kind: 'polyline', vertices: [{ x: 0, y: 0, bulge: 0.5 }, { x: 1, y: 0, bulge: 0 }], closed: false }],
  ])('accepts %o unchanged', (shape) => {
    expect(readShape(shape, 'g')).toEqual(shape);
  });

  it('defaults a missing bulge to 0 and normalises an arc start angle', () => {
    expect(readShape({ kind: 'polyline', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true }, 'g')).toEqual({
      kind: 'polyline',
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 1, y: 1, bulge: 0 },
      ],
      closed: true,
    });
    const a = readShape({ kind: 'arc', center: { x: 0, y: 0 }, radius: 1, start: -Math.PI / 2, sweep: 1 }, 'g');
    expect(a.kind === 'arc' && a.start).toBeCloseTo((3 * Math.PI) / 2, 15);
  });

  it.each([
    [{ kind: 'spline' }, 'g.kind', /one of "segment"/],
    [{ kind: 'circle', center: { x: 0, y: 0 } }, 'g.radius', /missing/],
    [{ kind: 'circle', center: { x: 0, y: 0 }, radius: -1 }, 'g.radius', /positive/],
    [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 1, sweep: 1 }, 'g.sweep', /not a recognised field/],
    [{ kind: 'segment', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }, 'g', /same point/],
    [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 1, start: 0, sweep: 0 }, 'g', /sweep/],
    [{ kind: 'polyline', vertices: [{ x: 0, y: 0 }], closed: false }, 'g.vertices', /at least two/],
    [{ kind: 'polyline', vertices: [{ x: 0, y: 0 }, { x: 1 }], closed: false }, 'g.vertices[1].y', /missing/],
    [{ kind: 'polyline', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: 'yes' }, 'g.closed', /true or false/],
    [{ kind: 'polyline', vertices: [{ x: 0, y: 0, bulge: 'a' }, { x: 1, y: 0 }], closed: true }, 'g.vertices[0].bulge', /finite/],
  ])('rejects %o at %s', (shape, path, text) => {
    rejects(() => readShape(shape, 'g'), path, text);
  });

  it('canonicalShape removes -0 everywhere', () => {
    const s = canonicalShape({
      kind: 'polyline',
      vertices: [
        { x: -0, y: -0, bulge: -0 },
        { x: 1, y: 0, bulge: 0 },
      ],
      closed: false,
    });
    expect(s.kind === 'polyline' && Object.is(s.vertices[0]?.x, 0) && Object.is(s.vertices[0]?.bulge, 0)).toBe(true);
    const a = canonicalShape({ kind: 'arc', center: { x: -0, y: 1 }, radius: 1, start: -0, sweep: 1 });
    expect(a.kind === 'arc' && Object.is(a.center.x, 0) && Object.is(a.start, 0)).toBe(true);
    const c = canonicalShape({ kind: 'circle', center: { x: -0, y: -0 }, radius: 1 });
    expect(c.kind === 'circle' && Object.is(c.center.y, 0)).toBe(true);
    const g = canonicalShape({ kind: 'segment', start: { x: -0, y: 0 }, end: { x: 1, y: -0 } });
    expect(g.kind === 'segment' && Object.is(g.end.y, 0)).toBe(true);
  });
});

describe('readTransform', () => {
  it.each([
    [{ kind: 'translate', dx: 1, dy: -2 }],
    [{ kind: 'rotate', center: { x: 1, y: 1 }, angle: 0.5 }],
    [{ kind: 'scale', center: { x: 0, y: 0 }, factor: 2 }],
    [{ kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
  ])('accepts %o', (t) => {
    expect(readTransform(t, 't')).toEqual(t);
  });

  it.each([
    [{ kind: 'shear' }, 't.kind', /one of "translate"/],
    [{ kind: 'translate', dx: 1 }, 't.dy', /missing/],
    [{ kind: 'scale', center: { x: 0, y: 0 }, factor: 0 }, 't.factor', /positive/],
    [{ kind: 'mirror', a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }, 't', /distinct/],
    [{ kind: 'rotate', center: { x: 0, y: 0 }, angle: 'a' }, 't.angle', /finite/],
  ])('rejects %o at %s', (t, path, text) => {
    rejects(() => readTransform(t, 't'), path, text);
  });
});
