/**
 * ArchiLite's tolerance model (see ROADMAP.md, "Accuracy model").
 *
 * Linear tolerance scales with the size of the geometry involved:
 *   tol = LINEAR_TOL × max(1, largest coordinate or radius)
 * so a 1 mm part is compared to 1e-9 mm and a 10 m site plan to 1e-5 mm.
 */

/** Base linear tolerance, in drawing units. */
export const LINEAR_TOL = 1e-9;

/** Angular tolerance, in radians. */
export const ANGULAR_TOL = 1e-12;

/** Linear tolerance for geometry whose coordinates and radii reach the given magnitudes. */
export function tolFor(...magnitudes: number[]): number {
  let m = 1;
  for (const v of magnitudes) {
    const a = Math.abs(v);
    if (a > m) m = a;
  }
  return LINEAR_TOL * m;
}

export function nearlyEqual(a: number, b: number, tol: number = LINEAR_TOL): boolean {
  return Math.abs(a - b) <= tol;
}
