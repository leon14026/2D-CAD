/**
 * Drawing tools: line, polyline, circle, two kinds of arc, rectangle and polygon.
 *
 * Circles, arcs, rectangles and polygons start again after each one, so several can be drawn
 * in a row; Enter or Esc ends the tool. Lines chain from point to point.
 */
import {
  angleOf,
  arc,
  arcFromCenter,
  arcThrough,
  ccwSweep,
  circle,
  degToRad,
  distance,
  MAX_POLYGON_SIDES,
  MIN_POLYGON_SIDES,
  polyline,
  rectangle,
  regularPolygon,
  segment,
  sub,
  type Shape,
  type Vec2,
} from '../geom';
import {
  addShape,
  EMPTY_STATE,
  last,
  next,
  NOT_HERE,
  refuse,
  samePoint,
  type Prompt,
  type ToolDef,
  type ToolOption,
  type ToolState,
} from './tool';

export const SAME_POINT = 'That is the same point as the last one.';
const MORE_THAN_ZERO = 'The size must be more than 0.';

function segmentOrNothing(a: Vec2, b: Vec2): Shape[] {
  return samePoint(a, b) ? [] : [segment(a, b)];
}

const firstPoint = (text: string): Prompt => ({ text, accepts: 'point', options: [], enter: 'finish' });

/** Starts the tool again for another object, counting the one just made. */
function again(s: ToolState, keep: Partial<ToolState> = {}): ToolState {
  return { ...EMPTY_STATE, count: s.count + 1, ...keep };
}

export const lineTool: ToolDef = {
  id: 'line',
  label: 'Line',
  start: () => EMPTY_STATE,
  prompt(s) {
    if (s.step === 0) return firstPoint('First point');
    const options: ToolOption[] = [];
    if (s.count >= 1) options.push({ key: 'u', label: 'Undo the last line' });
    if (s.count >= 2) options.push({ key: 'c', label: 'Close' });
    return { text: 'Next point', accepts: 'point', options, enter: 'finish' };
  },
  base: (s) => (s.points.length > 0 ? last(s.points) : null),
  input(s, i) {
    if (i.kind === 'enter') return next(null);
    if (i.kind === 'point') {
      if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
      const from = last(s.points);
      if (samePoint(from, i.point)) return refuse(s, SAME_POINT);
      return next({ ...s, points: [...s.points, i.point], count: s.count + 1 }, [addShape(segment(from, i.point))]);
    }
    if (i.kind === 'option' && i.key === 'u' && s.count >= 1) {
      return next({ ...s, points: s.points.slice(0, -1), count: s.count - 1 }, [], { undo: 1 });
    }
    if (i.kind === 'option' && i.key === 'c' && s.count >= 2) {
      const first = s.points[0] as Vec2;
      const end = last(s.points);
      return next(null, samePoint(first, end) ? [] : [addShape(segment(end, first))]);
    }
    return refuse(s, NOT_HERE);
  },
  preview: (s, cursor) => (s.step === 0 ? [] : segmentOrNothing(last(s.points), cursor)),
};

export const polylineTool: ToolDef = {
  id: 'polyline',
  label: 'Polyline',
  start: () => EMPTY_STATE,
  prompt(s) {
    if (s.step === 0) return firstPoint('First point');
    const options: ToolOption[] = [];
    if (s.points.length >= 2) options.push({ key: 'u', label: 'Undo the last point' });
    if (s.points.length >= 3) options.push({ key: 'c', label: 'Close' });
    return { text: 'Next point', accepts: 'point', options, enter: 'finish' };
  },
  base: (s) => (s.points.length > 0 ? last(s.points) : null),
  input(s, i) {
    if (i.kind === 'enter') return next(null, s.points.length >= 2 ? [addShape(polyline(s.points, false))] : []);
    if (i.kind === 'point') {
      if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
      if (samePoint(last(s.points), i.point)) return refuse(s, SAME_POINT);
      return next({ ...s, points: [...s.points, i.point] });
    }
    if (i.kind === 'option' && i.key === 'u' && s.points.length >= 2) return next({ ...s, points: s.points.slice(0, -1) });
    if (i.kind === 'option' && i.key === 'c' && s.points.length >= 3) {
      // Ending on the first point already closes the shape; don't repeat that corner.
      const corners = samePoint(s.points[0] as Vec2, last(s.points)) ? s.points.slice(0, -1) : s.points;
      if (corners.length < 3) return refuse(s, 'A closed polyline needs at least three corners.');
      return next(null, [addShape(polyline(corners, true))]);
    }
    return refuse(s, NOT_HERE);
  },
  preview: (s, cursor) => (s.step === 0 ? [] : [polyline([...s.points, cursor], false)]),
};

export const circleTool: ToolDef = {
  id: 'circle',
  label: 'Circle',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    if (s.step === 0) return firstPoint('Centre');
    const r = ctx.memory.radius;
    return {
      text: s.flag ? 'Diameter, or a point on the circle' : 'Radius, or a point on the circle',
      accepts: 'pointOrNumber',
      options: [{ key: 'd', label: s.flag ? 'Type a radius instead' : 'Type a diameter instead' }],
      ...(r !== null && { defaultValue: s.flag ? 2 * r : r }),
    };
  },
  base: (s) => (s.points.length > 0 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    const make = (r: number) => {
      if (!(r > 0)) return refuse(s, MORE_THAN_ZERO);
      return next(again(s), [addShape(circle(s.points[0] as Vec2, r))], { memory: { radius: r } });
    };
    if (s.step === 0) {
      if (i.kind === 'point') return next({ ...s, step: 1, points: [i.point] });
      return i.kind === 'enter' ? next(null) : refuse(s, NOT_HERE);
    }
    switch (i.kind) {
      case 'point':
        return make(distance(s.points[0] as Vec2, i.point));
      case 'number':
        return make(s.flag ? i.value / 2 : i.value);
      case 'enter':
        return ctx.memory.radius === null ? refuse(s, 'Type a radius, or click a point on the circle.') : make(ctx.memory.radius);
      case 'option':
        return i.key === 'd' ? next({ ...s, flag: !s.flag }) : refuse(s, NOT_HERE);
      default:
        return refuse(s, NOT_HERE);
    }
  },
  preview(s, cursor) {
    if (s.step === 0) return [];
    const r = distance(s.points[0] as Vec2, cursor);
    return r > 0 ? [circle(s.points[0] as Vec2, r)] : [];
  },
};

export const IN_A_LINE = 'These three points are in a line, so they do not make an arc.';

export const arcTool: ToolDef = {
  id: 'arc',
  label: 'Arc through three points',
  start: () => EMPTY_STATE,
  prompt(s) {
    if (s.step === 0) return firstPoint('Start point');
    return { text: s.step === 1 ? 'A point on the arc' : 'End point', accepts: 'point', options: [], enter: 'finish' };
  },
  base: (s) => (s.points.length > 0 ? last(s.points) : null),
  input(s, i) {
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
    if (s.points.some((p) => samePoint(p, i.point))) return refuse(s, 'Each point must differ from the others.');
    if (s.step === 1) return next({ ...s, step: 2, points: [...s.points, i.point] });
    const a = arcThrough(s.points[0] as Vec2, s.points[1] as Vec2, i.point);
    return a ? next(again(s), [addShape(a)]) : refuse(s, IN_A_LINE);
  },
  preview(s, cursor) {
    if (s.step === 0) return [];
    if (s.step === 1) return segmentOrNothing(s.points[0] as Vec2, cursor);
    const a = arcThrough(s.points[0] as Vec2, s.points[1] as Vec2, cursor);
    return a ? [a] : [];
  },
};

export const arcCenterTool: ToolDef = {
  id: 'arcCenter',
  label: 'Arc from its centre',
  start: () => EMPTY_STATE,
  prompt(s) {
    if (s.step === 0) return firstPoint('Centre');
    if (s.step === 1) return { text: 'Start point', accepts: 'point', options: [], enter: 'finish' };
    return {
      text: 'End point, or the angle to turn in degrees',
      accepts: 'pointOrNumber',
      options: [{ key: 'd', label: s.flag ? 'Turn anticlockwise' : 'Turn clockwise' }],
      enter: 'finish',
    };
  },
  base: (s) => (s.points.length > 0 ? (s.points[0] as Vec2) : null),
  input(s, i) {
    if (i.kind === 'enter') return next(null);
    if (s.step === 0) return i.kind === 'point' ? next({ ...s, step: 1, points: [i.point] }) : refuse(s, NOT_HERE);
    const center = s.points[0] as Vec2;
    if (s.step === 1) {
      if (i.kind !== 'point') return refuse(s, NOT_HERE);
      if (samePoint(center, i.point)) return refuse(s, 'The start point must differ from the centre.');
      return next({ ...s, step: 2, points: [center, i.point] });
    }
    const start = s.points[1] as Vec2;
    switch (i.kind) {
      case 'point': {
        const a = arcFromCentre(center, start, i.point, !s.flag);
        return a ? next(again(s), [addShape(a)]) : refuse(s, 'The end must be in a different direction from the start.');
      }
      case 'number': {
        if (!(Math.abs(i.value) > 0 && Math.abs(i.value) < 360)) {
          return refuse(s, 'The angle must be more than 0° and less than 360°.');
        }
        return next(again(s), [addShape(arc(center, distance(center, start), angleOf(sub(start, center)), degToRad(i.value)))]);
      }
      case 'option':
        return i.key === 'd' ? next({ ...s, flag: !s.flag }) : refuse(s, NOT_HERE);
      default:
        return refuse(s, NOT_HERE);
    }
  },
  preview(s, cursor) {
    if (s.step === 0) return [];
    const center = s.points[0] as Vec2;
    if (s.step === 1) return segmentOrNothing(center, cursor);
    const a = arcFromCentre(center, s.points[1] as Vec2, cursor, !s.flag);
    return a ? [a] : [];
  },
};

/** The arc about `center` from `start` round to the direction of `end`, or null if there is no turn. */
function arcFromCentre(center: Vec2, start: Vec2, end: Vec2, ccw: boolean) {
  if (samePoint(center, end)) return null;
  const turn = ccwSweep(angleOf(sub(start, center)), angleOf(sub(end, center)));
  return turn === 0 ? null : arcFromCenter(center, start, end, ccw);
}

export const rectangleTool: ToolDef = {
  id: 'rectangle',
  label: 'Rectangle',
  start: () => EMPTY_STATE,
  prompt: (s) => (s.step === 0 ? firstPoint('First corner') : { text: 'Opposite corner', accepts: 'point', options: [], enter: 'finish' }),
  base: (s) => (s.points.length > 0 ? (s.points[0] as Vec2) : null),
  input(s, i) {
    if (i.kind === 'enter') return next(null);
    if (i.kind !== 'point') return refuse(s, NOT_HERE);
    if (s.step === 0) return next({ ...s, step: 1, points: [i.point] });
    const a = s.points[0] as Vec2;
    if (a.x === i.point.x || a.y === i.point.y) {
      return refuse(s, 'A rectangle needs a width and a height. Move the corner off the line through the first one.');
    }
    return next(again(s), [addShape(rectangle(a, i.point), true)]);
  },
  preview(s, cursor) {
    if (s.step === 0) return [];
    const a = s.points[0] as Vec2;
    return a.x === cursor.x || a.y === cursor.y ? segmentOrNothing(a, cursor) : [rectangle(a, cursor)];
  },
};

export const polygonTool: ToolDef = {
  id: 'polygon',
  label: 'Polygon',
  start: () => EMPTY_STATE,
  prompt(s, ctx) {
    if (s.step === 0) return { text: 'Number of sides', accepts: 'number', options: [], defaultValue: ctx.memory.sides };
    if (s.step === 1) return firstPoint('Centre');
    return { text: 'A corner, or the radius to the corners', accepts: 'pointOrNumber', options: [], enter: 'finish' };
  },
  base: (s) => (s.step === 2 ? (s.points[0] as Vec2) : null),
  input(s, i, ctx) {
    if (s.step === 0) {
      const n = i.kind === 'number' ? i.value : i.kind === 'enter' ? ctx.memory.sides : null;
      if (n === null) return refuse(s, NOT_HERE);
      if (!Number.isInteger(n) || n < MIN_POLYGON_SIDES || n > MAX_POLYGON_SIDES) {
        return refuse(s, `A polygon needs a whole number of sides from ${MIN_POLYGON_SIDES} to ${MAX_POLYGON_SIDES}.`);
      }
      return next({ ...s, step: 1, values: [n] }, [], { memory: { sides: n } });
    }
    if (i.kind === 'enter') return next(null);
    if (s.step === 1) return i.kind === 'point' ? next({ ...s, step: 2, points: [i.point] }) : refuse(s, NOT_HERE);
    const center = s.points[0] as Vec2;
    const sides = s.values[0] as number;
    let corner: Vec2;
    if (i.kind === 'point') {
      if (samePoint(center, i.point)) return refuse(s, 'The corner must differ from the centre.');
      corner = i.point;
    } else if (i.kind === 'number') {
      if (!(i.value > 0)) return refuse(s, MORE_THAN_ZERO);
      corner = { x: center.x + i.value, y: center.y };
    } else {
      return refuse(s, NOT_HERE);
    }
    return next(again(s, { step: 1, values: [sides] }), [addShape(regularPolygon(center, corner, sides))]);
  },
  preview(s, cursor) {
    if (s.step < 2) return [];
    const center = s.points[0] as Vec2;
    return samePoint(center, cursor) ? [] : [regularPolygon(center, cursor, s.values[0] as number)];
  },
};

export const DRAW_TOOLS: readonly ToolDef[] = Object.freeze([
  lineTool,
  polylineTool,
  circleTool,
  arcTool,
  arcCenterTool,
  rectangleTool,
  polygonTool,
]);
