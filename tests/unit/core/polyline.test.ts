import { describe, expect, it } from 'vitest';
import {
  arcEndPoint,
  arcMidPoint,
  arcStartPoint,
  arcToBulge,
  bulgeToArc,
  edgeCount,
  explodePolyline,
  polyline,
  polylineArea,
  polylineBounds,
  polylineLength,
  polylineMagnitude,
  circle,
  segment,
  shapeBounds,
  shapeLength,
  shapeMagnitude,
  vec,
  type Arc,
} from '../../../src/core/geom';
import { expectClose, expectPoint } from './helpers';

const PI = Math.PI;
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
/** Full circle of radius r about the origin as two counter-clockwise half arcs. */
const bulgeCircle = (r: number) =>
  polyline(
    [
      { x: r, y: 0, bulge: 1 },
      { x: -r, y: 0, bulge: 1 },
    ],
    true,
  );

describe('polyline construction', () => {
  it('needs two vertices and finite values', () => {
    expect(() => polyline([{ x: 0, y: 0 }])).toThrow(RangeError);
    expect(() => polyline([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }])).toThrow(/vertex 1/);
    expect(() => polyline([{ x: 0, y: 0, bulge: Number.NaN }, { x: 1, y: 0 }])).toThrow(/vertex 0/);
  });

  it('defaults bulge to 0 and counts edges', () => {
    const open = polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(open.vertices[0]?.bulge).toBe(0);
    expect(edgeCount(open)).toBe(2);
    expect(edgeCount(square(1))).toBe(4);
  });
});

describe('bulge ↔ arc', () => {
  it('bulge 1 is a counter-clockwise half circle bulging right of travel', () => {
    const a = bulgeToArc(vec(0, 0), vec(2, 0), 1);
    expectPoint(a.center, vec(1, 0));
    expectClose(a.radius, 1);
    expectClose(a.sweep, PI);
    expectPoint(arcMidPoint(a), vec(1, -1));
  });

  it('bulge -1 bulges the other way', () => {
    const a = bulgeToArc(vec(0, 0), vec(2, 0), -1);
    expectClose(a.sweep, -PI);
    expectPoint(arcMidPoint(a), vec(1, 1));
  });

  it('tan(π/8) is a quarter arc about the origin', () => {
    const a = bulgeToArc(vec(1, 0), vec(0, 1), Math.tan(PI / 8));
    expectPoint(a.center, vec(0, 0));
    expectClose(a.radius, 1);
    expectClose(a.sweep, PI / 2);
  });

  it('bulge 3 is a major arc (more than a half circle)', () => {
    const a = bulgeToArc(vec(0, 0), vec(2, 0), 3);
    expectClose(a.sweep, 4 * Math.atan(3));
    expect(Math.abs(a.sweep)).toBeGreaterThan(PI);
    expectClose(a.radius, (2 * (1 + 9)) / 12);
  });

  it('arc ends land on the vertices', () => {
    const a = bulgeToArc(vec(3, -2), vec(-1, 5), 0.37);
    expectPoint(arcStartPoint(a), vec(3, -2));
    expectPoint(arcEndPoint(a), vec(-1, 5));
  });

  it('round-trips through arcToBulge', () => {
    for (const b of [0.1, 0.5, 1, 2.5, -0.3, -1, -4]) {
      expectClose(arcToBulge(bulgeToArc(vec(0, 0), vec(5, 1), b)), b, 1e-12 * Math.max(1, Math.abs(b)));
    }
  });

  it('rejects a zero bulge and coincident points', () => {
    expect(() => bulgeToArc(vec(0, 0), vec(1, 0), 0)).toThrow(/straight/);
    expect(() => bulgeToArc(vec(1, 1), vec(1, 1), 0.5)).toThrow(/distinct/);
  });
});

describe('explode', () => {
  it('open polyline → segments in order', () => {
    const edges = explodePolyline(polyline([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]));
    expect(edges.map((e) => e.kind)).toEqual(['segment', 'segment']);
  });

  it('closed square → four segments including the closing edge', () => {
    const edges = explodePolyline(square(10));
    expect(edges).toHaveLength(4);
    expect(edges[3]).toEqual({ kind: 'segment', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } });
  });

  it('bulged edges become arcs; the closing edge uses the last vertex bulge', () => {
    const edges = explodePolyline(bulgeCircle(5));
    expect(edges.map((e) => e.kind)).toEqual(['arc', 'arc']);
    expectPoint(arcMidPoint(edges[0] as Arc), vec(0, 5));
    expectPoint(arcMidPoint(edges[1] as Arc), vec(0, -5));
  });

  it('skips repeated vertices', () => {
    const edges = explodePolyline(polyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }]));
    expect(edges).toHaveLength(1);
  });
});

describe('length and area', () => {
  it.each([
    [square(10), 40],
    [polyline([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]), 7],
    [bulgeCircle(5), 10 * PI],
  ])('length of #%# is %s', (pl, len) => {
    expectClose(polylineLength(pl), len);
  });

  it.each([
    ['CCW 10 × 10 square', square(10), 100],
    [
      'CW 10 × 10 square',
      polyline([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }], true),
      -100,
    ],
    ['4 × 3 rectangle', polyline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], true), 12],
    ['3-4-5 triangle', polyline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }], true), 6],
    ['circle r 5 from bulges', bulgeCircle(5), 25 * PI],
    [
      '2 × 2 square with outward half circle on the bottom',
      polyline([{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], true),
      4 + PI / 2,
    ],
    [
      '2 × 2 square with inward half circle on the bottom',
      polyline([{ x: 0, y: 0, bulge: -1 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], true),
      4 - PI / 2,
    ],
    [
      'slot: 10 long, 4 wide, round ends',
      polyline([{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 1 }, { x: 10, y: 4 }, { x: 0, y: 4, bulge: 1 }], true),
      40 + 4 * PI,
    ],
    ['square far from the origin', square(10, 1e6, -1e6), 100],
  ])('area of %s', (_name, pl, area) => {
    expectClose(polylineArea(pl), area, 1e-9 * Math.max(1, Math.abs(area)));
  });

  it('refuses the area of an open polyline', () => {
    expect(() => polylineArea(polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]))).toThrow(/closed/);
  });
});

describe('bounds and magnitude', () => {
  it('bulged circle bounds', () => {
    const b = polylineBounds(bulgeCircle(5));
    expectClose(b.minX, -5);
    expectClose(b.maxX, 5);
    expectClose(b.minY, -5);
    expectClose(b.maxY, 5);
  });

  it('falls back to vertices when every edge has zero length', () => {
    expect(polylineBounds(polyline([{ x: 2, y: 3 }, { x: 2, y: 3 }]))).toEqual({
      minX: 2,
      minY: 3,
      maxX: 2,
      maxY: 3,
    });
  });

  it('magnitude includes arc extents', () => {
    expect(polylineMagnitude(square(10, -20, 0))).toBe(20);
    expectClose(polylineMagnitude(bulgeCircle(5)), 5);
  });
});

describe('shape helpers', () => {
  it('dispatch to curves and polylines', () => {
    expect(shapeBounds(square(10, 5, -5))).toEqual({ minX: 5, minY: -5, maxX: 15, maxY: 5 });
    expect(shapeBounds(segment(vec(1, 2), vec(-3, 4)))).toEqual({ minX: -3, minY: 2, maxX: 1, maxY: 4 });
    expectClose(shapeLength(square(10)), 40);
    expectClose(shapeLength(circle(vec(0, 0), 1)), 2 * PI);
    expect(shapeMagnitude(square(10, -30, 0))).toBe(30);
    expect(shapeMagnitude(circle(vec(2, 0), 1))).toBe(3);
  });
});
