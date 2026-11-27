import { describe, expect, it } from 'vitest';
import { createSession, execute, loadDocument, newDocument } from '../../../src/core/doc';
import { segment, vec } from '../../../src/core/geom';
import { PT_PER_MM } from '../../../src/io/layout';
import { exportPdf, firstLineLengthPt } from '../../../src/io/pdf';
import { expectClose } from '../core/helpers';
import { readFileSync } from 'node:fs';

describe('PDF at true scale', () => {
  it('a 100 mm line measures 283.4646 pt', () => {
    let session = createSession(newDocument({ title: 'hundred', units: 'mm' }));
    session = execute(session, 'entity.add', { geom: segment(vec(0, 0), vec(100, 0)) }).session;
    const pdf = exportPdf(session.doc);
    const length = firstLineLengthPt(pdf);
    expectClose(length, 100 * PT_PER_MM, 5e-5);
    expect(length.toFixed(4)).toBe('283.4646');
  });

  it('starts with a PDF header and a MediaBox', () => {
    const pdf = exportPdf(newDocument());
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox');
    expect(pdf).toContain('%%EOF');
  });

  it('the example bracket produces a PDF with line work', () => {
    const doc = loadDocument(readFileSync('public/examples/bracket.archilite', 'utf8'));
    const pdf = exportPdf(doc);
    expect(pdf).toContain(' c ');
    expect(pdf).toContain(' S\n');
  });
});
