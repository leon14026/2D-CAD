/**
 * Mapping between ArchiLite's "#rrggbb" colours and the 255 colour numbers used in DXF
 * (the index many interchange files still carry). Number 7 is treated as black ink on
 * a light page, not white.
 */

export type Aci = number;

const CLASSIC: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [0, 0, 0],
  [128, 128, 128],
  [192, 192, 192],
];

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return [31, 42, 51];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function hueRgb(hue: number, sat: number, val: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const c = (val / 255) * (sat / 255);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val / 255 - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** RGB for colour numbers 1–255. */
export function aciToRgb(index: number): [number, number, number] {
  const i = Math.max(1, Math.min(255, Math.trunc(Math.abs(index))));
  if (i <= 9) return CLASSIC[i] as [number, number, number];
  if (i >= 250) {
    const t = [0, 51, 102, 153, 204, 255][i - 250] as number;
    return [t, t, t];
  }
  const row = Math.floor((i - 10) / 10);
  const col = (i - 10) % 10;
  const hue = row * 15;
  const shades: readonly [number, number][] = [
    [255, 255],
    [255, 204],
    [204, 204],
    [204, 153],
    [153, 153],
    [153, 102],
    [102, 102],
    [102, 51],
    [51, 51],
    [51, 0],
  ];
  const [val, sat] = shades[col] as [number, number];
  return hueRgb(hue, sat === 0 ? 0 : sat, val);
}

function toHex(rgb: readonly [number, number, number]): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function aciToHex(index: number): string {
  return toHex(aciToRgb(index));
}

const TABLE: readonly (readonly [number, number, number])[] = Array.from({ length: 255 }, (_, i) => aciToRgb(i + 1));

/** Nearest colour number for an "#rrggbb" colour. */
export function hexToAci(hex: string): Aci {
  const [r, g, b] = parseHex(hex);
  let best = 7;
  let bestD = Infinity;
  for (let i = 0; i < TABLE.length; i++) {
    const c = TABLE[i] as [number, number, number];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + 1;
    }
  }
  return best;
}
