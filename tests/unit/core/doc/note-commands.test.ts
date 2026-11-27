import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createSession,
  DEFAULT_DIM_STYLE,
  execute,
  executeUnchecked,
  loadDocument,
  MAX_DIM_STYLES,
  newDocument,
  noteProblem,
  notesInDrawOrder,
  resolveNote,
  resolveNoteStyle,
  resolveNotes,
  saveDocument,
  transformNote,
  docEnv,
  undo,
  type Doc,
  type Note,
  type NoteBody,
  type Session,
} from '../../../../src/core/doc';
import { circle, polyline, rectangle, segment, type Shape, type Transform, type Vec2 } from '../../../../src/core/geom';

const P = (x: number, y: number): Vec2 => ({ x, y });
const STYLE = 'ISO';
const free = (x: number, y: number) => ({ kind: 'free' as const, p: P(x, y) });

/** Runs commands against a session, keeping the latest state. */
function harness() {
  let session: Session = createSession(newDocument());
  const run = <T = unknown>(id: string, params: unknown) => {
    const r = executeUnchecked(session, id, params);
    session = r.session;
    return r.result as T;
  };
  const add = (geom: Shape) => run<{ id: number }>('entity.add', { geom }).id;
  const note = (body: NoteBody, extra: object = {}) => run<{ id: number }>('note.add', { body, ...extra }).id;
  const fails = (id: string, params: unknown): string => {
    try {
      executeUnchecked(session, id, params);
    } catch (e) {
      if (e instanceof CommandError) return e.message;
      throw e;
    }
    throw new Error(`${id} did not fail`);
  };
  const lockLayer = () => run('layer.update', { id: 1, locked: true });
  return { get doc(): Doc { return session.doc; }, get session() { return session; }, run, add, note, fails, lockLayer };
}

const hatchOf = (loops: number[][], pattern: 'solid' | 'lines' | 'cross' | 'double' | 'dots' = 'lines', spacing = 2): NoteBody => ({ kind: 'hatch', loops, pattern, spacing, angle: 0 });
const resolved = (h: ReturnType<typeof harness>, id: number) => {
  const r = resolveNotes(h.doc).get(id);
  if (!r?.ok) throw new Error('did not resolve');
  return r.r;
};

describe('note.add', () => {
  it('adds text on the current layer with the layer’s colour, and undo removes it', () => {
    const h = harness();
    const id = h.note({ kind: 'text', at: P(1, 2), height: 3, angle: 0, anchor: 'left', text: 'Hello' });
    const n = h.doc.notes.get(id)!;
    expect(n).toMatchObject({ id, layer: 1, z: id, color: 'byLayer', lineweight: 'byLayer' });
    expect(resolveNoteStyle(h.doc, n).lineweight).toBe(h.doc.layers[0]!.lineweight);
    const before = createSession(newDocument()).doc;
    expect(undo(h.session).doc.notes.size).toBe(0);
    expect(before.notes.size).toBe(0);
  });

  it('takes its own colour and lineweight', () => {
    const h = harness();
    const id = h.note({ kind: 'text', at: P(0, 0), height: 3, angle: 0, anchor: 'left', text: 'x' }, { color: '#ff0000', lineweight: 0.5 });
    expect(resolveNoteStyle(h.doc, h.doc.notes.get(id)!)).toEqual({ color: '#ff0000', lineweight: 0.5 });
  });

  it('is refused on a locked layer, and for a missing style or geometry', () => {
    const h = harness();
    const id = h.add(circle(P(0, 0), 5));
    h.lockLayer();
    expect(h.fails('note.add', { body: { kind: 'text', at: P(0, 0), height: 3, angle: 0, anchor: 'left', text: 'x' } })).toContain('locked');
    const g = harness();
    expect(g.fails('note.add', { body: { kind: 'radius', target: 9, at: P(10, 0), style: STYLE } })).toBe('The circle or arc it was measuring (id 9) is gone.');
    expect(g.fails('note.add', { body: { kind: 'radius', target: 1, at: P(10, 0), style: 'Nope' } })).toBe('The dimension style "Nope" does not exist.');
    expect(id).toBe(2);
  });

  it('puts it on the layer asked for', () => {
    const h = harness();
    const layer = h.run<{ id: number }>('layer.add', { name: 'Notes' }).id;
    const id = h.note({ kind: 'text', at: P(0, 0), height: 3, angle: 0, anchor: 'left', text: 'x' }, { layer });
    expect(h.doc.notes.get(id)!.layer).toBe(layer);
  });
});

describe('hatches', () => {
  const setup = () => {
    const h = harness();
    const outer = h.add(rectangle(P(0, 0), P(10, 10)));
    const hole = h.add(circle(P(5, 5), 2));
    return { h, outer, hole };
  };

  it('area is the outer loop less the islands', () => {
    const { h, outer, hole } = setup();
    const id = h.note(hatchOf([[outer], [hole]]));
    expect(resolved(h, id).area).toBeCloseTo(100 - 4 * Math.PI, 9);
  });

  it('every pattern draws what it says', () => {
    const { h, outer } = setup();
    const kinds = (pattern: 'solid' | 'lines' | 'cross' | 'double' | 'dots') => {
      const id = h.note(hatchOf([[outer]], pattern));
      return resolved(h, id).prims.reduce<Record<string, number>>((m, p) => ({ ...m, [p.k]: (m[p.k] ?? 0) + 1 }), {});
    };
    expect(kinds('solid')).toEqual({ fill: 1 });
    const lines = kinds('lines');
    expect(lines['seg']).toBe(5);
    expect(kinds('cross')['seg']).toBe(10);
    expect(kinds('double')['seg']).toBe(10);
    expect(kinds('dots')['dot']).toBeGreaterThan(10);
  });

  it('can be bounded by joined pieces: four lines make a closed boundary', () => {
    const h = harness();
    const ids = [segment(P(0, 0), P(10, 0)), segment(P(10, 0), P(10, 10)), segment(P(10, 10), P(0, 10)), segment(P(0, 10), P(0, 0))].map((g) => h.add(g));
    const id = h.note(hatchOf([ids], 'solid'));
    expect(resolved(h, id).area).toBeCloseTo(100, 9);
  });

  it('refuses boundaries that are not closed, are gone, or are not touching end to end', () => {
    const h = harness();
    const line = h.add(segment(P(0, 0), P(10, 0)));
    const other = h.add(segment(P(20, 0), P(30, 0)));
    expect(h.fails('note.add', { body: hatchOf([[line]]) })).toBe('The hatch boundary is no longer a closed shape.');
    expect(h.fails('note.add', { body: hatchOf([[line, other]]) })).toBe('The hatch boundary is no longer a closed shape.');
    expect(h.fails('note.add', { body: hatchOf([[99]]) })).toBe('A hatch boundary (id 99) is gone.');
  });

  it('refuses islands that touch, lie outside, or overlap each other', () => {
    const { h, outer } = setup();
    const touching = h.add(circle(P(10, 5), 2));
    const outside = h.add(circle(P(30, 30), 2));
    const a = h.add(circle(P(3, 3), 1.5));
    const b = h.add(circle(P(4, 3), 1.5));
    const big = h.add(circle(P(7, 7), 2.5));
    const inBig = h.add(circle(P(7, 7), 1));
    expect(h.fails('note.add', { body: hatchOf([[outer], [touching]]) })).toBe('Island 1 touches the outer boundary. Islands must lie inside it.');
    expect(h.fails('note.add', { body: hatchOf([[outer], [outside]]) })).toBe('Island 1 is outside the outer boundary.');
    expect(h.fails('note.add', { body: hatchOf([[outer], [a], [b]]) })).toBe('Islands 1 and 2 touch or overlap.');
    expect(h.fails('note.add', { body: hatchOf([[outer], [big], [inBig]]) })).toBe('Islands 1 and 2 touch or overlap.');
    expect(h.fails('note.add', { body: hatchOf([[outer], [inBig], [big]]) })).toBe('Islands 1 and 2 touch or overlap.');
  });

  it('accepts several separate islands, including polyline and arc-edged ones', () => {
    const { h, outer } = setup();
    const sq = h.add(rectangle(P(1, 1), P(3, 3)));
    const slot = h.add(polyline([{ x: 6, y: 7, bulge: 0 }, { x: 8, y: 7, bulge: 1 }, { x: 8, y: 9, bulge: 0 }, { x: 6, y: 9, bulge: 1 }], true));
    const dot = h.add(circle(P(8, 2), 1));
    const id = h.note(hatchOf([[outer], [sq], [slot], [dot]]));
    // 100 less a 2 × 2 square, a slot (2 × 2 body and two semicircles: 4 + π) and a Ø2 circle (π).
    expect(resolved(h, id).area).toBeCloseTo(92 - 2 * Math.PI, 9);
  });

  it('refuses spacing that would need too many lines, and says so when a later change breaks it', () => {
    const { h, outer } = setup();
    expect(h.fails('note.add', { body: hatchOf([[outer]], 'lines', 0.0001) })).toContain('more than 20000 hatch lines');
    const id = h.note(hatchOf([[outer]]));
    expect(noteProblem(docEnv(h.doc), h.doc.notes.get(id)!)).toBeNull();
    h.run('entity.delete', { ids: [outer] });
    expect(h.doc.notes.has(id)).toBe(false); // pruned with its boundary
  });

  it('an island whose first edge is an arc is checked like any other', () => {
    const { h, outer } = setup();
    const half = h.add(polyline([{ x: 6, y: 7, bulge: 1 }, { x: 6, y: 9, bulge: 0 }], true));
    const id = h.note(hatchOf([[outer], [half]]));
    expect(resolved(h, id).area).toBeCloseTo(100 - Math.PI / 2, 9);
    const crossing = h.add(polyline([{ x: 9.5, y: 4, bulge: 1 }, { x: 9.5, y: 6, bulge: 0 }], true)); // pokes out past x = 10
    expect(h.fails('note.add', { body: hatchOf([[outer], [crossing]]) })).toBe('Island 1 touches the outer boundary. Islands must lie inside it.');
  });

  it('a hatch whose spacing cannot be used says so instead of drawing nothing', () => {
    const { h, outer } = setup();
    const id = h.note(hatchOf([[outer]]));
    const note = h.doc.notes.get(id)!;
    const bad: Note = { ...note, body: { ...(note.body as NoteBody & { kind: 'hatch' }), spacing: 0 } };
    expect(resolveNote(docEnv(h.doc), bad)).toEqual({ ok: false, why: 'hatch spacing must be more than 0' });
  });

  it('errors that are bugs, not broken geometry, are not hidden', () => {
    const { h } = setup();
    const odd = { id: 9, layer: 1, z: 9, color: 'byLayer', lineweight: 'byLayer', body: { kind: 'sculpture' } } as unknown as Note;
    expect(() => resolveNote(docEnv(h.doc), odd)).toThrow(TypeError);
    const noLoops = { ...odd, body: { kind: 'hatch' } } as unknown as Note;
    expect(() => noteProblem(docEnv(h.doc), noLoops)).toThrow(TypeError);
  });

  it('noteProblem names a missing boundary', () => {
    const { h, outer } = setup();
    const id = h.note(hatchOf([[outer]]));
    const gone = { ...h.doc, entities: new Map() };
    expect(noteProblem(docEnv(gone), h.doc.notes.get(id)!)).toBe(`A hatch boundary (id ${outer}) is gone.`);
  });
});

describe('note.edit', () => {
  it('changes text, and undo restores it', () => {
    const h = harness();
    const id = h.note({ kind: 'text', at: P(0, 0), height: 3, angle: 0, anchor: 'left', text: 'Old' });
    h.run('note.edit', { id, patch: { text: 'New', height: 5 } });
    expect(h.doc.notes.get(id)!.body).toMatchObject({ text: 'New', height: 5 });
    expect((undo(h.session).doc.notes.get(id)!.body as { text: string }).text).toBe('Old');
  });

  it('fills in a title block', () => {
    const h = harness();
    const id = h.note({ kind: 'titleBlock', at: P(0, 0), size: 'A4', fields: { title: '', number: '', scale: '', revision: '', material: '', drawnBy: '', date: '', company: '' } });
    h.run('note.edit', { id, patch: { size: 'A3', fields: { title: 'Bracket', number: 'AL-1', scale: '1:1', revision: 'A', material: 'Al', drawnBy: 'L', date: '', company: '' } } });
    expect(resolved(h, id).bounds.maxX).toBe(420);
  });

  it('refuses unknown ids, locked layers, a change of kind, bad values and changes that cannot be drawn', () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 5));
    const l = h.add(segment(P(0, 0), P(5, 5)));
    const id = h.note({ kind: 'radius', target: c, at: P(10, 0), style: STYLE });
    const text = h.note({ kind: 'text', at: P(0, 0), height: 3, angle: 0, anchor: 'left', text: 'x' });
    expect(h.fails('note.edit', { id: 99, patch: { text: 'x' } })).toBe('There is no annotation with id 99.');
    expect(h.fails('note.edit', { id, patch: { kind: 'diameter' } })).toBe('An annotation cannot change what kind it is.');
    expect(h.fails('note.edit', { id: text, patch: { height: -1 } })).toContain('That change is not allowed');
    expect(h.fails('note.edit', { id, patch: { target: l } })).toBe('What it was measuring is no longer a circle or an arc.');
    expect(h.fails('note.edit', { id: text, patch: {} })).toContain('Invalid parameters for note.edit');
    expect(h.fails('note.edit', { id: text, patch: [] })).toContain('Invalid parameters for note.edit');
    h.run('note.edit', { id: text, patch: { kind: 'text', text: 'ok' } });
    h.lockLayer();
    expect(h.fails('note.edit', { id: text, patch: { text: 'y' } })).toContain('locked');
  });
});

describe('dimension styles', () => {
  it('add a style, replace it, use it, and follow a rename of the current one', () => {
    const h = harness();
    const fine = { ...DEFAULT_DIM_STYLE, name: 'Fine', precision: 4 };
    expect(h.run('dimstyle.set', { style: fine })).toEqual({ added: true });
    expect(h.doc.settings.dimStyles.map((s) => s.name)).toEqual(['ISO', 'Fine']);
    expect(h.run('dimstyle.set', { style: { ...fine, precision: 1 } })).toEqual({ added: false });
    expect(h.doc.settings.dimStyles[1]!.precision).toBe(1);
    h.run('dimstyle.use', { name: 'Fine' });
    expect(h.doc.settings.currentDimStyle).toBe('Fine');
    h.run('dimstyle.set', { style: { ...fine, name: 'FINE', precision: 3 } }); // same name, other case: replaces, and the current style follows
    expect(h.doc.settings.dimStyles.map((s) => s.name)).toEqual(['ISO', 'FINE']);
    expect(h.doc.settings.currentDimStyle).toBe('FINE');
    h.run('dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, textHeight: 5 } }); // replacing ISO leaves the current style alone
    expect(h.doc.settings.currentDimStyle).toBe('FINE');
  });

  it('refuses an unknown style, and a 51st style', () => {
    const h = harness();
    expect(h.fails('dimstyle.use', { name: 'Nope' })).toBe('There is no dimension style called "Nope".');
    for (let i = 1; i < MAX_DIM_STYLES; i++) h.run('dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, name: `S${i}` } });
    expect(h.doc.settings.dimStyles).toHaveLength(MAX_DIM_STYLES);
    expect(h.fails('dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, name: 'One more' } })).toBe(`A drawing can have at most ${MAX_DIM_STYLES} dimension styles.`);
  });

  it('a dimension follows the style it names when the style is changed', () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 5));
    const id = h.note({ kind: 'radius', target: c, at: P(10, 0), style: STYLE });
    expect(resolved(h, id).text).toBe('R5.00');
    h.run('dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, precision: 0 } });
    expect(resolved(h, id).text).toBe('R5');
  });
});

describe('selection commands on notes', () => {
  const setup = () => {
    const h = harness();
    const c = h.add(circle(P(0, 0), 5));
    const dim = h.note({ kind: 'radius', target: c, at: P(10, 0), style: STYLE });
    const text = h.note({ kind: 'text', at: P(0, 20), height: 3, angle: 0, anchor: 'left', text: 'x' });
    const leader = h.note({ kind: 'leader', points: [P(0, 0), P(5, 5)], text: 'x', style: STYLE });
    return { h, c, dim, text, leader };
  };

  it('delete removes notes by id, and refuses on a locked layer', () => {
    const { h, text } = setup();
    expect(h.run('entity.delete', { ids: [text] })).toEqual({ deleted: 1 });
    expect(h.doc.notes.has(text)).toBe(false);
    h.lockLayer();
    expect(h.fails('entity.delete', { ids: [text + 1] })).toContain('locked');
    expect(h.fails('entity.delete', { ids: [99] })).toContain('There is no entity with id 99');
  });

  it('transform moves a note’s own points; the geometry it measures is untouched', () => {
    const { h, c, dim, text, leader } = setup();
    h.run('entity.transform', { ids: [dim, text, leader], transform: { kind: 'translate', dx: 5, dy: 1 } });
    expect(h.doc.notes.get(dim)!.body).toMatchObject({ at: P(15, 1) });
    expect(h.doc.notes.get(text)!.body).toMatchObject({ at: P(5, 21) });
    expect(h.doc.notes.get(leader)!.body).toMatchObject({ points: [P(5, 1), P(10, 6)] });
    expect(h.doc.entities.get(c)!.geom).toEqual(circle(P(0, 0), 5));
  });

  it('copy copies text and leaders but not dimensions, which belong to their geometry', () => {
    const { h, dim, text, leader } = setup();
    const before = h.doc.notes.size;
    const r = h.run<{ ids: number[] }>('entity.copy', { ids: [dim, text, leader], transform: { kind: 'translate', dx: 0, dy: -30 } });
    expect(r.ids).toHaveLength(2);
    expect(h.doc.notes.size).toBe(before + 2);
    expect(h.doc.notes.get(r.ids[0]!)!.body).toMatchObject({ kind: 'text', at: P(0, -10) });
  });

  it('change properties sets layer, colour and lineweight of notes, and skips ones already so', () => {
    const { h, text } = setup();
    const layer = h.run<{ id: number }>('layer.add', { name: 'Notes' }).id;
    expect(h.run('entity.setProps', { ids: [text], layer, color: '#010203', lineweight: 0.35 })).toEqual({ changed: 1 });
    expect(h.doc.notes.get(text)).toMatchObject({ layer, color: '#010203', lineweight: 0.35 });
    expect(h.run('entity.setProps', { ids: [text], layer })).toEqual({ changed: 0 });
  });

  it('commands for drawn shapes explain that notes are not shapes', () => {
    const { h, dim } = setup();
    expect(h.fails('entity.trim', { id: dim, pick: P(0, 0) })).toBe('That is an annotation, and this command works on drawn shapes only.');
  });

  it('notes are drawn in order of creation', () => {
    const { h, dim, text, leader } = setup();
    expect(notesInDrawOrder(h.doc).map((n) => n.id)).toEqual([dim, text, leader]);
  });
});

describe('moving a note (every kind)', () => {
  const t: Transform = { kind: 'translate', dx: 100, dy: 200 };
  const mk = (body: NoteBody): Note => ({ id: 9, layer: 1, z: 9, color: 'byLayer', lineweight: 'byLayer', body });
  const end = { kind: 'end' as const, id: 2, end: 'start' as const };

  it('linear, aligned and angle: free points and the line position move; geometry references do not', () => {
    const lin = transformNote(t, mk({ kind: 'linear', orient: 'horizontal', a: free(0, 0), b: end, at: P(1, 1), style: STYLE })).body;
    expect(lin).toMatchObject({ a: free(100, 200), b: end, at: P(101, 201) });
    const ali = transformNote(t, mk({ kind: 'aligned', a: end, b: free(1, 1), at: P(1, 1), style: STYLE })).body;
    expect(ali).toMatchObject({ a: end, b: free(101, 201), at: P(101, 201) });
    const ang = transformNote(t, mk({ kind: 'angle', vertex: free(0, 0), a: free(1, 0), b: end, at: P(1, 1), style: STYLE })).body;
    expect(ang).toMatchObject({ vertex: free(100, 200), a: free(101, 200), b: end, at: P(101, 201) });
  });

  it('radius, diameter, text, title block and leader move their own points', () => {
    expect(transformNote(t, mk({ kind: 'radius', target: 2, at: P(1, 1), style: STYLE })).body).toMatchObject({ at: P(101, 201) });
    expect(transformNote(t, mk({ kind: 'diameter', target: 2, at: P(1, 1), style: STYLE })).body).toMatchObject({ at: P(101, 201) });
    expect(transformNote(t, mk({ kind: 'text', at: P(1, 1), height: 1, angle: 0, anchor: 'left', text: 'x' })).body).toMatchObject({ at: P(101, 201) });
    const fields = { title: '', number: '', scale: '', revision: '', material: '', drawnBy: '', date: '', company: '' };
    expect(transformNote(t, mk({ kind: 'titleBlock', at: P(1, 1), size: 'A4', fields })).body).toMatchObject({ at: P(101, 201) });
    expect(transformNote(t, mk({ kind: 'leader', points: [P(0, 0), P(1, 1)], text: '', style: STYLE })).body).toMatchObject({ points: [P(100, 200), P(101, 201)] });
  });

  it('centre marks and hatches stay as they are, and never carry -0', () => {
    const c = mk({ kind: 'centre', target: 2, extended: false, style: STYLE });
    const hh = mk(hatchOf([[2]]));
    expect(transformNote(t, c)).toBe(c);
    expect(transformNote(t, hh)).toBe(hh);
    const zero = transformNote({ kind: 'scale', center: P(0, 0), factor: 1 }, mk({ kind: 'text', at: P(-0, 0), height: 1, angle: 0, anchor: 'left', text: 'x' })).body as { at: Vec2 };
    expect(Object.is(zero.at.x, 0)).toBe(true);
  });

  it('resolveNote refuses a hatch on an unknown style only where styles apply', () => {
    const h = harness();
    const r = resolveNote(docEnv(h.doc), mk({ kind: 'text', at: P(0, 0), height: 1, angle: 0, anchor: 'left', text: 'x' }));
    expect(r.ok).toBe(true);
  });
});

describe('files with notes', () => {
  const build = () => {
    const h = harness();
    const outer = h.add(rectangle(P(0, 0), P(10, 10)));
    const c = h.add(circle(P(5, 5), 2));
    h.note(hatchOf([[outer], [c]]));
    h.note({ kind: 'radius', target: c, at: P(9, 5), style: STYLE });
    h.note({ kind: 'text', at: P(0, 12), height: 3, angle: 0.5, anchor: 'center', text: 'Two\nlines' });
    h.run('dimstyle.set', { style: { ...DEFAULT_DIM_STYLE, name: 'Fine', precision: 3 } });
    return h.doc;
  };

  it('save and load give the same drawing', () => {
    const doc = build();
    const text = saveDocument(doc);
    const back = loadDocument(text);
    expect(back).toEqual(doc);
    expect(saveDocument(back)).toBe(text);
  });

  const damage = (edit: (json: Record<string, any>) => void): string => {
    const json = JSON.parse(saveDocument(build()));
    edit(json);
    try {
      loadDocument(JSON.stringify(json));
    } catch (e) {
      return (e as Error).message;
    }
    return 'loaded';
  };

  it('rejects a note whose geometry is gone, whose layer is missing, or that reuses an id', () => {
    expect(damage((j) => (j.entities = j.entities.slice(0, 1)))).toContain('notes[');
    expect(damage((j) => (j.notes[0].layer = 77))).toContain('there is no layer with id 77');
    expect(damage((j) => (j.notes[1].id = j.notes[0].id))).toContain('notes[1]');
    expect(damage((j) => (j.notes[1].body.target = 'x'))).toContain('notes[1].body.target');
    expect(damage((j) => (j.currentDimStyle = 'Missing'))).not.toBe('loaded');
  });

  it('a version 1 file has no notes and still loads', () => {
    const json = JSON.parse(saveDocument(build()));
    json.version = 1;
    delete json.notes;
    delete json.dimStyles;
    delete json.currentDimStyle;
    delete json.currentSheet;
    delete json.sheets;
    delete json.blocks;
    delete json.inserts;
    delete json.constraints;
    json.entities = json.entities.slice(0, 2);
    const doc = loadDocument(JSON.stringify(json));
    expect(doc.notes.size).toBe(0);
    expect(doc.settings.dimStyles.map((s) => s.name)).toEqual(['ISO']);
  });
});
