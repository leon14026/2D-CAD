/**
 * Object snaps. The matrix below is the Phase 4 gate check "every snap type is tested
 * against every pair of entity types":
 *
 * - Five entity types: line, circle, arc, straight polyline, polyline with an arc edge.
 * - Every single-entity snap kind (endpoint, midpoint, centre, quadrant, perpendicular,
 *   tangent, nearest) is checked on every type, with every other type crossing it nearby:
 *   each hand-calculated point is found exactly, on the right entity.
 * - Intersection is checked for all 15 pairs of types (25 in both drawing orders) at
 *   hand-calculated crossing points.
 */
import { describe, expect, it } from 'vitest';
import { createSession, execute, newDocument } from '../../../../src/core/doc';
import {
  arc,
  circle,
  polyline,
  rotate,
  segment,
  shapeBounds,
  transformShape,
  translate,
  type Shape,
  type Vec2,
} from '../../../../src/core/geom';
import {
  DEFAULT_SNAPS,
  findSnap,
  SNAP_KINDS,
  SNAP_LABELS,
  snapPoints,
  type SingleSnapKind,
  type SnapKind,
} from '../../../../src/core/spatial';
import { docOf } from '../docs';
import { expectPoint, expectPointSet } from '../helpers';

const r3 = Math.sqrt(3);
const only = (...kinds: SnapKind[]) => new Set<SnapKind>(kinds);
const RADIUS = 0.5;
/** Where the cursor rests relative to the point it should snap to. */
const NUDGE = { x: 0.05, y: 0.03 };
const near = (p: Vec2) => ({ x: p.x + NUDGE.x, y: p.y + NUDGE.y });

type TypeName = 'line' | 'circle' | 'arc' | 'polyline' | 'rounded polyline';

/** The canonical shape of each type, and its snap points worked out by hand. */
interface Canonical {
  readonly shape: Shape;
  readonly points: Readonly<Record<Exclude<SingleSnapKind, 'nearest'>, readonly Vec2[]>>;
  /** A cursor position just off the shape, and the nearest point to it. */
  readonly nearest: { readonly cursor: Vec2; readonly point: Vec2 };
}

/** Perpendicular and tangent snaps are taken from this point. */
const FROM = { x: 0, y: 20 };

const CANONICAL: Record<TypeName, Canonical> = {
  line: {
    shape: segment({ x: -20, y: 0 }, { x: 20, y: 0 }),
    points: {
      endpoint: [{ x: -20, y: 0 }, { x: 20, y: 0 }],
      midpoint: [{ x: 0, y: 0 }],
      center: [],
      quadrant: [],
      perpendicular: [{ x: 0, y: 0 }],
      tangent: [],
    },
    nearest: { cursor: { x: -15, y: 0.2 }, point: { x: -15, y: 0 } },
  },
  circle: {
    shape: circle({ x: 0, y: 0 }, 10),
    points: {
      endpoint: [],
      midpoint: [],
      center: [{ x: 0, y: 0 }],
      quadrant: [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }],
      perpendicular: [{ x: 0, y: 10 }, { x: 0, y: -10 }],
      tangent: [{ x: 5 * r3, y: 5 }, { x: -5 * r3, y: 5 }],
    },
    nearest: { cursor: { x: 6.06, y: 8.08 }, point: { x: 6, y: 8 } },
  },
  arc: {
    // Upper half: centre (0, 0), radius 10, from 0° anticlockwise to 180°.
    shape: arc({ x: 0, y: 0 }, 10, 0, Math.PI),
    points: {
      endpoint: [{ x: 10, y: 0 }, { x: -10, y: 0 }],
      midpoint: [{ x: 0, y: 10 }],
      center: [{ x: 0, y: 0 }],
      quadrant: [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }],
      perpendicular: [{ x: 0, y: 10 }],
      tangent: [{ x: 5 * r3, y: 5 }, { x: -5 * r3, y: 5 }],
    },
    nearest: { cursor: { x: 6.06, y: 8.08 }, point: { x: 6, y: 8 } },
  },
  polyline: {
    // An L: along y = -10, then up x = 10.
    shape: polyline([{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }]),
    points: {
      endpoint: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }],
      midpoint: [{ x: 0, y: -10 }, { x: 10, y: 0 }],
      center: [],
      quadrant: [],
      // From (0, 20) the foot on x = 10 would be (10, 20), beyond the edge.
      perpendicular: [{ x: 0, y: -10 }],
      tangent: [],
    },
    nearest: { cursor: { x: -5, y: -10.2 }, point: { x: -5, y: -10 } },
  },
  'rounded polyline': {
    // Bulge -1: a clockwise half circle over the top from (-10, 0) to (10, 0), then down to (10, -10).
    shape: polyline([{ x: -10, y: 0, bulge: -1 }, { x: 10, y: 0 }, { x: 10, y: -10 }]),
    points: {
      endpoint: [{ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 }],
      midpoint: [{ x: 0, y: 10 }, { x: 10, y: -5 }],
      center: [{ x: 0, y: 0 }],
      quadrant: [{ x: -10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }],
      perpendicular: [{ x: 0, y: 10 }],
      tangent: [{ x: 5 * r3, y: 5 }, { x: -5 * r3, y: 5 }],
    },
    nearest: { cursor: { x: 6.06, y: 8.08 }, point: { x: 6, y: 8 } },
  },
};

const TYPES = Object.keys(CANONICAL) as TypeName[];
const SINGLE_KINDS = SNAP_KINDS.filter((k): k is Exclude<SingleSnapKind, 'nearest'> => k !== 'intersection' && k !== 'nearest');

describe('snap points of each kind on each entity type (hand-calculated)', () => {
  for (const type of TYPES) {
    const c = CANONICAL[type];
    for (const kind of SINGLE_KINDS) {
      it(`${kind} on a ${type}`, () => {
        expectPointSet(snapPoints(c.shape, kind, { x: 0, y: 0 }, FROM), c.points[kind]);
      });
    }
    it(`nearest on a ${type}`, () => {
      expectPointSet(snapPoints(c.shape, 'nearest', c.nearest.cursor), [c.nearest.point]);
    });
  }

  it('perpendicular and tangent need a point to start from', () => {
    expect(snapPoints(CANONICAL.circle.shape, 'perpendicular', { x: 0, y: 0 })).toEqual([]);
    expect(snapPoints(CANONICAL.circle.shape, 'tangent', { x: 0, y: 0 }, null)).toEqual([]);
  });
});

/**
 * The other entity is the canonical shape of its type turned a quarter turn about the origin
 * and moved by (7, -3), so that it crosses the first. Its snap points move the same way:
 * (x, y) becomes (7 - y, x - 3), exactly.
 */
const move = (s: Shape) => transformShape(translate(7, -3), transformShape(rotate({ x: 0, y: 0 }, Math.PI / 2), s));
const moved = (p: Vec2) => ({ x: 7 - p.y, y: p.x - 3 });

describe('snap matrix: every kind on every type, with every other type crossing it', () => {
  for (const typeA of TYPES) {
    for (const typeB of TYPES) {
      it(`${typeA} with a ${typeB} nearby`, () => {
        const a = CANONICAL[typeA];
        const b = CANONICAL[typeB];
        const { doc, ids } = docOf([a.shape, move(b.shape)]);
        const [idA, idB] = ids as [number, number];

        // The two really do overlap: their bounding boxes meet.
        const ba = shapeBounds(a.shape);
        const bb = shapeBounds(move(b.shape));
        expect(ba.maxX >= bb.minX && bb.maxX >= ba.minX && ba.maxY >= bb.minY && bb.maxY >= ba.minY).toBe(true);

        const check = (kind: SingleSnapKind, target: Vec2, cursor: Vec2, from: Vec2 | null, id: number) => {
          const hit = findSnap(doc, cursor, RADIUS, { kinds: only(kind), from });
          expect(hit, `${kind} at (${target.x}, ${target.y})`).not.toBeNull();
          expect(hit?.kind).toBe(kind);
          expectPoint(hit?.point, target);
          // Where both entities have the same point, either may supply it.
          const other = id === idA ? idB : idA;
          const otherShape = id === idA ? move(b.shape) : a.shape;
          const shared = snapPoints(otherShape, kind, cursor, from).some((q) => Math.hypot(q.x - target.x, q.y - target.y) < 1e-9);
          expect(hit?.ids).toEqual(shared && hit?.ids[0] === other ? [other] : [id]);
        };

        for (const kind of SINGLE_KINDS) {
          for (const p of a.points[kind]) check(kind, p, near(p), FROM, idA);
          for (const p of b.points[kind]) check(kind, moved(p), near(moved(p)), moved(FROM), idB);
        }
        check('nearest', a.nearest.point, a.nearest.cursor, null, idA);
        check('nearest', moved(b.nearest.point), moved(b.nearest.cursor), null, idB);
      });
    }
  }
});

/** Each pair of types, drawn so they cross at points worked out by hand. */
const C10 = circle({ x: 0, y: 0 }, 10);
const UPPER = arc({ x: 0, y: 0 }, 10, 0, Math.PI);
const LEFT_OF_12 = arc({ x: 12, y: 0 }, 10, Math.PI / 2, Math.PI); // left half of the circle about (12, 0)
const ROUNDED = CANONICAL['rounded polyline'].shape;
const Y6 = segment({ x: -20, y: 6 }, { x: 20, y: 6 });
const Y6_POLY = polyline([{ x: -20, y: 6 }, { x: 20, y: 6 }, { x: 20, y: 20 }]);
const L_POLY = CANONICAL.polyline.shape;
const r96 = 4 * Math.sqrt(6);

const CROSSINGS: readonly { pair: [TypeName, TypeName]; shapes: [Shape, Shape]; points: Vec2[] }[] = [
  { pair: ['line', 'line'], shapes: [segment({ x: -20, y: 0 }, { x: 20, y: 0 }), segment({ x: 5, y: -5 }, { x: 5, y: 5 })], points: [{ x: 5, y: 0 }] },
  { pair: ['line', 'circle'], shapes: [Y6, C10], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  { pair: ['line', 'arc'], shapes: [Y6, UPPER], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  { pair: ['line', 'polyline'], shapes: [segment({ x: 0, y: -20 }, { x: 0, y: 20 }), L_POLY], points: [{ x: 0, y: -10 }] },
  { pair: ['line', 'rounded polyline'], shapes: [Y6, ROUNDED], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  { pair: ['circle', 'circle'], shapes: [C10, circle({ x: 12, y: 0 }, 10)], points: [{ x: 6, y: 8 }, { x: 6, y: -8 }] },
  { pair: ['circle', 'arc'], shapes: [C10, LEFT_OF_12], points: [{ x: 6, y: 8 }, { x: 6, y: -8 }] },
  { pair: ['circle', 'polyline'], shapes: [C10, Y6_POLY], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  { pair: ['circle', 'rounded polyline'], shapes: [circle({ x: 12, y: 0 }, 10), ROUNDED], points: [{ x: 6, y: 8 }, { x: 10, y: -r96 }] },
  { pair: ['arc', 'arc'], shapes: [UPPER, LEFT_OF_12], points: [{ x: 6, y: 8 }] },
  { pair: ['arc', 'polyline'], shapes: [UPPER, Y6_POLY], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  { pair: ['arc', 'rounded polyline'], shapes: [LEFT_OF_12, ROUNDED], points: [{ x: 6, y: 8 }, { x: 10, y: -r96 }] },
  { pair: ['polyline', 'polyline'], shapes: [L_POLY, polyline([{ x: 0, y: -20 }, { x: 0, y: 0 }, { x: 20, y: 0 }])], points: [{ x: 0, y: -10 }, { x: 10, y: 0 }] },
  { pair: ['polyline', 'rounded polyline'], shapes: [Y6_POLY, ROUNDED], points: [{ x: 8, y: 6 }, { x: -8, y: 6 }] },
  {
    pair: ['rounded polyline', 'rounded polyline'],
    shapes: [ROUNDED, polyline([{ x: 2, y: 0, bulge: -1 }, { x: 22, y: 0 }, { x: 22, y: -10 }])],
    points: [{ x: 6, y: 8 }],
  },
];

describe('intersection snaps for every pair of entity types (hand-calculated)', () => {
  it('covers all 15 pairs', () => {
    const pairs = new Set(CROSSINGS.map((c) => [...c.pair].sort().join('+')));
    expect(pairs.size).toBe(15);
  });

  for (const { pair, shapes, points } of CROSSINGS) {
    for (const order of [0, 1]) {
      const [first, second] = order === 0 ? shapes : [shapes[1], shapes[0]];
      const label = order === 0 ? `${pair[0]} then ${pair[1]}` : `${pair[1]} then ${pair[0]}`;
      it(`${label} at ${points.length === 1 ? 'one point' : `${points.length} points`}`, () => {
        const { doc, ids } = docOf([first, second]);
        for (const p of points) {
          const hit = findSnap(doc, near(p), RADIUS, { kinds: only('intersection') });
          expect(hit?.kind).toBe('intersection');
          expectPoint(hit?.point, p);
          expect([...(hit?.ids ?? [])].sort()).toEqual([...ids].sort());
        }
      });
    }
  }
});

describe('choosing between snap points', () => {
  const twoLines = () =>
    docOf([segment({ x: 0, y: 0 }, { x: 10, y: 0 }), segment({ x: 10, y: 0 }, { x: 10, y: 10 }), circle({ x: 30, y: 0 }, 5)]);

  it('the nearest snap point wins', () => {
    const { doc } = twoLines();
    const hit = findSnap(doc, { x: 4.8, y: 0.1 }, 1, { kinds: DEFAULT_SNAPS });
    expect(hit).toEqual({ kind: 'midpoint', point: { x: 5, y: 0 }, ids: [expect.any(Number)] });
  });

  it('at a shared corner, endpoint beats intersection', () => {
    const { doc } = twoLines();
    expect(findSnap(doc, { x: 10.1, y: 0.1 }, 1, { kinds: DEFAULT_SNAPS })?.kind).toBe('endpoint');
    expect(findSnap(doc, { x: 10.1, y: 0.1 }, 1, { kinds: only('intersection', 'midpoint') })?.kind).toBe('intersection');
  });

  it('resting on a circle snaps to its centre when nearest is off', () => {
    const { doc, ids } = twoLines();
    expect(findSnap(doc, { x: 33, y: 4.05 }, 0.5, { kinds: DEFAULT_SNAPS })).toEqual({ kind: 'center', point: { x: 30, y: 0 }, ids: [ids[2]] });
  });

  it('the closest circle edge decides which centre', () => {
    const { doc, ids } = docOf([circle({ x: 0, y: 0 }, 5), circle({ x: 0, y: 0 }, 5.4), segment({ x: 100, y: 0 }, { x: 101, y: 0 })]);
    expect(findSnap(doc, { x: 5.3, y: 0.3 }, 0.5, { kinds: only('center') })?.ids).toEqual([ids[1]]);
    expect(findSnap(doc, { x: 100.5, y: 0.3 }, 0.5, { kinds: only('center') })).toBeNull();
  });

  it('with nearest on, the edge gives the nearest point instead', () => {
    const { doc } = twoLines();
    const hit = findSnap(doc, { x: 33, y: 4.05 }, 0.5, { kinds: new Set(SNAP_KINDS) });
    expect(hit?.kind).toBe('nearest');
    expectPoint(hit?.point, { x: 30 + 3 * (5 / Math.hypot(3, 4.05)), y: 4.05 * (5 / Math.hypot(3, 4.05)) });
  });

  it('nothing near, no kinds, or only hidden geometry: no snap', () => {
    const { doc } = twoLines();
    expect(findSnap(doc, { x: 50, y: 50 }, 1, { kinds: new Set(SNAP_KINDS) })).toBeNull();
    expect(findSnap(doc, { x: 0, y: 0 }, 1, { kinds: new Set() })).toBeNull();
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) }).session;
    s = execute(s, 'layer.update', { id: 1, visible: false }).session;
    expect(findSnap(s.doc, { x: 0, y: 0 }, 1, { kinds: DEFAULT_SNAPS })).toBeNull();
  });

  it('locked geometry can still be snapped to', () => {
    let s = createSession(newDocument());
    s = execute(s, 'entity.add', { geom: segment({ x: 0, y: 0 }, { x: 10, y: 0 }) }).session;
    s = execute(s, 'layer.update', { id: 1, locked: true }).session;
    expect(findSnap(s.doc, { x: 0.1, y: 0 }, 1, { kinds: DEFAULT_SNAPS })?.point).toEqual({ x: 0, y: 0 });
  });

  it('defaults leave out nearest; every kind has a label', () => {
    expect([...DEFAULT_SNAPS].sort()).toEqual(SNAP_KINDS.filter((k) => k !== 'nearest').sort());
    for (const k of SNAP_KINDS) expect(SNAP_LABELS[k]).toMatch(/^[A-Z][a-z]+$/);
  });

  it('edge cases: a polyline with no length, kinds with nothing nearby, two equally near circles', () => {
    expect(snapPoints(polyline([{ x: 1, y: 1 }, { x: 1, y: 1 }]), 'nearest', { x: 0, y: 0 })).toEqual([]);
    const { doc, ids } = docOf([segment({ x: 0, y: 0 }, { x: 10, y: 0 }), circle({ x: 50, y: 0 }, 5), circle({ x: 50, y: 0 }, 5)]);
    expect(findSnap(doc, { x: 5.3, y: 0.1 }, 0.5, { kinds: only('endpoint') })).toBeNull();
    expect(findSnap(doc, { x: 55.1, y: 0.1 }, 0.5, { kinds: only('center') })?.ids).toEqual([ids[1]]);
  });
});
