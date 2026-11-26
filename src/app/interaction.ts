/**
 * Mouse, touchpad and keyboard handling for the drawing area.
 *
 * - Wheel or pinch: zoom about the cursor.
 * - Middle-drag, or Space + drag: pan.
 * - Click: pick the nearest entity (Shift adds or removes it).
 * - Drag left to right: window selection (entirely inside).
 * - Drag right to left: crossing selection (inside or touching).
 *
 * While a tool wants a point, a click places it (after snaps and tracking) and a right-click
 * is Enter. Shift held while moving forces horizontal or vertical.
 */
import { boxFromCorners, pickAt, selectInBox, type BoxMode } from '../core/spatial';
import type { CanvasView } from '../render/view';
import { panBy, screenToWorld, zoomAt, type Point } from '../render/viewport';
import { formatCoordinate } from '../ui/format';
import type { DraftingController } from './drafting';
import type { Store } from './store';

/** How far the pointer must move, in CSS pixels, before a press becomes a box. */
const DRAG_THRESHOLD = 4;
/** Pick radius in CSS pixels. */
export const PICK_RADIUS = 6;

type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; start: Point; shift: boolean; pointer: number }
  | { kind: 'box'; start: Point; shift: boolean; pointer: number }
  | { kind: 'pan'; last: Point; pointer: number }
  | { kind: 'tool'; pointer: number };

export function wheelFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
  const perUnit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
  const k = e.ctrlKey ? perUnit * 6 : perUnit; // pinch gestures arrive as small ctrl+wheel steps
  return Math.exp(-e.deltaY * k);
}

export function boxMode(start: Point, end: Point): BoxMode {
  return end.x >= start.x ? 'window' : 'crossing';
}

export function attachInteraction(
  store: Store,
  view: CanvasView,
  drafting: DraftingController,
  readout: { x: HTMLElement; y: HTMLElement },
): void {
  const target = view.overlayCanvas;
  let gesture: Gesture = { kind: 'idle' };
  let space = false;
  let hoverFrame = 0;
  let lastPoint: Point | null = null;

  const local = (e: MouseEvent): Point => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** True while the active tool wants a point placed, so clicks don't select. */
  const placing = () => {
    const accepts = drafting.prompt()?.accepts;
    return accepts === 'point' || accepts === 'number' || accepts === 'pointOrNumber';
  };

  const updateHover = () => {
    hoverFrame = 0;
    if (!lastPoint || gesture.kind !== 'idle' || placing()) return;
    const s = store.get();
    const world = screenToWorld(s.viewport, lastPoint);
    const hover = pickAt(s.session.doc, world, PICK_RADIUS / s.viewport.pxPerUnit);
    if (hover !== s.hover) store.set({ hover });
  };

  target.addEventListener('pointerdown', (e) => {
    if (gesture.kind !== 'idle') return;
    const p = local(e);
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      gesture = { kind: 'pan', last: p, pointer: e.pointerId };
      view.stage.classList.add('is-panning');
    } else if (e.button === 0 && placing()) {
      gesture = { kind: 'tool', pointer: e.pointerId };
    } else if (e.button === 0) {
      gesture = { kind: 'press', start: p, shift: e.shiftKey, pointer: e.pointerId };
    } else {
      if (e.button === 2 && drafting.active) drafting.enter();
      return;
    }
    target.setPointerCapture(e.pointerId);
  });

  target.addEventListener('pointermove', (e) => {
    const p = local(e);
    lastPoint = p;
    const s = store.get();
    const world = drafting.move(p, e.shiftKey) ?? screenToWorld(s.viewport, p);
    readout.x.textContent = formatCoordinate(world.x);
    readout.y.textContent = formatCoordinate(world.y);
    view.setCursor(p);

    switch (gesture.kind) {
      case 'pan':
        store.set({ viewport: panBy(s.viewport, p.x - gesture.last.x, p.y - gesture.last.y) });
        gesture = { ...gesture, last: p };
        break;
      case 'press':
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD) {
          gesture = { kind: 'box', start: gesture.start, shift: gesture.shift, pointer: gesture.pointer };
          if (s.hover !== null) store.set({ hover: null });
          view.setBox({ from: gesture.start, to: p, mode: boxMode(gesture.start, p) });
        }
        break;
      case 'box':
        view.setBox({ from: gesture.start, to: p, mode: boxMode(gesture.start, p) });
        break;
      case 'idle':
        if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
        break;
      case 'tool':
        break;
    }
  });

  const finish = (e: PointerEvent) => {
    if (gesture.kind === 'idle' || e.pointerId !== gesture.pointer) return;
    const p = local(e);
    const s = store.get();
    const doc = s.session.doc;
    if (gesture.kind === 'tool') {
      if (e.type === 'pointerup') drafting.click(p);
    } else if (gesture.kind === 'press') {
      const id = pickAt(doc, screenToWorld(s.viewport, p), PICK_RADIUS / s.viewport.pxPerUnit);
      if (gesture.shift) {
        if (id !== null) {
          const next = new Set(s.selection);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          store.set({ selection: next });
        }
      } else {
        store.set({ selection: new Set(id === null ? [] : [id]) });
      }
    } else if (gesture.kind === 'box') {
      const a = screenToWorld(s.viewport, gesture.start);
      const b = screenToWorld(s.viewport, p);
      const ids = selectInBox(doc, boxFromCorners(a, b), boxMode(gesture.start, p));
      store.set({ selection: new Set(gesture.shift ? [...s.selection, ...ids] : ids) });
      view.setBox(null);
    }
    view.stage.classList.remove('is-panning');
    gesture = { kind: 'idle' };
  };
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', (e) => {
    view.setBox(null);
    finish(e);
  });

  target.addEventListener('pointerleave', () => {
    lastPoint = null;
    view.setCursor(null);
    drafting.move(null);
    if (gesture.kind === 'idle' && store.get().hover !== null) store.set({ hover: null });
  });

  target.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      store.set((s) => ({ viewport: zoomAt(s.viewport, p, wheelFactor(e)) }));
    },
    { passive: false },
  );

  // Middle-click auto-scroll would fight panning; the right button is Enter for tools.
  target.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  target.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e)) {
      space = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') space = false;
  });
  window.addEventListener('blur', () => {
    space = false;
  });
}

export function isTyping(e: Event): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}
