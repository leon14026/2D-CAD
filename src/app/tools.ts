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

/** Annotation tools on the rail. */
export const ANNOTATE_BUTTONS: readonly ToolButton[] = [
  { id: 'dimLinear', label: 'Linear dimension', palette: 'Dimension a horizontal or vertical distance (linear)', key: 'd', icon: 'dimLinear' },
  { id: 'dimAligned', label: 'Aligned dimension', palette: 'Dimension the distance between two points (aligned)', icon: 'dimAligned' },
  { id: 'dimRadius', label: 'Radius dimension', palette: 'Dimension the radius of a circle or arc', icon: 'dimRadius' },
  { id: 'dimDiameter', label: 'Diameter dimension', palette: 'Dimension the diameter of a circle or arc', icon: 'dimDiameter' },
  { id: 'dimAngle', label: 'Angle dimension', palette: 'Dimension an angle', icon: 'dimAngle' },
  { id: 'text', label: 'Text', palette: 'Add text', key: 'x', icon: 'text' },
  { id: 'leader', label: 'Leader', palette: 'Add a leader: an arrow with a note', icon: 'leader' },
  { id: 'hatch', label: 'Hatch', palette: 'Hatch a closed shape', key: 'h', icon: 'hatch' },
];

/** Tools reached from the command palette and the selection panel. */
export const MORE_BUTTONS: readonly ToolButton[] = [
  { id: 'scale', label: 'Scale', palette: 'Scale the selection', icon: 'scale' },
  { id: 'chamfer', label: 'Chamfer', palette: 'Chamfer: cut the corner between two lines', icon: 'chamfer' },
  { id: 'array', label: 'Rectangular array', palette: 'Copy the selection in rows and columns (rectangular array)', icon: 'array' },
  { id: 'polarArray', label: 'Polar array', palette: 'Copy the selection round a centre (polar array)', icon: 'polarArray' },
  { id: 'roundCorners', label: 'Round every corner', palette: 'Round every corner of the selected polylines', icon: 'corners' },
  { id: 'cutCorners', label: 'Cut every corner', palette: 'Cut every corner of the selected polylines', icon: 'chamfer' },
  { id: 'centreMark', label: 'Centre mark', palette: 'Add a centre mark to a circle or arc', icon: 'centreMark' },
  { id: 'titleBlock', label: 'Title block', palette: 'Add a title block and sheet border', icon: 'titleBlock' },
];

export const TOOL_BUTTONS: readonly ToolButton[] = [...DRAW_BUTTONS, ...MODIFY_BUTTONS, ...ANNOTATE_BUTTONS, ...MORE_BUTTONS];

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
