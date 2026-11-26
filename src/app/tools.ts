/** How each tool is shown in the tool rail, the command palette and the keyboard. */
import type { SnapKind } from '../core/spatial';
import type { ToolId } from '../core/tools';
import type { IconName } from '../ui/dom';

export interface ToolButton {
  readonly id: ToolId;
  /** Button name and tooltip, such as "Line". */
  readonly label: string;
  /** Command palette entry, such as "Draw lines". */
  readonly palette: string;
  /** Single-letter shortcut, if any. */
  readonly key?: string;
  readonly icon: IconName;
}

export const DRAW_BUTTONS: readonly ToolButton[] = [
  { id: 'line', label: 'Line', palette: 'Draw lines', key: 'l', icon: 'line' },
  { id: 'polyline', label: 'Polyline', palette: 'Draw a polyline', key: 'p', icon: 'polyline' },
  { id: 'circle', label: 'Circle', palette: 'Draw circles', key: 'c', icon: 'circle' },
  { id: 'arc', label: 'Arc through three points', palette: 'Draw an arc through three points', key: 'a', icon: 'arc' },
  { id: 'arcCenter', label: 'Arc from its centre', palette: 'Draw an arc from its centre', icon: 'arcCenter' },
  { id: 'rectangle', label: 'Rectangle', palette: 'Draw rectangles', key: 'r', icon: 'rectangle' },
  { id: 'polygon', label: 'Polygon', palette: 'Draw a regular polygon', key: 'n', icon: 'polygon' },
];

export const TOOL_BUTTONS: readonly ToolButton[] = [...DRAW_BUTTONS];

/** Snap kinds as they read in a sentence: "Snap to endpoints". */
export const SNAP_NAMES: Readonly<Record<SnapKind, string>> = {
  endpoint: 'endpoints',
  intersection: 'intersections',
  midpoint: 'midpoints',
  center: 'centres',
  quadrant: 'quadrants',
  perpendicular: 'perpendicular points',
  tangent: 'tangent points',
  nearest: 'the nearest point on a line',
};
