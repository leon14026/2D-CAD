import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  CommandError,
  COMMANDS,
  createSession,
  execute,
  executeUnchecked,
  isCommandId,
  newDocument,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type CommandId,
  type ParamsOf,
  type ResultOf,
  type Session,
} from '../../../../src/core/doc';
import { circle, degToRad, polyline, segment, vec, type Segment } from '../../../../src/core/geom';
import { expectPoint } from '../helpers';

const line = segment(vec(0, 0), vec(10, 0));

/** A tiny harness: runs commands against one session and exposes it. */
function harness(start: Session = createSession()) {
  const h = {
    s: start,
    run<K extends CommandId>(id: K, params: ParamsOf<K>): ResultOf<K> {
      const r = execute(h.s, id, params);
      h.s = r.session;
      return r.result;
    },
    fails(id: string, params: unknown, message: RegExp) {
      const before = h.s;
      expect(() => executeUnchecked(h.s, id, params)).toThrow(CommandError);
      expect(() => executeUnchecked(h.s, id, params)).toThrow(message);
      expect(h.s).toBe(before);
    },
  };
  return h;
}

describe('entity.add', () => {
  it('adds to the current layer with byLayer styles and z = id', () => {
    const h = harness();
    expect(h.run('entity.add', { geom: line })).toEqual({ id: 2 });
    expect(h.s.doc.entities.get(2)).toEqual({
      id: 2,
      layer: 1,
      z: 2,
      color: 'byLayer',
      linetype: 'byLayer',
      lineweight: 'byLayer',
      geom: line,
    });
    expect(h.s.doc.nextId).toBe(3);
  });

  it('takes a layer and style overrides', () => {
    const h = harness();
    const layer = h.run('layer.add', { name: 'Holes' }).id;
    const { id } = h.run('entity.add', { geom: line, layer, color: '#ff0000', linetype: 'dashed', lineweight: 0.5 });
    expect(h.s.doc.entities.get(id)).toMatchObject({ layer, color: '#ff0000', linetype: 'dashed', lineweight: 0.5 });
  });

  it('refuses bad parameters, missing and locked layers', () => {
    const h = harness();
    h.fails('entity.add', {}, /Invalid parameters for entity.add: geom: is missing/);
    h.fails('entity.add', { geom: line, colour: '#ff0000' }, /colour: is not a recognised field/);
    h.fails('entity.add', { geom: { kind: 'circle', center: { x: 0, y: 0 }, radius: 0 } }, /geom.radius/);
    h.fails('entity.add', { geom: line, layer: 9 }, /no layer with id 9/);
    h.run('layer.update', { id: 1, locked: true });
    h.fails('entity.add', { geom: line }, /Layer "Default" is locked/);
  });
});

describe('entity.delete, entity.transform, entity.copy', () => {
  function withTwo() {
    const h = harness();
    const a = h.run('entity.add', { geom: line }).id;
    const b = h.run('entity.add', { geom: circle(vec(5, 5), 2) }).id;
    return { h, a, b };
  }

  it('deletes, ignoring repeated ids', () => {
    const { h, a, b } = withTwo();
    expect(h.run('entity.delete', { ids: [a, a] })).toEqual({ deleted: 1 });
    expect([...h.s.doc.entities.keys()]).toEqual([b]);
  });

  it('refuses unknown ids, empty lists and locked layers, changing nothing', () => {
    const { h, a } = withTwo();
    h.fails('entity.delete', { ids: [a, 99] }, /no entity with id 99/);
    h.fails('entity.delete', { ids: [] }, /at least one id/);
    h.fails('entity.delete', { ids: [0] }, /ids\[0\]/);
    h.run('layer.update', { id: 1, locked: true });
    h.fails('entity.delete', { ids: [a] }, /locked/);
  });

  it('transforms geometry in place', () => {
    const { h, a, b } = withTwo();
    expect(h.run('entity.transform', { ids: [a, b], transform: { kind: 'rotate', center: vec(0, 0), angle: degToRad(90) } })).toEqual({
      changed: 2,
    });
    const s = h.s.doc.entities.get(a)?.geom as Segment;
    expect(s.end).toEqual({ x: 0, y: 10 });
    expectPoint((h.s.doc.entities.get(b)?.geom as ReturnType<typeof circle>).center, vec(-5, 5));
  });

  it('reports geometry that becomes invalid as a command error', () => {
    const h = harness();
    const { id } = h.run('entity.add', { geom: circle(vec(0, 0), 0.1) });
    h.fails('entity.transform', { ids: [id], transform: { kind: 'scale', center: vec(0, 0), factor: 5e-324 } }, /Transform failed: radius/);
  });

  it('copies with new ids and keeps the originals', () => {
    const { h, a, b } = withTwo();
    const { ids } = h.run('entity.copy', { ids: [b, a], transform: { kind: 'translate', dx: 100, dy: 0 } });
    expect(ids).toEqual([4, 5]);
    expect(h.s.doc.entities.size).toBe(4);
    expect(h.s.doc.entities.get(4)).toMatchObject({ z: 4, geom: circle(vec(105, 5), 2) });
    expect((h.s.doc.entities.get(a)?.geom as Segment).start).toEqual({ x: 0, y: 0 });
  });
});

describe('entity.setProps', () => {
  it('changes layer and style, skipping entities already set', () => {
    const h = harness();
    const a = h.run('entity.add', { geom: line }).id;
    const b = h.run('entity.add', { geom: line, color: '#00ff00' }).id;
    const layer = h.run('layer.add', { name: 'Two' }).id;
    expect(h.run('entity.setProps', { ids: [a, b], color: '#00ff00' })).toEqual({ changed: 1 });
    expect(h.run('entity.setProps', { ids: [a, b], layer })).toEqual({ changed: 2 });
    expect(h.s.doc.entities.get(a)).toMatchObject({ layer, color: '#00ff00' });
  });

  it('a change that alters nothing adds no undo step', () => {
    const h = harness();
    const a = h.run('entity.add', { geom: line }).id;
    const before = h.s;
    expect(h.run('entity.setProps', { ids: [a], linetype: 'byLayer', lineweight: 'byLayer' })).toEqual({ changed: 0 });
    expect(h.s).toBe(before);
  });

  it('needs at least one property and an unlocked target layer', () => {
    const h = harness();
    const a = h.run('entity.add', { geom: line }).id;
    h.fails('entity.setProps', { ids: [a] }, /at least one of layer/);
    const locked = h.run('layer.add', { name: 'Locked' }).id;
    h.run('layer.update', { id: locked, locked: true });
    h.fails('entity.setProps', { ids: [a], layer: locked }, /"Locked" is locked/);
  });
});

describe('layer commands', () => {
  it('adds layers with defaults or given styles', () => {
    const h = harness();
    expect(h.run('layer.add', { name: '  Dims ' })).toEqual({ id: 2 });
    h.run('layer.add', { name: 'Hidden', color: '#336699', linetype: 'dashed', lineweight: 0.18 });
    expect(h.s.doc.layers.map((l) => [l.name, l.color, l.linetype, l.lineweight])).toEqual([
      ['Default', '#1f2a33', 'continuous', 0.25],
      ['Dims', '#1f2a33', 'continuous', 0.25],
      ['Hidden', '#336699', 'dashed', 0.18],
    ]);
  });

  it('keeps names unique ignoring case', () => {
    const h = harness();
    h.fails('layer.add', { name: 'DEFAULT' }, /"Default" already exists/);
    const id = h.run('layer.add', { name: 'A' }).id;
    h.fails('layer.update', { id, name: 'default' }, /already exists/);
    h.run('layer.update', { id, name: 'a' }); // renaming to itself in another case is fine
    expect(h.s.doc.layers[1]?.name).toBe('a');
  });

  it('updates properties; an update that changes nothing adds no undo step', () => {
    const h = harness();
    h.run('layer.update', { id: 1, visible: false, locked: true, color: '#000000', linetype: 'dotted', lineweight: 1 });
    expect(h.s.doc.layers[0]).toMatchObject({ visible: false, locked: true, color: '#000000', linetype: 'dotted', lineweight: 1 });
    const before = h.s;
    h.run('layer.update', { id: 1, visible: false });
    expect(h.s).toBe(before);
    h.fails('layer.update', { id: 1 }, /at least one layer property/);
    h.fails('layer.update', { id: 7, visible: true }, /no layer with id 7/);
  });

  it('deletes only empty, non-current layers and never the last one', () => {
    const h = harness();
    h.fails('layer.delete', { id: 1 }, /at least one layer/);
    const b = h.run('layer.add', { name: 'B' }).id;
    h.fails('layer.delete', { id: 1 }, /current layer/);
    h.run('entity.add', { geom: line, layer: b });
    h.fails('layer.delete', { id: b }, /not empty/);
    const c = h.run('layer.add', { name: 'C' }).id;
    h.run('layer.delete', { id: c });
    expect(h.s.doc.layers.map((l) => l.name)).toEqual(['Default', 'B']);
    h.fails('layer.delete', { id: c }, /no layer/);
  });

  it('sets the current layer', () => {
    const h = harness();
    const b = h.run('layer.add', { name: 'B' }).id;
    h.run('layer.setCurrent', { id: b });
    expect(h.s.doc.settings.currentLayer).toBe(b);
    const before = h.s;
    h.run('layer.setCurrent', { id: b });
    expect(h.s).toBe(before);
    h.fails('layer.setCurrent', { id: 50 }, /no layer/);
    h.fails('layer.setCurrent', { id: 'x' }, /id: must be a finite number/);
  });
});

describe('document commands', () => {
  it('renames the drawing', () => {
    const h = harness();
    h.run('doc.setTitle', { title: ' Bracket ' });
    expect(h.s.doc.settings.title).toBe('Bracket');
    const before = h.s;
    h.run('doc.setTitle', { title: 'Bracket' });
    expect(h.s).toBe(before);
    h.fails('doc.setTitle', { title: '' }, /must not be empty/);
  });

  it('converting units keeps real sizes, even on locked layers', () => {
    const h = harness();
    const { id } = h.run('entity.add', { geom: segment(vec(0, 0), vec(25.4, 50.8)) });
    h.run('layer.update', { id: 1, locked: true });
    h.run('doc.setUnits', { units: 'in', convert: true });
    expect(h.s.doc.settings.units).toBe('in');
    expectPoint((h.s.doc.entities.get(id)?.geom as Segment).end, vec(1, 2));
  });

  it('relabelling units keeps the numbers', () => {
    const h = harness();
    const { id } = h.run('entity.add', { geom: polyline([{ x: 0, y: 0 }, { x: 3, y: 4 }]) });
    h.run('doc.setUnits', { units: 'ft', convert: false });
    expect(h.s.doc.entities.get(id)?.geom).toEqual(polyline([{ x: 0, y: 0 }, { x: 3, y: 4 }]));
    const before = h.s;
    h.run('doc.setUnits', { units: 'ft', convert: true });
    expect(h.s).toBe(before);
    h.fails('doc.setUnits', { units: 'yd', convert: true }, /units: must be one of/);
  });
});

describe('registry and history', () => {
  it('knows its commands', () => {
    expect(isCommandId('entity.add')).toBe(true);
    expect(isCommandId('toString')).toBe(false);
    expect(Object.values(COMMANDS).every((c) => c.label.length > 0)).toBe(true);
    for (const [id, def] of Object.entries(COMMANDS)) expect(def.id).toBe(id);
    harness().fails('entity.teleport', {}, /no command called "entity.teleport"/);
  });

  it('undo and redo walk the history with labels', () => {
    const h = harness();
    expect(canUndo(h.s)).toBe(false);
    expect(undoLabel(h.s)).toBeNull();
    expect(undo(h.s)).toBe(h.s);
    expect(redo(h.s)).toBe(h.s);
    const empty = h.s.doc;
    h.run('entity.add', { geom: line });
    const one = h.s.doc;
    h.run('entity.transform', { ids: [2], transform: { kind: 'translate', dx: 1, dy: 1 } });
    expect(undoLabel(h.s)).toBe('Transform');
    h.s = undo(h.s);
    expect(h.s.doc).toEqual(one);
    expect(redoLabel(h.s)).toBe('Transform');
    expect(canRedo(h.s)).toBe(true);
    h.s = undo(h.s);
    expect(h.s.doc).toEqual(empty);
    h.s = redo(h.s);
    expect(h.s.doc).toEqual(one);
    h.run('doc.setTitle', { title: 'New' });
    expect(canRedo(h.s)).toBe(false); // a new edit discards the redo stack
  });

  it('keeps at most `limit` undo steps', () => {
    const h = harness(createSession(newDocument(), 3));
    for (let i = 0; i < 5; i++) h.run('entity.add', { geom: line });
    expect(h.s.undoStack.length).toBe(3);
    while (canUndo(h.s)) h.s = undo(h.s);
    expect([...h.s.doc.entities.keys()]).toEqual([2, 3]);
  });

  it('rejects a bad undo limit', () => {
    expect(() => createSession(newDocument(), 0)).toThrow(RangeError);
    expect(() => createSession(newDocument(), 1.5)).toThrow(RangeError);
  });
});
