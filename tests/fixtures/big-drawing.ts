/**
 * A realistic large drawing for performance tests: the example bracket tiled in a grid
 * (50 × 25 = 1,250 brackets × 16 entities = 20,000 entities), layer by layer like real work.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDocument, saveDocument, type Doc, type Entity } from '../../src/core/doc';
import { transformShape, translate } from '../../src/core/geom';

export function bigDrawing(cols = 50, rows = 25, pitchX = 120, pitchY = 80): Doc {
  const bracket = loadDocument(readFileSync(resolve('public/examples/bracket.archilite'), 'utf8'));
  const parts = [...bracket.entities.values()];
  const entities = new Map<number, Entity>();
  let id = bracket.nextId;
  for (const part of parts) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const geom = transformShape(translate(c * pitchX, r * pitchY), part.geom);
        entities.set(id, { ...part, id, z: id, geom });
        id += 1;
      }
    }
  }
  return { ...bracket, settings: { ...bracket.settings, title: `Bracket grid ${cols} × ${rows}` }, nextId: id, entities };
}

export function bigDrawingText(cols?: number, rows?: number): string {
  return saveDocument(bigDrawing(cols, rows));
}
