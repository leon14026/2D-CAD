import { describe, expect, it } from 'vitest';
import {
  arc,
  circle,
  degToRad,
  HALF_PI,
  perpendicularFeet,
  polarPoint,
  polyline,
  quadrantPoints,
  rectangle,
  regularPolygon,
  segment,
  shapeCurves,
  tangentPoints,
} from '../../../src/core/geom';
import { expectPoint, expectPointSet } from './helpers';

const r3 = Math.sqrt(3);

describe('rectangle', () => {
  it('runs from the first corner along x, then y, and is closed', () => {
    const r = rectangle({ x: 0, y: 0 }, { x: 120, y: 80 });
    expect(r.closed).toBe(true);
    expect(r.vertices).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 120, y: 0, bulge: 0 },
      { x: 120, y: 80, bulge: 0 },
      { x: 0, y: 80, bulge: 0 },
    ]);
  });

  it('works from any corner', () => {
    expect(rectangle({ x: 5, y: 5 }, { x: -5, y: -1 }).vertices.map((v) => [v.x, v.y])).toEqual([
      [5, 5],
      [-5, 5],
      [-5, -1],
      [5, -1],
    ]);
  });

  it('refuses a flat or non-finite rectangle', () => {
    expect(() => rectangle({ x: 0, y: 0 }, { x: 0, y: 5 })).toThrow(RangeError);
    expect(() => rectangle({ x: 0, y: 0 }, { x: 5, y: 0 })).toThrow(RangeError);
    expect(() => rectangle({ x: NaN, y: 0 }, { x: 5, y: 5 })).toThrow(RangeError);
    expect(() => rectangle({ x: 0, y: 0 }, { x: 5, y: Infinity })).toThrow(RangeError);
  });
});

describe('regularPolygon', () => {
  it('a square from a corner on the x axis is exact', () => {
    const sq = regularPolygon({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(sq.closed).toBe(true);
    expect(sq.vertices.map((v) => [v.x, v.y])).toEqual([
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ]);
  });

  it('a hexagon about (60, 40) with radius 10', () => {
    const h = regularPolygon({ x: 60, y: 40 }, { x: 70, y: 40 }, 6);
    const expected = [
      { x: 70, y: 40 },
      { x: 65, y: 40 + 5 * r3 },
      { x: 55, y: 40 + 5 * r3 },
      { x: 50, y: 40 },
      { x: 55, y: 40 - 5 * r3 },
      { x: 65, y: 40 - 5 * r3 },
    ];
    expect(h.vertices).toHaveLength(6);
    h.vertices.forEach((v, i) => expectPoint(v, expected[i]!));
  });

  it('keeps the given corner exactly, at any angle', () => {
    const tri = regularPolygon({ x: 1, y: 2 }, { x: 4.25, y: -7.5 }, 3);
    expect(tri.vertices[0]).toEqual({ x: 4.25, y: -7.5, bulge: 0 });
  });

  it('refuses a bad number of sides or a corner on the centre', () => {
    const c = { x: 0, y: 0 };
    const p = { x: 1, y: 0 };
    expect(() => regularPolygon(c, p, 2)).toThrow(RangeError);
    expect(() => regularPolygon(c, p, 4.5)).toThrow(RangeError);
    expect(() => regularPolygon(c, p, 1025)).toThrow(RangeError);
    expect(regularPolygon(c, p, 1024).vertices).toHaveLength(1024);
    expect(() => regularPolygon(c, c, 5)).toThrow(RangeError);
    expect(() => regularPolygon(c, { x: NaN, y: 0 }, 5)).toThrow(RangeError);
  });
});

describe('special points of curves', () => {
  const ring = circle({ x: 0, y: 0 }, 10);
  const upper = arc({ x: 0, y: 0 }, 10, 0, Math.PI);
  const line = segment({ x: -20, y: 0 }, { x: 20, y: 0 });

  it('quadrants: four on a circle, those inside an arc, none on a line', () => {
    expect(quadrantPoints(ring)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
    ]);
    expect(quadrantPoints(upper)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ]);
    expect(quadrantPoints(arc({ x: 0, y: 0 }, 10, 0.1, 0.5))).toEqual([]);
    expect(quadrantPoints(line)).toEqual([]);
  });

  it('perpendicular feet: on a line only inside its length', () => {
    expect(perpendicularFeet(line, { x: 5, y: 7 })).toEqual([{ x: 5, y: 0 }]);
    expect(perpendicularFeet(line, { x: 25, y: 7 })).toEqual([]);
    expect(perpendicularFeet(line, { x: -20, y: -3 })).toEqual([{ x: -20, y: 0 }]);
  });

  it('perpendicular feet: nearest and farthest on a circle, those on an arc, none from the centre', () => {
    expectPointSet(perpendicularFeet(ring, { x: 0, y: 20 }), [
      { x: 0, y: 10 },
      { x: 0, y: -10 },
    ]);
    expectPointSet(perpendicularFeet(upper, { x: 0, y: 20 }), [{ x: 0, y: 10 }]);
    expectPointSet(perpendicularFeet(ring, { x: 6, y: 8 }), [
      { x: 6, y: 8 },
      { x: -6, y: -8 },
    ]);
    expect(perpendicularFeet(ring, { x: 0, y: 0 })).toEqual([]);
  });

  it('tangent points from (0, 20) to a radius-10 circle sit at 30° and 150°', () => {
    expectPointSet(tangentPoints(ring, { x: 0, y: 20 }), [
      { x: 5 * r3, y: 5 },
      { x: -5 * r3, y: 5 },
    ]);
    expectPointSet(tangentPoints(arc({ x: 0, y: 0 }, 10, 0, HALF_PI), { x: 0, y: 20 }), [{ x: 5 * r3, y: 5 }]);
  });

  it('no tangent from inside or on the circle, or to a line', () => {
    expect(tangentPoints(ring, { x: 3, y: 4 })).toEqual([]);
    expect(tangentPoints(ring, { x: 10, y: 0 })).toEqual([]);
    expect(tangentPoints(line, { x: 0, y: 20 })).toEqual([]);
  });

  it('polar points are exact at quarter turns and accurate elsewhere', () => {
    expect(polarPoint({ x: 1, y: 2 }, 10, degToRad(90))).toEqual({ x: 1, y: 12 });
    expect(polarPoint({ x: 1, y: 2 }, 10, degToRad(180))).toEqual({ x: -9, y: 2 });
    expectPoint(polarPoint({ x: 0, y: 0 }, 20, degToRad(30)), { x: 10 * r3, y: 10 });
  });
});

describe('shapeCurves', () => {
  it('returns a curve as itself and caches a polyline split into edges', () => {
    const line = segment({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(shapeCurves(line)).toEqual([line]);
    const pl = polyline([
      { x: 0, y: 0 },
      { x: 1, y: 0, bulge: 1 },
      { x: 2, y: 0 },
    ]);
    const edges = shapeCurves(pl);
    expect(edges).toHaveLength(2);
    expect(shapeCurves(pl)).toBe(edges);
  });
});
