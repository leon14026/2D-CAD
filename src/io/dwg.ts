/**
 * DWG import (read only). The decoder is injected so this module stays free of
 * packages: the app loads cadkit-wasm on demand, and tests pass the Node build
 * or a fake. Mapping is the DXF importer's; cadkit's own DXF export omits
 * hatches, splines and similar, so skip counts come from the decoder's JSON.
 */
import { importDxf, type DxfImport } from './dxf';
import { IoError } from './error';

export const DWG_EXTENSION = '.dwg';

/** Magic strings ArchiLite opens (R14 through 2018). */
export const DWG_VERSIONS = ['AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'] as const;

const DWG_VERSION_SET = new Set<string>(DWG_VERSIONS);

/** Entity kinds the DXF mapper already draws. Anything else is skipped. */
const KEPT_KINDS = new Set([
  'line',
  'circle',
  'arc',
  'polyline',
  'lw_polyline',
  'lwpolyline',
  'polyline2d',
  'polyline_2d',
  '2d_polyline',
  'text',
  'm_text',
  'mtext',
  'insert',
]);

export interface DwgHandle {
  info(): { models: ReadonlyArray<{ index: number; name: string; entities: number }> };
  explodeInserts(): { truncated?: boolean } | void;
  toJSON(): {
    models?: ReadonlyArray<{
      name?: string;
      entities?: ReadonlyArray<{ kind?: { type?: string } }>;
    }>;
  };
  toDxf(version?: string): string;
  free(): void;
}

export interface DwgDecoder {
  read(bytes: Uint8Array): DwgHandle;
}

/** The six-byte version magic (`AC1015`, …), or empty when the file is too short. */
export function dwgVersion(bytes: Uint8Array): string {
  if (bytes.length < 6) return '';
  let s = '';
  for (let i = 0; i < 6; i++) {
    const c = bytes[i]!;
    if (c < 32 || c > 126) return s;
    s += String.fromCharCode(c);
  }
  return s;
}

/** True when the first bytes are a DWG version magic (`AC10…`). */
export function looksLikeDwg(bytes: Uint8Array): boolean {
  return dwgVersion(bytes).startsWith('AC10');
}

/**
 * R2004 and later store security flags at offset 0x18; bit 0 means the data is
 * encrypted. Earlier versions have no flags here (that slot is a locator count).
 */
export function dwgIsEncrypted(bytes: Uint8Array): boolean {
  const version = dwgVersion(bytes);
  if (bytes.length < 0x1c) return false;
  if (version < 'AC1018' || version > 'AC1032') return false;
  const flags =
    (bytes[0x18]! | (bytes[0x19]! << 8) | (bytes[0x1a]! << 16) | (bytes[0x1b]! << 24)) >>> 0;
  return (flags & 1) !== 0;
}

function isModelSpace(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s*]/g, '');
  return n === 'model' || n === 'modelspace' || n === 'model_space';
}

function kindOf(entity: { kind?: { type?: string } }): string {
  return (entity.kind?.type ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function skipCounts(json: ReturnType<DwgHandle['toJSON']>): number {
  const models = json.models ?? [];
  const model = models.find((m) => isModelSpace(m.name ?? '')) ?? models[0];
  let skipped = 0;
  for (const m of models) {
    const entities = m.entities ?? [];
    if (m === model) {
      for (const e of entities) {
        if (!KEPT_KINDS.has(kindOf(e))) skipped += 1;
      }
    } else {
      skipped += entities.length;
    }
  }
  return skipped;
}

function asIoError(err: unknown): IoError {
  if (err instanceof IoError) return err;
  const kind = err && typeof err === 'object' && 'kind' in err ? String((err as { kind: unknown }).kind) : '';
  const message = err instanceof Error ? err.message : String(err);
  if (kind === 'unsupported' && /encrypt|password/i.test(message)) {
    return new IoError('This DWG file is encrypted. Remove the password in the program that made it, then try again.');
  }
  if (kind === 'unsupported') {
    return new IoError('This DWG file uses something ArchiLite cannot read.');
  }
  if (kind === 'truncated' || kind === 'invalid') {
    return new IoError('This DWG file is damaged or not a complete drawing.');
  }
  if (kind === 'unknown_format') {
    return new IoError('This file is not a DWG ArchiLite can read.');
  }
  if (kind === 'limit_exceeded') {
    return new IoError(
      'The blocks in this DWG file expand to more than ArchiLite opens. Explode or purge the nested blocks in the program that made it, then try again.',
    );
  }
  return new IoError('This DWG file could not be read.');
}

/**
 * Version and encryption live in the first bytes. Call this before fetching the
 * decoder so a refused file never downloads wasm.
 */
export function assertDwgHeader(bytes: Uint8Array): void {
  if (!looksLikeDwg(bytes)) {
    throw new IoError('This file is not a DWG ArchiLite can read.');
  }
  const version = dwgVersion(bytes);
  if (!DWG_VERSION_SET.has(version)) {
    throw new IoError(
      `This DWG version (${version || 'unknown'}) is not one ArchiLite can read. It reads AC1014 through AC1032.`,
    );
  }
  if (dwgIsEncrypted(bytes)) {
    throw new IoError('This DWG file is encrypted. Remove the password in the program that made it, then try again.');
  }
}

/** Reads a DWG into the same kind of document DXF import produces. */
export function importDwg(bytes: Uint8Array, decoder: DwgDecoder): DxfImport {
  assertDwgHeader(bytes);

  let cad: DwgHandle | undefined;
  try {
    cad = decoder.read(bytes);
    const exploded = cad.explodeInserts();
    if (exploded && exploded.truncated) {
      throw new IoError(
        'The blocks in this DWG file expand to more than ArchiLite opens. Explode or purge the nested blocks in the program that made it, then try again.',
      );
    }
    const skipped = skipCounts(cad.toJSON());
    const dxf = cad.toDxf('r2000');
    const mapped = importDxf(dxf);
    return { doc: mapped.doc, skipped: skipped + mapped.skipped };
  } catch (err) {
    throw asIoError(err);
  } finally {
    cad?.free();
  }
}
