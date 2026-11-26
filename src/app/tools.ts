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

/** Modify tools on the rail. */
export const MODIFY_BUTTONS: readonly ToolButton[] = [
  { id: 'move', label: 'Move', palette: 'Move the selection', key: 'm', icon: 'move' },
  { id: 'copy', label: 'Copy', palette: 'Copy the selection', icon: 'copy' },
  { id: 'rotate', label: 'Rotate', palette: 'Rotate the selection', icon: 'rotate' },
  { id: 'mirror', label: 'Mirror', palette: 'Mirror the selection', icon: 'mirror' },
  { id: 'offset', label: 'Offset', palette: 'Offset an object (a parallel copy)', key: 'o', icon: 'offset' },
  { id: 'trim', label: 'Trim', palette: 'Trim: cut objects back to where they cross', key: 't', icon: 'trim' },
  { id: 'extend', label: 'Extend', palette: 'Extend: lengthen objects to meet others', key: 'e', icon: 'extend' },
  { id: 'fillet', label: 'Fillet', palette: 'Fillet: round the corner between two lines', icon: 'fillet' },
];

/** Tools reached from the command palette and the selection panel. */
export const MORE_BUTTONS: readonly ToolButton[] = [
  { id: 'scale', label: 'Scale', palette: 'Scale the selection', icon: 'scale' },
  { id: 'chamfer', label: 'Chamfer', palette: 'Chamfer: cut the corner between two lines', icon: 'chamfer' },
  { id: 'array', label: 'Rectangular array', palette: 'Copy the selection in rows and columns (rectangular array)', icon: 'array' },
  { id: 'polarArray', label: 'Polar array', palette: 'Copy the selection round a centre (polar array)', icon: 'polarArray' },
  { id: 'roundCorners', label: 'Round every corner', palette: 'Round every corner of the selected polylines', icon: 'corners' },
  { id: 'cutCorners', label: 'Cut every corner', palette: 'Cut every corner of the selected polylines', icon: 'chamfer' },
];

export const TOOL_BUTTONS: readonly ToolButton[] = [...DRAW_BUTTONS, ...MODIFY_BUTTONS, ...MORE_BUTTONS];

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
