import type { CadApi } from './host';

export const SCRIPT_NO_NETWORK = 'Network access is blocked in scripts.';

function blocked(): never {
  throw new Error(SCRIPT_NO_NETWORK);
}

/**
 * Runs user JavaScript with `cad` in scope. `fetch`, XHR, WebSocket and Worker are shadowed
 * so a script that calls them by mistake fails with a clear message. This is a guard against
 * accidents, not a security boundary: the script runs with the page's own access and can reach
 * the real `fetch` in other ways. Only run code you wrote or trust.
 */
export function runJavaScript(cad: CadApi, source: string): void {
  const fn = new Function(
    'cad',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'Worker',
    `"use strict";
const window = undefined;
const self = undefined;
const globalThis = undefined;
const document = undefined;
${source}`,
  );
  fn(cad, blocked, blocked, blocked, blocked);
}
