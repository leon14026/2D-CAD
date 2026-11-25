/**
 * ArchiLite drawing-area palette: warm drafting-vellum paper, graphite ink.
 * Original to ArchiLite. Shared by the renderer and the browser tests.
 */
export const palette = {
  paper: '#f4f1ea',
  gridMinor: '#e7e2d7',
  gridMajor: '#d2cab9',
  axisX: '#b5452f',
  axisY: '#2f7d55',
  origin: '#1f2a33',
} as const;

export type PaletteKey = keyof typeof palette;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`not a #rrggbb colour: ${hex}`);
  }
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
