/**
 * A small PDF writer: one page, vector line work, Helvetica text, true 1:1 scale.
 * A 100 mm line is 100 × 72 / 25.4 = 283.4646… PDF points.
 */
import { arrowCorners, onCurrentSheet, piecesOnSheet, resolveNoteStyle, resolveNotes, resolveStyle, type Doc, type Entity } from '../core/doc';
import { explodePolyline, type Shape, type Vec2 } from '../core/geom';
import { arcCubics, circleCubics, type Cubic } from './bezier';
import { paperFor, ptPerDrawingUnit } from './layout';

function pdfEscape(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32;
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (ch === 'Ø') out += '\\330';
    else if (ch === '°') out += '\\260';
    else if (c === 10 || c === 13) out += ' ';
    else if (c < 32 || c > 126) out += ' ';
    else out += ch;
  }
  return out;
}

function n(x: number): string {
  const v = x + 0;
  if (Number.isInteger(v)) return `${v}`;
  const s = v.toFixed(8).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function rgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return '0 0 0';
  return `${n(parseInt(m[1], 16) / 255)} ${n(parseInt(m[2], 16) / 255)} ${n(parseInt(m[3], 16) / 255)}`;
}

function cubicsOps(cs: readonly Cubic[]): string {
  if (cs.length === 0) return '';
  const first = cs[0] as Cubic;
  const bits = [`${n(first.p0.x)} ${n(first.p0.y)} m`];
  for (const c of cs) bits.push(`${n(c.p1.x)} ${n(c.p1.y)} ${n(c.p2.x)} ${n(c.p2.y)} ${n(c.p3.x)} ${n(c.p3.y)} c`);
  return bits.join(' ');
}

function shapeOps(geom: Shape): string {
  if (geom.kind === 'segment') {
    return `${n(geom.start.x)} ${n(geom.start.y)} m ${n(geom.end.x)} ${n(geom.end.y)} l`;
  }
  if (geom.kind === 'circle') return cubicsOps(circleCubics(geom.center, geom.radius));
  if (geom.kind === 'arc') return cubicsOps(arcCubics(geom.center, geom.radius, geom.start, geom.sweep));
  const bits: string[] = [];
  for (const c of explodePolyline(geom)) bits.push(shapeOps(c));
  if (geom.closed) bits.push('h');
  return bits.join(' ');
}

function textOps(at: Vec2, height: number, angle: number, anchor: 'left' | 'center' | 'right', text: string): string {
  const width = text.length * 0.5 * height;
  const shift = anchor === 'center' ? -width / 2 : anchor === 'right' ? -width : 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = at.x + c * shift;
  const y = at.y + s * shift;
  return `BT /F1 ${n(height)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(x)} ${n(y)} Tm (${pdfEscape(text)}) Tj ET`;
}

/**
 * Builds a 1:1 PDF. User space after the page CTM is drawing units; the CTM scales by
 * `ptPerDrawingUnit` so a millimetre on the drawing is a millimetre on paper.
 */
export function exportPdf(doc: Doc): string {
  const paper = paperFor(doc);
  const k = ptPerDrawingUnit(doc.settings.units);
  const pageW = paper.width * k;
  const pageH = paper.height * k;
  const shown = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const ops: string[] = [];
  ops.push('q');
  ops.push(`${n(k)} 0 0 ${n(k)} ${n(-paper.originX * k)} ${n(-paper.originY * k)} cm`);
  ops.push('0.25 w 0 j 0 J');

  const stroke = (color: string, weight: number) => {
    ops.push(`${rgb(color)} RG ${n(weight)} w`);
  };

  for (const p of piecesOnSheet(doc)) {
    if (!shown.has(p.layer)) continue;
    const e = { id: p.id, layer: p.layer, z: 0, color: p.color, linetype: p.linetype, lineweight: p.lineweight, geom: p.geom } satisfies Entity;
    const st = resolveStyle(doc, e);
    stroke(st.color, st.lineweight);
    ops.push(`${shapeOps(p.geom)} S`);
  }

  const resolved = resolveNotes(doc);
  for (const nte of doc.notes.values()) {
    if (!onCurrentSheet(doc, nte)) continue;
    if (!shown.has(nte.layer)) continue;
    const r = resolved.get(nte.id);
    if (!r?.ok) continue;
    const st = resolveNoteStyle(doc, nte);
    for (const p of r.r.prims) {
      if (p.k === 'seg') {
        stroke(st.color, st.lineweight);
        ops.push(`${n(p.a.x)} ${n(p.a.y)} m ${n(p.b.x)} ${n(p.b.y)} l S`);
      } else if (p.k === 'arc') {
        stroke(st.color, st.lineweight);
        ops.push(`${cubicsOps(arcCubics(p.center, p.radius, p.start, p.sweep))} S`);
      } else if (p.k === 'arrow') {
        const [a, b, c] = arrowCorners(p);
        ops.push(`${rgb(st.color)} rg ${n(a.x)} ${n(a.y)} m ${n(b.x)} ${n(b.y)} l ${n(c.x)} ${n(c.y)} l h f`);
      } else if (p.k === 'dot') {
        ops.push(`${rgb(st.color)} rg ${cubicsOps(circleCubics(p.p, Math.max(st.lineweight, 0.15)))} h f`);
      } else if (p.k === 'fill') {
        ops.push(`${rgb(st.color)} rg`);
        for (const loop of p.loops) ops.push(`${shapeOps(loop)} h`);
        ops.push('f*');
      } else if (p.k === 'text') {
        ops.push(`${rgb(st.color)} rg`);
        ops.push(textOps(p.at, p.height, p.angle, p.anchor, p.text));
      }
    }
  }

  ops.push('Q');
  const stream = ops.join('\n');
  return assemblePdf(pageW, pageH, stream);
}

function assemblePdf(pageW: number, pageH: number, stream: string): string {
  const objects: string[] = [];
  const offsets: number[] = [0];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  );
  add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // ASCII only so a UTF-8 Blob keeps xref offsets equal to byte offsets.
  let file = '%PDF-1.4\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(file.length);
    file += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = file.length;
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  file += xrefLines.join('\n') + '\n';
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return file;
}

/**
 * Length in PDF points of the first stroked line in a PDF produced by `exportPdf`.
 * Used by the 100 mm = 283.4646 pt gate.
 */
export function firstLineLengthPt(pdf: string): number {
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf)?.[1];
  if (!stream) throw new Error('PDF has no content stream');
  const cm = /([0-9.-]+) 0 0 ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) cm/.exec(stream);
  const line = /([0-9.-]+) ([0-9.-]+) m ([0-9.-]+) ([0-9.-]+) l S/.exec(stream);
  if (!cm || !line) throw new Error('PDF has no scaled line');
  const kx = Number(cm[1]);
  const ky = Number(cm[2]);
  const dx = (Number(line[3]) - Number(line[1])) * kx;
  const dy = (Number(line[4]) - Number(line[2])) * ky;
  return Math.hypot(dx, dy);
}
