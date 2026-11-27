import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSession, saveDocument } from '../../../src/core/doc';
import { applyJavaScript, applyPython } from '../../../src/script/run';
import { EXAMPLES, sourceOf } from '../../../src/script/examples';
import { SCRIPT_NO_NETWORK } from '../../../src/script/js';
import type { PythonRuntime } from '../../../src/script/python';

const PYODIDE_TIMEOUT = 120_000;

describe('JavaScript and Python identity', () => {
  let py: PythonRuntime;

  beforeAll(async () => {
    py = (await loadPyodide()) as unknown as PythonRuntime;
  }, PYODIDE_TIMEOUT);

  it(
    'the same example in both languages writes an identical document',
    async () => {
      for (const example of EXAMPLES) {
        const js = applyJavaScript(createSession(), sourceOf(example, 'javascript'));
        const python = await applyPython(createSession(), sourceOf(example, 'python'), py);
        expect(saveDocument(python.session.doc), example.id).toBe(saveDocument(js.session.doc));
        expect(python.session.doc.entities.size).toBeGreaterThan(0);
      }
    },
    PYODIDE_TIMEOUT,
  );

  it(
    'Python cannot fetch or import urllib',
    async () => {
      const start = createSession();
      await expect(applyPython(start, 'from js import fetch\nfetch("https://example.com")', py)).rejects.toThrow(
        /blocked in scripts/,
      );
      await expect(
        applyPython(start, 'import urllib.request\nurllib.request.urlopen("https://example.com")', py),
      ).rejects.toThrow(/blocked in scripts/);
      expect(start.doc.entities.size).toBe(0);
      expect(SCRIPT_NO_NETWORK).toMatch(/network/i);
    },
    PYODIDE_TIMEOUT,
  );

  it(
    'a Python run, failed or not, leaves the page fetch and later runs working',
    async () => {
      const realFetch = globalThis.fetch;
      await applyPython(createSession(), 'cad.line(0, 0, 10, 0)', py);
      expect(globalThis.fetch).toBe(realFetch);
      await expect(applyPython(createSession(), 'import js\njs.fetch("https://example.com")', py)).rejects.toThrow(
        /blocked in scripts/,
      );
      await expect(applyPython(createSession(), 'raise ValueError("boom")', py)).rejects.toThrow(/boom/);
      expect(globalThis.fetch).toBe(realFetch);
      // The guard is gone again: the real js module is back for the next script.
      const after = await applyPython(createSession(), 'import js\ncad.line(0, 0, 5, 0)\ncad.print(js.Math.max(1, 2))', py);
      expect(after.session.doc.entities.size).toBe(1);
      expect(after.log).toEqual(['2']);
    },
    PYODIDE_TIMEOUT,
  );
});
