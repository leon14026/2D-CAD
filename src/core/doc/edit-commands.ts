/**
 * Modify commands (Phase 5): offset, trim, extend, fillet, chamfer, polyline corners, arrays,
 * join and explode. Move, copy, rotate, scale and mirror are entity.transform and entity.copy.
 *
 * Pieces made from an entity keep its layer, style and place in the drawing order. Every
 * refusal says why in plain words and changes nothing.
 */
import {
  boxesOverlap,
  chamferLines,
  chamferPolyline,
  degToRad,
  explodePolyline,
  extendShape,
  filletLines,
  filletPolyline,
  joinShapes,
  offsetToward,
  pathOf,
  pathParam,
  rotate,
  shapeBounds,
  tolFor,
  transformPoint,
  translate,
  trimShape,
  type CornerResult,
  type Polyline,
  type Segment,
  type Shape,
  type Transform,
  type Vec2,
} from '../geom';
import { applyTransform, define, optional, readIds, requireEditable } from './command-kit';
import { CommandError, type Draft } from './draft';
import type { Entity } from './model';
import { canonicalShape, join, readArray, readBoolean, readNumber, readObject, readOneOf, readPoint, readPositiveInteger, ValidationError } from './validate';

// ---------- readers ----------

function readPositive(v: unknown, path: string): number {
  const n = readNumber(v, path);
  if (!(n > 0)) throw new ValidationError(path, `must be more than 0, not ${n}`);
  return n;
}

function readNonNegative(v: unknown, path: string): number {
  const n = readNumber(v, path);
  if (n < 0) throw new ValidationError(path, `must be 0 or more, not ${n}`);
  return n;
}

function readCount(v: unknown, path: string, min: number): number {
  const n = readPositiveInteger(v, path);
  if (n < min) throw new ValidationError(path, `must be at least ${min}, not ${n}`);
  return n;
}

/** Zero-based vertex numbers, without repeats. */
function readVertexList(v: unknown, path: string): number[] {
  const list = readArray(v, path);
  if (list.length === 0) throw new ValidationError(path, 'must list at least one vertex');
  return [
    ...new Set(
      list.map((item, i) => {
        const n = readNumber(item, join(path, i));
        if (!Number.isSafeInteger(n) || n < 0) throw new ValidationError(join(path, i), `must be a whole number of 0 or more, not ${n}`);
        return n;
      }),
    ),
  ];
}

export interface PickParams {
  readonly id: number;
  /** Where the entity was picked: which part of it is meant. */
  readonly point: Vec2;
}

function readPick(v: unknown, path: string): PickParams {
  const o = readObject(v, path, ['id', 'point']);
  return { id: readPositiveInteger(o['id'], join(path, 'id')), point: readPoint(o['point'], join(path, 'point')) };
}

// ---------- shared helpers ----------

/**
 * The entity takes the first shape; each further shape becomes a new entity with the same
 * layer, style and draw order. Returns all their ids.
 */
function replaceWith(draft: Draft, e: Entity, shapes: readonly Shape[]): number[] {
  const ids = [e.id];
  draft.putEntity({ ...e, geom: canonicalShape(shapes[0] as Shape) });
  for (const s of shapes.slice(1)) {
    const id = draft.allocateId();
    draft.putEntity({ ...e, id, geom: canonicalShape(s) });
    ids.push(id);
  }
  return ids;
}

/** A new entity like `e` (layer and style), drawn on top. */
function addLike(draft: Draft, e: Entity, s: Shape): number {
  const id = draft.allocateId();
  draft.putEntity({ ...e, id, z: id, geom: canonicalShape(s) });
  return id;
}

/**
 * The edges to cut or extend to: the ones named, or every entity on a shown layer except the
 * target. With `near`, only those whose bounds touch it (a quick first check).
 */
function edgesFor(draft: Draft, target: Entity, ids: readonly number[] | undefined, near: boolean): Shape[] {
  if (ids) {
    return ids
      .filter((id) => id !== target.id)
      .map((id) => {
        const e = draft.entity(id);
        if (!e) throw new CommandError(`There is no entity with id ${id}.`);
        return e.geom;
      });
  }
  const box = shapeBounds(target.geom);
  const slack = tolFor(box.minX, box.minY, box.maxX, box.maxY);
  const out: Shape[] = [];
  for (const e of draft.entities()) {
    if (e.id === target.id || draft.layer(e.layer)?.visible !== true) continue;
    if (near && !boxesOverlap(box, shapeBounds(e.geom), slack)) continue;
    out.push(e.geom);
  }
  return out;
}

function readEdges(o: Readonly<Record<string, unknown>>): number[] | undefined {
  return optional(o, 'edges', readIds);
}

// ---------- offset, trim, extend ----------

export interface OffsetParams {
  readonly id: number;
  readonly distance: number;
  /** A point on the side to offset towards. */
  readonly toward: Vec2;
}

const offset = define<OffsetParams, { id: number }>({
  id: 'entity.offset',
  label: 'Offset',
  parse(raw) {
    const o = readObject(raw, '', ['id', 'distance', 'toward']);
    return { id: readPositiveInteger(o['id'], 'id'), distance: readPositive(o['distance'], 'distance'), toward: readPoint(o['toward'], 'toward') };
  },
  run(draft, p) {
    const e = requireEditable(draft, p.id);
    return { id: addLike(draft, e, offsetToward(e.geom, p.distance, p.toward)) };
  },
});

export interface CutParams {
  readonly id: number;
  /** A point on the part to remove (trim) or near the end to lengthen (extend). */
  readonly pick: Vec2;
  /** Cutting or boundary edges; every other shown entity if left out. */
  readonly edges?: readonly number[];
}

function readCut(raw: unknown): CutParams {
  const o = readObject(raw, '', ['id', 'pick'], ['edges']);
  const edges = readEdges(o);
  return { id: readPositiveInteger(o['id'], 'id'), pick: readPoint(o['pick'], 'pick'), ...(edges && { edges }) };
}

const trim = define<CutParams, { ids: number[] }>({
  id: 'entity.trim',
  label: 'Trim',
  parse: readCut,
  run(draft, p) {
    const e = requireEditable(draft, p.id);
    const r = trimShape(e.geom, edgesFor(draft, e, p.edges, true), p.pick);
    if (!r.ok) {
      throw new CommandError(
        r.reason === 'no crossings'
          ? 'Nothing crosses this object there, so there is nothing to trim it back to.'
          : 'A circle or closed shape must be crossed in two places before part of it can be trimmed.',
      );
    }
    return { ids: replaceWith(draft, e, r.pieces) };
  },
});

const extend = define<CutParams, Record<string, never>>({
  id: 'entity.extend',
  label: 'Extend',
  parse: readCut,
  run(draft, p) {
    const e = requireEditable(draft, p.id);
    const r = extendShape(e.geom, edgesFor(draft, e, p.edges, false), p.pick);
    if (!r.ok) {
      throw new CommandError(r.reason === 'closed' ? 'Circles and closed shapes have no ends to extend.' : 'Nothing lies ahead of this end to extend it to.');
    }
    replaceWith(draft, e, [r.shape]);
    return {};
  },
});

// ---------- fillet and chamfer ----------

export interface CornerParams {
  readonly first: PickParams;
  readonly second: PickParams;
}

export interface FilletParams extends CornerParams {
  readonly radius: number;
}

export interface ChamferParams extends CornerParams {
  readonly distance1: number;
  readonly distance2: number;
}

const ONLY_LINES = 'Fillet and chamfer work on two lines, or on two neighbouring straight edges of one polyline.';

/** The vertex between the two picked edges of one polyline, which must be neighbours. */
function pickedCorner(pl: Polyline, a: Vec2, b: Vec2): number {
  const path = pathOf(pl);
  const ea = Math.min(Math.floor(pathParam(path, a)), path.curves.length - 1);
  const eb = Math.min(Math.floor(pathParam(path, b)), path.curves.length - 1);
  const n = path.curves.length;
  const lo = Math.min(ea, eb);
  const hi = Math.max(ea, eb);
  let corner: number | null = null;
  if (hi - lo === 1) corner = hi;
  else if (pl.closed && lo === 0 && hi === n - 1 && n > 2) corner = 0;
  if (corner === null) throw new CommandError('Pick two neighbouring edges of the polyline, one either side of the corner.');
  // Path corners count only real edges; find the matching vertex of the polyline itself.
  const at = path.points[corner] as Vec2;
  return pl.vertices.findIndex((v) => v.x === at.x && v.y === at.y);
}

function corner<P extends CornerParams>(
  draft: Draft,
  p: P,
  lines: (a: Segment, b: Segment) => CornerResult,
  corners: (pl: Polyline, vertex: number) => Polyline,
): { join: number | null } {
  const a = requireEditable(draft, p.first.id);
  const b = requireEditable(draft, p.second.id);
  if (a.id === b.id) {
    if (a.geom.kind !== 'polyline') throw new CommandError(ONLY_LINES);
    replaceWith(draft, a, [corners(a.geom, pickedCorner(a.geom, p.first.point, p.second.point))]);
    return { join: null };
  }
  if (a.geom.kind !== 'segment' || b.geom.kind !== 'segment') throw new CommandError(ONLY_LINES);
  const r = lines(a.geom, b.geom);
  replaceWith(draft, a, [r.first]);
  replaceWith(draft, b, [r.second]);
  return { join: r.join ? addLike(draft, a, r.join) : null };
}

function readCorner(o: Readonly<Record<string, unknown>>): CornerParams {
  return { first: readPick(o['first'], 'first'), second: readPick(o['second'], 'second') };
}

const fillet = define<FilletParams, { join: number | null }>({
  id: 'entity.fillet',
  label: 'Fillet',
  parse(raw) {
    const o = readObject(raw, '', ['first', 'second', 'radius']);
    return { ...readCorner(o), radius: readNonNegative(o['radius'], 'radius') };
  },
  run(draft, p) {
    return corner(
      draft,
      p,
      (a, b) => filletLines(a, p.first.point, b, p.second.point, p.radius),
      (pl, v) => {
        if (p.radius === 0) throw new CommandError('A polyline corner is already sharp; give a radius more than 0.');
        return filletPolyline(pl, p.radius, [v]);
      },
    );
  },
});

const chamfer = define<ChamferParams, { join: number | null }>({
  id: 'entity.chamfer',
  label: 'Chamfer',
  parse(raw) {
    const o = readObject(raw, '', ['first', 'second', 'distance1', 'distance2']);
    return { ...readCorner(o), distance1: readNonNegative(o['distance1'], 'distance1'), distance2: readNonNegative(o['distance2'], 'distance2') };
  },
  run(draft, p) {
    return corner(
      draft,
      p,
      (a, b) => chamferLines(a, p.first.point, b, p.second.point, p.distance1, p.distance2),
      (pl, v) => {
        if (p.distance1 !== p.distance2) throw new CommandError('A polyline corner is chamfered the same distance along both edges.');
        if (p.distance1 === 0) throw new CommandError('A polyline corner is already sharp; give a distance more than 0.');
        return chamferPolyline(pl, p.distance1, [v]);
      },
    );
  },
});

export interface CornersParams {
  readonly id: number;
  readonly size: number;
  /** Zero-based vertices to round or cut; every corner if left out. */
  readonly vertices?: readonly number[];
}

function readCorners(raw: unknown): CornersParams {
  const o = readObject(raw, '', ['id', 'size'], ['vertices']);
  const vertices = optional(o, 'vertices', readVertexList);
  return { id: readPositiveInteger(o['id'], 'id'), size: readPositive(o['size'], 'size'), ...(vertices && { vertices }) };
}

function polylineOf(draft: Draft, id: number): { e: Entity; pl: Polyline } {
  const e = requireEditable(draft, id);
  if (e.geom.kind !== 'polyline') throw new CommandError('Only a polyline has corners to round or cut.');
  return { e, pl: e.geom };
}

const filletCorners = define<CornersParams, Record<string, never>>({
  id: 'polyline.fillet',
  label: 'Round corners',
  parse: readCorners,
  run(draft, p) {
    const { e, pl } = polylineOf(draft, p.id);
    replaceWith(draft, e, [filletPolyline(pl, p.size, p.vertices)]);
    return {};
  },
});

const chamferCorners = define<CornersParams, Record<string, never>>({
  id: 'polyline.chamfer',
  label: 'Cut corners',
  parse: readCorners,
  run(draft, p) {
    const { e, pl } = polylineOf(draft, p.id);
    replaceWith(draft, e, [chamferPolyline(pl, p.size, p.vertices)]);
    return {};
  },
});

// ---------- arrays ----------

/** Most copies one array may make, so a typing slip can't freeze the page. */
export const MAX_ARRAY_COPIES = 100_000;

export type ArrayParams =
  | { readonly ids: readonly number[]; readonly kind: 'rectangular'; readonly columns: number; readonly rows: number; readonly dx: number; readonly dy: number }
  | { readonly ids: readonly number[]; readonly kind: 'polar'; readonly count: number; readonly center: Vec2; readonly angle: number; readonly rotate: boolean };

const array = define<ArrayParams, { ids: number[] }>({
  id: 'entity.array',
  label: 'Array',
  parse(raw) {
    const head = readObject(raw, '', ['ids', 'kind'], ['columns', 'rows', 'dx', 'dy', 'count', 'center', 'angle', 'rotate']);
    const kind = readOneOf(head['kind'], 'kind', ['rectangular', 'polar'] as const);
    const ids = readIds(head['ids'], 'ids');
    if (kind === 'rectangular') {
      const o = readObject(raw, '', ['ids', 'kind', 'columns', 'rows', 'dx', 'dy']);
      const columns = readCount(o['columns'], 'columns', 1);
      const rows = readCount(o['rows'], 'rows', 1);
      if (columns * rows < 2) throw new ValidationError('', 'an array needs more than one column or row');
      return { ids, kind, columns, rows, dx: readNumber(o['dx'], 'dx'), dy: readNumber(o['dy'], 'dy') };
    }
    const o = readObject(raw, '', ['ids', 'kind', 'count', 'center', 'angle', 'rotate']);
    const angle = readNumber(o['angle'], 'angle');
    if (angle === 0 || Math.abs(angle) > 360) throw new ValidationError('angle', `must be between -360 and 360 degrees and not 0, not ${angle}`);
    return { ids, kind, count: readCount(o['count'], 'count', 2), center: readPoint(o['center'], 'center'), angle, rotate: readBoolean(o['rotate'], 'rotate') };
  },
  run(draft, p) {
    const sources = p.ids.map((id) => requireEditable(draft, id));
    const steps: ((e: Entity) => Transform)[] = [];
    if (p.kind === 'rectangular') {
      for (let r = 0; r < p.rows; r++) {
        for (let c = 0; c < p.columns; c++) if (r > 0 || c > 0) steps.push(() => translate(c * p.dx, r * p.dy));
      }
    } else {
      // A full turn shares it out evenly; a part turn puts the last copy at its end.
      const step = Math.abs(p.angle) === 360 ? p.angle / p.count : p.angle / (p.count - 1);
      for (let k = 1; k < p.count; k++) {
        const turn = rotate(p.center, degToRad(step * k));
        steps.push((e) => {
          if (p.rotate) return turn;
          // Without turning, each copy moves the way its centre would.
          const b = shapeBounds(e.geom);
          const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          const to = transformPoint(turn, c);
          return translate(to.x - c.x, to.y - c.y);
        });
      }
    }
    if (steps.length * sources.length > MAX_ARRAY_COPIES) {
      throw new CommandError(`That would make ${steps.length * sources.length} copies; the most one array can make is ${MAX_ARRAY_COPIES}.`);
    }
    const ids: number[] = [];
    for (const step of steps) for (const e of sources) ids.push(addLike(draft, e, applyTransform(step(e), e.geom)));
    return { ids };
  },
});

// ---------- join and explode ----------

export interface IdListParams {
  readonly ids: readonly number[];
}

function readIdList(raw: unknown): IdListParams {
  const o = readObject(raw, '', ['ids']);
  return { ids: readIds(o['ids'], 'ids') };
}

const joinCommand = define<IdListParams, { id: number }>({
  id: 'entity.join',
  label: 'Join',
  parse: readIdList,
  run(draft, p) {
    const parts = p.ids.map((id) => requireEditable(draft, id));
    const first = parts[0] as Entity;
    replaceWith(draft, first, [joinShapes(parts.map((e) => e.geom))]);
    for (const e of parts.slice(1)) draft.deleteEntity(e.id);
    return { id: first.id };
  },
});

const explode = define<IdListParams, { ids: number[] }>({
  id: 'entity.explode',
  label: 'Explode',
  parse: readIdList,
  run(draft, p) {
    const polylines = p.ids.map((id) => requireEditable(draft, id)).filter((e) => e.geom.kind === 'polyline');
    if (polylines.length === 0) throw new CommandError('There are no polylines to explode in the selection.');
    const ids: number[] = [];
    for (const e of polylines) ids.push(...replaceWith(draft, e, explodePolyline(e.geom as Polyline)));
    return { ids };
  },
});

export const EDIT_COMMANDS = {
  'entity.offset': offset,
  'entity.trim': trim,
  'entity.extend': extend,
  'entity.fillet': fillet,
  'entity.chamfer': chamfer,
  'polyline.fillet': filletCorners,
  'polyline.chamfer': chamferCorners,
  'entity.array': array,
  'entity.join': joinCommand,
  'entity.explode': explode,
} as const;
