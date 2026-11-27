import { describe, expect, it } from 'vitest';
import { createSession, execute, loadDocument, newDocument } from '../../../src/core/doc';
import { circle, segment, vec } from '../../../src/core/geom';
import { exportSvg } from '../../../src/io/svg';
import { readFileSync } from 'node:fs';

describe('SVG export', () => {
  it('declares millimetre size and contains the 100 mm line', () => {
    let session = createSession(newDocument({ units: 'mm' }));
    session = execute(session, 'entity.add', { geom: segment(vec(0, 0), vec(100, 0)) }).session;
    const svg = exportSvg(session.doc);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/width="[^"]+mm"/);
    // 10 mm margin on each side: the 100 mm line runs from 10 to 110 in page space.
    expect(svg).toContain('L 110 10');
  });

  it('draws a circle as cubics (so y-up conversion cannot flip sweep)', () => {
    let session = createSession(newDocument({ units: 'mm' }));
    session = execute(session, 'entity.add', { geom: circle(vec(10, 10), 4) }).session;
    const svg = exportSvg(session.doc);
    expect(svg).toContain(' C ');
  });

  it('the example bracket SVG is well-formed XML with paths', () => {
    const doc = loadDocument(readFileSync('public/examples/bracket.archilite', 'utf8'));
    const svg = exportSvg(doc);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(5);
    expect(svg).toContain('</svg>');
  });
});
