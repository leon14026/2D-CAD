/**
 * Draws a document's entities with plain Canvas 2D calls (no WebGL, no WebGPU).
 *
 * Speed comes from:
 * - culling: only entities whose bounds touch the screen are drawn (spatial index);
 * - batching: consecutive entities with the same style share one path and one stroke, which
 *   keeps drawing order correct;
 * - level of detail: anything smaller than about a pixel is drawn as a dot, and shapes smaller
 *   than THIN_BELOW_PX on screen are drawn as hairlines whatever their lineweight;
 * - hairlines and square line ends wherever possible: in software rendering a 1-pixel line is
 *   about 5 times cheaper to draw than a 2-pixel one, and rounded ends triple that again;
 * - caches: exploded polylines and per-layer styles are reused between frames.
 *
 * Coordinates are converted to device pixels in JavaScript (doubles), not through the canvas
 * transform, which some browsers apply in single precision.
 */
import { compareDrawOrder, LINETYPES, type Doc, type Entity, type Layer } from '../core/doc';
import { explodePolyline, type Curve, type Shape } from '../core/geom';
import { DocIndex, entityBounds } from '../core/spatial';
import { palette } from '../ui/palette';
import { visibleWorld, type Viewport } from './viewport';
import type { Surface } from './grid-painter';

/** CSS pixels per millimetre of line width at 96 dpi. */
const PX_PER_MM = 96 / 25.4;

/** Lines thinner than this (CSS pixels) are drawn as hairlines. */
export const HAIRLINE_BELOW_PX = 1.5;

/** Shapes smaller than this on screen (CSS pixels) are drawn as hairlines. */
export const THIN_BELOW_PX = 16;

export interface SceneOptions {
  readonly selection: ReadonlySet<number>;
  /** Draw line widths in proportion to their lineweight (otherwise every line is 1 pixel). */
  readonly lineweights: boolean;
}

export interface SceneStats {
  readonly drawn: number;
  readonly culled: number;
  readonly strokes: number;
  readonly ms: number;
}

const explodedCache = new WeakMap<Shape, Curve[]>();

function curves(s: Shape): Curve[] {
  if (s.kind !== 'polyline') return [s];
  let c = explodedCache.get(s);
  if (!c) {
    c = explodePolyline(s);
    explodedCache.set(s, c);
  }
  return c;
}

interface Style {
  readonly key: string;
  readonly color: string;
  readonly width: number;
  readonly dash: readonly number[];
}

/** Entities to draw this frame, in drawing order, on visible layers. */
function visibleEntities(doc: Doc, vp: Viewport, width: number, height: number): { list: Entity[]; culled: number } {
  const index = DocIndex.of(doc);
  const view = visibleWorld(vp, width, height);
  const hits = index.query(view);
  const shownLayers = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const list = hits.filter((e) => shownLayers.has(e.layer)).sort(compareDrawOrder);
  return { list, culled: doc.entities.size - hits.length };
}

/**
 * Adds a shape's outline to the current path, converting world coordinates with X and Y
 * (to device pixels) and `scale` (device pixels per drawing unit).
 */
export function traceShape(
  ctx: CanvasRenderingContext2D,
  geom: Shape,
  X: (x: number) => number,
  Y: (y: number) => number,
  scale: number,
): void {
  for (const c of curves(geom)) {
    switch (c.kind) {
      case 'segment':
        ctx.moveTo(X(c.start.x), Y(c.start.y));
        ctx.lineTo(X(c.end.x), Y(c.end.y));
        break;
      case 'circle': {
        const r = c.radius * scale;
        ctx.moveTo(X(c.center.x) + r, Y(c.center.y));
        ctx.arc(X(c.center.x), Y(c.center.y), r, 0, 2 * Math.PI);
        break;
      }
      case 'arc': {
        // Screen y points down, so world angle θ is screen angle −θ and anticlockwise flips.
        const cx = X(c.center.x);
        const cy = Y(c.center.y);
        const r = c.radius * scale;
        ctx.moveTo(cx + r * Math.cos(c.start), cy - r * Math.sin(c.start));
        ctx.arc(cx, cy, r, -c.start, -(c.start + c.sweep), c.sweep > 0);
        break;
      }
    }
  }
}

export function drawScene(surface: Surface, vp: Viewport, doc: Doc, options: SceneOptions): SceneStats {
  const t0 = performance.now();
  const { ctx, width, height, dpr } = surface;
  const { list, culled } = visibleEntities(doc, vp, width, height);
  const layers = new Map<number, Layer>(doc.layers.map((l) => [l.id, l]));
  const styleCache = new Map<string, Style>();

  const s = vp.pxPerUnit * dpr;
  const ox = vp.originX * dpr;
  const oy = vp.originY * dpr;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy - y * s;

  const styleOf = (e: Entity, small: boolean): Style => {
    const layer = layers.get(e.layer) as Layer;
    const color = e.color === 'byLayer' ? layer.color : e.color;
    const linetype = e.linetype === 'byLayer' ? layer.linetype : e.linetype;
    const lineweight = e.lineweight === 'byLayer' ? layer.lineweight : e.lineweight;
    const selected = options.selection.has(e.id);
    const weightPx = lineweight * PX_PER_MM;
    const base = options.lineweights && !small && weightPx >= HAIRLINE_BELOW_PX ? weightPx : 1;
    const width = (selected ? base + 2 : base) * dpr;
    const key = `${color}|${linetype}|${lineweight}|${width}|${selected ? 1 : 0}`;
    let style = styleCache.get(key);
    if (!style) {
      const unit = Math.max(1, weightPx) * dpr;
      style = {
        key,
        color: selected ? palette.selection : color,
        width,
        dash: LINETYPES[linetype].pattern.map((p) => Math.max(1, p * unit)),
      };
      styleCache.set(key, style);
    }
    return style;
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  let current: Style | null = null;
  let strokes = 0;
  const flush = () => {
    if (!current) return;
    ctx.strokeStyle = current.color;
    ctx.lineWidth = current.width;
    ctx.setLineDash(current.dash as number[]);
    ctx.stroke();
    strokes += 1;
  };

  const thinBelow = THIN_BELOW_PX * dpr;
  for (const e of list) {
    const b = entityBounds(e);
    const w = (b.maxX - b.minX) * s;
    const h = (b.maxY - b.minY) * s;
    const style = styleOf(e, w < thinBelow && h < thinBelow);
    if (style.key !== current?.key) {
      flush();
      current = style;
      ctx.beginPath();
    }
    if (w < dpr && h < dpr) {
      // Smaller than a pixel: a dot is all the eye can see.
      const x = X(b.minX);
      const y = Y(b.minY);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01, y);
      continue;
    }
    traceShape(ctx, e.geom, X, Y, s);
  }
  flush();
  ctx.setLineDash([]);
  return { drawn: list.length, culled, strokes, ms: performance.now() - t0 };
}
