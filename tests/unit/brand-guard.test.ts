import { describe, expect, it } from 'vitest';
import { DEFAULT_PATHS, scanPaths, scanText } from '../../scripts/brand-guard.mjs';
import { APP_NAME } from '../../src/app/brand';

describe('brand guard', () => {
  it.each([
    'Open in AutoCAD',
    'auto-cad compatible',
    'Powered by Autodesk',
    'A CADCraft fork',
    'made by artcraft',
    'like Archicad',
    'load acad.pat for hatches',
    'font: txt.shx',
  ])('flags "%s"', (line) => {
    expect(scanText(line, 'x.ts')).not.toHaveLength(0);
  });

  it.each([
    'academy',
    'cadence of autosave',
    'ArchiLite',
    'crafted with care',
    'architecture',
    'a DXF file',
  ])('does not flag "%s"', (line) => {
    expect(scanText(line, 'x.ts')).toEqual([]);
  });

  it('reports the line number', () => {
    expect(scanText('ok\nok\nAutoCAD here', 'f.ts')[0]?.line).toBe(3);
  });

  it('passes on the real application source', () => {
    expect(scanPaths(DEFAULT_PATHS)).toEqual([]);
  });

  it('allows our own name', () => {
    expect(scanText(APP_NAME, 'brand.ts')).toEqual([]);
  });
});
