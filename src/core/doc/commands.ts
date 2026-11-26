/**
 * The command registry. Every change to a document goes through a named command, so the UI,
 * keyboard, scripts and tests all share one validated path, and every change can be undone.
 * The modify commands (offset, trim, fillet and the rest) are in edit-commands.ts.
 */
export type { CommandDef } from './command-kit';
import {
  convertLength,
  LENGTH_UNITS,
  ORIGIN,
  scaleAbout,
  transformShape,
  type LengthUnit,
  type Shape,
  type Transform,
} from '../geom';
import {
  applyTransform,
  define,
  optional,
  readIds,
  readStyleProps,
  requireEditable,
  requireLayer,
  requireNoteEditable,
  requireUnlocked,
  requireUniqueName,
  type CommandDef,
  type StyleProps,
} from './command-kit';
import { CommandError } from './draft';
import { EDIT_COMMANDS } from './edit-commands';
import { NOTE_COMMANDS } from './note-commands';
import { isFreeNote, transformNote, type Note } from './notes';
import { MAX_NAME_LENGTH, MAX_TITLE_LENGTH, type Entity, type Layer } from './model';
import {
  BY_LAYER,
  DEFAULT_LAYER_STYLE,
  readColorRef,
  readLinetype,
  readLinetypeRef,
  readLineweight,
  readLineweightRef,
  readName,
  readRgb,
  type ColorRef,
  type LinetypeId,
  type LinetypeRef,
  type Lineweight,
  type LineweightRef,
  type Rgb,
} from './styles';
import {
  canonicalShape,
  join,
  readArray,
  readBoolean,
  readObject,
  readOneOf,
  readPositiveInteger,
  readShape,
  readTransform,
  ValidationError,
  type Obj,
} from './validate';

// ---------- entity commands ----------

export interface AddEntityParams extends StyleProps {
  readonly geom: Shape;
  readonly layer?: number;
}

const addEntity = define<AddEntityParams, { id: number }>({
  id: 'entity.add',
  label: 'Add',
  parse(raw) {
    const o = readObject(raw, '', ['geom'], ['layer', 'color', 'linetype', 'lineweight']);
    const layer = optional(o, 'layer', readPositiveInteger);
    return { geom: readShape(o['geom'], 'geom'), ...(layer !== undefined && { layer }), ...readStyleProps(o) };
  },
  run(draft, p) {
    const layer = p.layer ?? draft.settings.currentLayer;
    requireUnlocked(draft, layer);
    const id = draft.allocateId();
    draft.putEntity({
      id,
      layer,
      z: id,
      color: p.color ?? BY_LAYER,
      linetype: p.linetype ?? BY_LAYER,
      lineweight: p.lineweight ?? BY_LAYER,
      geom: p.geom,
    });
    return { id };
  },
});

export interface IdsParams {
  readonly ids: readonly number[];
}

const deleteEntities = define<IdsParams, { deleted: number }>({
  id: 'entity.delete',
  label: 'Delete',
  parse(raw) {
    const o = readObject(raw, '', ['ids']);
    return { ids: readIds(o['ids'], 'ids') };
  },
  run(draft, p) {
    const isNote = (id: number) => draft.entity(id) === undefined && draft.note(id) !== undefined;
    for (const id of p.ids) {
      if (isNote(id)) requireNoteEditable(draft, id);
      else requireEditable(draft, id);
    }
    for (const id of p.ids) {
      if (isNote(id)) draft.deleteNote(id);
      else draft.deleteEntity(id);
    }
    return { deleted: p.ids.length };
  },
});

export interface TransformParams extends IdsParams {
  readonly transform: Transform;
}

function readTransformParams(raw: unknown): TransformParams {
  const o = readObject(raw, '', ['ids', 'transform']);
  return { ids: readIds(o['ids'], 'ids'), transform: readTransform(o['transform'], 'transform') };
}

const transformEntities = define<TransformParams, { changed: number }>({
  id: 'entity.transform',
  label: 'Transform',
  parse: readTransformParams,
  run(draft, p) {
    const isNote = (id: number) => draft.entity(id) === undefined && draft.note(id) !== undefined;
    const entities = p.ids.filter((id) => !isNote(id)).map((id) => requireEditable(draft, id));
    const notes = p.ids.filter(isNote).map((id) => requireNoteEditable(draft, id));
    for (const e of entities) draft.putEntity({ ...e, geom: applyTransform(p.transform, e.geom) });
    for (const n of notes) draft.putNote(transformNote(p.transform, n));
    return { changed: entities.length + notes.length };
  },
});

const copyEntities = define<TransformParams, { ids: number[] }>({
  id: 'entity.copy',
  label: 'Copy',
  parse: readTransformParams,
  run(draft, p) {
    const isNote = (id: number) => draft.entity(id) === undefined && draft.note(id) !== undefined;
    const sources = p.ids.filter((id) => !isNote(id)).map((id) => requireEditable(draft, id));
    // A dimension, centre mark or hatch belongs to the geometry it measures, so it is not copied.
    const notes = p.ids.filter(isNote).map((id) => requireNoteEditable(draft, id)).filter(isFreeNote);
    const ids: number[] = [];
    for (const e of sources) {
      const id = draft.allocateId();
      draft.putEntity({ ...e, id, z: id, geom: applyTransform(p.transform, e.geom) });
      ids.push(id);
    }
    for (const n of notes) {
      const id = draft.allocateId();
      const moved: Note = transformNote(p.transform, n);
      draft.putNote({ ...moved, id, z: id });
      ids.push(id);
    }
    return { ids };
  },
});

export interface SetPropsParams extends IdsParams, StyleProps {
  readonly layer?: number;
}

const setEntityProps = define<SetPropsParams, { changed: number }>({
  id: 'entity.setProps',
  label: 'Change properties',
  parse(raw) {
    const o = readObject(raw, '', ['ids'], ['layer', 'color', 'linetype', 'lineweight']);
    const layer = optional(o, 'layer', readPositiveInteger);
    const style = readStyleProps(o);
    if (layer === undefined && Object.keys(style).length === 0) {
      throw new ValidationError('', 'give at least one of layer, color, linetype or lineweight');
    }
    return { ids: readIds(o['ids'], 'ids'), ...(layer !== undefined && { layer }), ...style };
  },
  run(draft, p) {
    if (p.layer !== undefined) requireUnlocked(draft, p.layer);
    const isNote = (id: number) => draft.entity(id) === undefined && draft.note(id) !== undefined;
    const targets = p.ids.filter((id) => !isNote(id)).map((id) => requireEditable(draft, id));
    let changed = 0;
    for (const n of p.ids.filter(isNote).map((id) => requireNoteEditable(draft, id))) {
      const next: Note = { ...n, layer: p.layer ?? n.layer, color: p.color ?? n.color, lineweight: p.lineweight ?? n.lineweight };
      if (next.layer !== n.layer || next.color !== n.color || next.lineweight !== n.lineweight) {
        draft.putNote(next);
        changed += 1;
      }
    }
    for (const e of targets) {
      const next: Entity = {
        ...e,
        layer: p.layer ?? e.layer,
        color: p.color ?? e.color,
        linetype: p.linetype ?? e.linetype,
        lineweight: p.lineweight ?? e.lineweight,
      };
      if (next.layer !== e.layer || next.color !== e.color || next.linetype !== e.linetype || next.lineweight !== e.lineweight) {
        draft.putEntity(next);
        changed += 1;
      }
    }
    return { changed };
  },
});

// ---------- layer commands ----------

export interface AddLayerParams {
  readonly name: string;
  readonly color?: Rgb;
  readonly linetype?: LinetypeId;
  readonly lineweight?: Lineweight;
}

const addLayer = define<AddLayerParams, { id: number }>({
  id: 'layer.add',
  label: 'Add layer',
  parse(raw) {
    const o = readObject(raw, '', ['name'], ['color', 'linetype', 'lineweight']);
    const color = optional(o, 'color', readRgb);
    const linetype = optional(o, 'linetype', readLinetype);
    const lineweight = optional(o, 'lineweight', readLineweight);
    return {
      name: readName(o['name'], 'name', MAX_NAME_LENGTH),
      ...(color !== undefined && { color }),
      ...(linetype !== undefined && { linetype }),
      ...(lineweight !== undefined && { lineweight }),
    };
  },
  run(draft, p) {
    requireUniqueName(draft, p.name);
    const id = draft.allocateId();
    draft.setLayers([
      ...draft.layers,
      {
        id,
        name: p.name,
        color: p.color ?? DEFAULT_LAYER_STYLE.color,
        linetype: p.linetype ?? DEFAULT_LAYER_STYLE.linetype,
        lineweight: p.lineweight ?? DEFAULT_LAYER_STYLE.lineweight,
        visible: true,
        locked: false,
      },
    ]);
    return { id };
  },
});

export interface UpdateLayerParams {
  readonly id: number;
  readonly name?: string;
  readonly color?: Rgb;
  readonly linetype?: LinetypeId;
  readonly lineweight?: Lineweight;
  readonly visible?: boolean;
  readonly locked?: boolean;
}

const updateLayer = define<UpdateLayerParams, Record<string, never>>({
  id: 'layer.update',
  label: 'Change layer',
  parse(raw) {
    const o = readObject(raw, '', ['id'], ['name', 'color', 'linetype', 'lineweight', 'visible', 'locked']);
    const patch = {
      name: optional(o, 'name', (v, path) => readName(v, path, MAX_NAME_LENGTH)),
      color: optional(o, 'color', readRgb),
      linetype: optional(o, 'linetype', readLinetype),
      lineweight: optional(o, 'lineweight', readLineweight),
      visible: optional(o, 'visible', readBoolean),
      locked: optional(o, 'locked', readBoolean),
    };
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(given).length === 0) throw new ValidationError('', 'give at least one layer property to change');
    return { id: readPositiveInteger(o['id'], 'id'), ...given };
  },
  run(draft, p) {
    const layer = requireLayer(draft, p.id);
    if (p.name !== undefined) requireUniqueName(draft, p.name, p.id);
    const updated: Layer = {
      ...layer,
      ...(p.name !== undefined && { name: p.name }),
      ...(p.color !== undefined && { color: p.color }),
      ...(p.linetype !== undefined && { linetype: p.linetype }),
      ...(p.lineweight !== undefined && { lineweight: p.lineweight }),
      ...(p.visible !== undefined && { visible: p.visible }),
      ...(p.locked !== undefined && { locked: p.locked }),
    };
    const same = (Object.keys(updated) as (keyof Layer)[]).every((k) => updated[k] === layer[k]);
    if (!same) draft.setLayers(draft.layers.map((l) => (l.id === p.id ? updated : l)));
    return {};
  },
});

export interface LayerIdParams {
  readonly id: number;
}

function readLayerId(raw: unknown): LayerIdParams {
  const o = readObject(raw, '', ['id']);
  return { id: readPositiveInteger(o['id'], 'id') };
}

const deleteLayer = define<LayerIdParams, Record<string, never>>({
  id: 'layer.delete',
  label: 'Delete layer',
  parse: readLayerId,
  run(draft, p) {
    const layer = requireLayer(draft, p.id);
    if (draft.layers.length === 1) throw new CommandError('A drawing needs at least one layer.');
    if (draft.settings.currentLayer === p.id) {
      throw new CommandError(`Layer "${layer.name}" is the current layer. Make another layer current first.`);
    }
    for (const e of draft.entities()) {
      if (e.layer === p.id) throw new CommandError(`Layer "${layer.name}" is not empty. Move or delete its contents first.`);
    }
    draft.setLayers(draft.layers.filter((l) => l.id !== p.id));
    return {};
  },
});

const setCurrentLayer = define<LayerIdParams, Record<string, never>>({
  id: 'layer.setCurrent',
  label: 'Set current layer',
  parse: readLayerId,
  run(draft, p) {
    requireLayer(draft, p.id);
    if (draft.settings.currentLayer !== p.id) draft.setSettings({ ...draft.settings, currentLayer: p.id });
    return {};
  },
});

// ---------- document commands ----------

export interface SetTitleParams {
  readonly title: string;
}

const setTitle = define<SetTitleParams, Record<string, never>>({
  id: 'doc.setTitle',
  label: 'Rename drawing',
  parse(raw) {
    const o = readObject(raw, '', ['title']);
    return { title: readName(o['title'], 'title', MAX_TITLE_LENGTH) };
  },
  run(draft, p) {
    if (draft.settings.title !== p.title) draft.setSettings({ ...draft.settings, title: p.title });
    return {};
  },
});

export interface SetUnitsParams {
  readonly units: LengthUnit;
  /**
   * true: keep real-world sizes, rescaling geometry about the origin (100 mm becomes 3.937 in).
   * false: keep the numbers and only relabel them (100 mm becomes 100 in).
   */
  readonly convert: boolean;
}

const setUnits = define<SetUnitsParams, Record<string, never>>({
  id: 'doc.setUnits',
  label: 'Change units',
  parse(raw) {
    const o = readObject(raw, '', ['units', 'convert']);
    return { units: readOneOf(o['units'], 'units', LENGTH_UNITS), convert: readBoolean(o['convert'], 'convert') };
  },
  run(draft, p) {
    const from = draft.settings.units;
    if (from === p.units) return {};
    if (p.convert) {
      const t = scaleAbout(ORIGIN, convertLength(1, from, p.units));
      for (const e of [...draft.entities()]) draft.putEntity({ ...e, geom: applyTransform(t, e.geom) });
    }
    draft.setSettings({ ...draft.settings, units: p.units });
    return {};
  },
});

// ---------- registry ----------

export const COMMANDS = {
  ...EDIT_COMMANDS,
  ...NOTE_COMMANDS,
  'entity.add': addEntity,
  'entity.delete': deleteEntities,
  'entity.transform': transformEntities,
  'entity.copy': copyEntities,
  'entity.setProps': setEntityProps,
  'layer.add': addLayer,
  'layer.update': updateLayer,
  'layer.delete': deleteLayer,
  'layer.setCurrent': setCurrentLayer,
  'doc.setTitle': setTitle,
  'doc.setUnits': setUnits,
} as const;

export type CommandId = keyof typeof COMMANDS;
export type ParamsOf<K extends CommandId> = (typeof COMMANDS)[K] extends CommandDef<infer P, unknown> ? P : never;
export type ResultOf<K extends CommandId> = (typeof COMMANDS)[K] extends CommandDef<unknown, infer R> ? R : never;

export function isCommandId(id: string): id is CommandId {
  return Object.hasOwn(COMMANDS, id);
}
