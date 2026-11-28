import { describe, expect, it } from 'vitest';
import { boxMode, midpoint, pinchViewport, separation, wheelFactor } from '../../../src/app/interaction';
import type { Viewport } from '../../../src/render/viewport';
import { screenToWorld } from '../../../src/render/viewport';

const vp = (): Viewport => ({ originX: 100, originY: 80, pxPerUnit: 4 });

describe('pinchViewport', () => {
  it('zooms about the midpoint and keeps the world point under it', () => {
    const a = { x: 40, y: 80 };
    const b = { x: 160, y: 80 };
    const mid = midpoint(a, b);
    const before = screenToWorld(vp(), mid);
    const next = pinchViewport(vp(), mid, 120, { x: 20, y: 80 }, { x: 180, y: 80 });
    expect(next.pxPerUnit).toBeCloseTo(4 * (160 / 120), 12);
    const after = screenToWorld(next, midpoint({ x: 20, y: 80 }, { x: 180, y: 80 }));
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
  });

  it('pans when the fingers move without changing distance', () => {
    const a0 = { x: 40, y: 80 };
    const b0 = { x: 160, y: 80 };
    const next = pinchViewport(vp(), midpoint(a0, b0), 120, { x: 60, y: 100 }, { x: 180, y: 100 });
    expect(next.pxPerUnit).toBe(4);
    expect(next.originX).toBe(120);
    expect(next.originY).toBe(100);
  });

  it('does not zoom when a distance is zero', () => {
    const p = { x: 50, y: 50 };
    expect(pinchViewport(vp(), p, 0, p, p).pxPerUnit).toBe(4);
  });
});

describe('pointer helpers', () => {
  it('classifies a window vs a crossing box', () => {
    expect(boxMode({ x: 0, y: 0 }, { x: 10, y: 4 })).toBe('window');
    expect(boxMode({ x: 10, y: 0 }, { x: 0, y: 4 })).toBe('crossing');
  });

  it('measures separation', () => {
    expect(separation({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('zooms more for a pinch-style ctrl+wheel', () => {
    const wheel = wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false });
    const pinch = wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: true });
    expect(pinch).toBeGreaterThan(wheel);
  });
});
