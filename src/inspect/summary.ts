/**
 * What the inspector shows about a drawing, computed without the DOM so it can be unit-tested.
 */
import {
  shapeBounds,
  shapeLength,
  polylineArea,
  unionBounds,
  type Bounds,
  type Shape,
} from '../core/geom';
import { compareDrawOrder, entitiesInDrawOrder, insertBounds, type Doc } from '../core/doc';
import { formatCoordinate } from '../ui/format';

export interface EntityRow {
  readonly id: number;
  readonly layer: string;
  readonly kind: string;
  /** Plain-language size, e.g. "Ø 8.000" or "length 12.000". */
  readonly size: string;
  readonly length: number;
  /** Signed area for closed polylines and circles, otherwise null. */
  readonly area: number | null;
}

export interface LayerRow {
  readonly name: string;
  readonly color: string;
  readonly linetype: string;
  readonly lineweight: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly entities: number;
}

export interface Summary {
  readonly title: string;
  readonly units: string;
  readonly entityCount: number;
  readonly kinds: Readonly<Record<string, number>>;
  readonly extents: Bounds | null;
  readonly layers: readonly LayerRow[];
  readonly rows: readonly EntityRow[];
}

const f3 = (n: number) => formatCoordinate(n, 3);

function describeShape(s: Shape): { kind: string; size: string; area: number | null } {
  switch (s.kind) {
    case 'segment':
      return { kind: 'Line', size: `length ${f3(shapeLength(s))}`, area: null };
    case 'circle':
      return { kind: 'Circle', size: `Ø ${f3(2 * s.radius)}`, area: Math.PI * s.radius * s.radius };
    case 'arc':
      return {
        kind: 'Arc',
        size: `R ${f3(s.radius)}, ${f3((Math.abs(s.sweep) * 180) / Math.PI)}° ${s.sweep > 0 ? 'anticlockwise' : 'clockwise'}`,
        area: null,
      };
    case 'polyline':
      return {
        kind: s.closed ? 'Closed polyline' : 'Polyline',
        size: `${s.vertices.length} vertices`,
        area: s.closed ? polylineArea(s) : null,
      };
  }
}

export function summarize(doc: Doc): Summary {
  const layerNames = new Map(doc.layers.map((l) => [l.id, l.name]));
  const counts = new Map<number, number>();
  const kinds: Record<string, number> = {};
  let extents: Bounds | null = null;
  const rows: EntityRow[] = entitiesInDrawOrder(doc).map((e) => {
    counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
    const d = describeShape(e.geom);
    kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    const b = shapeBounds(e.geom);
    extents = extents ? unionBounds(extents, b) : b;
    return {
      id: e.id,
      layer: layerNames.get(e.layer) ?? '?',
      kind: d.kind,
      size: d.size,
      length: shapeLength(e.geom),
      area: d.area,
    };
  });
  for (const ins of [...doc.inserts.values()].sort(compareDrawOrder)) {
    counts.set(ins.layer, (counts.get(ins.layer) ?? 0) + 1);
    kinds['Block insert'] = (kinds['Block insert'] ?? 0) + 1;
    const b = insertBounds(doc, ins);
    if (b) extents = extents ? unionBounds(extents, b) : b;
    rows.push({
      id: ins.id,
      layer: layerNames.get(ins.layer) ?? '?',
      kind: 'Block insert',
      size: ins.block,
      length: 0,
      area: null,
    });
  }
  return {
    title: doc.settings.title,
    units: doc.settings.units,
    entityCount: rows.length,
    kinds,
    extents,
    layers: doc.layers.map((l) => ({
      name: l.name,
      color: l.color,
      linetype: l.linetype,
      lineweight: l.lineweight,
      visible: l.visible,
      locked: l.locked,
      entities: counts.get(l.id) ?? 0,
    })),
    rows,
  };
}
