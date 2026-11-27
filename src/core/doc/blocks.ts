/**
 * Reusable blocks: a named definition in local coordinates, and inserts that place it in the
 * drawing. Editing the definition updates every insert. Explode turns an insert back into
 * ordinary entities.
 */
import {
  ORIGIN,
  angleOf,
  mirror,
  rotate,
  scaleAbout,
  shapeBounds,
  sub,
  transformPoint,
  transformShape,
  translate,
  unionBounds,
  type Bounds,
  type Shape,
  type Transform,
  type Vec2,
} from '../geom';
import type { Doc, Entity } from './model';
import { onCurrentSheet } from './sheets';
import { BY_LAYER, type ColorRef, type LinetypeRef, type LineweightRef } from './styles';
import { canonicalShape } from './validate';

export const MAX_BLOCKS = 100;
export const MAX_BLOCK_MEMBERS = 500;

export interface BlockMember {
  readonly geom: Shape;
  readonly color: ColorRef;
  readonly linetype: LinetypeRef;
  readonly lineweight: LineweightRef;
}

export interface Block {
  readonly name: string;
  readonly members: readonly BlockMember[];
}

/**
 * A placed copy of a block. `at` is where the block origin goes; rotation is radians
 * counter-clockwise; scale is positive. `flipped` mirrors local x before rotate/scale.
 */
export interface Insert {
  readonly id: number;
  readonly layer: number;
  readonly z: number;
  readonly color: ColorRef;
  readonly linetype: LinetypeRef;
  readonly lineweight: LineweightRef;
  readonly block: string;
  readonly at: Vec2;
  readonly rotation: number;
  readonly scale: number;
  readonly flipped: boolean;
  readonly sheet?: string;
}

export function findBlock(blocks: readonly Block[], name: string): Block | undefined {
  const key = name.trim().toLowerCase();
  return blocks.find((b) => b.name.toLowerCase() === key);
}

export function findBlockIn(doc: Pick<Doc, 'blocks'>, name: string): Block | undefined {
  return findBlock(doc.blocks, name);
}

/** Local-to-world transform of an insert, applied to a member shape. */
export function insertTransform(ins: Insert): Transform[] {
  const steps: Transform[] = [];
  if (ins.flipped) steps.push(mirror(ORIGIN, { x: 0, y: 1 }));
  if (ins.scale !== 1) steps.push(scaleAbout(ORIGIN, ins.scale));
  if (ins.rotation !== 0) steps.push(rotate(ORIGIN, ins.rotation));
  if (ins.at.x !== 0 || ins.at.y !== 0) steps.push(translate(ins.at.x, ins.at.y));
  return steps;
}

function applySteps(steps: readonly Transform[], s: Shape): Shape {
  let g = s;
  for (const t of steps) g = transformShape(t, g);
  return canonicalShape(g);
}

export interface InsertPiece {
  readonly geom: Shape;
  readonly color: ColorRef;
  readonly linetype: LinetypeRef;
  readonly lineweight: LineweightRef;
}

/** Member geometry in world coordinates, with each member's style (byLayer stays byLayer). */
export function explodeInsert(block: Block, ins: Insert): InsertPiece[] {
  const steps = insertTransform(ins);
  return block.members.map((m) => ({
    geom: applySteps(steps, m.geom),
    color: m.color,
    linetype: m.linetype,
    lineweight: m.lineweight,
  }));
}

export function insertShapes(doc: Pick<Doc, 'blocks'>, ins: Insert): Shape[] {
  const block = findBlockIn(doc, ins.block);
  if (!block) return [];
  return explodeInsert(block, ins).map((p) => p.geom);
}

export function insertBounds(doc: Pick<Doc, 'blocks'>, ins: Insert): Bounds | null {
  const shapes = insertShapes(doc, ins);
  if (shapes.length === 0) return null;
  return shapes.map(shapeBounds).reduce((a, b) => unionBounds(a, b));
}

/** Moves, rotates, scales or mirrors an insert as a unit. */
export function transformInsert(t: Transform, ins: Insert): Insert {
  const at = transformPoint(t, ins.at);
  let { rotation, scale, flipped } = ins;
  if (t.kind === 'rotate') rotation += t.angle;
  if (t.kind === 'scale') scale *= t.factor;
  if (t.kind === 'mirror') {
    const x = { x: ins.at.x + Math.cos(ins.rotation), y: ins.at.y + Math.sin(ins.rotation) };
    rotation = angleOf(sub(transformPoint(t, x), at));
    flipped = !flipped;
  }
  return { ...ins, at: { x: at.x + 0, y: at.y + 0 }, rotation: rotation + 0, scale: scale + 0, flipped };
}

export function membersFromEntities(entities: readonly Entity[], origin: Vec2): BlockMember[] {
  const shift = translate(-origin.x, -origin.y);
  return entities.map((e) => ({
    geom: canonicalShape(transformShape(shift, e.geom)),
    color: e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
  }));
}

/** Entities and exploded inserts on the current sheet, for export and for tools that want shapes. */
export function piecesOnSheet(doc: Doc): Array<InsertPiece & { layer: number; id: number }> {
  const out: (InsertPiece & { layer: number; id: number })[] = [];
  for (const e of doc.entities.values()) {
    if (!onCurrentSheet(doc, e)) continue;
    out.push({ id: e.id, layer: e.layer, geom: e.geom, color: e.color, linetype: e.linetype, lineweight: e.lineweight });
  }
  for (const ins of doc.inserts.values()) {
    if (!onCurrentSheet(doc, ins)) continue;
    const block = findBlockIn(doc, ins.block);
    if (!block) continue;
    for (const p of explodeInsert(block, ins)) {
      out.push({
        id: ins.id,
        layer: ins.layer,
        geom: p.geom,
        color: p.color === BY_LAYER ? ins.color : p.color,
        linetype: p.linetype === BY_LAYER ? ins.linetype : p.linetype,
        lineweight: p.lineweight === BY_LAYER ? ins.lineweight : p.lineweight,
      });
    }
  }
  return out;
}
