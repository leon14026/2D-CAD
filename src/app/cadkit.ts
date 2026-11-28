/**
 * Loads cadkit-wasm from the same origin (`./cadkit/`), only when a DWG is about
 * to be opened. Never imported from the main module graph as a static dependency,
 * so it stays out of the base download.
 */
import type { DwgDecoder } from '../io/dwg';

let loading: Promise<DwgDecoder> | null = null;

export function cadkitIndexURL(): string {
  return new URL('cadkit/', document.baseURI).href;
}

export function ensureCadkit(): Promise<DwgDecoder> {
  loading ??= loadCadkit().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function loadCadkit(): Promise<DwgDecoder> {
  const indexURL = cadkitIndexURL();
  const href = new URL('cadkit_wasm.js', indexURL).href;
  const wasmHref = new URL('cadkit_wasm_bg.wasm', indexURL).href;
  const mod = (await import(/* @vite-ignore */ href)) as {
    default: (opts?: { module_or_path: string }) => Promise<unknown>;
    read: DwgDecoder['read'];
  };
  await mod.default({ module_or_path: wasmHref });
  return { read: (bytes) => mod.read(bytes) };
}
