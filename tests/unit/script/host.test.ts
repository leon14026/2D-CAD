import { describe, expect, it } from 'vitest';
import { CommandError, createSession, undo, undoLabel } from '../../../src/core/doc';
import { asList } from '../../../src/script/host';
import { applyJavaScript, SCRIPT_COMMAND, SCRIPT_LABEL } from '../../../src/script/run';
import { SCRIPT_NO_NETWORK } from '../../../src/script/js';
import { EXAMPLES, matchingExample, sourceOf } from '../../../src/script/examples';

describe('script host', () => {
  it('adds geometry through the command registry as one undo step', () => {
    const start = createSession();
    const { session, log } = applyJavaScript(
      start,
      `
        cad.print('hi', 1);
        cad.line(0, 0, 10, 0);
        cad.circle(0, 0, 5);
        cad.arc(0, 0, 5, 0, 90);
        cad.rect(0, 0, 4, 3);
        cad.title('From a script');
      `,
    );
    expect(log).toEqual(['hi 1']);
    expect(session.doc.entities.size).toBe(4);
    expect(session.doc.settings.title).toBe('From a script');
    expect(session.undoStack).toHaveLength(1);
    expect(session.undoStack[0]?.command).toBe(SCRIPT_COMMAND);
    expect(undoLabel(session)).toBe(SCRIPT_LABEL);
    const ids = [...session.doc.entities.values()].map((e) => e.geom.kind).sort();
    expect(ids).toEqual(['arc', 'circle', 'polyline', 'segment']);
    expect(undo(session).doc).toEqual(start.doc);
    expect(aCircleAt(session, 0, 0, 5)).toBe(true);
  });

  it('leaves the session untouched when the script throws', () => {
    const start = createSession();
    expect(() => applyJavaScript(start, `cad.line(0, 0, 0, 0)`)).toThrow(CommandError);
    expect(() => applyJavaScript(start, `cad.line(0, 0, 0, 0)`)).toThrow(/same point/);
    expect(start.doc.entities.size).toBe(0);
  });

  it('an empty script is a no-op', () => {
    const start = createSession();
    const { session } = applyJavaScript(start, '');
    expect(session).toBe(start);
  });

  it('blocks fetch, XHR, WebSocket and Worker', () => {
    const start = createSession();
    for (const src of [
      `fetch('https://example.com')`,
      `XMLHttpRequest('https://example.com')`,
      `WebSocket('wss://example.com')`,
      `Worker('https://example.com')`,
    ]) {
      expect(() => applyJavaScript(start, src)).toThrow(SCRIPT_NO_NETWORK);
      expect(start.doc.entities.size).toBe(0);
    }
  });

  it('layer() reuses a name and makes it current', () => {
    const { session } = applyJavaScript(
      createSession(),
      `
        const a = cad.layer('Holes');
        cad.circle(0, 0, 4);
        const b = cad.layer('Holes');
        cad.circle(10, 0, 4);
        if (a !== b) throw new Error('ids should match');
      `,
    );
    const holes = session.doc.layers.find((l) => l.name === 'Holes');
    expect(holes).toBeDefined();
    expect(session.doc.settings.currentLayer).toBe(holes!.id);
    expect([...session.doc.entities.values()].every((e) => e.layer === holes!.id)).toBe(true);
  });

  it('polar() is exact at quarter turns', () => {
    const { session } = applyJavaScript(
      createSession(),
      `
        const p = cad.polar(10, 20, 5, 90);
        cad.circle(p.x, p.y, 1);
      `,
    );
    const g = [...session.doc.entities.values()][0]!.geom;
    expect(g.kind).toBe('circle');
    if (g.kind === 'circle') expect(g.center).toEqual({ x: 10, y: 25 });
  });

  it('polyline accepts tuples, bulges and objects', () => {
    const { session } = applyJavaScript(
      createSession(),
      `
        cad.polyline([[0, 0], [20, 0, 1], [20, 8], [0, 8, 1]], true);
        cad.polyline([{ x: 0, y: 20 }, { x: 10, y: 20, bulge: 0 }], false);
      `,
    );
    const [slot, open] = [...session.doc.entities.values()].map((e) => e.geom);
    expect(slot?.kind).toBe('polyline');
    if (slot?.kind === 'polyline') {
      expect(slot.closed).toBe(true);
      expect(slot.vertices[1]?.bulge).toBe(1);
    }
    expect(open?.kind).toBe('polyline');
    if (open?.kind === 'polyline') expect(open.closed).toBe(false);
  });

  it('cad.block, insert, sheet and useSheet go through the registry', () => {
    const { session } = applyJavaScript(
      createSession(),
      `
        const a = cad.line(0, 0, 10, 0);
        cad.block('bar', [a], 0, 0);
        cad.insert('bar', 20, 0, 90, 2);
        cad.sheet('Layout', 'A3');
        cad.useSheet('Sheet 1');
      `,
    );
    expect(session.doc.blocks.map((b) => b.name)).toEqual(['bar']);
    expect(session.doc.inserts.size).toBe(2);
    expect(session.doc.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'Layout']);
    expect(session.doc.settings.currentSheet).toBe('Sheet 1');
  });

  it('cad.run calls a named command', () => {
    const { session } = applyJavaScript(createSession(), `cad.run('doc.setTitle', { title: 'Named' })`);
    expect(session.doc.settings.title).toBe('Named');
  });

  it('asList unwraps array-likes and toJs proxies', () => {
    expect(asList([1, 2], 'p')).toEqual([1, 2]);
    expect(asList({ 0: 1, 1: 2, length: 2 }, 'p')).toEqual([1, 2]);
    expect(asList({ toJs: () => [3, 4] }, 'p')).toEqual([3, 4]);
    expect(() => asList(5, 'points')).toThrow(CommandError);
    expect(() => applyJavaScript(createSession(), `cad.polyline([[0, 0]])`)).toThrow(/at least two/);
    expect(() => applyJavaScript(createSession(), `cad.polyline([[0], [1, 2]])`)).toThrow(/\[x, y\]/);
    expect(() => applyJavaScript(createSession(), `cad.layer('  ')`)).toThrow(/needs a name/);
    expect(() => applyJavaScript(createSession(), `cad.circle(0, 0, 'no')`)).toThrow(/finite number/);
  });

  it('print stringifies objects', () => {
    const { log } = applyJavaScript(createSession(), `cad.print(null, { x: 1 }, 'ok')`);
    expect(log).toEqual(['null {"x":1} ok']);
  });
});

describe('examples', () => {
  it('each JavaScript example produces a drawing', () => {
    for (const example of EXAMPLES) {
      const { session } = applyJavaScript(createSession(), example.js);
      expect(session.doc.entities.size).toBeGreaterThan(0);
      expect(session.doc.settings.title).toBe(example.label);
      expect(matchingExample(example.js, 'javascript')).toBe(example.id);
      expect(matchingExample(example.py, 'python')).toBe(example.id);
      expect(sourceOf(example, 'javascript')).toBe(example.js);
      expect(matchingExample('cad.circle(0,0,1)', 'javascript')).toBeNull();
    }
  });
});

function aCircleAt(session: ReturnType<typeof createSession>, x: number, y: number, r: number): boolean {
  return [...session.doc.entities.values()].some(
    (e) => e.geom.kind === 'circle' && e.geom.center.x === x && e.geom.center.y === y && e.geom.radius === r,
  );
}
