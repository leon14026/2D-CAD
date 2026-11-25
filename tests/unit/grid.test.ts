import { describe, expect, it } from 'vitest';
import { chooseGridSpacing, gridIndices, majorEvery, MAX_GRID_LINES } from '../../src/render/grid';

describe('chooseGridSpacing', () => {
  it.each([
    // [pxPerUnit, minPx, expected spacing]
    [4, 8, 2],
    [4, 12, 5],
    [4, 4, 1],
    [4, 21, 10],
    [100, 8, 0.1],
    [100, 15, 0.2],
    [1000, 8, 0.01],
    [0.01, 8, 1000],
    [0.004, 8, 2000],
  ])('pxPerUnit=%s, minPx=%s → %s', (pxPerUnit, minPx, expected) => {
    expect(chooseGridSpacing(pxPerUnit, minPx)).toBe(expected);
  });

  it('always meets the minimum on-screen gap and is the smallest 1-2-5 step that does', () => {
    for (let i = 0; i < 2000; i++) {
      const pxPerUnit = 10 ** (Math.random() * 8 - 4);
      const minPx = 2 + Math.random() * 30;
      const s = chooseGridSpacing(pxPerUnit, minPx);
      expect(s * pxPerUnit).toBeGreaterThanOrEqual(minPx * (1 - 1e-12));
      const mantissa = Math.round(s / 10 ** Math.floor(Math.log10(s)));
      const previous = mantissa === 1 ? s / 2 : mantissa === 2 ? s / 2 : (s * 2) / 5;
      expect(previous * pxPerUnit).toBeLessThan(minPx);
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects pxPerUnit=%s', (bad) => {
    expect(() => chooseGridSpacing(bad, 8)).toThrow(RangeError);
  });

  it('rejects a non-positive minimum gap', () => {
    expect(() => chooseGridSpacing(4, 0)).toThrow(RangeError);
  });
});

describe('majorEvery', () => {
  it.each([
    [1, 10],
    [2, 5],
    [5, 2],
    [0.1, 10],
    [0.2, 5],
    [0.05, 2],
    [500, 2],
    [2000, 5],
  ])('spacing %s → every %s lines', (spacing, every) => {
    expect(majorEvery(spacing)).toBe(every);
  });

  it('puts every major line on a power of ten', () => {
    for (const spacing of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]) {
      const major = spacing * majorEvery(spacing);
      expect(Math.log10(major)).toBeCloseTo(Math.round(Math.log10(major)), 12);
    }
  });

  it('rejects spacings outside the 1-2-5 sequence', () => {
    expect(() => majorEvery(3)).toThrow(RangeError);
  });
});

describe('gridIndices', () => {
  it('includes both ends when they fall exactly on the grid', () => {
    expect(gridIndices(0, 10, 5)).toEqual([0, 1, 2]);
  });

  it('covers negative ranges', () => {
    expect(gridIndices(-10.5, 10.5, 5)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('tolerates floating-point noise at the ends', () => {
    expect(gridIndices(0.30000000000000004, 0.9, 0.1)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('returns nothing when no line falls in range', () => {
    expect(gridIndices(1.1, 1.9, 1)).toEqual([]);
  });

  it('refuses ranges that would need more than the line limit', () => {
    expect(() => gridIndices(0, (MAX_GRID_LINES + 5) * 1, 1)).toThrow(RangeError);
  });

  it.each([
    [0, 10, 0],
    [0, 10, -1],
    [10, 0, 1],
    [Number.NaN, 1, 1],
  ])('rejects invalid input (%s, %s, %s)', (min, max, spacing) => {
    expect(() => gridIndices(min, max, spacing)).toThrow(RangeError);
  });
});
