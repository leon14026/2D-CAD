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
  search: ['M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z', 'M10.3 10.3 14 14'],
  fit: ['M2 5.5V2h3.5', 'M10.5 2H14v3.5', 'M14 10.5V14h-3.5', 'M5.5 14H2v-3.5', 'M5.5 8h5', 'M8 5.5v5'],
  eye: ['M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z', 'M8 6.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z'],
  eyeOff: ['M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z', 'M2.5 13.5l11-11'],
  lock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
  unlock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0'],
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
