import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, saveDocument } from '../../../../src/core/doc';
import { polylineArea, type Circle, type Polyline } from '../../../../src/core/geom';
import { summarize } from '../../../../src/inspect/summary';
import { expectClose } from '../helpers';
import { BRACKET, buildExampleBracket } from './example-bracket';

const FILE = resolve('public/examples/bracket.archilite');

describe('example bracket drawing', () => {
  const doc = buildExampleBracket();

  it('the shipped file matches what the commands build (UPDATE_EXAMPLES=1 rewrites it)', () => {
    const text = saveDocument(doc);
    if (process.env['UPDATE_EXAMPLES'] === '1') writeFileSync(FILE, text);
    expect(readFileSync(FILE, 'utf8')).toBe(text);
  });

  it('loads back to the same document', () => {
    expect(loadDocument(readFileSync(FILE, 'utf8'))).toEqual(doc);
  });

  it('has the hand-calculated sizes', () => {
    const entities = [...doc.entities.values()];
    const outline = entities.find((e) => e.geom.kind === 'polyline' && e.geom.vertices.length === 8)?.geom as Polyline;
    // 100 × 60 rectangle minus four corner pieces of (1 − π/4) × 5².
    expectClose(polylineArea(outline), 6000 - (4 - Math.PI) * 25);
    const holes = entities.filter((e) => e.geom.kind === 'circle').map((e) => e.geom as Circle);
    expect(holes.map((c) => 2 * c.radius)).toEqual([8, 8, 8, 8]);
    const slot = entities.find((e) => e.geom.kind === 'polyline' && e.geom.vertices.length === 4)?.geom as Polyline;
    // 20 × 10 rectangle plus two half circles of radius 5.
    expectClose(polylineArea(slot), 200 + 25 * Math.PI);
  });

  it('summary: layers, counts and overall size', () => {
    const s = summarize(doc);
    expect(s.layers.map((l) => [l.name, l.entities])).toEqual([
      ['Outline', 1],
      ['Holes', 5],
      ['Centre lines', 10],
    ]);
    expect(s.entityCount).toBe(16);
    expect(s.kinds).toEqual({ 'Closed polyline': 2, Circle: 4, Line: 10 });
    expectClose((s.extents?.maxX ?? 0) - (s.extents?.minX ?? 0), BRACKET.width);
    expectClose((s.extents?.maxY ?? 0) - (s.extents?.minY ?? 0), BRACKET.height);
  });
});
