export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/**
 * Size of each unit in micrometres. All are exact integers (1 in = 25.4 mm by definition),
 * so conversions round once instead of compounding decimal factors.
 */
export const MICROMETRES_PER_UNIT: Readonly<Record<LengthUnit, number>> = Object.freeze({
  mm: 1_000,
  cm: 10_000,
  m: 1_000_000,
  in: 25_400,
  ft: 304_800,
});

export const LENGTH_UNITS: readonly LengthUnit[] = Object.freeze(['mm', 'cm', 'm', 'in', 'ft']);

/** The unit name in the UI: "Treat drawing units as millimetres". */
export const UNIT_WORDS: Readonly<Record<LengthUnit, string>> = Object.freeze({
  mm: 'millimetres',
  cm: 'centimetres',
  m: 'metres',
  in: 'inches',
  ft: 'feet',
});

export function isLengthUnit(value: string): value is LengthUnit {
  return (LENGTH_UNITS as readonly string[]).includes(value);
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value;
  return (value * MICROMETRES_PER_UNIT[from]) / MICROMETRES_PER_UNIT[to];
}
