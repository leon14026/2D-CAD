/**
 * A static, bulk-loaded R-tree (Sort-Tile-Recursive packing). Built once from a set of boxes
 * and queried many times: which boxes touch this rectangle? Rebuilding 20,000 items takes a
 * few milliseconds, which is cheap next to a frame of drawing.
 */
import type { Bounds } from '../geom';

export interface Item {
  readonly id: number;
  readonly box: Bounds;
}

interface Node {
  readonly box: Bounds;
  readonly children: readonly Node[] | null;
  /** Leaf entries; their own boxes are checked so a leaf never over-reports. */
  readonly items: readonly Item[] | null;
}

export const DEFAULT_NODE_SIZE = 16;

function union(boxes: readonly Bounds[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function boxesTouch(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

const cx = (b: Bounds) => b.minX + b.maxX;
const cy = (b: Bounds) => b.minY + b.maxY;

/** Orders entries into tiles: vertical slices by x, each sorted by y, so neighbours group well. */
function strOrder<T extends { box: Bounds }>(entries: T[], nodeSize: number): T[] {
  const sorted = [...entries].sort((a, b) => cx(a.box) - cx(b.box));
  const nodeCount = Math.ceil(sorted.length / nodeSize);
  const sliceSize = Math.ceil(sorted.length / Math.ceil(Math.sqrt(nodeCount)));
  const out: T[] = [];
  for (let i = 0; i < sorted.length; i += sliceSize) {
    out.push(...sorted.slice(i, i + sliceSize).sort((a, b) => cy(a.box) - cy(b.box)));
  }
  return out;
}

export class PackedRTree {
  private constructor(
    private readonly root: Node | null,
    readonly size: number,
  ) {}

  static build(items: readonly Item[], nodeSize: number = DEFAULT_NODE_SIZE): PackedRTree {
    if (!Number.isInteger(nodeSize) || nodeSize < 2) throw new RangeError(`node size must be a whole number of 2 or more, got ${nodeSize}`);
    if (items.length === 0) return new PackedRTree(null, 0);

    let level: Node[] = [];
    const leaves = strOrder([...items], nodeSize);
    for (let i = 0; i < leaves.length; i += nodeSize) {
      const group = leaves.slice(i, i + nodeSize);
      level.push({ box: union(group.map((g) => g.box)), children: null, items: group });
    }
    while (level.length > 1) {
      const ordered = strOrder(level, nodeSize);
      const next: Node[] = [];
      for (let i = 0; i < ordered.length; i += nodeSize) {
        const group = ordered.slice(i, i + nodeSize);
        next.push({ box: union(group.map((g) => g.box)), children: group, items: null });
      }
      level = next;
    }
    return new PackedRTree(level[0] as Node, items.length);
  }

  /** Bounds of everything in the tree, or null if it is empty. */
  get bounds(): Bounds | null {
    return this.root ? this.root.box : null;
  }

  /** Ids of every item whose box touches `query` (edges count as touching). */
  search(query: Bounds): number[] {
    const out: number[] = [];
    if (!this.root || !boxesTouch(this.root.box, query)) return out;
    const stack: Node[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as Node;
      if (node.items) {
        for (const item of node.items) if (boxesTouch(item.box, query)) out.push(item.id);
        continue;
      }
      for (const child of node.children as readonly Node[]) {
        if (boxesTouch(child.box, query)) stack.push(child);
      }
    }
    return out;
  }
}
