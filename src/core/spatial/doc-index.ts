/**
 * Spatial index over a document's entities. Entity bounds are cached per geometry object
 * (geometry is immutable), so after an edit only changed shapes are measured again.
 */
import { shapeBounds, unionBounds, type Bounds, type Shape } from '../geom';
import { findLayer, type Doc, type Entity } from '../doc';
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

/** True if the entity's layer is shown. */
export function isVisible(doc: Doc, e: Entity): boolean {
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
      const items = [...doc.entities.values()].map((e) => ({ id: e.id, box: entityBounds(e) }));
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
    return this.tree.search(box).map((id) => this.doc.entities.get(id) as Entity);
  }

  /** Bounds of every entity on a visible layer, or null if there are none. */
  visibleExtents(): Bounds | null {
    let out: Bounds | null = null;
    for (const e of this.doc.entities.values()) {
      if (isVisible(this.doc, e)) out = out ? unionBounds(out, entityBounds(e)) : entityBounds(e);
    }
    return out;
  }
}
