import '../ui/theme.css';
import './inspect.css';
import { APP_NAME } from '../app/brand';
import { FileFormatError, loadDocument } from '../core/doc';
import { formatCoordinate } from '../ui/format';
import { summarize, type Summary } from './summary';

const EXAMPLE_URL = './examples/bracket.archilite';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`${APP_NAME}: missing element ${selector}`);
  return node;
}

const text = requireElement('#al-text', HTMLTextAreaElement);
const result = requireElement('#al-result', HTMLElement);
const fileInput = requireElement('#al-file', HTMLInputElement);
const exampleButton = requireElement('#al-example', HTMLButtonElement);
const checkButton = requireElement('#al-check', HTMLButtonElement);

const f3 = (n: number) => formatCoordinate(n, 3);

function table(headers: string[], rows: (Node | string)[][], numeric: number[] = []): HTMLTableElement {
  return el(
    'table',
    { className: 'al-table' },
    el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { text: h })))),
    el(
      'tbody',
      {},
      ...rows.map((cells) =>
        el('tr', {}, ...cells.map((c, i) => el('td', numeric.includes(i) ? { className: 'al-num' } : {}, c))),
      ),
    ),
  );
}

function showSummary(s: Summary): void {
  const facts = el('dl', { className: 'al-facts' });
  const fact = (k: string, v: string) => facts.append(el('dt', { text: k }), el('dd', { text: v }));
  fact('Title', s.title);
  fact('Units', s.units);
  fact('Entities', String(s.entityCount));
  for (const [kind, n] of Object.entries(s.kinds)) fact(`  ${kind}`, String(n));
  if (s.extents) {
    const e = s.extents;
    fact('Extents', `(${f3(e.minX)}, ${f3(e.minY)}) to (${f3(e.maxX)}, ${f3(e.maxY)})`);
    fact('Overall size', `${f3(e.maxX - e.minX)} × ${f3(e.maxY - e.minY)} ${s.units}`);
  }

  const layers = table(
    ['Layer', 'Colour', 'Linetype', 'Weight (mm)', 'Shown', 'Locked', 'Entities'],
    s.layers.map((l) => {
      const swatch = el('span', { className: 'al-swatch' });
      swatch.style.background = l.color;
      return [l.name, el('span', {}, swatch, l.color), l.linetype, String(l.lineweight), l.visible ? 'yes' : 'no', l.locked ? 'yes' : 'no', String(l.entities)];
    }),
    [3, 6],
  );

  const entities = table(
    ['Id', 'Layer', 'Kind', 'Size', `Length (${s.units})`, `Area (${s.units}²)`],
    s.rows.map((r) => [String(r.id), r.layer, r.kind, r.size, f3(r.length), r.area === null ? '—' : f3(r.area)]),
    [0, 4, 5],
  );

  result.replaceChildren(
    el('div', { className: 'al-verdict al-verdict-ok', text: 'Valid ArchiLite drawing' }),
    facts,
    el('h2', { text: 'Layers' }),
    layers,
    el('h2', { text: 'Entities (in drawing order)' }),
    entities,
  );
}

function showError(message: string, path: string): void {
  const status = el('div', { className: 'al-verdict al-verdict-bad', text: 'This file cannot be opened' });
  status.append(el('small', { text: message }));
  if (path) status.append(el('small', { text: `Location: ${path}` }));
  result.replaceChildren(status);
}

function check(): void {
  try {
    showSummary(summarize(loadDocument(text.value)));
  } catch (err) {
    if (err instanceof FileFormatError) showError(err.message, err.path);
    else throw err;
  }
}

checkButton.addEventListener('click', check);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  text.value = await file.text();
  fileInput.value = '';
  check();
});

exampleButton.addEventListener('click', async () => {
  const response = await fetch(EXAMPLE_URL);
  text.value = await response.text();
  check();
});
