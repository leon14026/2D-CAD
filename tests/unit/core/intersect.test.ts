import { describe, expect, it } from 'vitest';
import {
  arc,
  circle,
  intersect,
  intersectCurves,
  polyline,
  segment,
  triangleHeight,
  vec,
  type Shape,
} from '../../../src/core/geom';
import { expectClose, expectPointSet } from './helpers';

const PI = Math.PI;
const HALF = PI / 2;
const seg = (x1: number, y1: number, x2: number, y2: number) => segment(vec(x1, y1), vec(x2, y2));
const square = (s: number, ox = 0, oy = 0) =>
  polyline(
    [
      { x: ox, y: oy },
      { x: ox + s, y: oy },
      { x: ox + s, y: oy + s },
      { x: ox, y: oy + s },
    ],
    true,
  );

/** Every case is checked in both argument orders. */
function check(a: Shape, b: Shape, expected: { x: number; y: number }[], tol?: number) {
  expectPointSet(intersect(a, b, tol), expected, tol ?? 1e-9);
  expectPointSet(intersect(b, a, tol), expected, tol ?? 1e-9);
}

describe('segment × segment', () => {
  it.each([
    ['X crossing', seg(0, 0, 10, 10), seg(0, 10, 10, 0), [vec(5, 5)]],
    ['T junction at an endpoint', seg(0, 0, 10, 0), seg(5, 0, 5, 5), [vec(5, 0)]],
    ['corner sharing an endpoint', seg(0, 0, 10, 0), seg(10, 0, 10, 10), [vec(10, 0)]],
    ['would cross only if extended', seg(0, 0, 1, 0), seg(5, -1, 5, 1), []],
    ['parallel and apart', seg(0, 0, 10, 0), seg(0, 1, 10, 1), []],
    ['collinear overlap', seg(0, 0, 10, 0), seg(5, 0, 15, 0), [vec(5, 0), vec(10, 0)]],
    ['collinear and disjoint', seg(0, 0, 1, 0), seg(2, 0, 3, 0), []],
    ['collinear, one inside the other', seg(0, 0, 10, 0), seg(2, 0, 3, 0), [vec(2, 0), vec(3, 0)]],
    ['collinear, end to end', seg(0, 0, 1, 0), seg(1, 0, 2, 0), [vec(1, 0)]],
    ['collinear, identical', seg(0, 0, 4, 3), seg(4, 3, 0, 0), [vec(0, 0), vec(4, 3)]],
    ['steep crossing', seg(1, -100, 1, 100), seg(-3, 2, 5, 6), [vec(1, 4)]],
    ['far from the origin', seg(1e6, 1e6, 1e6 + 10, 1e6 + 10), seg(1e6, 1e6 + 10, 1e6 + 10, 1e6), [vec(1e6 + 5, 1e6 + 5)]],
  ])('%s', (_name, a, b, expected) => {
    check(a, b, expected, _name === 'far from the origin' ? 1e-9 * 1e6 : undefined);
  });

  it('misses by 1e-6 past an endpoint, hits by 1e-12', () => {
    check(seg(0, 0, 1, 0), seg(1 + 1e-6, -1, 1 + 1e-6, 1), []);
    expect(intersect(seg(0, 0, 1, 0), seg(1 + 1e-12, -1, 1 + 1e-12, 1))).toHaveLength(1);
  });

  it('honours an explicit tolerance', () => {
    const a = seg(0, 0, 10, 0);
    const b = seg(5, 1e-6, 5, 10);
    expect(intersect(a, b)).toEqual([]);
    expect(intersect(a, b, 1e-5)).toHaveLength(1);
  });
});

describe('segment × circle', () => {
  const c = circle(vec(0, 0), 5);
  it.each([
    ['through the centre', seg(-10, 0, 10, 0), [vec(-5, 0), vec(5, 0)]],
    ['3-4-5 chord', seg(-10, 3, 10, 3), [vec(-4, 3), vec(4, 3)]],
    ['tangent at the top', seg(-10, 5, 10, 5), [vec(0, 5)]],
    ['clear miss', seg(-10, 6, 10, 6), []],
    ['wholly inside', seg(-1, 0, 1, 0), []],
    ['ends on the circle', seg(0, 0, 5, 0), [vec(5, 0)]],
    ['starts outside, ends inside', seg(0, -9, 0, 0), [vec(0, -5)]],
    ['diagonal', seg(0, 0, 10, 10), [vec(5 * Math.SQRT1_2, 5 * Math.SQRT1_2)]],
  ])('%s', (_name, s, expected) => {
    check(s, c, expected);
  });

  it('offset circle', () => {
    check(seg(0, 7, 20, 7), circle(vec(10, 3), 5), [vec(7, 7), vec(13, 7)]);
  });
});

describe('segment × arc', () => {
  const upper = arc(vec(0, 0), 5, 0, PI);
  const lowerCw = arc(vec(0, 0), 5, 0, -PI);
  const firstQuarter = arc(vec(0, 0), 5, 0, HALF);

  it.each([
    ['upper half, chord above', upper, seg(-10, 3, 10, 3), [vec(-4, 3), vec(4, 3)]],
    ['upper half, chord below', upper, seg(-10, -3, 10, -3), []],
    ['first quarter only', firstQuarter, seg(-10, 3, 10, 3), [vec(4, 3)]],
    ['clockwise lower half', lowerCw, seg(-10, -3, 10, -3), [vec(-4, -3), vec(4, -3)]],
    ['tangent at the top', upper, seg(-10, 5, 10, 5), [vec(0, 5)]],
    ['through an arc endpoint', firstQuarter, seg(5, -2, 5, 2), [vec(5, 0)]],
  ])('%s', (_name, a, s, expected) => {
    check(a, s, expected);
  });
});

describe('circle × circle', () => {
  it.each([
    ['two r 5 circles 8 apart', circle(vec(0, 0), 5), circle(vec(8, 0), 5), [vec(4, 3), vec(4, -3)]],
    ['external tangent', circle(vec(0, 0), 2), circle(vec(5, 0), 3), [vec(2, 0)]],
    ['internal tangent', circle(vec(0, 0), 5), circle(vec(2, 0), 3), [vec(5, 0)]],
    ['internal tangent, small first', circle(vec(0, 0), 3), circle(vec(2, 0), 5), [vec(-3, 0)]],
    ['apart', circle(vec(0, 0), 1), circle(vec(5, 0), 1), []],
    ['one inside the other', circle(vec(0, 0), 10), circle(vec(1, 0), 2), []],
    ['concentric', circle(vec(0, 0), 2), circle(vec(0, 0), 3), []],
    ['identical (no endpoints to report)', circle(vec(1, 1), 2), circle(vec(1, 1), 2), []],
    ['vertical line of centres', circle(vec(0, 0), 5), circle(vec(0, 6), 5), [vec(4, 3), vec(-4, 3)]],
  ])('%s', (_name, a, b, expected) => {
    check(a, b, expected);
  });
});

describe('arcs on and off the same circle', () => {
  it.each([
    ['upper half × circle r 5 at (8, 0)', arc(vec(0, 0), 5, 0, PI), circle(vec(8, 0), 5), [vec(4, 3)]],
    ['lower half × circle r 5 at (8, 0)', arc(vec(0, 0), 5, PI, PI), circle(vec(8, 0), 5), [vec(4, -3)]],
    [
      'overlapping arcs on one circle',
      arc(vec(0, 0), 5, 0, PI),
      arc(vec(0, 0), 5, HALF, PI),
      [vec(-5, 0), vec(0, 5)],
    ],
    ['disjoint arcs on one circle', arc(vec(0, 0), 5, 0, HALF), arc(vec(0, 0), 5, PI, HALF), []],
    ['arc lying on a circle', arc(vec(0, 0), 5, 0, HALF), circle(vec(0, 0), 5), [vec(5, 0), vec(0, 5)]],
    ['arcs meeting end to end', arc(vec(0, 0), 5, 0, HALF), arc(vec(0, 0), 5, HALF, HALF), [vec(0, 5)]],
    ['crossing arcs', arc(vec(0, 0), 5, 0, PI), arc(vec(8, 0), 5, HALF, PI), [vec(4, 3)]],
  ])('%s', (_name, a, b, expected) => {
    check(a, b, expected);
  });
});

describe('polylines', () => {
  it.each([
    ['square × horizontal line', square(10), seg(-5, 5, 15, 5), [vec(0, 5), vec(10, 5)]],
    ['square × circle at a corner', square(10), circle(vec(10, 10), 2), [vec(8, 10), vec(10, 8)]],
    ['two overlapping squares', square(10), square(10, 5, 5), [vec(10, 5), vec(5, 10)]],
    ['line through a corner counts once', square(10), seg(-5, -5, 5, 5), [vec(0, 0)]],
    [
      'bulged circle × chord',
      polyline([{ x: 5, y: 0, bulge: 1 }, { x: -5, y: 0, bulge: 1 }], true),
      seg(-10, 3, 10, 3),
      [vec(-4, 3), vec(4, 3)],
    ],
  ])('%s', (_name, a, b, expected) => {
    check(a, b, expected);
  });
});

describe('internals', () => {
  it('intersectCurves picks a tolerance from the curves', () => {
    expect(intersectCurves(seg(0, 0, 2, 2), seg(0, 2, 2, 0))).toEqual([vec(1, 1)]);
  });

  it('triangleHeight matches the 3-4-5 case and degrades to 0', () => {
    // Circles r 5 at distance 8 meet 3 above and below the line of centres.
    expectClose(triangleHeight(8, 5, 5), 3);
    expect(triangleHeight(10, 2, 3)).toBe(0);
  });

  it('triangleHeight stays accurate for near-tangent circles', () => {
    // r1 = r2 = 1e4, centres 2e4 - 2e-6 apart: exact half-gap is sqrt(1e4² - (1e4 - 1e-6)²).
    const exact = Math.sqrt(2 * 1e4 * 1e-6 - 1e-12);
    expectClose(triangleHeight(2e4 - 2e-6, 1e4, 1e4), exact, 1e-9 * exact * 1e3);
  });
});
