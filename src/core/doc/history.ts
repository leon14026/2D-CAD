import { applyChanges, type Change } from './changes';
import { COMMANDS, isCommandId, type CommandDef, type CommandId, type ParamsOf, type ResultOf } from './commands';
import { CommandError, Draft } from './draft';
import { newDocument, type Doc } from './model';

export interface Transaction {
  readonly command: CommandId;
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
  const def = COMMANDS[id] as CommandDef<unknown, unknown>;
  let parsed: unknown;
  try {
    parsed = def.parse(params);
  } catch (err) {
    // Parsers throw ValidationError, whose message names the offending parameter.
    throw new CommandError(`Invalid parameters for ${id}: ${(err as Error).message}`);
  }
  const draft = new Draft(session.doc);
  let result: unknown;
  try {
    result = def.run(draft, parsed);
  } catch (err) {
    // Geometry that becomes invalid (e.g. scaled to a zero radius) surfaces as a RangeError.
    if (err instanceof RangeError) throw new CommandError(`${def.label} failed: ${err.message}`);
    throw err;
  }
  const changes = draft.changes();
  if (changes.length === 0) return { session, result };
  const undoStack = [...session.undoStack, { command: id, label: def.label, changes }];
  return {
    session: {
      ...session,
      doc: applyChanges(session.doc, changes, 'forward'),
      undoStack: undoStack.length > session.limit ? undoStack.slice(undoStack.length - session.limit) : undoStack,
      redoStack: [],
    },
    result,
  };
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
