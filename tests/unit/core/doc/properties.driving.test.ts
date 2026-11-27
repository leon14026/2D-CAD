import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createSession,
  execute,
  maxResidual,
  newDocument,
  saveDocument,
  undo,
  type Session,
} from '../../../../src/core/doc';
import { segment, tolFor, vec } from '../../../../src/core/geom';
import { PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

function constrainedRect(w: number, h: number): { session: Session; widthId: number; bottomId: number } {
  let s = createSession(newDocument());
  const bottom = execute(s, 'entity.add', { geom: segment(vec(0, 0), vec(w, 0)) });
  const right = execute(bottom.session, 'entity.add', { geom: segment(vec(w, 0), vec(w, h)) });
  const top = execute(right.session, 'entity.add', { geom: segment(vec(w, h), vec(0, h)) });
  const left = execute(top.session, 'entity.add', { geom: segment(vec(0, h), vec(0, 0)) });
  s = left.session;
  const end = (id: number, which: 'start' | 'end') => ({ kind: 'end' as const, id, end: which });
  s = run(s, 'constraint.add', { body: { kind: 'horizontal', a: end(bottom.result.id, 'start'), b: end(bottom.result.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'horizontal', a: end(top.result.id, 'start'), b: end(top.result.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'vertical', a: end(left.result.id, 'start'), b: end(left.result.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'vertical', a: end(right.result.id, 'start'), b: end(right.result.id, 'end') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(bottom.result.id, 'end'), b: end(right.result.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(right.result.id, 'end'), b: end(top.result.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(top.result.id, 'end'), b: end(left.result.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'coincident', a: end(left.result.id, 'end'), b: end(bottom.result.id, 'start') } });
  s = run(s, 'constraint.add', { body: { kind: 'fix', a: end(bottom.result.id, 'start'), p: { x: 0, y: 0 } } });
  s = run(s, 'constraint.add', {
    body: { kind: 'distance', a: end(bottom.result.id, 'start'), b: end(bottom.result.id, 'end'), value: w, axis: 'x' },
  });
  s = run(s, 'constraint.add', {
    body: { kind: 'distance', a: end(left.result.id, 'start'), b: end(left.result.id, 'end'), value: h, axis: 'y' },
  });
  const widthId = [...s.doc.constraints.values()].find((c) => c.body.kind === 'distance' && c.body.axis === 'x')!.id;
  return { session: s, widthId, bottomId: bottom.result.id };
}

describe('a constrained rectangle given a new width', PROPERTY_TIMEOUT, () => {
  it('has that width to tolFor, every constraint is met, and undo restores the original', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 200, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 200, noNaN: true, noDefaultInfinity: true }),
        (w, h, newW) => {
          const { session, widthId, bottomId } = constrainedRect(w, h);
          const original = saveDocument(session.doc);
          const next = run(session, 'constraint.setValue', { id: widthId, value: newW });
          const bottom = next.doc.entities.get(bottomId);
          expect(bottom?.geom.kind).toBe('segment');
          if (bottom?.geom.kind !== 'segment') return false;
          const span = Math.abs(bottom.geom.end.x - bottom.geom.start.x);
          expect(Math.abs(span - newW)).toBeLessThanOrEqual(tolFor(newW, w, h));
          expect(maxResidual(next.doc)).toBeLessThanOrEqual(1e-6);
          expect(saveDocument(undo(next).doc)).toBe(original);
          return true;
        },
      ),
      PROPERTY_PARAMS,
    );
  });
});
