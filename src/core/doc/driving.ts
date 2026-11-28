/**
 * Driving dimensions: a dimension you place also holds the drawing to that number. The note
 * still stores only where to measure; the number lives in the linked constraint.
 */
import { TAU, type Vec2 } from '../geom';
import { CommandError, type Draft } from './draft';
import {
  constraintEntityIds,
  constraintRefuseMessage,
  type Constraint,
  type ConstraintBody,
  type DistanceAxis,
} from './constraints';

export { constraintRefuseMessage };
import { isDimension, resolveNote, type Note, type NoteEnv, type PointRef } from './notes';
import type { Doc } from './model';
import { onCurrentSheet } from './sheets';

export function isBoundRef(ref: PointRef): boolean {
  return ref.kind !== 'free';
}

function refId(ref: PointRef): number | null {
  return ref.kind === 'free' ? null : ref.id;
}

/** Two distinct line ids an angle dimension can hold, or null. */
export function angleLineIds(vertex: PointRef, a: PointRef, b: PointRef): [number, number] | null {
  const ids = [...new Set([refId(vertex), refId(a), refId(b)].filter((id): id is number => id !== null))];
  if (ids.length !== 2) return null;
  return [ids[0]!, ids[1]!];
}

function needValue(env: NoteEnv, note: Note): number {
  const r = resolveNote(env, note);
  if (!r.ok) throw new CommandError(r.why);
  const value = r.r.value;
  if (value === undefined || !(value > 0)) throw new CommandError('That dimension has no length to hold.');
  return value;
}

/**
 * The constraint a driving dimension should add. Throws CommandError in plain words when
 * the note cannot hold the drawing (free points, a reflex angle, missing geometry).
 */
export function drivingBodyFor(env: NoteEnv, note: Note): ConstraintBody {
  const b = note.body;
  if (!isDimension(b)) throw new CommandError('Only a dimension can hold the drawing.');
  switch (b.kind) {
    case 'linear': {
      if (!isBoundRef(b.a) || !isBoundRef(b.b)) {
        throw new CommandError('A driving dimension has to measure points on drawn shapes.');
      }
      const value = needValue(env, note);
      const axis: DistanceAxis = b.orient === 'horizontal' ? 'x' : 'y';
      return axis === 'x'
        ? { kind: 'distance', a: b.a, b: b.b, value, axis: 'x' }
        : { kind: 'distance', a: b.a, b: b.b, value, axis: 'y' };
    }
    case 'aligned': {
      if (!isBoundRef(b.a) || !isBoundRef(b.b)) {
        throw new CommandError('A driving dimension has to measure points on drawn shapes.');
      }
      return { kind: 'distance', a: b.a, b: b.b, value: needValue(env, note) };
    }
    case 'radius':
      return { kind: 'radius', target: b.target, value: needValue(env, note) };
    case 'diameter':
      return { kind: 'radius', target: b.target, value: needValue(env, note) / 2 };
    case 'angle': {
      const ids = angleLineIds(b.vertex, b.a, b.b);
      if (!ids) throw new CommandError('An angle dimension can only hold the drawing when both sides are lines.');
      const value = needValue(env, note);
      const held = value > Math.PI ? TAU - value : value;
      if (!(held > 0) || held >= Math.PI) {
        throw new CommandError('An angle of 180° or more cannot hold the drawing. Mark it as a reference dimension.');
      }
      return { kind: 'angle', a: ids[0], b: ids[1], value: held };
    }
  }
}

export function constraintHasValue(body: ConstraintBody): body is ConstraintBody & { readonly value: number } {
  return body.kind === 'distance' || body.kind === 'radius' || body.kind === 'length' || body.kind === 'angle';
}

/** The number shown for a constraint (diameter notes show twice the stored radius; angles in radians). */
export function constraintDisplayValue(doc: Doc, c: Constraint): number | null {
  if (!constraintHasValue(c.body)) return null;
  const note = c.note !== undefined ? doc.notes.get(c.note) : undefined;
  if (note?.body.kind === 'diameter') return c.body.value * 2;
  return c.body.value;
}

/** Converts a typed display number into the value stored on the constraint. */
export function constraintStoredValue(doc: Doc, c: Constraint, displayed: number): number {
  const note = c.note !== undefined ? doc.notes.get(c.note) : undefined;
  if (note?.body.kind === 'diameter') return displayed / 2;
  return displayed;
}

export function deleteNotePair(draft: Draft, id: number): void {
  const note = draft.note(id);
  if (note?.drive !== undefined) draft.deleteConstraint(note.drive);
  draft.deleteNote(id);
}

export function deleteConstraintPair(draft: Draft, id: number): void {
  const c = draft.constraint(id);
  if (c?.note !== undefined) draft.deleteNote(c.note);
  draft.deleteConstraint(id);
}

/** Constraints on the current sheet that hold any of these ids (entities, notes or themselves). */
export function constraintsTouching(doc: Doc, ids: ReadonlySet<number>): Constraint[] {
  const out: Constraint[] = [];
  for (const c of doc.constraints.values()) {
    if (!onCurrentSheet(doc, c)) continue;
    if (ids.has(c.id) || (c.note !== undefined && ids.has(c.note)) || constraintEntityIds(c).some((id) => ids.has(id))) {
      out.push(c);
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

export function drivingNoteOf(doc: Doc, noteId: number): { note: Note; constraint: Constraint } | null {
  const note = doc.notes.get(noteId);
  if (!note || note.drive === undefined) return null;
  const constraint = doc.constraints.get(note.drive);
  if (!constraint) return null;
  return { note, constraint };
}

export function constraintKindLabel(kind: Constraint['body']['kind']): string {
  switch (kind) {
    case 'coincident':
      return 'Coincident';
    case 'horizontal':
      return 'Horizontal';
    case 'vertical':
      return 'Vertical';
    case 'distance':
      return 'Distance';
    case 'fix':
      return 'Fix';
    case 'midpoint':
      return 'Midpoint';
    case 'parallel':
      return 'Parallel';
    case 'perpendicular':
      return 'Perpendicular';
    case 'equal':
      return 'Equal length';
    case 'concentric':
      return 'Concentric';
    case 'tangent':
      return 'Tangent';
    case 'radius':
      return 'Radius';
    case 'length':
      return 'Length';
    case 'angle':
      return 'Angle';
  }
}

export function formatFixPoint(p: Vec2): string {
  return `${p.x}, ${p.y}`;
}
