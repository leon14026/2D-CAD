/**
 * ArchiLite drawing-area palette: matte drafting film, graphite ink, layout-fluid blue for the
 * selection and brass for the crossing box. Original to ArchiLite. Matches the tokens in
 * theme.css; shared by the renderer and the browser tests.
 */
export const palette = {
  paper: '#e9edeb',
  gridMinor: '#dde2df',
  gridMajor: '#c8d0cc',
  axisX: '#b5452f',
  axisY: '#2f7d55',
  origin: '#1f2a33',
  /** Selected entities and the window-selection box. */
  selection: '#2a3fb0',
  /** The crossing-selection box. */
  crossing: '#a8740f',
  /** Steel rules along the drawing area's edges. */
  ruler: '#d7dcdf',
  rulerInk: '#3d4a52',
  rulerLine: '#c9d0d4',
} as const;

export type PaletteKey = keyof typeof palette;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`not a #rrggbb colour: ${hex}`);
  }
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
