/**
 * Side panels: layers on the left, the selection's properties on the right.
 * Both redraw from the store; all edits go through Actions (and so through commands).
 */
import {
  BY_LAYER,
  compareDrawOrder,
  entitiesInDrawOrder,
  findLayer,
  HATCH_PATTERN_LABELS,
  HATCH_PATTERNS,
  insertBounds,
  notesInDrawOrder,
  resolveNotes,
  resolveStyle,
  SHEET_SIZES,
  TITLE_FIELD_LABELS,
  TITLE_FIELDS,
  type DimStyle,
  type Doc,
  type Entity,
  type Insert,
  type Note,
  type NoteBody,
} from '../core/doc';
import { degToRad, polylineArea, radToDeg, shapeLength, unionBounds, type Bounds, type Shape } from '../core/geom';
import { entityBounds } from '../core/spatial';
import type { Actions } from '../app/actions';
import type { AppState, Store } from '../app/store';
import type { ToolId } from '../core/tools';
import { el, icon, type IconName } from './dom';
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
    for (const ins of doc.inserts.values()) perLayer.set(ins.layer, (perLayer.get(ins.layer) ?? 0) + 1);
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
            attrs: {
              type: 'button',
              title: current ? `${l.name} (current layer: new lines go here)` : l.name,
            },
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

/** What the selection panel's buttons do. */
export interface SelectionActions {
  tool(id: ToolId): void;
  join(): void;
  explode(): void;
  remove(): void;
  editNote(id: number, patch: Record<string, unknown>): void;
  useDimStyle(name: string): void;
  saveDimStyle(style: DimStyle): void;
}

/** Buttons that change the selection, shown under its properties. */
function changeButtons(picked: readonly Entity[], a: SelectionActions, inserts: readonly Insert[] = []): HTMLElement {
  const anyPolyline = picked.some((e) => e.geom.kind === 'polyline');
  const anyInsert = inserts.length > 0;
  const items: [string, IconName, () => void, boolean, string?][] = [
    ['Move', 'move', () => a.tool('move'), true],
    ['Copy', 'copy', () => a.tool('copy'), true],
    ['Rotate', 'rotate', () => a.tool('rotate'), true],
    ['Scale', 'scale', () => a.tool('scale'), true],
    ['Mirror', 'mirror', () => a.tool('mirror'), true],
    ['Array', 'array', () => a.tool('array'), true],
    ['Polar array', 'polarArray', () => a.tool('polarArray'), true],
    ['Join', 'join', () => a.join(), picked.length >= 2],
    ['Explode', 'explode', () => a.explode(), anyPolyline || anyInsert],
    ['Round off', 'corners', () => a.tool('roundCorners'), anyPolyline, 'Round every corner of the selected polylines'],
    ['Delete', 'remove', () => a.remove(), true],
  ];
  return el(
    'div',
    { className: 'al-actions', attrs: { role: 'group', 'aria-label': 'Change the selection' } },
    ...items.map(([label, name, run, enabled, title]) => {
      const b = el('button', { className: 'al-action', attrs: { type: 'button', ...(title && { title }) }, on: { click: run } }, icon(name), label);
      b.disabled = !enabled;
      return b;
    }),
  );
}

// ---------- annotations ----------

const NOTE_KIND: Record<NoteBody['kind'], string> = {
  linear: 'Linear dimension',
  aligned: 'Aligned dimension',
  radius: 'Radius dimension',
  diameter: 'Diameter dimension',
  angle: 'Angle dimension',
  text: 'Text',
  leader: 'Leader',
  centre: 'Centre mark',
  hatch: 'Hatch',
  titleBlock: 'Title block',
};

let fieldCount = 0;

/** A label and its control as two cells of a form grid. */
function formRow(label: string, control: HTMLElement): HTMLElement[] {
  const id = `al-field-${++fieldCount}`;
  control.id = id;
  return [el('label', { text: label, attrs: { for: id } }), control];
}

function form(...rows: HTMLElement[][]): HTMLElement {
  return el('div', { className: 'al-form' }, ...rows.flat());
}

function textInput(value: string, commit: (v: string) => void): HTMLInputElement {
  const input = el('input', { className: 'al-field', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' } });
  input.value = value;
  input.addEventListener('change', () => commit(input.value));
  return input;
}

function textArea(value: string, commit: (v: string) => void): HTMLTextAreaElement {
  const area = el('textarea', { className: 'al-field al-field-area', attrs: { rows: '3', spellcheck: 'false' } });
  area.value = value;
  area.addEventListener('change', () => commit(area.value));
  return area;
}

function numberInput(value: number, commit: (v: number) => void, step = 'any', min?: number, max?: number): HTMLInputElement {
  const input = el('input', {
    className: 'al-field al-num',
    attrs: { type: 'number', step, ...(min !== undefined && { min: String(min) }), ...(max !== undefined && { max: String(max) }) },
  });
  input.value = String(value);
  input.addEventListener('change', () => {
    if (input.value.trim() !== '') commit(Number(input.value));
  });
  return input;
}

function selectInput<T extends string>(options: readonly (readonly [T, string])[], value: T, commit: (v: T) => void): HTMLSelectElement {
  const select = el('select', { className: 'al-field' }, ...options.map(([v, label]) => el('option', { text: label, attrs: { value: v } })));
  select.value = value;
  select.addEventListener('change', () => commit(select.value as T));
  return select;
}

const degrees = (rad: number) => Math.round(radToDeg(rad) * 1e6) / 1e6;

/** What can be edited about one annotation, and what it measures. */
function noteDetails(doc: Doc, n: Note, a: SelectionActions): HTMLElement[] {
  const b = n.body;
  const resolved = resolveNotes(doc).get(n.id);
  const rows: [string, string][] = [['Kind', NOTE_KIND[b.kind]], ['Id', String(n.id)], ['Layer', findLayer(doc, n.layer)?.name ?? '?']];
  if (resolved?.ok && resolved.r.text) rows.push(['Measures', resolved.r.text]);
  if (resolved?.ok && resolved.r.area !== undefined) rows.push(['Area', f(resolved.r.area)]);
  if ('style' in b) rows.push(['Style', b.style]);
  const out: HTMLElement[] = [props(rows, false)];
  const edit = (patch: Record<string, unknown>) => a.editNote(n.id, patch);
  switch (b.kind) {
    case 'text':
      out.push(
        form(
          formRow('Text', textArea(b.text, (v) => edit({ text: v }))),
          formRow('Height', numberInput(b.height, (v) => edit({ height: v }), 'any', 0)),
          formRow('Angle', numberInput(degrees(b.angle), (v) => edit({ angle: degToRad(v) }))),
          formRow('Aligned', selectInput([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as const, b.anchor, (v) => edit({ anchor: v }))),
        ),
      );
      break;
    case 'leader':
      out.push(form(formRow('Note', textArea(b.text, (v) => edit({ text: v })))));
      break;
    case 'centre':
      out.push(form(formRow('Mark', selectInput([['cross', 'Cross'], ['lines', 'Centre lines']] as const, b.extended ? 'lines' : 'cross', (v) => edit({ extended: v === 'lines' })))));
      break;
    case 'hatch':
      out.push(
        form(
          formRow('Pattern', selectInput(HATCH_PATTERNS.map((p) => [p, HATCH_PATTERN_LABELS[p]] as const), b.pattern, (v) => edit({ pattern: v }))),
          formRow('Angle', numberInput(degrees(b.angle), (v) => edit({ angle: degToRad(v) }))),
          formRow('Spacing', numberInput(b.spacing, (v) => edit({ spacing: v }), 'any', 0)),
        ),
      );
      break;
    case 'titleBlock':
      out.push(
        form(
          formRow('Sheet', selectInput(SHEET_SIZES.map((z) => [z, z] as const), b.size, (v) => edit({ size: v }))),
          ...TITLE_FIELDS.map((k) => formRow(TITLE_FIELD_LABELS[k], textInput(b.fields[k], (v) => edit({ fields: { ...b.fields, [k]: v } })))),
        ),
      );
      break;
    default:
      break;
  }
  return out;
}

let styleEditorOpen = false;

const STYLE_FIELDS: readonly [Exclude<keyof DimStyle, 'name'>, string, string][] = [
  ['textHeight', 'Text height', 'any'],
  ['arrowSize', 'Arrow length', 'any'],
  ['extGap', 'Gap to the feature', 'any'],
  ['extOver', 'Line past the arrow', 'any'],
  ['textGap', 'Gap round the text', 'any'],
  ['precision', 'Decimal places', '1'],
  ['anglePrecision', 'Angle decimal places', '1'],
  ['centreMark', 'Centre mark size', 'any'],
  ['centreOver', 'Centre line overrun', 'any'],
];

/** The dimension style in use, editable. Saving under a new name adds a style. */
function dimStyleEditor(doc: Doc, a: SelectionActions): HTMLElement {
  const styles = doc.settings.dimStyles;
  const current = styles.find((st) => st.name === doc.settings.currentDimStyle) ?? (styles[0] as DimStyle);
  const draft: Record<string, string | number> = { ...current };
  const picker = selectInput(
    styles.map((st) => [st.name, st.name] as const),
    current.name,
    (v) => a.useDimStyle(v),
  );
  const name = textInput(current.name, (v) => (draft['name'] = v));
  const save = el('button', {
    className: 'al-action',
    text: 'Save style',
    attrs: { type: 'button', title: 'Saves under this name: replaces the style of that name, or adds a new one, and uses it' },
    on: { click: () => a.saveDimStyle(draft as unknown as DimStyle) },
  });
  const details = el(
    'details',
    { className: 'al-style', ...(styleEditorOpen && { attrs: { open: '' } }) },
    el('summary', { text: `Dimension style: ${current.name}` }),
    form(
      formRow('Style in use', picker),
      formRow('Style name', name),
      ...STYLE_FIELDS.map(([key, label, step]) => formRow(label, numberInput(current[key], (v) => (draft[key] = v), step, 0, key === 'precision' || key === 'anglePrecision' ? 8 : undefined))),
    ),
    save,
  );
  details.addEventListener('toggle', () => {
    styleEditorOpen = details.open;
  });
  return details;
}

const STYLED: ReadonlySet<NoteBody['kind']> = new Set(['linear', 'aligned', 'radius', 'diameter', 'angle', 'leader', 'centre']);


export function mountSelectionPanel(root: HTMLElement, store: Store, actions: SelectionActions): void {
  const head = el('span');
  const body = el('div', { className: 'al-panel-body' });
  root.append(el('div', { className: 'al-panel-head' }, el('h2', { text: 'Selection' }), head), body);

  const render = (s: AppState) => {
    const doc = s.session.doc;
    const picked = entitiesInDrawOrder(doc).filter((e) => s.selection.has(e.id));
    const notes = notesInDrawOrder(doc).filter((n) => s.selection.has(n.id));
    const inserts = [...doc.inserts.values()].filter((ins) => s.selection.has(ins.id)).sort(compareDrawOrder);
    const total = picked.length + notes.length + inserts.length;
    head.textContent = total ? `${total} selected` : '';
    if (total === 0) {
      body.replaceChildren(
        el('p', { className: 'al-hint', text: 'Nothing selected.' }),
        el('p', {
          className: 'al-hint',
          text: 'Click a line to select it. Drag left to right to select what lies inside the box; drag right to left to also take what it touches. Shift adds to the selection.',
        }),
        dimStyleEditor(doc, actions),
      );
      return;
    }
    if (picked.length === 1 && notes.length === 0 && inserts.length === 0) {
      const e = picked[0] as Entity;
      body.replaceChildren(
        props([['Kind', KIND[e.geom.kind]], ['Id', String(e.id)]], false),
        props(styleRows(doc, e), false),
        props(shapeRows(e.geom)),
        changeButtons(picked, actions, inserts),
      );
      return;
    }
    if (picked.length === 0 && notes.length === 0 && inserts.length === 1) {
      const ins = inserts[0] as Insert;
      const b = insertBounds(doc, ins);
      body.replaceChildren(
        props(
          [
            ['Kind', 'Block insert'],
            ['Id', String(ins.id)],
            ['Block', ins.block],
            ['At', `${f(ins.at.x)}, ${f(ins.at.y)}`],
            ['Rotation', `${f(radToDeg(ins.rotation))}°`],
            ['Scale', f(ins.scale)],
            ...(ins.flipped ? ([['Mirrored', 'yes']] as [string, string][]) : []),
            ...(b ? ([['Width', f(b.maxX - b.minX)], ['Height', f(b.maxY - b.minY)]] as [string, string][]) : []),
          ],
          false,
        ),
        changeButtons(picked, actions, inserts),
      );
      return;
    }
    if (picked.length === 0 && notes.length === 1 && inserts.length === 0) {
      const n = notes[0] as Note;
      body.replaceChildren(...noteDetails(doc, n, actions), changeButtons(picked, actions, inserts), ...(STYLED.has(n.body.kind) ? [dimStyleEditor(doc, actions)] : []));
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
    for (const n of notes) kinds.set(NOTE_KIND[n.body.kind], (kinds.get(NOTE_KIND[n.body.kind]) ?? 0) + 1);
    if (inserts.length) kinds.set('Block insert', inserts.length);
    const measured: HTMLElement[] = [];
    if (bounds) {
      const b = bounds as Bounds;
      measured.push(
        props([
          ['Total length', f(length)],
          ['Width', f(b.maxX - b.minX)],
          ['Height', f(b.maxY - b.minY)],
          ['Lower left', `${f(b.minX)}, ${f(b.minY)}`],
        ]),
      );
    }
    body.replaceChildren(props([...kinds].map(([k, n]) => [k, String(n)] as [string, string]), false), ...measured, changeButtons(picked, actions, inserts));
  };
  render(store.get());
  store.subscribe((s, p) => {
    if (s.selection !== p.selection || s.session.doc !== p.session.doc) render(s);
  });
}
