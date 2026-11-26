import { describe, expect, it } from 'vitest';
import { createSession, execute, newDocument, type CommandId, type Doc, type ParamsOf, type Session } from '../../../../src/core/doc';
import { arc, circle, polyline, segment, vec } from '../../../../src/core/geom';
import {
  boxContains,
  boxesTouch,
  boxFromCorners,
  DocIndex,
  entityBounds,
  isSelectable,
  PackedRTree,
  pickAt,
  selectInBox,
  shapeTouchesBox,
} from '../../../../src/core/spatial';

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

describe('PackedRTree', () => {
  it('empty tree finds nothing and has no bounds', () => {
    const t = PackedRTree.build([]);
    expect(t.size).toBe(0);
    expect(t.bounds).toBeNull();
    expect(t.search(box(-1e9, -1e9, 1e9, 1e9))).toEqual([]);
  });

  it('rejects a bad node size', () => {
    expect(() => PackedRTree.build([], 1)).toThrow(RangeError);
    expect(() => PackedRTree.build([], 2.5)).toThrow(RangeError);
  });

  it('touching edges count; leaves never over-report', () => {
    const t = PackedRTree.build([
      { id: 1, box: box(0, 0, 1, 1) },
      { id: 2, box: box(5, 5, 6, 6) },
    ]);
    expect(t.search(box(1, 1, 2, 2))).toEqual([1]);
    expect(t.search(box(2, 2, 4, 4))).toEqual([]);
    expect(t.bounds).toEqual(box(0, 0, 6, 6));
  });

  it('a 100 × 100 grid of unit squares: a query returns exactly the squares it touches', () => {
    const items = [];
    for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++) items.push({ id: i * 100 + j, box: box(i * 2, j * 2, i * 2 + 1, j * 2 + 1) });
    const t = PackedRTree.build(items, 8);
    expect(t.size).toBe(10_000);
    // Square (i, j) spans x 2i..2i+1, y 2j..2j+1. x 10.5..20.5 touches columns 5..10 (edges count).
    // y 3.2..3.5 falls in the gap between rows 1 and 2; y 2.5..2.9 touches row 1 only.
    expect(t.search(box(10.5, 3.2, 20.5, 3.5))).toEqual([]);
    expect(t.search(box(10.5, 2.5, 20.5, 2.9)).sort((a, b) => a - b)).toEqual([501, 601, 701, 801, 901, 1001]);
    // A box edge exactly on a square's edge touches it: y = 3 is the top of row 1.
    expect(t.search(box(10.5, 3, 10.6, 3.5))).toEqual([501]);
  });

  it('boxesTouch', () => {
    expect(boxesTouch(box(0, 0, 1, 1), box(1, 1, 2, 2))).toBe(true);
    expect(boxesTouch(box(0, 0, 1, 1), box(1.1, 0, 2, 1))).toBe(false);
  });
});

/** A small drawing with one of everything, plus hidden and locked layers. */
function sample(): { doc: Doc; ids: Record<string, number> } {
  let s: Session = createSession(newDocument());
  const run = <K extends CommandId>(id: K, params: ParamsOf<K>) => {
    const r = execute(s, id, params);
    s = r.session;
    return r.result as { id: number };
  };
  const ids = {
    line: run('entity.add', { geom: segment(vec(0, 0), vec(10, 0)) }).id,
    circle: run('entity.add', { geom: circle(vec(20, 20), 5) }).id,
    arc: run('entity.add', { geom: arc(vec(40, 0), 5, 0, Math.PI) }).id,
    diagonal: run('entity.add', { geom: segment(vec(0, 10), vec(10, 20)) }).id,
    square: run('entity.add', {
      geom: polyline([{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }], true),
    }).id,
    overlapLow: run('entity.add', { geom: segment(vec(0, 30), vec(10, 30)) }).id,
    overlapHigh: run('entity.add', { geom: segment(vec(0, 30), vec(10, 30)) }).id,
  };
  const hidden = run('layer.add', { name: 'Hidden' }).id;
  const locked = run('layer.add', { name: 'Locked' }).id;
  const onHidden = run('entity.add', { layer: hidden, geom: segment(vec(0, -5), vec(10, -5)) }).id;
  const onLocked = run('entity.add', { layer: locked, geom: segment(vec(0, -6), vec(10, -6)) }).id;
  run('layer.update', { id: hidden, visible: false });
  run('layer.update', { id: locked, locked: true });
  return { doc: s.doc, ids: { ...ids, onHidden, onLocked } };
}

describe('selection', () => {
  const { doc, ids } = sample();

  it('hidden and locked layers are not selectable', () => {
    expect(isSelectable(doc, doc.entities.get(ids['line']!)!)).toBe(true);
    expect(isSelectable(doc, doc.entities.get(ids['onHidden']!)!)).toBe(false);
    expect(isSelectable(doc, doc.entities.get(ids['onLocked']!)!)).toBe(false);
  });

  it.each([
    ['line fully inside', box(-1, -1, 11, 1), ['line']],
    ['circle fully inside', box(14, 14, 26, 26), ['circle']],
    ['box exactly on the circle bounds', box(15, 15, 25, 25), ['circle']],
    ['box inside the circle', box(16, 16, 24, 24), []],
    ['half the line', box(-1, -1, 5, 1), []],
    ['hidden and locked lines inside, plus the line', box(-1, -7, 11, 1), ['line']],
    // Regression (property test): a box edge within tolerance of a shape still counts.
    ['a zero-height box a hair below the line', box(-1, -5e-324, 11, -5e-324), ['line']],
    ['everything', box(-100, -100, 100, 100), ['line', 'circle', 'arc', 'diagonal', 'square', 'overlapLow', 'overlapHigh']],
  ])('window: %s', (_name, b, expected) => {
    expect(selectInBox(doc, b, 'window')).toEqual(expected.map((k) => ids[k]));
  });

  it.each([
    // Corners of a 17–23 box are √18 ≈ 4.24 from the centre: inside the radius-5 circle.
    ['inside a circle without touching it', box(17, 17, 23, 23), []],
    // Corners of a 16–24 box are √32 ≈ 5.66 out: the circle crosses the box edges.
    ['a box whose corners poke outside the circle', box(16, 16, 24, 24), ['circle']],
    ['touching the circle’s right side', box(23, 18, 30, 22), ['circle']],
    ['inside the diagonal’s bounds but clear of the line', box(6, 12, 7, 13), []],
    ['touching the diagonal at a corner of the box', box(4, 13, 5, 14), ['diagonal']],
    ['inside the arc’s bounds but under the curve', box(44, 4, 50, 10), []],
    ['over the top of the arc', box(39, 4, 41, 10), ['arc']],
    ['inside the square outline', box(55, 55, 56, 56), []],
    ['across the square’s top edge', box(55, 59, 56, 61), ['square']],
    ['part of the line', box(-1, -1, 5, 1), ['line']],
    ['a zero-width box across the line', box(5, -1, 5, 1), ['line']],
    ['hidden and locked lines only', box(-1, -7, 11, -4), []],
  ])('crossing: %s', (_name, b, expected) => {
    expect(selectInBox(doc, b, 'crossing')).toEqual(expected.map((k) => ids[k]));
  });

  it.each([
    ['on the line', vec(5, 0.5), 1, 'line'],
    ['near the circle', vec(25.5, 20), 1, 'circle'],
    ['at the circle centre (5 away)', vec(20, 20), 1, null],
    ['two identical lines: the one on top', vec(5, 30), 1, 'overlapHigh'],
    // (5, 25) is 5 from the two lines at y = 30 and about 10.8 from the circle: the top line wins.
    ['nearest of several', vec(5, 25), 6, 'overlapHigh'],
    ['on a hidden line', vec(5, -5), 0.4, null],
    ['on a locked line', vec(5, -6), 0.4, null],
    ['on the arc top', vec(40, 5.2), 0.5, 'arc'],
  ])('pick %s', (_name, p, r, expected) => {
    expect(pickAt(doc, p, r)).toBe(expected ? ids[expected] : null);
  });

  it('boxFromCorners and boxContains', () => {
    expect(boxFromCorners(vec(5, 1), vec(-2, 3))).toEqual(box(-2, 1, 5, 3));
    expect(boxContains(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(true);
    expect(boxContains(box(0, 0, 10, 10), box(0, 0, 10.1, 10))).toBe(false);
    expect(boxContains(box(0, 0, 10, 10), box(0, 0, 10.1, 10), 0.2)).toBe(true);
  });

  it('shapeTouchesBox rejects shapes whose bounds miss the box in x or in y', () => {
    const s = segment(vec(0, 0), vec(10, 0));
    const b = entityBounds({ ...doc.entities.get(ids['line']!)!, geom: s });
    expect(shapeTouchesBox(s, box(0, 5, 10, 6), b)).toBe(false);
    expect(shapeTouchesBox(s, box(11, -1, 12, 1), b)).toBe(false);
    expect(shapeTouchesBox(s, box(-3, -1, -2, 1), b)).toBe(false);
    expect(shapeTouchesBox(s, box(9, -1, 12, 1), b)).toBe(true);
  });
});

describe('DocIndex', () => {
  it('is built once per document and caches bounds per shape', () => {
    const { doc, ids } = sample();
    expect(DocIndex.of(doc)).toBe(DocIndex.of(doc));
    const e = doc.entities.get(ids['circle']!)!;
    expect(entityBounds(e)).toBe(entityBounds({ ...e, color: '#ff0000' }));
  });

  it('visible extents skip hidden layers; empty drawings have none', () => {
    const { doc } = sample();
    expect(DocIndex.of(doc).visibleExtents()).toEqual(box(0, -6, 60, 60));
    expect(DocIndex.of(newDocument()).visibleExtents()).toBeNull();
  });

  it('bounds cover every entity, hidden ones included', () => {
    const { doc } = sample();
    const all = DocIndex.of(doc).bounds;
    const visible = DocIndex.of(doc).visibleExtents();
    expect(all).not.toBeNull();
    expect(all!.minX <= visible!.minX && all!.minY <= visible!.minY && all!.maxX >= visible!.maxX && all!.maxY >= visible!.maxY).toBe(true);
    expect(DocIndex.of(newDocument()).bounds).toBeNull();
  });
});
