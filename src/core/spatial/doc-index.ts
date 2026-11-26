/**
 * Spatial index over a document's entities. Entity bounds are cached per geometry object
 * (geometry is immutable), so after an edit only changed shapes are measured again.
 */
import { shapeBounds, unionBounds, type Bounds, type Shape } from '../geom';
import { findLayer, insertBounds, onCurrentSheet, resolveNotes, type Doc, type Entity, type Insert, type Note } from '../doc';
import { PackedRTree } from './rtree';

const boundsCache = new WeakMap<Shape, Bounds>();

export function entityBounds(e: Entity): Bounds {
  let b = boundsCache.get(e.geom);
  if (!b) {
    b = shapeBounds(e.geom);
    boundsCache.set(e.geom, b);
  }
  return b;
}

/** True if the entity's (or note's) layer is shown. */
export function isVisible(doc: Doc, e: { readonly layer: number }): boolean {
  return findLayer(doc, e.layer)?.visible === true;
}

export class DocIndex {
  private constructor(
    readonly doc: Doc,
    private readonly tree: PackedRTree,
  ) {}

  private static readonly cache = new WeakMap<Doc, DocIndex>();

  /** The index for a document, built once per document object. */
  static of(doc: Doc): DocIndex {
    let index = DocIndex.cache.get(doc);
    if (!index) {
      const items = [...doc.entities.values()].filter((e) => onCurrentSheet(doc, e)).map((e) => ({ id: e.id, box: entityBounds(e) }));
      for (const ins of doc.inserts.values()) {
        if (!onCurrentSheet(doc, ins)) continue;
        const box = insertBounds(doc, ins) ?? { minX: ins.at.x, minY: ins.at.y, maxX: ins.at.x, maxY: ins.at.y };
        items.push({ id: ins.id, box });
      }
      const resolved = resolveNotes(doc);
      for (const n of doc.notes.values()) {
        if (!onCurrentSheet(doc, n)) continue;
        const r = resolved.get(n.id);
        if (r?.ok) items.push({ id: n.id, box: r.r.bounds });
      }
      index = new DocIndex(doc, PackedRTree.build(items));
      DocIndex.cache.set(doc, index);
    }
    return index;
  }

  /** Bounds of every entity, on any layer, or null if there are none. */
  get bounds(): Bounds | null {
    return this.tree.bounds;
  }

  /** Largest absolute coordinate of any entity bounds (0 if empty); scales query tolerances. */
  get magnitude(): number {
    const b = this.tree.bounds;
    return b ? Math.max(Math.abs(b.minX), Math.abs(b.minY), Math.abs(b.maxX), Math.abs(b.maxY)) : 0;
  }

  /** Entities whose bounds touch `box`, on any layer. */
  query(box: Bounds): Entity[] {
    const out: Entity[] = [];
    for (const id of this.tree.search(box)) {
      const e = this.doc.entities.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  /** Notes whose bounds touch `box`, on any layer. */
  queryNotes(box: Bounds): Note[] {
    const out: Note[] = [];
    for (const id of this.tree.search(box)) {
      const n = this.doc.notes.get(id);
      if (n) out.push(n);
    }
    return out;
  }

  /** Block inserts whose bounds touch `box`. */
  queryInserts(box: Bounds): Insert[] {
    const out: Insert[] = [];
    for (const id of this.tree.search(box)) {
      const ins = this.doc.inserts.get(id);
      if (ins) out.push(ins);
    }
    return out;
  }

  /** Bounds of every entity on a visible layer, or null if there are none. */
  visibleExtents(): Bounds | null {
    let out: Bounds | null = null;
    for (const e of this.doc.entities.values()) {
      if (isVisible(this.doc, e) && onCurrentSheet(this.doc, e)) out = out ? unionBounds(out, entityBounds(e)) : entityBounds(e);
    }
    for (const ins of this.doc.inserts.values()) {
      if (!isVisible(this.doc, ins) || !onCurrentSheet(this.doc, ins)) continue;
      const b = insertBounds(this.doc, ins);
      if (b) out = out ? unionBounds(out, b) : b;
    }
    const resolved = resolveNotes(this.doc);
    for (const n of this.doc.notes.values()) {
      const r = resolved.get(n.id);
      if (r?.ok && isVisible(this.doc, n) && onCurrentSheet(this.doc, n)) out = out ? unionBounds(out, r.r.bounds) : r.r.bounds;
    }
    return out;
  }
}
