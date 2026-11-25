#!/usr/bin/env node
// ArchiLite brand guard: keeps other companies' product names, and references to their
// proprietary support files, out of the application source and UI.
//
// Documentation (README.md, NOTICE, ROADMAP.md, ATTRIBUTION.md) may name them in
// nominative statements and is not scanned.
//
// Usage: node scripts/brand-guard.mjs [path ...]   (default: src index.html public)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORBIDDEN = [
  { term: 'Autodesk', pattern: /\bautodesk\b/i },
  { term: 'AutoCAD', pattern: /\bauto[\s-]?cad\b/i },
  { term: 'ArtCraft', pattern: /\bart[\s-]?craft\b/i },
  { term: 'CADCraft', pattern: /\bcad[\s-]?craft\b/i },
  { term: 'Archicad', pattern: /\barchi[\s-]?cad\b/i },
  { term: 'acad support file', pattern: /\bacad(?:iso)?\.(?:pat|lin|shx|dwt|pgp)\b/i },
  { term: 'SHX font', pattern: /\.shx\b/i },
];

export const DEFAULT_PATHS = ['src', 'index.html', 'public'];

/** @typedef {{ file: string, line: number, term: string, text: string }} Finding */

/**
 * @param {string} text
 * @param {string} file
 * @returns {Finding[]}
 */
export function scanText(text, file) {
  /** @type {Finding[]} */
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { term, pattern } of FORBIDDEN) {
      if (pattern.test(line)) findings.push({ file, line: index + 1, term, text: line.trim() });
    }
  });
  return findings;
}

/**
 * @param {string} path
 * @returns {string[]}
 */
function listFiles(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    listFiles(join(path, entry.name)),
  );
}

/** @param {string[]} paths */
export function scanPaths(paths, cwd = process.cwd()) {
  return paths
    .flatMap((p) => listFiles(resolve(cwd, p)))
    .flatMap((file) => scanText(readFileSync(file, 'utf8'), relative(cwd, file)));
}

function main() {
  const paths = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATHS;
  const findings = scanPaths(paths);
  if (findings.length === 0) {
    console.log(`Brand guard: PASS (${paths.join(', ')}).`);
    return 0;
  }
  console.error(`Brand guard: FAIL, ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  - ${f.file}:${f.line} uses "${f.term}": ${f.text}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
