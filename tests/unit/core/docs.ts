/** Builds small test drawings through the command registry, as the app would. */
import { createSession, execute, newDocument, type Doc, type Session } from '../../../src/core/doc';
import type { Shape } from '../../../src/core/geom';

export interface Built {
  readonly session: Session;
  readonly doc: Doc;
  /** Entity ids, in the order the shapes were given. */
  readonly ids: number[];
}

export function docOf(shapes: readonly Shape[], session: Session = createSession(newDocument())): Built {
  let s = session;
  const ids: number[] = [];
  for (const geom of shapes) {
    const r = execute(s, 'entity.add', { geom });
    s = r.session;
    ids.push(r.result.id);
  }
  return { session: s, doc: s.doc, ids };
}
