/**
 * The drawing area: a main canvas (paper, grid, entities) and an overlay canvas on top
 * (rulers, hover highlight, selection box). Interaction feedback redraws only the overlay;
 * the main canvas is redrawn when the drawing, the view or the selection changes.
 */
import type { Shape, Vec2 } from '../core/geom';
import { DocIndex, SNAP_LABELS, type SnapHit } from '../core/spatial';
import type { AppState, Store } from '../app/store';
import { palette } from '../ui/palette';
import { paintSheet, type Surface } from './grid-painter';
import { drawRulers } from './rulers';
import { drawScene, traceShape, type SceneStats } from './scene';
import type { Point, Viewport } from './viewport';

export interface BoxFeedback {
  readonly from: Point;
  readonly to: Point;
  readonly mode: 'window' | 'crossing';
}

/** What a tool shows while the cursor moves: the shape to be made, snaps and tracking. */
export interface DraftFeedback {
  readonly preview: readonly Shape[];
  /** The last point, where a tracking line starts. */
  readonly base: Vec2 | null;
  readonly snap: SnapHit | null;
  /** Tracking direction in radians, or null. */
  readonly angle: number | null;
}

export class CanvasView {
  width = 0;
  height = 0;
  dpr = 1;
  lastStats: SceneStats | null = null;
  private box: BoxFeedback | null = null;
  private cursor: Point | null = null;
  private draft: DraftFeedback | null = null;
  private mainDirty = true;
  private overlayDirty = true;
  private frame = 0;
  private readonly main: CanvasRenderingContext2D;
  private readonly over: CanvasRenderingContext2D;

  constructor(
    readonly stage: HTMLElement,
    readonly mainCanvas: HTMLCanvasElement,
    readonly overlayCanvas: HTMLCanvasElement,
    private readonly store: Store,
  ) {
    const main = mainCanvas.getContext('2d', { alpha: false });
    const over = overlayCanvas.getContext('2d');
    if (!main || !over) throw new Error('Canvas 2D is not available in this browser');
    this.main = main;
    this.over = over;
    this.measure();
    store.subscribe((s, p) => {
      if (
        s.session.doc !== p.session.doc ||
        s.viewport !== p.viewport ||
        s.selection !== p.selection ||
        s.showGrid !== p.showGrid ||
        s.lineweights !== p.lineweights
      ) {
        this.invalidate(true);
      } else if (s.hover !== p.hover) {
        this.invalidate(false);
      }
    });
    new ResizeObserver(() => this.onResize()).observe(stage);
  }

  /** Reads the stage size; returns the change in CSS pixels. */
  private measure(): { dw: number; dh: number } {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const change = { dw: width - this.width, dh: height - this.height };
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      for (const c of [this.mainCanvas, this.overlayCanvas]) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
      }
    }
    return change;
  }

  private onResize(): void {
    const { dw, dh } = this.measure();
    // Keep the middle of the view where it was.
    const vp = this.store.get().viewport;
    if (dw !== 0 || dh !== 0) this.store.set({ viewport: { ...vp, originX: vp.originX + dw / 2, originY: vp.originY + dh / 2 } });
    this.invalidate(true);
  }

  invalidate(main: boolean): void {
    if (main) this.mainDirty = true;
    this.overlayDirty = true;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.renderNow());
  }

  setBox(box: BoxFeedback | null): void {
    this.box = box;
    this.invalidate(false);
  }

  setCursor(cursor: Point | null): void {
    this.cursor = cursor;
    this.invalidate(false);
  }

  setDraft(draft: DraftFeedback | null): void {
    if (draft === null && this.draft === null) return;
    this.draft = draft;
    this.invalidate(false);
  }

  /** Draws anything out of date, immediately. */
  renderNow(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const s = this.store.get();
    if (this.mainDirty) {
      this.renderMain(s);
      this.mainDirty = false;
    }
    if (this.overlayDirty) {
      this.renderOverlay(s);
      this.overlayDirty = false;
    }
  }

  private surface(ctx: CanvasRenderingContext2D): Surface {
    return { ctx, width: this.width, height: this.height, dpr: this.dpr };
  }

  private renderMain(s: AppState): void {
    const vp = s.viewport;
    paintSheet(this.surface(this.main), vp, s.showGrid);
    this.lastStats = drawScene(this.surface(this.main), vp, s.session.doc, {
      selection: s.selection,
      lineweights: s.lineweights,
    });
    const data = this.mainCanvas.dataset;
    data['originX'] = String(vp.originX);
    data['originY'] = String(vp.originY);
    data['pxPerUnit'] = String(vp.pxPerUnit);
  }

  private renderOverlay(s: AppState): void {
    const ctx = this.over;
    const { dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    const vp: Viewport = s.viewport;

    if (s.hover !== null && !s.selection.has(s.hover)) {
      const e = s.session.doc.entities.get(s.hover);
      if (e) {
        const k = vp.pxPerUnit * dpr;
        ctx.beginPath();
        traceShape(ctx, e.geom, (x) => vp.originX * dpr + x * k, (y) => vp.originY * dpr - y * k, k);
        ctx.strokeStyle = palette.selection;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 4 * dpr;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (this.box) {
      const { from, to, mode } = this.box;
      const x = Math.min(from.x, to.x) * dpr;
      const y = Math.min(from.y, to.y) * dpr;
      const w = Math.abs(to.x - from.x) * dpr;
      const h = Math.abs(to.y - from.y) * dpr;
      const colour = mode === 'window' ? palette.selection : palette.crossing;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash(mode === 'crossing' ? [6 * dpr, 4 * dpr] : []);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    if (this.draft) this.drawDraft(ctx, vp, this.draft);

    drawRulers(ctx, vp, this.width, this.height, dpr, s.session.doc.settings.units, this.cursor);
  }

  private drawDraft(ctx: CanvasRenderingContext2D, vp: Viewport, d: DraftFeedback): void {
    const { dpr } = this;
    const k = vp.pxPerUnit * dpr;
    const X = (x: number) => vp.originX * dpr + x * k;
    const Y = (y: number) => vp.originY * dpr - y * k;
    ctx.lineCap = 'butt';

    // Tracking line: from the last point, across the whole drawing area.
    if (d.base && d.angle !== null) {
      const far = (this.width + this.height) * 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(X(d.base.x), Y(d.base.y));
      ctx.lineTo(X(d.base.x) + Math.cos(d.angle) * far, Y(d.base.y) - Math.sin(d.angle) * far);
      ctx.strokeStyle = palette.crossing;
      ctx.lineWidth = dpr;
      ctx.setLineDash([2 * dpr, 4 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The object about to be made.
    if (d.preview.length > 0) {
      ctx.beginPath();
      for (const shape of d.preview) traceShape(ctx, shape, X, Y, k);
      ctx.strokeStyle = palette.selection;
      ctx.lineWidth = 1.25 * dpr;
      ctx.stroke();
    }

    // Snap marker and its name.
    if (d.snap) {
      const x = X(d.snap.point.x);
      const y = Y(d.snap.point.y);
      const half = 5 * dpr;
      ctx.strokeStyle = palette.selection;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(Math.round(x - half) + 0.5, Math.round(y - half) + 0.5, half * 2, half * 2);
      const label = SNAP_LABELS[d.snap.kind];
      ctx.font = `${10.5 * dpr}px B612, system-ui, sans-serif`;
      const w = ctx.measureText(label).width + 8 * dpr;
      const h = 16 * dpr;
      const lx = Math.round(x + 9 * dpr);
      const ly = Math.round(y - 9 * dpr - h);
      ctx.fillStyle = palette.paper;
      ctx.fillRect(lx, ly, w, h);
      ctx.strokeStyle = palette.rulerLine;
      ctx.lineWidth = dpr;
      ctx.strokeRect(lx + 0.5, ly + 0.5, w - 1, h - 1);
      ctx.fillStyle = palette.selection;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 4 * dpr, ly + h / 2);
    }
  }

  /** Extents of everything shown, for "zoom to fit". */
  extents() {
    return DocIndex.of(this.store.get().session.doc).visibleExtents();
  }
}
