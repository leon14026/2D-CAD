import { LINEAR_TOL } from './tolerance';

/** A point or vector in drawing units. World space is y-up. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

export function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product; positive when b is counter-clockwise from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) throw new RangeError('cannot normalise a zero-length vector');
  return { x: v.x / len, y: v.y / len };
}

/** Left-hand normal: v rotated 90° counter-clockwise. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Angle of v from the +x axis, counter-clockwise, in (-π, π]. */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function pointsEqual(a: Vec2, b: Vec2, tol: number = LINEAR_TOL): boolean {
  return distance(a, b) <= tol;
}

/** Largest absolute coordinate; used to scale tolerances. */
export function magnitude(v: Vec2): number {
  return Math.max(Math.abs(v.x), Math.abs(v.y));
}
