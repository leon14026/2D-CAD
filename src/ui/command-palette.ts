/**
 * The command palette (Ctrl+K): type a few letters of what you want to do, press Enter.
 */
import { el } from './dom';

export interface PaletteEntry {
  readonly label: string;
  readonly keys?: string;
  readonly run: () => void;
  readonly enabled?: () => boolean;
}

/** Entries whose label contains every typed word, in order of where the first word appears. */
export function filterEntries<T extends { label: string }>(entries: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries
    .map((e) => ({ e, label: e.label.toLowerCase() }))
    .filter(({ label }) => words.every((w) => label.includes(w)))
    .sort((a, b) => a.label.indexOf(words[0] as string) - b.label.indexOf(words[0] as string))
    .map(({ e }) => e);
}

export class CommandPalette {
  private backdrop: HTMLElement | null = null;
  private returnFocus: Element | null = null;

  constructor(private readonly entries: () => readonly PaletteEntry[]) {}

  get isOpen(): boolean {
    return this.backdrop !== null;
  }

  open(): void {
    if (this.backdrop) return;
    this.returnFocus = document.activeElement;
    const input = el('input', {
      attrs: { type: 'text', placeholder: 'Type a command', 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'al-palette-list' },
    });
    const list = el('ul', { attrs: { role: 'listbox', id: 'al-palette-list' } });
    let shown: PaletteEntry[] = [];
    let active = 0;

    const render = () => {
      shown = filterEntries(this.entries().filter((e) => e.enabled?.() ?? true), input.value);
      active = Math.min(active, Math.max(0, shown.length - 1));
      if (shown.length === 0) {
        list.replaceChildren(el('li', { className: 'al-palette-empty', text: 'No command matches. Try "zoom", "open" or "layer".' }));
        return;
      }
      list.replaceChildren(
        ...shown.map((entry, i) =>
          el(
            'li',
            {
              attrs: { role: 'option', 'aria-selected': String(i === active) },
              on: {
                mousemove: () => {
                  if (active !== i) {
                    active = i;
                    render();
                  }
                },
                click: () => this.choose(entry),
              },
            },
            el('span', { text: entry.label }),
            entry.keys ? el('kbd', { text: entry.keys }) : null,
          ),
        ),
      );
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('input', () => {
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        active = Math.min(active + 1, shown.length - 1);
        render();
      } else if (e.key === 'ArrowUp') {
        active = Math.max(active - 1, 0);
        render();
      } else if (e.key === 'Enter') {
        const entry = shown[active];
        if (entry) this.choose(entry);
      } else if (e.key === 'Escape') {
        this.close();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    });

    this.backdrop = el(
      'div',
      { className: 'al-palette-backdrop', on: { mousedown: (e) => e.target === this.backdrop && this.close() } },
      el('div', { className: 'al-palette', attrs: { role: 'dialog', 'aria-label': 'Command palette' } }, input, list),
    );
    document.body.append(this.backdrop);
    render();
    input.focus();
  }

  close(): void {
    this.backdrop?.remove();
    this.backdrop = null;
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus();
  }

  private choose(entry: PaletteEntry): void {
    this.close();
    entry.run();
  }
}
