import type { Block, Insert } from './blocks';
import type { Constraint } from './constraints';
import type { Doc, DocSettings, Entity, Layer } from './model';
import type { Note } from './notes';
import type { Sheet } from './sheets';

/**
 * One recorded difference between two documents. A command's changes, applied forwards, turn
 * the old document into the new one; applied backwards (using `before`), they restore it
 * exactly. Undo stores changes, not whole documents, so memory grows with the size of edits.
 */
export type Change =
  | { readonly kind: 'entity'; readonly id: number; readonly before: Entity | null; readonly after: Entity | null }
  | { readonly kind: 'note'; readonly id: number; readonly before: Note | null; readonly after: Note | null }
  | { readonly kind: 'insert'; readonly id: number; readonly before: Insert | null; readonly after: Insert | null }
  | { readonly kind: 'constraint'; readonly id: number; readonly before: Constraint | null; readonly after: Constraint | null }
  | { readonly kind: 'layers'; readonly before: readonly Layer[]; readonly after: readonly Layer[] }
  | { readonly kind: 'sheets'; readonly before: readonly Sheet[]; readonly after: readonly Sheet[] }
  | { readonly kind: 'blocks'; readonly before: readonly Block[]; readonly after: readonly Block[] }
  | { readonly kind: 'settings'; readonly before: DocSettings; readonly after: DocSettings }
  | { readonly kind: 'nextId'; readonly before: number; readonly after: number };

export type Direction = 'forward' | 'backward';

export function applyChanges(doc: Doc, changes: readonly Change[], direction: Direction): Doc {
  const ordered = direction === 'forward' ? changes : [...changes].reverse();
  const forward = direction === 'forward';
  let entities: Map<number, Entity> | null = null;
  let notes: Map<number, Note> | null = null;
  let inserts: Map<number, Insert> | null = null;
  let constraints: Map<number, Constraint> | null = null;
  let { layers, settings, nextId, sheets, blocks } = doc;
  for (const c of ordered) {
    switch (c.kind) {
      case 'entity': {
        entities ??= new Map(doc.entities);
        const value = forward ? c.after : c.before;
        if (value) entities.set(c.id, value);
        else entities.delete(c.id);
        break;
      }
      case 'note': {
        notes ??= new Map(doc.notes);
        const value = forward ? c.after : c.before;
        if (value) notes.set(c.id, value);
        else notes.delete(c.id);
        break;
      }
      case 'insert': {
        inserts ??= new Map(doc.inserts);
        const value = forward ? c.after : c.before;
        if (value) inserts.set(c.id, value);
        else inserts.delete(c.id);
        break;
      }
      case 'constraint': {
        constraints ??= new Map(doc.constraints);
        const value = forward ? c.after : c.before;
        if (value) constraints.set(c.id, value);
        else constraints.delete(c.id);
        break;
      }
      case 'layers':
        layers = forward ? c.after : c.before;
        break;
      case 'sheets':
        sheets = forward ? c.after : c.before;
        break;
      case 'blocks':
        blocks = forward ? c.after : c.before;
        break;
      case 'settings':
        settings = forward ? c.after : c.before;
        break;
      case 'nextId':
        nextId = forward ? c.after : c.before;
        break;
    }
  }
  return {
    settings,
    nextId,
    layers,
    entities: entities ?? doc.entities,
    notes: notes ?? doc.notes,
    sheets,
    blocks,
    inserts: inserts ?? doc.inserts,
    constraints: constraints ?? doc.constraints,
  };
}
