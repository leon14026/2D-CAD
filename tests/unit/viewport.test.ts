import { describe, expect, it } from 'vitest';
import { screenToWorld, worldToScreen, type Viewport } from '../../src/render/viewport';
import { formatCoordinate } from '../../src/ui/format';

const vp: Viewport = { originX: 400, originY: 300, pxPerUnit: 4 };

describe('viewport mapping', () => {
  it('maps the origin to the origin', () => {
    expect(screenToWorld(vp, { x: 400, y: 300 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(vp, { x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it('uses y-up world coordinates', () => {
    expect(screenToWorld(vp, { x: 440, y: 280 })).toEqual({ x: 10, y: 5 });
    expect(worldToScreen(vp, { x: -2.5, y: -1 })).toEqual({ x: 390, y: 304 });
  });

  it('round-trips random points to within 1e-9 of the drawing extent', () => {
    for (let i = 0; i < 10_000; i++) {
      const v: Viewport = {
        originX: Math.random() * 4000 - 2000,
        originY: Math.random() * 4000 - 2000,
        pxPerUnit: 10 ** (Math.random() * 6 - 3),
      };
      const p = { x: Math.random() * 2e4 - 1e4, y: Math.random() * 2e4 - 1e4 };
      const back = screenToWorld(v, worldToScreen(v, p));
      const tol = 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(p.y));
      expect(Math.abs(back.x - p.x)).toBeLessThanOrEqual(tol);
      expect(Math.abs(back.y - p.y)).toBeLessThanOrEqual(tol);
    }
  });
});

describe('formatCoordinate', () => {
  it.each([
    [0, '0.000'],
    [-0, '0.000'],
    [-0.0004, '0.000'],
    [12.3456, '12.346'],
    [-5, '-5.000'],
    [1e6, '1000000.000'],
  ])('%s → %s', (value, text) => {
    expect(formatCoordinate(value)).toBe(text);
  });

  it('respects the requested precision', () => {
    expect(formatCoordinate(Math.PI, 5)).toBe('3.14159');
    expect(formatCoordinate(-0.00001, 4)).toBe('0.0000');
  });
});
