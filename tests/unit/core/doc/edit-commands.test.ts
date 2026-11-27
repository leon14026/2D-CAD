import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createSession,
  execute,
  executeUnchecked,
  MAX_ARRAY_COPIES,
  newDocument,
  type CommandId,
  type Entity,
  type ParamsOf,
  type ResultOf,
  type Session,
} from '../../../../src/core/doc';
import { arcEndPoint, arcStartPoint, circle, polyline, rectangle, segment, type Arc, type Polyline, type Shape, type Vec2 } from '../../../../src/core/geom';
import { expectPoint } from '../helpers';

const P = (x: number, y: number): Vec2 => ({ x, y });

function harness(start: Session = createSession(newDocument())) {
  const h = {
    s: start,
    run<K extends CommandId>(id: K, params: ParamsOf<K>): ResultOf<K> {
      const r = execute(h.s, id, params);
      h.s = r.session;
      return r.result;
    },
    add(geom: Shape): number {
      return h.run('entity.add', { geom }).id;
    },
    geom(id: number): Shape {
      return (h.s.doc.entities.get(id) as Entity).geom;
    },
    fails(id: string, params: unknown, message: RegExp) {
      const before = h.s;
      let error: unknown;
      try {
        executeUnchecked(h.s, id, params);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(CommandError);
      expect((error as Error).message).toMatch(message);
      expect(h.s).toBe(before);
    },
  };
  return h;
}

describe('entity.offset', () => {
  it('adds the offset copy on the same layer, in the same style, drawn on top', () => {
    const h = harness();
    const id = h.add(segment(P(0, 0), P(10, 0)));
    h.run('entity.setProps', { ids: [id], color: '#ff0000' });
    const { id: copy } = h.run('entity.offset', { id, distance: 2, toward: P(5, 9) });
    const e = h.s.doc.entities.get(copy) as Entity;
    expect(e.geom).toEqual(segment(P(0, 2), P(10, 2)));
    expect(e.color).toBe('#ff0000');
    expect(e.z).toBe(copy);
    expect(h.geom(id)).toEqual(segment(P(0, 0), P(10, 0)));
  });

  it('explains refusals', () => {
    const h = harness();
    const id = h.add(circle(P(0, 0), 5));
    h.fails('entity.offset', { id, distance: 0, toward: P(1, 1) }, /distance: must be more than 0/);
    h.fails('entity.offset', { id, distance: 5, toward: P(1, 1) }, /Offset failed: the distance is too large/);
    h.fails('entity.offset', { id: 99, distance: 1, toward: P(1, 1) }, /no entity with id 99/);
  });
});

describe('entity.trim', () => {
  it('cuts back to every other shown entity by default; extra pieces keep the draw order', () => {
    const h = harness();
    const target = h.add(segment(P(0, 0), P(10, 0)));
    h.add(segment(P(3, -5), P(3, 5)));
    h.add(segment(P(7, -5), P(7, 5)));
    h.add(segment(P(500, -5), P(500, 5))); // far away: never a cutting edge here
    const { ids } = h.run('entity.trim', { id: target, pick: P(5, 0) });
    expect(ids).toHaveLength(2);
    expect(h.geom(ids[0]!)).toEqual(segment(P(0, 0), P(3, 0)));
    expect(h.geom(ids[1]!)).toEqual(segment(P(7, 0), P(10, 0)));
    expect((h.s.doc.entities.get(ids[1]!) as Entity).z).toBe(target);
    expect(h.s.undoStack).toHaveLength(5);
  });

  it('uses only the named edges when given, and skips hidden layers otherwise', () => {
    const h = harness();
    const target = h.add(segment(P(0, 0), P(10, 0)));
    const a = h.add(segment(P(3, -5), P(3, 5)));
    h.add(segment(P(7, -5), P(7, 5)));
    h.run('entity.trim', { id: target, pick: P(9, 0), edges: [a, target] });
    expect(h.geom(target)).toEqual(segment(P(0, 0), P(3, 0)));

    const g = harness();
    const t2 = g.add(segment(P(0, 0), P(10, 0)));
    const { id: hidden } = g.run('layer.add', { name: 'Hidden' });
    g.run('entity.add', { geom: segment(P(5, -5), P(5, 5)), layer: hidden });
    g.run('layer.update', { id: hidden, visible: false });
    g.fails('entity.trim', { id: t2, pick: P(8, 0) }, /Nothing crosses this object there/);
  });

  it('explains when there is nothing to trim, or a closed shape is crossed once', () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 5));
    h.add(segment(P(0, 0), P(0, 10)));
    h.fails('entity.trim', { id: c, pick: P(-5, 0) }, /crossed in two places/);
    h.fails('entity.trim', { id: c, pick: P(-5, 0), edges: [77] }, /no entity with id 77/);
    h.fails('entity.trim', { id: c, pick: P(1, 1), edges: [] }, /edges: must list at least one id/);
  });
});

describe('entity.extend', () => {
  it('lengthens the picked end to the nearest boundary', () => {
    const h = harness();
    const id = h.add(segment(P(0, 0), P(5, 0)));
    const wall = h.add(segment(P(10, -5), P(10, 5)));
    h.add(segment(P(20, -5), P(20, 5)));
    h.run('entity.extend', { id, pick: P(4, 0) });
    expect(h.geom(id)).toEqual(segment(P(0, 0), P(10, 0)));
    h.run('entity.extend', { id, pick: P(9, 0), edges: [wall + 1] });
    expect(h.geom(id)).toEqual(segment(P(0, 0), P(20, 0)));
  });

  it('explains closed shapes and empty space ahead', () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 5));
    const l = h.add(segment(P(10, 0), P(20, 0)));
    h.fails('entity.extend', { id: c, pick: P(5, 0) }, /no ends to extend/);
    h.fails('entity.extend', { id: l, pick: P(19, 0) }, /Nothing lies ahead/);
  });
});

describe('entity.fillet and entity.chamfer', () => {
  const corner = () => {
    const h = harness();
    const a = h.add(segment(P(0, 0), P(10, 0)));
    const b = h.add(segment(P(12, 2), P(12, 10)));
    return { h, a, b };
  };

  it('fillets two lines: both cut back, the arc added in the first line’s style', () => {
    const { h, a, b } = corner();
    const { join } = h.run('entity.fillet', { first: { id: a, point: P(5, 0) }, second: { id: b, point: P(12, 6) }, radius: 2 });
    expect(h.geom(a)).toEqual(segment(P(0, 0), P(10, 0)));
    expect(h.geom(b)).toEqual(segment(P(12, 2), P(12, 10)));
    const fillet = h.geom(join!) as Arc;
    expectPoint(fillet.center, P(10, 2));
    expect(h.s.undoStack.at(-1)?.label).toBe('Fillet');
  });

  it('radius 0 meets in a sharp corner with no arc', () => {
    const { h, a, b } = corner();
    expect(h.run('entity.fillet', { first: { id: a, point: P(5, 0) }, second: { id: b, point: P(12, 6) }, radius: 0 })).toEqual({ join: null });
    expect(h.geom(a)).toEqual(segment(P(0, 0), P(12, 0)));
  });

  it('chamfers two lines', () => {
    const { h, a, b } = corner();
    const { join } = h.run('entity.chamfer', { first: { id: a, point: P(5, 0) }, second: { id: b, point: P(12, 6) }, distance1: 2, distance2: 3 });
    expect(h.geom(join!)).toEqual(segment(P(10, 0), P(12, 3)));
    expect(h.run('entity.chamfer', { first: { id: a, point: P(5, 0) }, second: { id: b, point: P(12, 6) }, distance1: 0, distance2: 0 })).toEqual({ join: null });
  });

  it('two neighbouring edges of one polyline: that corner, including the one where a closed polyline wraps', () => {
    const h = harness();
    const id = h.add(rectangle(P(0, 0), P(100, 60)));
    h.run('entity.fillet', { first: { id, point: P(50, 0) }, second: { id, point: P(100, 30) }, radius: 5 });
    expect((h.geom(id) as Polyline).vertices).toHaveLength(5);
    h.run('entity.chamfer', { first: { id, point: P(0, 30) }, second: { id, point: P(50, 0) }, distance1: 4, distance2: 4 });
    const v = (h.geom(id) as Polyline).vertices;
    expect(v).toHaveLength(6);
    expect(v.slice(0, 2).map((p) => [p.x, p.y])).toEqual([
      [0, 4],
      [4, 0],
    ]);
  });

  it('refuses what it can’t do, saying why', () => {
    const { h, a, b } = corner();
    const c = h.add(circle(P(30, 30), 2));
    const pl = h.add(rectangle(P(50, 50), P(60, 60)));
    const pick = (id: number, x: number, y: number) => ({ id, point: P(x, y) });
    h.fails('entity.fillet', { first: pick(a, 5, 0), second: pick(c, 32, 30), radius: 1 }, /two lines, or on two neighbouring straight edges/);
    h.fails('entity.fillet', { first: pick(c, 32, 30), second: pick(c, 28, 30), radius: 1 }, /two lines, or on two neighbouring/);
    h.fails('entity.fillet', { first: pick(pl, 55, 50), second: pick(pl, 55, 60), radius: 1 }, /neighbouring edges of the polyline/);
    h.fails('entity.fillet', { first: pick(pl, 55, 50), second: pick(pl, 60, 55), radius: 0 }, /already sharp/);
    h.fails('entity.chamfer', { first: pick(pl, 55, 50), second: pick(pl, 60, 55), distance1: 1, distance2: 2 }, /same distance along both/);
    h.fails('entity.chamfer', { first: pick(pl, 55, 50), second: pick(pl, 60, 55), distance1: 0, distance2: 0 }, /already sharp/);
    h.fails('entity.fillet', { first: pick(a, 5, 0), second: pick(b, 12, 6), radius: 50 }, /Fillet failed: the radius is too large/);
    h.fails('entity.fillet', { first: pick(a, 5, 0), second: pick(b, 12, 6), radius: -1 }, /radius: must be 0 or more/);
    h.fails('entity.fillet', { first: { id: a }, second: pick(b, 12, 6), radius: 1 }, /first\.point: is missing/);
  });
});

describe('polyline.fillet and polyline.chamfer', () => {
  it('rounds every corner, or the listed ones', () => {
    const h = harness();
    const id = h.add(rectangle(P(0, 0), P(100, 60)));
    h.run('polyline.fillet', { id, size: 5, vertices: [1, 1] });
    expect((h.geom(id) as Polyline).vertices).toHaveLength(5);
    h.run('polyline.chamfer', { id, size: 2 });
    expect((h.geom(id) as Polyline).vertices).toHaveLength(8);
  });

  it('refuses shapes without corners and bad vertex lists', () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 1));
    const id = h.add(rectangle(P(0, 0), P(100, 60)));
    h.fails('polyline.fillet', { id: c, size: 1 }, /Only a polyline has corners/);
    h.fails('polyline.chamfer', { id, size: 1, vertices: [9] }, /vertex 10 is not a corner/);
    h.fails('polyline.fillet', { id, size: 1, vertices: [] }, /must list at least one vertex/);
    h.fails('polyline.fillet', { id, size: 1, vertices: [-1] }, /whole number of 0 or more/);
    h.fails('polyline.fillet', { id, size: 0 }, /size: must be more than 0/);
  });
});

describe('entity.array', () => {
  it('rectangular: columns across, rows up, in one undo step', () => {
    const h = harness();
    const id = h.add(circle(P(20, 20), 4));
    const { ids } = h.run('entity.array', { ids: [id], kind: 'rectangular', columns: 2, rows: 2, dx: 80, dy: 40 });
    expect(ids.map((i) => (h.geom(i) as ReturnType<typeof circle>).center)).toEqual([P(100, 20), P(20, 60), P(100, 60)]);
    expect(h.s.undoStack.at(-1)?.label).toBe('Array');
  });

  it('polar: a full turn shares the copies out; part of a turn ends on its last copy', () => {
    const h = harness();
    const id = h.add(circle(P(60, 62), 1.5));
    const { ids } = h.run('entity.array', { ids: [id], kind: 'polar', count: 4, center: P(60, 40), angle: 360, rotate: true });
    expect(ids.map((i) => (h.geom(i) as ReturnType<typeof circle>).center)).toEqual([P(38, 40), P(60, 18), P(82, 40)]);
    const line = h.add(segment(P(10, 0), P(12, 0)));
    const turned = h.run('entity.array', { ids: [line], kind: 'polar', count: 3, center: P(0, 0), angle: 180, rotate: true }).ids;
    expect(h.geom(turned[1]!)).toEqual(segment(P(-10, 0), P(-12, 0)));
    const moved = h.run('entity.array', { ids: [line], kind: 'polar', count: 2, center: P(0, 0), angle: 180, rotate: false }).ids;
    expect(h.geom(moved[0]!)).toEqual(segment(P(-12, 0), P(-10, 0)));
  });

  it('refuses arrays that make nothing or far too much', () => {
    const h = harness();
    const id = h.add(circle(P(0, 0), 1));
    h.fails('entity.array', { ids: [id], kind: 'rectangular', columns: 1, rows: 1, dx: 1, dy: 1 }, /more than one column or row/);
    h.fails('entity.array', { ids: [id], kind: 'rectangular', columns: 0, rows: 2, dx: 1, dy: 1 }, /columns: must be a whole number of 1 or more/);
    h.fails('entity.array', { ids: [id], kind: 'polar', count: 1, center: P(0, 0), angle: 90, rotate: true }, /count: must be at least 2/);
    h.fails('entity.array', { ids: [id], kind: 'polar', count: 3, center: P(0, 0), angle: 0, rotate: true }, /angle: must be between/);
    h.fails('entity.array', { ids: [id], kind: 'polar', count: 3, center: P(0, 0), angle: 400, rotate: true }, /angle: must be between/);
    h.fails('entity.array', { ids: [id], kind: 'spiral' }, /kind: must be one of/);
    h.fails('entity.array', { ids: [id], kind: 'rectangular', columns: 1000, rows: 101, dx: 1, dy: 1 }, new RegExp(`most one array can make is ${MAX_ARRAY_COPIES}`));
  });
});

describe('entity.join and entity.explode', () => {
  it('joins pieces into one polyline, kept on the first piece; explode takes it apart again', () => {
    const h = harness();
    const a = h.add(segment(P(0, 0), P(10, 0)));
    const b = h.add(segment(P(10, 10), P(10, 0)));
    expect(h.run('entity.join', { ids: [a, b] })).toEqual({ id: a });
    expect(h.s.doc.entities.has(b)).toBe(false);
    expect((h.geom(a) as Polyline).vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const c = h.add(circle(P(50, 50), 1));
    const { ids } = h.run('entity.explode', { ids: [a, c] });
    expect(ids).toHaveLength(2);
    expect(h.geom(ids[0]!)).toEqual(segment(P(0, 0), P(10, 0)));
    expect(h.geom(ids[1]!)).toEqual(segment(P(10, 0), P(10, 10)));
    expect(h.geom(c).kind).toBe('circle');
  });

  it('explains pieces that don’t meet, one piece, and nothing to explode', () => {
    const h = harness();
    const a = h.add(segment(P(0, 0), P(10, 0)));
    const b = h.add(segment(P(20, 0), P(30, 0)));
    const c = h.add(circle(P(50, 50), 1));
    h.fails('entity.join', { ids: [a, b] }, /Join failed: these pieces do not all meet end to end/);
    h.fails('entity.join', { ids: [a] }, /select at least two pieces/);
    h.fails('entity.explode', { ids: [a, c] }, /no polylines or block inserts to explode/);
  });

  it('a joined arc keeps its exact ends', () => {
    const h = harness();
    const a = h.add(segment(P(-10, 0), P(0, 0)));
    const b = h.add(polyline([P(0, 0), { x: 10, y: 0, bulge: 1 }, P(20, 0)]));
    h.run('entity.join', { ids: [b, a] });
    const v = (h.geom(b) as Polyline).vertices;
    expect(v.map((p) => [p.x, p.y])).toEqual([
      [-10, 0],
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expectPoint(arcStartPoint({ kind: 'arc', center: P(15, 0), radius: 5, start: Math.PI, sweep: Math.PI }), P(10, 0));
    expectPoint(arcEndPoint({ kind: 'arc', center: P(15, 0), radius: 5, start: Math.PI, sweep: Math.PI }), P(20, 0));
  });
});

describe('locked layers', () => {
  it('nothing on a locked layer can be modified', () => {
    const h = harness();
    const a = h.add(segment(P(0, 0), P(10, 0)));
    const b = h.add(segment(P(5, -5), P(5, 5)));
    h.run('layer.update', { id: 1, locked: true });
    h.fails('entity.trim', { id: a, pick: P(8, 0) }, /locked/);
    h.fails('entity.offset', { id: a, distance: 1, toward: P(0, 5) }, /locked/);
    h.fails('entity.join', { ids: [a, b] }, /locked/);
    h.fails('entity.array', { ids: [a], kind: 'rectangular', columns: 2, rows: 1, dx: 1, dy: 0 }, /locked/);
  });
});
