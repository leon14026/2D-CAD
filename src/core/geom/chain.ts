/**
 * Join: lines, arcs and open polylines that meet end to end become one polyline, in whatever
 * order and direction they were drawn. If the chain comes back to its start, the polyline is
 * closed. Where two pieces meet, the point of the piece already in the chain is kept.
 */
import { arcEndPoint, arcStartPoint } from './curves';
import { polyline, type Polyline, type PolylineVertex } from './polyline';
import { shapeMagnitude, type Shape } from './shape';
import { tolFor } from './tolerance';
import { distance } from './vec';

type Chain = PolylineVertex[];

function chainOf(s: Shape): Chain {
  switch (s.kind) {
    case 'segment':
      return [
        { x: s.start.x, y: s.start.y, bulge: 0 },
        { x: s.end.x, y: s.end.y, bulge: 0 },
      ];
    case 'arc': {
      const a = arcStartPoint(s);
      const b = arcEndPoint(s);
      return [
        { x: a.x, y: a.y, bulge: Math.tan(s.sweep / 4) },
        { x: b.x, y: b.y, bulge: 0 },
      ];
    }
    case 'circle':
      throw new RangeError('a circle is already closed, so it cannot be joined');
    case 'polyline':
      if (s.closed) throw new RangeError('a closed polyline cannot be joined to anything');
      return s.vertices.map((v) => ({ ...v }));
  }
}

/** The same chain run backwards: the edge from vertex i to i + 1 keeps its arc, turned the other way. */
export function reverseChain(c: readonly PolylineVertex[]): PolylineVertex[] {
  const m = c.length;
  return c.map((_, i) => {
    const v = c[m - 1 - i] as PolylineVertex;
    return { x: v.x, y: v.y, bulge: i < m - 1 ? -(c[m - 2 - i] as PolylineVertex).bulge : 0 };
  });
}

/** The polyline that joins `shapes` end to end. Throws RangeError if they don't all connect. */
export function joinShapes(shapes: readonly Shape[]): Polyline {
  if (shapes.length < 2) throw new RangeError('select at least two pieces to join');
  const tol = tolFor(...shapes.map(shapeMagnitude));
  const pieces = shapes.map(chainOf);
  let chain = pieces.shift() as Chain;
  const near = (a: PolylineVertex, b: PolylineVertex) => distance(a, b) <= tol;
  while (pieces.length > 0) {
    const head = chain[0] as PolylineVertex;
    const tail = chain[chain.length - 1] as PolylineVertex;
    const i = pieces.findIndex((p) => near(p[0] as PolylineVertex, tail) || near(p[p.length - 1] as PolylineVertex, tail) || near(p[0] as PolylineVertex, head) || near(p[p.length - 1] as PolylineVertex, head));
    if (i < 0) throw new RangeError('these pieces do not all meet end to end');
    const [p] = pieces.splice(i, 1) as [Chain];
    if (near(p[0] as PolylineVertex, tail) || near(p[p.length - 1] as PolylineVertex, tail)) {
      const forward = near(p[0] as PolylineVertex, tail) ? p : reverseChain(p);
      chain = [...chain.slice(0, -1), { ...tail, bulge: (forward[0] as PolylineVertex).bulge }, ...forward.slice(1)];
    } else {
      const forward = near(p[p.length - 1] as PolylineVertex, head) ? p : reverseChain(p);
      chain = [...forward.slice(0, -1), ...chain];
    }
  }
  const first = chain[0] as PolylineVertex;
  const lastV = chain[chain.length - 1] as PolylineVertex;
  if (chain.length > 3 && near(first, lastV)) return polyline(chain.slice(0, -1), true);
  return polyline(chain, false);
}
