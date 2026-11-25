/**
 * Grid maths. Pure functions only: no DOM, no canvas.
 *
 * Grid lines are always generated as integer multiples of the spacing (k × spacing)
 * so positions never accumulate floating-point error across the screen.
 */

/** Upper bound on lines per axis; protects against runaway loops from bad input. */
export const MAX_GRID_LINES = 10_000;

const STEPS = [1, 2, 5] as const;

function pow10(exp: number): number {
  return exp >= 0 ? 10 ** exp : 1 / 10 ** -exp;
}

function scaled(step: number, exp: number): number {
  // Dividing by an exact power of ten keeps values like 0.2 and 0.05 correctly rounded.
  return exp >= 0 ? step * 10 ** exp : step / 10 ** -exp;
}

/**
 * Smallest spacing in the 1-2-5 sequence (… 0.1, 0.2, 0.5, 1, 2, 5, 10 …) whose
 * on-screen size is at least `minPx`.
 */
export function chooseGridSpacing(pxPerUnit: number, minPx: number): number {
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) {
    throw new RangeError(`pxPerUnit must be a positive finite number, got ${pxPerUnit}`);
  }
  if (!Number.isFinite(minPx) || minPx <= 0) {
    throw new RangeError(`minPx must be a positive finite number, got ${minPx}`);
  }
  let exp = Math.floor(Math.log10(minPx / pxPerUnit)) - 1;
  for (;;) {
    for (const step of STEPS) {
      const spacing = scaled(step, exp);
      if (spacing * pxPerUnit >= minPx * (1 - 1e-12)) return spacing;
    }
    exp += 1;
  }
}

/**
 * How many minor lines make one major line, so that major lines always fall on
 * powers of ten: spacing 1 → every 10th, 2 → every 5th, 5 → every 2nd.
 */
export function majorEvery(spacing: number): number {
  const mantissa = Math.round(spacing / pow10(Math.floor(Math.log10(spacing))));
  switch (mantissa) {
    case 1:
      return 10;
    case 2:
      return 5;
    case 5:
      return 2;
    default:
      throw new RangeError(`spacing ${spacing} is not in the 1-2-5 sequence`);
  }
}

/** Integer indices k such that k × spacing lies within [min, max]. */
export function gridIndices(min: number, max: number, spacing: number): number[] {
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError(`spacing must be a positive finite number, got ${spacing}`);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new RangeError(`invalid range [${min}, ${max}]`);
  }
  const eps = 1e-9;
  // "+ 0" turns -0 (from e.g. Math.ceil(-1e-9)) into 0 so index 0 is always the axis.
  const first = Math.ceil(min / spacing - eps) + 0;
  const last = Math.floor(max / spacing + eps) + 0;
  const count = last - first + 1;
  if (count > MAX_GRID_LINES) {
    throw new RangeError(`grid would need ${count} lines (limit ${MAX_GRID_LINES})`);
  }
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(k);
  return out;
}
