/**
 * The small box beside the cursor while a tool is in use: what the tool wants next, a field
 * for typed points and numbers, the distance and angle from the last point, and the keys
 * that apply. It never takes clicks, so it can't get in the way of the drawing.
 */
import { INPUT_EXAMPLES, type Prompt } from '../core/tools';
import type { Point } from '../render/viewport';
import { el } from './dom';

export interface EntryContent {
  readonly tool: string;
  readonly prompt: Prompt;
  /** Cursor position in the drawing area, in CSS pixels. */
  readonly at: Point | null;
  /** Distance and angle from the last point, already formatted. */
  readonly readout: string | null;
  readonly error: string | null;
}

/** Gap between the cursor and the box, in CSS pixels. */
const OFFSET = 18;

export class CursorEntry {
  readonly input: HTMLInputElement;
  private readonly head: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly error: HTMLElement;
  private readonly keys: HTMLElement;
  private last: Point = { x: 64, y: 40 };

  constructor(readonly root: HTMLElement) {
    this.head = el('span', { className: 'al-entry-tool' });
    this.prompt = el('span', { className: 'al-entry-prompt' });
    this.input = el('input', {
      className: 'al-entry-input',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Type a point or a number' },
    });
    this.readout = el('div', { className: 'al-entry-readout' });
    this.error = el('div', { className: 'al-entry-error', attrs: { role: 'alert' } });
    this.keys = el('div', { className: 'al-entry-keys' });
    root.append(el('div', { className: 'al-entry-head' }, this.head, this.prompt), this.input, this.readout, this.error, this.keys);
  }

  /** True while the user is typing into the box. */
  get typing(): boolean {
    return document.activeElement === this.input;
  }

  get value(): string {
    return this.input.value;
  }

  /** Starts typing with the character that was pressed. */
  begin(char: string): void {
    this.input.value = char;
    this.input.focus();
  }

  clear(): void {
    this.input.value = '';
    if (this.typing) this.input.blur();
  }

  show(content: EntryContent | null): void {
    if (!content) {
      // Called on every pan and zoom frame with no tool in use: only touch the page if needed.
      if (this.root.hidden && this.input.value === '') return;
      this.root.hidden = true;
      this.clear();
      return;
    }
    const { prompt } = content;
    this.root.hidden = false;
    this.head.textContent = content.tool;
    this.prompt.textContent = prompt.text;
    this.input.placeholder = placeholder(prompt);
    this.readout.textContent = content.readout ?? '';
    this.readout.hidden = content.readout === null;
    this.error.textContent = content.error ?? '';
    this.error.hidden = content.error === null;
    const keys = prompt.options.map((o) => keyHint(o.key.toUpperCase(), o.label));
    if (prompt.defaultValue !== undefined) keys.push(keyHint('Enter', `Use ${trim(prompt.defaultValue)}`));
    else if (prompt.enter) keys.push(keyHint('Enter', 'Finish'));
    keys.push(keyHint('Esc', 'Stop'));
    this.keys.replaceChildren(...keys);
    if (content.at) this.last = content.at;
    this.place();
  }

  /** Keeps the box beside the cursor and inside the drawing area. */
  private place(): void {
    const { x, y } = this.last;
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const parent = this.root.parentElement;
    const maxX = (parent?.clientWidth ?? Infinity) - 8;
    const maxY = (parent?.clientHeight ?? Infinity) - 8;
    const left = x + OFFSET + w > maxX ? x - OFFSET - w : x + OFFSET;
    const top = y + OFFSET + h > maxY ? y - OFFSET - h : y + OFFSET;
    this.root.style.transform = `translate(${Math.max(8, Math.round(left))}px, ${Math.max(8, Math.round(top))}px)`;
  }
}

function placeholder(prompt: Prompt): string {
  if (prompt.accepts === 'number') return 'A number';
  if (prompt.accepts === 'pointOrNumber') return `A number, or ${INPUT_EXAMPLES.split('   ')[0]}`;
  if (prompt.accepts === 'point') return INPUT_EXAMPLES;
  if (prompt.accepts === 'text') return 'Type the text';
  return '';
}

function keyHint(key: string, label: string): HTMLElement {
  return el('span', { className: 'al-entry-key' }, el('kbd', { text: key }), label);
}

/** A remembered value without trailing zeros: 4, 2.5, 0.125. */
function trim(v: number): string {
  return String(Number(v.toFixed(6)));
}
