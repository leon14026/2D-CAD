import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHatchCases } from '../../fixtures/hatch-cases';

const APPROVED = resolve(__dirname, '../../fixtures/hatch-cases.json');

describe('hatch areas for the shapely check', () => {
  const cases = buildHatchCases();
  const text = `${JSON.stringify(cases, null, 1)}\n`;

  it('the approved file holds exactly the areas ArchiLite reports (UPDATE_REFERENCES=1 rewrites it)', () => {
    if (process.env['UPDATE_REFERENCES'] || !existsSync(APPROVED)) writeFileSync(APPROVED, text);
    expect(text).toBe(readFileSync(APPROVED, 'utf8'));
  });

  it('covers every kind of boundary, with and without islands', () => {
    expect(cases).toHaveLength(60);
    for (const kind of ['rectangle', 'polygon', 'circle', 'rounded rectangle', 'slot']) {
      const of = cases.filter((c) => c.name.startsWith(`${kind} `));
      expect(of.length, kind).toBeGreaterThan(5);
    }
    expect(cases.some((c) => c.islands.length === 0)).toBe(true);
    expect(cases.some((c) => c.islands.length >= 2)).toBe(true);
    expect(cases.every((c) => c.area > 0)).toBe(true);
  });
});
