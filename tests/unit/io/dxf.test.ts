import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSession, execute, loadDocument, newDocument, resolveNotes, saveDocument } from '../../../src/core/doc';
import {
  arc,
  arcEndPoint,
  arcStartPoint,
  circle,
  polyline,
  segment,
  vec,
  type Shape,
} from '../../../src/core/geom';
import { exportDxf, importDxf, looksLikeDxf, MAX_EXPLODED_OBJECTS } from '../../../src/io/dxf';
import { IoError } from '../../../src/io/error';
import { expectClose, expectPoint } from '../core/helpers';
import { buildExampleBracket } from '../core/doc/example-bracket';

function addShapes(...geoms: Shape[]) {
  let session = createSession(newDocument({ title: 'test', units: 'mm' }));
  for (const geom of geoms) session = execute(session, 'entity.add', { geom }).session;
  return session.doc;
}

describe('DXF sniff', () => {
  it('recognises a text DXF and not JSON', () => {
    expect(looksLikeDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n')).toBe(true);
    expect(looksLikeDxf('{"format":"archilite"}')).toBe(false);
  });

  it('refuses a file with a NUL byte', () => {
    expect(() => importDxf('0\nSECTION\n\0')).toThrow(/text form/);
  });
});

describe('DXF round-trip of geometry', () => {
  it('a 100 mm line comes back with the same ends', () => {
    const doc = addShapes(segment(vec(0, 0), vec(100, 0)));
    const { doc: back, skipped } = importDxf(exportDxf(doc));
    expect(skipped).toBe(0);
    const line = [...back.entities.values()][0]?.geom;
    expect(line?.kind).toBe('segment');
    if (line?.kind !== 'segment') return;
    expectPoint(line.start, { x: 0, y: 0 });
    expectPoint(line.end, { x: 100, y: 0 });
  });

  it('a circle keeps its centre and radius', () => {
    const doc = addShapes(circle(vec(10, 20), 4));
    const g = [...importDxf(exportDxf(doc)).doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('circle');
    if (g?.kind !== 'circle') return;
    expectPoint(g.center, { x: 10, y: 20 });
    expectClose(g.radius, 4);
  });

  it('a counter-clockwise arc and a clockwise arc keep their ends', () => {
    const ccw = arc(vec(0, 0), 10, 0, Math.PI / 2);
    const cw = arc(vec(0, 0), 10, 0, -Math.PI / 2);
    const doc = addShapes(ccw, cw);
    const back = [...importDxf(exportDxf(doc)).doc.entities.values()].map((e) => e.geom);
    const arcs = back.filter((g) => g.kind === 'arc');
    expect(arcs).toHaveLength(2);
    const ends = arcs.map((a) => [arcStartPoint(a), arcEndPoint(a)] as const);
    const wanted = [
      [arcStartPoint(ccw), arcEndPoint(ccw)],
      [arcStartPoint(cw), arcEndPoint(cw)],
    ] as const;
    for (const pair of wanted) {
      const s = pair[0];
      const e = pair[1];
      const hit = ends.some(
        ([a, b]) =>
          (Math.hypot(a.x - s.x, a.y - s.y) < 1e-9 && Math.hypot(b.x - e.x, b.y - e.y) < 1e-9) ||
          (Math.hypot(a.x - e.x, a.y - e.y) < 1e-9 && Math.hypot(b.x - s.x, b.y - s.y) < 1e-9),
      );
      expect(hit, `missing arc ${s.x},${s.y} → ${e.x},${e.y}`).toBe(true);
    }
  });

  it('a closed polyline with a bulge keeps its vertices', () => {
    const pl = polyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    );
    const g = [...importDxf(exportDxf(addShapes(pl))).doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('polyline');
    if (g?.kind !== 'polyline') return;
    expect(g.closed).toBe(true);
    expect(g.vertices).toHaveLength(4);
    expectClose(g.vertices[1]!.bulge, 1);
    expectPoint(g.vertices[0]!, { x: 0, y: 0 });
  });

  it('the example bracket round-trips its entity count and hole radii', () => {
    const doc = buildExampleBracket();
    const { doc: back } = importDxf(exportDxf(doc));
    expect(back.entities.size).toBe(doc.entities.size);
    const radii = [...back.entities.values()]
      .filter((e) => e.geom.kind === 'circle')
      .map((e) => (e.geom.kind === 'circle' ? e.geom.radius : 0));
    expect(radii.sort()).toEqual([4, 4, 4, 4]);
    expect(back.settings.units).toBe('mm');
  });
});

describe('DXF import of a minimal file', () => {
  it('reads LINE, CIRCLE and a skipped unknown object', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$INSUNITS',
      '70',
      '4',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '11',
      '50',
      '21',
      '0',
      '0',
      'CIRCLE',
      '8',
      '0',
      '10',
      '5',
      '20',
      '5',
      '40',
      '2',
      '0',
      'SPLINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(1);
    expect(doc.entities.size).toBe(2);
  });

  it('maps inches from $INSUNITS', () => {
    const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
    expect(importDxf(dxf).doc.settings.units).toBe('in');
  });

  it('reads TEXT and MTEXT as notes', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'TEXT',
      '8',
      '0',
      '10',
      '12',
      '20',
      '8',
      '40',
      '3.5',
      '1',
      'Hole',
      '0',
      'MTEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '40',
      '2.5',
      '1',
      'Plate{\\P}note',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expect(doc.entities.size).toBe(0);
    expect(doc.notes.size).toBe(2);
    const notes = [...doc.notes.values()].map((n) => n.body);
    const texts = notes.filter((b) => b.kind === 'text');
    expect(texts).toHaveLength(2);
    const hole = texts.find((b) => b.kind === 'text' && b.text === 'Hole');
    expect(hole?.kind).toBe('text');
    if (hole?.kind !== 'text') return;
    expectPoint(hole.at, { x: 12, y: 8 });
    expectClose(hole.height, 3.5);
    const plate = texts.find((b) => b.kind === 'text' && b.text.includes('Plate'));
    expect(plate?.kind).toBe('text');
    if (plate?.kind !== 'text') return;
    expect(plate.text).toBe('Plate\nnote');
  });

  it('decodes DXF %% codes in TEXT and MTEXT', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'TEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '40',
      '5',
      '1',
      '%%uGREAT ROOM',
      '0',
      'TEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '10',
      '40',
      '5',
      '1',
      '%%c10%%d',
      '0',
      'MTEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '20',
      '40',
      '5',
      '1',
      '{\\fArial;%%p0.1%%%}',
      '0',
      'TEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '30',
      '40',
      '5',
      '1',
      '%%065%%z%%',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const texts = [...importDxf(dxf).doc.notes.values()]
      .map((n) => n.body)
      .filter((b) => b.kind === 'text')
      .map((b) => (b.kind === 'text' ? b.text : ''));
    expect(texts).toEqual(['GREAT ROOM', 'Ø10°', '±0.1%', 'A%%z%%']);
  });

  it('turns MTEXT \\U+XXXX escapes into characters without eating the text after them', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'MTEXT', '8', '0', '10', '0', '20', '0', '40', '5',
      '1', 'R10 \\U+00B10.5; DIA \\U+2205 12 \\U+0007 ok',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const texts = [...importDxf(dxf).doc.notes.values()]
      .map((n) => n.body)
      .filter((b) => b.kind === 'text')
      .map((b) => (b.kind === 'text' ? b.text : ''));
    expect(texts).toEqual(['R10 ±0.5; DIA ∅ 12  ok']);
  });

  it('strips MTEXT alignment, font and paragraph commands', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'MTEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '40',
      '5',
      '1',
      '\\A1;PROVIDE 20 MIN. DOOR\\PW/ SELF CLOSING HINGES',
      '0',
      'MTEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '10',
      '40',
      '5',
      '1',
      '\\Farchquik.shx|c0;SHEAR PANELS, 3/8" OSB',
      '0',
      'MTEXT',
      '8',
      '0',
      '10',
      '0',
      '20',
      '20',
      '40',
      '5',
      '1',
      'half \\S1#2; inch',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const texts = [...importDxf(dxf).doc.notes.values()]
      .map((n) => n.body)
      .filter((b) => b.kind === 'text')
      .map((b) => (b.kind === 'text' ? b.text : ''));
    expect(texts).toEqual([
      'PROVIDE 20 MIN. DOOR\nW/ SELF CLOSING HINGES',
      'SHEAR PANELS, 3/8" OSB',
      'half 1/2 inch',
    ]);
  });

  it('explodes INSERT into the block’s geometry at the insert point', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'BAR',
      '10',
      '0',
      '20',
      '0',
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '11',
      '10',
      '21',
      '0',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'BAR',
      '10',
      '5',
      '20',
      '7',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expect(doc.entities.size).toBe(1);
    const g = [...doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('segment');
    if (g?.kind !== 'segment') return;
    expectPoint(g.start, { x: 5, y: 7 });
    expectPoint(g.end, { x: 15, y: 7 });
  });

  it('rotates an exploded INSERT and skips a missing block', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'BAR',
      '10',
      '0',
      '20',
      '0',
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '11',
      '10',
      '21',
      '0',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'BAR',
      '10',
      '0',
      '20',
      '0',
      '50',
      '90',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'NOPE',
      '10',
      '1',
      '20',
      '1',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(1);
    expect(doc.entities.size).toBe(1);
    const g = [...doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('segment');
    if (g?.kind !== 'segment') return;
    expectPoint(g.start, { x: 0, y: 0 });
    expectPoint(g.end, { x: 0, y: 10 });
  });

  it('explodes a nested INSERT', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'INNER',
      '10',
      '0',
      '20',
      '0',
      '0',
      'CIRCLE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '40',
      '2',
      '0',
      'ENDBLK',
      '0',
      'BLOCK',
      '2',
      'OUTER',
      '10',
      '0',
      '20',
      '0',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'INNER',
      '10',
      '3',
      '20',
      '4',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'OUTER',
      '10',
      '10',
      '20',
      '20',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expect(doc.entities.size).toBe(1);
    const g = [...doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('circle');
    if (g?.kind !== 'circle') return;
    expectPoint(g.center, { x: 13, y: 24 });
    expectClose(g.radius, 2);
  });

  it('gives layer-0 block members the INSERT’s layer and keeps named layers', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'TABLES',
      '0',
      'TABLE',
      '2',
      'LAYER',
      '0',
      'LAYER',
      '2',
      'FIXTURES',
      '70',
      '0',
      '0',
      'LAYER',
      '2',
      'DOORS',
      '70',
      '0',
      '0',
      'ENDTAB',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'SINK',
      '10',
      '0',
      '20',
      '0',
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '11',
      '1',
      '21',
      '0',
      '0',
      'LINE',
      '8',
      'DOORS',
      '10',
      '0',
      '20',
      '1',
      '11',
      '1',
      '21',
      '1',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '8',
      'FIXTURES',
      '2',
      'SINK',
      '10',
      '0',
      '20',
      '0',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expect(doc.entities.size).toBe(2);
    const names = [...doc.entities.values()].map((e) => doc.layers.find((l) => l.id === e.layer)?.name);
    expect(names.sort()).toEqual(['DOORS', 'FIXTURES']);
  });

  it('skips a non-uniform INSERT scale', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'BAR',
      '10',
      '0',
      '20',
      '0',
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      '0',
      '11',
      '10',
      '21',
      '0',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '8',
      '0',
      '2',
      'BAR',
      '10',
      '0',
      '20',
      '0',
      '41',
      '1',
      '42',
      '2',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\n');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(1);
    expect(doc.entities.size).toBe(0);
  });
});

describe('DXF import of DIMENSION', () => {
  const FIXTURE = readFileSync('tests/fixtures/linear-100.dxf', 'utf8');

  function entities(...items: (string | number)[]): string {
    return pairs(0, 'SECTION', 2, 'ENTITIES', ...items, 0, 'ENDSEC', 0, 'EOF');
  }

  function measured(doc: ReturnType<typeof importDxf>['doc']): number | undefined {
    const note = [...doc.notes.values()].find((n) => n.body.kind !== 'text');
    if (!note) return undefined;
    const r = resolveNotes(doc).get(note.id);
    return r?.ok ? r.r.value : undefined;
  }

  it('binds a 100 mm linear dimension from the committed fixture, and does not copy the number', () => {
    const { doc, skipped } = importDxf(FIXTURE);
    expect(skipped).toBe(0);
    expect(doc.entities.size).toBe(1);
    expect(doc.notes.size).toBe(1);
    const note = [...doc.notes.values()][0]!;
    expect(note.body.kind).toBe('linear');
    if (note.body.kind !== 'linear') return;
    expect(note.body.orient).toBe('horizontal');
    expect(measured(doc)).toBe(100);
    const saved = JSON.parse(saveDocument(doc)) as { notes: { body: Record<string, unknown> }[] };
    expect(saved.notes[0]?.body).not.toHaveProperty('value');
    expect(saved.notes[0]?.body).not.toHaveProperty('text');
    expect(saveDocument(doc)).not.toMatch(/"42"/);

    const line = [...doc.entities.values()][0]!;
    const moved = execute(createSession(doc), 'entity.transform', {
      ids: [line.id],
      transform: { kind: 'scale', center: { x: 0, y: 0 }, factor: 1.4 },
    }).session.doc;
    expectClose(measured(moved) ?? NaN, 140);
  });

  it('skips a dimension whose text is OVER', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0,
      0, 'DIMENSION', 8, '0', 10, 50, 20, 10, 13, 0, 23, 0, 14, 100, 24, 0, 70, 32, 50, 0, 1, 'OVER',
    );
    const { doc, skipped } = importDxf(dxf);
    expect(doc.entities.size).toBe(1);
    expect(doc.notes.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('skips a dimension whose defpoints are not on geometry', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0,
      0, 'DIMENSION', 8, '0', 10, 50, 20, 10, 13, 3, 23, 7, 14, 9, 24, 2, 70, 32, 50, 0,
    );
    const { doc, skipped } = importDxf(dxf);
    expect(doc.entities.size).toBe(1);
    expect(doc.notes.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('skips an ordinate dimension', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0,
      0, 'DIMENSION', 8, '0', 10, 0, 20, 10, 13, 0, 23, 0, 14, 0, 24, 0, 70, 6,
    );
    const { doc, skipped } = importDxf(dxf);
    expect(doc.notes.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('skips a rotated linear dimension that is not horizontal or vertical', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 10,
      0, 'DIMENSION', 8, '0', 10, 0, 20, 5, 13, 0, 23, 0, 14, 10, 24, 10, 70, 32, 50, 45,
    );
    const { skipped, doc } = importDxf(dxf);
    expect(doc.notes.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('binds an aligned dimension (type 1)', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 30, 21, 40,
      0, 'DIMENSION', 8, '0', 10, 40, 20, 40, 13, 0, 23, 0, 14, 30, 24, 40, 70, 33,
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    const note = [...doc.notes.values()][0]?.body;
    expect(note?.kind).toBe('aligned');
    expectClose(measured(doc) ?? NaN, 50);
  });

  it('binds a vertical linear dimension', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 80,
      0, 'DIMENSION', 8, '0', 10, 10, 20, 40, 13, 0, 23, 0, 14, 0, 24, 80, 70, 32, 50, 90,
    );
    const { doc } = importDxf(dxf);
    const note = [...doc.notes.values()][0]?.body;
    expect(note?.kind).toBe('linear');
    if (note?.kind !== 'linear') return;
    expect(note.orient).toBe('vertical');
    expectClose(measured(doc) ?? NaN, 80);
  });

  it('binds a radius dimension to a circle', () => {
    const dxf = entities(
      0, 'CIRCLE', 8, '0', 10, 0, 20, 0, 40, 10,
      0, 'DIMENSION', 8, '0', 10, 0, 20, 0, 11, 15, 21, 0, 15, 10, 25, 0, 70, 36, 1, '<>',
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    const note = [...doc.notes.values()][0]?.body;
    expect(note?.kind).toBe('radius');
    expectClose(measured(doc) ?? NaN, 10);
  });

  it('binds a diameter dimension to a circle', () => {
    const dxf = entities(
      0, 'CIRCLE', 8, '0', 10, 0, 20, 0, 40, 10,
      0, 'DIMENSION', 8, '0', 10, 10, 20, 0, 11, -15, 21, 0, 15, -10, 25, 0, 70, 35, 1, '<>',
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    const note = [...doc.notes.values()][0]?.body;
    expect(note?.kind).toBe('diameter');
    expectClose(measured(doc) ?? NaN, 20);
  });

  it('binds an angular dimension between two lines', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 0,
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 10,
      0, 'DIMENSION', 8, '0', 10, 0, 20, 10, 13, 0, 23, 0, 14, 10, 24, 0, 15, 0, 25, 0, 16, 5, 26, 5, 70, 34, 1, '<>',
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    const note = [...doc.notes.values()][0]?.body;
    expect(note?.kind).toBe('angle');
    expectClose(measured(doc) ?? NaN, Math.PI / 2);
  });

  it('binds a 3-point angular dimension', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 0,
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 10,
      0, 'DIMENSION', 8, '0', 10, 5, 20, 5, 13, 10, 23, 0, 14, 0, 24, 0, 15, 0, 25, 10, 16, 4, 26, 4, 70, 37,
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expect([...doc.notes.values()][0]?.body.kind).toBe('angle');
    expectClose(measured(doc) ?? NaN, Math.PI / 2);
  });

  it('binds a dimension whose defpoints are only close, using tolFor', () => {
    const dxf = entities(
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0,
      0, 'DIMENSION', 8, '0', 10, 50, 20, 10, 13, 1e-12, 23, 0, 14, 100, 24, 0, 70, 32, 50, 0,
    );
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    expectClose(measured(doc) ?? NaN, 100);
  });

  it('does not explode an anonymous *D block, and skips an INSERT of one', () => {
    const { doc, skipped } = importDxf(FIXTURE);
    expect(doc.entities.size).toBe(1);
    expect(skipped).toBe(0);
    const withInsert =
      pairs(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, '*D9', 10, 0, 20, 0, 0, 'LINE', 8, '0', 10, 0, 20, 20, 11, 10, 21, 20, 0, 'ENDBLK', 0, 'ENDSEC') +
      pairs(0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 0, 0, 'INSERT', 8, '0', 2, '*D9', 10, 0, 20, 0, 0, 'ENDSEC', 0, 'EOF');
    const exploded = importDxf(withInsert);
    expect(exploded.doc.entities.size).toBe(1);
    expect(exploded.skipped).toBe(1);
  });

  it('maps a DIMENSION inside an INSERT with the insert transform', () => {
    const dxf =
      pairs(
        0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'BAR', 10, 0, 20, 0,
        0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 100, 21, 0,
        0, 'DIMENSION', 8, '0', 10, 50, 20, 10, 13, 0, 23, 0, 14, 100, 24, 0, 70, 32, 50, 0,
        0, 'ENDBLK', 0, 'ENDSEC',
      ) + pairs(0, 'SECTION', 2, 'ENTITIES', 0, 'INSERT', 8, '0', 2, 'BAR', 10, 20, 20, 5, 0, 'ENDSEC', 0, 'EOF');
    const { doc, skipped } = importDxf(dxf);
    expect(skipped).toBe(0);
    const g = [...doc.entities.values()][0]?.geom;
    expect(g?.kind).toBe('segment');
    if (g?.kind !== 'segment') return;
    expectPoint(g.start, { x: 20, y: 5 });
    expectPoint(g.end, { x: 120, y: 5 });
    expectClose(measured(doc) ?? NaN, 100);
  });

  it('still skips HATCH', () => {
    const dxf = entities(0, 'HATCH', 8, '0', 10, 0, 20, 0);
    expect(importDxf(dxf).skipped).toBe(1);
  });
});

describe('shipped drawings export', () => {
  it('the shipped bracket file exports without throwing', () => {
    const doc = loadDocument(readFileSync('public/examples/bracket.archilite', 'utf8'));
    const dxf = exportDxf(doc);
    expect(dxf).toContain('CIRCLE');
    expect(dxf).toContain('LWPOLYLINE');
    expect(importDxf(dxf).doc.entities.size).toBe(doc.entities.size);
  });
});

function pairs(...items: (string | number)[]): string {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 2) out.push(`${items[i]}\n${items[i + 1]}`);
  return `${out.join('\n')}\n`;
}

/** `levels` blocks B0..B(levels-1); each holds `fanout` inserts of the next; the last holds one line. */
function nestedBlocksDxf(levels: number, fanout: number, leafLine: boolean): string {
  let s = pairs(0, 'SECTION', 2, 'BLOCKS');
  for (let l = 0; l < levels; l++) {
    s += pairs(0, 'BLOCK', 2, `B${l}`, 10, 0, 20, 0);
    if (l === levels - 1) {
      if (leafLine) s += pairs(0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0);
    } else {
      for (let i = 0; i < fanout; i++) s += pairs(0, 'INSERT', 8, '0', 2, `B${l + 1}`, 10, i, 20, 0);
    }
    s += pairs(0, 'ENDBLK');
  }
  s += pairs(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', 0, 'INSERT', 8, '0', 2, 'B0', 10, 0, 20, 0, 0, 'ENDSEC', 0, 'EOF');
  return s;
}

describe('DXF block explosion limits', () => {
  it('opens nested blocks that expand to a sensible number of objects', () => {
    const { doc, skipped } = importDxf(nestedBlocksDxf(4, 10, true));
    expect(doc.entities.size).toBe(1000);
    expect(skipped).toBe(0);
  });

  it('refuses nested blocks that would expand past the object cap', () => {
    // 10^6 lines from a file of a few kilobytes: stops as soon as the cap is passed.
    const text = nestedBlocksDxf(7, 10, true);
    expect(text.length).toBeLessThan(10_000);
    expect(() => importDxf(text)).toThrow(IoError);
    expect(() => importDxf(text)).toThrow(/more than 200,000 objects/);
    expect(MAX_EXPLODED_OBJECTS).toBe(200_000);
  });

  it('refuses nested inserts of empty blocks that would be endless work', () => {
    expect(() => importDxf(nestedBlocksDxf(7, 10, false))).toThrow(/more than 200,000/);
  });

  it('skips and counts a rows-and-columns INSERT array instead of importing one copy', () => {
    const dxf =
      pairs(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'BAR', 10, 0, 20, 0, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 0, 0, 'ENDBLK', 0, 'ENDSEC') +
      pairs(0, 'SECTION', 2, 'ENTITIES', 0, 'INSERT', 8, '0', 2, 'BAR', 10, 0, 20, 0, 70, 3, 71, 1, 44, 20, 0, 'ENDSEC', 0, 'EOF');
    const { doc, skipped } = importDxf(dxf);
    expect(doc.entities.size).toBe(0);
    expect(skipped).toBe(1);
  });
});
