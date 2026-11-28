import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createSession, execute, maxResidual, newDocument, saveDocument, undo, type Session } from '../../../../src/core/doc';
import { rectangle, tolFor, vec, type Polyline } from '../../../../src/core/geom';
import { PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';

function run(session: Session, id: Parameters<typeof execute>[1], params: unknown): Session {
  return execute(session, id, params as never).session;
}

const real = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/**
 * The four sides as [anchor, mover] corner pairs, with the way they run. Corners are numbered
 * (x0,y0) (x1,y0) (x1,y1) (x0,y1). Every side is offered from both ends.
 */
const SIDES: readonly { readonly orient: 'horizontal' | 'vertical'; readonly from: number; readonly to: number }[] = [
  { orient: 'horizontal', from: 0, to: 1 },
  { orient: 'horizontal', from: 1, to: 0 },
  { orient: 'horizontal', from: 3, to: 2 },
  { orient: 'horizontal', from: 2, to: 3 },
  { orient: 'vertical', from: 1, to: 2 },
  { orient: 'vertical', from: 2, to: 1 },
  { orient: 'vertical', from: 0, to: 3 },
  { orient: 'vertical', from: 3, to: 0 },
];

describe('a rectangle with presets given a new width or height, from any side and either end', PROPERTY_TIMEOUT, () => {
  it('keeps the corner you clicked first, moves only the far side, and meets every constraint', () => {
    fc.assert(
      fc.property(
        real(-500, 500),
        real(-500, 500),
        real(1, 300),
        real(1, 300),
        fc.integer({ min: 0, max: SIDES.length - 1 }),
        real(0.5, 600),
        (rawX0, rawY0, w, h, sideIndex, value) => {
          // The document never stores -0, so the model's corners must not start from one either.
          const x0 = rawX0 + 0;
          const y0 = rawY0 + 0;
          const x1 = x0 + w;
          const y1 = y0 + h;
          const added = execute(createSession(newDocument()), 'entity.add', {
            geom: rectangle(vec(x0, y0), vec(x1, y1)),
            presets: true,
          });
          const id = added.result.id;
          const side = SIDES[sideIndex]!;
          const dimensioned = run(added.session, 'note.add', {
            body: {
              kind: 'linear',
              orient: side.orient,
              a: { kind: 'vertex', id, index: side.from },
              b: { kind: 'vertex', id, index: side.to },
              at: { x: x0, y: y0 - 10 },
              style: 'ISO',
            },
          });
          const constraint = [...dimensioned.doc.constraints.values()].find((c) => c.body.kind === 'distance')!;
          const next = run(dimensioned, 'constraint.setValue', { id: constraint.id, value });

          const was: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
          const now = (next.doc.entities.get(id)!.geom as Polyline).vertices;
          const anchor = was[side.from]!;
          const mover = was[side.to]!;
          // The model: the side holding the far corner moves to `value` from the anchor, on the
          // same side of it as before; every corner on that side goes with it.
          const axis = side.orient === 'horizontal' ? 0 : 1;
          const sign = mover[axis]! >= anchor[axis]! ? 1 : -1;
          const target = anchor[axis]! + sign * value;
          const tol = tolFor(x0, y0, x1, y1, value);
          for (let k = 0; k < 4; k++) {
            const moves = was[k]![axis]! === mover[axis]!;
            for (const a of [0, 1]) {
              const expected = a === axis && moves ? target : was[k]![a]!;
              expect(Math.abs(now[k]![a === 0 ? 'x' : 'y']! - expected)).toBeLessThanOrEqual(tol);
            }
          }
          // The corner clicked first is exactly where it was.
          expect(now[side.from]!.x).toBe(anchor[0]);
          expect(now[side.from]!.y).toBe(anchor[1]);
          const span = Math.abs(now[side.to]![axis === 0 ? 'x' : 'y']! - now[side.from]![axis === 0 ? 'x' : 'y']!);
          expect(Math.abs(span - value)).toBeLessThanOrEqual(tol);
          expect(maxResidual(next.doc)).toBeLessThanOrEqual(tol);
          expect(next.doc.constraints.size).toBe(5);
          expect(saveDocument(undo(next).doc)).toBe(saveDocument(dimensioned.doc));
          return true;
        },
      ),
      PROPERTY_PARAMS,
    );
  });
});
