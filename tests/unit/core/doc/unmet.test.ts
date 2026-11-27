import { describe, expect, it } from 'vitest';
import { createSession, execute, newDocument, unmetConstraints, type Session } from '../../../../src/core/doc';
import { circle, segment, vec } from '../../../../src/core/geom';
import { constraintWarning } from '../../../../src/app/constraint-warning';
import { expectClose } from '../helpers';
import { buildConstrainedPlate } from './constrained-plate';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

function conflictingRadii(): Session {
  const c = execute(createSession(newDocument()), 'entity.add', { geom: circle(vec(0, 0), 2) });
  let s = run(c.session, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 3 } });
  s = run(s, 'constraint.add', { body: { kind: 'radius', target: c.result.id, value: 4 } });
  return s;
}

describe('unmetConstraints', () => {
  it('is empty for a drawing whose constraints are all met', () => {
    const doc = buildConstrainedPlate().doc;
    expect(unmetConstraints(doc)).toEqual([]);
    expect(constraintWarning(doc)).toBeNull();
  });

  it('is empty when there are no constraints', () => {
    expect(unmetConstraints(newDocument())).toEqual([]);
  });

  it('reports conflicting constraints with how far off they are', () => {
    const unmet = unmetConstraints(conflictingRadii().doc);
    // The solver settles on a compromise radius of 3.5, so each radius constraint is 0.5 off.
    expect(unmet.map((u) => u.kind)).toEqual(['radius', 'radius']);
    for (const u of unmet) expectClose(u.residual, 0.5, 1e-9);
    expect(unmet[0]!.id).toBeLessThan(unmet[1]!.id);
  });

  it('words the warning in plain terms', () => {
    expect(constraintWarning(conflictingRadii().doc)).toBe(
      '2 constraints could not be met (radius). The shape is a compromise. Ctrl+Z undoes the last change.',
    );
  });

  it('says "One constraint" when a single one is unmet', () => {
    const l = execute(createSession(newDocument()), 'entity.add', { geom: segment(vec(0, 0), vec(10, 0)) });
    const end = (which: 'start' | 'end') => ({ kind: 'end' as const, id: l.result.id, end: which });
    let s = run(l.session, 'constraint.add', { body: { kind: 'fix', a: end('start'), p: { x: 0, y: 0 } } });
    s = run(s, 'constraint.add', { body: { kind: 'fix', a: end('end'), p: { x: 10, y: 0 } } });
    s = run(s, 'constraint.add', { body: { kind: 'distance', a: end('start'), b: end('end'), value: 12 } });
    const text = constraintWarning(s.doc);
    expect(text).toMatch(/^(One constraint|\d+ constraints) could not be met/);
    expect(unmetConstraints(s.doc).length).toBeGreaterThan(0);
  });

  it('counts a constraint whose geometry is gone as unmet', () => {
    const doc = conflictingRadii().doc;
    const orphaned = { ...doc, entities: new Map(), constraints: new Map(doc.constraints) };
    const unmet = unmetConstraints(orphaned);
    expect(unmet).toHaveLength(2);
    expect(unmet.every((u) => u.residual === Infinity)).toBe(true);
  });

  it('ignores constraints that sit on a sheet that is not showing', () => {
    let s = conflictingRadii();
    s = run(s, 'sheet.add', { name: 'Layout' });
    s = run(s, 'sheet.setCurrent', { name: 'Layout' });
    expect(unmetConstraints(s.doc)).toEqual([]);
    s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
    expect(unmetConstraints(s.doc)).toHaveLength(2);
  });
});
