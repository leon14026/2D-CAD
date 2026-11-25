/** Formats a coordinate for display, never showing "-0.000". */
export function formatCoordinate(value: number, decimals = 3): string {
  const text = value.toFixed(decimals);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}
