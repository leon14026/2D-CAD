/** Hand-calculated checks for the Phase 5 geometry: offset, trim, extend, fillet, chamfer, join. */
import { describe, expect, it } from 'vitest';
import {
  arc,
  arcEndPoint,
  arcStartPoint,
  chamferLines,
  chamferPolyline,
  circle,
  curveParam,
  distance,
  extendShape,
  filletLines,
  filletPolyline,
  joinShapes,
  offsetCurve,
  offsetShape,
  offsetToward,
  pathOf,
  pathParam,
  polyline,
  polylineCorner,
  rectangle,
  reverseChain,
  segment,
  sideOf,
  trimShape,
  type Arc,
  type Polyline,
  type Shape,
  type Vec2,
} from '../../../src/core/geom';
import { expectClose, expectPoint } from './helpers';

const P = (x: number, y: number): Vec2 => ({ x, y });
const r3 = Math.sqrt(3);
const verts = (s: Shape) => (s as Polyline).vertices.map((v) => [v.x, v.y]);
const box = rectangle(P(0, 0), P(100, 60)); // anticlockwise from (0, 0)

function pieces(r: ReturnType<typeof trimShape>): Shape[] {
  expect(r.ok).toBe(true);
  return (r as { pieces: Shape[] }).pieces;
}

function extended(r: ReturnType<typeof extendShape>): Shape {
  expect(r.ok).toBe(true);
  return (r as { shape: Shape }).shape;
}

describe('which side a point is on', () => {
  it('left of a line is +1, right -1, on it 0', () => {
    const s = segment(P(0, 0), P(10, 0));
    expect(sideOf(s, P(5, 3))).toBe(1);
    expect(sideOf(s, P(5, -3))).toBe(-1);
    expect(sideOf(s, P(5, 0))).toBe(0);
  });

  it('inside a circle is left; inside an arc is left only if it turns anticlockwise', () => {
    expect(sideOf(circle(P(0, 0), 5), P(1, 1))).toBe(1);
    expect(sideOf(circle(P(0, 0), 5), P(9, 1))).toBe(-1);
    expect(sideOf(arc(P(0, 0), 5, 0, 1), P(1, 1))).toBe(1);
    expect(sideOf(arc(P(0, 0), 5, 0, -1), P(1, -1))).toBe(-1);
  });

  it('on a polyline, the nearest edge decides', () => {
    expect(sideOf(box, P(50, 30))).toBe(1);
    expect(sideOf(box, P(-20, 30))).toBe(-1);
    expect(sideOf(box, P(110, -10))).toBe(-1);
  });
});

describe('offset', () => {
  it('a line moves along its left normal', () => {
    expect(offsetShape(segment(P(0, 0), P(10, 0)), 2)).toEqual(segment(P(0, 2), P(10, 2)));
    expect(offsetToward(segment(P(0, 0), P(10, 0)), 2, P(3, -9))).toEqual(segment(P(0, -2), P(10, -2)));
  });

  it('circles and arcs keep their centre and change radius', () => {
    expect(offsetToward(circle(P(0, 0), 5), 2, P(10, 0))).toEqual(circle(P(0, 0), 7));
    expect(offsetToward(circle(P(0, 0), 5), 2, P(1, 0))).toEqual(circle(P(0, 0), 3));
    expect(offsetToward(arc(P(0, 0), 10, 0, Math.PI), 3, P(0, 1))).toEqual(arc(P(0, 0), 7, 0, Math.PI));
    expect(offsetToward(arc(P(0, 0), 10, Math.PI, -Math.PI), 3, P(0, 1))).toEqual(arc(P(0, 0), 7, Math.PI, -Math.PI));
    expect(offsetToward(arc(P(0, 0), 10, 0, Math.PI), 3, P(0, 20))).toEqual(arc(P(0, 0), 13, 0, Math.PI));
  });

  it('refuses to shrink a circle or arc to nothing, or a side point on the shape', () => {
    expect(() => offsetToward(circle(P(0, 0), 5), 5, P(1, 0))).toThrow(/too large/);
    expect(() => offsetCurve(arc(P(0, 0), 5, 0, 1), 6)).toThrow(/too large/);
    expect(() => offsetToward(segment(P(0, 0), P(10, 0)), 1, P(4, 0))).toThrow(/lies on the shape/);
    expect(() => offsetShape(box, Infinity)).toThrow(/finite/);
  });

  it('a rectangle outwards: corners meet as mitres, exactly', () => {
    expect(verts(offsetToward(box, 5, P(-20, 30)))).toEqual([
      [-5, -5],
      [105, -5],
      [105, 65],
      [-5, 65],
    ]);
  });

  it('a rectangle inwards', () => {
    const inner = offsetToward(box, 5, P(50, 30));
    expect(verts(inner)).toEqual([
      [5, 5],
      [95, 5],
      [95, 55],
      [5, 55],
    ]);
    expect((inner as Polyline).closed).toBe(true);
  });

  it('too far inwards turns edges inside out: refused', () => {
    expect(() => offsetToward(box, 30, P(50, 30))).toThrow(/too large/);
    expect(() => offsetToward(box, 31, P(50, 30))).toThrow(/too large/);
  });

  it('an open L, inside and outside of its turn', () => {
    const l = polyline([P(0, 0), P(10, 0), P(10, 10)]);
    expect(verts(offsetShape(l, 1))).toEqual([
      [0, 1],
      [9, 1],
      [9, 10],
    ]);
    expect(verts(offsetShape(l, -1))).toEqual([
      [0, -1],
      [11, -1],
      [11, 10],
    ]);
  });

  it('a rounded rectangle: corner arcs change radius and stay tangent to the sides', () => {
    const k = Math.tan(Math.PI / 8);
    const rounded = polyline(
      [
        { x: 5, y: 0 },
        { x: 95, y: 0, bulge: k },
        { x: 100, y: 5 },
        { x: 100, y: 55, bulge: k },
        { x: 95, y: 60 },
        { x: 5, y: 60, bulge: k },
        { x: 0, y: 55 },
        { x: 0, y: 5, bulge: k },
      ],
      true,
    );
    const inner = offsetToward(rounded, 2, P(50, 30)) as Polyline;
    const expected = [
      [5, 2, 0],
      [95, 2, k],
      [98, 5, 0],
      [98, 55, k],
      [95, 58, 0],
      [5, 58, k],
      [2, 55, 0],
      [2, 5, k],
    ];
    expect(inner.vertices).toHaveLength(8);
    inner.vertices.forEach((v, i) => {
      const [x, y, b] = expected[i] as [number, number, number];
      expectPoint(v, P(x, y));
      expectClose(v.bulge, b, 1e-12);
    });
    expect(() => offsetToward(rounded, 5, P(50, 30))).toThrow(/too large/);
  });

  it('a polyline that doubles back gets a round join about the turning point', () => {
    const back = polyline([P(0, 0), P(10, 0), P(0, 0)]);
    expect((offsetShape(back, 1) as Polyline).vertices).toEqual([
      { x: 0, y: 1, bulge: 0 },
      { x: 10, y: 1, bulge: -1 },
      { x: 10, y: -1, bulge: 0 },
      { x: 0, y: -1, bulge: 0 },
    ]);
  });

  it('a line meeting an arc at an angle: the offsets meet where the offset line crosses the offset circle', () => {
    // A straight edge along y = 0, then an anticlockwise arc (bulge 0.5) up to (10, 10).
    const pl = polyline([P(0, 0), { x: 10, y: 0, bulge: 0.5 }, P(10, 10)]);
    const edges = pathOf(pl).curves;
    const bend = edges[1] as Arc;
    const off = offsetShape(pl, 1) as Polyline;
    const join = off.vertices[1]!;
    expectClose(join.y, 1);
    expectClose(distance(join, bend.center), bend.radius - 1);
    expectPoint(off.vertices[0]!, P(0, 1));
  });

  it('two arcs meeting at a point: their offsets meet where the offset circles cross', () => {
    const pl = polyline([{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0, bulge: 0.5 }, P(20, 0)]);
    const [a, b] = pathOf(pl).curves as [Arc, Arc];
    const off = offsetShape(pl, -1) as Polyline;
    const join = off.vertices[1]!;
    expectClose(distance(join, a.center), a.radius + 1);
    expectClose(distance(join, b.center), b.radius + 1);
  });

  it('a polyline with a repeated vertex offsets as if it were not there', () => {
    expect(verts(offsetShape(polyline([P(0, 0), P(5, 0), P(5, 0), P(10, 0)]), 1))).toEqual([
      [0, 1],
      [5, 1],
      [10, 1],
    ]);
  });
});

describe('trim', () => {
  const line = segment(P(0, 0), P(10, 0));
  const at = (x: number) => segment(P(x, -5), P(x, 5));

  it('a line cut once: the picked side goes', () => {
    expect(pieces(trimShape(line, [at(4)], P(7, 0)))).toEqual([segment(P(0, 0), P(4, 0))]);
    expect(pieces(trimShape(line, [at(4)], P(2, 0.3)))).toEqual([segment(P(4, 0), P(10, 0))]);
  });

  it('a line cut twice: the middle goes, both ends stay', () => {
    expect(pieces(trimShape(line, [at(3), at(7)], P(5, 0)))).toEqual([segment(P(0, 0), P(3, 0)), segment(P(7, 0), P(10, 0))]);
  });

  it('nothing crossing, or crossings only at the ends: nothing to trim', () => {
    expect(trimShape(line, [at(20)], P(5, 0))).toEqual({ ok: false, reason: 'no crossings' });
    expect(trimShape(line, [at(10)], P(5, 0))).toEqual({ ok: false, reason: 'no crossings' });
  });

  it('a circle cut by a chord loses the picked side and becomes an arc', () => {
    const [a] = pieces(trimShape(circle(P(0, 0), 5), [segment(P(-10, 3), P(10, 3))], P(0, 5))) as [Arc];
    expect(a.kind).toBe('arc');
    expectPoint(arcStartPoint(a), P(-4, 3));
    expectPoint(arcEndPoint(a), P(4, 3));
    expect(a.sweep).toBeGreaterThan(Math.PI);
  });

  it('a closed shape needs two crossings', () => {
    expect(trimShape(circle(P(0, 0), 5), [segment(P(0, 0), P(0, 10))], P(-5, 0))).toEqual({ ok: false, reason: 'one crossing on a closed shape' });
  });

  it('a rectangle cut by a line through it keeps the other side as an open polyline', () => {
    const [left] = pieces(trimShape(box, [segment(P(50, -10), P(50, 70))], P(100, 30)));
    expect(verts(left as Shape)).toEqual([
      [50, 60],
      [0, 60],
      [0, 0],
      [50, 0],
    ]);
    // Picking on the bottom edge, left of the cut, wraps round the start.
    const [right] = pieces(trimShape(box, [segment(P(50, -10), P(50, 70))], P(10, 0)));
    expect(verts(right as Shape)).toEqual([
      [50, 0],
      [100, 0],
      [100, 60],
      [50, 60],
    ]);
  });

  it('an open polyline with an arc edge keeps exact cut points and recomputes the partial bulge', () => {
    // A half circle over the top from (-10, 0) to (10, 0), then down to (10, -10).
    const rounded = polyline([{ x: -10, y: 0, bulge: -1 }, { x: 10, y: 0 }, { x: 10, y: -10 }]);
    const [first, second] = pieces(trimShape(rounded, [segment(P(-20, 6), P(20, 6))], P(0, 10))) as [Polyline, Polyline];
    expect(first.vertices[0]).toEqual({ x: -10, y: 0, bulge: expect.any(Number) });
    expectPoint(first.vertices[1]!, P(-8, 6));
    expectPoint(second.vertices[0]!, P(8, 6));
    // The kept part of the arc from (-10, 0) to (-8, 6) turns through atan2(6, 8) less than 90°.
    const turned = Math.PI - Math.atan2(6, -8);
    expectClose(first.vertices[0]!.bulge, -Math.tan(turned / 4), 1e-12);
    expect(second.vertices.map((v) => [v.x, v.y]).slice(1)).toEqual([
      [10, 0],
      [10, -10],
    ]);
  });

  it('an arc cut once', () => {
    const [a] = pieces(trimShape(arc(P(0, 0), 10, 0, Math.PI), [segment(P(0, 0), P(0, 20))], P(9, 4))) as [Arc];
    expectPoint(arcStartPoint(a), P(0, 10));
    expectPoint(arcEndPoint(a), P(-10, 0));
  });
});

describe('extend', () => {
  it('a line carries straight on to the nearest boundary ahead of the picked end', () => {
    const line = segment(P(0, 0), P(5, 0));
    const walls = [segment(P(10, -5), P(10, 5)), segment(P(20, -5), P(20, 5)), segment(P(-3, -5), P(-3, 5))];
    expect(extended(extendShape(line, walls, P(4, 0)))).toEqual(segment(P(0, 0), P(10, 0)));
    expect(extended(extendShape(line, walls, P(1, 0)))).toEqual(segment(P(-3, 0), P(5, 0)));
    expect(extendShape(line, [walls[0]!], P(1, 0))).toEqual({ ok: false, reason: 'nothing ahead' });
  });

  it('an arc carries on round its circle, either way', () => {
    const quarter = arc(P(0, 0), 10, 0, Math.PI / 2);
    const wall = segment(P(-6, -20), P(-6, 20));
    const longer = extended(extendShape(quarter, [wall], P(1, 9.9))) as Arc;
    expect(longer.start).toBe(0);
    expectPoint(arcEndPoint(longer), P(-6, 8));
    const back = extended(extendShape(quarter, [wall], P(9.9, 1))) as Arc;
    expectPoint(arcStartPoint(back), P(-6, -8));
    expectPoint(arcEndPoint(back), P(0, 10));
    expect(extendShape(quarter, [segment(P(50, 0), P(60, 0))], P(1, 9.9))).toEqual({ ok: false, reason: 'nothing ahead' });
  });

  it('an open polyline extends its first or last edge', () => {
    const l = polyline([P(0, 0), P(10, 0), P(10, 5)]);
    const ceiling = segment(P(-20, 8), P(20, 8));
    expect(verts(extended(extendShape(l, [ceiling, segment(P(-4, -9), P(-4, 9))], P(10, 4.5))))).toEqual([
      [0, 0],
      [10, 0],
      [10, 8],
    ]);
    expect(verts(extended(extendShape(l, [ceiling, segment(P(-4, -9), P(-4, 9))], P(0.5, 0))))).toEqual([
      [-4, 0],
      [10, 0],
      [10, 5],
    ]);
    const bent = polyline([P(-10, 0), { x: 0, y: 0, bulge: Math.tan(Math.PI / 8) }, P(10, 10)]);
    const out = extended(extendShape(bent, [segment(P(0, 20), P(30, 20))], P(9, 9))) as Polyline;
    // The quarter arc about (0, 10) carries on towards the line y = 20, which it touches at the top.
    expectPoint(out.vertices[2]!, P(0, 20));
  });

  it('closed shapes have no ends to extend', () => {
    expect(extendShape(circle(P(0, 0), 3), [], P(3, 0))).toEqual({ ok: false, reason: 'closed' });
    expect(extendShape(box, [], P(3, 0))).toEqual({ ok: false, reason: 'closed' });
  });
});

describe('fillet and chamfer between two lines', () => {
  const a = segment(P(0, 0), P(10, 0));
  const b = segment(P(12, 2), P(12, 10));

  it('a radius-2 fillet at a right angle: tangent points 2 from the corner, centre on the bisector', () => {
    const f = filletLines(a, P(5, 0), b, P(12, 6), 2);
    expect(f.first).toEqual(segment(P(0, 0), P(10, 0)));
    expect(f.second).toEqual(segment(P(12, 2), P(12, 10)));
    const fillet = f.join as Arc;
    expectPoint(fillet.center, P(10, 2));
    expectClose(fillet.radius, 2);
    expectPoint(arcStartPoint(fillet), P(10, 0));
    expectPoint(arcEndPoint(fillet), P(12, 2));
    expectClose(fillet.sweep, Math.PI / 2);
  });

  it('radius 0 makes a sharp corner, extending the lines to meet', () => {
    expect(filletLines(a, P(5, 0), b, P(12, 6), 0)).toEqual({ first: segment(P(0, 0), P(12, 0)), second: segment(P(12, 0), P(12, 10)), join: null });
  });

  it('a 60° corner with radius 1: tangent points √3 out, centre at (√3, 1)', () => {
    const f = filletLines(segment(P(0, 0), P(10, 0)), P(5, 0), segment(P(5, 5 * r3), P(0, 0)), P(2.5, 2.5 * r3), 1);
    const fillet = f.join as Arc;
    expectPoint(fillet.center, P(r3, 1));
    expectPoint(f.first.start, P(r3, 0));
    expectPoint(f.second.end, P(r3 / 2, 1.5));
    expectClose(Math.abs(fillet.sweep), (2 * Math.PI) / 3);
  });

  it('the pick decides which part of each line is kept', () => {
    const cross = segment(P(-10, 0), P(10, 0));
    const up = segment(P(0, -10), P(0, 10));
    const f = filletLines(cross, P(-5, 0), up, P(0, -5), 0);
    expect(f.first).toEqual(segment(P(-10, 0), P(0, 0)));
    expect(f.second).toEqual(segment(P(0, -10), P(0, 0)));
  });

  it('refuses parallel lines, a radius too large, a negative radius and picks past the corner', () => {
    expect(() => filletLines(a, P(5, 0), segment(P(0, 5), P(10, 5)), P(5, 5), 1)).toThrow(/parallel/);
    expect(() => filletLines(a, P(5, 0), b, P(12, 6), 20)).toThrow(/radius is too large/);
    expect(() => filletLines(a, P(5, 0), b, P(12, 6), -1)).toThrow(/0 or more/);
    expect(() => filletLines(segment(P(0, 0), P(10, 0)), P(5, 0), segment(P(10, 0), P(10, 10)), P(10, -3), 0)).toThrow(/pick each line/);
  });

  it('chamfer: 2 back along the first line, 3 up the second', () => {
    const c = chamferLines(a, P(5, 0), b, P(12, 6), 2, 3);
    expect(c.first).toEqual(segment(P(0, 0), P(10, 0)));
    expect(c.second).toEqual(segment(P(12, 3), P(12, 10)));
    expect(c.join).toEqual(segment(P(10, 0), P(12, 3)));
    expect(chamferLines(a, P(5, 0), b, P(12, 6), 0, 0).join).toBeNull();
    expect(() => chamferLines(a, P(5, 0), b, P(12, 6), 12, 1)).toThrow(/too large/);
    expect(() => chamferLines(a, P(5, 0), b, P(12, 6), -1, 1)).toThrow(/0 or more/);
  });
});

describe('fillet and chamfer polyline corners', () => {
  const k = Math.tan(Math.PI / 8);

  it('every corner of a rectangle, radius 5', () => {
    const f = filletPolyline(box, 5);
    expect(f.closed).toBe(true);
    expect(f.vertices).toEqual([
      { x: 0, y: 5, bulge: k },
      { x: 5, y: 0, bulge: 0 },
      { x: 95, y: 0, bulge: k },
      { x: 100, y: 5, bulge: 0 },
      { x: 100, y: 55, bulge: k },
      { x: 95, y: 60, bulge: 0 },
      { x: 5, y: 60, bulge: k },
      { x: 0, y: 55, bulge: 0 },
    ]);
  });

  it('one chosen corner, and right turns get clockwise arcs', () => {
    expect(filletPolyline(box, 5, [1]).vertices).toHaveLength(5);
    const zig = polyline([P(0, 0), P(10, 0), P(10, -10)]);
    expect(filletPolyline(zig, 2).vertices).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 8, y: 0, bulge: -k },
      { x: 10, y: -2, bulge: 0 },
      { x: 10, y: -10, bulge: 0 },
    ]);
  });

  it('a radius that uses a whole edge leaves no repeated vertex', () => {
    const f = filletPolyline(box, 30);
    expect(f.vertices).toHaveLength(6);
    expect(f.vertices[2]).toEqual({ x: 70, y: 0, bulge: k });
    expect(f.vertices[3]).toEqual({ x: 100, y: 30, bulge: k });
  });

  it('chamfers every corner 10 back', () => {
    expect(verts(chamferPolyline(box, 10))).toEqual([
      [0, 10],
      [10, 0],
      [90, 0],
      [100, 10],
      [100, 50],
      [90, 60],
      [10, 60],
      [0, 50],
    ]);
  });

  it('refuses too large a size, a vertex that is not a corner, and shapes with no corners', () => {
    expect(() => filletPolyline(box, 31)).toThrow(/too large/);
    expect(() => chamferPolyline(box, 31)).toThrow(/too large/);
    expect(() => filletPolyline(polyline([P(0, 0), P(10, 0), P(10, 10)]), 2, [0])).toThrow(/vertex 1 is not a corner/);
    expect(() => filletPolyline(polyline([P(0, 0), P(10, 0), P(20, 0)]), 2)).toThrow(/no corners/);
    expect(() => filletPolyline(box, 0)).toThrow(/more than 0/);
    expect(() => chamferPolyline(box, -1)).toThrow(/more than 0/);
  });

  it('a corner needs two straight edges with a real turn', () => {
    const arcy = polyline([P(0, 0), { x: 10, y: 0, bulge: 0.5 }, P(20, 0), P(20, 10)]);
    expect(polylineCorner(arcy, 1)).toBeNull();
    expect(polylineCorner(arcy, 2)).toBeNull();
    expect(polylineCorner(polyline([P(0, 0), P(0, 0), P(5, 5)]), 1)).toBeNull();
    expect(polylineCorner(box, 7)).toBeNull();
    expect(polylineCorner(box, 1.5)).toBeNull();
    expect(polylineCorner(box, 0)?.turn).toBe(1);
  });
});

describe('join', () => {
  it('lines drawn in any order and direction become one polyline', () => {
    const j = joinShapes([segment(P(10, 0), P(10, 10)), segment(P(10, 0), P(0, 0)), segment(P(10, 10), P(20, 10))]);
    expect(verts(j)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]);
    expect(j.closed).toBe(false);
  });

  it('a loop closes', () => {
    const j = joinShapes([segment(P(0, 0), P(10, 0)), segment(P(10, 0), P(0, 10)), segment(P(0, 10), P(0, 0))]);
    expect(j.closed).toBe(true);
    expect(verts(j)).toEqual([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
  });

  it('arcs keep their bulge, reversed when the arc runs backwards', () => {
    const half = arc(P(5, 0), 5, Math.PI, -Math.PI); // clockwise over the top from (0, 0) to (10, 0)
    const j = joinShapes([segment(P(10, 0), P(20, 0)), half]);
    expect(j.vertices).toHaveLength(3);
    expectPoint(j.vertices[0]!, P(0, 0));
    expectClose(j.vertices[0]!.bulge, -1, 1e-12);
    const r = joinShapes([segment(P(-10, 0), P(0, 0)), arc(P(5, 0), 5, 0, Math.PI)]);
    expectClose(r.vertices[1]!.bulge, -1, 1e-12);
  });

  it('open polylines join to lines at either end', () => {
    const j = joinShapes([polyline([P(0, 0), P(5, 0), P(5, 5)]), segment(P(-5, 0), P(0, 0))]);
    expect(verts(j)).toEqual([
      [-5, 0],
      [0, 0],
      [5, 0],
      [5, 5],
    ]);
  });

  it('refuses one piece, closed shapes and gaps', () => {
    expect(() => joinShapes([segment(P(0, 0), P(1, 0))])).toThrow(/at least two/);
    expect(() => joinShapes([circle(P(0, 0), 1), segment(P(0, 0), P(1, 0))])).toThrow(/circle/);
    expect(() => joinShapes([box, segment(P(0, 0), P(1, 0))])).toThrow(/closed polyline/);
    expect(() => joinShapes([segment(P(0, 0), P(1, 0)), segment(P(2, 0), P(3, 0))])).toThrow(/do not all meet/);
  });

  it('reversing a chain flips its bulges onto the right edges', () => {
    expect(reverseChain([{ x: 0, y: 0, bulge: 0.5 }, { x: 1, y: 0, bulge: 0 }, { x: 2, y: 0, bulge: 0 }])).toEqual([
      { x: 2, y: 0, bulge: -0 },
      { x: 1, y: 0, bulge: -0.5 },
      { x: 0, y: 0, bulge: 0 },
    ]);
  });
});

describe('paths and positions along them', () => {
  it('a polyline path skips zero-length edges; positions run edge by edge', () => {
    const p = pathOf(polyline([P(0, 0), P(0, 0), P(10, 0), P(10, 10)]));
    expect(p.curves).toHaveLength(2);
    expect(p.points).toEqual([P(0, 0), P(10, 0), P(10, 10)]);
    expect(pathParam(p, P(10, 4))).toBeCloseTo(1.4, 12);
    expect(() => pathOf(polyline([P(1, 1), P(1, 1)]))).toThrow(/no length/);
  });

  it('positions on arcs and circles; points just off an arc go to the nearer end', () => {
    expect(curveParam(circle(P(0, 0), 1), P(0, -1))).toBeCloseTo(0.75, 12);
    const a = arc(P(0, 0), 1, 0, Math.PI / 2);
    expect(curveParam(a, P(0, 1))).toBeCloseTo(1, 12);
    expect(curveParam(a, P(1, -0.001))).toBe(0);
    expect(curveParam(a, P(-0.001, 1))).toBe(1);
    expect(curveParam(arc(P(0, 0), 1, Math.PI / 2, -Math.PI / 2), P(1, 0))).toBeCloseTo(1, 12);
  });
});
