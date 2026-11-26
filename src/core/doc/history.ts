import { applyChanges, type Change } from './changes';
import { COMMANDS, isCommandId, type CommandDef, type CommandId, type ParamsOf, type ResultOf } from './commands';
import { CommandError, Draft } from './draft';
import { newDocument, type Doc } from './model';
import { noteEntityIds, noteProblem } from './notes';

export interface Transaction {
  /** Command id, or `script.run` when many commands were applied as one undo step. */
  readonly command: string;
  readonly label: string;
  readonly changes: readonly Change[];
}

/** A document plus its undo and redo stacks. Immutable, like everything in the core. */
export interface Session {
  readonly doc: Doc;
  readonly undoStack: readonly Transaction[];
  readonly redoStack: readonly Transaction[];
  /** Maximum number of undo steps kept. */
  readonly limit: number;
}

export const DEFAULT_UNDO_LIMIT = 1000;

export function createSession(doc: Doc = newDocument(), limit: number = DEFAULT_UNDO_LIMIT): Session {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`undo limit must be a whole number of 1 or more, got ${limit}`);
  return { doc, undoStack: [], redoStack: [], limit };
}

export interface Executed<R> {
  readonly session: Session;
  readonly result: R;
  /** Notes removed because the geometry they measured is gone (they come back with undo). */
  readonly pruned: number;
}

/**
 * Removes notes whose geometry a command has just deleted or reshaped beyond use: a dimension
 * of a line that no longer exists, a hatch whose boundary was cut open. Only notes that refer
 * to an entity the command touched are looked at.
 */
function pruneBrokenNotes(draft: Draft): number {
  const touched = new Set(draft.touchedEntityIds());
  if (touched.size === 0) return 0;
  const env = draft.env();
  let count = 0;
  for (const note of [...draft.notes()]) {
    if (!noteEntityIds(note).some((id) => touched.has(id))) continue;
    if (noteProblem(env, note) !== null) {
      draft.deleteNote(note.id);
      count += 1;
    }
  }
  return count;
}

/**
 * Runs a named command against a draft (used by the script host to batch many commands into
 * one undo step). Parameters are always validated. On error the draft may be dirty; the
 * caller must discard it.
 */
export function runCommandOnDraft(draft: Draft, id: string, params: unknown): unknown {
  if (!isCommandId(id)) throw new CommandError(`There is no command called "${id}".`);
  const def = COMMANDS[id] as CommandDef<unknown, unknown>;
  let parsed: unknown;
  try {
    parsed = def.parse(params);
  } catch (err) {
    // Parsers throw ValidationError, whose message names the offending parameter.
    throw new CommandError(`Invalid parameters for ${id}: ${(err as Error).message}`);
  }
  try {
    return def.run(draft, parsed);
  } catch (err) {
    // Geometry that becomes invalid (e.g. scaled to a zero radius) surfaces as a RangeError.
    if (err instanceof RangeError) throw new CommandError(`${def.label} failed: ${err.message}`);
    throw err;
  }
}

/** Turns a finished draft into a new session. Empty drafts leave the session object unchanged. */
export function commitDraft(
  session: Session,
  draft: Draft,
  command: string,
  label: string,
  result: unknown,
): Executed<unknown> {
  const pruned = pruneBrokenNotes(draft);
  const changes = draft.changes();
  if (changes.length === 0) return { session, result, pruned };
  const undoStack = [...session.undoStack, { command, label, changes }];
  return {
    session: {
      ...session,
      doc: applyChanges(session.doc, changes, 'forward'),
      undoStack: undoStack.length > session.limit ? undoStack.slice(undoStack.length - session.limit) : undoStack,
      redoStack: [],
    },
    result,
    pruned,
  };
}

/**
 * Runs a command. Parameters are always validated, even from typed callers. On any error the
 * original session is untouched and a CommandError explains why.
 */
export function execute<K extends CommandId>(session: Session, id: K, params: ParamsOf<K>): Executed<ResultOf<K>> {
  return executeUnchecked(session, id, params) as Executed<ResultOf<K>>;
}

/** Runs a command named at run time (from a script or the command palette). */
export function executeUnchecked(session: Session, id: string, params: unknown): Executed<unknown> {
  if (!isCommandId(id)) throw new CommandError(`There is no command called "${id}".`);
  const draft = new Draft(session.doc);
  const result = runCommandOnDraft(draft, id, params);
  return commitDraft(session, draft, id, COMMANDS[id].label, result);
}

export function canUndo(session: Session): boolean {
  return session.undoStack.length > 0;
}

export function canRedo(session: Session): boolean {
  return session.redoStack.length > 0;
}

/** Label of the step that undo would reverse, e.g. "Move", or null. */
export function undoLabel(session: Session): string | null {
  return session.undoStack.at(-1)?.label ?? null;
}

export function redoLabel(session: Session): string | null {
  return session.redoStack.at(-1)?.label ?? null;
}

export function undo(session: Session): Session {
  const t = session.undoStack.at(-1);
  if (!t) return session;
  return {
    ...session,
    doc: applyChanges(session.doc, t.changes, 'backward'),
    undoStack: session.undoStack.slice(0, -1),
    redoStack: [...session.redoStack, t],
  };
}

export function redo(session: Session): Session {
  const t = session.redoStack.at(-1);
  if (!t) return session;
  return {
    ...session,
    doc: applyChanges(session.doc, t.changes, 'forward'),
    undoStack: [...session.undoStack, t],
    redoStack: session.redoStack.slice(0, -1),
  };
}
