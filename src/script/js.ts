import type { CadApi } from './host';

export const SCRIPT_NO_NETWORK = 'Scripts have no network access.';

function blocked(): never {
  throw new Error(SCRIPT_NO_NETWORK);
}

/**
 * Runs user JavaScript with `cad` in scope. `fetch`, XHR, WebSocket and Worker are shadowed
 * so a script cannot talk to the network; the rest of the page is unchanged.
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
