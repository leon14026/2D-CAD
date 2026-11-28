import { execSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
/** Pyodide files copied into dist/pyodide/ and served at /pyodide/ in `vite dev`. */
const PYODIDE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
] as const;

function pyodideRoot(): string {
  return fileURLToPath(new URL('./node_modules/pyodide/', import.meta.url));
}

function pyodideMime(name: string): string {
  if (name.endsWith('.mjs') || name.endsWith('.js')) return 'text/javascript';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function pyodideRuntime(): Plugin {
  let outDir = 'dist';
  return {
    name: 'archilite-pyodide',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      const root = pyodideRoot();
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0] ?? '';
        if (!raw.startsWith('/pyodide/')) return next();
        const name = decodeURIComponent(raw.slice('/pyodide/'.length));
        if (!(PYODIDE_FILES as readonly string[]).includes(name)) return next();
        const file = join(root, name);
        if (!existsSync(file)) return next();
        const stat = statSync(file);
        res.setHeader('Content-Type', pyodideMime(name));
        res.setHeader('Content-Length', String(stat.size));
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const dest = join(outDir, 'pyodide');
      mkdirSync(dest, { recursive: true });
      const root = pyodideRoot();
      for (const name of PYODIDE_FILES) {
        copyFileSync(join(root, name), join(dest, name));
      }
    },
  };
}

/** cadkit-wasm files copied into dist/cadkit/ and served at /cadkit/ in `vite dev`. */
const CADKIT_FILES = ['cadkit_wasm.js', 'cadkit_wasm_bg.wasm'] as const;

function cadkitRoot(): string {
  return fileURLToPath(new URL('./node_modules/cadkit-wasm/web/', import.meta.url));
}

function cadkitMime(name: string): string {
  if (name.endsWith('.js')) return 'text/javascript';
  if (name.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function cadkitRuntime(): Plugin {
  let outDir = 'dist';
  return {
    name: 'archilite-cadkit',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      const root = cadkitRoot();
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0] ?? '';
        if (!raw.startsWith('/cadkit/')) return next();
        const name = decodeURIComponent(raw.slice('/cadkit/'.length));
        if (!(CADKIT_FILES as readonly string[]).includes(name)) return next();
        const file = join(root, name);
        if (!existsSync(file)) return next();
        const stat = statSync(file);
        res.setHeader('Content-Type', cadkitMime(name));
        res.setHeader('Content-Length', String(stat.size));
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const dest = join(outDir, 'cadkit');
      mkdirSync(dest, { recursive: true });
      const root = cadkitRoot();
      for (const name of CADKIT_FILES) {
        copyFileSync(join(root, name), join(dest, name));
      }
    },
  };
}

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
  plugins: [brandHtml(), largeExample(), pyodideRuntime(), cadkitRuntime()],
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
