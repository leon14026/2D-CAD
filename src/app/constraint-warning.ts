/**
 * Tells the user when a change leaves constraints unmet. The solver (src/core/doc/constraints.ts)
 * stops quietly when constraints conflict or cannot be reached, so without this the drawing
 * would just show a compromise shape.
 */
import { unmetConstraints, type Doc } from '../core/doc';
import type { Store } from './store';

export function constraintWarning(doc: Doc): string | null {
  const unmet = unmetConstraints(doc);
  if (unmet.length === 0) return null;
  const kinds = [...new Set(unmet.map((u) => u.kind))].join(', ');
  const count = unmet.length === 1 ? 'One constraint' : `${unmet.length} constraints`;
  return `${count} could not be met (${kinds}). The shape is a compromise. Ctrl+Z undoes the last change.`;
}

/** Shows the warning after any change to the drawing that leaves a constraint unmet. */
export function watchConstraints(store: Store): void {
  let warned: string | null = null;
  store.subscribe((state, previous) => {
    const doc = state.session.doc;
    if (doc === previous.session.doc) return;
    if (doc.constraints.size === 0 && warned === null) return;
    const text = constraintWarning(doc);
    if (text !== null) {
      warned = text;
      store.set({ message: { kind: 'error', text } });
    } else if (warned !== null) {
      const shown = store.get().message;
      warned = null;
      if (shown?.kind === 'error' && shown.text.includes('could not be met')) store.set({ message: null });
    }
  });
}
