import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createSession,
  execute,
  maxResidual,
  newDocument,
  rectanglePresets,
  redo,
  releasedMessage,
  saveDocument,
  undo,
  type Session,
} from '../../../../src/core/doc';
import { polyline, rectangle, segment, vec, type Polyline } from '../../../../src/core/geom';
import { expectPoint } from '../helpers';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

const V = (id: number, index: number) => ({ kind: 'vertex' as const, id, index });

/** A 100 × 50 rectangle with its corners at (0,0), (100,0), (100,50), (0,50), added with presets. */
function plate(): { session: Session; id: number } {
  const r = execute(createSession(newDocument()), 'entity.add', { geom: rectangle(vec(0, 0), vec(100, 50)), presets: true });
  return { session: r.session, id: r.result.id };
}

function corners(s: Session, id: number): number[][] {
  const g = s.doc.entities.get(id)!.geom as Polyline;
  return g.vertices.map((v) => [v.x, v.y]);
}

function dimension(s: Session, id: number, orient: 'horizontal' | 'vertical', a: number, b: number): Session {
  return run(s, 'note.add', {
    body: { kind: 'linear', orient, a: V(id, a), b: V(id, b), at: { x: 50, y: -10 }, style: 'ISO' },
  });
}

function distanceId(s: Session, axis: 'x' | 'y'): number {
  return [...s.doc.constraints.values()].find((c) => c.body.kind === 'distance' && c.body.axis === axis)!.id;
}

describe('a rectangle added with presets', () => {
  it('holds each side horizontal or vertical, all in one undo step', () => {
    const { session, id } = plate();
    const kinds = [...session.doc.constraints.values()].map((c) => c.body);
    expect(kinds).toEqual([
      { kind: 'horizontal', a: V(id, 0), b: V(id, 1) },
      { kind: 'vertical', a: V(id, 1), b: V(id, 2) },
      { kind: 'horizontal', a: V(id, 2), b: V(id, 3) },
      { kind: 'vertical', a: V(id, 3), b: V(id, 0) },
    ]);
    expect([...session.doc.constraints.keys()]).toEqual([id + 1, id + 2, id + 3, id + 4]);
    expect(session.undoStack).toHaveLength(1);
    expect(corners(session, id)).toEqual([[0, 0], [100, 0], [100, 50], [0, 50]]);

    const undone = undo(session);
    expect(undone.doc.entities.size).toBe(0);
    expect(undone.doc.constraints.size).toBe(0);
    const redone = redo(undone);
    expect(saveDocument(redone.doc)).toBe(saveDocument(session.doc));
  });

  it('is held the same way when the corners are given the other way round', () => {
    // Corners (100,50), (0,50), (0,0), (100,0): the first side still runs along x.
    const body = rectanglePresets(7, rectangle(vec(100, 50), vec(0, 0)));
    expect(body).toEqual([
      { kind: 'horizontal', a: V(7, 0), b: V(7, 1) },
      { kind: 'vertical', a: V(7, 1), b: V(7, 2) },
      { kind: 'horizontal', a: V(7, 2), b: V(7, 3) },
      { kind: 'vertical', a: V(7, 3), b: V(7, 0) },
    ]);
  });

  it('gets no constraints unless asked', () => {
    const r = execute(createSession(newDocument()), 'entity.add', { geom: rectangle(vec(0, 0), vec(100, 50)) });
    expect(r.session.doc.constraints.size).toBe(0);
  });

  it('puts its constraints on the sheet it is drawn on', () => {
    let s = run(createSession(newDocument()), 'sheet.add', { name: 'Layout' });
    s = run(s, 'sheet.setCurrent', { name: 'Layout' });
    s = run(s, 'entity.add', { geom: rectangle(vec(0, 0), vec(10, 5)), presets: true });
    expect([...s.doc.constraints.values()].map((c) => c.sheet)).toEqual(['Layout', 'Layout', 'Layout', 'Layout']);
  });

  it('refuses presets for anything that is not an upright rectangle, and changes nothing', () => {
    const tilted = polyline([vec(0, 0), vec(10, 5), vec(5, 15), vec(-5, 10)], true);
    const rounded = polyline([{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], true);
    const shapes = [
      segment(vec(0, 0), vec(10, 0)),
      polyline([vec(0, 0), vec(10, 0), vec(10, 5), vec(0, 5)], false),
      polyline([vec(0, 0), vec(10, 0), vec(5, 5)], true),
      tilted,
      rounded,
    ];
    const s = createSession(newDocument());
    for (const geom of shapes) {
      expect(() => execute(s, 'entity.add', { geom, presets: true })).toThrow(/upright sides/);
    }
    expect(rectanglePresets(1, shapes[0]!)).toBeNull();
  });

  it('wants presets to be true or false', () => {
    expect(() => execute(createSession(newDocument()), 'entity.add', { geom: rectangle(vec(0, 0), vec(1, 1)), presets: 'yes' } as never)).toThrow(CommandError);
  });
});

describe('typing a new size into a dimension on a rectangle with presets', () => {
  // Each side dimensioned from either end. The corner clicked first stays; the other follows it,
  // and the corners joined to it move with it. Hand-worked from the 100 × 50 plate.
  const cases: readonly {
    readonly side: string;
    readonly orient: 'horizontal' | 'vertical';
    readonly from: number;
    readonly to: number;
    readonly value: number;
    readonly corners: number[][];
  }[] = [
    { side: 'bottom, left to right', orient: 'horizontal', from: 0, to: 1, value: 120, corners: [[0, 0], [120, 0], [120, 50], [0, 50]] },
    { side: 'bottom, right to left', orient: 'horizontal', from: 1, to: 0, value: 120, corners: [[-20, 0], [100, 0], [100, 50], [-20, 50]] },
    { side: 'top, left to right', orient: 'horizontal', from: 3, to: 2, value: 120, corners: [[0, 0], [120, 0], [120, 50], [0, 50]] },
    { side: 'top, right to left', orient: 'horizontal', from: 2, to: 3, value: 120, corners: [[-20, 0], [100, 0], [100, 50], [-20, 50]] },
    { side: 'right, bottom to top', orient: 'vertical', from: 1, to: 2, value: 70, corners: [[0, 0], [100, 0], [100, 70], [0, 70]] },
    { side: 'right, top to bottom', orient: 'vertical', from: 2, to: 1, value: 70, corners: [[0, -20], [100, -20], [100, 50], [0, 50]] },
    { side: 'left, bottom to top', orient: 'vertical', from: 0, to: 3, value: 70, corners: [[0, 0], [100, 0], [100, 70], [0, 70]] },
    { side: 'left, top to bottom', orient: 'vertical', from: 3, to: 0, value: 70, corners: [[0, -20], [100, -20], [100, 50], [0, 50]] },
  ];

  for (const c of cases) {
    it(`works on the ${c.side}, and lands on exact numbers`, () => {
      const { session, id } = plate();
      const dimensioned = dimension(session, id, c.orient, c.from, c.to);
      const next = run(dimensioned, 'constraint.setValue', { id: distanceId(dimensioned, c.orient === 'horizontal' ? 'x' : 'y'), value: c.value });
      expect(corners(next, id)).toEqual(c.corners);
      expect(maxResidual(next.doc)).toBe(0);
      expect(next.doc.constraints.size).toBe(5);
      expect(saveDocument(undo(next).doc)).toBe(saveDocument(dimensioned.doc));
    });
  }

  it('keeps a non-whole size exactly, with no -0 left behind', () => {
    const { session, id } = plate();
    const dimensioned = dimension(session, id, 'horizontal', 1, 0);
    const next = run(dimensioned, 'constraint.setValue', { id: distanceId(dimensioned, 'x'), value: 100.125 });
    expect(corners(next, id)).toEqual([[-0.125, 0], [100, 0], [100, 50], [-0.125, 50]]);
    const zero = dimension(session, id, 'horizontal', 1, 0);
    const wide = run(zero, 'constraint.setValue', { id: distanceId(zero, 'x'), value: 100 });
    expect(Object.is(corners(wide, id)[0]![0], 0)).toBe(true);
  });

  it('takes both the width and the height in turn', () => {
    const { session, id } = plate();
    let s = dimension(session, id, 'horizontal', 0, 1);
    s = dimension(s, id, 'vertical', 1, 2);
    s = run(s, 'constraint.setValue', { id: distanceId(s, 'x'), value: 80 });
    s = run(s, 'constraint.setValue', { id: distanceId(s, 'y'), value: 30 });
    expect(corners(s, id)).toEqual([[0, 0], [80, 0], [80, 30], [0, 30]]);
    expect(maxResidual(s.doc)).toBe(0);
  });
});

describe('a change that makes a preset untrue lets it go instead of refusing', () => {
  it('rounding every corner lets go of all four, and one undo brings them back', () => {
    const { session, id } = plate();
    const r = execute(session, 'polyline.fillet', { id, size: 10 });
    expect(r.released).toBe(4);
    expect(r.session.doc.constraints.size).toBe(0);
    expect((r.session.doc.entities.get(id)!.geom as Polyline).vertices).toHaveLength(8);
    expect(saveDocument(undo(r.session).doc)).toBe(saveDocument(session.doc));
  });

  it('cutting one corner does the same', () => {
    const { session, id } = plate();
    const r = execute(session, 'polyline.chamfer', { id, size: 10, vertices: [2] });
    expect(r.released).toBe(4);
    expect(r.session.doc.constraints.size).toBe(0);
    expect(corners(r.session, id)).toEqual([[0, 0], [100, 0], [100, 40], [90, 50], [0, 50]]);
  });

  it('removes a dimension whose corners were renumbered', () => {
    const { session, id } = plate();
    const dimensioned = dimension(session, id, 'horizontal', 0, 1);
    const r = execute(dimensioned, 'polyline.fillet', { id, size: 10 });
    expect(r.released).toBe(5);
    expect(r.session.doc.constraints.size).toBe(0);
    expect(r.session.doc.notes.size).toBe(0);
  });

  it('exploding the rectangle lets them go', () => {
    const { session, id } = plate();
    const r = execute(session, 'entity.explode', { ids: [id] });
    expect(r.released).toBe(4);
    expect(r.session.doc.constraints.size).toBe(0);
  });

  it('deleting the rectangle is not "letting go"', () => {
    const { session, id } = plate();
    const r = execute(session, 'entity.delete', { ids: [id] });
    expect(r.released).toBe(0);
    expect(r.session.doc.constraints.size).toBe(0);
  });

  it('leaves them alone when nothing was untrue', () => {
    const { session, id } = plate();
    const moved = execute(session, 'entity.transform', { ids: [id], transform: { kind: 'translate', dx: 5, dy: 3 } });
    expect(moved.released).toBe(0);
    expect(moved.session.doc.constraints.size).toBe(4);
    const copy = execute(session, 'entity.offset', { id, distance: 5, toward: { x: 200, y: 200 } });
    expect(copy.released).toBe(0);
    expect(copy.session.doc.constraints.size).toBe(4);
  });

  it('turning it 30° lets go of the four sides and turns the rectangle', () => {
    const { session, id } = plate();
    const r = execute(session, 'entity.transform', { ids: [id], transform: { kind: 'rotate', center: vec(0, 0), angle: Math.PI / 6 } });
    expect(r.released).toBe(4);
    expect(r.session.doc.constraints.size).toBe(0);
    const v = corners(r.session, id);
    const r3 = Math.sqrt(3);
    expectPoint({ x: v[1]![0]!, y: v[1]![1]! }, { x: 50 * r3, y: 50 });
    expectPoint({ x: v[2]![0]!, y: v[2]![1]! }, { x: 50 * r3 - 25, y: 50 + 25 * r3 });
    expectPoint({ x: v[3]![0]!, y: v[3]![1]! }, { x: -25, y: 25 * r3 });
  });

  it('turning it a half turn keeps them, because the sides are still horizontal and vertical', () => {
    const { session, id } = plate();
    const r = execute(session, 'entity.transform', { ids: [id], transform: { kind: 'rotate', center: vec(0, 0), angle: Math.PI } });
    expect(r.released).toBe(0);
    expect(r.session.doc.constraints.size).toBe(4);
  });

  it('turning a dimensioned rectangle a quarter turn keeps its dimension, in brackets, no longer holding anything', () => {
    const { session, id } = plate();
    const dimensioned = dimension(session, id, 'horizontal', 0, 1);
    const note = [...dimensioned.doc.notes.values()][0]!;
    const r = execute(dimensioned, 'entity.transform', { ids: [id], transform: { kind: 'rotate', center: vec(0, 0), angle: Math.PI / 2 } });
    expect(r.released).toBe(5);
    expect(r.session.doc.constraints.size).toBe(0);
    const kept = r.session.doc.notes.get(note.id)!;
    expect(kept.reference).toBe(true);
    expect(kept.drive).toBeUndefined();
    expect(saveDocument(undo(r.session).doc)).toBe(saveDocument(dimensioned.doc));
  });

  it('mirroring across a horizontal line keeps them; across a diagonal lets them go', () => {
    const { session, id } = plate();
    const flat = execute(session, 'entity.transform', { ids: [id], transform: { kind: 'mirror', a: vec(0, 0), b: vec(1, 0) } });
    expect(flat.released).toBe(0);
    expect(corners(flat.session, id)).toEqual([[0, 0], [100, 0], [100, -50], [0, -50]]);
    const diagonal = execute(session, 'entity.transform', { ids: [id], transform: { kind: 'mirror', a: vec(0, 0), b: vec(1, 1) } });
    expect(diagonal.released).toBe(4);
    expect(corners(diagonal.session, id)).toEqual([[0, 0], [0, 100], [50, 100], [50, 0]]);
  });

  it('keeps the constraints a turn leaves true, such as two lines meeting at a corner', () => {
    let s = createSession(newDocument());
    const a = execute(s, 'entity.add', { geom: segment(vec(0, 0), vec(10, 0)) });
    const b = execute(a.session, 'entity.add', { geom: segment(vec(10, 0), vec(10, 5)) });
    s = run(b.session, 'constraint.add', {
      body: { kind: 'coincident', a: { kind: 'end', id: a.result.id, end: 'end' }, b: { kind: 'end', id: b.result.id, end: 'start' } },
    });
    const turned = execute(s, 'entity.transform', { ids: [a.result.id, b.result.id], transform: { kind: 'rotate', center: vec(0, 0), angle: Math.PI / 6 } });
    expect(turned.released).toBe(0);
    expect(turned.session.doc.constraints.size).toBe(1);
    expect(maxResidual(turned.session.doc)).toBeLessThanOrEqual(1e-9);
  });

  it('keeps a constraint that ties a turned shape to one that stayed put, and the other shape follows', () => {
    let s = createSession(newDocument());
    const a = execute(s, 'entity.add', { geom: segment(vec(0, 0), vec(10, 0)) });
    const b = execute(a.session, 'entity.add', { geom: segment(vec(20, 0), vec(30, 5)) });
    s = run(b.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.result.id, end: 'end' }, b: { kind: 'end', id: b.result.id, end: 'start' } },
    });
    const turned = execute(s, 'entity.transform', { ids: [a.result.id], transform: { kind: 'rotate', center: vec(0, 0), angle: Math.PI / 2 } });
    expect(turned.released).toBe(0);
    expect(turned.session.doc.constraints.size).toBe(1);
    const follow = turned.session.doc.entities.get(b.result.id)!.geom;
    expect(follow).toEqual(segment(vec(20, 10), vec(30, 5)));
  });
});

describe('what the person is told when constraints are let go', () => {
  it('says one or many, and that undo brings them back', () => {
    expect(releasedMessage(1)).toBe('Let go of a constraint that this change made untrue. Ctrl+Z brings it back.');
    expect(releasedMessage(4)).toBe('Let go of 4 constraints that this change made untrue. Ctrl+Z brings them back.');
  });
});
