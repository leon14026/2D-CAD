import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { APP_NAME } from './src/app/brand.ts';
import { LARGE_EXAMPLE_FILE } from './src/app/examples.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function buildSha(): string {
  const fromCi = process.env['GITHUB_SHA'];
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/**
 * Adds the large test drawing (20,000 entities) to the built site. It is generated from the
 * example bracket rather than committed, and is only downloaded when someone asks for it.
 */
function largeExample(): Plugin {
  return {
    name: 'archilite-large-example',
    apply: 'build',
    async generateBundle() {
      const { bigDrawingText } = await import('./tests/fixtures/big-drawing.ts');
      this.emitFile({ type: 'asset', fileName: LARGE_EXAMPLE_FILE, source: bigDrawingText() });
    },
  };
}

/** Replaces %APP_NAME% in index.html so the name is defined only in src/app/brand.ts. */
function brandHtml(): Plugin {
  return {
    name: 'archilite-brand-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the site works at a domain root or under /<repo>/ on GitHub Pages.
  base: './',
  plugins: [brandHtml(), largeExample()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        inspect: fileURLToPath(new URL('./inspect.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The kernel must be fully covered (ROADMAP Phase 1 gate).
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 95,
      },
    },
  },
});
