/**
 * Interactive tools as small state machines. A tool asks for one thing at a time (a point, a
 * number, a pick or a selection), turns what it is given into document commands, and says
 * what to show while the cursor moves. Tools never touch the document directly: the commands
 * they return go through the command registry like everything else, so they can be undone.
 */
import type { Doc } from '../doc';
import type { Shape, Vec2 } from '../geom';
import type { Accepts } from './input';

export interface CommandCall {
  readonly id: string;
  readonly params: unknown;
}

export interface ToolOption {
  /** A single lower-case letter. */
  readonly key: string;
  readonly label: string;
}

export interface Prompt {
  /** What to do next, in plain words: "Next point". */
  readonly text: string;
  readonly accepts: Accepts;
  readonly options: readonly ToolOption[];
  /** The value Enter uses when nothing is typed, such as the last radius. */
  readonly defaultValue?: number;
  /** What Enter does when nothing is typed and there is no default, such as "finish". */
  readonly enter?: string;
}

export interface PickInput {
  readonly id: number;
  readonly point: Vec2;
}

export type ToolInput =
  | { readonly kind: 'point'; readonly point: Vec2 }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'option'; readonly key: string }
  | ({ readonly kind: 'pick' } & PickInput)
  /** Enter with nothing typed, or a right-click. */
  | { readonly kind: 'enter' };

/** One plain shape for every tool's state; each tool uses the fields it needs. */
export interface ToolState {
  readonly step: number;
  readonly points: readonly Vec2[];
  readonly values: readonly number[];
  readonly picks: readonly PickInput[];
  readonly flag: boolean;
  /** How many objects this run of the tool has made so far. */
  readonly count: number;
}

export const EMPTY_STATE: ToolState = Object.freeze({ step: 0, points: [], values: [], picks: [], flag: false, count: 0 });

/** Values tools remember between uses, offered again as defaults. */
export interface ToolMemory {
  readonly radius: number | null;
  readonly sides: number;
}

export const DEFAULT_MEMORY: ToolMemory = Object.freeze({ radius: null, sides: 6 });

export interface ToolContext {
  readonly doc: Doc;
  /** Selected entity ids. */
  readonly selection: readonly number[];
  readonly memory: ToolMemory;
}

export interface ToolResult {
  /** The next state, or null when the tool has finished. */
  readonly state: ToolState | null;
  readonly calls: readonly CommandCall[];
  /** Why the input was refused, in plain words. The tool stays as it was. */
  readonly error?: string;
  readonly memory?: Partial<ToolMemory>;
  /** Steps to undo before running `calls`, for "undo the last line". */
  readonly undo?: number;
}

export interface ToolDef {
  readonly id: string;
  /** Short name, such as "Line". */
  readonly label: string;
  start(ctx: ToolContext): ToolState;
  prompt(s: ToolState, ctx: ToolContext): Prompt;
  /** Where relative input and tracking start from, if anywhere. */
  base(s: ToolState): Vec2 | null;
  input(s: ToolState, input: ToolInput, ctx: ToolContext): ToolResult;
  /** Shapes to show at the cursor before the next click. */
  preview(s: ToolState, cursor: Vec2, ctx: ToolContext): Shape[];
}

// ---------- helpers for tool definitions ----------

export function next(state: ToolState | null, calls: readonly CommandCall[] = [], extra: Omit<ToolResult, 'state' | 'calls'> = {}): ToolResult {
  return { state, calls, ...extra };
}

export function refuse(state: ToolState, error: string): ToolResult {
  return { state, calls: [], error };
}

export const NOT_HERE = 'That does not apply at this step.';

export function addShape(geom: Shape): CommandCall {
  return { id: 'entity.add', params: { geom } };
}

export function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function last<T>(list: readonly T[]): T {
  return list[list.length - 1] as T;
}
