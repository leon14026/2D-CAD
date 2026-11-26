import { arcCenterTool, arcTool, circleTool, lineTool, polygonTool, polylineTool, rectangleTool } from './draw';
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
} as const satisfies Record<string, ToolDef>;

export type ToolId = keyof typeof TOOLS;

export function isToolId(id: string): id is ToolId {
  return Object.hasOwn(TOOLS, id);
}
