/**
 * The example drawing shipped at public/examples/bracket.archilite, built entirely through
 * commands. A generic mounting plate: 100 × 60 mm with 5 mm corner radii, four Ø8 holes 10 mm
 * from the edges, a central 30 × 10 slot, and centre lines.
 */
import {
  createSession,
  execute,
  newDocument,
  type CommandId,
  type Doc,
  type ParamsOf,
  type ResultOf,
  type Session,
} from '../../../../src/core/doc';
import { circle, polyline, segment, vec } from '../../../../src/core/geom';

export const BRACKET = {
  width: 100,
  height: 60,
  cornerRadius: 5,
  holeDiameter: 8,
  holeInset: 10,
  slot: { centre: vec(50, 30), length: 30, width: 10 },
} as const;

export function buildExampleBracket(): Doc {
  let session: Session = createSession(newDocument({ title: 'Example bracket', units: 'mm' }));
  const run = <K extends CommandId>(id: K, params: ParamsOf<K>): ResultOf<K> => {
    const r = execute(session, id, params);
    session = r.session;
    return r.result;
  };

  const outline = run('layer.add', { name: 'Outline', color: '#1f2a33', lineweight: 0.5 }).id;
  const holes = run('layer.add', { name: 'Holes', color: '#0e7c7b', lineweight: 0.35 }).id;
  const centre = run('layer.add', { name: 'Centre lines', color: '#b5452f', linetype: 'dash-dot', lineweight: 0.18 }).id;
  run('layer.setCurrent', { id: outline });
  run('layer.delete', { id: 1 }); // the empty Default layer

  const { width: w, height: h, cornerRadius: r } = BRACKET;
  const corner = Math.tan(Math.PI / 8); // bulge of a 90° anticlockwise arc
  run('entity.add', {
    geom: polyline(
      [
        { x: r, y: 0 },
        { x: w - r, y: 0, bulge: corner },
        { x: w, y: r },
        { x: w, y: h - r, bulge: corner },
        { x: w - r, y: h },
        { x: r, y: h, bulge: corner },
        { x: 0, y: h - r },
        { x: 0, y: r, bulge: corner },
      ],
      true,
    ),
  });

  const inset = BRACKET.holeInset;
  const centres = [vec(inset, inset), vec(w - inset, inset), vec(w - inset, h - inset), vec(inset, h - inset)];
  for (const c of centres) run('entity.add', { layer: holes, geom: circle(c, BRACKET.holeDiameter / 2) });

  const { centre: sc, length: sl, width: sw } = BRACKET.slot;
  const straight = sl - sw; // distance between the slot's end-arc centres
  run('entity.add', {
    layer: holes,
    geom: polyline(
      [
        { x: sc.x - straight / 2, y: sc.y - sw / 2 },
        { x: sc.x + straight / 2, y: sc.y - sw / 2, bulge: 1 },
        { x: sc.x + straight / 2, y: sc.y + sw / 2 },
        { x: sc.x - straight / 2, y: sc.y + sw / 2, bulge: 1 },
      ],
      true,
    ),
  });

  const arm = BRACKET.holeDiameter / 2 + 2; // centre lines run 2 mm past each hole
  for (const c of centres) {
    run('entity.add', { layer: centre, geom: segment(vec(c.x - arm, c.y), vec(c.x + arm, c.y)) });
    run('entity.add', { layer: centre, geom: segment(vec(c.x, c.y - arm), vec(c.x, c.y + arm)) });
  }
  run('entity.add', { layer: centre, geom: segment(vec(sc.x - sl / 2 - 3, sc.y), vec(sc.x + sl / 2 + 3, sc.y)) });
  run('entity.add', { layer: centre, geom: segment(vec(sc.x, sc.y - sw / 2 - 3), vec(sc.x, sc.y + sw / 2 + 3)) });

  return session.doc;
}
