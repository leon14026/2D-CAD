import { describe, expect, it } from 'vitest';
import {
  circle,
  hatchLines,
  isLoop,
  loopArea,
  loopBounds,
  loopCurves,
  loopMagnitude,
  MAX_HATCH_LINES,
  pointInLoop,
  polyline,
  rectangle,
  regionArea,
  segment,
  type Loop,
  type Vec2,
} from '../../../src/core/geom';
import { expectClose } from './helpers';

const P = (x: number, y: number): Vec2 => ({ x, y });
const length = (s: { start: Vec2; end: Vec2 }) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
const total = (segs: readonly { start: Vec2; end: Vec2 }[]) => segs.reduce((sum, s) => sum + length(s), 0);

/** Two semicircular ends on a 10 × 4 body: area 40 + 4π. */
const capsule = polyline(
  [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 1 },
    { x: 10, y: 4, bulge: 0 },
    { x: 0, y: 4, bulge: 1 },
  ],
  true,
);

describe('loops', () => {
  it('only circles and closed polylines are loops', () => {
    expect(isLoop(circle(P(0, 0), 1))).toBe(true);
    expect(isLoop(rectangle(P(0, 0), P(1, 1)))).toBe(true);
    expect(isLoop(polyline([P(0, 0), P(1, 0), P(1, 1)].map((p) => ({ ...p, bulge: 0 })), false))).toBe(false);
    expect(isLoop(segment(P(0, 0), P(1, 0)))).toBe(false);
  });

  it('curves, bounds, magnitude and area', () => {
    const sq = rectangle(P(2, 3), P(12, 8));
    expect(loopCurves(sq)).toHaveLength(4);
    expect(loopCurves(circle(P(0, 0), 1))).toHaveLength(1);
    expect(loopBounds(sq)).toEqual({ minX: 2, minY: 3, maxX: 12, maxY: 8 });
    expectClose(loopBounds(circle(P(1, 1), 2)).maxX, 3);
    expect(loopMagnitude(sq)).toBe(12);
    expect(loopArea(sq)).toBe(50);
    expectClose(loopArea(circle(P(0, 0), 2)), 4 * Math.PI);
    expectClose(loopArea(capsule), 40 + 4 * Math.PI);
    expect(loopArea(rectangle(P(10, 8), P(2, 3)))).toBe(40); // 8 × 5, clockwise or not, never negative
  });

  it('a region is the outer loop less its islands: 100 − 4π', () => {
    expectClose(regionArea(rectangle(P(0, 0), P(10, 10)), [circle(P(5, 5), 2)]), 100 - 4 * Math.PI);
    expect(regionArea(rectangle(P(0, 0), P(10, 10)), [])).toBe(100);
    expectClose(regionArea(rectangle(P(0, 0), P(10, 10)), [rectangle(P(1, 1), P(3, 3)), rectangle(P(5, 5), P(9, 7))]), 100 - 4 - 8);
  });
});

describe('point in loop', () => {
  it('circle', () => {
    const c = circle(P(0, 0), 5);
    expect(pointInLoop(c, P(3, 3))).toBe(true);
    expect(pointInLoop(c, P(4, 4))).toBe(false);
  });

  it('polygon', () => {
    const sq = rectangle(P(0, 0), P(10, 10));
    expect(pointInLoop(sq, P(5, 5))).toBe(true);
    expect(pointInLoop(sq, P(11, 5))).toBe(false);
    expect(pointInLoop(sq, P(5, -1))).toBe(false);
  });

  it('arc edges that bulge out add their segment (capsule)', () => {
    expect(pointInLoop(capsule, P(5, 2))).toBe(true);
    expect(pointInLoop(capsule, P(11, 2))).toBe(true); // inside the right end
    expect(pointInLoop(capsule, P(-1, 2))).toBe(true); // inside the left end
    expect(pointInLoop(capsule, P(13, 2))).toBe(false);
    expect(pointInLoop(capsule, P(11.9, 3.9))).toBe(false); // beyond the arc at the corner
  });

  it('an arc edge that bulges in cuts its segment out', () => {
    const dented = polyline(
      [
        { x: 0, y: 0, bulge: -0.5 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
      true,
    );
    expect(pointInLoop(dented, P(5, 1))).toBe(false); // in the dent: its circle has radius 6.25, apex at y = 2.5
    expect(pointInLoop(dented, P(5, 3))).toBe(true);
    expect(pointInLoop(dented, P(0.5, 1))).toBe(true); // just outside the dent's circle
    expect(pointInLoop(dented, P(1, 1))).toBe(false); // just inside it
  });

  it('an arc of more than half a circle', () => {
    const belly = polyline(
      [
        { x: 0, y: 0, bulge: 2 },
        { x: 10, y: 0, bulge: 0 },
        { x: 5, y: 10, bulge: 0 },
      ],
      true,
    );
    expect(pointInLoop(belly, P(5, -9))).toBe(true);
    expect(pointInLoop(belly, P(5, 5))).toBe(true);
    expect(pointInLoop(belly, P(5, -11))).toBe(false);
  });
});

describe('hatch lines (hand-calculated)', () => {
  const square = rectangle(P(0, 0), P(10, 10));

  it('horizontal lines 2 apart: at y = 0 (nudged in), 2, 4, 6 and 8, each 10 long', () => {
    const { segments, dots } = hatchLines([square], { angle: 0, spacing: 2 });
    expect(segments).toHaveLength(5);
    expect(dots).toHaveLength(0);
    for (const s of segments) expectClose(length(s), 10);
    expect(segments.map((s) => Math.round(s.start.y)).sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8]);
    expectClose(total(segments), 50);
  });

  it('lines sit on whole multiples of the spacing from the origin, so neighbours line up', () => {
    const { segments } = hatchLines([rectangle(P(1, 1), P(11, 11))], { angle: 0, spacing: 2 });
    expect(segments.map((s) => s.start.y)).toEqual([2, 4, 6, 8, 10]);
  });

  it('shift moves the lines by a fraction of the spacing', () => {
    const { segments } = hatchLines([rectangle(P(1, 1), P(11, 11))], { angle: 0, spacing: 2, shift: 0.5 });
    // Offsets (k + 0.5) × 2 = 1, 3, 5, 7, 9. The first is on the square's edge, so it is nudged in.
    expect(segments).toHaveLength(5);
    expectClose(segments[0]!.start.y, 1, 1e-4);
    expect(segments.slice(1).map((s) => s.start.y)).toEqual([3, 5, 7, 9]);
  });

  it('vertical lines (90°)', () => {
    const { segments } = hatchLines([square], { angle: Math.PI / 2, spacing: 5 });
    expect(segments).toHaveLength(2); // x = 0 (nudged in) and 5; x = 10 is nudged out
    for (const s of segments) expectClose(length(s), 10);
  });

  it('45° lines across a square', () => {
    const { segments } = hatchLines([square], { angle: Math.PI / 4, spacing: Math.SQRT2 });
    // The longest line is the diagonal, 10√2, on the line through the origin.
    expectClose(Math.max(...segments.map(length)), 10 * Math.SQRT2, 1e-3);
    // The area covered by lines of this spacing is the square: sum of lengths × spacing ≈ 100.
    expectClose(total(segments) * Math.SQRT2, 100, 0.05);
  });

  it('an island cuts a gap: y = 5 across 10 square with a Ø4 hole leaves 3 + 3', () => {
    const { segments } = hatchLines([square, circle(P(5, 5), 2)], { angle: 0, spacing: 1 });
    const row = segments.filter((s) => Math.abs(s.start.y - 5) < 1e-6);
    expect(row).toHaveLength(2);
    expect(row.map(length).map((l) => Math.round(l * 1e6) / 1e6)).toEqual([3, 3]);
    // Lines that miss the island are whole.
    expect(segments.filter((s) => Math.abs(s.start.y - 8) < 1e-6).map(length)).toEqual([10]);
  });

  it('a circle: the line through the centre is the diameter, the line at y = 3 is 8 long', () => {
    const { segments } = hatchLines([circle(P(0, 0), 5)], { angle: 0, spacing: 1 });
    const at = (y: number) => segments.find((s) => Math.abs(s.start.y - y) < 1e-6);
    expectClose(length(at(0)!), 10);
    expectClose(length(at(3)!), 8);
    expectClose(length(at(-3)!), 8);
  });

  it('dots go at the spacing along each line: 3, 6 and 9 across a 1–11 square', () => {
    const { dots } = hatchLines([rectangle(P(1, 1), P(11, 11))], { angle: 0, spacing: 2, dotSpacing: 3 });
    expect(dots).toHaveLength(15);
    expect(dots.filter((d) => d.y === 6).map((d) => d.x)).toEqual([3, 6, 9]);
  });

  it('two identical loops cancel out (even-odd), leaving nothing', () => {
    const { segments } = hatchLines([square, square], { angle: 0, spacing: 2 });
    expect(segments).toHaveLength(0);
  });

  it('refuses spacing that is not a positive number, and too many lines', () => {
    for (const spacing of [0, -1, NaN, Infinity]) expect(() => hatchLines([square], { angle: 0, spacing })).toThrow(RangeError);
    expect(() => hatchLines([square], { angle: 0, spacing: 10 / (MAX_HATCH_LINES + 10) })).toThrow('more than 20000 hatch lines');
  });
});
