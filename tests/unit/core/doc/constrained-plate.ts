/**
 * A complete part produced start to finish through the command registry: a 80 × 50 plate
 * with four Ø8 holes as a reusable block, geometric and dimensional constraints on the
 * outline, and a second sheet that holds another insert of the hole.
 */
import { createSession, execute, type Session } from '../../../../src/core/doc';
import { circle, segment, vec } from '../../../../src/core/geom';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

function line(s: Session, x1: number, y1: number, x2: number, y2: number): { session: Session; id: number } {
  const r = execute(s, 'entity.add', { geom: segment(vec(x1, y1), vec(x2, y2)) });
  return { session: r.session, id: r.result.id };
}

/** Builds the constrained plate. Returns the finished session. */
export function buildConstrainedPlate(): Session {
  let s = createSession();
  s = run(s, 'doc.setTitle', { title: 'Constrained plate' });

  const bottom = line(s, 0, 0, 80, 0);
  const right = line(bottom.session, 80, 0, 80, 50);
  const top = line(right.session, 80, 50, 0, 50);
  const left = line(top.session, 0, 50, 0, 0);
  s = left.session;

  const end = (id: number, which: 'start' | 'end') => ({ kind: 'end' as const, id, end: which });
  s = run(s, 'constraint.add', { body: { kind: 'horizontal', a: end(bottom.id, 'start'), b: end(bottom.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'horizontal', a: end(top.id, 'start'), b: end(top.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'vertical', a: end(left.id, 'start'), b: end(left.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'vertical', a: end(right.id, 'start'), b: end(right.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(bottom.id, 'end'), b: end(right.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(right.id, 'end'), b: end(top.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(top.id, 'end'), b: end(left.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(left.id, 'end'), b: end(bottom.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'distance', a: end(bottom.id, 'start'), b: end(bottom.id, 'end'), value: 80 } });
  s = run(s, 'constraint.add', { body: { kind: 'distance', a: end(left.id, 'start'), b: end(left.id, 'end'), value: 50 } });
  s = run(s, 'constraint.add', { body: { kind: 'fix', a: end(bottom.id, 'start'), p: { x: 0, y: 0 } } });

  const hole = execute(s, 'entity.add', { geom: circle(vec(12, 12), 4) });
  s = run(hole.session, 'constraint.add', { body: { kind: 'radius', target: hole.result.id, value: 4 } });
  s = run(s, 'block.create', { name: 'hole', ids: [hole.result.id], at: { x: 12, y: 12 } });
  s = run(s, 'block.insert', { name: 'hole', at: { x: 68, y: 12 } });
  s = run(s, 'block.insert', { name: 'hole', at: { x: 12, y: 38 } });
  s = run(s, 'block.insert', { name: 'hole', at: { x: 68, y: 38 } });

  s = run(s, 'sheet.add', { name: 'Layout', size: 'A4' });
  s = run(s, 'block.insert', { name: 'hole', at: { x: 40, y: 25 } });
  s = run(s, 'sheet.setCurrent', { name: 'Sheet 1' });
  return s;
}
