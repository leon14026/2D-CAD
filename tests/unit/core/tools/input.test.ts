import { describe, expect, it } from 'vitest';
import { degToRad } from '../../../../src/core/geom';
import { InputError, interpretTyped, parseTyped, type TypedContext } from '../../../../src/core/tools';
import { expectPoint } from '../helpers';

describe('parseTyped', () => {
  it('reads absolute and relative points', () => {
    expect(parseTyped('10,20')).toEqual({ kind: 'point', relative: false, x: 10, y: 20 });
    expect(parseTyped(' @ -5.5 , +3 ')).toEqual({ kind: 'point', relative: true, x: -5.5, y: 3 });
    expect(parseTyped('.5,1e3')).toEqual({ kind: 'point', relative: false, x: 0.5, y: 1000 });
  });

  it('reads polar input, absolute and relative, angles in degrees', () => {
    expect(parseTyped('@25<45')).toEqual({ kind: 'polar', relative: true, distance: 25, degrees: 45 });
    expect(parseTyped('10 < -60')).toEqual({ kind: 'polar', relative: false, distance: 10, degrees: -60 });
  });

  it('reads a bare number, never producing -0', () => {
    expect(parseTyped('12.5')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseTyped('3.')).toEqual({ kind: 'number', value: 3 });
    const zero = parseTyped('-0');
    expect(zero.kind === 'number' && Object.is(zero.value, 0)).toBe(true);
  });

  it('explains what it expected when the text is not a point or a number', () => {
    for (const bad of ['', '   ', 'abc', '10,', ',5', '@', '10,20,30', '5<', '1..2', '0x10']) {
      expect(() => parseTyped(bad), bad).toThrow(InputError);
    }
    expect(() => parseTyped('ten')).toThrow(/isn't a point or a number\. Try 10,20, or @10,0, or @25<45\./);
    expect(() => parseTyped('')).toThrow('Type a point or a number.');
  });

  it('refuses numbers too large to use', () => {
    expect(() => parseTyped('1e999')).toThrow(/too large/);
    expect(() => parseTyped('1,1e400')).toThrow(/too large/);
  });
});

describe('interpretTyped', () => {
  const at = (accepts: TypedContext['accepts'], base: { x: number; y: number } | null = null, direction: number | null = null): TypedContext => ({
    accepts,
    base,
    direction,
  });

  it('points: absolute, relative to the last point, and polar', () => {
    expect(interpretTyped('10,20', at('point'))).toEqual({ kind: 'point', point: { x: 10, y: 20 } });
    expect(interpretTyped('@10,-5', at('point', { x: 1, y: 2 }))).toEqual({ kind: 'point', point: { x: 11, y: -3 } });
    expect(interpretTyped('@10<90', at('point', { x: 1, y: 2 }))).toEqual({ kind: 'point', point: { x: 1, y: 12 } });
    expect(interpretTyped('10<180', at('pointOrNumber', { x: 1, y: 2 }))).toEqual({ kind: 'point', point: { x: -10, y: 0 } });
  });

  it('a bare number is a value where one is wanted', () => {
    expect(interpretTyped('4', at('number'))).toEqual({ kind: 'number', value: 4 });
    expect(interpretTyped('4', at('pointOrNumber', { x: 0, y: 0 }, 0))).toEqual({ kind: 'number', value: 4 });
  });

  it('where a point is wanted, a bare number is a distance along the cursor direction', () => {
    const r = interpretTyped('20', at('point', { x: 10, y: 40 }, degToRad(60)));
    expect(r.kind).toBe('point');
    expectPoint((r as { point: { x: number; y: number } }).point, { x: 20, y: 40 + 10 * Math.sqrt(3) });
    expect(interpretTyped('5', at('point', { x: 1, y: 1 }, Math.PI / 2))).toEqual({ kind: 'point', point: { x: 1, y: 6 } });
  });

  it('refuses what cannot be used at this step, saying why', () => {
    expect(() => interpretTyped('5', at('point'))).toThrow(/needs a direction/);
    expect(() => interpretTyped('5', at('point', { x: 0, y: 0 }, null))).toThrow(/needs a direction/);
    expect(() => interpretTyped('1,2', at('number'))).toThrow('Type a number here, not a point.');
    expect(() => interpretTyped('@1,2', at('point'))).toThrow(/no last point yet/);
    expect(() => interpretTyped('@1<2', at('pointOrNumber'))).toThrow(/no last point yet/);
    expect(() => interpretTyped('1,2', at('select'))).toThrow(/Select the objects first/);
    expect(() => interpretTyped('1,2', at('pick'))).toThrow(/Click an object/);
  });
});
