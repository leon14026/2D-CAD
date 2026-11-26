/**
 * Runs tools against an editing session. The app and the tests both drive tools through
 * here: a click, a typed value, an option key or Enter goes in, and the session comes out
 * with the tool's commands applied (or unchanged, with a reason, if anything was refused).
 */
import { CommandError, executeUnchecked, undo, type Session } from '../doc';
import type { Shape, Vec2 } from '../geom';
import { InputError, interpretTyped } from './input';
import { DEFAULT_MEMORY, type Prompt, type ToolContext, type ToolDef, type ToolInput, type ToolMemory, type ToolState } from './tool';
import { TOOLS, type ToolId } from './registry';

export interface ActiveTool {
  readonly id: ToolId;
  readonly state: ToolState;
}

export interface Drafting {
  readonly session: Session;
  readonly memory: ToolMemory;
  readonly active: ActiveTool | null;
}

export interface Outcome {
  readonly drafting: Drafting;
  /** Why nothing happened, in plain words, or null. */
  readonly error: string | null;
}

export function drafting(session: Session, memory: ToolMemory = DEFAULT_MEMORY): Drafting {
  return { session, memory, active: null };
}

function context(d: Drafting, selection: readonly number[]): ToolContext {
  return { doc: d.session.doc, selection, memory: d.memory };
}

function def(d: Drafting): ToolDef | null {
  return d.active ? TOOLS[d.active.id] : null;
}

export function startTool(d: Drafting, id: ToolId, selection: readonly number[] = []): Drafting {
  return { ...d, active: { id, state: TOOLS[id].start(context(d, selection)) } };
}

export function stopTool(d: Drafting): Drafting {
  return d.active ? { ...d, active: null } : d;
}

/** What the active tool is asking for, or null when no tool is active. */
export function currentPrompt(d: Drafting, selection: readonly number[] = []): Prompt | null {
  const t = def(d);
  return t && d.active ? t.prompt(d.active.state, context(d, selection)) : null;
}

/** The last point, which relative input and tracking start from. */
export function currentBase(d: Drafting): Vec2 | null {
  const t = def(d);
  return t && d.active ? t.base(d.active.state) : null;
}

export function currentPreview(d: Drafting, cursor: Vec2, selection: readonly number[] = []): Shape[] {
  const t = def(d);
  return t && d.active ? t.preview(d.active.state, cursor, context(d, selection)) : [];
}

/**
 * Runs `fn`. An error of the `expected` class (a refusal, explained in plain words) becomes its
 * message; any other error is a bug and is thrown on.
 */
export function attempt<T>(fn: () => T, expected: abstract new (message: string) => Error): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof expected) return { ok: false, error: err.message };
    throw err;
  }
}

/** Gives the active tool one input and applies the commands it returns. */
export function feed(d: Drafting, input: ToolInput, selection: readonly number[] = []): Outcome {
  const t = def(d);
  if (!t || !d.active) return { drafting: d, error: null };
  const result = t.input(d.active.state, input, context(d, selection));
  if (result.error) return { drafting: d, error: result.error };
  // All or nothing: a refused command leaves the session and the tool as they were.
  const applied = attempt(() => {
    let session = d.session;
    for (let i = 0; i < (result.undo ?? 0); i++) session = undo(session);
    for (const call of result.calls) session = executeUnchecked(session, call.id, call.params).session;
    return session;
  }, CommandError);
  if (!applied.ok) return { drafting: d, error: applied.error };
  return {
    drafting: {
      session: applied.value,
      memory: result.memory ? { ...d.memory, ...result.memory } : d.memory,
      active: result.state ? { id: d.active.id, state: result.state } : null,
    },
    error: null,
  };
}

/**
 * Gives the active tool typed text. `direction` is the angle from the last point towards the
 * cursor (or the tracking line), used when a single distance is typed.
 */
export function feedTyped(d: Drafting, text: string, direction: number | null, selection: readonly number[] = []): Outcome {
  const prompt = currentPrompt(d, selection);
  if (!prompt) return { drafting: d, error: null };
  const value = attempt(() => interpretTyped(text, { accepts: prompt.accepts, base: currentBase(d), direction }), InputError);
  return value.ok ? feed(d, value.value, selection) : { drafting: d, error: value.error };
}
