/**
 * Loads Pyodide from the same origin (`./pyodide/`), only when a Python script is about to
 * run. Never imported from the main module graph as a static dependency, so it stays out of
 * the base download.
 */
import type { PythonRuntime } from '../script';

let loading: Promise<PythonRuntime> | null = null;

export function pythonIndexURL(): string {
  return new URL('pyodide/', document.baseURI).href;
}

export function ensurePython(): Promise<PythonRuntime> {
  loading ??= loadPython();
  return loading;
}

async function loadPython(): Promise<PythonRuntime> {
  const indexURL = pythonIndexURL();
  const href = new URL('pyodide.mjs', indexURL).href;
  const mod = (await import(/* @vite-ignore */ href)) as {
    loadPyodide: (opts: { indexURL: string }) => Promise<PythonRuntime>;
  };
  return mod.loadPyodide({ indexURL });
}
