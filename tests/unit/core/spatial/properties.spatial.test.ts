/**
 * Selection and indexing agree with brute force on random drawings (10,000 cases each).
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { explodePolyline, pointAt, shapeMagnitude, tolFor, type Bounds, type Shape, type Vec2 } from '../../../../src/core/geom';
import {
  boxContains,
  boxesTouch,
  distanceToShape,
  entityBounds,
  isSelectable,
  PackedRTree,
  pickAt,
  selectInBox,
} from '../../../../src/core/spatial';
import { PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';
import { runRandomEdits } from '../doc/random-edits';

const coord = fc.double({ min: -1200, max: 1200, noNaN: true });
const boxArb = fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]) => ({
  minX: Math.min(a, c),
  minY: Math.min(b, d),
  maxX: Math.max(a, c),
  maxY: Math.max(b, d),
}));
const docArb = fc.tuple(fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.integer({ min: 0, max: 60 })).map(([seed, n]) => runRandomEdits(seed, n).session.doc);

function samples(s: Shape): Vec2[] {
  const curves = s.kind === 'polyline' ? explodePolyline(s) : [s];
  return curves.flatMap((c) => Array.from({ length: 101 }, (_, i) => pointAt(c, i / 100)));
}

const strictlyInside = (p: Vec2, b: Bounds, m: number) => p.x > b.minX + m && p.x < b.maxX - m && p.y > b.minY + m && p.y < b.maxY - m;

describe('spatial properties (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  it('R-tree search returns exactly the boxes that touch the query', () => {
    fc.assert(
      fc.property(fc.array(boxArb, { maxLength: 300 }), boxArb, fc.integer({ min: 2, max: 20 }), (boxes, q, nodeSize) => {
        const tree = PackedRTree.build(boxes.map((box, id) => ({ id, box })), nodeSize);
        const got = tree.search(q).sort((a, b) => a - b);
        const want = boxes.flatMap((b, id) => (boxesTouch(b, q) ? [id] : []));
        return got.length === want.length && got.every((v, i) => v === want[i]);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('window selection = selectable entities whose bounds lie inside the box', () => {
    fc.assert(
      fc.property(docArb, boxArb, (doc, b) => {
        const tol = tolFor(b.minX, b.minY, b.maxX, b.maxY);
        const want = [...doc.entities.values()].filter((e) => isSelectable(doc, e) && boxContains(b, entityBounds(e), tol)).map((e) => e.id);
        const got = selectInBox(doc, b, 'window');
        return got.length === want.length && want.every((id) => got.includes(id));
      }),
      PROPERTY_PARAMS,
    );
  });

  it('crossing ⊇ window, ⊆ bounds that touch, and includes every shape with a point well inside', () => {
    fc.assert(
      fc.property(docArb, boxArb, (doc, b) => {
        const crossing = new Set(selectInBox(doc, b, 'crossing'));
        if (!selectInBox(doc, b, 'window').every((id) => crossing.has(id))) return false;
        for (const e of doc.entities.values()) {
          const touchesBounds = boxesTouch(entityBounds(e), {
            minX: b.minX - 1e-6, minY: b.minY - 1e-6, maxX: b.maxX + 1e-6, maxY: b.maxY + 1e-6,
          });
          if (crossing.has(e.id) && (!touchesBounds || !isSelectable(doc, e))) return false;
          const margin = 1e-6 * Math.max(1, shapeMagnitude(e.geom));
          if (isSelectable(doc, e) && !crossing.has(e.id) && samples(e.geom).some((p) => strictlyInside(p, b, margin))) return false;
        }
        return true;
      }),
      PROPERTY_PARAMS,
    );
  });

  it('pick returns the nearest selectable entity within the radius, or none', () => {
    fc.assert(
      fc.property(docArb, coord, coord, fc.double({ min: 0.1, max: 200, noNaN: true }), (doc, x, y, r) => {
        const p = { x, y };
        const got = pickAt(doc, p, r);
        const candidates = [...doc.entities.values()].filter((e) => isSelectable(doc, e)).map((e) => ({ id: e.id, d: distanceToShape(e.geom, p) }));
        const best = Math.min(Infinity, ...candidates.map((c) => c.d));
        if (got === null) return !(best <= r);
        const d = candidates.find((c) => c.id === got)?.d ?? Infinity;
        return d <= r && d <= best + 1e-9 * Math.max(1, best);
      }),
      PROPERTY_PARAMS,
    );
  });
});
