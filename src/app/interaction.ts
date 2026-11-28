/**
 * Mouse, touchpad, touch and keyboard handling for the drawing area.
 *
 * Desk:
 * - Wheel or pinch: zoom about the cursor.
 * - Middle-drag, or Space + drag: pan.
 * - Click: pick the nearest entity (Shift adds or removes it). A click on a driving
 *   dimension's number opens the box to type a new size.
 * - Drag left to right: window selection (entirely inside).
 * - Drag right to left: crossing selection (inside or touching).
 *
 * Phone (`body.al-phone`):
 * - One finger pans when no tool is in use; a tap picks.
 * - Two fingers pan and pinch-zoom about the midpoint.
 * - A tool that wants a point is placed by a tap; two fingers still pan and zoom.
 * - Box selection is a command, so a drag is not a window by accident.
 *
 * While a tool wants a point, a click places it (after snaps and tracking) and a right-click
 * is Enter. Shift held while moving forces horizontal or vertical.
 */
import { valuedConstraintOf, type Doc } from '../core/doc';
import { boxFromCorners, noteTextContains, pickAt, selectInBox, type BoxMode } from '../core/spatial';
import type { CanvasView } from '../render/view';
import { panBy, screenToWorld, zoomAt, type Point, type Viewport } from '../render/viewport';
import { formatCoordinate } from '../ui/format';
import type { DraftingController } from './drafting';
import { isPhone } from './phone';
import { visibleConstraintMarks, type Store } from './store';

/** How far the pointer must move, in CSS pixels, before a press becomes a box or a pan. */
const DRAG_THRESHOLD = 4;
/** Pick radius in CSS pixels. */
export const PICK_RADIUS = 6;

type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; start: Point; shift: boolean; pointer: number }
  | { kind: 'box'; start: Point; shift: boolean; pointer: number }
  | { kind: 'pan'; last: Point; pointer: number }
  | { kind: 'pinch'; ids: readonly [number, number]; mid: Point; dist: number }
  | { kind: 'tool'; pointer: number };

export function wheelFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
  const perUnit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
  const k = e.ctrlKey ? perUnit * 6 : perUnit; // pinch gestures arrive as small ctrl+wheel steps
  return Math.exp(-e.deltaY * k);
}

export function boxMode(start: Point, end: Point): BoxMode {
  return end.x >= start.x ? 'window' : 'crossing';
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function separation(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Pan by the midpoint's movement, then zoom about the new midpoint by the distance ratio. */
export function pinchViewport(vp: Viewport, lastMid: Point, lastDist: number, a: Point, b: Point): Viewport {
  const mid = midpoint(a, b);
  const dist = separation(a, b);
  const panned = panBy(vp, mid.x - lastMid.x, mid.y - lastMid.y);
  const factor = lastDist > 0 && dist > 0 ? dist / lastDist : 1;
  return zoomAt(panned, mid, factor);
}

/** Opens the cursor box to type a new driving-dimension value. */
function startValueEdit(store: Store, drafting: DraftingController, doc: Doc, id: number): boolean {
  const constraint = valuedConstraintOf(doc, id);
  if (!constraint) return false;
  store.set({ selection: new Set([constraint.id]), showSelection: true });
  drafting.start('editConstraint');
  return true;
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
  const pointers = new Map<number, Point>();

  const local = (e: MouseEvent): Point => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** True while the active tool wants a point placed, so clicks don't select. */
  const placing = () => {
    const accepts = drafting.prompt()?.accepts;
    return accepts === 'point' || accepts === 'number' || accepts === 'pointOrNumber' || accepts === 'text';
  };

  const phonePan = () => isPhone() && !store.get().boxSelect;

  const capture = (id: number) => {
    try {
      target.setPointerCapture(id);
    } catch {
      // Synthetic events in tests have no active pointer.
    }
  };

  const report = (p: Point, shift: boolean) => {
    lastPoint = p;
    const s = store.get();
    const world = drafting.move(p, shift) ?? screenToWorld(s.viewport, p);
    readout.x.textContent = formatCoordinate(world.x);
    readout.y.textContent = formatCoordinate(world.y);
    view.setCursor(p);
  };

  const updateHover = () => {
    hoverFrame = 0;
    if (!lastPoint || gesture.kind !== 'idle' || placing() || isPhone()) return;
    const s = store.get();
    const world = screenToWorld(s.viewport, lastPoint);
    const hover = pickAt(s.session.doc, world, PICK_RADIUS / s.viewport.pxPerUnit, visibleConstraintMarks(s));
    if (hover !== s.hover) store.set({ hover });
  };

  const beginPinch = () => {
    const ids = [...pointers.keys()];
    if (ids.length < 2) return;
    const idA = ids[0] as number;
    const idB = ids[1] as number;
    const a = pointers.get(idA);
    const b = pointers.get(idB);
    if (!a || !b) return;
    if (gesture.kind === 'box') view.setBox(null);
    gesture = { kind: 'pinch', ids: [idA, idB], mid: midpoint(a, b), dist: separation(a, b) };
    view.stage.classList.add('is-panning');
  };

  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') e.preventDefault();
    const p = local(e);
    pointers.set(e.pointerId, p);
    capture(e.pointerId);

    if (pointers.size >= 2) {
      beginPinch();
      return;
    }

    if (gesture.kind !== 'idle') return;
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      gesture = { kind: 'pan', last: p, pointer: e.pointerId };
      view.stage.classList.add('is-panning');
    } else if (e.button === 0 && (placing() || drafting.prompt()?.accepts === 'pick')) {
      // A number-only prompt is typed, not clicked. Ignore the click so double-clicking
      // a dimension's number (which starts the editor on the first click) does not refuse.
      if (drafting.prompt()?.accepts === 'number') return;
      gesture = { kind: 'tool', pointer: e.pointerId };
    } else if (e.button === 0) {
      gesture = { kind: 'press', start: p, shift: e.shiftKey, pointer: e.pointerId };
    } else {
      if (e.button === 2 && drafting.active) drafting.enter();
      pointers.delete(e.pointerId);
      return;
    }
  });

  target.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    report(p, e.shiftKey);

    switch (gesture.kind) {
      case 'pan': {
        if (e.pointerId !== gesture.pointer) break;
        const last = gesture.last;
        store.set((s) => ({ viewport: panBy(s.viewport, p.x - last.x, p.y - last.y) }));
        gesture = { ...gesture, last: p };
        break;
      }
      case 'pinch': {
        const a = pointers.get(gesture.ids[0]);
        const b = pointers.get(gesture.ids[1]);
        if (!a || !b) break;
        const lastMid = gesture.mid;
        const lastDist = gesture.dist;
        store.set((s) => ({ viewport: pinchViewport(s.viewport, lastMid, lastDist, a, b) }));
        gesture = { ...gesture, mid: midpoint(a, b), dist: separation(a, b) };
        break;
      }
      case 'press':
        if (e.pointerId !== gesture.pointer) break;
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_THRESHOLD) {
          if (phonePan()) {
            const start = gesture.start;
            gesture = { kind: 'pan', last: p, pointer: gesture.pointer };
            view.stage.classList.add('is-panning');
            store.set((s) => ({ viewport: panBy(s.viewport, p.x - start.x, p.y - start.y) }));
          } else {
            gesture = { kind: 'box', start: gesture.start, shift: gesture.shift, pointer: gesture.pointer };
            if (store.get().hover !== null) store.set({ hover: null });
            view.setBox({ from: gesture.start, to: p, mode: boxMode(gesture.start, p) });
          }
        }
        break;
      case 'box':
        if (e.pointerId === gesture.pointer) view.setBox({ from: gesture.start, to: p, mode: boxMode(gesture.start, p) });
        break;
      case 'idle':
        if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
        break;
      case 'tool':
        break;
    }
  });

  const finish = (e: PointerEvent) => {
    const p = local(e);
    pointers.delete(e.pointerId);
    const s = store.get();
    const doc = s.session.doc;

    if (gesture.kind === 'pinch') {
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      if (pointers.size === 1) {
        const [id, last] = [...pointers.entries()][0] as [number, Point];
        gesture = { kind: 'pan', last, pointer: id };
        return;
      }
      view.stage.classList.remove('is-panning');
      gesture = { kind: 'idle' };
      return;
    }

    if (gesture.kind === 'idle' || e.pointerId !== gesture.pointer) return;

    if (gesture.kind === 'tool') {
      if (e.type === 'pointerup') {
        if (drafting.prompt()?.accepts === 'pick') drafting.pick(p);
        else drafting.click(p);
      }
    } else if (gesture.kind === 'press') {
      const world = screenToWorld(s.viewport, p);
      const id = pickAt(doc, world, PICK_RADIUS / s.viewport.pxPerUnit, visibleConstraintMarks(s));
      if (gesture.shift) {
        if (id !== null) {
          const next = new Set(s.selection);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          store.set({ selection: next });
        }
      } else {
        store.set({ selection: new Set(id === null ? [] : [id]) });
        if (id !== null && noteTextContains(doc, id, world)) startValueEdit(store, drafting, doc, id);
      }
    } else if (gesture.kind === 'box') {
      const a = screenToWorld(s.viewport, gesture.start);
      const b = screenToWorld(s.viewport, p);
      const ids = selectInBox(doc, boxFromCorners(a, b), boxMode(gesture.start, p), visibleConstraintMarks(s));
      store.set({
        selection: new Set(gesture.shift ? [...s.selection, ...ids] : ids),
        boxSelect: false,
      });
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
    if (gesture.kind !== 'idle') return;
    lastPoint = null;
    view.setCursor(null);
    drafting.move(null);
    if (store.get().hover !== null) store.set({ hover: null });
  });

  target.addEventListener('dblclick', (e) => {
    if (placing() || drafting.prompt()?.accepts === 'pick') return;
    e.preventDefault();
    const p = local(e);
    const s = store.get();
    const id = pickAt(s.session.doc, screenToWorld(s.viewport, p), PICK_RADIUS / s.viewport.pxPerUnit, visibleConstraintMarks(s));
    if (id !== null) startValueEdit(store, drafting, s.session.doc, id);
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
