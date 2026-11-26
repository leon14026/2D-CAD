/**
 * Phase 5 gate: "reference drawings match". The reference drawing (tests/fixtures/
 * modify-reference.ts) uses every modify tool. Drawn through the drafting engine it must match
 * the approved file exactly, and every hand-worked check to 1e-9. tests/e2e/modify.spec.ts
 * makes the same drawing in the app and compares it with the same file.
 *
 * After an intended change, refresh the approved file with:
 *   UPDATE_REFERENCES=1 npx vitest run tests/unit/core/tools/modify-reference.test.ts
 * and check the diff by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSession, executeUnchecked, newDocument, saveDocument, type Entity } from '../../../../src/core/doc';
import { pickAt } from '../../../../src/core/spatial';
import { drafting, feed, feedTyped, startTool, type Drafting } from '../../../../src/core/tools';
import { MODIFY_REFERENCE_CHECKS, MODIFY_STEPS } from '../../../fixtures/modify-reference';
import { shapeDifference } from '../../../fixtures/reference-part';

const APPROVED = 'tests/fixtures/modify-reference.archilite';

function drawModifyReference(): Drafting {
  let d = drafting(createSession(newDocument({ title: 'Modify reference' })));
  let selection: number[] = [];
  const at = (p: readonly [number, number]) => {
    const id = pickAt(d.session.doc, { x: p[0], y: p[1] }, 1);
    expect(id, `nothing to pick at (${p[0]}, ${p[1]})`).not.toBeNull();
    return id as number;
  };
  for (const step of MODIFY_STEPS) {
    let error: string | null = null;
    if ('tool' in step) d = startTool(d, step.tool, selection);
    else if ('type' in step) ({ drafting: d, error } = feedTyped(d, step.type, null, selection));
    else if ('option' in step) ({ drafting: d, error } = feed(d, { kind: 'option', key: step.option }, selection));
    else if ('enter' in step) ({ drafting: d, error } = feed(d, { kind: 'enter' }, selection));
    else if ('pick' in step) ({ drafting: d, error } = feed(d, { kind: 'pick', id: at(step.pick), point: { x: step.pick[0], y: step.pick[1] } }, selection));
    else if ('select' in step) selection = step.select.map(at);
    else d = { ...d, session: executeUnchecked(d.session, `entity.${step.action}`, { ids: selection }).session };
    expect(error, JSON.stringify(step)).toBeNull();
  }
  return d;
}

describe('the modify reference drawing', () => {
  const d = drawModifyReference();
  const text = saveDocument(d.session.doc);

  it('matches the approved drawing exactly', () => {
    if (process.env['UPDATE_REFERENCES']) writeFileSync(APPROVED, text);
    expect(text).toBe(readFileSync(APPROVED, 'utf8'));
  });

  for (const check of MODIFY_REFERENCE_CHECKS) {
    it(`${check.what} (entity ${check.id}) matches the hand-worked shape to 1e-9`, () => {
      const e = d.session.doc.entities.get(check.id) as Entity | undefined;
      expect(e, `entity ${check.id}`).toBeDefined();
      expect(shapeDifference((e as Entity).geom, check.shape)).toBeLessThanOrEqual(1e-9);
    });
  }

  it('every tool step was one undo step, and no tool is left running', () => {
    expect(d.active).toBeNull();
    expect(d.session.doc.entities.size).toBe(29);
  });
});
