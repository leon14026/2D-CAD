/**
 * ArchiLite's native file format: versioned JSON (see docs/file-format.md).
 *
 * Saving is canonical: the same document always produces byte-identical text, with one layer or
 * entity per line so files diff cleanly in git. Loading validates everything and reports the
 * first problem with its location.
 */
import { LENGTH_UNITS } from '../geom';
import { MAX_NAME_LENGTH, MAX_TITLE_LENGTH, compareDrawOrder, type Doc, type Entity, type Layer } from './model';
import { DEFAULT_DIM_STYLE, DEFAULT_DIM_STYLE_NAME, docEnv, resolveNote, type DimStyle, type Note } from './notes';
import { readDimStyle, readNote } from './note-validate';
import {
  readColorRef,
  readLinetype,
  readLinetypeRef,
  readLineweight,
  readLineweightRef,
  readName,
  readRgb,
} from './styles';
import {
  describeValue,
  join,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readOneOf,
  readPositiveInteger,
  readShape,
  ValidationError,
} from './validate';

export const FILE_FORMAT = 'archilite';
export const FILE_VERSION = 2;
export const FILE_EXTENSION = '.archilite';

export class FileFormatError extends Error {
  constructor(
    message: string,
    /** Where in the file the problem is, e.g. "entities[3].geom.radius"; empty if not specific. */
    readonly path: string = '',
  ) {
    super(message);
    this.name = 'FileFormatError';
  }
}

// ---------- saving ----------

function layerJson(l: Layer): object {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    linetype: l.linetype,
    lineweight: l.lineweight,
    visible: l.visible,
    locked: l.locked,
  };
}

function entityJson(e: Entity): object {
  return { id: e.id, layer: e.layer, z: e.z, color: e.color, linetype: e.linetype, lineweight: e.lineweight, geom: e.geom };
}

function noteJson(n: Note): object {
  return { id: n.id, layer: n.layer, z: n.z, color: n.color, lineweight: n.lineweight, body: n.body };
}

function list(items: readonly object[]): string {
  if (items.length === 0) return '[]';
  return `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]`;
}

export function saveDocument(doc: Doc): string {
  const entities = [...doc.entities.values()].sort(compareDrawOrder);
  const notes = [...doc.notes.values()].sort(compareDrawOrder);
  const s = doc.settings;
  return [
    '{',
    `  "format": ${JSON.stringify(FILE_FORMAT)},`,
    `  "version": ${FILE_VERSION},`,
    `  "title": ${JSON.stringify(s.title)},`,
    `  "units": ${JSON.stringify(s.units)},`,
    `  "currentLayer": ${s.currentLayer},`,
    `  "currentDimStyle": ${JSON.stringify(s.currentDimStyle)},`,
    `  "nextId": ${doc.nextId},`,
    `  "dimStyles": ${list(s.dimStyles)},`,
    `  "layers": ${list(doc.layers.map(layerJson))},`,
    `  "entities": ${list(entities.map(entityJson))},`,
    `  "notes": ${list(notes.map(noteJson))}`,
    '}',
    '',
  ].join('\n');
}

// ---------- loading ----------

const TOP_LEVEL = ['format', 'version', 'title', 'units', 'currentLayer', 'nextId', 'layers', 'entities'] as const;
/** Added in file format 2. A version 1 file has none of them. */
const V2_FIELDS = ['currentDimStyle', 'dimStyles', 'notes'] as const;

function readLayer(v: unknown, path: string): Layer {
  const o = readObject(v, path, ['id', 'name', 'color', 'linetype', 'lineweight', 'visible', 'locked']);
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    name: readName(o['name'], join(path, 'name'), MAX_NAME_LENGTH),
    color: readRgb(o['color'], join(path, 'color')),
    linetype: readLinetype(o['linetype'], join(path, 'linetype')),
    lineweight: readLineweight(o['lineweight'], join(path, 'lineweight')),
    visible: readBoolean(o['visible'], join(path, 'visible')),
    locked: readBoolean(o['locked'], join(path, 'locked')),
  };
}

function readEntity(v: unknown, path: string): Entity {
  const o = readObject(v, path, ['id', 'layer', 'z', 'color', 'linetype', 'lineweight', 'geom']);
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    layer: readPositiveInteger(o['layer'], join(path, 'layer')),
    z: readNumber(o['z'], join(path, 'z')),
    color: readColorRef(o['color'], join(path, 'color')),
    linetype: readLinetypeRef(o['linetype'], join(path, 'linetype')),
    lineweight: readLineweightRef(o['lineweight'], join(path, 'lineweight')),
    geom: readShape(o['geom'], join(path, 'geom')),
  };
}

/** Builds a Doc from parsed JSON, checking every field and every cross-reference. */
export function documentFromJson(data: unknown): Doc {
  try {
    return readDocument(data);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new FileFormatError(`Problem in the drawing file at ${err.path || 'the top level'}: ${err.reason}.`, err.path);
    }
    throw err;
  }
}

function readDocument(data: unknown): Doc {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new FileFormatError(`Not an ArchiLite drawing: the file holds ${describeValue(data)}, not a drawing.`);
  }
  const raw = data as Record<string, unknown>;
  if (raw['format'] !== FILE_FORMAT) {
    throw new FileFormatError(
      `Not an ArchiLite drawing: the "format" field must be "${FILE_FORMAT}" but is ${describeValue(raw['format'])}.`,
      'format',
    );
  }
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new FileFormatError(`The file's "version" must be a whole number of 1 or more, not ${describeValue(version)}.`, 'version');
  }
  if (version > FILE_VERSION) {
    throw new FileFormatError(
      `This drawing was saved by a newer version of ArchiLite (file format ${version}). ` +
        `This version can open file format ${FILE_VERSION}. Update ArchiLite to open it.`,
      'version',
    );
  }

  const o = version >= 2 ? readObject(data, '', [...TOP_LEVEL, ...V2_FIELDS]) : readObject(data, '', TOP_LEVEL);
  const title = readName(o['title'], 'title', MAX_TITLE_LENGTH);
  const units = readOneOf(o['units'], 'units', LENGTH_UNITS);
  const layers = readArray(o['layers'], 'layers').map((v, i) => readLayer(v, join('layers', i)));
  if (layers.length === 0) throw new ValidationError('layers', 'must contain at least one layer');
  const entityList = readArray(o['entities'], 'entities').map((v, i) => readEntity(v, join('entities', i)));

  const dimStyles: readonly DimStyle[] =
    version >= 2 ? readArray(o['dimStyles'], 'dimStyles').map((v, i) => readDimStyle(v, join('dimStyles', i))) : [DEFAULT_DIM_STYLE];
  if (dimStyles.length === 0) throw new ValidationError('dimStyles', 'must contain at least one style');
  const styleNames = new Set<string>();
  dimStyles.forEach((st, i) => {
    const key = st.name.toLowerCase();
    if (styleNames.has(key)) throw new ValidationError(join(join('dimStyles', i), 'name'), `"${st.name}" is already used by another style`);
    styleNames.add(key);
  });
  const currentDimStyle =
    version >= 2 ? readName(o['currentDimStyle'], 'currentDimStyle', 32) : DEFAULT_DIM_STYLE_NAME;
  if (!dimStyles.some((st) => st.name === currentDimStyle)) {
    throw new ValidationError('currentDimStyle', `there is no dimension style called "${currentDimStyle}"`);
  }
  const noteList: Note[] = version >= 2 ? readArray(o['notes'], 'notes').map((v, i) => readNote(v, join('notes', i))) : [];

  const ids = new Map<number, string>();
  const claim = (id: number, path: string) => {
    const other = ids.get(id);
    if (other) throw new ValidationError(path, `id ${id} is already used by ${other}`);
    ids.set(id, path);
  };
  const names = new Map<string, string>();
  layers.forEach((l, i) => {
    const path = join('layers', i);
    claim(l.id, path);
    const key = l.name.toLowerCase();
    const other = names.get(key);
    if (other) throw new ValidationError(join(path, 'name'), `"${l.name}" is already used by ${other}`);
    names.set(key, path);
  });
  const layerIds = new Set(layers.map((l) => l.id));
  const entities = new Map<number, Entity>();
  entityList.forEach((e, i) => {
    const path = join('entities', i);
    claim(e.id, path);
    if (!layerIds.has(e.layer)) throw new ValidationError(join(path, 'layer'), `there is no layer with id ${e.layer}`);
    entities.set(e.id, e);
  });

  const notes = new Map<number, Note>();
  noteList.forEach((n, i) => {
    const path = join('notes', i);
    claim(n.id, path);
    if (!layerIds.has(n.layer)) throw new ValidationError(join(path, 'layer'), `there is no layer with id ${n.layer}`);
    notes.set(n.id, n);
  });

  const currentLayer = readPositiveInteger(o['currentLayer'], 'currentLayer');
  if (!layerIds.has(currentLayer)) throw new ValidationError('currentLayer', `there is no layer with id ${currentLayer}`);
  const nextId = readPositiveInteger(o['nextId'], 'nextId');
  const maxId = Math.max(...ids.keys());
  if (nextId <= maxId) throw new ValidationError('nextId', `must be greater than every id in the file (${maxId}), not ${nextId}`);

  const doc: Doc = { settings: { title, units, currentLayer, dimStyles, currentDimStyle }, nextId, layers, entities, notes };
  const env = docEnv(doc);
  noteList.forEach((n, i) => {
    const r = resolveNote(env, n);
    if (!r.ok) throw new ValidationError(join('notes', i), r.why);
  });
  return doc;
}

/** Reads a drawing from file text. Throws FileFormatError with a plain-language message. */
export function loadDocument(text: string): Doc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new FileFormatError(`Not an ArchiLite drawing: the file is not valid JSON (${(err as Error).message}).`);
  }
  return documentFromJson(data);
}
