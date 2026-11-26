import type { LengthUnit, Shape } from '../geom';
import { DEFAULT_DIM_STYLE, DEFAULT_DIM_STYLE_NAME, type DimStyle, type Note } from './notes';
import {
  BY_LAYER,
  DEFAULT_LAYER_STYLE,
  type ColorRef,
  type LinetypeId,
  type LinetypeRef,
  type Lineweight,
  type LineweightRef,
  type Rgb,
} from './styles';

export interface Layer {
  readonly id: number;
  readonly name: string;
  readonly color: Rgb;
  readonly linetype: LinetypeId;
  readonly lineweight: Lineweight;
  readonly visible: boolean;
  /** Entities on a locked layer cannot be added, changed or deleted. */
  readonly locked: boolean;
}

export interface Entity {
  readonly id: number;
  readonly layer: number;
  /** Draw order: lower first; ties broken by id. New entities get z = id. */
  readonly z: number;
  readonly color: ColorRef;
  readonly linetype: LinetypeRef;
  readonly lineweight: LineweightRef;
  readonly geom: Shape;
}

export interface DocSettings {
  readonly title: string;
  readonly units: LengthUnit;
  readonly currentLayer: number;
  /** Named dimension styles; the first is always "ISO". */
  readonly dimStyles: readonly DimStyle[];
  /** The style new dimensions, leaders and centre marks use. */
  readonly currentDimStyle: string;
}

/**
 * A drawing. Immutable: every edit produces a new Doc. Layers and entities share one id
 * space, allocated from `nextId`.
 */
export interface Doc {
  readonly settings: DocSettings;
  readonly nextId: number;
  readonly layers: readonly Layer[];
  readonly entities: ReadonlyMap<number, Entity>;
  /** Dimensions, text, hatches and the rest. They share the id space and layers with entities. */
  readonly notes: ReadonlyMap<number, Note>;
}

export const MAX_NAME_LENGTH = 64;
export const MAX_TITLE_LENGTH = 200;
export const DEFAULT_LAYER_NAME = 'Default';

export interface NewDocumentOptions {
  readonly title?: string;
  readonly units?: LengthUnit;
}

export function newDocument(options: NewDocumentOptions = {}): Doc {
  const layer: Layer = {
    id: 1,
    name: DEFAULT_LAYER_NAME,
    ...DEFAULT_LAYER_STYLE,
    visible: true,
    locked: false,
  };
  return {
    settings: {
      title: options.title ?? 'Untitled',
      units: options.units ?? 'mm',
      currentLayer: 1,
      dimStyles: [DEFAULT_DIM_STYLE],
      currentDimStyle: DEFAULT_DIM_STYLE_NAME,
    },
    nextId: 2,
    layers: [layer],
    entities: new Map(),
    notes: new Map(),
  };
}

export function findLayer(doc: Doc, id: number): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

/** Layer names are unique ignoring case. */
export function findLayerByName(doc: Doc, name: string): Layer | undefined {
  const key = name.trim().toLowerCase();
  return doc.layers.find((l) => l.name.toLowerCase() === key);
}

export function compareDrawOrder(a: { readonly z: number; readonly id: number }, b: { readonly z: number; readonly id: number }): number {
  return a.z - b.z || a.id - b.id;
}

export function entitiesInDrawOrder(doc: Doc): Entity[] {
  return [...doc.entities.values()].sort(compareDrawOrder);
}

export interface ResolvedStyle {
  readonly color: Rgb;
  readonly linetype: LinetypeId;
  readonly lineweight: Lineweight;
}

/** The colour, linetype and lineweight an entity is drawn with, after resolving "byLayer". */
export function resolveStyle(doc: Doc, e: Entity): ResolvedStyle {
  const layer = findLayer(doc, e.layer);
  if (!layer) throw new Error(`entity ${e.id} refers to missing layer ${e.layer}`);
  return {
    color: e.color === BY_LAYER ? layer.color : e.color,
    linetype: e.linetype === BY_LAYER ? layer.linetype : e.linetype,
    lineweight: e.lineweight === BY_LAYER ? layer.lineweight : e.lineweight,
  };
}

/** Notes in draw order, hatches first so they lie under the geometry. */
export function notesInDrawOrder(doc: Doc): Note[] {
  return [...doc.notes.values()].sort(compareDrawOrder);
}

/** The colour and lineweight a note is drawn with, after resolving "byLayer". */
export function resolveNoteStyle(doc: Doc, n: Note): { color: Rgb; lineweight: Lineweight } {
  const layer = findLayer(doc, n.layer);
  if (!layer) throw new Error(`note ${n.id} refers to missing layer ${n.layer}`);
  return {
    color: n.color === BY_LAYER ? layer.color : n.color,
    lineweight: n.lineweight === BY_LAYER ? layer.lineweight : n.lineweight,
  };
}
