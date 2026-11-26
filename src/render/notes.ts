/**
 * Draws notes (dimensions, text, hatches, title blocks) from their drawing instructions.
 * Hatches go under the geometry; everything else goes on top.
 */
import { arrowCorners, onCurrentSheet, resolveNoteStyle, resolveNotes, notesInDrawOrder, type Doc, type Note, type Prim } from '../core/doc';
import { loopCurves, type Loop } from '../core/geom';
import { palette } from '../ui/palette';
import type { Viewport } from './viewport';
import { HAIRLINE_BELOW_PX } from './scene-constants';

const PX_PER_MM = 96 / 25.4;
const FONT = 'B612, system-ui, sans-serif';

type Xf = (v: number) => number;

function traceLoop(ctx: CanvasRenderingContext2D, loop: Loop, X: Xf, Y: Xf, k: number): void {
  if (loop.kind === 'circle') {
    const r = loop.radius * k;
    ctx.moveTo(X(loop.center.x) + r, Y(loop.center.y));
    ctx.arc(X(loop.center.x), Y(loop.center.y), r, 0, 2 * Math.PI);
    return;
  }
  let first = true;
  for (const c of loopCurves(loop)) {
    if (c.kind === 'segment') {
      if (first) ctx.moveTo(X(c.start.x), Y(c.start.y));
      ctx.lineTo(X(c.end.x), Y(c.end.y));
    } else if (c.kind === 'arc') {
      const cx = X(c.center.x);
      const cy = Y(c.center.y);
      const r = c.radius * k;
      if (first) ctx.moveTo(cx + r * Math.cos(c.start), cy - r * Math.sin(c.start));
      ctx.arc(cx, cy, r, -c.start, -(c.start + c.sweep), c.sweep > 0);
    }
    first = false;
  }
  ctx.closePath();
}

/** Strokes the line work of prims into the current path and returns the ones that need filling or text. */
function tracePrims(ctx: CanvasRenderingContext2D, prims: readonly Prim[], X: Xf, Y: Xf, k: number): void {
  for (const p of prims) {
    if (p.k === 'seg') {
      ctx.moveTo(X(p.a.x), Y(p.a.y));
      ctx.lineTo(X(p.b.x), Y(p.b.y));
    } else if (p.k === 'arc') {
      const cx = X(p.center.x);
      const cy = Y(p.center.y);
      const r = p.radius * k;
      ctx.moveTo(cx + r * Math.cos(p.start), cy - r * Math.sin(p.start));
      ctx.arc(cx, cy, r, -p.start, -(p.start + p.sweep), p.sweep > 0);
    }
  }
}

function paintOne(ctx: CanvasRenderingContext2D, n: Note, prims: readonly Prim[], color: string, width: number, vp: Viewport, dpr: number): void {
  const k = vp.pxPerUnit * dpr;
  const X = (x: number) => vp.originX * dpr + x * k;
  const Y = (y: number) => vp.originY * dpr - y * k;
  void n;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  tracePrims(ctx, prims, X, Y, k);
  ctx.stroke();
  for (const p of prims) {
    if (p.k === 'fill') {
      ctx.beginPath();
      for (const l of p.loops) traceLoop(ctx, l, X, Y, k);
      ctx.fill('evenodd');
    } else if (p.k === 'arrow') {
      const [a, b, c] = arrowCorners(p);
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.lineTo(X(c.x), Y(c.y));
      ctx.closePath();
      ctx.fill();
    } else if (p.k === 'dot') {
      const r = Math.max(0.75 * dpr, 0.25 * k);
      ctx.fillRect(X(p.p.x) - r, Y(p.p.y) - r, 2 * r, 2 * r);
    } else if (p.k === 'text') {
      const px = p.height * k;
      if (px < 2.5 * dpr) continue; // too small to read: leave it out
      ctx.save();
      ctx.translate(X(p.at.x), Y(p.at.y));
      ctx.rotate(-p.angle);
      ctx.font = `${px}px ${FONT}`;
      ctx.textAlign = p.anchor;
      ctx.textBaseline = p.baseline === 'bottom' ? 'alphabetic' : 'middle';
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }
}

/** Paints the document's notes: hatches (`under`) or everything else. Returns how many were drawn. */
export function paintNotes(ctx: CanvasRenderingContext2D, doc: Doc, vp: Viewport, width: number, height: number, dpr: number, selection: ReadonlySet<number>, lineweights: boolean, under: boolean): number {
  if (doc.notes.size === 0) return 0;
  const resolved = resolveNotes(doc);
  const shown = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const left = (0 - vp.originX) / vp.pxPerUnit;
  const right = (width - vp.originX) / vp.pxPerUnit;
  const top = (vp.originY - 0) / vp.pxPerUnit;
  const bottom = (vp.originY - height) / vp.pxPerUnit;
  let drawn = 0;
  for (const n of notesInDrawOrder(doc)) {
    if ((n.body.kind === 'hatch') !== under || !shown.has(n.layer) || !onCurrentSheet(doc, n)) continue;
    const r = resolved.get(n.id);
    if (!r?.ok) continue;
    const b = r.r.bounds;
    if (b.maxX < left || b.minX > right || b.maxY < bottom || b.minY > top) continue;
    const st = resolveNoteStyle(doc, n);
    const selected = selection.has(n.id);
    const weightPx = st.lineweight * PX_PER_MM;
    const base = lineweights && weightPx >= HAIRLINE_BELOW_PX ? weightPx : 1;
    paintOne(ctx, n, r.r.prims, selected ? palette.selection : st.color, (selected ? base + 2 : base) * dpr, vp, dpr);
    drawn += 1;
  }
  return drawn;
}
