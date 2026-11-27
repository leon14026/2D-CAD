/**
 * Hand-calculated geometry for the Phase 10 DWG fixtures: a 100 mm line, a circle,
 * an arc, and a closed polyline with a bulge. The committed .dwg files were made
 * from this drawing by another program (see README.md in this folder).
 */
import { createSession, execute, newDocument, type Doc } from '../../../src/core/doc';
import { arc, circle, polyline, segment, vec } from '../../../src/core/geom';

export const LINE = { start: vec(0, 0), end: vec(100, 0) };
export const CIRCLE = { center: vec(50, 40), radius: 10 };
export const ARC = { center: vec(0, 0), radius: 20, start: 0, sweep: Math.PI / 2 };
export const POLYLINE = polyline(
  [
    { x: 0, y: 0 },
    { x: 30, y: 0, bulge: 1 },
    { x: 30, y: 20 },
    { x: 0, y: 20 },
  ],
  true,
);

/** ArchiLite document that the DWG fixtures must import as. */
export function shapesDoc(): Doc {
  let session = createSession(newDocument({ title: 'dwg-shapes', units: 'mm' }));
  for (const geom of [segment(LINE.start, LINE.end), circle(CIRCLE.center, CIRCLE.radius), arc(ARC.center, ARC.radius, ARC.start, ARC.sweep), POLYLINE]) {
    session = execute(session, 'entity.add', { geom }).session;
  }
  return session.doc;
}
