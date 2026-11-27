/**
 * ArchiLite's native file format: versioned JSON (see docs/file-format.md).
 *
 * Saving is canonical: the same document always produces byte-identical text, with one layer or
 * entity per line so files diff cleanly in git. Loading validates everything and reports the
 * first problem with its location.
 */
import { LENGTH_UNITS } from '../geom';
import { findBlock, type Block, type BlockMember, type Insert } from './blocks';
import { constraintProblem, type Constraint } from './constraints';
import { readConstraintBody } from './layout-commands';
import { MAX_NAME_LENGTH, MAX_TITLE_LENGTH, compareDrawOrder, type Doc, type Entity, type Layer } from './model';
import { DEFAULT_DIM_STYLE, DEFAULT_DIM_STYLE_NAME, SHEET_SIZES, docEnv, resolveNote, type DimStyle, type Note } from './notes';
import { readDimStyle, readNote } from './note-validate';
import { defaultSheets, findSheet, type Sheet } from './sheets';
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
  readPoint,
  readPositiveInteger,
  readShape,
  ValidationError,
} from './validate';

export const FILE_FORMAT = 'archilite';
export const FILE_VERSION = 3;
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
  return {
    id: e.id,
    layer: e.layer,
    z: e.z,
    color: e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
    geom: e.geom,
    ...(e.sheet ? { sheet: e.sheet } : {}),
  };
}

function noteJson(n: Note): object {
  return {
    id: n.id,
    layer: n.layer,
    z: n.z,
    color: n.color,
    lineweight: n.lineweight,
    body: n.body,
    ...(n.sheet ? { sheet: n.sheet } : {}),
  };
}

function insertJson(ins: Insert): object {
  return {
    id: ins.id,
    layer: ins.layer,
    z: ins.z,
    color: ins.color,
    linetype: ins.linetype,
    lineweight: ins.lineweight,
    block: ins.block,
    at: ins.at,
    ...(ins.rotation !== 0 ? { rotation: ins.rotation } : {}),
    ...(ins.scale !== 1 ? { scale: ins.scale } : {}),
    ...(ins.flipped ? { flipped: true } : {}),
    ...(ins.sheet ? { sheet: ins.sheet } : {}),
  };
}

function constraintJson(c: Constraint): object {
  return { id: c.id, body: c.body, ...(c.sheet ? { sheet: c.sheet } : {}) };
}

function blockJson(b: Block): object {
  return { name: b.name, members: b.members };
}

function list(items: readonly object[]): string {
  if (items.length === 0) return '[]';
  return `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]`;
}

export function saveDocument(doc: Doc): string {
  const entities = [...doc.entities.values()].sort(compareDrawOrder);
  const notes = [...doc.notes.values()].sort(compareDrawOrder);
  const inserts = [...doc.inserts.values()].sort(compareDrawOrder);
  const constraints = [...doc.constraints.values()].sort((a, b) => a.id - b.id);
  const s = doc.settings;
  return [
    '{',
    `  "format": ${JSON.stringify(FILE_FORMAT)},`,
    `  "version": ${FILE_VERSION},`,
    `  "title": ${JSON.stringify(s.title)},`,
    `  "units": ${JSON.stringify(s.units)},`,
    `  "currentLayer": ${s.currentLayer},`,
    `  "currentDimStyle": ${JSON.stringify(s.currentDimStyle)},`,
    `  "currentSheet": ${JSON.stringify(s.currentSheet)},`,
    `  "nextId": ${doc.nextId},`,
    `  "dimStyles": ${list(s.dimStyles)},`,
    `  "layers": ${list(doc.layers.map(layerJson))},`,
    `  "sheets": ${list(doc.sheets)},`,
    `  "blocks": ${list(doc.blocks.map(blockJson))},`,
    `  "entities": ${list(entities.map(entityJson))},`,
    `  "notes": ${list(notes.map(noteJson))},`,
    `  "inserts": ${list(inserts.map(insertJson))},`,
    `  "constraints": ${list(constraints.map(constraintJson))}`,
    '}',
    '',
  ].join('\n');
}

// ---------- loading ----------

const TOP_LEVEL = ['format', 'version', 'title', 'units', 'currentLayer', 'nextId', 'layers', 'entities'] as const;
/** Added in file format 2. A version 1 file has none of them. */
const V2_FIELDS = ['currentDimStyle', 'dimStyles', 'notes'] as const;
/** Added in file format 3. */
const V3_FIELDS = ['currentSheet', 'sheets', 'blocks', 'inserts', 'constraints'] as const;

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

function readSheetName(v: unknown, path: string): string {
  return readName(v, path, MAX_NAME_LENGTH);
}

function readEntity(v: unknown, path: string): Entity {
  const o = readObject(v, path, ['id', 'layer', 'z', 'color', 'linetype', 'lineweight', 'geom'], ['sheet']);
  const sheet = Object.hasOwn(o, 'sheet') ? readSheetName(o['sheet'], join(path, 'sheet')) : undefined;
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    layer: readPositiveInteger(o['layer'], join(path, 'layer')),
    z: readNumber(o['z'], join(path, 'z')),
    color: readColorRef(o['color'], join(path, 'color')),
    linetype: readLinetypeRef(o['linetype'], join(path, 'linetype')),
    lineweight: readLineweightRef(o['lineweight'], join(path, 'lineweight')),
    geom: readShape(o['geom'], join(path, 'geom')),
    ...(sheet ? { sheet } : {}),
  };
}

function readMember(v: unknown, path: string): BlockMember {
  const o = readObject(v, path, ['geom', 'color', 'linetype', 'lineweight']);
  return {
    geom: readShape(o['geom'], join(path, 'geom')),
    color: readColorRef(o['color'], join(path, 'color')),
    linetype: readLinetypeRef(o['linetype'], join(path, 'linetype')),
    lineweight: readLineweightRef(o['lineweight'], join(path, 'lineweight')),
  };
}

function readBlock(v: unknown, path: string): Block {
  const o = readObject(v, path, ['name', 'members']);
  const members = readArray(o['members'], join(path, 'members')).map((m, i) => readMember(m, join(join(path, 'members'), i)));
  if (members.length === 0) throw new ValidationError(join(path, 'members'), 'must list at least one shape');
  return { name: readName(o['name'], join(path, 'name'), MAX_NAME_LENGTH), members };
}

function readInsert(v: unknown, path: string): Insert {
  const o = readObject(
    v,
    path,
    ['id', 'layer', 'z', 'color', 'linetype', 'lineweight', 'block', 'at'],
    ['rotation', 'scale', 'flipped', 'sheet'],
  );
  const rotation = Object.hasOwn(o, 'rotation') ? readNumber(o['rotation'], join(path, 'rotation')) : 0;
  const scale = Object.hasOwn(o, 'scale') ? readNumber(o['scale'], join(path, 'scale')) : 1;
  if (!(scale > 0)) throw new ValidationError(join(path, 'scale'), `must be more than 0, not ${scale}`);
  const flipped = Object.hasOwn(o, 'flipped') ? readBoolean(o['flipped'], join(path, 'flipped')) : false;
  const sheet = Object.hasOwn(o, 'sheet') ? readSheetName(o['sheet'], join(path, 'sheet')) : undefined;
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    layer: readPositiveInteger(o['layer'], join(path, 'layer')),
    z: readNumber(o['z'], join(path, 'z')),
    color: readColorRef(o['color'], join(path, 'color')),
    linetype: readLinetypeRef(o['linetype'], join(path, 'linetype')),
    lineweight: readLineweightRef(o['lineweight'], join(path, 'lineweight')),
    block: readName(o['block'], join(path, 'block'), MAX_NAME_LENGTH),
    at: readPoint(o['at'], join(path, 'at')),
    rotation,
    scale,
    flipped,
    ...(sheet ? { sheet } : {}),
  };
}

function readSheet(v: unknown, path: string): Sheet {
  const o = readObject(v, path, ['name', 'size']);
  return {
    name: readName(o['name'], join(path, 'name'), MAX_NAME_LENGTH),
    size: readOneOf(o['size'], join(path, 'size'), SHEET_SIZES),
  };
}

function readConstraint(v: unknown, path: string): Constraint {
  const o = readObject(v, path, ['id', 'body'], ['sheet']);
  const sheet = Object.hasOwn(o, 'sheet') ? readSheetName(o['sheet'], join(path, 'sheet')) : undefined;
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    body: readConstraintBody(o['body'], join(path, 'body')),
    ...(sheet ? { sheet } : {}),
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

  const fields =
    version >= 3 ? [...TOP_LEVEL, ...V2_FIELDS, ...V3_FIELDS] : version >= 2 ? [...TOP_LEVEL, ...V2_FIELDS] : [...TOP_LEVEL];
  const o = readObject(data, '', fields);
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
  const sheets: readonly Sheet[] =
    version >= 3 ? readArray(o['sheets'], 'sheets').map((v, i) => readSheet(v, join('sheets', i))) : defaultSheets();
  if (sheets.length === 0) throw new ValidationError('sheets', 'must contain at least one sheet');
  const sheetNames = new Map<string, string>();
  sheets.forEach((s, i) => {
    const key = s.name.toLowerCase();
    const other = sheetNames.get(key);
    if (other) throw new ValidationError(join(join('sheets', i), 'name'), `"${s.name}" is already used by ${other}`);
    sheetNames.set(key, join('sheets', i));
  });
  const currentSheet = version >= 3 ? readName(o['currentSheet'], 'currentSheet', MAX_NAME_LENGTH) : sheets[0]!.name;
  if (!findSheet({ sheets }, currentSheet)) {
    throw new ValidationError('currentSheet', `there is no sheet called "${currentSheet}"`);
  }
  const blockList: Block[] = version >= 3 ? readArray(o['blocks'], 'blocks').map((v, i) => readBlock(v, join('blocks', i))) : [];
  const blockNames = new Map<string, string>();
  blockList.forEach((b, i) => {
    const key = b.name.toLowerCase();
    const other = blockNames.get(key);
    if (other) throw new ValidationError(join(join('blocks', i), 'name'), `"${b.name}" is already used by ${other}`);
    blockNames.set(key, join('blocks', i));
  });
  const insertList: Insert[] = version >= 3 ? readArray(o['inserts'], 'inserts').map((v, i) => readInsert(v, join('inserts', i))) : [];
  const constraintList: Constraint[] =
    version >= 3 ? readArray(o['constraints'], 'constraints').map((v, i) => readConstraint(v, join('constraints', i))) : [];

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
    if (n.sheet && !findSheet({ sheets }, n.sheet)) throw new ValidationError(join(path, 'sheet'), `there is no sheet called "${n.sheet}"`);
    notes.set(n.id, n);
  });
  entityList.forEach((e, i) => {
    if (e.sheet && !findSheet({ sheets }, e.sheet)) {
      throw new ValidationError(join(join('entities', i), 'sheet'), `there is no sheet called "${e.sheet}"`);
    }
  });

  const inserts = new Map<number, Insert>();
  insertList.forEach((ins, i) => {
    const path = join('inserts', i);
    claim(ins.id, path);
    if (!layerIds.has(ins.layer)) throw new ValidationError(join(path, 'layer'), `there is no layer with id ${ins.layer}`);
    if (!findBlock(blockList, ins.block)) throw new ValidationError(join(path, 'block'), `there is no block called "${ins.block}"`);
    if (ins.sheet && !findSheet({ sheets }, ins.sheet)) throw new ValidationError(join(path, 'sheet'), `there is no sheet called "${ins.sheet}"`);
    inserts.set(ins.id, ins);
  });

  const constraints = new Map<number, Constraint>();
  constraintList.forEach((c, i) => {
    const path = join('constraints', i);
    claim(c.id, path);
    if (c.sheet && !findSheet({ sheets }, c.sheet)) throw new ValidationError(join(path, 'sheet'), `there is no sheet called "${c.sheet}"`);
    constraints.set(c.id, c);
  });

  const currentLayer = readPositiveInteger(o['currentLayer'], 'currentLayer');
  if (!layerIds.has(currentLayer)) throw new ValidationError('currentLayer', `there is no layer with id ${currentLayer}`);
  const nextId = readPositiveInteger(o['nextId'], 'nextId');
  const maxId = Math.max(...ids.keys());
  if (nextId <= maxId) throw new ValidationError('nextId', `must be greater than every id in the file (${maxId}), not ${nextId}`);

  const doc: Doc = {
    settings: { title, units, currentLayer, dimStyles, currentDimStyle, currentSheet },
    nextId,
    layers,
    entities,
    notes,
    sheets,
    blocks: blockList,
    inserts,
    constraints,
  };
  const env = docEnv(doc);
  noteList.forEach((n, i) => {
    const r = resolveNote(env, n);
    if (!r.ok) throw new ValidationError(join('notes', i), r.why);
  });
  constraintList.forEach((c, i) => {
    const why = constraintProblem(env, c);
    if (why) throw new ValidationError(join('constraints', i), why);
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
