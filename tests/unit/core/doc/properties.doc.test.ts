/**
 * Phase 2 gate, as properties:
 * - save → load produces an identical document (10,000 random documents);
 * - 1,000 random edits, all undone, return exactly to the start; redo replays exactly;
 * - any damaged file is either loaded or rejected with FileFormatError, never a crash.
 */
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FileFormatError, loadDocument, redo, saveDocument, undo, type Doc } from '../../../../src/core/doc';
import { PROPERTY_PARAMS, PROPERTY_TIMEOUT } from '../arbitraries';
import { runRandomEdits } from './random-edits';

const seed = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe('save and load (10,000 random documents)', PROPERTY_TIMEOUT, () => {
  it('load(save(doc)) is identical to doc, and saving again gives the same text', () => {
    fc.assert(
      fc.property(seed, fc.integer({ min: 0, max: 40 }), (s, edits) => {
        const doc = runRandomEdits(s, edits).session.doc;
        const text = saveDocument(doc);
        const loaded = loadDocument(text);
        return isDeepStrictEqual(loaded, doc) && saveDocument(loaded) === text;
      }),
      PROPERTY_PARAMS,
    );
  });
});

describe('undo and redo after 1,000 random edits', PROPERTY_TIMEOUT, () => {
  const SEQUENCES = 20;

  it(`returns exactly to every earlier state (${SEQUENCES} sequences × 1,000 edits)`, () => {
    fc.assert(
      fc.property(seed, (s) => {
        const { session, snapshots } = runRandomEdits(s, 1000);
        expect(session.undoStack.length).toBe(1000);
        expect(Math.max(...snapshots.map((d) => d.entities.size))).toBeGreaterThan(50);
        let cur = session;
        for (let k = snapshots.length - 2; k >= 0; k--) {
          cur = undo(cur);
          if (!isDeepStrictEqual(cur.doc, snapshots[k])) throw new Error(`seed ${s}: undo to step ${k} differs`);
        }
        expect(cur.undoStack.length).toBe(0);
        for (let k = 1; k < snapshots.length; k++) {
          cur = redo(cur);
          if (!isDeepStrictEqual(cur.doc, snapshots[k])) throw new Error(`seed ${s}: redo to step ${k} differs`);
        }
        return cur.redoStack.length === 0;
      }),
      { numRuns: SEQUENCES, seed: PROPERTY_PARAMS.seed },
    );
  });

  it('the random edits exercise every command, including ones that fail', () => {
    const { session, failures } = runRandomEdits(7, 1000);
    const used = new Set(session.undoStack.map((t) => t.command));
    expect([...used].sort()).toEqual([
      'doc.setTitle',
      'doc.setUnits',
      'entity.add',
      'entity.copy',
      'entity.delete',
      'entity.setProps',
      'entity.transform',
      'layer.add',
      'layer.delete',
      'layer.setCurrent',
      'layer.update',
    ]);
    expect(failures).toBeGreaterThan(0);
  });
});

// ---------- damaged files ----------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Every location in a JSON tree, as a list of keys from the root. */
function paths(v: Json, here: (string | number)[] = []): (string | number)[][] {
  const out: (string | number)[][] = [here];
  if (Array.isArray(v)) v.forEach((c, i) => out.push(...paths(c, [...here, i])));
  else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) out.push(...paths(c, [...here, k]));
  return out;
}

function mutate(root: Json, path: (string | number)[], action: number, value: Json): Json {
  if (path.length === 0) return value;
  const copy = structuredClone(root) as { [k: string]: Json } & Json[];
  let parent: any = copy;
  for (const key of path.slice(0, -1)) parent = parent[key];
  const last = path[path.length - 1] as string & number;
  if (action === 0) parent[last] = value; // replace
  else if (Array.isArray(parent)) parent.splice(last, 1); // remove a list item
  else delete parent[last]; // remove a field
  return copy;
}

const outcome = { accepted: 0, rejected: 0 };

function loadsOrRejectsCleanly(text: string): boolean {
  let doc: Doc;
  try {
    doc = loadDocument(text);
  } catch (err) {
    if (err instanceof FileFormatError) {
      outcome.rejected += 1;
      return true;
    }
    throw err;
  }
  outcome.accepted += 1;
  // Anything accepted must itself round-trip.
  return isDeepStrictEqual(loadDocument(saveDocument(doc)), doc);
}

describe('damaged files (10,000 cases each)', PROPERTY_TIMEOUT, () => {
  const base = JSON.parse(saveDocument(runRandomEdits(3, 25).session.doc)) as Json;
  const all = paths(base);

  it('one field replaced or removed: loaded cleanly or refused with FileFormatError', () => {
    outcome.accepted = outcome.rejected = 0;
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 0, max: 1 }), fc.jsonValue(), (n, action, value) =>
        loadsOrRejectsCleanly(JSON.stringify(mutate(base, all[n % all.length]!, action, value as Json))),
      ),
      PROPERTY_PARAMS,
    );
    // The mutations must land on both sides of the line, or the test proves nothing.
    expect(outcome.rejected).toBeGreaterThan(1000);
    expect(outcome.accepted).toBeGreaterThan(100);
  });

  it('text cut short or with a character changed: never a crash', () => {
    const text = JSON.stringify(base, null, 2);
    fc.assert(
      fc.property(fc.nat({ max: text.length }), fc.string({ minLength: 0, maxLength: 1 }), (at, ch) =>
        loadsOrRejectsCleanly(text.slice(0, at)) && loadsOrRejectsCleanly(text.slice(0, at) + ch + text.slice(at + 1)),
      ),
      PROPERTY_PARAMS,
    );
  });
});
