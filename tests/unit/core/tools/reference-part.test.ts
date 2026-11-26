/**
 * Phase 4 gate: "a reference part drawn by typed input alone matches its specification to
 * 1e-9". The same steps are typed into the app by tests/e2e/drafting.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { createSession, entitiesInDrawOrder, loadDocument, newDocument, saveDocument } from '../../../../src/core/doc';
import { drafting, feed, feedTyped, startTool, type Drafting } from '../../../../src/core/tools';
import { REFERENCE_SHAPES, REFERENCE_STEPS, shapeDifference } from '../../../fixtures/reference-part';

function drawReference(): Drafting {
  let d = drafting(createSession(newDocument({ title: 'Reference part' })));
  for (const step of REFERENCE_STEPS) {
    let error: string | null = null;
    if ('tool' in step) d = startTool(d, step.tool);
    else if ('type' in step) ({ drafting: d, error } = feedTyped(d, step.type, null));
    else if ('option' in step) ({ drafting: d, error } = feed(d, { kind: 'option', key: step.option }));
    else ({ drafting: d, error } = feed(d, { kind: 'enter' }));
    expect(error, JSON.stringify(step)).toBeNull();
  }
  return d;
}

describe('reference part drawn by typed input alone', () => {
  it('matches its specification to 1e-9, entity by entity', () => {
    const d = drawReference();
    expect(d.active).toBeNull();
    const shapes = entitiesInDrawOrder(d.session.doc).map((e) => e.geom);
    expect(shapes).toHaveLength(REFERENCE_SHAPES.length);
    shapes.forEach((s, i) => {
      expect(shapeDifference(s, REFERENCE_SHAPES[i]!), `entity ${i + 1} (${s.kind})`).toBeLessThanOrEqual(1e-9);
    });
  });

  it('is exact where the arithmetic allows: axis-aligned input gives exact coordinates', () => {
    const shapes = entitiesInDrawOrder(drawReference().session.doc).map((e) => e.geom);
    expect(shapes[0]).toEqual(REFERENCE_SHAPES[0]);
    expect(shapes.slice(1, 6)).toEqual(REFERENCE_SHAPES.slice(1, 6));
    expect(shapes[7]).toEqual(REFERENCE_SHAPES[7]);
  });

  it('survives saving and reopening unchanged', () => {
    const doc = drawReference().session.doc;
    expect(saveDocument(loadDocument(saveDocument(doc)))).toBe(saveDocument(doc));
  });

  it('each object is one undo step', () => {
    expect(drawReference().session.undoStack).toHaveLength(REFERENCE_SHAPES.length);
  });
});
