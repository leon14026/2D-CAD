/**
 * Side panels: layers on the left, the selection's properties on the right.
 * Both redraw from the store; all edits go through Actions (and so through commands).
 */
import { BY_LAYER, entitiesInDrawOrder, findLayer, resolveStyle, type Doc, type Entity } from '../core/doc';
import { polylineArea, shapeLength, unionBounds, type Bounds, type Shape } from '../core/geom';
import { entityBounds } from '../core/spatial';
import type { Actions } from '../app/actions';
import type { AppState, Store } from '../app/store';
import { el, icon } from './dom';
import { formatCoordinate } from './format';

const f = (n: number) => formatCoordinate(n, 3);
const deg = (rad: number) => `${formatCoordinate((rad * 180) / Math.PI, 2)}°`;

// ---------- layers ----------

export function mountLayersPanel(root: HTMLElement, store: Store, actions: Actions): void {
  const count = el('span');
  const list = el('ul', { className: 'al-layers' });
  root.append(el('div', { className: 'al-panel-head' }, el('h2', { text: 'Layers' }), count), list);

  const render = (s: AppState) => {
    const doc = s.session.doc;
    const perLayer = new Map<number, number>();
    for (const e of doc.entities.values()) perLayer.set(e.layer, (perLayer.get(e.layer) ?? 0) + 1);
    count.textContent = `${doc.layers.length}`;
    list.replaceChildren(
      ...doc.layers.map((l) => {
        const swatch = el('span', { className: 'al-swatch' });
        swatch.style.background = l.color;
        const current = doc.settings.currentLayer === l.id;
        const eye = el(
          'button',
          {
            className: `al-toggle${l.visible ? '' : ' is-off'}`,
            attrs: {
              type: 'button',
              'aria-pressed': String(!l.visible),
              'aria-label': `${l.visible ? 'Hide' : 'Show'} layer ${l.name}`,
              title: l.visible ? 'Hide layer' : 'Show layer',
            },
            on: { click: () => actions.setLayerVisible(l.id, !l.visible) },
          },
          icon(l.visible ? 'eye' : 'eyeOff'),
        );
        const lock = el(
          'button',
          {
            className: `al-toggle${l.locked ? ' is-off' : ''}`,
            attrs: {
              type: 'button',
              'aria-pressed': String(l.locked),
              'aria-label': `${l.locked ? 'Unlock' : 'Lock'} layer ${l.name}`,
              title: l.locked ? 'Unlock layer' : 'Lock layer',
            },
            on: { click: () => actions.setLayerLocked(l.id, !l.locked) },
          },
          icon(l.locked ? 'lock' : 'unlock'),
        );
        return el(
          'li',
          {
            className: `al-layer${current ? ' is-current' : ''}${l.visible ? '' : ' is-hidden'}`,
            attrs: { 'data-layer': String(l.id) },
          },
          swatch,
          el('button', {
            className: 'al-layer-name',
            text: l.name,
            attrs: { type: 'button', title: current ? 'Current layer: new lines go here' : 'Make this the current layer' },
            on: { click: () => actions.setCurrentLayer(l.id) },
          }),
          el('span', { className: 'al-layer-count', text: String(perLayer.get(l.id) ?? 0) }),
          eye,
          lock,
        );
      }),
    );
  };
  render(store.get());
  store.subscribe((s, p) => {
    if (s.session.doc.layers !== p.session.doc.layers || s.session.doc !== p.session.doc) render(s);
  });
}

// ---------- selection ----------

function shapeRows(s: Shape): [string, string][] {
  switch (s.kind) {
    case 'segment': {
      const dx = s.end.x - s.start.x;
      const dy = s.end.y - s.start.y;
      return [
        ['Start', `${f(s.start.x)}, ${f(s.start.y)}`],
        ['End', `${f(s.end.x)}, ${f(s.end.y)}`],
        ['Length', f(Math.hypot(dx, dy))],
        ['Angle', deg(Math.atan2(dy, dx))],
      ];
    }
    case 'circle':
      return [
        ['Centre', `${f(s.center.x)}, ${f(s.center.y)}`],
        ['Radius', f(s.radius)],
        ['Diameter', f(2 * s.radius)],
        ['Circumference', f(shapeLength(s))],
        ['Area', f(Math.PI * s.radius * s.radius)],
      ];
    case 'arc':
      return [
        ['Centre', `${f(s.center.x)}, ${f(s.center.y)}`],
        ['Radius', f(s.radius)],
        ['Start angle', deg(s.start)],
        ['Sweep', `${deg(Math.abs(s.sweep))} ${s.sweep > 0 ? 'anticlockwise' : 'clockwise'}`],
        ['Arc length', f(shapeLength(s))],
      ];
    case 'polyline':
      return [
        ['Vertices', String(s.vertices.length)],
        ['Closed', s.closed ? 'yes' : 'no'],
        ['Length', f(shapeLength(s))],
        ...(s.closed ? ([['Area', f(Math.abs(polylineArea(s)))]] as [string, string][]) : []),
      ];
  }
}

const KIND: Record<Shape['kind'], string> = { segment: 'Line', circle: 'Circle', arc: 'Arc', polyline: 'Polyline' };

function props(rows: [string, string][], numeric = true): HTMLDListElement {
  return el(
    'dl',
    { className: 'al-props' },
    ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v, className: numeric && /\d/.test(v) ? 'al-num' : '' })]),
  );
}

function styleRows(doc: Doc, e: Entity): [string, string][] {
  const r = resolveStyle(doc, e);
  const by = (v: unknown) => (v === BY_LAYER ? ' (by layer)' : '');
  return [
    ['Layer', findLayer(doc, e.layer)?.name ?? '?'],
    ['Colour', `${r.color}${by(e.color)}`],
    ['Linetype', `${r.linetype}${by(e.linetype)}`],
    ['Lineweight', `${r.lineweight} mm${by(e.lineweight)}`],
  ];
}

export function mountSelectionPanel(root: HTMLElement, store: Store): void {
  const head = el('span');
  const body = el('div', { className: 'al-panel-body' });
  root.append(el('div', { className: 'al-panel-head' }, el('h2', { text: 'Selection' }), head), body);

  const render = (s: AppState) => {
    const doc = s.session.doc;
    const picked = entitiesInDrawOrder(doc).filter((e) => s.selection.has(e.id));
    head.textContent = picked.length ? `${picked.length} selected` : '';
    if (picked.length === 0) {
      body.replaceChildren(
        el('p', { className: 'al-hint', text: 'Nothing selected.' }),
        el('p', {
          className: 'al-hint',
          text: 'Click a line to select it. Drag left to right to select what lies inside the box; drag right to left to also take what it touches. Shift adds to the selection.',
        }),
      );
      return;
    }
    if (picked.length === 1) {
      const e = picked[0] as Entity;
      body.replaceChildren(
        props([['Kind', KIND[e.geom.kind]], ['Id', String(e.id)]], false),
        props(styleRows(doc, e), false),
        props(shapeRows(e.geom)),
      );
      return;
    }
    const kinds = new Map<string, number>();
    let length = 0;
    let bounds: Bounds | null = null;
    for (const e of picked) {
      kinds.set(KIND[e.geom.kind], (kinds.get(KIND[e.geom.kind]) ?? 0) + 1);
      length += shapeLength(e.geom);
      const b = entityBounds(e);
      bounds = bounds ? unionBounds(bounds, b) : b;
    }
    const b = bounds as Bounds;
    body.replaceChildren(
      props([...kinds].map(([k, n]) => [k, String(n)] as [string, string]), false),
      props([
        ['Total length', f(length)],
        ['Width', f(b.maxX - b.minX)],
        ['Height', f(b.maxY - b.minY)],
        ['Lower left', `${f(b.minX)}, ${f(b.minY)}`],
      ]),
    );
  };
  render(store.get());
  store.subscribe((s, p) => {
    if (s.selection !== p.selection || s.session.doc !== p.session.doc) render(s);
  });
}
