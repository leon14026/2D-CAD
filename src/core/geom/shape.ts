import type { Bounds } from './bounds';
import { curveBounds, curveLength, curveMagnitude, type Curve } from './curves';
import { polylineBounds, polylineLength, polylineMagnitude, type Polyline } from './polyline';

/** Every geometric primitive the kernel understands. */
export type Shape = Curve | Polyline;

export function shapeBounds(s: Shape): Bounds {
  return s.kind === 'polyline' ? polylineBounds(s) : curveBounds(s);
}

export function shapeLength(s: Shape): number {
  return s.kind === 'polyline' ? polylineLength(s) : curveLength(s);
}

export function shapeMagnitude(s: Shape): number {
  return s.kind === 'polyline' ? polylineMagnitude(s) : curveMagnitude(s);
}
