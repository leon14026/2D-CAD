#!/usr/bin/env node
// ArchiLite licence gate.
//
// Runtime dependencies (shipped to users) must be satisfiable using only the strict
// permissive allowlist. Development tools (never shipped) must declare a licence and must
// be satisfiable without strong-copyleft or non-commercial licences.
//
// Usage: node scripts/license-gate.mjs [--lock package-lock.json] [--root .]
//                                      [--exceptions license-exceptions.json]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Licences allowed in anything shipped to users. */
export const RUNTIME_ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'OFL-1.1',
  // Weak, file-level copyleft. Allowed only for libraries used unmodified (Pyodide, Phase 8).
  'MPL-2.0',
]);

/** Licences never allowed, even in build and test tools. */
export const DENIED_PATTERNS = [
  /^A?GPL(-|\+|$)/i,
  /^LGPL(-|\+|$)/i,
  /^SSPL/i,
  /^EUPL/i,
  /^OSL-/i,
  /^RPL-/i,
  /^CPAL-/i,
  /^BUSL/i,
  /^Elastic-/i,
  /^CC-BY-NC/i,
  /^CC-BY-SA/i,
  /^CC-BY-ND/i,
  /^Commons-Clause/i,
  /^Sleepycat$/i,
];

/**
 * @typedef {{ license: string, exception?: string }
 *   | { op: 'AND' | 'OR', left: SpdxNode, right: SpdxNode, exception?: string }} SpdxNode
 * @typedef {{ key: string, name: string, version: string, license: string | null, dev: boolean }} Pkg
 * @typedef {{ name: string, version: string, tier: 'runtime' | 'dev', license: string | null, reason: string }} Failure
 * @typedef {Record<string, { license: string, reason: string }>} Exceptions
 */

/** @param {string} id */
export function isDenied(id) {
  return DENIED_PATTERNS.some((re) => re.test(id));
}

/**
 * Reads the licence declared by a package.json or lockfile entry as an SPDX expression string.
 * @param {any} source
 * @returns {string | null}
 */
export function normalizeLicense(source) {
  if (!source) return null;
  const { license, licenses } = source;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && typeof license.type === 'string') {
    return license.type.trim();
  }
  if (Array.isArray(licenses) && licenses.length > 0) {
    const ids = licenses
      .map((l) => (typeof l === 'string' ? l : l && l.type))
      .filter((t) => typeof t === 'string' && t.trim());
    if (ids.length === 1) return ids[0].trim();
    if (ids.length > 1) return `(${ids.map((t) => t.trim()).join(' OR ')})`;
  }
  return null;
}

/**
 * Parses an SPDX licence expression (AND, OR, WITH, parentheses).
 * @param {string} expression
 * @returns {SpdxNode}
 */
export function parseSpdx(expression) {
  const tokens = expression
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  const peek = () => tokens[i];
  /** @param {string | undefined} t @param {string} w */
  const isWord = (t, w) => typeof t === 'string' && t.toUpperCase() === w;

  /** @param {SpdxNode} node @returns {SpdxNode} */
  function withException(node) {
    if (isWord(peek(), 'WITH')) {
      i += 1;
      const exception = tokens[i++];
      if (!exception || exception === '(' || exception === ')') {
        throw new Error(`missing exception after WITH in "${expression}"`);
      }
      return { ...node, exception };
    }
    return node;
  }

  /** @returns {SpdxNode} */
  function atom() {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`unexpected end of "${expression}"`);
    if (t === '(') {
      /** @type {SpdxNode} */
      const inner = orExpr();
      if (tokens[i++] !== ')') throw new Error(`missing ")" in "${expression}"`);
      return withException(inner);
    }
    if (t === ')' || isWord(t, 'AND') || isWord(t, 'OR') || isWord(t, 'WITH')) {
      throw new Error(`unexpected "${t}" in "${expression}"`);
    }
    return withException({ license: t });
  }

  /** @returns {SpdxNode} */
  function andExpr() {
    /** @type {SpdxNode} */
    let left = atom();
    while (isWord(peek(), 'AND')) {
      i += 1;
      left = { op: 'AND', left, right: atom() };
    }
    return left;
  }

  /** @returns {SpdxNode} */
  function orExpr() {
    /** @type {SpdxNode} */
    let left = andExpr();
    while (isWord(peek(), 'OR')) {
      i += 1;
      left = { op: 'OR', left, right: andExpr() };
    }
    return left;
  }

  const tree = orExpr();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${expression}"`);
  return tree;
}

/**
 * True if some choice of OR branches uses only licences accepted by `ok`.
 * @param {SpdxNode} tree
 * @param {(id: string) => boolean} ok
 * @returns {boolean}
 */
export function satisfies(tree, ok) {
  if ('op' in tree) {
    return tree.op === 'OR'
      ? satisfies(tree.left, ok) || satisfies(tree.right, ok)
      : satisfies(tree.left, ok) && satisfies(tree.right, ok);
  }
  return ok(tree.license);
}

/**
 * Lists installed packages from an npm v2/v3 lockfile.
 * @param {any} lock parsed package-lock.json
 * @param {(key: string) => any} readManifest returns the package.json for a lockfile key, or null
 * @returns {Pkg[]}
 */
export function collectPackages(lock, readManifest = () => null) {
  /** @type {Pkg[]} */
  const out = [];
  /** @type {Array<[string, any]>} */
  const entries = Object.entries(lock.packages ?? {});
  for (const [key, entry] of entries) {
    if (key === '' || entry.link) continue;
    const marker = 'node_modules/';
    const name = entry.name ?? key.slice(key.lastIndexOf(marker) + marker.length);
    const manifest = readManifest(key);
    out.push({
      key,
      name,
      version: entry.version ?? (manifest && manifest.version) ?? '?',
      license: normalizeLicense(manifest) ?? normalizeLicense(entry),
      dev: Boolean(entry.dev || entry.devOptional),
    });
  }
  return out;
}

/**
 * Applies the policy.
 * @param {Array<{name: string, version: string, license: string | null, dev: boolean}>} packages
 * @param {Exceptions} exceptions
 * @returns {{ failures: Failure[] }}
 */
export function evaluate(packages, exceptions = {}) {
  /** @type {Failure[]} */
  const failures = [];
  for (const p of packages) {
    /** @type {'runtime' | 'dev'} */
    const tier = p.dev ? 'dev' : 'runtime';
    const override = exceptions[p.name];
    const license = override ? override.license : p.license;
    /** @param {string} reason */
    const fail = (reason) => failures.push({ name: p.name, version: p.version, tier, license, reason });

    if (!license) {
      fail('no licence declared');
      continue;
    }
    if (/^UNLICENSED$/i.test(license) || /^SEE LICEN[CS]E IN/i.test(license)) {
      fail('licence needs manual review: add a verified entry to license-exceptions.json');
      continue;
    }
    let tree;
    try {
      tree = parseSpdx(license);
    } catch (err) {
      fail(`unreadable licence expression (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    if (tier === 'runtime') {
      if (!satisfies(tree, (id) => RUNTIME_ALLOWED.has(id))) {
        fail('not on the runtime allowlist');
      }
    } else if (!satisfies(tree, (id) => !isDenied(id))) {
      fail('copyleft or otherwise blocked licence');
    }
  }
  return { failures };
}

/**
 * Runs the gate against files on disk.
 * @param {{ lockPath: string, root: string, exceptionsPath?: string }} options
 */
export function runGate({ lockPath, root, exceptionsPath }) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  /** @param {string} key */
  const readManifest = (key) => {
    const file = join(root, key, 'package.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  const exceptions =
    exceptionsPath && existsSync(exceptionsPath)
      ? JSON.parse(readFileSync(exceptionsPath, 'utf8'))
      : {};
  const packages = collectPackages(lock, readManifest);
  return { packages, ...evaluate(packages, exceptions) };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = { lock: 'package-lock.json', root: '.', exceptions: 'license-exceptions.json' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === '--lock') args.lock = value;
    else if (flag === '--root') args.root = value;
    else if (flag === '--exceptions') args.exceptions = value;
    else throw new Error(`unknown option ${flag}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { packages, failures } = runGate({
    lockPath: resolve(args.lock),
    root: resolve(args.root),
    exceptionsPath: resolve(args.exceptions),
  });
  const runtime = packages.filter((p) => !p.dev).length;
  console.log(
    `Licence gate: ${packages.length} packages checked (${runtime} runtime, ${packages.length - runtime} dev).`,
  );
  if (failures.length === 0) {
    console.log('PASS: every licence is allowed.');
    return 0;
  }
  console.error(`FAIL: ${failures.length} package(s) violate the licence policy:`);
  for (const f of failures) {
    console.error(`  - ${f.name}@${f.version} [${f.tier}] licence "${f.license ?? 'none'}": ${f.reason}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
