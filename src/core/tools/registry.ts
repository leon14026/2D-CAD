import { arcCenterTool, arcTool, circleTool, lineTool, polygonTool, polylineTool, rectangleTool } from './draw';
import {
  arrayTool,
  chamferTool,
  copyTool,
  cutCornersTool,
  extendTool,
  filletTool,
  mirrorTool,
  moveTool,
  offsetTool,
  polarArrayTool,
  rotateTool,
  roundCornersTool,
  scaleTool,
  trimTool,
} from './modify';
import type { ToolDef } from './tool';

/** Every interactive tool, by id. */
export const TOOLS = {
  line: lineTool,
  polyline: polylineTool,
  circle: circleTool,
  arc: arcTool,
  arcCenter: arcCenterTool,
  rectangle: rectangleTool,
  polygon: polygonTool,
  move: moveTool,
  copy: copyTool,
  rotate: rotateTool,
  scale: scaleTool,
  mirror: mirrorTool,
  offset: offsetTool,
  trim: trimTool,
  extend: extendTool,
  fillet: filletTool,
  chamfer: chamferTool,
  array: arrayTool,
  polarArray: polarArrayTool,
  roundCorners: roundCornersTool,
  cutCorners: cutCornersTool,
} as const satisfies Record<string, ToolDef>;

export type ToolId = keyof typeof TOOLS;

export function isToolId(id: string): id is ToolId {
  return Object.hasOwn(TOOLS, id);
}
