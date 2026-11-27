import { describe, expect, it } from 'vitest';
import { createSession, execute, newDocument, type NoteBody, type Session } from '../../../../src/core/doc';
import { circle, rectangle, segment, type Shape, type Vec2 } from '../../../../src/core/geom';
import { boxFromCorners, DocIndex, noteTextContains, pickAt, selectInBox } from '../../../../src/core/spatial';

const P = (x: number, y: number): Vec2 => ({ x, y });

function build() {
  let s: Session = createSession(newDocument());
  const add = (geom: Shape) => {
    const r = execute(s, 'entity.add', { geom });
    s = r.session;
    return r.result.id;
  };
  const note = (body: NoteBody) => {
    const r = execute(s, 'note.add', { body });
    s = r.session;
    return r.result.id;
  };
  const outer = add(rectangle(P(0, 0), P(100, 100)));
  const hole = add(circle(P(50, 50), 10));
  const hatch = note({ kind: 'hatch', loops: [[outer], [hole]], pattern: 'lines', spacing: 5, angle: 0 });
  const wall = add(segment(P(200, 0), P(300, 0)));
  const dim = note({ kind: 'aligned', a: { kind: 'end', id: wall, end: 'start' }, b: { kind: 'end', id: wall, end: 'end' }, at: P(250, -20), style: 'ISO' });
  const text = note({ kind: 'text', at: P(400, 0), height: 10, angle: 0, anchor: 'left', text: 'abcd' });
  return { get doc() { return s.doc; }, run: (id: 'layer.update', params: { id: number; visible?: boolean; locked?: boolean }) => (s = execute(s, id, params).session), outer, hole, hatch, wall, dim, text };
}

describe('selecting and picking notes', () => {
  it('window selects only what lies wholly inside; crossing also takes what it touches', () => {
    const w = build();
    const around = boxFromCorners(P(190, -40), P(310, 10));
    expect(selectInBox(w.doc, around, 'window').sort()).toEqual([w.wall, w.dim].sort());
    const tight = boxFromCorners(P(195, -5), P(305, 5));
    expect(selectInBox(w.doc, tight, 'window')).toEqual([w.wall]);
    expect(selectInBox(w.doc, tight, 'crossing').sort()).toEqual([w.wall, w.dim].sort());
  });

  it('a window across the text selects it; a crossing that only reaches its box does too', () => {
    const w = build();
    expect(selectInBox(w.doc, boxFromCorners(P(395, -5), P(430, 15)), 'window')).toEqual([w.text]);
    expect(selectInBox(w.doc, boxFromCorners(P(395, 5), P(401, 6)), 'crossing')).toEqual([w.text]);
    expect(selectInBox(w.doc, boxFromCorners(P(500, 500), P(510, 510)), 'crossing')).toEqual([]);
  });

  it('a crossing box inside a hatch’s extent takes the hatch even where no line passes', () => {
    const w = build();
    expect(selectInBox(w.doc, boxFromCorners(P(1.1, 2.1), P(1.2, 2.2)), 'crossing')).toContain(w.hatch);
    expect(selectInBox(w.doc, boxFromCorners(P(-10, -10), P(110, 110)), 'window').sort()).toEqual([w.outer, w.hole, w.hatch].sort());
  });

  it('hidden layers are skipped', () => {
    const w = build();
    w.run('layer.update', { id: 1, visible: false });
    expect(selectInBox(w.doc, boxFromCorners(P(-1000, -1000), P(1000, 1000)), 'window')).toEqual([]);
    expect(pickAt(w.doc, P(250, -20), 5)).toBeNull();
    expect(DocIndex.of(w.doc).visibleExtents()).toBeNull();
  });

  it('pick: the dimension line, the text box, the hatch fill and the geometry', () => {
    const w = build();
    expect(pickAt(w.doc, P(250, -20), 2)).toBe(w.dim); // on the dimension line
    expect(pickAt(w.doc, P(401, 3), 1)).toBe(w.text); // inside the text's box
    expect(pickAt(w.doc, P(20, 20), 1)).toBe(w.hatch); // in the hatch, between its lines
    expect(pickAt(w.doc, P(0, 50), 1)).toBe(w.outer); // on the boundary: the shape wins over the hatch under it
    expect(pickAt(w.doc, P(600, 600), 5)).toBeNull();
  });

  it('noteTextContains is true only inside the number, not on the dimension line', () => {
    const w = build();
    expect(noteTextContains(w.doc, w.dim, P(250, -20))).toBe(false);
    expect(noteTextContains(w.doc, w.dim, P(250, -20 + 1 + 1.75))).toBe(true); // textGap + half the 3.5 mm height
    expect(noteTextContains(w.doc, w.text, P(401, 3))).toBe(true);
    expect(noteTextContains(w.doc, w.hatch, P(20, 20))).toBe(false);
    expect(noteTextContains(w.doc, 999_999, P(0, 0))).toBe(false);
  });

  it('inside an island the hatch is not picked by its fill, only by its lines', () => {
    const w = build();
    expect(pickAt(w.doc, P(50, 50), 1)).toBeNull();
    expect(pickAt(w.doc, P(50, 60), 1)).not.toBeNull(); // the island's edge
  });

  it('extents include notes', () => {
    const w = build();
    const b = DocIndex.of(w.doc).visibleExtents()!;
    expect(b.minX).toBe(0);
    expect(b.maxX).toBeGreaterThan(400); // the text
    expect(b.minY).toBeLessThan(-20); // the dimension line and its text
  });

  it('a note that no longer resolves is never found', () => {
    const w = build();
    const broken = { ...w.doc, entities: new Map([...w.doc.entities].filter(([id]) => id !== w.wall)) };
    expect(selectInBox(broken, boxFromCorners(P(190, -40), P(310, 10)), 'window')).toEqual([]);
    expect(pickAt(broken, P(250, -20), 2)).toBeNull();
    expect(noteTextContains(broken, w.dim, P(250, -17.25))).toBe(false);
    expect(DocIndex.of(broken).visibleExtents()).not.toBeNull();
  });
});
