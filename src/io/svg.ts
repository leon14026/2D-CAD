/**
 * SVG export at 1:1. One millimetre on the drawing is one millimetre in the SVG.
 * Coordinates are converted to SVG's y-down page space here, so a viewer that ignores
 * transforms still measures true sizes.
 */
import {
  BY_LAYER,
  LINETYPES,
  arrowCorners,
  resolveNoteStyle,
  resolveNotes,
  resolveStyle,
  type Doc,
} from '../core/doc';
import { explodePolyline, radToDeg, type Shape, type Vec2 } from '../core/geom';
import { arcCubics, circleCubics, type Cubic } from './bezier';
import { paperFor } from './layout';

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dash(linetype: keyof typeof LINETYPES, weight: number): string {
  const p = LINETYPES[linetype].pattern;
  if (p.length === 0) return '';
  return ` stroke-dasharray="${p.map((x) => Math.max(0.1, x * Math.max(weight, 0.25))).join(' ')}"`;
}

export function exportSvg(doc: Doc): string {
  const paper = paperFor(doc);
  const shown = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const X = (x: number) => x - paper.originX;
  const Y = (y: number) => paper.height - (y - paper.originY);
  const P = (p: Vec2) => `${fmt(X(p.x))} ${fmt(Y(p.y))}`;
  const parts: string[] = [];

  const stroke = (color: string, weight: number, linetype: keyof typeof LINETYPES): string =>
    `fill="none" stroke="${xml(color)}" stroke-width="${fmt(weight)}" stroke-linecap="butt" stroke-linejoin="miter"${dash(linetype, weight)}`;

  const cubicPath = (cs: readonly Cubic[]): string => {
    if (cs.length === 0) return '';
    const first = cs[0] as Cubic;
    let d = `M ${P(first.p0)}`;
    for (const c of cs) d += ` C ${P(c.p1)} ${P(c.p2)} ${P(c.p3)}`;
    return d;
  };

  const shapePath = (geom: Shape): string => {
    if (geom.kind === 'segment') return `M ${P(geom.start)} L ${P(geom.end)}`;
    if (geom.kind === 'circle') return cubicPath(circleCubics(geom.center, geom.radius));
    if (geom.kind === 'arc') return cubicPath(arcCubics(geom.center, geom.radius, geom.start, geom.sweep));
    let d = '';
    for (const c of explodePolyline(geom)) {
      if (c.kind === 'segment') d += `${d === '' ? 'M' : 'L'} ${P(c.start)} L ${P(c.end)} `;
      else if (c.kind === 'arc') d += `${cubicPath(arcCubics(c.center, c.radius, c.start, c.sweep))} `;
    }
    if (geom.closed) d += 'Z';
    return d.trim();
  };

  for (const e of doc.entities.values()) {
    if (!shown.has(e.layer)) continue;
    const st = resolveStyle(doc, e);
    parts.push(`<path d="${xml(shapePath(e.geom))}" ${stroke(st.color, st.lineweight, st.linetype)}/>`);
  }

  const resolved = resolveNotes(doc);
  for (const n of doc.notes.values()) {
    if (!shown.has(n.layer)) continue;
    const r = resolved.get(n.id);
    if (!r?.ok) continue;
    const st = resolveNoteStyle(doc, n);
    const color = n.color === BY_LAYER ? st.color : n.color;
    const weight = typeof n.lineweight === 'number' ? n.lineweight : st.lineweight;
    for (const p of r.r.prims) {
      if (p.k === 'seg') {
        parts.push(`<path d="M ${P(p.a)} L ${P(p.b)}" ${stroke(color, weight, 'continuous')}/>`);
      } else if (p.k === 'arc') {
        parts.push(`<path d="${xml(cubicPath(arcCubics(p.center, p.radius, p.start, p.sweep)))}" ${stroke(color, weight, 'continuous')}/>`);
      } else if (p.k === 'arrow') {
        const [a, b, c] = arrowCorners(p);
        parts.push(`<path d="M ${P(a)} L ${P(b)} L ${P(c)} Z" fill="${xml(color)}" stroke="none"/>`);
      } else if (p.k === 'dot') {
        parts.push(`<circle cx="${fmt(X(p.p.x))}" cy="${fmt(Y(p.p.y))}" r="${fmt(weight)}" fill="${xml(color)}"/>`);
      } else if (p.k === 'fill') {
        let d = '';
        for (const loop of p.loops) d += `${shapePath(loop)} `;
        parts.push(`<path d="${xml(d.trim())}" fill="${xml(color)}" fill-rule="evenodd" stroke="none"/>`);
      } else if (p.k === 'text') {
        const x = X(p.at.x);
        const y = Y(p.at.y);
        const deg = -radToDeg(p.angle);
        const anchor = p.anchor === 'center' ? 'middle' : p.anchor === 'right' ? 'end' : 'start';
        const base = p.baseline === 'middle' ? 'central' : 'alphabetic';
        parts.push(
          `<text x="${fmt(x)}" y="${fmt(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${fmt(p.height)}" fill="${xml(color)}" text-anchor="${anchor}" dominant-baseline="${base}" transform="rotate(${fmt(deg)} ${fmt(x)} ${fmt(y)})">${xml(p.text)}</text>`,
        );
      }
    }
  }

  const w = paper.width;
  const h = paper.height;
  const unit = doc.settings.units === 'in' || doc.settings.units === 'ft' ? 'in' : 'mm';
  const toMm = (v: number) => (unit === 'mm' ? v : unit === 'in' ? v * 25.4 : v * 304.8);
  const widthMm = unit === 'mm' ? w : toMm(w);
  const heightMm = unit === 'mm' ? h : toMm(h);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}

function fmt(n: number): string {
  const x = n + 0;
  if (Number.isInteger(x)) return String(x);
  return String(Math.round(x * 1e9) / 1e9);
}
