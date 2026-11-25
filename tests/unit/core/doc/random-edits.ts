/**
 * Random but valid-by-construction edit sequences for the Phase 2 property tests.
 * Driven by a seeded generator so every failure can be replayed from its seed.
 */
import {
  CommandError,
  createSession,
  executeUnchecked,
  LINETYPE_IDS,
  LINEWEIGHTS_MM,
  newDocument,
  type Doc,
  type Session,
} from '../../../../src/core/doc';
import { LENGTH_UNITS, TAU } from '../../../../src/core/geom';

export type Rand = () => number;

/** mulberry32: small, fast, good enough for test data. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rand, items: readonly T[]): T => items[Math.floor(r() * items.length)] as T;
const between = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();

/** Mostly uniform, sometimes integers, 0 or -0, to exercise canonical numbers. */
function coord(r: Rand): number {
  const roll = r();
  if (roll < 0.05) return -0;
  if (roll < 0.1) return 0;
  if (roll < 0.3) return Math.round(between(r, -100, 100));
  return between(r, -1000, 1000);
}

const point = (r: Rand) => ({ x: coord(r), y: coord(r) });

function apart(p: { x: number; y: number }, q: { x: number; y: number }) {
  return Math.hypot(p.x - q.x, p.y - q.y) > 1e-3 ? q : { x: q.x + 1, y: q.y + 1 };
}

export function randomShape(r: Rand): unknown {
  switch (pick(r, ['segment', 'circle', 'arc', 'polyline'] as const)) {
    case 'segment': {
      const start = point(r);
      return { kind: 'segment', start, end: apart(start, point(r)) };
    }
    case 'circle':
      return { kind: 'circle', center: point(r), radius: between(r, 0.01, 500) };
    case 'arc':
      return {
        kind: 'arc',
        center: point(r),
        radius: between(r, 0.01, 500),
        start: between(r, -10, 10),
        sweep: (r() < 0.5 ? -1 : 1) * between(r, 0.01, TAU - 0.01),
      };
    case 'polyline': {
      const n = 2 + Math.floor(r() * 5);
      const vertices: { x: number; y: number; bulge: number }[] = [];
      for (let i = 0; i < n; i++) {
        const prev = vertices[i - 1];
        const p = prev ? apart(prev, point(r)) : point(r);
        vertices.push({ ...p, bulge: r() < 0.5 ? 0 : between(r, -3, 3) });
      }
      const closed = r() < 0.5;
      const first = vertices[0]!;
      const last = vertices[n - 1]!;
      if (closed) vertices[n - 1] = { ...apart(first, last), bulge: last.bulge };
      return { kind: 'polyline', vertices, closed };
    }
  }
}

function randomTransform(r: Rand): unknown {
  switch (pick(r, ['translate', 'rotate', 'scale', 'mirror'] as const)) {
    case 'translate':
      return { kind: 'translate', dx: coord(r), dy: coord(r) };
    case 'rotate':
      return { kind: 'rotate', center: point(r), angle: between(r, -7, 7) };
    case 'scale':
      return { kind: 'scale', center: point(r), factor: between(r, 0.5, 2) };
    case 'mirror': {
      const a = point(r);
      return { kind: 'mirror', a, b: apart(a, point(r)) };
    }
  }
}

const colour = (r: Rand) => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;
const style = (r: Rand) => ({
  ...(r() < 0.3 && { color: r() < 0.3 ? 'byLayer' : colour(r) }),
  ...(r() < 0.3 && { linetype: pick(r, ['byLayer', ...LINETYPE_IDS]) }),
  ...(r() < 0.3 && { lineweight: pick(r, ['byLayer', ...LINEWEIGHTS_MM]) }),
});

function someIds(r: Rand, ids: readonly number[]): number[] {
  const n = 1 + Math.floor(r() * Math.min(3, ids.length));
  return Array.from({ length: n }, () => pick(r, ids));
}

/** One random command for the current document. It may legitimately fail (e.g. locked layer). */
export function randomCommand(r: Rand, doc: Doc): { id: string; params: unknown } {
  const entityIds = [...doc.entities.keys()];
  const layerIds = doc.layers.map((l) => l.id);
  const roll = r();
  if (entityIds.length === 0 || roll < 0.3) {
    return { id: 'entity.add', params: { geom: randomShape(r), ...(r() < 0.3 && { layer: pick(r, layerIds) }), ...style(r) } };
  }
  if (roll < 0.38) return { id: 'entity.delete', params: { ids: someIds(r, entityIds) } };
  if (roll < 0.53) return { id: 'entity.transform', params: { ids: someIds(r, entityIds), transform: randomTransform(r) } };
  if (roll < 0.61) return { id: 'entity.copy', params: { ids: someIds(r, entityIds), transform: randomTransform(r) } };
  if (roll < 0.71) {
    const s = style(r);
    const params = { ids: someIds(r, entityIds), ...s, ...(r() < 0.4 && { layer: pick(r, layerIds) }) };
    return { id: 'entity.setProps', params: Object.keys(params).length > 1 ? params : { ...params, color: colour(r) } };
  }
  if (roll < 0.77) return { id: 'layer.add', params: { name: `Layer ${Math.floor(r() * 1000)}`, ...(r() < 0.5 && { color: colour(r) }) } };
  if (roll < 0.85) {
    const changes = [
      { visible: r() < 0.5 },
      { locked: r() < 0.25 },
      { color: colour(r) },
      { linetype: pick(r, LINETYPE_IDS) },
      { lineweight: pick(r, LINEWEIGHTS_MM) },
      { name: `Renamed ${Math.floor(r() * 1000)}` },
    ];
    return { id: 'layer.update', params: { id: pick(r, layerIds), ...pick(r, changes) } };
  }
  if (roll < 0.89) return { id: 'layer.delete', params: { id: pick(r, layerIds) } };
  if (roll < 0.94) return { id: 'layer.setCurrent', params: { id: pick(r, layerIds) } };
  if (roll < 0.97) return { id: 'doc.setTitle', params: { title: `Drawing ${Math.floor(r() * 1000)}` } };
  return { id: 'doc.setUnits', params: { units: pick(r, LENGTH_UNITS), convert: r() < 0.5 } };
}

export interface RandomRun {
  readonly session: Session;
  /** Document after 0, 1, 2, … successful edits. */
  readonly snapshots: readonly Doc[];
  readonly failures: number;
}

/**
 * Applies random commands until `edits` of them have succeeded (each success is one undo step).
 * Commands that fail must leave the session exactly as it was.
 */
export function runRandomEdits(seed: number, edits: number): RandomRun {
  const r = seeded(seed);
  let session = createSession(newDocument({ title: `Seed ${seed}` }));
  const snapshots: Doc[] = [session.doc];
  let failures = 0;
  for (let attempts = 0; snapshots.length <= edits; attempts++) {
    if (attempts > edits * 20) throw new Error(`seed ${seed}: too many failed commands`);
    const { id, params } = randomCommand(r, session.doc);
    let next: Session;
    try {
      next = executeUnchecked(session, id, params).session;
    } catch (err) {
      if (!(err instanceof CommandError)) throw new Error(`seed ${seed}: ${id} threw ${String(err)}`);
      failures += 1;
      continue;
    }
    if (next === session) continue; // a valid command that changed nothing adds no undo step
    session = next;
    snapshots.push(session.doc);
  }
  return { session, snapshots, failures };
}
