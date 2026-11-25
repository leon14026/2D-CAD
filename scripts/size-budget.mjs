#!/usr/bin/env node
// ArchiLite download budget: the gzipped size of the built site (excluding the
// on-demand Python runtime) must stay within BUDGET_BYTES.
//
// Usage: node scripts/size-budget.mjs [dist]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 300 * 1024;

/** Paths (relative to dist, forward slashes) that load only on demand. */
export const ON_DEMAND = [/^pyodide\//];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** @param {string} dir */
export function measure(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`build output not found at ${dir}; run "npm run build" first`);
  }
  const files = listFiles(dir)
    .map((file) => {
      const path = relative(dir, file).split('\\').join('/');
      const raw = readFileSync(file);
      return { path, raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length };
    })
    .filter((f) => !ON_DEMAND.some((re) => re.test(f.path)));
  const totalGzip = files.reduce((sum, f) => sum + f.gzip, 0);
  return { files, totalGzip };
}

/** @param {number} bytes */
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function main() {
  const dir = resolve(process.argv[2] ?? 'dist');
  const { files, totalGzip } = measure(dir);
  for (const f of files.sort((a, b) => b.gzip - a.gzip)) {
    console.log(`  ${kb(f.gzip).padStart(9)} gz  ${kb(f.raw).padStart(9)} raw  ${f.path}`);
  }
  const verdict = totalGzip <= BUDGET_BYTES ? 'PASS' : 'FAIL';
  console.log(`Size budget: ${verdict}, ${kb(totalGzip)} of ${kb(BUDGET_BYTES)} gzipped.`);
  return verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
