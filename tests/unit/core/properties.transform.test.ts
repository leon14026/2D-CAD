import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  inverse,
  polylineArea,
  rotate,
  shapeLength,
  shapeMagnitude,
  TAU,
  transformShape,
} from '../../../src/core/geom';
import {
  angle,
  closedPolylineArb,
  mirrorArb,
  point,
  PROPERTY_PARAMS,
  PROPERTY_TIMEOUT,
  sameGeometry,
  shapeArb,
  tolAfter,
  transformArb,
} from './arbitraries';

describe('transform properties (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  it('rotating a full turn changes nothing', () => {
    fc.assert(
      fc.property(shapeArb, point, (s, c) => sameGeometry(s, transformShape(rotate(c, TAU), s), tolAfter(s))),
      PROPERTY_PARAMS,
    );
  });

  it('rotate θ then −θ changes nothing', () => {
    fc.assert(
      fc.property(shapeArb, point, angle, (s, c, a) =>
        sameGeometry(s, transformShape(rotate(c, -a), transformShape(rotate(c, a), s)), tolAfter(s)),
      ),
      PROPERTY_PARAMS,
    );
  });

  it('mirroring twice changes nothing', () => {
    fc.assert(
      fc.property(shapeArb, mirrorArb, (s, m) => sameGeometry(s, transformShape(m, transformShape(m, s)), tolAfter(s))),
      PROPERTY_PARAMS,
    );
  });

  it('every transform followed by its inverse changes nothing', () => {
    fc.assert(
      fc.property(shapeArb, transformArb, (s, t) => {
        const back = transformShape(inverse(t), transformShape(t, s));
        const k = t.kind === 'scale' ? Math.max(t.factor, 1 / t.factor) : 1;
        return sameGeometry(s, back, tolAfter(s) * k);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('rigid transforms keep length; scaling by k multiplies it by k', () => {
    fc.assert(
      fc.property(shapeArb, transformArb, (s, t) => {
        const k = t.kind === 'scale' ? t.factor : 1;
        const before = shapeLength(s);
        const after = shapeLength(transformShape(t, s));
        return Math.abs(after - k * before) <= 1e-9 * Math.max(1, k * before);
      }),
      PROPERTY_PARAMS,
    );
  });

  it('closed polyline area: rigid keeps it, mirror negates it, scale k multiplies it by k²', () => {
    fc.assert(
      fc.property(closedPolylineArb, transformArb, (p, t) => {
        const k = t.kind === 'scale' ? t.factor : 1;
        const sign = t.kind === 'mirror' ? -1 : 1;
        const before = polylineArea(p);
        const after = polylineArea(transformShape(t, p));
        // Shoelace terms are products of coordinates, so their rounding scales with size².
        const size = k * Math.max(1, shapeMagnitude(p), 4e4);
        return Math.abs(after - sign * k * k * before) <= 1e-12 * size * size;
      }),
      PROPERTY_PARAMS,
    );
  });
});
