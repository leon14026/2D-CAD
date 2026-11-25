import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPackages,
  evaluate,
  isDenied,
  normalizeLicense,
  parseSpdx,
  runGate,
  satisfies,
} from '../../scripts/license-gate.mjs';

const GATE = resolve('scripts/license-gate.mjs');

type Pkg = { name: string; license?: unknown; dev?: boolean; licenses?: unknown };

function lockfile(packages: Pkg[]) {
  const entries: Record<string, unknown> = { '': { name: 'fixture', version: '0.0.0' } };
  for (const p of packages) {
    entries[`node_modules/${p.name}`] = {
      version: '1.0.0',
      ...(p.license === undefined ? {} : { license: p.license }),
      ...(p.licenses === undefined ? {} : { licenses: p.licenses }),
      ...(p.dev ? { dev: true } : {}),
    };
  }
  return { name: 'fixture', lockfileVersion: 3, packages: entries };
}

/** Writes a fixture lockfile and runs the real CLI against it. */
function runCli(packages: Pkg[], exceptions?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'archilite-gate-'));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lockfile(packages)));
  const args = [GATE, '--lock', join(dir, 'package-lock.json'), '--root', dir];
  if (exceptions) {
    writeFileSync(join(dir, 'exceptions.json'), JSON.stringify(exceptions));
    args.push('--exceptions', join(dir, 'exceptions.json'));
  } else {
    args.push('--exceptions', join(dir, 'none.json'));
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('licence gate CLI (the Phase 0 proof that GPL is rejected)', () => {
  it('passes a clean permissive tree', () => {
    const r = runCli([
      { name: 'ok-mit', license: 'MIT' },
      { name: 'ok-dual', license: '(MIT OR Apache-2.0)' },
      { name: 'ok-tool', license: 'Apache-2.0', dev: true },
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('PASS');
  });

  it('rejects a GPL runtime dependency', () => {
    const r = runCli([
      { name: 'ok-mit', license: 'MIT' },
      { name: 'bad-gpl', license: 'GPL-3.0-only' },
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('bad-gpl@1.0.0 [runtime]');
  });

  it('rejects a GPL build tool too', () => {
    const r = runCli([{ name: 'gpl-tool', license: 'GPL-2.0-or-later', dev: true }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('gpl-tool@1.0.0 [dev]');
  });

  it('rejects AGPL, LGPL and non-commercial licences', () => {
    for (const license of ['AGPL-3.0-only', 'LGPL-2.1-or-later', 'CC-BY-NC-4.0', 'SSPL-1.0']) {
      expect(runCli([{ name: 'x', license, dev: true }]).code).toBe(1);
    }
  });

  it('rejects packages with no licence, UNLICENSED or "SEE LICENSE IN"', () => {
    expect(runCli([{ name: 'none' }]).code).toBe(1);
    expect(runCli([{ name: 'closed', license: 'UNLICENSED' }]).code).toBe(1);
    expect(runCli([{ name: 'custom', license: 'SEE LICENSE IN LICENSE.txt' }]).code).toBe(1);
  });

  it('accepts a verified exception', () => {
    const r = runCli([{ name: 'odd-pkg', license: 'SEE LICENSE IN LICENSE' }], {
      'odd-pkg': { license: 'MIT', reason: 'LICENSE file is the MIT text (checked by hand)' },
    });
    expect(r.code).toBe(0);
  });

  it('passes on the real repository', () => {
    const r = runGate({
      lockPath: resolve('package-lock.json'),
      root: resolve('.'),
      exceptionsPath: resolve('license-exceptions.json'),
    });
    expect(r.failures).toEqual([]);
    expect(r.packages.length).toBeGreaterThan(0);
  });
});

describe('SPDX expressions', () => {
  const allowedRuntime = (id: string) => ['MIT', 'Apache-2.0'].includes(id);

  it.each([
    ['MIT', true],
    ['(MIT OR GPL-3.0-only)', true],
    ['GPL-3.0-only OR MIT', true],
    ['MIT AND GPL-2.0-only', false],
    ['(MIT AND Apache-2.0)', true],
    ['MIT AND (Apache-2.0 OR GPL-3.0-only)', true],
    ['Apache-2.0 WITH LLVM-exception', true],
    ['GPL-2.0-only WITH Classpath-exception-2.0', false],
  ])('%s satisfiable with {MIT, Apache-2.0}: %s', (expr, expected) => {
    expect(satisfies(parseSpdx(expr), allowedRuntime)).toBe(expected);
  });

  it.each(['', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT WITH'])('rejects malformed "%s"', (expr) => {
    expect(() => parseSpdx(expr)).toThrow();
  });

  it.each(['GPL-3.0', 'GPL-2.0+', 'AGPL-3.0-or-later', 'LGPL-3.0-only', 'GPL'])('%s is denied', (id) => {
    expect(isDenied(id)).toBe(true);
  });

  it.each(['MIT', 'Apache-2.0', 'MPL-2.0', 'BSD-3-Clause', 'CC-BY-4.0'])('%s is not denied', (id) => {
    expect(isDenied(id)).toBe(false);
  });
});

describe('licence field normalisation', () => {
  it('reads every shape npm has used', () => {
    expect(normalizeLicense({ license: 'MIT' })).toBe('MIT');
    expect(normalizeLicense({ license: { type: 'ISC' } })).toBe('ISC');
    expect(normalizeLicense({ licenses: [{ type: 'MIT' }] })).toBe('MIT');
    expect(normalizeLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT OR Apache-2.0)',
    );
    expect(normalizeLicense({})).toBeNull();
    expect(normalizeLicense(null)).toBeNull();
  });

  it('prefers the installed package.json over the lockfile', () => {
    const lock = lockfile([{ name: 'a', license: 'MIT' }]);
    const pkgs = collectPackages(lock, () => ({ license: 'GPL-3.0-only', version: '1.0.0' }));
    expect(pkgs[0]?.license).toBe('GPL-3.0-only');
    expect(evaluate(pkgs).failures).toHaveLength(1);
  });

  it('treats devOptional packages as development tools', () => {
    const lock = {
      packages: { '': {}, 'node_modules/x': { version: '1.0.0', license: 'MIT', devOptional: true } },
    };
    expect(collectPackages(lock)[0]?.dev).toBe(true);
  });
});
