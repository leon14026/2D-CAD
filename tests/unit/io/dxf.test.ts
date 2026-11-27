import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSession, execute, loadDocument, newDocument } from '../../../src/core/doc';
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
