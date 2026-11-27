/**
 * Phase 6 gate: "reference drawings match". The reference drawing (tests/fixtures/
 * annotate-reference.ts) uses every annotation tool. Drawn through the drafting engine it must
 * match the approved file exactly, and every number it shows must match the hand-worked value.
 * tests/e2e/annotate.spec.ts makes the same drawing in the app and compares it with the same file.
 *
 * After an intended change, refresh the approved file with:
 *   UPDATE_REFERENCES=1 npx vitest run tests/unit/core/tools/annotate-reference.test.ts
 * and check the diff by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSession, newDocument, notesInDrawOrder, resolveNotes, saveDocument, type Note } from '../../../../src/core/doc';
import { pickAt } from '../../../../src/core/spatial';
import { drafting, feed, feedTyped, startTool, type Drafting } from '../../../../src/core/tools';
import { ANNOTATE_STEPS } from '../../../fixtures/annotate-reference';

const APPROVED = 'tests/fixtures/annotate-reference.archilite';

function drawAnnotateReference(): Drafting {
  let d = drafting(createSession(newDocument({ title: 'Annotation reference' })));
  const at = (p: readonly [number, number]) => {
    const id = pickAt(d.session.doc, { x: p[0], y: p[1] }, 1);
    expect(id, `nothing to pick at (${p[0]}, ${p[1]})`).not.toBeNull();
    return id as number;
  };
  for (const step of ANNOTATE_STEPS) {
    let error: string | null = null;
    if ('tool' in step) d = startTool(d, step.tool, []);
    else if ('type' in step) ({ drafting: d, error } = feedTyped(d, step.type, null, []));
    else if ('option' in step) ({ drafting: d, error } = feed(d, { kind: 'option', key: step.option }, []));
    else if ('enter' in step) ({ drafting: d, error } = feed(d, { kind: 'enter' }, []));
    else if ('pick' in step) ({ drafting: d, error } = feed(d, { kind: 'pick', id: at(step.pick), point: { x: step.pick[0], y: step.pick[1] } }, []));
    else throw new Error(`the annotation reference has no ${JSON.stringify(step)} step`);
    expect(error, JSON.stringify(step)).toBeNull();
  }
  return d;
}

describe('the annotation reference drawing', () => {
  const d = drawAnnotateReference();
  const doc = d.session.doc;
  const text = saveDocument(doc);
  const notes = notesInDrawOrder(doc);
  const of = (kind: Note['body']['kind']) => notes.filter((n) => n.body.kind === kind);
  const shown = (n: Note) => {
    const r = resolveNotes(doc).get(n.id);
    expect(r?.ok, `note ${n.id} resolves`).toBe(true);
    return r as { ok: true; r: { text?: string; area?: number } };
  };

  it('matches the approved drawing exactly', () => {
    if (process.env['UPDATE_REFERENCES']) writeFileSync(APPROVED, text);
    expect(text).toBe(readFileSync(APPROVED, 'utf8'));
  });

  it('has one of every annotation, and no tool is left running', () => {
    expect(notes.map((n) => n.body.kind)).toEqual(['linear', 'aligned', 'angle', 'diameter', 'radius', 'centre', 'text', 'leader', 'hatch', 'titleBlock']);
    expect(d.active).toBeNull();
    expect(doc.entities.size).toBe(5);
  });

  it('every dimension shows the hand-worked value', () => {
    expect(shown(of('linear')[0] as Note).r.text).toBe('(60.00)'); // the plate's width, reference
    expect(shown(of('aligned')[0] as Note).r.text).toBe('(28.28)'); // 20√2 = 28.2843
    expect(shown(of('angle')[0] as Note).r.text).toBe('(45.0°)');
    expect(shown(of('diameter')[0] as Note).r.text).toBe('(Ø8.00)');
    expect(shown(of('radius')[0] as Note).r.text).toBe('(R5.00)');
  });

  it('the hatch covers the plate less both holes: 60 × 40 − 16π − 25π', () => {
    const area = shown(of('hatch')[0] as Note).r.area as number;
    expect(Math.abs(area - (2400 - 41 * Math.PI))).toBeLessThanOrEqual(1e-9);
  });

  it('the text and the leader carry what was typed', () => {
    expect((of('text')[0] as Note).body).toMatchObject({ text: '6 mm steel plate' });
    expect((of('leader')[0] as Note).body).toMatchObject({ text: 'Break sharp edges' });
  });
});
