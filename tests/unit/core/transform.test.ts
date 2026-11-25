import { describe, expect, it } from 'vitest';
import {
  arc,
  arcEndPoint,
  arcStartPoint,
  circle,
  degToRad,
  inverse,
  mirror,
  polyline,
  polylineArea,
  rotate,
  scaleAbout,
  segment,
  transformPoint,
  transformShape,
  translate,
  vec,
  type Arc,
  type Circle,
  type Polyline,
  type Segment,
} from '../../../src/core/geom';
import { expectClose, expectPoint } from './helpers';

const O = vec(0, 0);

describe('points', () => {
  it.each([
    ['translate', translate(3, 4), vec(1, 2), vec(4, 6)],
    ['rotate 90°', rotate(O, degToRad(90)), vec(10, 0), vec(0, 10)],
    ['rotate 180°', rotate(O, degToRad(180)), vec(10, 0), vec(-10, 0)],
    ['rotate 270°', rotate(O, degToRad(270)), vec(10, 0), vec(0, -10)],
    ['rotate -90°', rotate(O, degToRad(-90)), vec(3, 4), vec(4, -3)],
    ['rotate 360°', rotate(O, degToRad(360)), vec(3, 4), vec(3, 4)],
    ['rotate 90° about (5, 5)', rotate(vec(5, 5), degToRad(90)), vec(10, 5), vec(5, 10)],
    ['scale ×2 about (1, 1)', scaleAbout(vec(1, 1), 2), vec(3, 3), vec(5, 5)],
    ['scale ×0.5 about the origin', scaleAbout(O, 0.5), vec(-8, 6), vec(-4, 3)],
    ['mirror in the x axis', mirror(O, vec(1, 0)), vec(3, 4), vec(3, -4)],
    ['mirror in the y axis', mirror(O, vec(0, 1)), vec(3, 4), vec(-3, 4)],
    ['mirror in y = 2', mirror(vec(-5, 2), vec(5, 2)), vec(1, 7), vec(1, -3)],
  ])('%s is exact', (_name, t, p, expected) => {
    expect(transformPoint(t, p)).toEqual(expected);
  });

  it.each([
    ['rotate 45°', rotate(O, degToRad(45)), vec(10, 0), vec(10 * Math.SQRT1_2, 10 * Math.SQRT1_2)],
    ['rotate 30°', rotate(O, degToRad(30)), vec(2, 0), vec(Math.sqrt(3), 1)],
    ['mirror in y = x', mirror(O, vec(1, 1)), vec(3, 4), vec(4, 3)],
    ['mirror in y = x + 1', mirror(vec(0, 1), vec(1, 2)), vec(0, 0), vec(-1, 1)],
    ['mirror in y = -x', mirror(O, vec(1, -1)), vec(2, 0), vec(0, -2)],
  ])('%s', (_name, t, p, expected) => {
    expectPoint(transformPoint(t, p), expected);
  });
});

describe('constructors validate input', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('scale factor %s is rejected', (k) => {
    expect(() => scaleAbout(O, k)).toThrow(RangeError);
  });

  it('rejects non-finite values and a degenerate mirror axis', () => {
    expect(() => translate(Number.NaN, 0)).toThrow(RangeError);
    expect(() => rotate(O, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => rotate(vec(Number.NaN, 0), 1)).toThrow(RangeError);
    expect(() => mirror(vec(1, 1), vec(1, 1))).toThrow(/distinct/);
    expect(() => mirror(vec(Number.NaN, 1), vec(1, 1))).toThrow(RangeError);
  });
});

describe('inverse', () => {
  it.each([
    translate(3, -4),
    rotate(vec(2, 1), 0.7),
    scaleAbout(vec(-1, 5), 4),
    mirror(vec(1, 2), vec(3, 7)),
  ])('undoes %o', (t) => {
    const p = vec(12.5, -3.25);
    expectPoint(transformPoint(inverse(t), transformPoint(t, p)), p);
  });
});

describe('curves', () => {
  it('segment endpoints move', () => {
    const s = transformShape(rotate(O, degToRad(90)), segment(vec(1, 0), vec(2, 0)));
    expect(s).toEqual({ kind: 'segment', start: { x: 0, y: 1 }, end: { x: 0, y: 2 } });
  });

  it('circle: rotate moves the centre, scale changes the radius', () => {
    const c = circle(vec(4, 0), 2);
    expect(transformShape(rotate(O, degToRad(90)), c).center).toEqual({ x: 0, y: 4 });
    const scaled: Circle = transformShape(scaleAbout(O, 3), c);
    expect(scaled.radius).toBe(6);
    expect(scaled.center).toEqual({ x: 12, y: 0 });
    expect(transformShape(mirror(O, vec(0, 1)), c).center).toEqual({ x: -4, y: 0 });
  });

  const quarter = arc(O, 10, 0, Math.PI / 2);

  it('arc: rotate 90°', () => {
    const a: Arc = transformShape(rotate(O, degToRad(90)), quarter);
    expectClose(a.start, Math.PI / 2);
    expectPoint(arcStartPoint(a), vec(0, 10));
    expectPoint(arcEndPoint(a), vec(-10, 0));
  });

  it('arc: mirror in the x axis reverses direction', () => {
    const a: Arc = transformShape(mirror(O, vec(1, 0)), quarter);
    expectClose(a.sweep, -Math.PI / 2);
    expectPoint(arcStartPoint(a), vec(10, 0));
    expectPoint(arcEndPoint(a), vec(0, -10));
  });

  it('arc: mirror in the y axis', () => {
    const a: Arc = transformShape(mirror(O, vec(0, 1)), quarter);
    expectPoint(arcStartPoint(a), vec(-10, 0));
    expectPoint(arcEndPoint(a), vec(0, 10));
  });

  it('arc: scale and translate', () => {
    const s: Arc = transformShape(scaleAbout(O, 3), quarter);
    expect(s.radius).toBe(30);
    expectPoint(arcEndPoint(s), vec(0, 30));
    const t: Arc = transformShape(translate(5, -5), quarter);
    expect(t.center).toEqual({ x: 5, y: -5 });
    expectPoint(arcEndPoint(t), vec(5, 5));
  });
});

describe('polylines', () => {
  const pl = polyline(
    [
      { x: 0, y: 0, bulge: 0.5 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ],
    true,
  );

  it('translate moves vertices and keeps bulges', () => {
    const t: Polyline = transformShape(translate(1, 2), pl);
    expect(t.vertices.map((v) => [v.x, v.y, v.bulge])).toEqual([
      [1, 2, 0.5],
      [5, 2, 0],
      [5, 5, 0],
    ]);
    expect(t.closed).toBe(true);
  });

  it('mirror flips bulge signs and the sign of the area', () => {
    const m: Polyline = transformShape(mirror(O, vec(0, 1)), pl);
    expect(m.vertices[0]?.bulge).toBe(-0.5);
    expect(m.vertices[1]?.bulge).toBe(0);
    expectClose(polylineArea(m), -polylineArea(pl));
  });

  it('rotation keeps the area; scaling by k multiplies it by k²', () => {
    expectClose(polylineArea(transformShape(rotate(vec(7, 7), 1.234), pl)), polylineArea(pl));
    expectClose(polylineArea(transformShape(scaleAbout(vec(1, 1), 3), pl)), 9 * polylineArea(pl));
  });

  it('keeps the shape kind', () => {
    const s: Segment = transformShape(translate(1, 1), segment(O, vec(1, 0)));
    expect(s.kind).toBe('segment');
  });
});
