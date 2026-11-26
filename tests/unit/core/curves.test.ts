import { describe, expect, it } from 'vitest';
import {
  arc,
  arcContainsAngle,
  arcEndPoint,
  arcFromCenter,
  arcMidPoint,
  arcStartPoint,
  arcThrough,
  circle,
  circleThrough,
  closestPoint,
  curveBounds,
  curveEndpoints,
  curveLength,
  curveMagnitude,
  distanceToCurve,
  HALF_PI,
  pointAt,
  segment,
  TAU,
  vec,
} from '../../../src/core/geom';
import { expectClose, expectPoint, expectPointSet } from './helpers';

const PI = Math.PI;
const R2 = Math.SQRT1_2;

describe('constructors validate input', () => {
  it('segment', () => {
    expect(() => segment(vec(1, 1), vec(1, 1))).toThrow(/same point/);
    expect(() => segment(vec(Number.NaN, 0), vec(1, 1))).toThrow(RangeError);
    expect(() => segment(vec(0, 0), vec(1, Number.POSITIVE_INFINITY))).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('circle rejects radius %s', (r) => {
    expect(() => circle(vec(0, 0), r)).toThrow(RangeError);
  });

  it('circle rejects a non-finite centre', () => {
    expect(() => circle(vec(Number.NaN, 0), 1)).toThrow(RangeError);
  });

  it.each([0, TAU, -TAU, 7, Number.NaN])('arc rejects sweep %s', (sweep) => {
    expect(() => arc(vec(0, 0), 1, 0, sweep)).toThrow(RangeError);
  });

  it('arc rejects a non-finite start angle', () => {
    expect(() => arc(vec(0, 0), 1, Number.POSITIVE_INFINITY, 1)).toThrow(RangeError);
  });

  it('arc normalises its start angle', () => {
    expectClose(arc(vec(0, 0), 1, -HALF_PI, 1).start, 3 * HALF_PI, 1e-15);
    expectClose(arc(vec(0, 0), 1, 5 * PI, 1).start, PI, 1e-12);
  });

  it('copies points so later mutation cannot change the shape', () => {
    const p = { x: 1, y: 2 };
    const s = segment(p, vec(3, 4));
    p.x = 99;
    expect(s.start.x).toBe(1);
  });
});

describe('arc points', () => {
  const quarter = arc(vec(0, 0), 10, 0, HALF_PI);
  const clockwise = arc(vec(0, 0), 10, 0, -HALF_PI);
  const offset = arc(vec(5, -3), 2, PI, PI);

  it('quarter arc, counter-clockwise', () => {
    expect(arcStartPoint(quarter)).toEqual({ x: 10, y: 0 });
    expect(arcEndPoint(quarter)).toEqual({ x: 0, y: 10 });
    expectPoint(arcMidPoint(quarter), { x: 10 * R2, y: 10 * R2 });
  });

  it('quarter arc, clockwise', () => {
    expect(arcEndPoint(clockwise)).toEqual({ x: 0, y: -10 });
    expectPoint(arcMidPoint(clockwise), { x: 10 * R2, y: -10 * R2 });
  });

  it('half arc about an offset centre', () => {
    expect(arcStartPoint(offset)).toEqual({ x: 3, y: -3 });
    expect(arcEndPoint(offset)).toEqual({ x: 7, y: -3 });
    expect(arcMidPoint(offset)).toEqual({ x: 5, y: -5 });
  });
});

describe('arcFromCenter', () => {
  it('counter-clockwise quarter', () => {
    const a = arcFromCenter(vec(0, 0), vec(5, 0), vec(0, 5));
    expect(a.radius).toBe(5);
    expectClose(a.sweep, HALF_PI);
  });

  it('clockwise three-quarter', () => {
    const a = arcFromCenter(vec(0, 0), vec(5, 0), vec(0, 5), false);
    expectClose(a.sweep, -3 * HALF_PI);
    expectPoint(arcEndPoint(a), { x: 0, y: 5 });
  });

  it('takes its radius from the start point and only the direction of the end point', () => {
    const a = arcFromCenter(vec(1, 1), vec(4, 1), vec(1, 100));
    expect(a.radius).toBe(3);
    expectPoint(arcEndPoint(a), { x: 1, y: 4 });
  });
});

describe('circleThrough', () => {
  it.each([
    [vec(0, 0), vec(2, 0), vec(0, 2), vec(1, 1), Math.SQRT2],
    [vec(1, 0), vec(0, 1), vec(-1, 0), vec(0, 0), 1],
    [vec(0, 0), vec(6, 0), vec(3, 3), vec(3, 0), 3],
    [vec(-4, 3), vec(4, 3), vec(0, -5), vec(0, 0), 5],
  ])('through %o %o %o → centre %o, r %s', (p1, p2, p3, center, r) => {
    const c = circleThrough(p1, p2, p3);
    expectPoint(c?.center, center);
    expectClose(c?.radius ?? Number.NaN, r);
  });

  it('stays accurate far from the origin', () => {
    const o = vec(1e6, -2e6);
    const c = circleThrough(vec(o.x + 3, o.y + 4), vec(o.x - 5, o.y), vec(o.x, o.y - 5));
    expectPoint(c?.center, o, 1e-9 * 2e6);
    expectClose(c?.radius ?? Number.NaN, 5, 1e-9 * 2e6);
  });

  it.each([
    [vec(0, 0), vec(1, 1), vec(2, 2)],
    [vec(0, 0), vec(0, 0), vec(1, 0)],
    [vec(3, 3), vec(3, 3), vec(3, 3)],
  ])('returns null for degenerate points %o %o %o', (p1, p2, p3) => {
    expect(circleThrough(p1, p2, p3)).toBeNull();
  });
});

describe('arcThrough', () => {
  it('upper half, counter-clockwise', () => {
    const a = arcThrough(vec(1, 0), vec(0, 1), vec(-1, 0));
    expectPoint(a?.center, vec(0, 0));
    expectClose(a?.start ?? Number.NaN, 0);
    expectClose(a?.sweep ?? Number.NaN, PI);
  });

  it('lower half, clockwise', () => {
    const a = arcThrough(vec(1, 0), vec(0, -1), vec(-1, 0));
    expectClose(a?.sweep ?? Number.NaN, -PI);
  });

  it('three-quarter arc through the far side', () => {
    const a = arcThrough(vec(1, 0), vec(-1, 0), vec(0, -1));
    expectClose(a?.sweep ?? Number.NaN, 3 * HALF_PI);
  });

  it('returns null for collinear points', () => {
    expect(arcThrough(vec(0, 0), vec(1, 0), vec(2, 0))).toBeNull();
  });
});

describe('length, parameter and endpoints', () => {
  it.each([
    [segment(vec(0, 0), vec(3, 4)), 5],
    [circle(vec(9, 9), 2), 4 * PI],
    [arc(vec(0, 0), 3, 0, PI / 3), PI],
    [arc(vec(0, 0), 3, 1, -PI / 3), PI],
  ])('length of %o is %s', (c, len) => {
    expectClose(curveLength(c), len);
  });

  it('pointAt', () => {
    expect(pointAt(segment(vec(0, 0), vec(10, 4)), 0.5)).toEqual({ x: 5, y: 2 });
    expect(pointAt(circle(vec(1, 1), 2), 0.25)).toEqual({ x: 1, y: 3 });
    expect(pointAt(arc(vec(0, 0), 10, 0, HALF_PI), 1)).toEqual({ x: 0, y: 10 });
  });

  it('endpoints', () => {
    expect(curveEndpoints(circle(vec(0, 0), 1))).toEqual([]);
    expect(curveEndpoints(segment(vec(0, 0), vec(1, 2)))).toEqual([vec(0, 0), vec(1, 2)]);
    expectPointSet(curveEndpoints(arc(vec(0, 0), 2, 0, PI)), [vec(2, 0), vec(-2, 0)]);
  });

  it('magnitude', () => {
    expect(curveMagnitude(segment(vec(-7, 1), vec(2, 3)))).toBe(7);
    expect(curveMagnitude(circle(vec(4, -6), 2))).toBe(8);
    expect(curveMagnitude(arc(vec(1, 1), 3, 0, 1))).toBe(4);
  });
});

describe('bounds', () => {
  it('segment and circle', () => {
    expect(curveBounds(segment(vec(4, -1), vec(-2, 3)))).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 3 });
    expect(curveBounds(circle(vec(1, 2), 3))).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 });
  });

  it('quarter arc in the first quadrant', () => {
    expect(curveBounds(arc(vec(0, 0), 10, 0, HALF_PI))).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('arc over the top includes the 90° point', () => {
    const b = curveBounds(arc(vec(0, 0), 10, PI / 4, HALF_PI));
    expectClose(b.minX, -10 * R2);
    expectClose(b.maxX, 10 * R2);
    expectClose(b.minY, 10 * R2);
    expect(b.maxY).toBe(10);
  });

  it('arc across 0° includes the 0° point', () => {
    const b = curveBounds(arc(vec(0, 0), 10, (7 * PI) / 4, HALF_PI));
    expect(b.maxX).toBe(10);
    expectClose(b.minY, -10 * R2);
    expectClose(b.maxY, 10 * R2);
  });

  it('clockwise arc across 270°', () => {
    const b = curveBounds(arc(vec(0, 0), 4, 0, -PI));
    expectClose(b.minX, -4);
    expectClose(b.maxX, 4);
    expect(b.minY).toBe(-4);
    expectClose(b.maxY, 0);
  });
});

describe('closest point and distance', () => {
  const seg = segment(vec(0, 0), vec(10, 0));
  const c = circle(vec(0, 0), 5);
  const upper = arc(vec(0, 0), 5, 0, PI);

  it.each([
    [vec(4, 3), vec(4, 0)],
    [vec(-3, 2), vec(0, 0)],
    [vec(14, -1), vec(10, 0)],
  ])('segment: from %o to %o', (p, q) => {
    expectPoint(closestPoint(seg, p), q);
  });

  it.each([
    [vec(10, 0), vec(5, 0)],
    [vec(3, 4), vec(3, 4)],
    [vec(0, -1), vec(0, -5)],
    [vec(0, 0), vec(5, 0)],
  ])('circle: from %o to %o', (p, q) => {
    expectPoint(closestPoint(c, p), q);
  });

  it.each([
    [vec(0, 9), vec(0, 5)],
    [vec(6, 8), vec(3, 4)],
    [vec(3, -4), vec(5, 0)],
    [vec(-3, -4), vec(-5, 0)],
    [vec(0, 0), vec(5, 0)],
  ])('upper half arc: from %o to %o', (p, q) => {
    expectPoint(closestPoint(upper, p), q);
  });

  it('distances', () => {
    expectClose(distanceToCurve(seg, vec(5, 5)), 5);
    expectClose(distanceToCurve(c, vec(6, 8)), 5);
    expectClose(distanceToCurve(upper, vec(0, -5)), 5 * Math.SQRT2);
  });

  it('arcContainsAngle with tolerance', () => {
    expect(arcContainsAngle(upper, HALF_PI)).toBe(true);
    expect(arcContainsAngle(upper, -0.1)).toBe(false);
    expect(arcContainsAngle(upper, -0.1, 0.2)).toBe(true);
  });
});
