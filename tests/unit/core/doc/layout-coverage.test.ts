import { describe, expect, it } from 'vitest';
import {
  constraintEntityIds,
  createSession,
  Draft,
  execute,
  FileFormatError,
  insertBounds,
  insertShapes,
  LAYOUT_COMMANDS,
  loadDocument,
  maxResidual,
  MAX_BLOCKS,
  MAX_SHEETS,
  newDocument,
  piecesOnSheet,
  residualOf,
  saveDocument,
  solveConstraints,
  undo,
  type Entity,
  type Insert,
} from '../../../../src/core/doc';
import { circle, polyline, segment, vec } from '../../../../src/core/geom';
import { DEFAULT_SNAPS, DocIndex, findSnap, pickAt, selectInBox } from '../../../../src/core/spatial';
import { currentPreview, DEFAULT_MEMORY, feed, startTool } from '../../../../src/core/tools';

function run(session: ReturnType<typeof createSession>, id: Parameters<typeof execute>[1], params: unknown) {
  return execute(session, id, params as never).session;
}

function addLine(s: ReturnType<typeof createSession>, x1: number, y1: number, x2: number, y2: number) {
  const r = execute(s, 'entity.add', { geom: segment(vec(x1, y1), vec(x2, y2)) });
  return { session: r.session, id: r.result.id };
}

function blockDoc() {
  const a = addLine(createSession(newDocument()), 0, 0, 10, 0);
  return run(a.session, 'block.create', { name: 'Bar', ids: [a.id], at: { x: 0, y: 0 } });
}

describe('layout coverage', () => {
  it('undoes a block, indexes inserts, and picks/snaps/exports them', () => {
    let s = blockDoc();
    const id = [...s.doc.inserts.keys()][0]!;
    expect(insertBounds(s.doc, s.doc.inserts.get(id)!)).not.toBeNull();
    expect(piecesOnSheet(s.doc).some((p) => p.id === id)).toBe(true);
    expect(DocIndex.of(s.doc).queryInserts({ minX: -1, minY: -1, maxX: 11, maxY: 1 }).map((i) => i.id)).toEqual([id]);
    expect(DocIndex.of(s.doc).visibleExtents()).not.toBeNull();
    expect(selectInBox(s.doc, { minX: -1, minY: -1, maxX: 11, maxY: 1 }, 'window')).toContain(id);
    expect(selectInBox(s.doc, { minX: 4, minY: -1, maxX: 6, maxY: 1 }, 'crossing')).toContain(id);
    expect(pickAt(s.doc, { x: 5, y: 0 }, 1)).toBe(id);
    expect(findSnap(s.doc, { x: 0.1, y: 0.1 }, 1, { kinds: DEFAULT_SNAPS })?.point).toEqual({ x: 0, y: 0 });
    const after = undo(s);
    expect(after.doc.inserts.size).toBe(0);
    expect(after.doc.blocks).toEqual([]);
  });

  it('renames a second sheet that holds a note, an insert and a constraint', () => {
    let s = blockDoc();
    s = run(s, 'sheet.add', { name: 'Layout' });
    const note = execute(s, 'note.add', {
      body: { kind: 'text', at: { x: 1, y: 1 }, height: 3, angle: 0, anchor: 'left', text: 'Hi' },
    });
    s = run(note.session, 'block.insert', { name: 'Bar', at: { x: 40, y: 0 } });
    const ln = addLine(s, 0, 0, 10, 0);
    s = run(ln.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: ln.id, end: 'start' }, b: { kind: 'end', id: ln.id, end: 'end' } },
    });
    s = run(s, 'sheet.rename', { name: 'Layout', newName: 'Detail' });
    expect(s.doc.settings.currentSheet).toBe('Detail');
    expect(s.doc.notes.get(note.result.id)?.sheet).toBe('Detail');
    expect([...s.doc.inserts.values()].some((i) => i.sheet === 'Detail')).toBe(true);
    expect([...s.doc.constraints.values()].some((c) => c.sheet === 'Detail')).toBe(true);
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(() => execute(s, 'sheet.delete', { name: 'Detail' })).toThrow(/not empty/);
  });

  it('refuses to delete a layer that still has an insert', () => {
    let s = createSession(newDocument());
    const layer = execute(s, 'layer.add', { name: 'Holes' });
    s = run(layer.session, 'layer.setCurrent', { id: layer.result.id });
    const a = addLine(s, 0, 0, 1, 0);
    s = run(a.session, 'block.create', { name: 'A', ids: [a.id], at: { x: 0, y: 0 } });
    s = run(s, 'layer.setCurrent', { id: 1 });
    expect(() => execute(s, 'layer.delete', { id: layer.result.id })).toThrow(/not empty/);
  });

  it('loads refuse a missing sheet name on an entity, and a missing insert block', () => {
    const a = addLine(createSession(newDocument()), 0, 0, 1, 0);
    const j = JSON.parse(saveDocument(a.session.doc)) as Record<string, any>;
    j.entities[0].sheet = 'Nope';
    expect(() => loadDocument(JSON.stringify(j))).toThrow(FileFormatError);
    const b = JSON.parse(saveDocument(blockDoc().doc)) as Record<string, any>;
    b.inserts[0].block = 'Gone';
    expect(() => loadDocument(JSON.stringify(b))).toThrow(/no block called/);
  });

  it('hits remaining command refusals, max counts, and the draft insert maps', () => {
    let s = createSession(newDocument());
    expect(() => execute(s, 'sheet.add', { name: 'Sheet 1' })).toThrow(/already exists/);
    expect(() => execute(s, 'sheet.setSize', { name: 'Nope', size: 'A3' })).toThrow(/no sheet called/);
    expect(() => execute(s, 'sheet.rename', { name: 'Nope', newName: 'X' })).toThrow(/no sheet called/);
    expect(() => execute(s, 'constraint.delete', { ids: [99] })).toThrow(/no constraint/);
    expect(() =>
      execute(s, 'constraint.add', { body: { kind: 'horizontal', a: { kind: 'free', p: { x: 0, y: 0 } }, b: { kind: 'free', p: { x: 1, y: 0 } } } }),
    ).toThrow(/drawn shape/);
    s = run(s, 'constraint.solve', {});
    const many = { ...newDocument(), sheets: Array.from({ length: MAX_SHEETS }, (_, i) => ({ name: `S${i}`, size: 'A4' as const })) };
    expect(() => execute(createSession(many), 'sheet.add', { name: 'More' })).toThrow(/at most/);
    const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => ({
      name: `B${i}`,
      members: [{ geom: segment(vec(0, 0), vec(1, 0)), color: 'byLayer' as const, linetype: 'byLayer' as const, lineweight: 'byLayer' as const }],
    }));
    const full = { ...newDocument(), blocks };
    const line = addLine(createSession(full), 0, 0, 1, 0);
    expect(() => execute(line.session, 'block.create', { name: 'Z', ids: [line.id], at: { x: 0, y: 0 } })).toThrow(/at most/);

    const withInsert = blockDoc();
    const ins = [...withInsert.doc.inserts.values()][0]!;
    const draft = new Draft(withInsert.doc);
    draft.putInsert({ ...ins, at: { x: 3, y: 0 } });
    expect(draft.insert(ins.id)?.at).toEqual({ x: 3, y: 0 });
    draft.deleteInsert(ins.id);
    expect(draft.insert(ins.id)).toBeUndefined();
    expect([...draft.inserts()]).toEqual([]);
    const cDraft = new Draft(withInsert.doc);
    cDraft.putConstraint({ id: 50, body: { kind: 'fix', a: { kind: 'end', id: 2, end: 'start' }, p: { x: 0, y: 0 } } });
    cDraft.deleteConstraint(50);
    expect(cDraft.constraint(50)).toBeUndefined();
    expect([...cDraft.constraints()]).toEqual([]);

    const emptyBlock = new Draft(newDocument());
    emptyBlock.setBlocks([{ name: 'E', members: [] }]);
    const ghost: Insert = {
      id: 9,
      layer: 1,
      z: 9,
      color: 'byLayer',
      linetype: 'byLayer',
      lineweight: 'byLayer',
      block: 'E',
      at: vec(0, 0),
      rotation: 0,
      scale: 1,
      flipped: false,
    };
    emptyBlock.putInsert(ghost);
    expect(() => LAYOUT_COMMANDS['insert.explode'].run(emptyBlock, { ids: [9] })).toThrow(/nothing to explode/);
    const missing = new Draft(newDocument());
    missing.putInsert({ ...ghost, block: 'Nope' });
    expect(() => LAYOUT_COMMANDS['insert.explode'].run(missing, { ids: [9] })).toThrow(/is gone/);
  });

  it('solves a mid-handle, a zero-distance start, coincident centres, and a stale constraint', () => {
    const a = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const b = addLine(a.session, 0, 4, 10, 6);
    let s = run(b.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'mid', id: a.id }, b: { kind: 'mid', id: b.id } },
    });
    const same = execute(createSession(newDocument()), 'entity.add', { geom: segment(vec(0, 0), vec(10, 0)) });
    s = run(same.session, 'constraint.add', {
      body: { kind: 'distance', a: { kind: 'end', id: same.result.id, end: 'start' }, b: { kind: 'end', id: same.result.id, end: 'start' }, value: 5 },
    });
    const c1 = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 2) });
    const c2 = execute(c1.session, 'entity.add', { geom: circle(vec(0, 0), 3) });
    s = run(c2.session, 'constraint.add', { body: { kind: 'tangent', a: c1.result.id, b: c2.result.id } });

    const stale = addLine(createSession(newDocument()), 0, 0, 10, 0);
    s = run(stale.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: stale.id, end: 'start' }, b: { kind: 'end', id: stale.id, end: 'end' } },
    });
    const draft = new Draft(s.doc);
    draft.deleteEntity(stale.id);
    solveConstraints(draft);

    expect(constraintEntityIds({ id: 1, body: { kind: 'fix', a: { kind: 'free', p: { x: 0, y: 0 } }, p: { x: 0, y: 0 } } })).toEqual([]);
  });

  it('inserts with rotation, scale and flip, and sheet.add is undone', () => {
    let s = blockDoc();
    s = run(s, 'block.insert', { name: 'Bar', at: { x: 20, y: 0 }, rotation: Math.PI / 2, scale: 2, flipped: true });
    const flipped = [...s.doc.inserts.values()].find((i) => i.flipped)!;
    expect(insertShapes(s.doc, flipped).length).toBeGreaterThan(0);
    expect(insertBounds(s.doc, flipped)).not.toBeNull();
    s = run(s, 'sheet.add', { name: 'Two' });
    expect(undo(s).doc.sheets).toHaveLength(1);
  });

  it('covers file-format refusals, leftover command paths and other-sheet geometry', () => {
    const two = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const twoB = addLine(two.session, 0, 0, 0, 10);
    let s = run(twoB.session, 'block.create', { name: 'L', ids: [two.id, twoB.id], at: { x: 0, y: 0 } });
    expect(insertBounds(s.doc, [...s.doc.inserts.values()][0]!)!.minX).toBeDefined();

    s = run(s, 'sheet.add', { name: 'Layout' });
    const extra = addLine(s, 100, 0, 110, 0);
    s = extra.session;
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(piecesOnSheet(s.doc).every((p) => p.geom.kind !== 'segment' || p.geom.start.x < 50)).toBe(true);

    const kinds: Parameters<typeof constraintEntityIds>[0]['body'][] = [
      { kind: 'coincident', a: { kind: 'end', id: 2, end: 'start' }, b: { kind: 'end', id: 2, end: 'end' } },
      { kind: 'midpoint', a: { kind: 'end', id: 2, end: 'start' }, of: 3 },
      { kind: 'parallel', a: 2, b: 3 },
      { kind: 'radius', target: 2, value: 1 },
    ];
    for (const body of kinds) expect(constraintEntityIds({ id: 1, body }).length).toBeGreaterThan(0);

    const circ = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 2) });
    expect(() => execute(circ.session, 'constraint.add', { body: { kind: 'length', target: circ.result.id, value: 3 } })).toThrow(/line/);

    const emptyIds = new Draft(newDocument());
    expect(() => LAYOUT_COMMANDS['block.create'].run(emptyIds, { name: 'X', ids: [], at: vec(0, 0) })).toThrow(/at least one shape/);
    const one = addLine(createSession(newDocument()), 0, 0, 1, 0);
    const manyIds = new Draft(one.session.doc);
    expect(() => LAYOUT_COMMANDS['block.create'].run(manyIds, { name: 'X', ids: Array(501).fill(one.id), at: vec(0, 0) })).toThrow(/at most/);
    expect(() => execute(one.session, 'block.insert', { name: 'Bar', at: { x: 0, y: 0 }, scale: 0 })).toThrow(/more than 0/);

    let s2 = run(createSession(newDocument()), 'sheet.add', { name: 'Layout' });
    const noteOnly = execute(s2, 'note.add', {
      body: { kind: 'text', at: { x: 1, y: 1 }, height: 3, angle: 0, anchor: 'left', text: 'Hi' },
    });
    s2 = run(noteOnly.session, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(() => execute(s2, 'sheet.delete', { name: 'Layout' })).toThrow(/not empty/);

    const j = JSON.parse(saveDocument(blockDoc().doc)) as Record<string, any>;
    const dup = structuredClone(j);
    dup.sheets.push({ name: 'Sheet 1', size: 'A3' });
    expect(() => loadDocument(JSON.stringify(dup))).toThrow(/already used/);
    const dupB = structuredClone(j);
    dupB.blocks.push({ ...j.blocks[0], name: 'Bar' });
    expect(() => loadDocument(JSON.stringify(dupB))).toThrow(/already used/);
    const emptyM = structuredClone(j);
    emptyM.blocks[0].members = [];
    expect(() => loadDocument(JSON.stringify(emptyM))).toThrow(/at least one shape/);
    const sc = structuredClone(j);
    sc.inserts[0].scale = 0;
    expect(() => loadDocument(JSON.stringify(sc))).toThrow(/more than 0/);
    const layer = structuredClone(j);
    layer.inserts[0].layer = 99;
    expect(() => loadDocument(JSON.stringify(layer))).toThrow(/no layer/);
    const sh = structuredClone(j);
    sh.inserts[0].sheet = 'Nope';
    expect(() => loadDocument(JSON.stringify(sh))).toThrow(/no sheet/);
    const ns = JSON.parse(saveDocument(noteOnly.session.doc)) as Record<string, any>;
    ns.notes[0].sheet = 'Nope';
    expect(() => loadDocument(JSON.stringify(ns))).toThrow(/no sheet/);
    const badC = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const withC = run(badC.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: badC.id, end: 'start' }, b: { kind: 'end', id: badC.id, end: 'end' } },
    });
    const cj = JSON.parse(saveDocument(withC.doc)) as Record<string, any>;
    cj.constraints[0].sheet = 'Nope';
    expect(() => loadDocument(JSON.stringify(cj))).toThrow(/no sheet/);
    cj.constraints[0].sheet = undefined;
    delete cj.constraints[0].sheet;
    cj.entities = [];
    expect(() => loadDocument(JSON.stringify(cj))).toThrow(/constraints/);

    expect(maxResidual({ ...newDocument(), constraints: new Map([[5, { id: 5, body: { kind: 'length', target: 99, value: 1 } }]]) })).toBe(Infinity);

    const other = addLine(createSession(newDocument()), 0, 0, 10, 3);
    let s3 = run(other.session, 'sheet.add', { name: 'Layout' });
    s3 = run(s3, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: other.id, end: 'start' }, b: { kind: 'end', id: other.id, end: 'end' } },
    });
    s3 = run(s3, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(maxResidual(s3.doc)).toBe(0);

    const slow = addLine(createSession(newDocument()), 0, 0, 10, 4);
    s3 = run(slow.session, 'constraint.add', {
      body: { kind: 'fix', a: { kind: 'end', id: slow.id, end: 'start' }, p: { x: 0, y: 0 } },
    });
    s3 = run(s3, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: slow.id, end: 'start' }, b: { kind: 'end', id: slow.id, end: 'end' } },
    });
    s3 = run(s3, 'constraint.add', {
      body: { kind: 'distance', a: { kind: 'end', id: slow.id, end: 'start' }, b: { kind: 'end', id: slow.id, end: 'end' }, value: 25 },
    });
    expect(maxResidual(s3.doc)).toBeLessThan(1);

    const insDoc = blockDoc();
    const insId = [...insDoc.doc.inserts.keys()][0]!;
    const drafting = startTool({ session: insDoc, memory: DEFAULT_MEMORY, active: null }, 'move', [insId]);
    const after = feed(drafting, { kind: 'point', point: { x: 0, y: 0 } }, [insId]);
    expect(currentPreview(after.drafting, { x: 5, y: 1 }, [insId]).length).toBeGreaterThan(0);
  });

  it('covers leftover insert, sheet, solver and spatial statements', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 2) });
    let s = run(a.session, 'constraint.add', { body: { kind: 'radius', target: a.result.id, value: 3 } });
    s = run(s, 'constraint.add', { body: { kind: 'radius', target: a.result.id, value: 4 } });
    const ln = addLine(createSession(newDocument()), 0, 0, 10, 0);
    expect(() =>
      execute(ln.session, 'constraint.add', {
        body: { kind: 'distance', a: { kind: 'end', id: ln.id, end: 'start' }, b: { kind: 'end', id: ln.id, end: 'end' }, value: 0 },
      }),
    ).toThrow(/more than 0/);
    const ln2 = addLine(ln.session, 0, 0, 0, 10);
    expect(() =>
      execute(ln2.session, 'constraint.add', { body: { kind: 'angle', a: ln.id, b: ln2.id, value: 0 } }),
    ).toThrow(/between 0 and π/);
    expect(() => execute(createSession(newDocument()), 'sheet.delete', { name: 'Nope' })).toThrow(/no sheet called/);

    const l1 = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const l2 = addLine(l1.session, 0, 10, 0, 0);
    s = run(l2.session, 'block.create', { name: 'L', ids: [l1.id, l2.id], at: { x: 0, y: 0 } });
    s = run(s, 'sheet.add', { name: 'Layout' });
    s = run(s, 'block.insert', { name: 'L', at: { x: 30, y: 0 } });
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(piecesOnSheet(s.doc).every((p) => p.geom.kind !== 'segment' || p.geom.start.x < 20)).toBe(true);
    expect(DocIndex.of(s.doc).queryInserts({ minX: 29, minY: -1, maxX: 41, maxY: 11 })).toEqual([]);
    expect(() => execute(s, 'sheet.delete', { name: 'Layout' })).toThrow(/not empty/);

    const hidden = execute(s, 'layer.add', { name: 'Hide' });
    s = run(hidden.session, 'layer.setCurrent', { id: hidden.result.id });
    s = run(s, 'block.insert', { name: 'L', at: { x: 0, y: 40 } });
    s = run(s, 'layer.update', { id: hidden.result.id, visible: false });
    s = run(s, 'layer.setCurrent', { id: 1 });
    expect(pickAt(s.doc, { x: 0, y: 40 }, 2)).toBeNull();
    expect(selectInBox(s.doc, { minX: -1, minY: 39, maxX: 11, maxY: 41 }, 'window')).not.toContain(
      [...s.doc.inserts.values()].find((i) => i.at.y === 40)?.id,
    );

    const draft = new Draft(s.doc);
    const sample = [...s.doc.inserts.values()][0]!;
    draft.putInsert({ ...sample, id: 900, z: 900, at: { x: 80, y: 0 } });
    expect([...draft.inserts()].some((i) => i.id === 900)).toBe(true);

    const freeDraft = new Draft(ln2.session.doc);
    freeDraft.putConstraint({
      id: 40,
      body: { kind: 'horizontal', a: { kind: 'free', p: { x: 0, y: 0 } }, b: { kind: 'end', id: ln.id, end: 'start' } },
    });
    solveConstraints(freeDraft);

    expect(findSnap(s.doc, { x: 0, y: 0 }, 1, { kinds: DEFAULT_SNAPS })?.kind).toBeDefined();
    expect(DocIndex.of(s.doc).visibleExtents()).not.toBeNull();

    const lineA = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const noteA = execute(lineA.session, 'note.add', {
      body: { kind: 'text', at: { x: 0, y: 8 }, height: 3, angle: 0, anchor: 'left', text: 'A' },
    });
    let s4 = run(noteA.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: lineA.id, end: 'start' }, b: { kind: 'end', id: lineA.id, end: 'end' } },
    });
    s4 = run(s4, 'sheet.add', { name: 'Layout' });
    const noteB = execute(s4, 'note.add', {
      body: { kind: 'text', at: { x: 4, y: 4 }, height: 3, angle: 0, anchor: 'left', text: 'B' },
    });
    s4 = run(noteB.session, 'constraint.add', {
      body: { kind: 'fix', a: { kind: 'end', id: lineA.id, end: 'start' }, p: { x: 0, y: 0 } },
    });
    s4 = run(s4, 'sheet.rename', { name: 'Layout', newName: 'Detail' });
    s4 = run(s4, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(DocIndex.of(s4.doc).queryNotes({ minX: -10, minY: -10, maxX: 20, maxY: 20 }).length).toBeGreaterThan(0);
    expect(() => execute(s4, 'sheet.delete', { name: 'Detail' })).toThrow(/not empty/);

    const onlyC = addLine(createSession(newDocument()), 0, 0, 10, 0);
    let s5 = run(onlyC.session, 'sheet.add', { name: 'OnlyC' });
    s5 = run(s5, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: onlyC.id, end: 'start' }, b: { kind: 'end', id: onlyC.id, end: 'end' } },
    });
    s5 = run(s5, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(() => execute(s5, 'sheet.delete', { name: 'OnlyC' })).toThrow(/not empty/);

    const p1 = execute(createSession(newDocument()), 'entity.add', {
      geom: polyline([vec(0, 0), vec(1, 0), vec(1, 1)], false),
    });
    const p2 = execute(p1.session, 'entity.add', { geom: polyline([vec(2, 0), vec(3, 0), vec(3, 1)], false) });
    expect(() => execute(p2.session, 'constraint.add', { body: { kind: 'tangent', a: p1.result.id, b: p2.result.id } })).toThrow(/tangent/);
    expect(() => execute(p2.session, 'constraint.add', { body: { kind: 'concentric', a: p1.result.id, b: p2.result.id } })).toThrow(/circle or an arc/);

    const ghostDoc = blockDoc();
    const ghostIns = [...ghostDoc.doc.inserts.values()][0]!;
    const broken = { ...ghostDoc.doc, inserts: new Map([[ghostIns.id, { ...ghostIns, block: 'Missing' }]]), blocks: [] };
    expect(selectInBox(broken, { minX: -1, minY: -1, maxX: 11, maxY: 1 }, 'crossing')).not.toContain(ghostIns.id);
    expect(pickAt(broken, { x: 0, y: 0 }, 2)).toBeNull();
    expect(piecesOnSheet(broken).every((p) => p.id !== ghostIns.id)).toBe(true);

    const zero = {
      id: 2,
      layer: 1,
      z: 2,
      color: 'byLayer' as const,
      linetype: 'byLayer' as const,
      lineweight: 'byLayer' as const,
      geom: { kind: 'segment' as const, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    };
    const circE = {
      id: 3,
      layer: 1,
      z: 3,
      color: 'byLayer' as const,
      linetype: 'byLayer' as const,
      lineweight: 'byLayer' as const,
      geom: circle(vec(1, 0), 1),
    };
    const zDoc = {
      ...newDocument(),
      nextId: 4,
      entities: new Map<number, Entity>([
        [2, zero],
        [3, circE],
      ]),
    };
    const zEnv = { entity: (id: number) => zDoc.entities.get(id), dimStyle: () => undefined };
    expect(() => residualOf(zEnv, { kind: 'parallel', a: 2, b: 2 })).toThrow(/zero-length/);
    expect(() => residualOf(zEnv, { kind: 'tangent', a: 3, b: 2 })).toThrow(/zero-length/);
    const zDraft = new Draft(zDoc);
    zDraft.putConstraint({ id: 8, body: { kind: 'length', target: 2, value: 5 } });
    zDraft.putConstraint({ id: 9, body: { kind: 'parallel', a: 2, b: 2 } });
    solveConstraints(zDraft);

    const styled = (id: number, geom: Entity['geom']): Entity => ({
      id,
      layer: 1,
      z: id,
      color: 'byLayer',
      linetype: 'byLayer',
      lineweight: 'byLayer',
      geom,
    });
    const mixed = {
      ...newDocument(),
      nextId: 20,
      entities: new Map<number, Entity>([
        [2, styled(2, segment(vec(0, 0), vec(10, 0)))],
        [3, styled(3, { kind: 'segment', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } })],
        [4, styled(4, polyline([vec(0, 0), vec(1, 0), vec(1, 1)], false))],
        [5, styled(5, polyline([vec(2, 0), vec(3, 0), vec(3, 1)], false))],
      ]),
    };
    const mixedDraft = new Draft(mixed);
    mixedDraft.putConstraint({ id: 11, body: { kind: 'tangent', a: 4, b: 5 } });
    mixedDraft.putConstraint({ id: 12, body: { kind: 'angle', a: 2, b: 3, value: Math.PI / 2 } });
    solveConstraints(mixedDraft);
  });
});
