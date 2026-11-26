/**
 * PNG export: paints the drawing onto an off-screen Canvas 2D at a chosen scale and
 * returns a PNG blob. Grid, axes and rulers stay off; this is the drawing, not the workbench.
 */
import type { Doc } from '../core/doc';
import { convertLength } from '../core/geom';
import { paperFor } from '../io/layout';
import { palette } from '../ui/palette';
import { drawScene } from './scene';
import type { Surface } from './grid-painter';
import type { Viewport } from './viewport';

const DEFAULT_PX_PER_MM = 8;
const MAX_EDGE = 8192;

export async function exportPng(doc: Doc, pxPerMm = DEFAULT_PX_PER_MM): Promise<Blob> {
  const paper = paperFor(doc);
  let pxPerUnit = pxPerMm * convertLength(1, doc.settings.units, 'mm');
  let width = Math.max(1, Math.round(paper.width * pxPerUnit));
  let height = Math.max(1, Math.round(paper.height * pxPerUnit));
  if (width > MAX_EDGE || height > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height);
    pxPerUnit *= scale;
    width = Math.max(1, Math.round(paper.width * pxPerUnit));
    height = Math.max(1, Math.round(paper.height * pxPerUnit));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  const surface: Surface = { ctx, width, height, dpr: 1 };
  const vp: Viewport = {
    originX: -paper.originX * pxPerUnit,
    originY: (paper.originY + paper.height) * pxPerUnit,
    pxPerUnit,
  };
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  drawScene(surface, vp, doc, { selection: new Set(), lineweights: true });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The PNG could not be made.'));
    }, 'image/png');
  });
}
