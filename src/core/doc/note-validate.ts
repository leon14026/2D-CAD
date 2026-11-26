/**
 * Strict readers for notes and dimension styles (from files and from command parameters).
 */
import type { Vec2 } from '../geom';
import { readColorRef, readLineweightRef, readName } from './styles';
import {
  EMPTY_TITLE_FIELDS,
  HATCH_PATTERNS,
  MAX_FIELD_LENGTH,
  MAX_LEADER_POINTS,
  MAX_STYLE_NAME,
  MAX_TEXT_LENGTH,
  SHEET_SIZES,
  TITLE_FIELDS,
  type DimStyle,
  type Note,
  type NoteBody,
  type PointRef,
  type TitleFields,
} from './notes';
import {
  join,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readOneOf,
  readPoint,
  readPositiveInteger,
  readString,
  ValidationError,
  type Obj,
} from './validate';

const LIMIT = 1e9;

function readSize(v: unknown, path: string, min: 'positive' | 'zero'): number {
  const n = readNumber(v, path);
  if (min === 'positive' ? !(n > 0) : n < 0) {
    throw new ValidationError(path, `must be ${min === 'positive' ? 'more than 0' : '0 or more'}, not ${n}`);
  }
  if (n > LIMIT) throw new ValidationError(path, `must be at most ${LIMIT}, not ${n}`);
  return n;
}

function readPlaces(v: unknown, path: string): number {
  const n = readNumber(v, path);
  if (!Number.isInteger(n) || n < 0 || n > 8) throw new ValidationError(path, `must be a whole number from 0 to 8, not ${n}`);
  return n;
}

const STYLE_KEYS = [
  'name',
  'textHeight',
  'arrowSize',
  'extGap',
  'extOver',
  'textGap',
  'precision',
  'anglePrecision',
  'centreMark',
  'centreOver',
] as const;

export function readDimStyle(v: unknown, path: string): DimStyle {
  const o = readObject(v, path, STYLE_KEYS);
  return {
    name: readName(o['name'], join(path, 'name'), MAX_STYLE_NAME),
    textHeight: readSize(o['textHeight'], join(path, 'textHeight'), 'positive'),
    arrowSize: readSize(o['arrowSize'], join(path, 'arrowSize'), 'positive'),
    extGap: readSize(o['extGap'], join(path, 'extGap'), 'zero'),
    extOver: readSize(o['extOver'], join(path, 'extOver'), 'zero'),
    textGap: readSize(o['textGap'], join(path, 'textGap'), 'zero'),
    precision: readPlaces(o['precision'], join(path, 'precision')),
    anglePrecision: readPlaces(o['anglePrecision'], join(path, 'anglePrecision')),
    centreMark: readSize(o['centreMark'], join(path, 'centreMark'), 'positive'),
    centreOver: readSize(o['centreOver'], join(path, 'centreOver'), 'zero'),
  };
}

function point(p: Vec2): Vec2 {
  return { x: p.x + 0, y: p.y + 0 };
}

export function readPointRef(v: unknown, path: string): PointRef {
  const head = readObject(v, path, ['kind'], ['p', 'id', 'end', 'index']);
  const kind = readOneOf(head['kind'], join(path, 'kind'), ['free', 'end', 'vertex', 'mid', 'center'] as const);
  switch (kind) {
    case 'free': {
      const o = readObject(v, path, ['kind', 'p']);
      return { kind, p: point(readPoint(o['p'], join(path, 'p'))) };
    }
    case 'end': {
      const o = readObject(v, path, ['kind', 'id', 'end']);
      return { kind, id: readPositiveInteger(o['id'], join(path, 'id')), end: readOneOf(o['end'], join(path, 'end'), ['start', 'end'] as const) };
    }
    case 'vertex': {
      const o = readObject(v, path, ['kind', 'id', 'index']);
      const index = readNumber(o['index'], join(path, 'index'));
      if (!Number.isSafeInteger(index) || index < 0) throw new ValidationError(join(path, 'index'), `must be a whole number of 0 or more, not ${index}`);
      return { kind, id: readPositiveInteger(o['id'], join(path, 'id')), index };
    }
    case 'mid':
    case 'center': {
      const o = readObject(v, path, ['kind', 'id']);
      return { kind, id: readPositiveInteger(o['id'], join(path, 'id')) };
    }
  }
}

function readText(v: unknown, path: string, allowEmpty: boolean, max: number): string {
  const s = readString(v, path);
  if (s.length > max) throw new ValidationError(path, `must be at most ${max} characters`);
  if (!allowEmpty && s.trim() === '') throw new ValidationError(path, 'must not be empty');
  return s;
}

function readTitleFields(v: unknown, path: string): TitleFields {
  const o = readObject(v, path, TITLE_FIELDS);
  const out: Record<string, string> = { ...EMPTY_TITLE_FIELDS };
  for (const k of TITLE_FIELDS) out[k] = readText(o[k], join(path, k), true, MAX_FIELD_LENGTH);
  return out as unknown as TitleFields;
}

const ALL_BODY_KEYS = [
  'kind',
  'orient',
  'a',
  'b',
  'vertex',
  'at',
  'style',
  'target',
  'height',
  'angle',
  'anchor',
  'text',
  'points',
  'extended',
  'loops',
  'pattern',
  'spacing',
  'size',
  'fields',
] as const;

export function readNoteBody(v: unknown, path: string): NoteBody {
  const head = readObject(v, path, ['kind'], ALL_BODY_KEYS.filter((k) => k !== 'kind'));
  const kind = readOneOf(head['kind'], join(path, 'kind'), [
    'linear',
    'aligned',
    'radius',
    'diameter',
    'angle',
    'text',
    'leader',
    'centre',
    'hatch',
    'titleBlock',
  ] as const);
  const style = (o: Obj) => readName(o['style'], join(path, 'style'), MAX_STYLE_NAME);
  switch (kind) {
    case 'linear': {
      const o = readObject(v, path, ['kind', 'orient', 'a', 'b', 'at', 'style']);
      return {
        kind,
        orient: readOneOf(o['orient'], join(path, 'orient'), ['horizontal', 'vertical'] as const),
        a: readPointRef(o['a'], join(path, 'a')),
        b: readPointRef(o['b'], join(path, 'b')),
        at: point(readPoint(o['at'], join(path, 'at'))),
        style: style(o),
      };
    }
    case 'aligned': {
      const o = readObject(v, path, ['kind', 'a', 'b', 'at', 'style']);
      return {
        kind,
        a: readPointRef(o['a'], join(path, 'a')),
        b: readPointRef(o['b'], join(path, 'b')),
        at: point(readPoint(o['at'], join(path, 'at'))),
        style: style(o),
      };
    }
    case 'radius':
    case 'diameter': {
      const o = readObject(v, path, ['kind', 'target', 'at', 'style']);
      return { kind, target: readPositiveInteger(o['target'], join(path, 'target')), at: point(readPoint(o['at'], join(path, 'at'))), style: style(o) };
    }
    case 'angle': {
      const o = readObject(v, path, ['kind', 'vertex', 'a', 'b', 'at', 'style']);
      return {
        kind,
        vertex: readPointRef(o['vertex'], join(path, 'vertex')),
        a: readPointRef(o['a'], join(path, 'a')),
        b: readPointRef(o['b'], join(path, 'b')),
        at: point(readPoint(o['at'], join(path, 'at'))),
        style: style(o),
      };
    }
    case 'text': {
      const o = readObject(v, path, ['kind', 'at', 'height', 'angle', 'anchor', 'text']);
      return {
        kind,
        at: point(readPoint(o['at'], join(path, 'at'))),
        height: readSize(o['height'], join(path, 'height'), 'positive'),
        angle: readNumber(o['angle'], join(path, 'angle')),
        anchor: readOneOf(o['anchor'], join(path, 'anchor'), ['left', 'center', 'right'] as const),
        text: readText(o['text'], join(path, 'text'), false, MAX_TEXT_LENGTH),
      };
    }
    case 'leader': {
      const o = readObject(v, path, ['kind', 'points', 'text', 'style']);
      const list = readArray(o['points'], join(path, 'points'));
      if (list.length < 2) throw new ValidationError(join(path, 'points'), 'must have at least 2 points');
      if (list.length > MAX_LEADER_POINTS) throw new ValidationError(join(path, 'points'), `must have at most ${MAX_LEADER_POINTS} points`);
      const points = list.map((p, i) => point(readPoint(p, join(join(path, 'points'), i))));
      points.forEach((p, i) => {
        const q = points[i + 1];
        if (q && p.x === q.x && p.y === q.y) throw new ValidationError(join(join(path, 'points'), i + 1), 'is the same point as the one before it');
      });
      return { kind, points, text: readText(o['text'], join(path, 'text'), true, MAX_TEXT_LENGTH), style: style(o) };
    }
    case 'centre': {
      const o = readObject(v, path, ['kind', 'target', 'extended', 'style']);
      return { kind, target: readPositiveInteger(o['target'], join(path, 'target')), extended: readBoolean(o['extended'], join(path, 'extended')), style: style(o) };
    }
    case 'hatch': {
      const o = readObject(v, path, ['kind', 'loops', 'pattern', 'spacing', 'angle']);
      const loops = readArray(o['loops'], join(path, 'loops')).map((l, i) => {
        const lp = join(join(path, 'loops'), i);
        const ids = readArray(l, lp);
        if (ids.length === 0) throw new ValidationError(lp, 'must list at least one id');
        if (ids.length > 1000) throw new ValidationError(lp, 'must list at most 1000 ids');
        return ids.map((id, j) => readPositiveInteger(id, join(lp, j)));
      });
      if (loops.length === 0) throw new ValidationError(join(path, 'loops'), 'must have at least one boundary');
      const flat = loops.flat();
      if (new Set(flat).size !== flat.length) throw new ValidationError(join(path, 'loops'), 'uses the same entity twice');
      return {
        kind,
        loops,
        pattern: readOneOf(o['pattern'], join(path, 'pattern'), HATCH_PATTERNS),
        spacing: readSize(o['spacing'], join(path, 'spacing'), 'positive'),
        angle: readNumber(o['angle'], join(path, 'angle')),
      };
    }
    case 'titleBlock': {
      const o = readObject(v, path, ['kind', 'at', 'size', 'fields']);
      return {
        kind,
        at: point(readPoint(o['at'], join(path, 'at'))),
        size: readOneOf(o['size'], join(path, 'size'), SHEET_SIZES),
        fields: readTitleFields(o['fields'], join(path, 'fields')),
      };
    }
  }
}

export function readNote(v: unknown, path: string): Note {
  const o = readObject(v, path, ['id', 'layer', 'z', 'color', 'lineweight', 'body']);
  return {
    id: readPositiveInteger(o['id'], join(path, 'id')),
    layer: readPositiveInteger(o['layer'], join(path, 'layer')),
    z: readNumber(o['z'], join(path, 'z')),
    color: readColorRef(o['color'], join(path, 'color')),
    lineweight: readLineweightRef(o['lineweight'], join(path, 'lineweight')),
    body: readNoteBody(o['body'], join(path, 'body')),
  };
}
