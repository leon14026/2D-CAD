import { ccwSweep, cosSin, HALF_PI, normalizeAngle, sweepContains, TAU } from './angle';
import { boundsOfPoints, type Bounds } from './bounds';
import {
  add,
  angleOf,
  cross,
  distance,
  dot,
  isFiniteVec,
  lengthSq,
  lerp,
  magnitude,
  scale,
  sub,
  type Vec2,
} from './vec';

/** A finite straight line from `start` to `end`. */
export interface Segment {
  readonly kind: 'segment';
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface Circle {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly radius: number;
}

/**
 * A circular arc. `start` is the start angle in [0, 2π); `sweep` is signed
 * (positive = counter-clockwise) with 0 < |sweep| < 2π.
 */
export interface Arc {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  readonly start: number;
  readonly sweep: number;
}

export type Curve = Segment | Circle | Arc;

function requirePoint(p: Vec2, what: string): void {
  if (!isFiniteVec(p)) throw new RangeError(`${what} must have finite coordinates`);
}

function requireRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`radius must be a positive finite number, got ${radius}`);
  }
}

export function segment(start: Vec2, end: Vec2): Segment {
  requirePoint(start, 'segment start');
  requirePoint(end, 'segment end');
  if (start.x === end.x && start.y === end.y) {
    throw new RangeError('segment start and end are the same point');
  }
  return { kind: 'segment', start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
}

export function circle(center: Vec2, radius: number): Circle {
  requirePoint(center, 'circle centre');
  requireRadius(radius);
  return { kind: 'circle', center: { x: center.x, y: center.y }, radius };
}

export function arc(center: Vec2, radius: number, start: number, sweep: number): Arc {
  requirePoint(center, 'arc centre');
  requireRadius(radius);
  if (!Number.isFinite(start)) throw new RangeError('arc start angle must be finite');
  if (!Number.isFinite(sweep) || sweep === 0 || Math.abs(sweep) >= TAU) {
    throw new RangeError(`arc sweep must satisfy 0 < |sweep| < 2π, got ${sweep}`);
  }
  return {
    kind: 'arc',
    center: { x: center.x, y: center.y },
    radius,
    start: normalizeAngle(start),
    sweep,
  };
}

/** Point on a circle of the given centre and radius at `angle`. */
export function pointOnCircle(center: Vec2, radius: number, angle: number): Vec2 {
  return add(center, scale(cosSin(angle), radius));
}

export function arcStartPoint(a: Arc): Vec2 {
  return pointOnCircle(a.center, a.radius, a.start);
}

export function arcEndPoint(a: Arc): Vec2 {
  return pointOnCircle(a.center, a.radius, a.start + a.sweep);
}

export function arcMidPoint(a: Arc): Vec2 {
  return pointOnCircle(a.center, a.radius, a.start + a.sweep / 2);
}

/**
 * Arc about `center` from the direction of `startPoint` to the direction of `endPoint`.
 * The radius is taken from `startPoint`.
 */
export function arcFromCenter(center: Vec2, startPoint: Vec2, endPoint: Vec2, ccw = true): Arc {
  const radius = distance(center, startPoint);
  const a0 = angleOf(sub(startPoint, center));
  const a1 = angleOf(sub(endPoint, center));
  const sweep = ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
  return arc(center, radius, a0, sweep);
}

/** The circle through three points, or null if they are collinear or coincident. */
export function circleThrough(p1: Vec2, p2: Vec2, p3: Vec2): Circle | null {
  // Work relative to p1 for precision.
  const b = sub(p2, p1);
  const c = sub(p3, p1);
  const d = 2 * cross(b, c);
  const scaleSq = Math.max(lengthSq(b), lengthSq(c));
  if (scaleSq === 0 || Math.abs(d) <= 1e-12 * scaleSq) return null;
  const bb = lengthSq(b);
  const cc = lengthSq(c);
  const ux = (c.y * bb - b.y * cc) / d;
  const uy = (b.x * cc - c.x * bb) / d;
  const center = { x: p1.x + ux, y: p1.y + uy };
  return circle(center, Math.hypot(ux, uy));
}

/** The arc that starts at p1, passes through p2 and ends at p3, or null if collinear. */
export function arcThrough(p1: Vec2, p2: Vec2, p3: Vec2): Arc | null {
  const c = circleThrough(p1, p2, p3);
  if (!c) return null;
  const a1 = angleOf(sub(p1, c.center));
  const a2 = angleOf(sub(p2, c.center));
  const a3 = angleOf(sub(p3, c.center));
  const ccwTotal = ccwSweep(a1, a3);
  const sweep = ccwSweep(a1, a2) < ccwTotal ? ccwTotal : ccwTotal - TAU;
  return arc(c.center, c.radius, a1, sweep);
}

export function curveLength(c: Curve): number {
  switch (c.kind) {
    case 'segment':
      return distance(c.start, c.end);
    case 'circle':
      return TAU * c.radius;
    case 'arc':
      return c.radius * Math.abs(c.sweep);
  }
}

/** Point at parameter t in [0, 1] along the curve (circles start at angle 0, counter-clockwise). */
export function pointAt(c: Curve, t: number): Vec2 {
  switch (c.kind) {
    case 'segment':
      return lerp(c.start, c.end, t);
    case 'circle':
      return pointOnCircle(c.center, c.radius, TAU * t);
    case 'arc':
      return pointOnCircle(c.center, c.radius, c.start + c.sweep * t);
  }
}

/** Endpoints of a curve; circles have none. */
export function curveEndpoints(c: Curve): Vec2[] {
  switch (c.kind) {
    case 'segment':
      return [c.start, c.end];
    case 'circle':
      return [];
    case 'arc':
      return [arcStartPoint(c), arcEndPoint(c)];
  }
}

export function curveBounds(c: Curve): Bounds {
  switch (c.kind) {
    case 'segment':
      return boundsOfPoints([c.start, c.end]);
    case 'circle':
      return {
        minX: c.center.x - c.radius,
        minY: c.center.y - c.radius,
        maxX: c.center.x + c.radius,
        maxY: c.center.y + c.radius,
      };
    case 'arc': {
      const points = [arcStartPoint(c), arcEndPoint(c)];
      for (let k = 0; k < 4; k++) {
        const angle = k * HALF_PI;
        if (sweepContains(c.start, c.sweep, angle, 0)) {
          points.push(pointOnCircle(c.center, c.radius, angle));
        }
      }
      return boundsOfPoints(points);
    }
  }
}

/** Largest absolute coordinate the curve reaches; used to scale tolerances. */
export function curveMagnitude(c: Curve): number {
  switch (c.kind) {
    case 'segment':
      return Math.max(magnitude(c.start), magnitude(c.end));
    case 'circle':
    case 'arc':
      return magnitude(c.center) + c.radius;
  }
}

/** True if the arc covers the direction of `angle`, within `tol` radians. */
export function arcContainsAngle(a: Arc, angle: number, tol = 0): boolean {
  return sweepContains(a.start, a.sweep, angle, tol);
}

/**
 * centre + unit(v) × radius, accurate for any non-zero v. Scaling by the larger component
 * first keeps full precision even when v is tiny (subnormal) or huge, where a plain
 * v / |v| loses digits or overflows.
 */
function onRadius(center: Vec2, v: Vec2, radius: number): Vec2 {
  const m = Math.max(Math.abs(v.x), Math.abs(v.y));
  const ux = v.x / m;
  const uy = v.y / m;
  const l = Math.hypot(ux, uy);
  return { x: center.x + (ux / l) * radius, y: center.y + (uy / l) * radius };
}

/** Nearest point on the curve to `p`. */
export function closestPoint(c: Curve, p: Vec2): Vec2 {
  switch (c.kind) {
    case 'segment': {
      const d = sub(c.end, c.start);
      const t = dot(sub(p, c.start), d) / lengthSq(d);
      return lerp(c.start, c.end, Math.min(1, Math.max(0, t)));
    }
    case 'circle': {
      const v = sub(p, c.center);
      if (v.x === 0 && v.y === 0) return { x: c.center.x + c.radius, y: c.center.y };
      return onRadius(c.center, v, c.radius);
    }
    case 'arc': {
      const v = sub(p, c.center);
      if ((v.x !== 0 || v.y !== 0) && arcContainsAngle(c, angleOf(v))) {
        return onRadius(c.center, v, c.radius);
      }
      const s = arcStartPoint(c);
      const e = arcEndPoint(c);
      return distance(p, s) <= distance(p, e) ? s : e;
    }
  }
}

export function distanceToCurve(c: Curve, p: Vec2): number {
  return distance(p, closestPoint(c, p));
}
