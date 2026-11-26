/**
 * Building blocks shared by every command: how a command is defined, common parameter readers,
 * and the rules about what may be changed (layers must exist and be unlocked).
 */
import { transformShape, type Shape, type Transform } from '../geom';
import { CommandError, type Draft } from './draft';
import type { Entity, Layer } from './model';
import { readColorRef, readLinetypeRef, readLineweightRef, type ColorRef, type LinetypeRef, type LineweightRef } from './styles';
import { canonicalShape, join, readArray, readPositiveInteger, ValidationError, type Obj } from './validate';

export interface CommandDef<P, R> {
  readonly id: string;
  /** Shown in the undo/redo menu, e.g. "Undo Move". */
  readonly label: string;
  /** Validates untrusted parameters (from a script or the UI). */
  parse(raw: unknown): P;
  run(draft: Draft, params: P): R;
}

export function define<P, R>(def: CommandDef<P, R>): CommandDef<P, R> {
  return def;
}

// ---------- shared parameter readers ----------

export function readIds(v: unknown, path: string): number[] {
  const list = readArray(v, path);
  if (list.length === 0) throw new ValidationError(path, 'must list at least one id');
  return [...new Set(list.map((item, i) => readPositiveInteger(item, join(path, i))))];
}

export function optional<T>(o: Obj, key: string, read: (v: unknown, path: string) => T): T | undefined {
  return Object.hasOwn(o, key) ? read(o[key], key) : undefined;
}

export interface StyleProps {
  readonly color?: ColorRef;
  readonly linetype?: LinetypeRef;
  readonly lineweight?: LineweightRef;
}

export function readStyleProps(o: Obj): StyleProps {
  const color = optional(o, 'color', readColorRef);
  const linetype = optional(o, 'linetype', readLinetypeRef);
  const lineweight = optional(o, 'lineweight', readLineweightRef);
  return {
    ...(color !== undefined && { color }),
    ...(linetype !== undefined && { linetype }),
    ...(lineweight !== undefined && { lineweight }),
  };
}

// ---------- shared rules ----------

export function requireLayer(draft: Draft, id: number): Layer {
  const layer = draft.layer(id);
  if (!layer) throw new CommandError(`There is no layer with id ${id}.`);
  return layer;
}

export function requireUnlocked(draft: Draft, layerId: number): Layer {
  const layer = requireLayer(draft, layerId);
  if (layer.locked) throw new CommandError(`Layer "${layer.name}" is locked. Unlock it to change its contents.`);
  return layer;
}

export function requireEditable(draft: Draft, id: number): Entity {
  const e = draft.entity(id);
  if (!e) throw new CommandError(`There is no entity with id ${id}.`);
  requireUnlocked(draft, e.layer);
  return e;
}

export function requireUniqueName(draft: Draft, name: string, exceptId?: number): void {
  const key = name.toLowerCase();
  const clash = draft.layers.find((l) => l.id !== exceptId && l.name.toLowerCase() === key);
  if (clash) throw new CommandError(`A layer called "${clash.name}" already exists.`);
}

export function applyTransform(t: Transform, s: Shape): Shape {
  return canonicalShape(transformShape(t, s));
}
