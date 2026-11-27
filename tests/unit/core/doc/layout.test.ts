import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createSession,
  execute,
  insertBounds,
  insertShapes,
  isSheetSize,
  loadDocument,
  maxResidual,
  newDocument,
  saveDocument,
  type Session,
} from '../../../../src/core/doc';
import { arc, circle, polyline, segment, vec } from '../../../../src/core/geom';
import { expectClose, expectPoint } from '../helpers';
import { buildConstrainedPlate } from './constrained-plate';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

function addLine(s: Session, x1: number, y1: number, x2: number, y2: number): { session: Session; id: number } {
  const r = execute(s, 'entity.add', { geom: segment(vec(x1, y1), vec(x2, y2)) });
  return { session: r.session, id: r.result.id };
}

describe('blocks', () => {
  it('creates a named block, leaves an insert, and explode restores the shapes', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 0);
    const b = addLine(a.session, 0, 0, 0, 10);
    s = run(b.session, 'block.create', { name: 'L', ids: [a.id, b.id], at: { x: 0, y: 0 } });
    expect(s.doc.entities.size).toBe(0);
    expect(s.doc.blocks.map((bl) => bl.name)).toEqual(['L']);
    expect(s.doc.inserts.size).toBe(1);
    const ins = [...s.doc.inserts.values()][0]!;
    expect(ins.block).toBe('L');
    expectPoint(ins.at, vec(0, 0));

    s = run(s, 'block.insert', { name: 'L', at: { x: 20, y: 0 } });
    expect(s.doc.inserts.size).toBe(2);

    const first = [...s.doc.inserts.values()][0]!;
    s = run(s, 'insert.explode', { ids: [first.id] });
    expect(s.doc.entities.size).toBe(2);
    expect(s.doc.inserts.size).toBe(1);
    const lines = [...s.doc.entities.values()].filter((e) => e.geom.kind === 'segment');
    expect(lines).toHaveLength(2);
  });

  it('refuses an empty name, a missing block, and deleting a block that is still inserted', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 1, 0);
    expect(() => execute(a.session, 'block.create', { name: '  ', ids: [a.id], at: { x: 0, y: 0 } })).toThrow(CommandError);
    s = run(a.session, 'block.create', { name: 'A', ids: [a.id], at: { x: 0, y: 0 } });
    expect(() => execute(s, 'block.insert', { name: 'Nope', at: { x: 0, y: 0 } })).toThrow(/no block called/);
    const extra = addLine(s, 2, 0, 3, 0);
    expect(() => execute(extra.session, 'block.create', { name: 'A', ids: [extra.id], at: { x: 0, y: 0 } })).toThrow(/already exists/);
    expect(() => execute(s, 'block.create', { name: 'Nested', ids: [[...s.doc.inserts.keys()][0]!], at: { x: 0, y: 0 } })).toThrow(
      /Explode a block insert/,
    );
    expect(() => execute(s, 'block.delete', { name: 'A' })).toThrow(/still inserted/);
    expect(() => execute(s, 'block.delete', { name: 'Missing' })).toThrow(/no block called/);
    expect(() => execute(s, 'insert.explode', { ids: [999] })).toThrow(/no block insert/);
    expect(() => execute(s, 'entity.offset', { id: [...s.doc.inserts.keys()][0]!, distance: 1, toward: { x: 0, y: 1 } })).toThrow(
      /block insert/,
    );
    const ins = [...s.doc.inserts.keys()][0]!;
    s = run(s, 'entity.delete', { ids: [ins] });
    s = run(s, 'block.delete', { name: 'A' });
    expect(s.doc.blocks).toEqual([]);
  });

  it('entity.explode explodes inserts as well as polylines', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 5, 0);
    s = run(a.session, 'block.create', { name: 'S', ids: [a.id], at: { x: 0, y: 0 } });
    const ins = [...s.doc.inserts.keys()][0]!;
    s = run(s, 'entity.explode', { ids: [ins] });
    expect(s.doc.inserts.size).toBe(0);
    expect(s.doc.entities.size).toBe(1);
  });
});

describe('sheets', () => {
  it('hides objects on other sheets and refuses to delete the last sheet', () => {
    let s = createSession(newDocument());
    expect(s.doc.settings.currentSheet).toBe('Sheet 1');
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'sheet.add', { name: 'Layout', size: 'A3' });
    expect(s.doc.settings.currentSheet).toBe('Layout');
    expect(s.doc.sheets.map((sh) => sh.size)).toEqual(['A4', 'A3']);
    const b = addLine(s, 0, 0, 0, 10);
    s = b.session;
    expect(s.doc.entities.get(a.id)?.sheet).toBeUndefined();
    expect(s.doc.entities.get(b.id)?.sheet).toBe('Layout');
    expect(() => execute(s, 'sheet.delete', { name: 'Layout' })).toThrow(/current sheet/);
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(() => execute(s, 'sheet.delete', { name: 'Layout' })).toThrow(/not empty/);
    s = run(s, 'entity.delete', { ids: [b.id] });
    s = run(s, 'sheet.delete', { name: 'Layout' });
    expect(s.doc.sheets).toHaveLength(1);
    expect(() => execute(s, 'sheet.delete', { name: 'Sheet 1' })).toThrow(/at least one sheet/);
    expect(() => execute(s, 'sheet.setCurrent', { name: 'Missing' })).toThrow(/no sheet called/);
    expect(() => execute(s, 'sheet.rename', { name: 'Sheet 1', newName: 'Sheet 1' })).not.toThrow();
    s = run(s, 'sheet.rename', { name: 'Sheet 1', newName: 'Main' });
    expect(s.doc.settings.currentSheet).toBe('Main');
    expect(isSheetSize('A4')).toBe(true);
    expect(isSheetSize('Letter')).toBe(false);
  });

  it('renames a sheet and keeps objects with it', () => {
    let s = createSession(newDocument());
    s = run(s, 'sheet.add', { name: 'Two' });
    const a = addLine(s, 1, 1, 2, 2);
    s = run(a.session, 'sheet.rename', { name: 'Two', newName: 'Detail' });
    expect(s.doc.settings.currentSheet).toBe('Detail');
    expect(s.doc.entities.get(a.id)?.sheet).toBe('Detail');
  });
});

describe('constraints', () => {
  it('a horizontal constraint equalises y and is idempotent after another solve', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 3);
    s = run(a.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
    });
    const g = s.doc.entities.get(a.id)!.geom;
    expect(g.kind).toBe('segment');
    if (g.kind !== 'segment') return;
    expectClose(g.start.y, g.end.y);
    expect(maxResidual(s.doc)).toBeLessThan(1e-9);
    const before = saveDocument(s.doc);
    s = run(s, 'constraint.solve', {});
    expect(saveDocument(s.doc)).toBe(before);
  });

  it('moving a constrained end and re-solving restores the relation', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
    });
    s = run(s, 'entity.transform', { ids: [a.id], transform: { kind: 'translate', dx: 0, dy: 5 } });
    const g = s.doc.entities.get(a.id)!.geom;
    expect(g.kind).toBe('segment');
    if (g.kind !== 'segment') return;
    expectClose(g.start.y, g.end.y);
    expect(maxResidual(s.doc)).toBeLessThan(1e-9);
  });

  it('a distance constraint holds after an edit', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'constraint.add', {
      body: { kind: 'distance', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' }, value: 20 },
    });
    const g = s.doc.entities.get(a.id)!.geom;
    expect(g.kind).toBe('segment');
    if (g.kind !== 'segment') return;
    expectClose(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y), 20);
    s = run(s, 'entity.transform', { ids: [a.id], transform: { kind: 'translate', dx: 3, dy: 4 } });
    const g2 = s.doc.entities.get(a.id)!.geom;
    expect(g2.kind).toBe('segment');
    if (g2.kind !== 'segment') return;
    expectClose(Math.hypot(g2.end.x - g2.start.x, g2.end.y - g2.start.y), 20);
  });

  it('vertical, radius, length, parallel, perpendicular, equal, concentric, tangent, fix, midpoint and angle all apply', () => {
    const bottom = addLine(createSession(newDocument()), 0, 0, 10, 1);
    let s = run(bottom.session, 'constraint.add', {
      body: { kind: 'vertical', a: { kind: 'end', id: bottom.id, end: 'start' }, b: { kind: 'end', id: bottom.id, end: 'end' } },
    });
    let g = s.doc.entities.get(bottom.id)!.geom;
    if (g.kind === 'segment') expectClose(g.start.x, g.end.x);

    const left = addLine(createSession(newDocument()), 0, 0, 1, 8);
    s = run(left.session, 'constraint.add', { body: { kind: 'length', target: left.id, value: 8 } });
    g = s.doc.entities.get(left.id)!.geom;
    if (g.kind === 'segment') expectClose(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y), 8);

    const c = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(5, 5), 2) });
    s = run(c.session, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 3 } });
    g = s.doc.entities.get(c.result.id)!.geom;
    if (g.kind === 'circle') expectClose(g.radius, 3);

    const d = execute(c.session, 'entity.add', { geom: circle(vec(8, 5), 3) });
    s = run(d.session, 'constraint.add', { body: { kind: 'concentric', a: c.result.id, b: d.result.id } });
    const ca = s.doc.entities.get(c.result.id)!.geom;
    const cb = s.doc.entities.get(d.result.id)!.geom;
    if (ca.kind === 'circle' && cb.kind === 'circle') expectPoint(ca.center, cb.center);

    const p = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const q = addLine(p.session, 0, 1, 10, 2);
    s = run(q.session, 'constraint.add', { body: { kind: 'parallel', a: p.id, b: q.id } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const r = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const t = addLine(r.session, 0, 0, 0, 10);
    s = run(t.session, 'constraint.add', { body: { kind: 'perpendicular', a: r.id, b: t.id } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const e1 = addLine(createSession(newDocument()), 0, 0, 6, 0);
    const e2 = addLine(e1.session, 0, 2, 2, 2);
    s = run(e2.session, 'constraint.add', { body: { kind: 'equal', a: e1.id, b: e2.id } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const ln = addLine(createSession(newDocument()), 0, 0, 20, 0);
    const circ = execute(ln.session, 'entity.add', { geom: circle(vec(10, 4), 3) });
    s = run(circ.session, 'constraint.add', { body: { kind: 'tangent', a: circ.result.id, b: ln.id } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    s = run(s, 'constraint.add', {
      body: { kind: 'fix', a: { kind: 'end', id: ln.id, end: 'start' }, p: { x: 0, y: 0 } },
    });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const m1 = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const m2 = addLine(m1.session, 0, 4, 0, 8);
    s = run(m2.session, 'constraint.add', {
      body: { kind: 'midpoint', a: { kind: 'end', id: m2.id, end: 'start' }, of: m1.id },
    });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const ang = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const ang2 = addLine(ang.session, 0, 0, 10, 10);
    s = run(ang2.session, 'constraint.add', { body: { kind: 'angle', a: ang.id, b: ang2.id, value: Math.PI / 2 } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-5);

    const c1 = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(30, 0), 2) });
    const c2 = execute(c1.session, 'entity.add', { geom: circle(vec(40, 0), 2) });
    s = run(c2.session, 'constraint.add', { body: { kind: 'tangent', a: c1.result.id, b: c2.result.id } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const gone = addLine(createSession(newDocument()), 50, 50, 51, 50);
    s = run(gone.session, 'constraint.add', {
      body: { kind: 'coincident', a: { kind: 'end', id: gone.id, end: 'start' }, b: { kind: 'end', id: gone.id, end: 'end' } },
    });
    const cid = [...s.doc.constraints.keys()].at(-1)!;
    s = run(s, 'entity.delete', { ids: [gone.id] });
    expect(s.doc.constraints.has(cid)).toBe(false);
  });

  it('a real part drawing is produced start to finish and re-solves identically', () => {
    const s = buildConstrainedPlate();
    expect(s.doc.settings.title).toBe('Constrained plate');
    expect(s.doc.blocks.map((b) => b.name)).toEqual(['hole']);
    expect(s.doc.inserts.size).toBe(5);
    expect(s.doc.sheets.map((sh) => sh.name)).toEqual(['Sheet 1', 'Layout']);
    expect(maxResidual(s.doc)).toBeLessThan(1e-8);
    const before = saveDocument(s.doc);
    const again = run(s, 'constraint.solve', {});
    expect(saveDocument(again.doc)).toBe(before);
    expect(loadDocument(before)).toEqual(s.doc);
  });

  it('moves, copies and restyles an insert, and converting units scales it', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'block.create', { name: 'Bar', ids: [a.id], at: { x: 0, y: 0 } });
    const id = [...s.doc.inserts.keys()][0]!;
    s = run(s, 'entity.transform', { ids: [id], transform: { kind: 'translate', dx: 5, dy: 0 } });
    expectPoint(s.doc.inserts.get(id)!.at, vec(5, 0));
    s = run(s, 'entity.copy', { ids: [id], transform: { kind: 'translate', dx: 0, dy: 8 } });
    expect(s.doc.inserts.size).toBe(2);
    s = run(s, 'entity.setProps', { ids: [id], color: '#ff0000' });
    expect(s.doc.inserts.get(id)!.color).toBe('#ff0000');
    s = run(s, 'entity.transform', { ids: [id], transform: { kind: 'rotate', center: { x: 5, y: 0 }, angle: Math.PI / 2 } });
    s = run(s, 'entity.transform', { ids: [id], transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 2 } });
    s = run(s, 'entity.transform', { ids: [id], transform: { kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } });
    expect(s.doc.inserts.get(id)!.flipped).toBe(true);
    s = run(s, 'doc.setUnits', { units: 'in', convert: true });
    expect(s.doc.settings.units).toBe('in');
  });

  it('renames the size of a sheet, deletes a constraint, and a version-2 file still opens', () => {
    let s = createSession(newDocument());
    s = run(s, 'sheet.setSize', { name: 'Sheet 1', size: 'A3' });
    expect(s.doc.sheets[0]!.size).toBe('A3');
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
    });
    const cid = [...s.doc.constraints.keys()][0]!;
    s = run(s, 'constraint.delete', { ids: [cid] });
    expect(s.doc.constraints.size).toBe(0);
    const v2 = JSON.parse(saveDocument(newDocument())) as Record<string, unknown>;
    v2['version'] = 2;
    delete v2['currentSheet'];
    delete v2['sheets'];
    delete v2['blocks'];
    delete v2['inserts'];
    delete v2['constraints'];
    const loaded = loadDocument(JSON.stringify(v2));
    expect(loaded.sheets[0]!.name).toBe('Sheet 1');
    expect(loaded.inserts.size).toBe(0);
  });

  it('round-trips blocks, sheets and constraints in the file', () => {
    let s = createSession(newDocument());
    const a = addLine(s, 0, 0, 10, 0);
    s = run(a.session, 'block.create', { name: 'Hole', ids: [a.id], at: { x: 0, y: 0 } });
    s = run(s, 'sheet.add', { name: 'Layout', size: 'A3' });
    const text = saveDocument(s.doc);
    expect(loadDocument(text)).toEqual(s.doc);
    expect(text).toContain('"version": 3');
    expect(text).toContain('"currentSheet"');
  });

  it('a radius on an arc, a vertex coincident, and a missing block have no bounds', () => {
    const a = execute(createSession(newDocument()), 'entity.add', { geom: arc(vec(0, 0), 5, 0, Math.PI / 2) });
    let s = run(a.session, 'constraint.add', { body: { kind: 'radius', target: a.result.id, value: 8 } });
    const g = s.doc.entities.get(a.result.id)!.geom;
    if (g.kind === 'arc') expectClose(g.radius, 8);

    const p = execute(createSession(newDocument()), 'entity.add', {
      geom: polyline([vec(0, 0), vec(10, 1), vec(20, 0)], false),
    });
    s = run(p.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'vertex', id: p.result.id, index: 0 }, b: { kind: 'vertex', id: p.result.id, index: 1 } },
    });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const orphan = {
      id: 9,
      layer: 1,
      z: 9,
      color: 'byLayer' as const,
      linetype: 'byLayer' as const,
      lineweight: 'byLayer' as const,
      block: 'gone',
      at: vec(0, 0),
      rotation: 0,
      scale: 1,
      flipped: false,
    };
    expect(insertShapes(newDocument(), orphan)).toEqual([]);
    expect(insertBounds(newDocument(), orphan)).toBeNull();
  });
});
