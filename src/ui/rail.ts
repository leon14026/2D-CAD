/**
 * The tool rail: a slim column at the left of the drawing area with one button per tool.
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

  constructor(
    root: HTMLElement,
    groups: readonly RailGroup[],
    onPick: (id: ToolId | null) => void,
  ) {
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
    root.append(make(null, 'Select', 'Esc', 'select'));
    for (const group of groups) {
      root.append(
        el('div', { className: 'al-rail-group', attrs: { role: 'group', 'aria-label': group.label } }, ...group.buttons.map((b) => make(b.id, b.label, b.key, b.icon))),
      );
    }
  }

  /** Shows which tool is in use (null: selecting). */
  show(active: ToolId | null): void {
    for (const [id, b] of this.buttons) b.setAttribute('aria-pressed', String(id === active));
  }
}
