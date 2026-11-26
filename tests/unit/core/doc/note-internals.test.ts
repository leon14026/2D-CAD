import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createSession,
  Draft,
  execute,
  loadDocument,
  loopOf,
  newDocument,
  requireNoteEditable,
  resolveNote,
  resolveNoteStyle,
  saveDocument,
  docEnv,
  type Note,
  type NoteBody,
  type NoteEnv,
} from '../../../../src/core/doc';
import { rectangle } from '../../../../src/core/geom';

const text = (id: number, layer = 1): Note => ({
  id,
  layer,
  z: id,
  color: 'byLayer',
  lineweight: 'byLayer',
  body: { kind: 'text', at: { x: 0, y: 0 }, height: 3, angle: 0, anchor: 'left', text: 'x' },
});

describe('the working copy of a drawing, for notes', () => {
  it('sees notes added, changed and deleted so far, in front of the drawing it started from', () => {
    const base = execute(createSession(newDocument()), 'note.add', { body: text(1).body }).session.doc;
    const draft = new Draft(base);
    expect(draft.note(2)?.id).toBe(2);
    expect([...draft.notes()].map((n) => n.id)).toEqual([2]);
    draft.putNote(text(7));
    expect([...draft.notes()].map((n) => n.id)).toEqual([2, 7]);
    draft.deleteNote(2);
    expect(draft.note(2)).toBeUndefined(); // deleted here, though the drawing still has it
    expect([...draft.notes()].map((n) => n.id)).toEqual([7]);
    expect(draft.note(99)).toBeUndefined();
    expect(base.notes.has(2)).toBe(true);
  });

  it('requireNoteEditable says when there is no such annotation', () => {
    const draft = new Draft(newDocument());
    expect(() => requireNoteEditable(draft, 99)).toThrow(new CommandError('There is no annotation with id 99.'));
  });
});

describe('notes and the rest of the document', () => {
  it('a note on a layer that does not exist has no style to draw with', () => {
    expect(() => resolveNoteStyle(newDocument(), text(5, 77))).toThrow('note 5 refers to missing layer 77');
  });

  it('a file may not give two dimension styles the same name, in any case', () => {
    const json = JSON.parse(saveDocument(newDocument()));
    json.dimStyles.push({ ...json.dimStyles[0], name: 'iso' });
    expect(() => loadDocument(JSON.stringify(json))).toThrow('"iso" is already used by another style');
  });

  it('a hatch that would draw no lines is refused rather than left invisible', () => {
    let s = createSession(newDocument());
    const id = execute(s, 'entity.add', { geom: rectangle({ x: 3, y: 3 }, { x: 7, y: 7 }) });
    s = id.session;
    const body: NoteBody = { kind: 'hatch', loops: [[id.result.id]], pattern: 'lines', spacing: 1000, angle: 0 };
    const note: Note = { id: 9, layer: 1, z: 9, color: 'byLayer', lineweight: 'byLayer', body };
    expect(resolveNote(docEnv(s.doc), note)).toEqual({ ok: false, why: 'It draws nothing.' });
    expect(() => execute(s, 'note.add', { body })).toThrow('It draws nothing.');
  });

  it('a boundary that is not a shape at all is a bug, and is not hidden as a broken note', () => {
    const env: NoteEnv = {
      entity: () => ({ id: 1, layer: 1, z: 1, color: 'byLayer', linetype: 'byLayer', lineweight: 'byLayer', geom: { kind: 'blob' } as never }),
      dimStyle: () => undefined,
    };
    expect(() => loopOf(env, [1, 2])).toThrow();
  });
});
