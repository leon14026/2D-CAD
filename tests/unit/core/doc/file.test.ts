import { describe, expect, it } from 'vitest';
import {
  documentFromJson,
  FILE_VERSION,
  FileFormatError,
  loadDocument,
  newDocument,
  saveDocument,
  type Doc,
  type Entity,
} from '../../../../src/core/doc';
import { arc, circle, polyline, segment, vec } from '../../../../src/core/geom';
import { buildExampleBracket } from './example-bracket';

describe('saving', () => {
  it('a new document saves to exactly this text', () => {
    expect(saveDocument(newDocument())).toBe(
      [
        '{',
        '  "format": "archilite",',
        '  "version": 3,',
        '  "title": "Untitled",',
        '  "units": "mm",',
        '  "currentLayer": 1,',
        '  "currentDimStyle": "ISO",',
        '  "currentSheet": "Sheet 1",',
        '  "nextId": 2,',
        '  "dimStyles": [',
        '    {"name":"ISO","textHeight":3.5,"arrowSize":3,"extGap":1,"extOver":2,"textGap":1,"precision":2,"anglePrecision":1,"centreMark":2.5,"centreOver":2}',
        '  ],',
        '  "layers": [',
        '    {"id":1,"name":"Default","color":"#1f2a33","linetype":"continuous","lineweight":0.25,"visible":true,"locked":false}',
        '  ],',
        '  "sheets": [',
        '    {"name":"Sheet 1","size":"A4"}',
        '  ],',
        '  "blocks": [],',
        '  "entities": [],',
        '  "notes": [],',
        '  "inserts": [],',
        '  "constraints": []',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('writes entities in draw order (z, then id), whatever order they are stored in', () => {
    const e = (id: number, z: number): Entity => ({
      id,
      layer: 1,
      z,
      color: 'byLayer',
      linetype: 'byLayer',
      lineweight: 'byLayer',
      geom: segment(vec(0, 0), vec(id, 1)),
    });
    const doc: Doc = { ...newDocument(), nextId: 5, entities: new Map([[2, e(2, 9)], [3, e(3, 1)], [4, e(4, 1)]]) };
    const ids = [...saveDocument(doc).matchAll(/"id":(\d+),"layer"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([3, 4, 2]);
  });
});

describe('save → load round trip', () => {
  it('every shape kind, style overrides and odd numbers survive exactly', () => {
    const geoms = [
      segment(vec(0.1, 0.2), vec(1 / 3, 2 / 3)),
      circle(vec(-1e6, 1e-7), Math.PI),
      arc(vec(5, 5), Math.SQRT2, 6.2831853, -6.28),
      polyline(
        [
          { x: 0, y: 0, bulge: Math.tan(Math.PI / 8) },
          { x: 1e-300, y: 5e-324 },
          { x: 1.7976931348623157e308, y: -2.2250738585072014e-308, bulge: -1 },
        ],
        true,
      ),
    ];
    const entities = new Map<number, Entity>(
      geoms.map((geom, i) => [
        i + 2,
        { id: i + 2, layer: 1, z: i % 2 ? -1.5 : i + 2, color: i ? '#a0b1c2' : 'byLayer', linetype: 'dash-dot', lineweight: 1.4, geom },
      ]),
    );
    const doc: Doc = { ...newDocument({ title: 'Ünïcode "quotes" \\ ✓', units: 'in' }), nextId: 10, entities };
    const loaded = loadDocument(saveDocument(doc));
    expect(loaded).toEqual(doc);
    expect(saveDocument(loaded)).toBe(saveDocument(doc));
  });

  it('the example drawing round-trips', () => {
    const doc = buildExampleBracket();
    expect(loadDocument(saveDocument(doc))).toEqual(doc);
  });
});

/** The example file as parsed JSON, to mutate in the table below. */
const valid = () => JSON.parse(saveDocument(buildExampleBracket())) as Record<string, any>;

function rejectsWith(input: string | object, message: RegExp, path?: string) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  let error: unknown;
  try {
    loadDocument(text);
  } catch (err) {
    error = err;
  }
  expect(error, `expected ${message} for ${text.slice(0, 80)}`).toBeInstanceOf(FileFormatError);
  expect((error as FileFormatError).message).toMatch(message);
  if (path !== undefined) expect((error as FileFormatError).path).toBe(path);
}

const edit = (fn: (f: Record<string, any>) => void) => {
  const f = valid();
  fn(f);
  return f;
};

describe('malformed and future files are rejected with a clear message', () => {
  it.each([
    ['plain text', 'hello', /not valid JSON/, ''],
    ['empty file', '', /not valid JSON/, ''],
    ['truncated file', saveDocument(newDocument()).slice(0, 60), /not valid JSON/, ''],
    ['a list', '[]', /holds a list, not a drawing/, ''],
    ['null', 'null', /holds null/, ''],
    ['a number', '42', /holds number 42/, ''],
  ])('%s', (_name, text, message, path) => {
    rejectsWith(text, message, path);
  });

  it.each([
    ['missing format tag', edit((f) => delete f['format']), /"format" field must be "archilite" but is undefined/, 'format'],
    ['another program’s format', edit((f) => (f['format'] = 'dxf')), /must be "archilite" but is text "dxf"/, 'format'],
    ['missing version', edit((f) => delete f['version']), /"version" must be a whole number/, 'version'],
    ['version 0', edit((f) => (f['version'] = 0)), /"version" must be a whole number of 1 or more/, 'version'],
    ['version 1.5', edit((f) => (f['version'] = 1.5)), /"version" must be a whole number/, 'version'],
    ['version as text', edit((f) => (f['version'] = '1')), /not text "1"/, 'version'],
    ['future version 4', edit((f) => (f['version'] = 4)), /saved by a newer version of ArchiLite \(file format 4\).*open file format 3/, 'version'],
    ['future version 99', edit((f) => (f['version'] = 99)), /newer version/, 'version'],
    ['unknown units', edit((f) => (f['units'] = 'yd')), /at units: must be one of "mm", "cm", "m", "in", "ft"/, 'units'],
    ['empty title', edit((f) => (f['title'] = '  ')), /at title: must not be empty/, 'title'],
    ['unknown top-level field', edit((f) => (f['author'] = 'me')), /at author: is not a recognised field/, 'author'],
    ['missing layers', edit((f) => delete f['layers']), /at layers: is missing/, 'layers'],
    ['no layers', edit((f) => (f['layers'] = [])), /at least one layer/, 'layers'],
    ['layers not a list', edit((f) => (f['layers'] = {})), /at layers: must be a list/, 'layers'],
    ['bad layer colour', edit((f) => (f['layers'][0].color = 'red')), /"#rrggbb"/, 'layers[0].color'],
    ['other program’s linetype name', edit((f) => (f['layers'][0].linetype = 'CENTER')), /must be one of "continuous"/, 'layers[0].linetype'],
    ['non-standard lineweight', edit((f) => (f['layers'][0].lineweight = 0.3)), /0\.13, 0\.18/, 'layers[0].lineweight'],
    ['visible as text', edit((f) => (f['layers'][0].visible = 'yes')), /true or false/, 'layers[0].visible'],
    ['duplicate layer id', edit((f) => (f['layers'][1].id = f['layers'][0].id)), /id 2 is already used by layers\[0\]/, 'layers[1]'],
    ['duplicate layer name', edit((f) => (f['layers'][1].name = 'OUTLINE')), /"OUTLINE" is already used by layers\[0\]/, 'layers[1].name'],
    ['current layer missing', edit((f) => (f['currentLayer'] = 99)), /no layer with id 99/, 'currentLayer'],
    ['nextId not above every id', edit((f) => (f['nextId'] = 20)), /greater than every id in the file \(20\)/, 'nextId'],
    ['entities not a list', edit((f) => (f['entities'] = 'none')), /at entities: must be a list/, 'entities'],
    ['entity is null', edit((f) => (f['entities'][0] = null)), /must be an object, not null/, 'entities[0]'],
    ['entity on a missing layer', edit((f) => (f['entities'][3].layer = 99)), /no layer with id 99/, 'entities[3].layer'],
    ['duplicate entity id', edit((f) => (f['entities'][1].id = f['entities'][0].id)), /id 5 is already used by entities\[0\]/, 'entities[1]'],
    ['entity id clashing with a layer', edit((f) => (f['entities'][0].id = 3)), /id 3 is already used by layers\[1\]/, 'entities[0]'],
    ['unknown entity field', edit((f) => (f['entities'][0].tag = 'x')), /is not a recognised field/, 'entities[0].tag'],
    ['entity without geometry', edit((f) => delete f['entities'][0].geom), /is missing/, 'entities[0].geom'],
    ['draw order as text', edit((f) => (f['entities'][0].z = 'top')), /finite number/, 'entities[0].z'],
    ['upper-case colour', edit((f) => (f['entities'][0].color = '#ABCDEF')), /lowercase/, 'entities[0].color'],
    ['unknown shape kind', edit((f) => (f['entities'][0].geom.kind = 'spline')), /one of "segment", "circle", "arc", "polyline"/, 'entities[0].geom.kind'],
    ['negative hole radius', edit((f) => (f['entities'][1].geom.radius = -4)), /radius must be a positive finite number, got -4/, 'entities[1].geom.radius'],
    ['polyline with one vertex', edit((f) => f['entities'][0].geom.vertices.splice(1)), /at least two vertices/, 'entities[0].geom.vertices'],
    ['__proto__ key', JSON.parse(JSON.stringify(valid()).replace('"title"', '"__proto__":{"x":1},"title"')), /__proto__: is not a recognised field/, '__proto__'],
  ])('%s', (_name, file, message, path) => {
    rejectsWith(file, message, path);
  });

  it('a number too large for a double (1e999) is refused, not read as Infinity', () => {
    const text = saveDocument(buildExampleBracket()).replace('"radius":4', '"radius":1e999');
    rejectsWith(text, /finite number/, 'entities[1].geom.radius');
  });

  it('messages are plain sentences with the location', () => {
    try {
      loadDocument(JSON.stringify(edit((f) => (f['entities'][1].geom.radius = -4))));
    } catch (err) {
      expect((err as Error).message).toBe(
        'Problem in the drawing file at entities[1].geom.radius: radius must be a positive finite number, got -4.',
      );
      expect((err as Error).name).toBe('FileFormatError');
    }
  });

  it('documentFromJson accepts already-parsed data', () => {
    expect(documentFromJson(valid())).toEqual(buildExampleBracket());
    expect(FILE_VERSION).toBe(3);
  });
});
