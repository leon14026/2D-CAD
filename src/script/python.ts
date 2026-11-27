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

const BLOCKED_MESSAGE = 'Network access is blocked in scripts.';

/**
 * Installed before the user's Python and removed after it (`PYTHON_POSTLUDE`). While a script
 * runs, `import js` returns a guard that refuses `fetch`, XHR, sockets, workers and the page's
 * own objects, and the common HTTP modules refuse every call. The page's real `fetch` is never
 * replaced, so the rest of the app (and Pyodide itself) keeps working after a script has run.
 * This is a best-effort guard against mistakes, not a security boundary: scripts run with the
 * page's own access and should only be code the user wrote or trusts.
 */
export const PYTHON_PRELUDE = `
import sys, types
import js as _archilite_real_js

_ARCHILITE_BLOCKED_JS = frozenset((
    'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker', 'EventSource',
    'importScripts', 'navigator', 'window', 'self', 'globalThis', 'document', 'top', 'parent',
    'frames', 'location',
))
_ARCHILITE_BLOCKED_MODULES = (
    'urllib', 'urllib.request', 'urllib.parse', 'urllib.error', 'http', 'http.client',
    'requests', 'aiohttp', 'pyodide.http', 'socket',
)

class _ArchiliteGuardedJs(types.ModuleType):
    def __getattr__(self, name):
        if name in _ARCHILITE_BLOCKED_JS:
            raise RuntimeError('${BLOCKED_MESSAGE}')
        return getattr(_archilite_real_js, name)

class _ArchiliteNoNet(types.ModuleType):
    def __getattr__(self, name):
        raise RuntimeError('${BLOCKED_MESSAGE}')
    def __call__(self, *args, **kwargs):
        raise RuntimeError('${BLOCKED_MESSAGE}')

_archilite_saved = {}
for _name in ('js',) + _ARCHILITE_BLOCKED_MODULES:
    _archilite_saved[_name] = sys.modules.get(_name)
sys.modules['js'] = _ArchiliteGuardedJs('js')
for _name in _ARCHILITE_BLOCKED_MODULES:
    sys.modules[_name] = _ArchiliteNoNet(_name)
`;

/** Puts back the modules `PYTHON_PRELUDE` replaced, whether or not the script succeeded. */
export const PYTHON_POSTLUDE = `
import sys
for _name, _module in _archilite_saved.items():
    if _module is None:
        sys.modules.pop(_name, None)
    else:
        sys.modules[_name] = _module
for _name in ('_archilite_saved', '_archilite_real_js', '_ARCHILITE_BLOCKED_JS', '_ARCHILITE_BLOCKED_MODULES', '_ArchiliteGuardedJs', '_ArchiliteNoNet', '_name', '_module'):
    globals().pop(_name, None)
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
  try {
    await py.runPythonAsync(source);
  } finally {
    await py.runPythonAsync(PYTHON_POSTLUDE);
  }
}
