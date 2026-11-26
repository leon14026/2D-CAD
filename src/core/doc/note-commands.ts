/**
 * Commands for notes: adding and editing dimensions, text, leaders, centre marks, hatches and
 * title blocks, and for dimension styles. Deleting, moving and copying notes goes through the
 * entity commands, because a selection can hold both.
 */
import { intersect, loopCurves, pointInLoop, type Curve, type Loop, type Vec2 } from '../geom';
import { define, optional, readStyleProps, requireUnlocked, type StyleProps } from './command-kit';
import { CommandError, type Draft } from './draft';
import { hatchLoops, resolveNote, MAX_DIM_STYLES, type DimStyle, type Note, type NoteBody } from './notes';
import { readDimStyle, readNoteBody } from './note-validate';
import { BY_LAYER } from './styles';
import { readObject, readPositiveInteger, readString, ValidationError } from './validate';

function anEdgePoint(l: Loop): Vec2 {
  const c = loopCurves(l)[0] as Curve; // a loop always has at least one edge
  if (c.kind === 'segment') return c.start;
  if (c.kind === 'circle') return { x: c.center.x + c.radius, y: c.center.y };
  return { x: c.center.x + c.radius * Math.cos(c.start), y: c.center.y + c.radius * Math.sin(c.start) };
}

/** A hatch's outer boundary must hold every island, and the islands must not touch each other. */
function checkRegion(loops: readonly Loop[]): void {
  const outer = loops[0] as Loop;
  const islands = loops.slice(1);
  islands.forEach((island, i) => {
    if (intersect(outer, island).length > 0) throw new CommandError(`Island ${i + 1} touches the outer boundary. Islands must lie inside it.`);
    if (!pointInLoop(outer, anEdgePoint(island))) throw new CommandError(`Island ${i + 1} is outside the outer boundary.`);
    islands.forEach((other, j) => {
      if (j <= i) return;
      if (intersect(island, other).length > 0 || pointInLoop(island, anEdgePoint(other)) || pointInLoop(other, anEdgePoint(island))) {
        throw new CommandError(`Islands ${i + 1} and ${j + 1} touch or overlap.`);
      }
    });
  });
}

/** Throws a CommandError unless the note can be drawn from the geometry as it is now. */
function requireDrawable(draft: Draft, note: Note): void {
  const env = draft.env();
  const r = resolveNote(env, note);
  if (!r.ok) throw new CommandError(r.why);
  if (note.body.kind === 'hatch') checkRegion(hatchLoops(env, note.body));
}

export interface AddNoteParams extends StyleProps {
  readonly body: NoteBody;
  readonly layer?: number;
}

const addNote = define<AddNoteParams, { id: number }>({
  id: 'note.add',
  label: 'Add annotation',
  parse(raw) {
    const o = readObject(raw, '', ['body'], ['layer', 'color', 'lineweight']);
    const layer = optional(o, 'layer', readPositiveInteger);
    return { body: readNoteBody(o['body'], 'body'), ...(layer !== undefined && { layer }), ...readStyleProps(o) };
  },
  run(draft, p) {
    const layer = p.layer ?? draft.settings.currentLayer;
    requireUnlocked(draft, layer);
    const id = draft.allocateId();
    const note: Note = { id, layer, z: id, color: p.color ?? BY_LAYER, lineweight: p.lineweight ?? BY_LAYER, body: p.body };
    requireDrawable(draft, note);
    draft.putNote(note);
    return { id };
  },
});

export interface EditNoteParams {
  readonly id: number;
  /** Fields of the note's body to replace, e.g. { text: "New" } or { fields: { …all title fields } }. */
  readonly patch: Readonly<Record<string, unknown>>;
}

const editNote = define<EditNoteParams, { id: number }>({
  id: 'note.edit',
  label: 'Edit annotation',
  parse(raw) {
    const o = readObject(raw, '', ['id', 'patch']);
    const patch = o['patch'];
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch) || Object.keys(patch).length === 0) {
      throw new ValidationError('patch', 'must be an object with at least one field to change');
    }
    return { id: readPositiveInteger(o['id'], 'id'), patch: patch as Record<string, unknown> };
  },
  run(draft, p) {
    const note = draft.note(p.id);
    if (!note) throw new CommandError(`There is no annotation with id ${p.id}.`);
    requireUnlocked(draft, note.layer);
    if (Object.hasOwn(p.patch, 'kind') && p.patch['kind'] !== note.body.kind) throw new CommandError('An annotation cannot change what kind it is.');
    let body: NoteBody;
    try {
      body = readNoteBody({ ...note.body, ...p.patch }, 'patch');
    } catch (err) {
      throw err instanceof ValidationError ? new CommandError(`That change is not allowed: ${err.message}.`) : err;
    }
    const next: Note = { ...note, body };
    requireDrawable(draft, next);
    draft.putNote(next);
    return { id: note.id };
  },
});

export interface SetDimStyleParams {
  readonly style: DimStyle;
}

const setDimStyle = define<SetDimStyleParams, { added: boolean }>({
  id: 'dimstyle.set',
  label: 'Change dimension style',
  parse(raw) {
    const o = readObject(raw, '', ['style']);
    return { style: readDimStyle(o['style'], 'style') };
  },
  run(draft, p) {
    const styles = draft.settings.dimStyles;
    const key = p.style.name.toLowerCase();
    const at = styles.findIndex((s) => s.name.toLowerCase() === key);
    if (at < 0 && styles.length >= MAX_DIM_STYLES) throw new CommandError(`A drawing can have at most ${MAX_DIM_STYLES} dimension styles.`);
    const next = at < 0 ? [...styles, p.style] : styles.map((s, i) => (i === at ? p.style : s));
    const currentDimStyle = at >= 0 && (styles[at] as DimStyle).name === draft.settings.currentDimStyle ? p.style.name : draft.settings.currentDimStyle;
    draft.setSettings({ ...draft.settings, dimStyles: next, currentDimStyle });
    return { added: at < 0 };
  },
});

export interface UseDimStyleParams {
  readonly name: string;
}

const useDimStyle = define<UseDimStyleParams, Record<string, never>>({
  id: 'dimstyle.use',
  label: 'Use dimension style',
  parse(raw) {
    const o = readObject(raw, '', ['name']);
    return { name: readString(o['name'], 'name') };
  },
  run(draft, p) {
    if (!draft.settings.dimStyles.some((s) => s.name === p.name)) throw new CommandError(`There is no dimension style called "${p.name}".`);
    draft.setSettings({ ...draft.settings, currentDimStyle: p.name });
    return {};
  },
});

export const NOTE_COMMANDS = {
  'note.add': addNote,
  'note.edit': editNote,
  'dimstyle.set': setDimStyle,
  'dimstyle.use': useDimStyle,
} as const;
