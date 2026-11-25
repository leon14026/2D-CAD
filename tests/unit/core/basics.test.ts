import { describe, expect, it } from 'vitest';
import {
  add,
  angleOf,
  boundsOfPoints,
  ccwSweep,
  convertLength,
  cosSin,
  cross,
  degToRad,
  distance,
  dot,
  HALF_PI,
  isFiniteVec,
  isLengthUnit,
  length,
  lengthSq,
  lerp,
  magnitude,
  midpoint,
  nearlyEqual,
  normalize,
  normalizeAngle,
  perp,
  pointsEqual,
  quarterTurns,
  radToDeg,
  scale,
  sub,
  sweepContains,
  TAU,
  tolFor,
  unionBounds,
  vec,
  type LengthUnit,
} from '../../../src/core/geom';
import { expectClose, expectPoint } from './helpers';

describe('vectors', () => {
  it('adds, subtracts and scales', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec(1, 2), vec(3, 5))).toEqual({ x: -2, y: -3 });
    expect(scale(vec(1.5, -2), 4)).toEqual({ x: 6, y: -8 });
  });

  it.each([
    [vec(1, 0), vec(0, 1), 0, 1],
    [vec(0, 1), vec(1, 0), 0, -1],
    [vec(2, 3), vec(4, 5), 23, -2],
    [vec(3, 4), vec(3, 4), 25, 0],
  ])('dot and cross of %o and %o', (a, b, d, c) => {
    expect(dot(a, b)).toBe(d);
    expect(cross(a, b)).toBe(c);
  });

  it('measures length and distance (3-4-5)', () => {
    expect(length(vec(3, 4))).toBe(5);
    expect(lengthSq(vec(3, 4))).toBe(25);
    expect(distance(vec(1, 1), vec(4, 5))).toBe(5);
  });

  it('normalises, and refuses the zero vector', () => {
    expect(normalize(vec(3, 4))).toEqual({ x: 0.6, y: 0.8 });
    expect(() => normalize(vec(0, 0))).toThrow(RangeError);
  });

  it('turns left with perp', () => {
    expect(perp(vec(1, 0))).toEqual({ x: -0, y: 1 });
    expect(perp(vec(0, 2))).toEqual({ x: -2, y: 0 });
  });

  it('interpolates', () => {
    expect(lerp(vec(0, 0), vec(8, 4), 0.25)).toEqual({ x: 2, y: 1 });
    expect(midpoint(vec(-2, 6), vec(4, 0))).toEqual({ x: 1, y: 3 });
  });

  it.each([
    [vec(1, 0), 0],
    [vec(0, 1), Math.PI / 2],
    [vec(-1, 0), Math.PI],
    [vec(0, -1), -Math.PI / 2],
    [vec(1, 1), Math.PI / 4],
  ])('angle of %o is %s', (v, a) => {
    expectClose(angleOf(v), a, 1e-15);
  });

  it('compares points within a tolerance', () => {
    expect(pointsEqual(vec(1, 1), vec(1, 1 + 1e-10))).toBe(true);
    expect(pointsEqual(vec(1, 1), vec(1, 1 + 1e-8))).toBe(false);
    expect(pointsEqual(vec(1, 1), vec(1, 1.5), 1)).toBe(true);
  });

  it('reports magnitude and finiteness', () => {
    expect(magnitude(vec(-7, 3))).toBe(7);
    expect(isFiniteVec(vec(1, 2))).toBe(true);
    expect(isFiniteVec(vec(Number.NaN, 2))).toBe(false);
    expect(isFiniteVec(vec(1, Number.POSITIVE_INFINITY))).toBe(false);
  });
});

describe('tolerance model', () => {
  it.each([
    [[], 1e-9],
    [[0.5], 1e-9],
    [[1000], 1e-6],
    [[-1e4, 20], 1e-5],
    [[Number.NaN, 2], 2e-9],
  ])('tolFor(%o) = %s', (magnitudes, expected) => {
    expectClose(tolFor(...magnitudes), expected, 1e-20);
  });

  it('compares numbers', () => {
    expect(nearlyEqual(1, 1 + 5e-10)).toBe(true);
    expect(nearlyEqual(1, 1 + 5e-9)).toBe(false);
    expect(nearlyEqual(1, 1.1, 0.2)).toBe(true);
  });
});

describe('angles', () => {
  it.each([
    [0, 0],
    [90, Math.PI / 2],
    [180, Math.PI],
    [270, (3 * Math.PI) / 2],
    [360, 2 * Math.PI],
    [-90, -Math.PI / 2],
  ])('%s° is exactly %s rad', (deg, rad) => {
    expect(degToRad(deg)).toBe(rad);
    expectClose(radToDeg(rad), deg, 1e-12);
  });

  it.each([
    [-Math.PI / 2, (3 * Math.PI) / 2],
    [2 * Math.PI, 0],
    [5 * Math.PI, Math.PI],
    [(7 * Math.PI) / 2, (3 * Math.PI) / 2],
    [-4 * Math.PI, 0],
    [1, 1],
  ])('normalizeAngle(%s) = %s', (a, expected) => {
    const n = normalizeAngle(a);
    expectClose(n, expected, 1e-12);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(TAU);
  });

  it('never returns -0 or 2π', () => {
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
    expect(normalizeAngle(-1e-18)).toBeLessThan(TAU);
  });

  it.each([
    [0, Math.PI / 2, Math.PI / 2],
    [Math.PI / 2, 0, (3 * Math.PI) / 2],
    [(3 * Math.PI) / 2, Math.PI / 2, Math.PI],
    [1, 1, 0],
  ])('ccwSweep(%s → %s) = %s', (from, to, sweep) => {
    expectClose(ccwSweep(from, to), sweep, 1e-12);
  });

  it.each([
    [0, 0],
    [Math.PI / 2, 1],
    [Math.PI, 2],
    [-Math.PI / 2, -1],
    [2 * Math.PI, 4],
    [0.1, null],
    [Math.PI / 2 + 1e-9, null],
  ])('quarterTurns(%s) = %s', (a, k) => {
    expect(quarterTurns(a)).toBe(k);
  });

  it.each([
    [0, 1, 0],
    [HALF_PI, 0, 1],
    [Math.PI, -1, 0],
    [(3 * Math.PI) / 2, 0, -1],
    [-HALF_PI, 0, -1],
    [(5 * Math.PI) / 2, 0, 1],
    [degToRad(90), 0, 1],
    [degToRad(-270), 0, 1],
  ])('cosSin(%s) is exactly (%s, %s)', (a, c, s) => {
    const v = cosSin(a);
    expect(v.x === c && v.y === s).toBe(true);
  });

  it('cosSin away from quarter turns', () => {
    expectPoint(cosSin(Math.PI / 6), { x: Math.sqrt(3) / 2, y: 0.5 }, 1e-15);
    expectPoint(cosSin(degToRad(45)), { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 1e-15);
  });

  it.each([
    // start, sweep, angle, expected
    [0, HALF_PI, Math.PI / 4, true],
    [0, HALF_PI, Math.PI, false],
    [0, HALF_PI, 0, true],
    [0, HALF_PI, HALF_PI, true],
    [0, -HALF_PI, (7 * Math.PI) / 4, true],
    [0, -HALF_PI, Math.PI / 4, false],
    [(3 * Math.PI) / 2, Math.PI, 0.1, true],
    [(3 * Math.PI) / 2, Math.PI, Math.PI, false],
  ])('sweep from %s by %s contains %s: %s', (start, sweep, angle, inside) => {
    expect(sweepContains(start, sweep, angle)).toBe(inside);
  });

  it('applies the angular tolerance at both ends', () => {
    expect(sweepContains(0, HALF_PI, -1e-13, 1e-12)).toBe(true);
    expect(sweepContains(0, HALF_PI, HALF_PI + 1e-13, 1e-12)).toBe(true);
    expect(sweepContains(0, HALF_PI, -1e-6, 1e-12)).toBe(false);
  });
});

describe('units', () => {
  it.each([
    [1, 'in', 'mm', 25.4],
    [25.4, 'mm', 'in', 1],
    [12, 'in', 'ft', 1],
    [1, 'ft', 'mm', 304.8],
    [1, 'm', 'mm', 1000],
    [1, 'cm', 'mm', 10],
    [2.5, 'm', 'cm', 250],
    [3, 'ft', 'in', 36],
    [7.5, 'mm', 'mm', 7.5],
  ] as [number, LengthUnit, LengthUnit, number][])('%s %s = %s %s exactly', (v, from, to, expected) => {
    expect(convertLength(v, from, to)).toBe(expected);
  });

  it('converts non-round values to 1e-12', () => {
    expectClose(convertLength(3.5, 'mm', 'cm'), 0.35, 1e-15);
    expectClose(convertLength(100, 'mm', 'in'), 3.937007874015748, 1e-12);
  });

  it('recognises unit names', () => {
    expect(isLengthUnit('mm')).toBe(true);
    expect(isLengthUnit('ft')).toBe(true);
    expect(isLengthUnit('yd')).toBe(false);
  });
});

describe('bounds', () => {
  it('bounds points and unions boxes', () => {
    const b = boundsOfPoints([vec(1, 5), vec(-2, 3), vec(4, -1)]);
    expect(b).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 });
    expect(unionBounds(b, { minX: 0, minY: -3, maxX: 9, maxY: 2 })).toEqual({
      minX: -2,
      minY: -3,
      maxX: 9,
      maxY: 5,
    });
  });

  it('needs at least one point', () => {
    expect(() => boundsOfPoints([])).toThrow(RangeError);
  });
});
