import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BUDGET_BYTES, measure } from '../../scripts/size-budget.mjs';

describe('size budget', () => {
  it('sums gzipped sizes and skips on-demand files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archilite-size-'));
    const js = Buffer.from('console.log("hello");'.repeat(100));
    writeFileSync(join(dir, 'app.js'), js);
    mkdirSync(join(dir, 'pyodide'));
    writeFileSync(join(dir, 'pyodide', 'big.wasm'), randomBytes(BUDGET_BYTES * 2));

    const { files, totalGzip } = measure(dir);
    expect(files.map((f) => f.path)).toEqual(['app.js']);
    expect(totalGzip).toBe(gzipSync(js, { level: 9 }).length);
    expect(totalGzip).toBeLessThan(BUDGET_BYTES);
  });

  it('counts incompressible content against the budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archilite-size-'));
    writeFileSync(join(dir, 'huge.js'), randomBytes(BUDGET_BYTES + 1024));
    expect(measure(dir).totalGzip).toBeGreaterThan(BUDGET_BYTES);
  });

  it('fails clearly when there is no build', () => {
    expect(() => measure(join(tmpdir(), 'archilite-does-not-exist'))).toThrow(/npm run build/);
  });
});
