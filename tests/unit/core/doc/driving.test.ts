import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_KINDS,
  CommandError,
  constraintDisplayValue,
  constraintKindLabel,
  constraintMarks,
  constraintRefuseMessage,
  constraintStoredValue,
  constraintsTouching,
  createSession,
  Draft,
  docEnv,
  distanceAxis,
  distanceToMark,
  drivingBodyFor,
  drivingNoteOf,
  execute,
  FILE_VERSION,
  formatFixPoint,
  loadDocument,
  maxResidual,
  newDocument,
  pruneAndSolve,
  resolveNotes,
  saveDocument,
  solveConstraints,
  undo,
  unmetOnDraft,
  unmetConstraints,
  type Constraint,
  type Session,
} from '../../../../src/core/doc';
import { circle, polyline, segment, vec } from '../../../../src/core/geom';
import { pickAt, selectInBox } from '../../../../src/core/spatial';
import { expectClose, expectPoint } from '../helpers';
import { buildConstrainedPlate } from './constrained-plate';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

function addLine(s: Session, x1: number, y1: number, x2: number, y2: number): { session: Session; id: number } {
  const r = execute(s, 'entity.add', { geom: segment(vec(x1, y1), vec(x2, y2)) });
  return { session: r.session, id: r.result.id };
}

function geomOf(s: Session, id: number) {
  return s.doc.entities.get(id)!.geom;
}

describe('driving dimensions', () => {
  it('placing an aligned dimension on a 100 mm line adds one constraint of 100 and moves nothing', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 100, 0);
    const before = geomOf(line.session, line.id);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 50, y: -10 },
        style: 'ISO',
      },
    });
    expect(added.session.doc.constraints.size).toBe(1);
    const c = [...added.session.doc.constraints.values()][0]!;
    expect(c.body).toMatchObject({ kind: 'distance', value: 100 });
    expect(c.note).toBe(added.result.id);
    expect(added.session.doc.notes.get(added.result.id)?.drive).toBe(c.id);
    const after = geomOf(added.session, line.id);
    expect(after).toEqual(before);
    const text = resolveNotes(added.session.doc).get(added.result.id);
    expect(text?.ok && text.r.text).toBe('100.00');
  });

  it('a reference dimension adds no constraint and draws in brackets', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 100, 0);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 50, y: -10 },
        style: 'ISO',
      },
      reference: true,
    });
    expect(added.session.doc.constraints.size).toBe(0);
    expect(added.session.doc.notes.get(added.result.id)?.reference).toBe(true);
    const text = resolveNotes(added.session.doc).get(added.result.id);
    expect(text?.ok && text.r.text).toBe('(100.00)');
  });

  it('constraint.setValue to 120 leaves the line exactly 120 long', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 100, 0);
    let s = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 50, y: -10 },
        style: 'ISO',
      },
    }).session;
    const cid = [...s.doc.constraints.keys()][0]!;
    s = run(s, 'constraint.setValue', { id: cid, value: 120 });
    const g = geomOf(s, line.id);
    expect(g.kind).toBe('segment');
    if (g.kind !== 'segment') return;
    expectClose(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y), 120);
  });

  it('widening the constrained plate from 80 to 100 moves the right edge and a hole constrained to it', () => {
    let s = buildConstrainedPlate();
    const bottom = [...s.doc.entities.values()].find((e) => e.geom.kind === 'segment' && e.geom.start.x === 0 && e.geom.end.x === 80 && e.geom.start.y === 0);
    const right = [...s.doc.entities.values()].find((e) => e.geom.kind === 'segment' && e.geom.start.x === 80 && e.geom.end.x === 80);
    expect(bottom && right).toBeTruthy();
    const hole = execute(s, 'entity.add', { geom: circle(vec(68, 25), 4) });
    s = hole.session;
    s = run(s, 'constraint.add', { body: { kind: 'radius', target: hole.result.id, value: 4 } });
    s = run(s, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: right!.id, end: 'start' },
        b: { kind: 'center', id: hole.result.id },
        value: 12,
        axis: 'x',
      },
    });
    s = run(s, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: bottom!.id, end: 'start' },
        b: { kind: 'center', id: hole.result.id },
        value: 25,
        axis: 'y',
      },
    });
    const width = [...s.doc.constraints.values()].find((c) => c.body.kind === 'distance' && c.body.value === 80 && !c.body.axis);
    expect(width).toBeTruthy();
    s = run(s, 'constraint.setValue', { id: width!.id, value: 100 });
    const g = geomOf(s, bottom!.id);
    expect(g.kind).toBe('segment');
    if (g.kind === 'segment') {
      expectClose(g.start.x, 0);
      expectClose(g.end.x, 100);
    }
    const h = geomOf(s, hole.result.id);
    expect(h.kind).toBe('circle');
    if (h.kind === 'circle') {
      expectClose(h.center.x, 88);
      expectClose(h.center.y, 25);
      expectClose(h.radius, 4);
    }
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);
  });

  it('a value the other constraints forbid is refused and names the constraint', () => {
    const c = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 3) });
    let s = run(c.session, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 3 } });
    s = run(s, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 3 } });
    const second = [...s.doc.constraints.values()].find((x) => x.id !== [...s.doc.constraints.keys()][0]);
    const before = saveDocument(s.doc);
    expect(() => execute(s, 'constraint.setValue', { id: second!.id, value: 4 })).toThrow(CommandError);
    expect(() => execute(s, 'constraint.setValue', { id: second!.id, value: 4 })).toThrow(/held at|constraint/);
    expect(saveDocument(s.doc)).toBe(before);
  });
});

describe('editing constrained geometry', () => {
  it('scaling a length-10 line by 2 is refused and the line is unchanged', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    let s = run(line.session, 'constraint.add', { body: { kind: 'length', target: line.id, value: 10 } });
    const before = saveDocument(s.doc);
    expect(() =>
      execute(s, 'entity.transform', { ids: [line.id], transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 2 } }),
    ).toThrow(/held at 10|constraint/);
    expect(saveDocument(s.doc)).toBe(before);
  });

  it('moving a fixed-start line is refused and the line is unchanged', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    let s = run(line.session, 'constraint.add', {
      body: { kind: 'fix', a: { kind: 'end', id: line.id, end: 'start' }, p: { x: 0, y: 0 } },
    });
    const before = saveDocument(s.doc);
    expect(() =>
      execute(s, 'entity.transform', { ids: [line.id], transform: { kind: 'translate', dx: 5, dy: 3 } }),
    ).toThrow(/fixed \(constraint/);
    expect(saveDocument(s.doc)).toBe(before);
    const g = geomOf(s, line.id);
    expect(g.kind).toBe('segment');
    if (g.kind === 'segment') {
      expectPoint(g.start, vec(0, 0));
      expectPoint(g.end, vec(10, 0));
    }
  });

  it('moving the vertical leg of a joined L by 4 pulls the horizontal leg to x 14', () => {
    const a = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const b = addLine(a.session, 10, 0, 10, 10);
    let s = run(b.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
    });
    s = run(s, 'constraint.add', {
      body: { kind: 'vertical', a: { kind: 'end', id: b.id, end: 'start' }, b: { kind: 'end', id: b.id, end: 'end' } },
    });
    s = run(s, 'constraint.add', {
      body: { kind: 'coincident', a: { kind: 'end', id: a.id, end: 'end' }, b: { kind: 'end', id: b.id, end: 'start' } },
    });
    s = run(s, 'entity.transform', { ids: [b.id], transform: { kind: 'translate', dx: 4, dy: 0 } });
    const ha = geomOf(s, a.id);
    const vb = geomOf(s, b.id);
    expect(ha.kind).toBe('segment');
    expect(vb.kind).toBe('segment');
    if (ha.kind === 'segment' && vb.kind === 'segment') {
      expectPoint(ha.start, vec(0, 0));
      expectPoint(ha.end, vec(14, 0));
      expectPoint(vb.start, vec(14, 0));
      expectPoint(vb.end, vec(14, 10));
    }
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);
  });
});

describe('axis distances, pairing and marks', () => {
  it('a version 4 file with an axis distance reads back the same; a version 3 file opens unchanged', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 40, 0);
    let s = run(line.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        value: 40,
        axis: 'x',
      },
    });
    const text = saveDocument(s.doc);
    expect(text).toContain('"version": 4');
    expect(text).toContain('"axis":"x"');
    expect(loadDocument(text)).toEqual(s.doc);
    expect(FILE_VERSION).toBe(4);

    const v3line = addLine(createSession(newDocument()), 0, 0, 25, 0);
    const v3s = run(v3line.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: v3line.id, end: 'start' },
        b: { kind: 'end', id: v3line.id, end: 'end' },
        value: 25,
      },
    });
    const v3 = JSON.parse(saveDocument(v3s.doc)) as { version: number; constraints: { body: { axis?: string } }[] };
    expect(v3.constraints[0]!.body.axis).toBeUndefined();
    v3.version = 3;
    const loaded = loadDocument(JSON.stringify(v3));
    expect(loaded.constraints.size).toBe(1);
    const body = [...loaded.constraints.values()][0]!.body;
    expect(body.kind).toBe('distance');
    if (body.kind === 'distance') expect(body.axis).toBeUndefined();
    const g = [...loaded.entities.values()][0]!.geom;
    expect(g.kind).toBe('segment');
    if (g.kind === 'segment') {
      expectClose(g.start.x, 0);
      expectClose(g.end.x, 25);
    }
  });

  it('deleting a driving dimension deletes its constraint in the same step, and undo restores both', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 50, 0);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 25, y: -8 },
        style: 'ISO',
      },
    });
    const nid = added.result.id;
    const cid = added.session.doc.notes.get(nid)!.drive!;
    const gone = execute(added.session, 'entity.delete', { ids: [nid] });
    expect(gone.session.doc.notes.size).toBe(0);
    expect(gone.session.doc.constraints.size).toBe(0);
    const back = undo(gone.session);
    expect(back.doc.notes.get(nid)?.drive).toBe(cid);
    expect(back.doc.constraints.has(cid)).toBe(true);
    expect(saveDocument(back.doc)).toBe(saveDocument(added.session.doc));
  });

  it('a horizontal linear dimension stores an x-axis distance', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 30, 8);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'linear',
        orient: 'horizontal',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 15, y: -10 },
        style: 'ISO',
      },
    });
    const c = [...added.session.doc.constraints.values()][0]!;
    expect(c.body).toMatchObject({ kind: 'distance', axis: 'x', value: 30 });
  });

  it('a vertical linear dimension stores a y-axis distance', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 8, 30);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'linear',
        orient: 'vertical',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: -10, y: 15 },
        style: 'ISO',
      },
    });
    const c = [...added.session.doc.constraints.values()][0]!;
    expect(c.body).toMatchObject({ kind: 'distance', axis: 'y', value: 30 });
  });

  it('switching a driving dimension to reference drops the constraint; switching back adds one', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 20, 0);
    let s = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 10, y: -6 },
        style: 'ISO',
      },
    }).session;
    const nid = [...s.doc.notes.keys()][0]!;
    s = run(s, 'note.setReference', { id: nid, reference: true });
    expect(s.doc.constraints.size).toBe(0);
    expect(resolveNotes(s.doc).get(nid)?.ok && resolveNotes(s.doc).get(nid)!.ok && (resolveNotes(s.doc).get(nid) as { ok: true; r: { text: string } }).r.text).toBe('(20.00)');
    s = run(s, 'note.setReference', { id: nid, reference: false });
    expect(s.doc.constraints.size).toBe(1);
  });

  it('constraint marks sit beside what they hold and can be measured', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const s = run(line.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: line.id, end: 'start' }, b: { kind: 'end', id: line.id, end: 'end' } },
    });
    const marks = constraintMarks(s.doc);
    expect(marks).toHaveLength(1);
    expect(distanceToMark(marks[0]!, { x: marks[0]!.at.x, y: marks[0]!.at.y })).toBeLessThan(3);
    expect(unmetConstraints(s.doc)).toEqual([]);
  });

  it('transforming a constraint id is refused in plain words', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const s = run(line.session, 'constraint.add', {
      body: { kind: 'length', target: line.id, value: 10 },
    });
    const cid = [...s.doc.constraints.keys()][0]!;
    expect(() => execute(s, 'entity.transform', { ids: [cid], transform: { kind: 'translate', dx: 1, dy: 0 } })).toThrow(
      /marks, not geometry/,
    );
  });
});

describe('refusals, diameters, files and marks of every kind', () => {
  it('a driving dimension on a free point is refused in plain words', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    expect(() =>
      execute(line.session, 'note.add', {
        body: {
          kind: 'aligned',
          a: { kind: 'end', id: line.id, end: 'start' },
          b: { kind: 'free', p: { x: 4, y: 0 } },
          at: { x: 5, y: -4 },
          style: 'ISO',
        },
      }),
    ).toThrow(/points on drawn shapes/);
  });

  it('a diameter dimension holds the radius, and setValue of 20 makes the circle Ø20', () => {
    const c = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 5) });
    const added = execute(c.session, 'note.add', {
      body: { kind: 'diameter', target: c.result.id, at: { x: 8, y: 0 }, style: 'ISO' },
    });
    const constraint = [...added.session.doc.constraints.values()][0]!;
    expect(constraint.body).toMatchObject({ kind: 'radius', value: 5 });
    const next = run(added.session, 'constraint.setValue', { id: constraint.id, value: 10 });
    const g = geomOf(next, c.result.id);
    expect(g.kind).toBe('circle');
    if (g.kind === 'circle') expectClose(g.radius, 10);
    const shown = resolveNotes(next.doc).get(added.result.id);
    expect(shown?.ok && shown.r.text).toBe('Ø20.00');
  });

  it('an angle dimension holds two lines; free points cannot drive', () => {
    const a = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const b = addLine(a.session, 0, 0, 0, 10);
    const added = execute(b.session, 'note.add', {
      body: {
        kind: 'angle',
        vertex: { kind: 'end', id: a.id, end: 'start' },
        a: { kind: 'end', id: a.id, end: 'end' },
        b: { kind: 'end', id: b.id, end: 'end' },
        at: { x: 4, y: 4 },
        style: 'ISO',
      },
    });
    expect([...added.session.doc.constraints.values()][0]!.body.kind).toBe('angle');
    expect(() =>
      execute(createSession(newDocument()), 'note.add', {
        body: {
          kind: 'angle',
          vertex: { kind: 'free', p: { x: 0, y: 0 } },
          a: { kind: 'free', p: { x: 10, y: 0 } },
          b: { kind: 'free', p: { x: 0, y: 10 } },
          at: { x: 4, y: 4 },
          style: 'ISO',
        },
      }),
    ).toThrow(/both sides are lines/);
  });

  it('constraint.setValue and setFix refuse bad input; a fix point can be moved', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    let s = run(line.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: line.id, end: 'start' }, b: { kind: 'end', id: line.id, end: 'end' } },
    });
    const hid = [...s.doc.constraints.keys()][0]!;
    expect(() => execute(s, 'constraint.setValue', { id: hid, value: 1 })).toThrow(/no value to change/);
    expect(() => execute(s, 'constraint.setValue', { id: 99, value: 1 })).toThrow(/no constraint/);
    expect(() => execute(s, 'constraint.setFix', { id: hid, p: { x: 0, y: 0 } })).toThrow(/does not hold a point still/);
    const fixed = addLine(createSession(newDocument()), 0, 0, 10, 0);
    s = run(fixed.session, 'constraint.add', {
      body: { kind: 'fix', a: { kind: 'end', id: fixed.id, end: 'start' }, p: { x: 0, y: 0 } },
    });
    const fid = [...s.doc.constraints.values()].find((c) => c.body.kind === 'fix')!.id;
    expect(() => execute(s, 'constraint.setValue', { id: fid, value: 1 })).toThrow(/no value to change/);
    s = run(s, 'constraint.setFix', { id: fid, p: { x: 2, y: 3 } });
    const g = geomOf(s, fixed.id);
    expect(g.kind).toBe('segment');
    if (g.kind === 'segment') expectPoint(g.start, vec(2, 3));
    expect(() => execute(s, 'constraint.setFix', { id: 99, p: { x: 0, y: 0 } })).toThrow(/no constraint/);
    const len = run(line.session, 'constraint.add', { body: { kind: 'length', target: line.id, value: 10 } });
    const lid = [...len.doc.constraints.keys()][0]!;
    expect(() => execute(len, 'constraint.setValue', { id: lid, value: 0 })).toThrow(/more than 0/);
    const angA = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const angB = addLine(angA.session, 0, 0, 0, 10);
    const ang = run(angB.session, 'constraint.add', { body: { kind: 'angle', a: angA.id, b: angB.id, value: Math.PI / 2 } });
    const aid = [...ang.doc.constraints.keys()][0]!;
    expect(() => execute(ang, 'constraint.setValue', { id: aid, value: Math.PI })).toThrow(/between 0 and 180/);
  });

  it('note.setReference is refused on text and is a no-op when already so', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const text = execute(line.session, 'note.add', {
      body: { kind: 'text', at: { x: 0, y: 4 }, height: 3, angle: 0, anchor: 'left', text: 'Hi' },
    });
    expect(() => execute(text.session, 'note.setReference', { id: text.result.id, reference: true })).toThrow(/Only a dimension/);
    expect(() => execute(text.session, 'note.add', { body: text.session.doc.notes.get(text.result.id)!.body, reference: true })).toThrow(
      /Only a dimension/,
    );
    const dim = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 5, y: -4 },
        style: 'ISO',
      },
      reference: true,
    });
    const same = run(dim.session, 'note.setReference', { id: dim.result.id, reference: true });
    expect(same.doc.constraints.size).toBe(0);
    expect(() => execute(dim.session, 'note.setReference', { id: 99, reference: true })).toThrow(/no annotation/);
  });

  it('a file whose drive and note ids do not match is refused', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 20, 0);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 10, y: -4 },
        style: 'ISO',
      },
    });
    const json = JSON.parse(saveDocument(added.session.doc)) as {
      notes: { drive?: number; reference?: boolean; body: { kind: string } }[];
      constraints: { note?: number }[];
    };
    const brokenDrive = structuredClone(json);
    brokenDrive.notes[0]!.drive = 99;
    expect(() => loadDocument(JSON.stringify(brokenDrive))).toThrow(/linked back|drive/);
    const brokenNote = structuredClone(json);
    brokenNote.constraints[0]!.note = 99;
    expect(() => loadDocument(JSON.stringify(brokenNote))).toThrow(/note/);
    const refFalse = structuredClone(json);
    refFalse.notes[0]!.reference = false;
    expect(() => loadDocument(JSON.stringify(refFalse))).toThrow(/must be true/);
  });

  it('every constraint kind has a mark that can be picked', () => {
    const kinds: { add: (s: Session) => Session }[] = [
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          return run(a.session, 'constraint.add', {
            body: { kind: 'horizontal', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
          });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 0, 10);
          return run(a.session, 'constraint.add', {
            body: { kind: 'vertical', a: { kind: 'end', id: a.id, end: 'start' }, b: { kind: 'end', id: a.id, end: 'end' } },
          });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          const b = addLine(a.session, 10, 0, 10, 8);
          return run(b.session, 'constraint.add', {
            body: { kind: 'coincident', a: { kind: 'end', id: a.id, end: 'end' }, b: { kind: 'end', id: b.id, end: 'start' } },
          });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 12, 0);
          return run(a.session, 'constraint.add', {
            body: {
              kind: 'distance',
              a: { kind: 'end', id: a.id, end: 'start' },
              b: { kind: 'end', id: a.id, end: 'end' },
              value: 12,
              axis: 'y',
            },
          });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 1, 1, 8, 1);
          return run(a.session, 'constraint.add', {
            body: { kind: 'fix', a: { kind: 'end', id: a.id, end: 'start' }, p: { x: 1, y: 1 } },
          });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 6, 0);
          return run(a.session, 'constraint.add', { body: { kind: 'length', target: a.id, value: 6 } });
        },
      },
      {
        add: (s) => {
          const c = execute(s, 'entity.add', { geom: circle(vec(0, 0), 4) });
          return run(c.session, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 4 } });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          const b = addLine(a.session, 0, 2, 10, 2);
          return run(b.session, 'constraint.add', { body: { kind: 'parallel', a: a.id, b: b.id } });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          const b = addLine(a.session, 0, 0, 0, 10);
          return run(b.session, 'constraint.add', { body: { kind: 'perpendicular', a: a.id, b: b.id } });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 8, 0);
          const b = addLine(a.session, 0, 3, 8, 3);
          return run(b.session, 'constraint.add', { body: { kind: 'equal', a: a.id, b: b.id } });
        },
      },
      {
        add: (s) => {
          const c1 = execute(s, 'entity.add', { geom: circle(vec(0, 0), 2) });
          const c2 = execute(c1.session, 'entity.add', { geom: circle(vec(1, 0), 2) });
          return run(c2.session, 'constraint.add', { body: { kind: 'concentric', a: c1.result.id, b: c2.result.id } });
        },
      },
      {
        add: (s) => {
          const ln = addLine(s, 0, 0, 20, 0);
          const circ = execute(ln.session, 'entity.add', { geom: circle(vec(10, 4), 4) });
          return run(circ.session, 'constraint.add', { body: { kind: 'tangent', a: circ.result.id, b: ln.id } });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          const b = addLine(a.session, 0, 0, 0, 10);
          return run(b.session, 'constraint.add', { body: { kind: 'angle', a: a.id, b: b.id, value: Math.PI / 2 } });
        },
      },
      {
        add: (s) => {
          const a = addLine(s, 0, 0, 10, 0);
          const b = addLine(a.session, 5, 4, 5, 8);
          return run(b.session, 'constraint.add', {
            body: { kind: 'midpoint', a: { kind: 'end', id: b.id, end: 'start' }, of: a.id },
          });
        },
      },
    ];
    const seen = new Set<string>();
    for (const k of kinds) {
      const s = k.add(createSession(newDocument()));
      const marks = constraintMarks(s.doc);
      expect(marks.length).toBeGreaterThan(0);
      const first = marks[0]!;
      seen.add(s.doc.constraints.get(first.id)!.body.kind);
      const [g0, g1] = first.segs[0]!;
      const onGlyph = { x: (g0.x + g1.x) / 2, y: (g0.y + g1.y) / 2 };
      expect(pickAt(s.doc, onGlyph, 1, marks)).toBe(first.id);
      expect(selectInBox(s.doc, first.bounds, 'window', marks)).toContain(first.id);
      expect(selectInBox(s.doc, first.bounds, 'crossing', marks)).toContain(first.id);
      const [a0, b0] = first.segs[0]!;
      const tiny = { minX: a0.x - 0.05, minY: a0.y - 0.05, maxX: a0.x + 0.05, maxY: a0.y + 0.05 };
      expect(selectInBox(s.doc, tiny, 'crossing', marks)).toContain(first.id);
    }
    expect(seen.size).toBe(kinds.length);
    expect(distanceToMark({ id: 1, segs: [[{ x: 0, y: 0 }, { x: 0, y: 0 }]], at: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }, { x: 3, y: 4 })).toBe(5);
  });

  it('labels, display values, refuse messages and marks cover every helper', () => {
    for (const kind of CONSTRAINT_KINDS) {
      expect(constraintKindLabel(kind).length).toBeGreaterThan(2);
      const c = { id: 4, body: { kind, a: 2, b: 3, value: 1, target: 2, p: { x: 0, y: 0 } } } as unknown as Constraint;
      expect(constraintRefuseMessage(c)).toMatch(/constraint 4/);
    }
    expect(formatFixPoint({ x: 1.5, y: -2 })).toBe('1.5, -2');
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const added = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 5, y: -4 },
        style: 'ISO',
      },
    });
    const cid = added.session.doc.notes.get(added.result.id)!.drive!;
    const c = added.session.doc.constraints.get(cid)!;
    expect(drivingNoteOf(added.session.doc, added.result.id)?.constraint.id).toBe(cid);
    expect(drivingNoteOf(added.session.doc, 99)).toBeNull();
    expect(
      drivingNoteOf(
        {
          ...added.session.doc,
          notes: new Map([[added.result.id, { ...added.session.doc.notes.get(added.result.id)!, drive: 99 }]]),
        },
        added.result.id,
      ),
    ).toBeNull();
    expect(() =>
      drivingBodyFor(docEnv(added.session.doc), {
        id: 1,
        layer: 1,
        z: 1,
        color: 'byLayer',
        lineweight: 'byLayer',
        body: { kind: 'text', at: { x: 0, y: 0 }, height: 3, angle: 0, anchor: 'left', text: 'Hi' },
      }),
    ).toThrow(/Only a dimension/);
    expect(constraintDisplayValue(added.session.doc, c)).toBe(10);
    expect(constraintStoredValue(added.session.doc, c, 20)).toBe(20);
    expect(constraintsTouching(added.session.doc, new Set([line.id])).map((x) => x.id)).toEqual([cid]);
    expect(constraintsTouching(added.session.doc, new Set([added.result.id])).map((x) => x.id)).toEqual([cid]);
    expect(distanceAxis({ kind: 'distance', a: { kind: 'free', p: vec(0, 0) }, b: { kind: 'free', p: vec(1, 0) }, value: 1 })).toBe('any');
    expect(distanceAxis({ kind: 'distance', a: { kind: 'free', p: vec(0, 0) }, b: { kind: 'free', p: vec(1, 0) }, value: 1, axis: 'x' })).toBe('x');
    const diam = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 4) });
    const dnote = execute(diam.session, 'note.add', { body: { kind: 'diameter', target: diam.result.id, at: { x: 6, y: 0 }, style: 'ISO' } });
    const dc = [...dnote.session.doc.constraints.values()][0]!;
    expect(constraintDisplayValue(dnote.session.doc, dc)).toBe(8);
    expect(constraintStoredValue(dnote.session.doc, dc, 10)).toBe(5);
    expect(constraintDisplayValue(added.session.doc, { id: 1, body: { kind: 'horizontal', a: { kind: 'end', id: 2, end: 'start' }, b: { kind: 'end', id: 2, end: 'end' } } })).toBeNull();

    expect(() =>
      execute(line.session, 'note.add', {
        body: {
          kind: 'linear',
          orient: 'horizontal',
          a: { kind: 'end', id: line.id, end: 'start' },
          b: { kind: 'free', p: { x: 4, y: 0 } },
          at: { x: 2, y: -4 },
          style: 'ISO',
        },
      }),
    ).toThrow(/points on drawn shapes/);

    const left = addLine(createSession(newDocument()), -10, 0, 0, 0);
    const right = addLine(left.session, 0, 0, 10, 0);
    expect(() =>
      execute(right.session, 'note.add', {
        body: {
          kind: 'angle',
          vertex: { kind: 'end', id: left.id, end: 'end' },
          a: { kind: 'end', id: left.id, end: 'start' },
          b: { kind: 'end', id: right.id, end: 'end' },
          at: { x: 0, y: 4 },
          style: 'ISO',
        },
      }),
    ).toThrow(/180/);

    const quadA = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const quadB = addLine(quadA.session, 0, 0, 0, 10);
    const reflex = execute(quadB.session, 'note.add', {
      body: {
        kind: 'angle',
        vertex: { kind: 'end', id: quadA.id, end: 'start' },
        a: { kind: 'end', id: quadA.id, end: 'end' },
        b: { kind: 'end', id: quadB.id, end: 'end' },
        at: { x: -6, y: -6 },
        style: 'ISO',
      },
    });
    const reflexC = [...reflex.session.doc.constraints.values()][0]!;
    expect(reflexC.body.kind).toBe('angle');
    if (reflexC.body.kind === 'angle') expectClose(reflexC.body.value, Math.PI / 2);

    const dangling = {
      ...newDocument(),
      nextId: 3,
      constraints: new Map([
        [
          2,
          {
            id: 2,
            body: {
              kind: 'coincident' as const,
              a: { kind: 'end' as const, id: 99, end: 'start' as const },
              b: { kind: 'end' as const, id: 99, end: 'end' as const },
            },
          },
        ],
      ]),
    };
    expect(constraintMarks(dangling).length).toBe(1);

    const pl = polyline(
      [
        { x: 1, y: 2 },
        { x: 4, y: 6 },
      ],
      false,
    );
    const withPoly = {
      ...newDocument(),
      nextId: 4,
      entities: new Map([
        [2, { id: 2, layer: 1, z: 2, color: 'byLayer' as const, linetype: 'byLayer' as const, lineweight: 'byLayer' as const, geom: pl }],
      ]),
      constraints: new Map([[3, { id: 3, body: { kind: 'length' as const, target: 2, value: 5 } }]]),
    };
    expect(constraintMarks(withPoly).length).toBe(1);

    const missing = {
      ...newDocument(),
      nextId: 3,
      constraints: new Map([[2, { id: 2, body: { kind: 'length' as const, target: 99, value: 5 } }]]),
    };
    expect(constraintMarks(missing).length).toBe(1);
    const emptyPoly = {
      ...newDocument(),
      nextId: 4,
      entities: new Map([
        [
          2,
          {
            id: 2,
            layer: 1,
            z: 2,
            color: 'byLayer' as const,
            linetype: 'byLayer' as const,
            lineweight: 'byLayer' as const,
            geom: { kind: 'polyline' as const, vertices: [], closed: false },
          },
        ],
      ]),
      constraints: new Map([[3, { id: 3, body: { kind: 'length' as const, target: 2, value: 5 } }]]),
    };
    expect(constraintMarks(emptyPoly).length).toBe(1);

    expect(constraintRefuseMessage({ id: 4, body: { kind: 'fix', a: { kind: 'end', id: 1, end: 'end' }, p: { x: 0, y: 0 } } })).toMatch(/end of this line/);
    expect(constraintRefuseMessage({ id: 4, body: { kind: 'fix', a: { kind: 'center', id: 1 }, p: { x: 0, y: 0 } } })).toMatch(/centre of this circle/);
    expect(constraintRefuseMessage({ id: 4, body: { kind: 'fix', a: { kind: 'mid', id: 1 }, p: { x: 0, y: 0 } } })).toMatch(/middle of this line/);
    expect(constraintRefuseMessage({ id: 4, body: { kind: 'fix', a: { kind: 'vertex', id: 1, index: 0 }, p: { x: 0, y: 0 } } })).toMatch(/This corner/);
    const lengthOnly = { id: 8, body: { kind: 'length' as const, target: line.id, value: 10 } };
    expect(constraintDisplayValue(added.session.doc, lengthOnly)).toBe(10);
    expect(constraintStoredValue(added.session.doc, lengthOnly, 14)).toBe(14);

    expect(() =>
      drivingBodyFor(docEnv(newDocument()), {
        id: 1,
        layer: 1,
        z: 1,
        color: 'byLayer',
        lineweight: 'byLayer',
        body: { kind: 'radius', target: 99, at: { x: 4, y: 0 }, style: 'ISO' },
      }),
    ).toThrow(/gone|circle|arc/i);
    expect(() =>
      drivingBodyFor(
        {
          entity: () => ({
            id: 2,
            layer: 1,
            z: 2,
            color: 'byLayer',
            linetype: 'byLayer',
            lineweight: 'byLayer',
            geom: { kind: 'circle', center: { x: 0, y: 0 }, radius: 0 },
          }),
          dimStyle: (name) => newDocument().settings.dimStyles.find((s) => s.name === name),
        },
        {
          id: 1,
          layer: 1,
          z: 1,
          color: 'byLayer',
          lineweight: 'byLayer',
          body: { kind: 'radius', target: 2, at: { x: 4, y: 0 }, style: 'ISO' },
        },
      ),
    ).toThrow(/no length to hold/);

    let paired = run(added.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: line.id, end: 'start' }, b: { kind: 'end', id: line.id, end: 'end' } },
    });
    expect(constraintMarks(paired.doc).length).toBe(2);
    expect(constraintsTouching(paired.doc, new Set([line.id])).length).toBe(2);
    expect(constraintsTouching(paired.doc, new Set([cid])).map((x) => x.id)).toContain(cid);

    const dropped = execute(added.session, 'constraint.delete', { ids: [cid] });
    expect(dropped.session.doc.notes.size).toBe(0);
    expect(dropped.session.doc.constraints.size).toBe(0);
    const viaEntity = execute(paired, 'entity.delete', { ids: [[...paired.doc.constraints.values()].find((c) => c.body.kind === 'horizontal')!.id] });
    expect([...viaEntity.session.doc.constraints.values()].some((c) => c.body.kind === 'horizontal')).toBe(false);

    const ghostNote = {
      id: 3,
      layer: 1,
      z: 3,
      color: 'byLayer' as const,
      lineweight: 'byLayer' as const,
      body: { kind: 'text' as const, at: { x: 0, y: 0 }, height: 3, angle: 0, anchor: 'left' as const, text: 'Hi' },
    };
    const pruneDoc = {
      ...newDocument(),
      nextId: 5,
      notes: new Map([[3, ghostNote]]),
      constraints: new Map([[4, { id: 4, note: 3, body: { kind: 'length' as const, target: 99, value: 5 } }]]),
    };
    const pruned = new Draft(pruneDoc);
    expect(pruneAndSolve(pruned)).toBe(1);
    expect(pruned.note(3)).toBeUndefined();
    expect(unmetOnDraft(new Draft(dangling)).length).toBe(1);

    const freeDraft = new Draft(line.session.doc);
    freeDraft.putConstraint({
      id: 80,
      body: { kind: 'coincident', a: { kind: 'end', id: line.id, end: 'start' }, b: { kind: 'free', p: { x: 1, y: 1 } } },
    });
    freeDraft.putConstraint({
      id: 81,
      body: { kind: 'fix', a: { kind: 'free', p: { x: 0, y: 0 } }, p: { x: 0, y: 0 } },
    });
    solveConstraints(freeDraft);
  });

  it('solver pin branches: concentric follows, length grows from a fixed end, both-pin skips stay met', () => {
    const c1 = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 2) });
    const c2 = execute(c1.session, 'entity.add', { geom: circle(vec(0, 0), 3) });
    let s = run(c2.session, 'constraint.add', { body: { kind: 'concentric', a: c1.result.id, b: c2.result.id } });
    s = run(s, 'entity.transform', { ids: [c1.result.id], transform: { kind: 'translate', dx: 5, dy: 0 } });
    const g2 = geomOf(s, c2.result.id);
    expect(g2.kind).toBe('circle');
    if (g2.kind === 'circle') expectPoint(g2.center, vec(5, 0));
    s = run(s, 'entity.transform', { ids: [c2.result.id], transform: { kind: 'translate', dx: 2, dy: 0 } });
    const g1 = geomOf(s, c1.result.id);
    expect(g1.kind).toBe('circle');
    if (g1.kind === 'circle') expectPoint(g1.center, vec(7, 0));
    s = run(s, 'entity.transform', { ids: [c1.result.id, c2.result.id], transform: { kind: 'translate', dx: 1, dy: 0 } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const d1 = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const d2 = addLine(d1.session, 20, 0, 30, 0);
    s = run(d2.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: d1.id, end: 'end' },
        b: { kind: 'end', id: d2.id, end: 'start' },
        value: 10,
      },
    });
    s = run(s, 'entity.transform', { ids: [d2.id], transform: { kind: 'translate', dx: 5, dy: 0 } });
    const moved = geomOf(s, d1.id);
    expect(moved.kind).toBe('segment');
    if (moved.kind === 'segment') expectClose(moved.end.x, 15);

    const ln = addLine(createSession(newDocument()), 0, 0, 10, 0);
    s = run(ln.session, 'constraint.add', { body: { kind: 'fix', a: { kind: 'end', id: ln.id, end: 'end' }, p: { x: 10, y: 0 } } });
    s = run(s, 'constraint.add', { body: { kind: 'length', target: ln.id, value: 10 } });
    s = run(s, 'constraint.setValue', { id: [...s.doc.constraints.values()].find((c) => c.body.kind === 'length')!.id, value: 20 });
    const g = geomOf(s, ln.id);
    expect(g.kind).toBe('segment');
    if (g.kind === 'segment') {
      expectClose(g.end.x, 10);
      expectClose(g.start.x, -10);
    }

    const axis = addLine(createSession(newDocument()), 0, 0, 12, 0);
    s = run(axis.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: axis.id, end: 'start' },
        b: { kind: 'end', id: axis.id, end: 'end' },
        value: 12,
        axis: 'x',
      },
    });
    s = run(s, 'entity.transform', { ids: [axis.id], transform: { kind: 'translate', dx: 3, dy: 0 } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const yline = addLine(createSession(newDocument()), 0, 0, 0, 8);
    s = run(yline.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: yline.id, end: 'start' },
        b: { kind: 'end', id: yline.id, end: 'end' },
        value: 8,
        axis: 'y',
      },
    });
    s = run(s, 'entity.transform', { ids: [yline.id], transform: { kind: 'translate', dx: 0, dy: 2 } });
    expect(maxResidual(s.doc)).toBeLessThan(1e-6);

    const xa = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const xb = addLine(xa.session, 20, 0, 30, 0);
    s = run(xb.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: xa.id, end: 'end' },
        b: { kind: 'end', id: xb.id, end: 'start' },
        value: 10,
        axis: 'x',
      },
    });
    s = run(s, 'entity.transform', { ids: [xb.id], transform: { kind: 'translate', dx: 5, dy: 0 } });
    const xMoved = geomOf(s, xa.id);
    expect(xMoved.kind).toBe('segment');
    if (xMoved.kind === 'segment') expectClose(xMoved.end.x, 15);

    const ya = addLine(createSession(newDocument()), 0, 0, 0, 10);
    const yb = addLine(ya.session, 0, 20, 0, 30);
    s = run(yb.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: ya.id, end: 'end' },
        b: { kind: 'end', id: yb.id, end: 'start' },
        value: 10,
        axis: 'y',
      },
    });
    s = run(s, 'entity.transform', { ids: [yb.id], transform: { kind: 'translate', dx: 0, dy: 5 } });
    const yMoved = geomOf(s, ya.id);
    expect(yMoved.kind).toBe('segment');
    if (yMoved.kind === 'segment') expectClose(yMoved.end.y, 15);

    s = run(createSession(newDocument()), 'sheet.add', { name: 'Layout' });
    const onLayout = addLine(s, 0, 0, 8, 0);
    s = run(onLayout.session, 'constraint.add', {
      body: { kind: 'length', target: onLayout.id, value: 8 },
    });
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(constraintMarks(s.doc)).toEqual([]);
    expect(constraintsTouching(s.doc, new Set([onLayout.id]))).toEqual([]);
    const other = addLine(s, 0, 0, 6, 0);
    s = run(other.session, 'entity.transform', { ids: [other.id], transform: { kind: 'translate', dx: 1, dy: 0 } });
    expect(s.doc.entities.has(other.id)).toBe(true);

    const ha = addLine(createSession(newDocument()), 0, 0, 10, 0);
    const hb = addLine(ha.session, 0, 5, 10, 5);
    s = run(hb.session, 'constraint.add', {
      body: { kind: 'horizontal', a: { kind: 'end', id: ha.id, end: 'start' }, b: { kind: 'end', id: hb.id, end: 'start' } },
    });
    s = run(s, 'entity.transform', { ids: [hb.id], transform: { kind: 'translate', dx: 0, dy: 4 } });
    const haG = geomOf(s, ha.id);
    expect(haG.kind).toBe('segment');
    if (haG.kind === 'segment') expectClose(haG.start.y, 4);

    const va = addLine(createSession(newDocument()), 0, 0, 0, 10);
    const vb = addLine(va.session, 5, 0, 5, 10);
    s = run(vb.session, 'constraint.add', {
      body: { kind: 'vertical', a: { kind: 'end', id: va.id, end: 'start' }, b: { kind: 'end', id: vb.id, end: 'start' } },
    });
    s = run(s, 'entity.transform', { ids: [va.id], transform: { kind: 'translate', dx: 4, dy: 0 } });
    const vbG = geomOf(s, vb.id);
    expect(vbG.kind).toBe('segment');
    if (vbG.kind === 'segment') expectClose(vbG.start.x, 4);
    s = run(s, 'entity.transform', { ids: [vb.id], transform: { kind: 'translate', dx: 3, dy: 0 } });
    const vaG = geomOf(s, va.id);
    expect(vaG.kind).toBe('segment');
    if (vaG.kind === 'segment') expectClose(vaG.start.x, 7);
  });

  it('setFix is refused when the new point cannot be kept, and a file drive/note mismatch is refused', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 10, 0);
    let s = run(line.session, 'constraint.add', { body: { kind: 'fix', a: { kind: 'end', id: line.id, end: 'start' }, p: { x: 0, y: 0 } } });
    s = run(s, 'constraint.add', { body: { kind: 'fix', a: { kind: 'end', id: line.id, end: 'end' }, p: { x: 10, y: 0 } } });
    s = run(s, 'constraint.add', { body: { kind: 'length', target: line.id, value: 10 } });
    const fid = [...s.doc.constraints.values()].find((c) => {
      if (c.body.kind !== 'fix') return false;
      return c.body.a.kind === 'end' && c.body.a.end === 'start';
    })!.id;
    const before = saveDocument(s.doc);
    expect(() => execute(s, 'constraint.setFix', { id: fid, p: { x: 100, y: 0 } })).toThrow(/held at|fixed|constraint/);
    expect(saveDocument(s.doc)).toBe(before);

    const dim = execute(line.session, 'note.add', {
      body: {
        kind: 'aligned',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        at: { x: 5, y: -4 },
        style: 'ISO',
      },
    });
    const json = JSON.parse(saveDocument(dim.session.doc)) as {
      notes: { drive?: number; reference?: boolean; body: { kind: string } }[];
      constraints: { note?: number }[];
    };
    const dropNote = structuredClone(json);
    delete dropNote.constraints[0]!.note;
    expect(() => loadDocument(JSON.stringify(dropNote))).toThrow(/linked back/);
    const text = execute(line.session, 'note.add', {
      body: { kind: 'text', at: { x: 0, y: 4 }, height: 3, angle: 0, anchor: 'left', text: 'Hi' },
    });
    const textJson = JSON.parse(saveDocument(text.session.doc)) as { notes: { reference?: boolean; drive?: number }[] };
    const asRef = structuredClone(textJson);
    asRef.notes[0]!.reference = true;
    expect(() => loadDocument(JSON.stringify(asRef))).toThrow(/only allowed on a dimension/);
    const asDrive = structuredClone(textJson);
    asDrive.notes[0]!.drive = 99;
    expect(() => loadDocument(JSON.stringify(asDrive))).toThrow(/only allowed on a dimension|drive/);

    const ghostDrive = structuredClone(json);
    delete ghostDrive.constraints[0]!.note;
    ghostDrive.notes[0]!.drive = 999;
    expect(() => loadDocument(JSON.stringify(ghostDrive))).toThrow(/no constraint/);
    const both = structuredClone(json);
    both.notes[0]!.reference = true;
    expect(() => loadDocument(JSON.stringify(both))).toThrow(/cannot be set on a reference/);

    const tagged = structuredClone(json) as { notes: { sheet?: string }[]; constraints: { sheet?: string }[] };
    tagged.notes[0]!.sheet = 'Sheet 1';
    tagged.constraints[0]!.sheet = 'Sheet 1';
    const loaded = loadDocument(JSON.stringify(tagged));
    const renamed = run(createSession(loaded), 'sheet.rename', { name: 'Sheet 1', newName: 'Main' });
    expect([...renamed.doc.notes.values()][0]!.sheet).toBeUndefined();
    expect([...renamed.doc.constraints.values()][0]!.sheet).toBeUndefined();
  });
});

describe('an edit is refused only for what it breaks', () => {
  /** Line A holds a distance of 100 and a distance of 60: both can never be met. Line B is free. */
  function conflicted(): { s: Session; a: number; b: number } {
    const a = addLine(createSession(newDocument()), 0, 0, 100, 0);
    const b = addLine(a.session, 0, 50, 40, 50);
    const distance = (value: number) => ({
      body: {
        kind: 'distance',
        a: { kind: 'end', id: a.id, end: 'start' },
        b: { kind: 'end', id: a.id, end: 'end' },
        value,
      },
    });
    const s = run(run(b.session, 'constraint.add', distance(100)), 'constraint.add', distance(60));
    expect(unmetConstraints(s.doc).length).toBeGreaterThan(0);
    return { s, a: a.id, b: b.id };
  }

  it('moves an unrelated line while two other constraints conflict', () => {
    const { s, b } = conflicted();
    const moved = run(s, 'entity.transform', { ids: [b], transform: { kind: 'translate', dx: 10, dy: 0 } });
    expectPoint((geomOf(moved, b) as { start: { x: number; y: number } }).start, { x: 10, y: 50 });
  });

  it('changes the lineweight of a line whose constraints conflict, because its shape did not change', () => {
    const { s, a } = conflicted();
    const styled = run(s, 'entity.setProps', { ids: [a], lineweight: 0.5 });
    expect(styled.doc.entities.get(a)?.lineweight).toBe(0.5);
  });

  it('treats a move that leaves a shape exactly where it was as no change', () => {
    const { s, a } = conflicted();
    const same = run(s, 'entity.transform', { ids: [a], transform: { kind: 'translate', dx: 0, dy: 0 } });
    expect(geomOf(same, a)).toEqual(geomOf(s, a));
  });

  it('still refuses an edit that makes the conflict worse', () => {
    const { s, a } = conflicted();
    expect(() =>
      execute(s, 'entity.transform', { ids: [a], transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 3 } }),
    ).toThrow(/is held at/);
  });

  it('moves a dimensioned rectangle whole: every corner is placed, so the number still holds', () => {
    const rect = execute(createSession(newDocument()), 'entity.add', {
      geom: polyline([vec(0, 0), vec(100, 0), vec(100, 50), vec(0, 50)], true),
    });
    const id = rect.result.id;
    const dimensioned = execute(rect.session, 'note.add', {
      body: {
        kind: 'linear',
        orient: 'horizontal',
        a: { kind: 'vertex', id, index: 0 },
        b: { kind: 'vertex', id, index: 1 },
        at: { x: 50, y: -10 },
        style: 'ISO',
      },
    }).session;
    const moved = run(dimensioned, 'entity.transform', { ids: [id], transform: { kind: 'translate', dx: 5, dy: 3 } });
    const g = geomOf(moved, id) as unknown as { vertices: { x: number; y: number }[] };
    expectPoint(g.vertices[0]!, { x: 5, y: 3 });
    expectPoint(g.vertices[1]!, { x: 105, y: 3 });
    expectPoint(g.vertices[2]!, { x: 105, y: 53 });
    expectPoint(g.vertices[3]!, { x: 5, y: 53 });
    expect(maxResidual(moved.doc)).toBe(0);
  });

  it('still refuses an edit that breaks a constraint that was met', () => {
    const line = addLine(createSession(newDocument()), 0, 0, 100, 0);
    const held = run(line.session, 'constraint.add', {
      body: {
        kind: 'distance',
        a: { kind: 'end', id: line.id, end: 'start' },
        b: { kind: 'end', id: line.id, end: 'end' },
        value: 100,
      },
    });
    expect(() =>
      execute(held, 'entity.transform', { ids: [line.id], transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 2 } }),
    ).toThrow(/This distance is held at 100/);
  });
});
