/**
 * Hatch areas for the independent check against shapely (tests/oracle/check_hatch_areas.py).
 *
 * The cases are built by construction from a fixed seed: rectangles, regular polygons, circles,
 * rounded rectangles and slots, each with circular islands that sit inside by design. The area
 * of each is what ArchiLite reports for a hatch note. The approved file
 * tests/fixtures/hatch-cases.json holds the geometry and ArchiLite's area; the oracle recomputes
 * the area from the geometry alone and must agree.
 */
import { createSession, execute, resolveNotes, newDocument } from '../../src/core/doc';
import { circle, polyline, rectangle, regularPolygon, type Shape } from '../../src/core/geom';

export type LoopJson =
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: 'polyline'; readonly vertices: readonly { readonly x: number; readonly y: number; readonly bulge: number }[] };

export interface HatchCase {
  readonly name: string;
  readonly outer: LoopJson;
  readonly islands: readonly LoopJson[];
  /** The area ArchiLite reports for the hatch. */
  readonly area: number;
}

/** A small deterministic generator (mulberry32), so the cases never change by accident. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toJson(s: Shape): LoopJson {
  if (s.kind === 'circle') return { kind: 'circle', cx: s.center.x, cy: s.center.y, r: s.radius };
  if (s.kind === 'polyline') return { kind: 'polyline', vertices: s.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge })) };
  throw new Error('not a loop');
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export interface Region {
  readonly name: string;
  readonly outer: Shape;
  readonly islands: readonly Shape[];
}

/** The regions, built by construction so every island lies inside the outer boundary. */
export function hatchRegions(count = 60, seed = 20261126): Region[] {
  const rand = rng(seed);
  const between = (lo: number, hi: number) => round(lo + (hi - lo) * rand());
  const out: Region[] = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 5;
    const cx = between(-200, 200);
    const cy = between(-200, 200);
    if (kind === 0) {
      // Rectangle with up to four islands, one in each quarter.
      const w = between(40, 300);
      const h = between(40, 300);
      const islands: Shape[] = [];
      for (let q = 0; q < 4; q++) {
        if (rand() < 0.4) continue;
        const r = Math.max(0.5, round(Math.min(w, h) * 0.2 * (0.3 + 0.7 * rand())));
        islands.push(circle({ x: cx + w / 4 + (q % 2) * (w / 2), y: cy + h / 4 + (q < 2 ? 0 : 1) * (h / 2) }, r));
      }
      out.push({ name: `rectangle ${i}`, outer: rectangle({ x: cx, y: cy }, { x: cx + w, y: cy + h }), islands });
    } else if (kind === 1) {
      const sides = 3 + Math.floor(rand() * 10);
      const R = between(20, 150);
      const inner = R * Math.cos(Math.PI / sides);
      const islands = rand() < 0.6 ? [circle({ x: cx, y: cy }, round(inner * (0.2 + 0.5 * rand())))] : [];
      const turn = round(rand() * 3);
      out.push({ name: `polygon ${i}`, outer: regularPolygon({ x: cx, y: cy }, { x: cx + R * Math.cos(turn), y: cy + R * Math.sin(turn) }, sides), islands });
    } else if (kind === 2) {
      const R = between(10, 150);
      const rho = round(R * (0.1 + 0.3 * rand()));
      const offset = round((R - rho) * 0.5 * rand());
      const islands = rand() < 0.7 ? [circle({ x: cx + offset, y: cy }, rho)] : [];
      out.push({ name: `circle ${i}`, outer: circle({ x: cx, y: cy }, R), islands });
    } else if (kind === 3) {
      // Rounded rectangle: four quarter-turn corners.
      const w = between(60, 300);
      const h = between(60, 300);
      const r = round(Math.min(w, h) * (0.05 + 0.3 * rand()));
      const b = Math.tan(Math.PI / 8);
      const x0 = cx;
      const y0 = cy;
      const v = [
        { x: x0 + r, y: y0, bulge: 0 },
        { x: x0 + w - r, y: y0, bulge: b },
        { x: x0 + w, y: y0 + r, bulge: 0 },
        { x: x0 + w, y: y0 + h - r, bulge: b },
        { x: x0 + w - r, y: y0 + h, bulge: 0 },
        { x: x0 + r, y: y0 + h, bulge: b },
        { x: x0, y: y0 + h - r, bulge: 0 },
        { x: x0, y: y0 + r, bulge: b },
      ];
      const hole = circle({ x: x0 + w / 2, y: y0 + h / 2 }, round(Math.min(w, h) * (0.1 + 0.2 * rand())));
      out.push({ name: `rounded rectangle ${i}`, outer: polyline(v, true), islands: rand() < 0.7 ? [hole] : [] });
    } else {
      // Slot: two straight sides and two half circles (bulge 1).
      const len = between(40, 250);
      const r = between(5, 40);
      const v = [
        { x: cx, y: cy - r, bulge: 0 },
        { x: cx + len, y: cy - r, bulge: 1 },
        { x: cx + len, y: cy + r, bulge: 0 },
        { x: cx, y: cy + r, bulge: 1 },
      ];
      const hole = circle({ x: cx + len / 2, y: cy }, round(r * (0.2 + 0.5 * rand())));
      out.push({ name: `slot ${i}`, outer: polyline(v, true), islands: rand() < 0.5 ? [hole] : [] });
    }
  }
  return out;
}

/** The cases with the area ArchiLite reports for each. */
export function buildHatchCases(): HatchCase[] {
  return hatchRegions().map((r) => {
    let session = createSession(newDocument());
    const add = (geom: Shape): number => {
      const res = execute(session, 'entity.add', { geom });
      session = res.session;
      return res.result.id;
    };
    const loops = [r.outer, ...r.islands].map((g) => [add(g)]);
    const res = execute(session, 'note.add', { body: { kind: 'hatch', loops, pattern: 'solid', spacing: 1, angle: 0 } });
    const note = resolveNotes(res.session.doc).get(res.result.id);
    if (!note?.ok) throw new Error(`case ${r.name} did not resolve`);
    return { name: r.name, outer: toJson(r.outer), islands: r.islands.map(toJson), area: note.r.area as number };
  });
}
