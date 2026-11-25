import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  Draft,
  entitiesInDrawOrder,
  findLayer,
  findLayerByName,
  LINETYPES,
  LINEWEIGHTS_MM,
  newDocument,
  resolveStyle,
  type Change,
  type Doc,
  type Entity,
} from '../../../../src/core/doc';
import { segment, vec } from '../../../../src/core/geom';

const line = segment(vec(0, 0), vec(1, 0));
const entity = (id: number, z = id, layer = 1): Entity => ({
  id,
  layer,
  z,
  color: 'byLayer',
  linetype: 'byLayer',
  lineweight: 'byLayer',
  geom: line,
});
const withEntities = (doc: Doc, ...es: Entity[]): Doc => ({ ...doc, entities: new Map(es.map((e) => [e.id, e])) });

describe('new document', () => {
  it('has one default layer and sensible settings', () => {
    const d = newDocument();
    expect(d.settings).toEqual({ title: 'Untitled', units: 'mm', currentLayer: 1 });
    expect(d.nextId).toBe(2);
    expect(d.layers).toEqual([
      { id: 1, name: 'Default', color: '#1f2a33', linetype: 'continuous', lineweight: 0.25, visible: true, locked: false },
    ]);
    expect(d.entities.size).toBe(0);
  });

  it('takes a title and units', () => {
    expect(newDocument({ title: 'Plate', units: 'in' }).settings).toEqual({ title: 'Plate', units: 'in', currentLayer: 1 });
  });
});

describe('lookups and draw order', () => {
  const d = newDocument();
  it('finds layers by id and by name ignoring case and spaces', () => {
    expect(findLayer(d, 1)?.name).toBe('Default');
    expect(findLayer(d, 99)).toBeUndefined();
    expect(findLayerByName(d, '  default ')?.id).toBe(1);
    expect(findLayerByName(d, 'other')).toBeUndefined();
  });

  it('sorts by z, then by id', () => {
    const doc = withEntities(d, entity(5, 1), entity(3, 2), entity(4, 1));
    expect(entitiesInDrawOrder(doc).map((e) => e.id)).toEqual([4, 5, 3]);
  });

  it('resolves byLayer styles and keeps overrides', () => {
    const doc = withEntities(d, entity(2), { ...entity(3), color: '#ff0000', lineweight: 0.7 });
    expect(resolveStyle(doc, entity(2))).toEqual({ color: '#1f2a33', linetype: 'continuous', lineweight: 0.25 });
    expect(resolveStyle(doc, { ...entity(3), color: '#ff0000', lineweight: 0.7, linetype: 'dashed' })).toEqual({
      color: '#ff0000',
      linetype: 'dashed',
      lineweight: 0.7,
    });
    expect(() => resolveStyle(doc, entity(9, 9, 42))).toThrow(/missing layer 42/);
  });
});

describe('style tables', () => {
  it('linetypes follow ISO 128-20 proportions', () => {
    expect(LINETYPES.continuous.pattern).toEqual([]);
    expect(LINETYPES.dashed.pattern).toEqual([12, 3]);
    expect(LINETYPES['dash-dot'].pattern).toEqual([24, 3, 0.5, 3]);
    expect(Object.values(LINETYPES).every((t) => t.pattern.length % 2 === 0)).toBe(true);
  });

  it('lineweights are the ISO series, ascending', () => {
    expect([...LINEWEIGHTS_MM]).toEqual([0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2]);
  });
});

describe('applyChanges', () => {
  const base = withEntities(newDocument(), entity(2));
  const changes: Change[] = [
    { kind: 'entity', id: 3, before: null, after: entity(3) },
    { kind: 'entity', id: 2, before: entity(2), after: null },
    { kind: 'layers', before: base.layers, after: [...base.layers, { ...base.layers[0]!, id: 4, name: 'B' }] },
    { kind: 'settings', before: base.settings, after: { ...base.settings, title: 'T' } },
    { kind: 'nextId', before: 2, after: 5 },
  ];

  it('forwards then backwards restores the original exactly', () => {
    const fwd = applyChanges(base, changes, 'forward');
    expect([...fwd.entities.keys()]).toEqual([3]);
    expect(fwd.layers.map((l) => l.name)).toEqual(['Default', 'B']);
    expect(fwd.settings.title).toBe('T');
    expect(fwd.nextId).toBe(5);
    expect(applyChanges(fwd, changes, 'backward')).toEqual(base);
  });

  it('keeps the entity map when no entity changes', () => {
    const d = applyChanges(base, [{ kind: 'nextId', before: 2, after: 3 }], 'forward');
    expect(d.entities).toBe(base.entities);
  });
});

describe('Draft', () => {
  const base: Doc = { ...withEntities(newDocument(), entity(2), entity(3)), nextId: 4 };

  it('sees its own edits and reports only real differences', () => {
    const d = new Draft(base);
    expect(d.entity(2)).toBe(base.entities.get(2));
    d.deleteEntity(2);
    expect(d.entity(2)).toBeUndefined();
    const id = d.allocateId();
    d.putEntity(entity(id));
    expect(id).toBe(4);
    expect([...d.entities()].map((e) => e.id)).toEqual([3, 4]);
    d.putEntity(base.entities.get(3)!); // unchanged object: no change recorded
    const kinds = d.changes().map((c) => (c.kind === 'entity' ? `${c.kind}:${c.id}` : c.kind));
    expect(kinds).toEqual(['entity:2', `entity:${id}`, 'nextId']);
  });

  it('an entity added and deleted in one draft leaves no entity change', () => {
    const d = new Draft(base);
    const id = d.allocateId();
    d.putEntity(entity(id));
    d.deleteEntity(id);
    expect(d.changes()).toEqual([{ kind: 'nextId', before: base.nextId, after: base.nextId + 1 }]);
  });

  it('records layer and settings replacements', () => {
    const d = new Draft(base);
    d.setLayers([...d.layers]);
    d.setSettings({ ...d.settings });
    expect(d.changes().map((c) => c.kind)).toEqual(['layers', 'settings']);
    expect(d.layer(1)?.name).toBe('Default');
    expect(d.layer(7)).toBeUndefined();
  });
});
