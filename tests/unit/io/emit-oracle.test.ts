/**
 * Writes the DXF files the Python oracle reads. `npm run oracle:check` runs this first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSession, execute, loadDocument, newDocument } from '../../../src/core/doc';
import { segment, vec } from '../../../src/core/geom';
import { exportDxf } from '../../../src/io/dxf';
import { buildExampleBracket } from '../core/doc/example-bracket';

export const EXPORT_DIR = process.env['EXPORT_DIR'] ?? join(tmpdir(), 'archilite-export-oracle');

describe('export oracle files', () => {
  it('writes the DXF fixtures the independent checker reads', () => {
    mkdirSync(EXPORT_DIR, { recursive: true });
    let line = createSession(newDocument({ title: 'hundred millimetres', units: 'mm' }));
    line = execute(line, 'entity.add', { geom: segment(vec(0, 0), vec(100, 0)) }).session;
    writeFileSync(join(EXPORT_DIR, 'line-100.dxf'), exportDxf(line.doc));
    writeFileSync(join(EXPORT_DIR, 'bracket.dxf'), exportDxf(buildExampleBracket()));
    writeFileSync(
      join(EXPORT_DIR, 'annotate.dxf'),
      exportDxf(loadDocument(readFileSync('tests/fixtures/annotate-reference.archilite', 'utf8'))),
    );
    expect(readFileSync(join(EXPORT_DIR, 'line-100.dxf'), 'utf8')).toContain('LINE');
  });
});
