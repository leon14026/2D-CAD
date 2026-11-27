import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportDxf } from '../../../src/io/dxf'; // skip counts reuse a known DXF mapping
import {
  dwgIsEncrypted,
  dwgVersion,
  importDwg,
  looksLikeDwg,
  type DwgDecoder,
  type DwgHandle,
} from '../../../src/io/dwg';
import { IoError } from '../../../src/io/error';
import { expectClose, expectPoint } from '../core/helpers';
import { ARC, CIRCLE, LINE, POLYLINE, shapesDoc } from '../../fixtures/dwg/shapes';

const require = createRequire(import.meta.url);
const nodeCadkit = require('cadkit-wasm/node') as DwgDecoder;

const DWG_TOL = 1e-6;
const AC1015 = resolve('tests/fixtures/dwg/shapes-ac1015.dwg');
const AC1027 = resolve('tests/fixtures/dwg/shapes-ac1027.dwg');

function magic(version: string, extra = 40): Uint8Array {
  const bytes = new Uint8Array(Math.max(6, extra));
  for (let i = 0; i < version.length; i++) bytes[i] = version.charCodeAt(i);
  return bytes;
}

function unusedDecoder(): DwgDecoder {
  return {
    read: () => {
      throw new Error('decoder should not run');
    },
  };
}

function handle(partial: Partial<DwgHandle>): DwgHandle {
  return {
    info: () => ({ models: [{ index: 0, name: 'Model', entities: 0 }] }),
    explodeInserts: () => ({ truncated: false }),
    toJSON: () => ({ models: [{ name: 'Model', entities: [] }] }),
    toDxf: () => '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n',
    free: () => {},
    ...partial,
  };
}

function decoderOf(h: DwgHandle): DwgDecoder {
  return { read: () => h };
}

describe('DWG sniff and refusals', () => {
  it('recognises a DWG magic and not DXF or JSON', () => {
    expect(looksLikeDwg(magic('AC1015'))).toBe(true);
    expect(looksLikeDwg(magic('AC1027'))).toBe(true);
    expect(looksLikeDwg(new Uint8Array([0x30, 0x0a, 0x53]))).toBe(false);
    expect(looksLikeDwg(new Uint8Array(0))).toBe(false);
    expect(dwgVersion(magic('AC1015'))).toBe('AC1015');
  });

  it('refuses versions outside AC1014–AC1032 without calling the decoder', () => {
    expect(() => importDwg(magic('AC1009'), unusedDecoder())).toThrow(IoError);
    expect(() => importDwg(magic('AC1009'), unusedDecoder())).toThrow(/AC1009/);
    expect(() => importDwg(magic('AC1012'), unusedDecoder())).toThrow(/AC1012/);
    expect(() => importDwg(magic('AC1033'), unusedDecoder())).toThrow(/AC1033/);
  });

  it('refuses an encrypted R2004-and-later header without calling the decoder', () => {
    const bytes = magic('AC1018', 64);
    bytes[0x18] = 1;
    expect(dwgIsEncrypted(bytes)).toBe(true);
    expect(() => importDwg(bytes, unusedDecoder())).toThrow(/encrypted/);
    expect(dwgIsEncrypted(magic('AC1015', 64))).toBe(false);
  });

  it('maps a decoder encryption error to the same plain-words refusal', () => {
    const err = Object.assign(new Error('encrypted drawing, password required'), { kind: 'unsupported' });
    expect(() =>
      importDwg(
        magic('AC1015'),
        decoderOf(
          handle({
            explodeInserts: () => {
              throw err;
            },
          }),
        ),
      ),
    ).toThrow(/encrypted/);
  });

  it('refuses a truncated explode rather than importing a partial drawing', () => {
    expect(() => importDwg(magic('AC1015'), decoderOf(handle({ explodeInserts: () => ({ truncated: true }) })))).toThrow(
      /more than ArchiLite opens/,
    );
  });

  it('refuses bytes that are not a DWG', () => {
    expect(() => importDwg(new Uint8Array([0x30, 0x0a]), unusedDecoder())).toThrow(/not a DWG/);
  });

  it('maps other decoder failures to plain words', () => {
    const run = (kind: string, message: string) =>
      expect(() =>
        importDwg(
          magic('AC1015'),
          decoderOf(
            handle({
              explodeInserts: () => {
                throw Object.assign(new Error(message), { kind });
              },
            }),
          ),
        ),
      );
    run('unsupported', 'proxy object').toThrow(/cannot read/);
    run('invalid', 'bad crc').toThrow(/damaged/);
    run('truncated', 'eof').toThrow(/damaged/);
    run('unknown_format', '???').toThrow(/not a DWG/);
    run('limit_exceeded', 'too deep').toThrow(/more than ArchiLite opens/);
    run('other', 'boom').toThrow(/could not be read/);
    expect(() => importDwg(magic('AC1015'), decoderOf(handle({ explodeInserts: () => { throw new IoError('kept'); } })))).toThrow(
      'kept',
    );
  });
});

describe('DWG skip counts', () => {
  it('counts paper layouts and unsupported model-space kinds, then maps the rest as DXF', () => {
    const dxf = exportDxf(shapesDoc());
    const { doc, skipped } = importDwg(
      magic('AC1015'),
      decoderOf(
        handle({
          toJSON: () => ({
            models: [
              {
                name: 'Model',
                entities: [
                  { kind: { type: 'line' } },
                  { kind: { type: 'circle' } },
                  { kind: { type: 'arc' } },
                  { kind: { type: 'polyline' } },
                  { kind: { type: 'hatch' } },
                  { kind: { type: 'spline' } },
                  { kind: { type: 'ellipse' } },
                  { kind: { type: 'dimension' } },
                ],
              },
              { name: 'Paper Space', entities: [{ kind: { type: 'line' } }, { kind: { type: 'line' } }] },
            ],
          }),
          toDxf: () => dxf,
        }),
      ),
    );
    expect(doc.entities.size).toBe(4);
    expect(skipped).toBe(6);
  });
});

function expectShapes(bytes: Uint8Array): void {
  const { doc } = importDwg(bytes, nodeCadkit);
  expect(doc.settings.units).toBe('mm');
  expect(doc.entities.size).toBe(4);
  const geoms = [...doc.entities.values()].map((e) => e.geom);
  const line = geoms.find((g) => g.kind === 'segment');
  expect(line?.kind).toBe('segment');
  if (line?.kind !== 'segment') return;
  expectPoint(line.start, LINE.start, DWG_TOL);
  expectPoint(line.end, LINE.end, DWG_TOL);
  const circ = geoms.find((g) => g.kind === 'circle');
  expect(circ?.kind).toBe('circle');
  if (circ?.kind !== 'circle') return;
  expectPoint(circ.center, CIRCLE.center, DWG_TOL);
  expectClose(circ.radius, CIRCLE.radius, DWG_TOL);
  const a = geoms.find((g) => g.kind === 'arc');
  expect(a?.kind).toBe('arc');
  if (a?.kind !== 'arc') return;
  expectPoint(a.center, ARC.center, DWG_TOL);
  expectClose(a.radius, ARC.radius, DWG_TOL);
  expectClose(a.start, ARC.start, DWG_TOL);
  expectClose(a.sweep, ARC.sweep, DWG_TOL);
  const pl = geoms.find((g) => g.kind === 'polyline');
  expect(pl?.kind).toBe('polyline');
  if (pl?.kind !== 'polyline') return;
  expect(pl.closed).toBe(true);
  expect(pl.vertices).toHaveLength(POLYLINE.vertices.length);
  expectClose(pl.vertices[1]!.bulge, 1, DWG_TOL);
  expectPoint(pl.vertices[0]!, POLYLINE.vertices[0]!, DWG_TOL);
  expectPoint(pl.vertices[2]!, POLYLINE.vertices[2]!, DWG_TOL);
}

describe('DWG fixtures', () => {
  it('imports the AC1015 fixture to 1e-6 mm', () => {
    expect(existsSync(AC1015), `missing ${AC1015}; see tests/fixtures/dwg/README.md`).toBe(true);
    const bytes = new Uint8Array(readFileSync(AC1015));
    expect(dwgVersion(bytes)).toBe('AC1015');
    expectShapes(bytes);
  });

  it('imports the AC1027 fixture to 1e-6 mm', () => {
    expect(existsSync(AC1027), `missing ${AC1027}; see tests/fixtures/dwg/README.md`).toBe(true);
    const bytes = new Uint8Array(readFileSync(AC1027));
    expect(dwgVersion(bytes)).toBe('AC1027');
    expectShapes(bytes);
  });
});
