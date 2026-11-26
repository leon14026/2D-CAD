/**
 * A small hook for the browser tests, installed only when the page URL contains "?test".
 * It lets tests load large drawings directly and time frames precisely. Nothing here is
 * used by the app itself.
 */
import { saveDocument } from '../core/doc';
import { selectInBox, type BoxMode } from '../core/spatial';
import type { SceneStats } from '../render/scene';
import type { CanvasView } from '../render/view';
import { panBy, screenToWorld, zoomAt, type Viewport } from '../render/viewport';
import type { Actions } from './actions';
import type { Store } from './store';

export interface TestHook {
  openText(text: string): boolean;
  state(): { entities: number; selection: number[]; viewport: Viewport; hover: number | null; undo: number; tool: string | null };
  /** The drawing as .archilite text, for checking geometry exactly. */
  saveText(): string;
  /** Selects with a box given in screen pixels, as a drag would. */
  selectBox(x0: number, y0: number, x1: number, y1: number, mode: BoxMode): number[];
  /**
   * Fits the drawing, then renders `frames` frames, panning or zooming between each (out and
   * back, so the view ends where it started); returns milliseconds per frame.
   */
  timeFrames(frames: number, kind: 'pan' | 'zoom'): number[];
  lastDrawn(): number;
  /** The last frame's scene statistics: entities drawn, strokes, and milliseconds spent in JavaScript. */
  sceneStats(): SceneStats | null;
}

export function installTestHook(store: Store, view: CanvasView, actions: Actions): void {
  if (!new URLSearchParams(location.search).has('test')) return;
  const hook: TestHook = {
    openText: (text) => {
      const ok = actions.openText(text, 'test.archilite');
      view.renderNow();
      return ok;
    },
    state: () => {
      const s = store.get();
      return {
        entities: s.session.doc.entities.size,
        selection: [...s.selection].sort((a, b) => a - b),
        viewport: s.viewport,
        hover: s.hover,
        undo: s.session.undoStack.length,
        tool: s.tool?.id ?? null,
      };
    },
    saveText: () => saveDocument(store.get().session.doc),
    selectBox: (x0, y0, x1, y1, mode) => {
      const vp = store.get().viewport;
      const a = screenToWorld(vp, { x: x0, y: y0 });
      const b = screenToWorld(vp, { x: x1, y: y1 });
      return selectInBox(store.get().session.doc, { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }, mode);
    },
    timeFrames: (frames, kind) => {
      const times: number[] = [];
      const ctx = view.mainCanvas.getContext('2d') as CanvasRenderingContext2D;
      const centre = { x: view.width / 2, y: view.height / 2 };
      actions.fit();
      view.renderNow();
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        const out = i < frames / 2 ? 1 : -1;
        store.set((s) => ({
          viewport: kind === 'pan' ? panBy(s.viewport, 4 * out, 2 * out) : zoomAt(s.viewport, centre, out > 0 ? 1.04 : 1 / 1.04),
        }));
        view.renderNow();
        ctx.getImageData(0, 0, 1, 1); // wait for the pixels, not just the drawing calls
        times.push(performance.now() - t0);
      }
      return times;
    },
    lastDrawn: () => view.lastStats?.drawn ?? 0,
    sceneStats: () => view.lastStats,
  };
  (window as unknown as { __archilite: TestHook }).__archilite = hook;
}
