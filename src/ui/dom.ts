/**
 * Tiny DOM helpers. Text always goes in through textContent, never innerHTML, so drawing
 * content (layer names, titles from files) can't inject markup.
 */
type Child = Node | string | null | undefined | false;

export interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [type, fn] of Object.entries(props.on ?? {})) node.addEventListener(type, fn as EventListener);
  for (const c of children) if (c) node.append(c);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * ArchiLite's own line icons, drawn on a 16 × 16 grid. Each is a list of SVG path strings.
 */
export const ICONS = {
  undo: ['M5.5 3.5 2.5 6.5l3 3', 'M2.5 6.5h7a4 4 0 0 1 0 8h-3'],
  redo: ['M10.5 3.5l3 3-3 3', 'M13.5 6.5h-7a4 4 0 0 0 0 8h3'],
  open: ['M1.5 4.5v8h13v-6.5h-6.5l-1.5-1.5z', 'M1.5 4.5h5'],
  save: ['M8 1.5v8', 'M5 6.5l3 3 3-3', 'M2 11v3h12v-3'],
  export: ['M8 9.5V1.5', 'M5 4.5l3-3 3 3', 'M2.5 9.5v4h11v-4'],
  search: ['M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z', 'M10.3 10.3 14 14'],
  fit: ['M2 5.5V2h3.5', 'M10.5 2H14v3.5', 'M14 10.5V14h-3.5', 'M5.5 14H2v-3.5', 'M5.5 8h5', 'M8 5.5v5'],
  eye: ['M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z', 'M8 6.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z'],
  eyeOff: ['M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z', 'M2.5 13.5l11-11'],
  lock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
  unlock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0'],
  // Tools: a pointer for selecting, then one drawing per tool.
  select: ['M4 2.5v10.5l2.9-2.5 2 4.2 1.8-.9-2-4.1h3.8z'],
  line: ['M3.5 12.5l9-9', 'M2.5 11.5h2v2h-2z', 'M11.5 2.5h2v2h-2z'],
  polyline: ['M2 12.5 5.5 5l4 5.5L14 3.5'],
  circle: ['M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z', 'M8 7.4v1.2'],
  arc: ['M2.5 12.5a5.5 5.5 0 0 1 11 0', 'M1.5 12.5h2', 'M12.5 12.5h2', 'M8 6.2v1.6'],
  arcCenter: ['M2.5 12.5a5.5 5.5 0 0 1 11 0', 'M8 12.5h.01', 'M8 12.5 12 8.7'],
  rectangle: ['M2.5 4h11v8h-11z'],
  polygon: ['M8 2 13.2 5v6L8 14l-5.2-3V5z'],
  // Modify tools.
  move: ['M8 1.5v13', 'M1.5 8h13', 'M6 3.5 8 1.5l2 2', 'M6 12.5l2 2 2-2', 'M3.5 6 1.5 8l2 2', 'M12.5 6l2 2-2 2'],
  copy: ['M2.5 5.5h8v8h-8z', 'M5.5 5.5v-3h8v8h-3'],
  rotate: ['M13 8a5 5 0 1 1-1.5-3.6', 'M11.8 1.8v2.8H9'],
  scale: ['M2.5 7.5v6h6', 'M2.5 2.5h11v11', 'M6 10l7.5-7.5', 'M9.5 2.5h4v4'],
  mirror: ['M8 1.5v13', 'M6 4 2 12h4z', 'M10 4l4 8h-4z'],
  offset: ['M2 12.5c2-6 10-6 12 0', 'M2 8.5c2-6 10-6 12 0'],
  trim: ['M2 8h4.5', 'M9.5 8H14', 'M8 2v12', 'M4.5 6l3 4', 'M7.5 6l-3 4'],
  extend: ['M2 8h8', 'M13 2v12', 'M8 6l2 2-2 2'],
  fillet: ['M2.5 13.5v-6a5 5 0 0 1 5-5h6'],
  chamfer: ['M2.5 13.5V7l4.5-4.5h6.5'],
  array: ['M2.5 2.5h4v4h-4z', 'M9.5 2.5h4v4h-4z', 'M2.5 9.5h4v4h-4z', 'M9.5 9.5h4v4h-4z'],
  polarArray: ['M8 1.8v.01', 'M14.2 8h-.01', 'M8 14.2v.01', 'M1.8 8h.01', 'M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'],
  join: ['M2 12 6 4h4l4 8', 'M5.2 5.6h.01', 'M10.8 5.6h.01'],
  explode: ['M2 12l4-8', 'M10 4l4 8', 'M7.5 3h1'],
  remove: ['M3 4.5h10', 'M6.5 4.5V2.5h3v2', 'M4.5 4.5l.7 9h5.6l.7-9'],
  corners: ['M2.5 13.5v-6a5 5 0 0 1 5-5h6', 'M9 13.5h4.5V9'],
  // Annotation tools.
  dimLinear: ['M2.5 3.5v9', 'M13.5 3.5v9', 'M2.5 8h11', 'M5.5 6 2.5 8l3 2', 'M10.5 6l3 2-3 2'],
  dimAligned: ['M1.3 9.1l5.6 5.6', 'M9.1 1.3l5.6 5.6', 'M4.1 11.9 11.9 4.1', 'M4.1 8.9v3h3', 'M8.9 4.1h3v3'],
  dimRadius: ['M8 2.5a5.5 5.5 0 1 0 5.5 5.5', 'M8 8l4-4', 'M9.8 4.1h2.1v2.1'],
  dimDiameter: ['M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M3.5 12.5l9-9', 'M3.5 9.5v3h3', 'M9.5 3.5h3v3'],
  dimAngle: ['M2.5 13.5h11', 'M2.5 13.5 11 3.5', 'M7.5 13.5a5 5 0 0 0-1.8-3.83'],
  text: ['M3 3.5h10', 'M8 3.5v9', 'M6 12.5h4'],
  leader: ['M2.5 13.5 7 8h6.5', 'M2.5 13.5v-3.2', 'M2.5 13.5h3.2', 'M9 5h4.5'],
  centreMark: ['M8 1.5v13', 'M1.5 8h13', 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  hatch: ['M2.5 2.5h11v11h-11z', 'M2.5 9l6.5-6.5', 'M2.5 13.5l11-11', 'M6 13.5l7.5-7.5', 'M10 13.5l3.5-3.5'],
  titleBlock: ['M2 2.5h12v11H2z', 'M2 10h12', 'M7 10v3.5', 'M2 12h5'],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'al-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function requireElement<T extends Element>(selector: string, type: new () => T, root: ParentNode = document): T {
  const node = root.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`missing element ${selector}`);
  return node;
}
