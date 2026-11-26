import type { CadApi } from './host';

/**
 * The bits of Pyodide the Python runner uses. The loader lives in the app so this module
 * never imports the package (that would pull the runtime into the base download).
 */
export interface PythonRuntime {
  globals: { set(name: string, value: unknown): void };
  runPythonAsync(code: string): Promise<unknown>;
  setStdout?: (opts: { batched: (text: string) => void }) => void;
}

/**
 * Installed before the user's Python. Patches the interpreter's view of `js.fetch` and
 * common HTTP modules; the page's real `fetch` stays intact so Pyodide can load its files.
 */
export const PYTHON_PRELUDE = `
def _archilite_no_network(*args, **kwargs):
    raise RuntimeError('Scripts have no network access.')

import sys, types, js
js.fetch = _archilite_no_network
try:
    js.XMLHttpRequest = None
    js.WebSocket = None
except Exception:
    pass

class _NoNet(types.ModuleType):
    def __getattr__(self, name):
        raise RuntimeError('Scripts have no network access.')
    def __call__(self, *args, **kwargs):
        raise RuntimeError('Scripts have no network access.')

for _name in ('urllib', 'urllib.request', 'urllib.parse', 'urllib.error', 'http', 'http.client', 'requests', 'aiohttp'):
    sys.modules[_name] = _NoNet(_name)
`;

export async function runPython(cad: CadApi, source: string, py: PythonRuntime, log: string[]): Promise<void> {
  py.globals.set('cad', cad);
  py.setStdout?.({
    batched: (text) => {
      const line = text.endsWith('\n') ? text.slice(0, -1) : text;
      if (line.length > 0) log.push(line);
    },
  });
  await py.runPythonAsync(PYTHON_PRELUDE);
  await py.runPythonAsync(source);
}
