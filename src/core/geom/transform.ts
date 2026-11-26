import { cosSin, normalizeAngle } from './angle';
import { arc, circle, segment, type Curve } from './curves';
import { polyline, type Polyline } from './polyline';
import type { Shape } from './shape';
import { add, angleOf, dot, isFiniteVec, lengthSq, scale as scaleVec, sub, type Vec2 } from './vec';

/**
 * Rigid and similarity transforms. Each is applied directly to a shape's defining points
 * (and angles), so repeated edits never compound a matrix.
 */
export type Transform =
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'rotate'; readonly center: Vec2; readonly angle: number }
  | { readonly kind: 'scale'; readonly center: Vec2; readonly factor: number }
  | { readonly kind: 'mirror'; readonly a: Vec2; readonly b: Vec2 };

export function translate(dx: number, dy: number): Transform {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError('translation must be finite');
  return { kind: 'translate', dx, dy };
}

export function rotate(center: Vec2, angle: number): Transform {
  if (!isFiniteVec(center) || !Number.isFinite(angle)) throw new RangeError('rotation must be finite');
  return { kind: 'rotate', center, angle };
}

export function scaleAbout(center: Vec2, factor: number): Transform {
  if (!isFiniteVec(center) || !Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`scale factor must be a positive finite number, got ${factor}`);
  }
  return { kind: 'scale', center, factor };
}

/** Mirror across the infinite line through a and b. */
export function mirror(a: Vec2, b: Vec2): Transform {
  if (!isFiniteVec(a) || !isFiniteVec(b)) throw new RangeError('mirror axis must be finite');
  if (a.x === b.x && a.y === b.y) throw new RangeError('mirror axis needs two distinct points');
  return { kind: 'mirror', a, b };
}

/** The transform that undoes `t`. */
export function inverse(t: Transform): Transform {
  switch (t.kind) {
    case 'translate':
      return translate(-t.dx, -t.dy);
    case 'rotate':
      return rotate(t.center, -t.angle);
    case 'scale':
      return scaleAbout(t.center, 1 / t.factor);
    case 'mirror':
      return t;
  }
}

export function transformPoint(t: Transform, p: Vec2): Vec2 {
  switch (t.kind) {
    case 'translate':
      return { x: p.x + t.dx, y: p.y + t.dy };
    case 'rotate': {
      const cs = cosSin(t.angle);
      const v = sub(p, t.center);
      return add(t.center, { x: v.x * cs.x - v.y * cs.y, y: v.x * cs.y + v.y * cs.x });
    }
    case 'scale':
      return add(t.center, scaleVec(sub(p, t.center), t.factor));
    case 'mirror': {
      // Exact for horizontal and vertical axes.
      if (t.a.y === t.b.y) return { x: p.x, y: 2 * t.a.y - p.y };
      if (t.a.x === t.b.x) return { x: 2 * t.a.x - p.x, y: p.y };
      const u = sub(t.b, t.a);
      const foot = add(t.a, scaleVec(u, dot(sub(p, t.a), u) / lengthSq(u)));
      return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
    }
  }
}

function transformCurve(t: Transform, c: Curve): Curve {
  switch (c.kind) {
    case 'segment':
      return segment(transformPoint(t, c.start), transformPoint(t, c.end));
    case 'circle':
      return circle(transformPoint(t, c.center), t.kind === 'scale' ? c.radius * t.factor : c.radius);
    case 'arc': {
      const center = transformPoint(t, c.center);
      switch (t.kind) {
        case 'translate':
          return arc(center, c.radius, c.start, c.sweep);
        case 'rotate':
          return arc(center, c.radius, normalizeAngle(c.start + t.angle), c.sweep);
        case 'scale':
          return arc(center, c.radius * t.factor, c.start, c.sweep);
        case 'mirror': {
          const axis = angleOf(sub(t.b, t.a));
          return arc(center, c.radius, normalizeAngle(2 * axis - c.start), -c.sweep);
        }
      }
    }
  }
}

function transformPolyline(t: Transform, pl: Polyline): Polyline {
  const flip = t.kind === 'mirror' ? -1 : 1;
  return polyline(
    pl.vertices.map((v) => {
      const p = transformPoint(t, v);
      return { x: p.x, y: p.y, bulge: v.bulge === 0 ? 0 : v.bulge * flip };
    }),
    pl.closed,
  );
}

export function transformShape<S extends Shape>(t: Transform, s: S): S {
  return (s.kind === 'polyline' ? transformPolyline(t, s) : transformCurve(t, s)) as S;
}
