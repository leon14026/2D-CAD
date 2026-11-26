/**
 * Constructions used by the drawing tools and snaps: rectangles, regular polygons and the
 * special points of curves (quadrants, perpendicular feet, tangent points). All analytic.
 */
import { cosSin, HALF_PI, normalizeAngle, TAU } from './angle';
import { arcContainsAngle, pointOnCircle, type Curve } from './curves';
import { polyline, type Polyline } from './polyline';
import { tolFor } from './tolerance';
import { add, angleOf, distance, dot, isFiniteVec, lengthSq, lerp, sub, type Vec2 } from './vec';

/** Closed rectangle with sides parallel to the axes and opposite corners `a` and `b`. */
export function rectangle(a: Vec2, b: Vec2): Polyline {
  if (!isFiniteVec(a) || !isFiniteVec(b)) throw new RangeError('rectangle corners must be finite');
  if (a.x === b.x || a.y === b.y) throw new RangeError('a rectangle needs a non-zero width and height');
  return polyline(
    [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ],
    true,
  );
}

export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 1024;

/**
 * Closed regular polygon about `center` with one corner at `corner` (inscribed in the circle
 * through that corner). Corners run counter-clockwise; corner k is `corner` turned by 2πk/n
 * about the centre, so whole quarter turns are exact.
 */
export function regularPolygon(center: Vec2, corner: Vec2, sides: number): Polyline {
  if (!Number.isInteger(sides) || sides < MIN_POLYGON_SIDES || sides > MAX_POLYGON_SIDES) {
    throw new RangeError(`a polygon needs a whole number of sides from ${MIN_POLYGON_SIDES} to ${MAX_POLYGON_SIDES}, got ${sides}`);
  }
  if (!isFiniteVec(center) || !isFiniteVec(corner)) throw new RangeError('polygon points must be finite');
  const v = sub(corner, center);
  if (v.x === 0 && v.y === 0) throw new RangeError('the polygon corner must differ from its centre');
  const vertices: Vec2[] = [];
  for (let k = 0; k < sides; k++) {
    const cs = cosSin((TAU * k) / sides);
    vertices.push(k === 0 ? corner : { x: center.x + v.x * cs.x - v.y * cs.y, y: center.y + v.x * cs.y + v.y * cs.x });
  }
  return polyline(vertices, true);
}

/** The quadrant points (directions 0°, 90°, 180°, 270°) that lie on a circle or arc. */
export function quadrantPoints(c: Curve): Vec2[] {
  if (c.kind === 'segment') return [];
  const out: Vec2[] = [];
  for (let k = 0; k < 4; k++) {
    const angle = k * HALF_PI;
    if (c.kind === 'circle' || arcContainsAngle(c, angle)) out.push(pointOnCircle(c.center, c.radius, angle));
  }
  return out;
}

/**
 * Feet of the perpendiculars from `from` to the curve: points where the line to `from` meets
 * the curve at a right angle. A segment has at most one (inside its length); a circle has two
 * (nearest and farthest); an arc keeps those within its sweep.
 */
export function perpendicularFeet(c: Curve, from: Vec2): Vec2[] {
  if (c.kind === 'segment') {
    const d = sub(c.end, c.start);
    const t = dot(sub(from, c.start), d) / lengthSq(d);
    return t >= 0 && t <= 1 ? [lerp(c.start, c.end, t)] : [];
  }
  const v = sub(from, c.center);
  if (v.x === 0 && v.y === 0) return []; // every point is perpendicular from the centre
  const angle = angleOf(v);
  const out: Vec2[] = [];
  for (const a of [angle, normalizeAngle(angle + Math.PI)]) {
    if (c.kind === 'circle' || arcContainsAngle(c, a)) out.push(pointOnCircle(c.center, c.radius, a));
  }
  return out;
}

/**
 * Points where a line from `from` touches the circle or arc at a tangent. None from inside
 * the circle or on it; two from outside (an arc keeps those within its sweep).
 */
export function tangentPoints(c: Curve, from: Vec2): Vec2[] {
  if (c.kind === 'segment') return [];
  const d = distance(from, c.center);
  if (d <= c.radius + tolFor(d, c.radius)) return [];
  const toFrom = angleOf(sub(from, c.center));
  // The tangent point sits at angle ±acos(r/d) either side of the direction to `from`.
  const half = Math.acos(c.radius / d);
  const out: Vec2[] = [];
  for (const a of [toFrom + half, toFrom - half]) {
    if (c.kind === 'circle' || arcContainsAngle(c, a)) out.push(pointOnCircle(c.center, c.radius, a));
  }
  return out;
}

/** The point `distance` along the direction `angle` from `from`; exact at whole quarter turns. */
export function polarPoint(from: Vec2, distance: number, angle: number): Vec2 {
  const cs = cosSin(angle);
  return add(from, { x: cs.x * distance, y: cs.y * distance });
}
