/**
 * The tool rail: a slim column at the left of the drawing area with one button per tool.
 * On a phone it is a horizontal strip of the current group along the bottom of the drawing.
 * The pointer at the top means "select" (no tool). The pressed button shows the tool in use.
 */
import type { ToolId } from '../core/tools';
import { el, icon, type IconName } from './dom';

export interface RailButton {
  readonly id: ToolId;
  readonly label: string;
  readonly key?: string;
  readonly icon: IconName;
}

export interface RailGroup {
  readonly label: string;
  readonly buttons: readonly RailButton[];
}

export class ToolRail {
  private readonly buttons = new Map<ToolId | null, HTMLButtonElement>();
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly groupEls = new Map<string, HTMLElement>();
  private group: string;

  constructor(
    readonly root: HTMLElement,
    private readonly groups: readonly RailGroup[],
    onPick: (id: ToolId | null) => void,
  ) {
    this.group = groups[0]?.label ?? 'Draw';
    const make = (id: ToolId | null, label: string, key: string | undefined, name: IconName) => {
      const title = key ? `${label} (${key.length === 1 ? key.toUpperCase() : key})` : label;
      const b = el('button', {
        className: 'al-rail-button',
        attrs: { type: 'button', 'aria-label': label, title, 'aria-pressed': 'false' },
        on: { click: () => onPick(id) },
      }, icon(name));
      this.buttons.set(id, b);
      return b;
    };
    const tabs = el('div', { className: 'al-rail-tabs', attrs: { role: 'tablist', 'aria-label': 'Tool groups' } });
    for (const g of groups) {
      const tab = el('button', {
        className: 'al-rail-tab',
        text: g.label,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(g.label === this.group) },
        on: { click: () => this.setGroup(g.label) },
      });
      this.tabButtons.set(g.label, tab);
      tabs.append(tab);
    }
    const tools = el('div', { className: 'al-rail-tools' }, make(null, 'Select', 'Esc', 'select'));
    for (const group of groups) {
      const wrap = el(
        'div',
        { className: 'al-rail-group', attrs: { role: 'group', 'aria-label': group.label } },
        ...group.buttons.map((b) => make(b.id, b.label, b.key, b.icon)),
      );
      this.groupEls.set(group.label, wrap);
      tools.append(wrap);
    }
    root.append(tabs, tools);
    this.setGroup(this.group);
  }

  /** Shows which tool is in use (null: selecting) and switches to that tool's group. */
  show(active: ToolId | null): void {
    for (const [id, b] of this.buttons) b.setAttribute('aria-pressed', String(id === active));
    if (active === null) return;
    const g = this.groups.find((group) => group.buttons.some((b) => b.id === active));
    if (g) this.setGroup(g.label);
  }

  private setGroup(label: string): void {
    this.group = label;
    this.root.dataset['group'] = label;
    for (const [name, tab] of this.tabButtons) tab.setAttribute('aria-selected', String(name === label));
    for (const [name, el] of this.groupEls) el.classList.toggle('is-current', name === label);
  }
}
