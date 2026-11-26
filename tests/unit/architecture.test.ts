import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ROADMAP architecture rule: nothing in src/core imports from render/, ui/, app/ or the DOM,
 * and the kernel has no third-party dependencies. This keeps the kernel testable in Node and
 * reusable (scripts, workers, other projects).
 */
const CORE = resolve('src/core');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const DOM_GLOBALS = /\b(document|window|navigator|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|localStorage)\b/;

/** Source with comments and string literals blanked: they may say "window" (window selection). */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

describe('core architecture', () => {
  const sources = files(CORE);

  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it.each(sources.map((f) => [relative(process.cwd(), f), f]))('%s imports only from src/core', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] as string;
      expect(spec.startsWith('.'), `${spec} is a package import`).toBe(true);
      const target = resolve(dirname(file), spec);
      expect(target.startsWith(CORE), `${spec} leaves src/core`).toBe(true);
    }
  });

  it('the DOM check ignores comments and strings but catches real use', () => {
    expect(codeOnly("const mode = 'window'; // drag a window box")).not.toMatch(DOM_GLOBALS);
    expect(codeOnly('const w = window.innerWidth;')).toMatch(DOM_GLOBALS);
    expect(codeOnly('const t = `${document.title}`; const d = document;')).toMatch(DOM_GLOBALS);
  });

  it.each(sources.map((f) => [relative(process.cwd(), f), f]))('%s uses no DOM globals', (_name, file) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(DOM_GLOBALS);
  });
});
