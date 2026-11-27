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
export const LAYOUT_BUTTONS: readonly ToolButton[] = [
  { id: 'block', label: 'Block', palette: 'Turn the selection into a reusable block', icon: 'block' },
  { id: 'insert', label: 'Insert block', palette: 'Insert a block', icon: 'insert' },
  { id: 'coincident', label: 'Coincident', palette: 'Make two points coincident', icon: 'coincident' },
  { id: 'horizontal', label: 'Horizontal', palette: 'Keep two points at the same height', icon: 'horizontal' },
  { id: 'vertical', label: 'Vertical', palette: 'Keep two points in a vertical line', icon: 'vertical' },
  { id: 'constrainDistance', label: 'Distance constraint', palette: 'Hold the distance between two points', icon: 'constrainDistance' },
];

export const MORE_BUTTONS: readonly ToolButton[] = [
  { id: 'scale', label: 'Scale', palette: 'Scale the selection', icon: 'scale' },
  { id: 'chamfer', label: 'Chamfer', palette: 'Chamfer: cut the corner between two lines', icon: 'chamfer' },
  { id: 'array', label: 'Rectangular array', palette: 'Copy the selection in rows and columns (rectangular array)', icon: 'array' },
  { id: 'polarArray', label: 'Polar array', palette: 'Copy the selection round a centre (polar array)', icon: 'polarArray' },
  { id: 'roundCorners', label: 'Round every corner', palette: 'Round every corner of the selected polylines', icon: 'corners' },
  { id: 'cutCorners', label: 'Cut every corner', palette: 'Cut every corner of the selected polylines', icon: 'chamfer' },
  { id: 'centreMark', label: 'Centre mark', palette: 'Add a centre mark to a circle or arc', icon: 'centreMark' },
  { id: 'titleBlock', label: 'Title block', palette: 'Add a title block and sheet border', icon: 'titleBlock' },
  { id: 'parallel', label: 'Parallel', palette: 'Keep two lines parallel', icon: 'horizontal' },
  { id: 'perpendicular', label: 'Perpendicular', palette: 'Keep two lines perpendicular', icon: 'vertical' },
  { id: 'equal', label: 'Equal length', palette: 'Keep two lines the same length', icon: 'constrainDistance' },
  { id: 'concentric', label: 'Concentric', palette: 'Share a centre between two circles', icon: 'circle' },
  { id: 'tangent', label: 'Tangent', palette: 'Keep a circle tangent to a line or another circle', icon: 'circle' },
  { id: 'constrainRadius', label: 'Radius constraint', palette: 'Hold a circle or arc at a radius', icon: 'dimRadius' },
  { id: 'constrainLength', label: 'Length constraint', palette: 'Hold a line at a length', icon: 'constrainDistance' },
  { id: 'constrainAngle', label: 'Angle constraint', palette: 'Hold the angle between two lines', icon: 'dimAngle' },
  { id: 'fix', label: 'Fix a point', palette: 'Hold a point still', icon: 'lock' },
  { id: 'midpointConstraint', label: 'Midpoint', palette: 'Keep a point at the middle of a line', icon: 'coincident' },
];

export const TOOL_BUTTONS: readonly ToolButton[] = [...DRAW_BUTTONS, ...MODIFY_BUTTONS, ...ANNOTATE_BUTTONS, ...LAYOUT_BUTTONS, ...MORE_BUTTONS];

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
