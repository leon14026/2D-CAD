/**
 * App state: the editing session plus everything about how it is being viewed. One plain
 * object, replaced on every change; views subscribe and redraw what they need.
 */
import { canRedo, canUndo, createSession, newDocument, redo, undo, type Doc, type Session } from '../core/doc';
import { DEFAULT_SNAPS, isSelectable, type SnapKind } from '../core/spatial';
import { DEFAULT_MEMORY, type ActiveTool, type ToolMemory } from '../core/tools';
import type { Viewport } from '../render/viewport';

export interface Message {
  readonly text: string;
  readonly detail?: string;
  readonly kind: 'info' | 'error';
}

export interface AppState {
  readonly session: Session;
  /** The document as last opened or saved, to tell whether there are unsaved changes. */
  readonly savedDoc: Doc;
  readonly fileName: string | null;
  readonly viewport: Viewport;
  readonly selection: ReadonlySet<number>;
  readonly hover: number | null;
  readonly showGrid: boolean;
  readonly lineweights: boolean;
  readonly showLayers: boolean;
  readonly showSelection: boolean;
  readonly message: Message | null;
  /** The drawing or editing tool in use, or null when selecting. */
  readonly tool: ActiveTool | null;
  readonly toolMemory: ToolMemory;
  /** Why the tool refused the last input, shown beside the cursor. */
  readonly toolError: string | null;
  readonly snapOn: boolean;
  readonly snapKinds: ReadonlySet<SnapKind>;
  readonly ortho: boolean;
  readonly polarOn: boolean;
  /** Polar tracking step in degrees. */
  readonly polarStep: number;
}

export type Listener = (state: AppState, previous: AppState) => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const previous = this.state;
    const changes = typeof patch === 'function' ? patch(previous) : patch;
    let next: AppState = { ...previous, ...changes };
    if (next.session.doc !== previous.session.doc) next = { ...next, ...pruneSelection(next) };
    this.state = next;
    for (const l of this.listeners) l(next, previous);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** After the document changes, drop selected or hovered entities and annotations that are gone or no longer selectable. */
function pruneSelection(s: AppState): Partial<AppState> {
  const doc = s.session.doc;
  const keep = (id: number) => {
    const item = doc.entities.get(id) ?? doc.notes.get(id);
    return item !== undefined && isSelectable(doc, item);
  };
  const selection = [...s.selection].filter(keep);
  return {
    selection: selection.length === s.selection.size ? s.selection : new Set(selection),
    hover: s.hover !== null && keep(s.hover) ? s.hover : null,
  };
}

export function initialState(viewport: Viewport): AppState {
  const session = createSession(newDocument());
  return {
    session,
    savedDoc: session.doc,
    fileName: null,
    viewport,
    selection: new Set(),
    hover: null,
    showGrid: true,
    lineweights: true,
    showLayers: true,
    showSelection: true,
    message: null,
    tool: null,
    toolMemory: DEFAULT_MEMORY,
    toolError: null,
    snapOn: true,
    snapKinds: DEFAULT_SNAPS,
    ortho: false,
    polarOn: true,
    polarStep: 15,
  };
}

export const isDirty = (s: AppState) => s.session.doc !== s.savedDoc;

export function doUndo(store: Store): void {
  const s = store.get();
  if (canUndo(s.session)) store.set({ session: undo(s.session) });
}

export function doRedo(store: Store): void {
  const s = store.get();
  if (canRedo(s.session)) store.set({ session: redo(s.session) });
}
