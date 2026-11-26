/**
 * DXF (Drawing Interchange Format) import and export.
 *
 * Export writes a text DXF that other CAD programs can open: lines, circles, arcs,
 * polylines (with bulges), layers, and annotations as the same line work the screen
 * draws. Import reads those entity types back; TEXT/MTEXT drop %% underline
 * toggles and turn %%c / %%d / %%p into Ø / ° / ±. Block INSERT is exploded into those
 * same types (nested inserts included). Anything else is skipped and counted.
 *
 * The writer targets the R2000 (AC1015) text form. Binary DXF is refused.
 */
import {
  BY_LAYER,
  DEFAULT_LAYER_NAME,
  LINEWEIGHTS_MM,
  LINETYPES,
  arrowCorners,
  canonicalShape,
  hatchLoops,
  newDocument,
  onCurrentSheet,
  piecesOnSheet,
  resolveNotes,
  type ColorRef,
  type Doc,
  type Entity,
  type Layer,
  type LinetypeId,
  type LinetypeRef,
  type Lineweight,
  type LineweightRef,
  type Note,
} from '../core/doc';
import {
  ORIGIN,
  arc as makeArc,
  ccwSweep,
  convertLength,
  degToRad,
  mirror,
  normalizeAngle,
  polyline,
  radToDeg,
  rotate,
  scaleAbout,
  segment,
  circle as makeCircle,
  tolFor,
  transformPoint,
  transformShape,
  translate,
  type LengthUnit,
  type Loop,
  type Shape,
  type Transform,
  type Vec2,
} from '../core/geom';
import { aciToHex, hexToAci } from './color';
import { IoError } from './error';

export const DXF_EXTENSION = '.dxf';

const LINETYPE_DXF: Readonly<Record<LinetypeId, string>> = {
  continuous: 'CONTINUOUS',
  dashed: 'DASHED',
  'dash-dot': 'CENTER',
  'dash-double-dot': 'DIVIDE',
  dotted: 'DOT',
};

const LINETYPE_FROM_DXF: Readonly<Record<string, LinetypeId>> = {
  CONTINUOUS: 'continuous',
  BYLAYER: 'continuous',
  DASHED: 'dashed',
  HIDDEN: 'dashed',
  CENTER: 'dash-dot',
  DASHDOT: 'dash-dot',
  DIVIDE: 'dash-double-dot',
  PHANTOM: 'dash-double-dot',
  DOT: 'dotted',
  DOTTED: 'dotted',
};

const INSUNITS: Readonly<Record<number, LengthUnit>> = {
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
};

const KNOWN_ENTITIES = new Set([
  'LINE',
  'CIRCLE',
  'ARC',
  'LWPOLYLINE',
  'POLYLINE',
  'VERTEX',
  'SEQEND',
  'TEXT',
  'MTEXT',
  'POINT',
  'HATCH',
  'SOLID',
  'INSERT',
  'DIMENSION',
  'LEADER',
  'MLINE',
  'SPLINE',
  'ELLIPSE',
  '3DFACE',
  'TRACE',
  'VIEWPORT',
  'IMAGE',
  'WIPEOUT',
  'ATTDEF',
  'ATTRIB',
  'BODY',
  'REGION',
  '3DSOLID',
]);

export interface DxfImport {
  readonly doc: Doc;
  /** Objects of a kind ArchiLite does not draw. */
  readonly skipped: number;
}

interface Pair {
  readonly code: number;
  readonly value: string;
}

function pairsOf(text: string): Pair[] {
  if (text.includes('\0')) {
    throw new IoError('This DXF file is not the text form ArchiLite can read.');
  }
  const lines = text.split(/\r?\n/);
  if (lines.length >= 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) throw new IoError('This DXF file is empty or too short to be a drawing.');
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number((lines[i] as string).trim());
    if (!Number.isInteger(code)) {
      throw new IoError(`This DXF file is not valid text DXF (group code on line ${i + 1} is not a whole number).`);
    }
    out.push({ code, value: lines[i + 1] as string });
  }
  return out;
}

/** True when the text looks like a DXF drawing rather than ArchiLite JSON. */
export function looksLikeDxf(text: string): boolean {
  if (text.includes('\0')) return true;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return false;
  try {
    const pairs = pairsOf(text);
    const first = pairs.find((p) => p.code !== 999);
    return first?.code === 0 && (first.value.trim() === 'SECTION' || first.value.trim() === 'EOF');
  } catch {
    return /^[\s]*0[\s]*\r?\n[\s]*SECTION\b/i.test(text);
  }
}

function num(value: string, path: string): number {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new IoError(`DXF value at ${path} is not a finite number.`, path);
  return n + 0;
}

function nearestLineweight(mm: number): Lineweight {
  let best: Lineweight = LINEWEIGHTS_MM[0];
  let bestD = Infinity;
  for (const w of LINEWEIGHTS_MM) {
    const d = Math.abs(w - mm);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function linetypeFromDxf(name: string): LinetypeId {
  return LINETYPE_FROM_DXF[name.trim().toUpperCase()] ?? 'continuous';
}

function layerNameFromDxf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '0') return DEFAULT_LAYER_NAME;
  return trimmed.slice(0, 64);
}

/** Layer 0 (and ArchiLite's Default) takes the INSERT's layer when exploding. */
function isDxfLayerZero(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '' || trimmed === '0' || trimmed.toLowerCase() === DEFAULT_LAYER_NAME.toLowerCase();
}

interface DxfLayer {
  name: string;
  color: string;
  linetype: LinetypeId;
  lineweight: Lineweight;
  visible: boolean;
  locked: boolean;
}

interface DxfEntity {
  type: string;
  layer: string;
  color: ColorRef;
  linetype: LinetypeRef | undefined;
  lineweight: LineweightRef | undefined;
  values: Map<number, string[]>;
  pairs: Pair[];
}

interface DxfBlock {
  name: string;
  base: Vec2;
  entities: DxfEntity[];
}

function pushVal(map: Map<number, string[]>, code: number, value: string): void {
  const list = map.get(code);
  if (list) list.push(value);
  else map.set(code, [value]);
}

function lastVal(map: Map<number, string[]>, code: number): string | undefined {
  const list = map.get(code);
  return list?.[list.length - 1];
}

function allVal(map: Map<number, string[]>, code: number): string[] {
  return map.get(code) ?? [];
}

function parseTablesAndEntities(pairs: Pair[]): {
  layers: DxfLayer[];
  entities: DxfEntity[];
  blocks: Map<string, DxfBlock>;
  units: LengthUnit;
  skipped: number;
} {
  let section = '';
  let table = '';
  let inEntities = false;
  const layers: DxfLayer[] = [];
  const entities: DxfEntity[] = [];
  const blocks = new Map<string, DxfBlock>();
  let currentBlock: DxfBlock | null = null;
  let target: DxfEntity[] = entities;
  let units: LengthUnit = 'mm';
  let skipped = 0;
  let current: DxfEntity | null = null;
  let polyline: DxfEntity | null = null;
  let headerVar = '';

  const saveBlock = (): void => {
    if (currentBlock?.name) blocks.set(currentBlock.name.toLowerCase(), currentBlock);
    currentBlock = null;
    target = entities;
  };

  const flush = (): void => {
    if (!current) return;
    if (current.type === 'BLOCK') {
      const name = (lastVal(current.values, 2) ?? '').trim();
      let base: Vec2 = ORIGIN;
      try {
        base = xy(current.values, 10, 20, 'BLOCK base');
      } catch {
        base = ORIGIN;
      }
      const block: DxfBlock = { name, base, entities: [] };
      currentBlock = block;
      target = block.entities;
      current = null;
      return;
    }
    if (current.type === 'SEQEND') {
      if (polyline) target.push(polyline);
      polyline = null;
      current = null;
      return;
    }
    if (current.type === 'VERTEX') {
      if (polyline) {
        polyline.pairs.push(...current.pairs);
        for (const [code, vals] of current.values) {
          for (const v of vals) pushVal(polyline.values, code, v);
        }
      }
      current = null;
      return;
    }
    if (current.type === 'POLYLINE') {
      const flags = lastVal(current.values, 70);
      polyline = { ...current, values: new Map(), pairs: [] };
      if (flags !== undefined) polyline.values.set(70, [flags]);
      current = null;
      return;
    }
    if (
      current.type === 'LINE' ||
      current.type === 'CIRCLE' ||
      current.type === 'ARC' ||
      current.type === 'LWPOLYLINE' ||
      current.type === 'TEXT' ||
      current.type === 'MTEXT' ||
      current.type === 'INSERT'
    ) {
      target.push(current);
    } else if (!currentBlock && (KNOWN_ENTITIES.has(current.type) || current.type.length > 0)) {
      skipped += 1;
    }
    current = null;
  };

  const styleOf = (values: Map<number, string[]>): Pick<DxfEntity, 'layer' | 'color' | 'linetype' | 'lineweight'> => {
    const layer = lastVal(values, 8) ?? '0';
    const aciRaw = lastVal(values, 62);
    const aci = aciRaw !== undefined ? Number(aciRaw.trim()) : 256;
    const color: ColorRef = aci === 256 || aci === 0 ? BY_LAYER : aciToHex(aci);
    const ltName = lastVal(values, 6);
    const linetype: LinetypeRef | undefined =
      ltName === undefined || ltName.trim().toUpperCase() === 'BYLAYER' ? undefined : linetypeFromDxf(ltName);
    const lwRaw = lastVal(values, 370);
    let lineweight: LineweightRef | undefined;
    if (lwRaw !== undefined) {
      const lw = Number(lwRaw.trim());
      if (lw >= 0) lineweight = nearestLineweight(lw / 100);
    }
    return { layer, color, linetype, lineweight };
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i] as Pair;
    if (p.code === 0) {
      const type = p.value.trim().toUpperCase();
      if (type === 'SECTION') {
        flush();
        continue;
      }
      if (type === 'ENDSEC') {
        flush();
        if (polyline) {
          target.push(polyline);
          polyline = null;
        }
        saveBlock();
        inEntities = false;
        section = '';
        continue;
      }
      if (type === 'ENDBLK') {
        flush();
        if (polyline) {
          target.push(polyline);
          polyline = null;
        }
        saveBlock();
        current = null;
        continue;
      }
      if (type === 'TABLE') {
        table = '';
        continue;
      }
      if (type === 'ENDTAB') {
        table = '';
        continue;
      }
      if (type === 'EOF') {
        flush();
        break;
      }
      if (section === 'TABLES' && type === 'LAYER') {
        const values = new Map<number, string[]>();
        while (i + 1 < pairs.length && (pairs[i + 1] as Pair).code !== 0) {
          i += 1;
          const q = pairs[i] as Pair;
          pushVal(values, q.code, q.value);
        }
        const name = (lastVal(values, 2) ?? '0').trim();
        const flags = Number(lastVal(values, 70) ?? '0');
        const aci = Number(lastVal(values, 62) ?? '7');
        const off = aci < 0;
        const frozen = (flags & 1) !== 0;
        layers.push({
          name: layerNameFromDxf(name),
          color: aciToHex(Math.abs(aci) || 7),
          linetype: linetypeFromDxf(lastVal(values, 6) ?? 'CONTINUOUS'),
          lineweight: nearestLineweight(Number(lastVal(values, 370) ?? '25') / 100 || 0.25),
          visible: !off && !frozen,
          locked: (flags & 4) !== 0,
        });
        continue;
      }
      if (inEntities || section === 'BLOCKS') {
        flush();
        current = { type, layer: '0', color: BY_LAYER, linetype: undefined, lineweight: undefined, values: new Map(), pairs: [] };
        continue;
      }
      continue;
    }
    if (p.code === 2 && section === '' && pairs[i - 1]?.code === 0 && pairs[i - 1]?.value.trim().toUpperCase() === 'SECTION') {
      section = p.value.trim().toUpperCase();
      inEntities = section === 'ENTITIES';
      continue;
    }
    if (p.code === 2 && table === '' && pairs[i - 1]?.code === 0 && pairs[i - 1]?.value.trim().toUpperCase() === 'TABLE') {
      table = p.value.trim().toUpperCase();
      continue;
    }
    if (section === 'HEADER') {
      if (p.code === 9) headerVar = p.value.trim();
      else if (headerVar === '$INSUNITS' && (p.code === 70 || p.code === 280)) {
        units = INSUNITS[Number(p.value.trim())] ?? 'mm';
        headerVar = '';
      }
      continue;
    }
    if (current) {
      current.pairs.push(p);
      pushVal(current.values, p.code, p.value);
      if (p.code === 8) current.layer = p.value.trim() || '0';
    }
  }
  flush();
  if (polyline) target.push(polyline);
  saveBlock();

  const styleEntities = (list: DxfEntity[]): void => {
    for (const e of list) {
      const s = styleOf(e.values);
      e.layer = s.layer;
      e.color = s.color;
      e.linetype = s.linetype;
      e.lineweight = s.lineweight;
    }
  };
  styleEntities(entities);
  for (const b of blocks.values()) styleEntities(b.entities);
  return { layers, entities, blocks, units, skipped };
}

function xy(values: Map<number, string[]>, xCode: number, yCode: number, path: string): Vec2 {
  const xs = allVal(values, xCode);
  const ys = allVal(values, yCode);
  if (xs.length === 0 || ys.length === 0) throw new IoError(`DXF ${path} is missing coordinates.`, path);
  return { x: num(xs[xs.length - 1] as string, path), y: num(ys[ys.length - 1] as string, path) };
}

function shapeFromEntity(e: DxfEntity): Shape | null {
  const v = e.values;
  try {
    if (e.type === 'LINE') {
      const a = xy(v, 10, 20, 'LINE start');
      const b = xy(v, 11, 21, 'LINE end');
      if (a.x === b.x && a.y === b.y) return null;
      return canonicalShape(segment(a, b));
    }
    if (e.type === 'CIRCLE') {
      const c = xy(v, 10, 20, 'CIRCLE centre');
      const r = num(lastVal(v, 40) ?? '', 'CIRCLE radius');
      if (r <= 0) return null;
      return canonicalShape(makeCircle(c, r));
    }
    if (e.type === 'ARC') {
      const c = xy(v, 10, 20, 'ARC centre');
      const r = num(lastVal(v, 40) ?? '', 'ARC radius');
      const startDeg = num(lastVal(v, 50) ?? '0', 'ARC start');
      const endDeg = num(lastVal(v, 51) ?? '0', 'ARC end');
      const start = normalizeAngle(degToRad(startDeg));
      const end = normalizeAngle(degToRad(endDeg));
      const sweep = ccwSweep(start, end);
      if (sweep === 0 || r <= 0) return null;
      return canonicalShape(makeArc(c, r, start, sweep));
    }
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const vertices: { x: number; y: number; bulge: number }[] = [];
      let x: number | undefined;
      let y: number | undefined;
      let bulge = 0;
      const flush = (): void => {
        if (x === undefined || y === undefined) return;
        vertices.push({ x, y, bulge });
        x = undefined;
        y = undefined;
        bulge = 0;
      };
      for (const p of e.pairs) {
        if (p.code === 10) {
          flush();
          x = num(p.value, 'polyline x');
        } else if (p.code === 20) y = num(p.value, 'polyline y');
        else if (p.code === 42) bulge = num(p.value, 'polyline bulge');
      }
      flush();
      if (vertices.length < 2) return null;
      const closed = (Number(lastVal(v, 70) ?? '0') & 1) !== 0;
      return canonicalShape(polyline(vertices, closed));
    }
  } catch (err) {
    if (err instanceof IoError || err instanceof RangeError) return null;
    throw err;
  }
  return null;
}

/**
 * DXF %% codes in TEXT/MTEXT. Underline and overline toggles are dropped
 * (ArchiLite text has no underline); diameter, degree and plus-minus become the
 * characters; %%% is a percent sign; %%nnn is Latin-1 character nnn.
 */
function decodeDxfCodes(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 37 && text.charCodeAt(i + 1) === 37) {
      const a = text[i + 2];
      if (a === undefined) {
        out += text[i];
        i += 1;
        continue;
      }
      if (a >= '0' && a <= '9') {
        const n = text.slice(i + 2, i + 5);
        if (/^\d{3}$/.test(n)) {
          out += String.fromCharCode(Number(n));
          i += 5;
          continue;
        }
      }
      const c = a.toLowerCase();
      if (c === 'u' || c === 'o') {
        i += 3;
        continue;
      }
      if (c === 'c') {
        out += 'Ø';
        i += 3;
        continue;
      }
      if (c === 'd') {
        out += '°';
        i += 3;
        continue;
      }
      if (c === 'p') {
        out += '±';
        i += 3;
        continue;
      }
      if (c === '%') {
        out += '%';
        i += 3;
        continue;
      }
      out += '%%';
      i += 2;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function mtextContent(e: DxfEntity): string {
  const chunks = [...allVal(e.values, 3), ...(allVal(e.values, 1) as string[])];
  return decodeDxfCodes(
    chunks.join('').replace(/\\P/g, '\n').replace(/\{\\[^;]*;/g, '').replace(/[{}]/g, ''),
  ).slice(0, 2000);
}

function textNote(e: DxfEntity, layerId: number, id: number): Note | null {
  const raw = e.type === 'MTEXT' ? mtextContent(e) : decodeDxfCodes(lastVal(e.values, 1) ?? '').slice(0, 2000);
  const text = raw;
  if (text.trim() === '') return null;
  const at = xy(e.values, 10, 20, 'TEXT');
  const height = Math.max(1e-3, Number(lastVal(e.values, 40) ?? '3.5') || 3.5);
  const angle = degToRad(Number(lastVal(e.values, 50) ?? '0') || 0);
  const align = Number(lastVal(e.values, 72) ?? '0');
  const anchor = align === 1 || align === 4 ? 'center' : align === 2 || align === 5 ? 'right' : 'left';
  return {
    id,
    layer: layerId,
    z: id,
    color: e.color,
    lineweight: e.lineweight ?? BY_LAYER,
    body: { kind: 'text', at, height, angle, anchor, text },
  };
}

function applySteps(steps: readonly Transform[], s: Shape): Shape {
  let g = s;
  for (const t of steps) g = transformShape(t, g);
  return canonicalShape(g);
}

/** Uniform INSERT transform, or null when X/Y scales differ (would need ellipses). */
function insertSteps(e: DxfEntity, base: Vec2): Transform[] | null {
  const sx = Number(lastVal(e.values, 41) ?? '1');
  const sy = Number(lastVal(e.values, 42) ?? '1');
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;
  const mag = Math.max(1, Math.abs(sx), Math.abs(sy));
  if (Math.abs(Math.abs(sx) - Math.abs(sy)) > tolFor(mag)) return null;
  const rot = degToRad(Number(lastVal(e.values, 50) ?? '0') || 0);
  let at: Vec2;
  try {
    at = xy(e.values, 10, 20, 'INSERT');
  } catch {
    return null;
  }
  const steps: Transform[] = [];
  if (base.x !== 0 || base.y !== 0) steps.push(translate(-base.x, -base.y));
  if (sx < 0) steps.push(mirror(ORIGIN, { x: 0, y: 1 }));
  if (sy < 0) steps.push(mirror(ORIGIN, { x: 1, y: 0 }));
  const k = Math.abs(sx);
  if (k !== 1) steps.push(scaleAbout(ORIGIN, k));
  if (rot !== 0) steps.push(rotate(ORIGIN, rot));
  if (at.x !== 0 || at.y !== 0) steps.push(translate(at.x, at.y));
  return steps;
}

type FlatPiece =
  | {
      kind: 'shape';
      geom: Shape;
      layer: string;
      color: ColorRef;
      linetype: LinetypeRef | undefined;
      lineweight: LineweightRef | undefined;
    }
  | {
      kind: 'text';
      layer: string;
      color: ColorRef;
      lineweight: LineweightRef | undefined;
      at: Vec2;
      height: number;
      angle: number;
      anchor: 'left' | 'center' | 'right';
      text: string;
    };

function explodeList(
  entities: readonly DxfEntity[],
  blocks: Map<string, DxfBlock>,
  visiting: Set<string>,
): { pieces: FlatPiece[]; skipped: number } {
  const pieces: FlatPiece[] = [];
  let skipped = 0;
  for (const e of entities) {
    if (e.type === 'INSERT') {
      const key = (lastVal(e.values, 2) ?? '').trim().toLowerCase();
      if (key === '' || visiting.has(key)) {
        skipped += 1;
        continue;
      }
      const block = blocks.get(key);
      const steps = block ? insertSteps(e, block.base) : null;
      if (!block || !steps) {
        skipped += 1;
        continue;
      }
      visiting.add(key);
      const inner = explodeList(block.entities, blocks, visiting);
      skipped += inner.skipped;
      visiting.delete(key);
      const sx = Math.abs(Number(lastVal(e.values, 41) ?? '1') || 1);
      const rot = degToRad(Number(lastVal(e.values, 50) ?? '0') || 0);
      for (const p of inner.pieces) {
        const layer = isDxfLayerZero(p.layer) ? e.layer : p.layer;
        if (p.kind === 'shape') {
          pieces.push({ ...p, layer, geom: applySteps(steps, p.geom) });
          continue;
        }
        let at = p.at;
        for (const t of steps) at = transformPoint(t, at);
        pieces.push({ ...p, layer, at: { x: at.x + 0, y: at.y + 0 }, height: p.height * sx, angle: p.angle + rot });
      }
      continue;
    }
    if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const note = textNote(e, 0, 0);
      if (note && note.body.kind === 'text') {
        pieces.push({
          kind: 'text',
          layer: e.layer,
          color: e.color,
          lineweight: e.lineweight,
          at: note.body.at,
          height: note.body.height,
          angle: note.body.angle,
          anchor: note.body.anchor,
          text: note.body.text,
        });
      } else skipped += 1;
      continue;
    }
    const geom = shapeFromEntity(e);
    if (!geom) {
      skipped += 1;
      continue;
    }
    pieces.push({ kind: 'shape', geom, layer: e.layer, color: e.color, linetype: e.linetype, lineweight: e.lineweight });
  }
  return { pieces, skipped };
}

/** Reads a text DXF into an ArchiLite document. Unknown objects are skipped, not fatal. */
export function importDxf(text: string): DxfImport {
  const pairs = pairsOf(text);
  const parsed = parseTablesAndEntities(pairs);
  const doc0 = newDocument({ units: parsed.units });
  const layers: Layer[] = [{ ...(doc0.layers[0] as Layer) }];
  const byName = new Map<string, Layer>([[DEFAULT_LAYER_NAME.toLowerCase(), layers[0] as Layer]]);
  let nextId = doc0.nextId;

  const uniqueName = (raw: string): string => {
    let name = raw;
    let n = 2;
    while ([...byName.keys()].includes(name.toLowerCase())) {
      const suffix = `-${n}`;
      name = `${raw.slice(0, 64 - suffix.length)}${suffix}`;
      n += 1;
    }
    return name;
  };

  for (const l of parsed.layers) {
    const key = l.name.toLowerCase();
    if (byName.has(key)) {
      const existing = byName.get(key) as Layer;
      const i = layers.findIndex((x) => x.id === existing.id);
      layers[i] = { ...existing, color: l.color, linetype: l.linetype, lineweight: l.lineweight, visible: l.visible, locked: l.locked };
      byName.set(key, layers[i] as Layer);
      continue;
    }
    const name = uniqueName(l.name);
    const layer: Layer = {
      id: nextId++,
      name,
      color: l.color,
      linetype: l.linetype,
      lineweight: l.lineweight,
      visible: l.visible,
      locked: l.locked,
    };
    layers.push(layer);
    byName.set(name.toLowerCase(), layer);
  }

  const layerId = (dxfName: string): number => {
    const name = layerNameFromDxf(dxfName);
    return (byName.get(name.toLowerCase()) ?? layers[0])!.id;
  };

  const entities = new Map<number, Entity>();
  const notes = new Map<number, Note>();
  const exploded = explodeList(parsed.entities, parsed.blocks, new Set());
  let skipped = parsed.skipped + exploded.skipped;
  for (const p of exploded.pieces) {
    const id = nextId++;
    if (p.kind === 'text') {
      notes.set(id, {
        id,
        layer: layerId(p.layer),
        z: id,
        color: p.color,
        lineweight: p.lineweight ?? BY_LAYER,
        body: { kind: 'text', at: p.at, height: p.height, angle: p.angle, anchor: p.anchor, text: p.text },
      });
      continue;
    }
    entities.set(id, {
      id,
      layer: layerId(p.layer),
      z: id,
      color: p.color,
      linetype: p.linetype ?? BY_LAYER,
      lineweight: p.lineweight ?? BY_LAYER,
      geom: p.geom,
    });
  }

  if (entities.size === 0 && notes.size === 0 && parsed.entities.length === 0 && skipped === 0 && layers.length === 1) {
    // Empty DXF is still a drawing.
  }

  const doc: Doc = {
    ...doc0,
    settings: { ...doc0.settings, units: parsed.units, currentLayer: layers[0]!.id },
    nextId,
    layers,
    entities,
    notes,
  };
  return { doc, skipped };
}

// ---------- export ----------

class DxfOut {
  private readonly parts: string[] = [];
  private handle = 0x20;
  pair(code: number, value: string | number): void {
    const v = typeof value === 'number' ? fmt(value) : value;
    this.parts.push(`${String(code).padStart(3, ' ')}\n${v}\n`);
  }
  hid(): string {
    this.handle += 1;
    return this.handle.toString(16).toUpperCase();
  }
  text(): string {
    return this.parts.join('');
  }
}

function fmt(n: number): string {
  const x = n + 0;
  if (!Number.isFinite(x)) return '0.0';
  if (Number.isInteger(x)) return `${x}.0`;
  return String(x);
}

function dxfLayerName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 _-]/g, '_').trim() || '0';
  return cleaned.slice(0, 255);
}

function entityCommon(out: DxfOut, layer: string, color: ColorRef, linetype: LinetypeRef | undefined, lineweight: LineweightRef | undefined): void {
  out.pair(5, out.hid());
  out.pair(100, 'AcDbEntity');
  out.pair(8, layer);
  if (color !== BY_LAYER) out.pair(62, hexToAci(color));
  if (linetype && linetype !== BY_LAYER) out.pair(6, LINETYPE_DXF[linetype]);
  if (typeof lineweight === 'number') out.pair(370, Math.round(lineweight * 100));
}

function writeShape(out: DxfOut, geom: Shape, layer: string, color: ColorRef, linetype: LinetypeRef | undefined, lineweight: LineweightRef | undefined): void {
  if (geom.kind === 'segment') {
    out.pair(0, 'LINE');
    entityCommon(out, layer, color, linetype, lineweight);
    out.pair(100, 'AcDbLine');
    out.pair(10, geom.start.x);
    out.pair(20, geom.start.y);
    out.pair(30, 0);
    out.pair(11, geom.end.x);
    out.pair(21, geom.end.y);
    out.pair(31, 0);
    return;
  }
  if (geom.kind === 'circle') {
    out.pair(0, 'CIRCLE');
    entityCommon(out, layer, color, linetype, lineweight);
    out.pair(100, 'AcDbCircle');
    out.pair(10, geom.center.x);
    out.pair(20, geom.center.y);
    out.pair(30, 0);
    out.pair(40, geom.radius);
    return;
  }
  if (geom.kind === 'arc') {
    const start = radToDeg(geom.start);
    const end = radToDeg(normalizeAngle(geom.start + geom.sweep));
    out.pair(0, 'ARC');
    entityCommon(out, layer, color, linetype, lineweight);
    out.pair(100, 'AcDbCircle');
    out.pair(10, geom.center.x);
    out.pair(20, geom.center.y);
    out.pair(30, 0);
    out.pair(40, geom.radius);
    out.pair(100, 'AcDbArc');
    // DXF arcs always run counter-clockwise from start to end. A clockwise sweep is
    // stored by swapping the two angles.
    if (geom.sweep >= 0) {
      out.pair(50, start);
      out.pair(51, end);
    } else {
      out.pair(50, end);
      out.pair(51, start);
    }
    return;
  }
  out.pair(0, 'LWPOLYLINE');
  entityCommon(out, layer, color, linetype, lineweight);
  out.pair(100, 'AcDbPolyline');
  out.pair(90, geom.vertices.length);
  out.pair(70, geom.closed ? 1 : 0);
  out.pair(43, 0);
  for (const v of geom.vertices) {
    out.pair(10, v.x);
    out.pair(20, v.y);
    out.pair(42, v.bulge);
  }
}

function loopVerts(loop: Loop): { x: number; y: number; bulge: number }[] {
  if (loop.kind === 'circle') {
    const k = Math.SQRT2 - 1;
    const { x, y } = loop.center;
    const r = loop.radius;
    return [
      { x: x + r, y, bulge: k },
      { x, y: y + r, bulge: k },
      { x: x - r, y, bulge: k },
      { x, y: y - r, bulge: k },
    ];
  }
  return loop.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
}

function writeHatch(out: DxfOut, loops: readonly Loop[], layer: string, color: ColorRef, solid: boolean): void {
  out.pair(0, 'HATCH');
  entityCommon(out, layer, color, undefined, undefined);
  out.pair(100, 'AcDbHatch');
  out.pair(10, 0);
  out.pair(20, 0);
  out.pair(30, 0);
  out.pair(210, 0);
  out.pair(220, 0);
  out.pair(230, 1);
  out.pair(2, solid ? 'SOLID' : 'ANSI31');
  out.pair(70, solid ? 1 : 0);
  out.pair(71, 0);
  out.pair(91, loops.length);
  loops.forEach((loop, i) => {
    const verts = loopVerts(loop);
    out.pair(92, i === 0 ? 7 : 2);
    out.pair(72, 1);
    out.pair(73, 1);
    out.pair(93, verts.length);
    for (const v of verts) {
      out.pair(10, v.x);
      out.pair(20, v.y);
      out.pair(42, v.bulge);
    }
    out.pair(97, 0);
  });
  out.pair(75, 0);
  out.pair(76, 1);
  if (!solid) {
    out.pair(52, 0);
    out.pair(41, 1);
    out.pair(77, 0);
    out.pair(78, 1);
    out.pair(53, 45);
    out.pair(43, 0);
    out.pair(44, 0);
    out.pair(45, -1);
    out.pair(46, 1);
    out.pair(79, 0);
  }
  out.pair(98, 0);
}

function writeText(out: DxfOut, at: Vec2, height: number, angle: number, anchor: 'left' | 'center' | 'right', text: string, layer: string, color: ColorRef): void {
  out.pair(0, 'TEXT');
  entityCommon(out, layer, color, undefined, undefined);
  out.pair(100, 'AcDbText');
  out.pair(10, at.x);
  out.pair(20, at.y);
  out.pair(30, 0);
  out.pair(40, height);
  out.pair(1, dxfText(text));
  out.pair(50, radToDeg(angle));
  out.pair(7, 'STANDARD');
  const horiz = anchor === 'center' ? 1 : anchor === 'right' ? 2 : 0;
  if (horiz !== 0) {
    out.pair(72, horiz);
    out.pair(11, at.x);
    out.pair(21, at.y);
    out.pair(31, 0);
  }
  out.pair(100, 'AcDbText');
}

function dxfText(text: string): string {
  return text.replace(/\r?\n/g, ' ').slice(0, 250);
}

function writeSolid(out: DxfOut, a: Vec2, b: Vec2, c: Vec2, layer: string, color: ColorRef): void {
  out.pair(0, 'SOLID');
  entityCommon(out, layer, color, undefined, undefined);
  out.pair(100, 'AcDbTrace');
  out.pair(10, a.x);
  out.pair(20, a.y);
  out.pair(30, 0);
  out.pair(11, b.x);
  out.pair(21, b.y);
  out.pair(31, 0);
  out.pair(12, c.x);
  out.pair(22, c.y);
  out.pair(32, 0);
  out.pair(13, c.x);
  out.pair(23, c.y);
  out.pair(33, 0);
}

function insunits(units: LengthUnit): number {
  if (units === 'in') return 1;
  if (units === 'ft') return 2;
  if (units === 'cm') return 5;
  if (units === 'm') return 6;
  return 4;
}

function writeLinetype(out: DxfOut, id: LinetypeId): void {
  const def = LINETYPES[id];
  const pattern = def.pattern;
  const length = pattern.reduce((s, x) => s + Math.abs(x), 0);
  out.pair(0, 'LTYPE');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTableRecord');
  out.pair(100, 'AcDbLinetypeTableRecord');
  out.pair(2, LINETYPE_DXF[id]);
  out.pair(70, 0);
  out.pair(3, def.label);
  out.pair(72, 65);
  out.pair(73, pattern.length);
  out.pair(40, length);
  for (let i = 0; i < pattern.length; i++) {
    const dash = pattern[i] as number;
    // Positive = ink, negative = gap; a 0.5 dash is a dot.
    out.pair(49, i % 2 === 0 ? dash : -dash);
    out.pair(74, 0);
  }
}

/**
 * Writes the drawing as a text DXF. Geometry keeps its true arcs and bulges; notes are
 * written as the line work, text and hatches the screen already draws.
 */
export function exportDxf(doc: Doc): string {
  const out = new DxfOut();
  const layers = doc.layers;
  const shown = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  const layerName = (id: number): string => dxfLayerName(layers.find((l) => l.id === id)?.name ?? '0');

  out.pair(0, 'SECTION');
  out.pair(2, 'HEADER');
  out.pair(9, '$ACADVER');
  out.pair(1, 'AC1015');
  out.pair(9, '$INSUNITS');
  out.pair(70, insunits(doc.settings.units));
  out.pair(9, '$MEASUREMENT');
  out.pair(70, doc.settings.units === 'in' || doc.settings.units === 'ft' ? 0 : 1);
  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION');
  out.pair(2, 'TABLES');

  out.pair(0, 'TABLE');
  out.pair(2, 'VPORT');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 1);
  out.pair(0, 'VPORT');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTableRecord');
  out.pair(100, 'AcDbViewportTableRecord');
  out.pair(2, '*ACTIVE');
  out.pair(70, 0);
  out.pair(10, 0);
  out.pair(20, 0);
  out.pair(11, 1);
  out.pair(21, 1);
  out.pair(12, 0);
  out.pair(22, 0);
  out.pair(13, 0);
  out.pair(23, 0);
  out.pair(14, 1);
  out.pair(24, 1);
  out.pair(15, 0);
  out.pair(25, 0);
  out.pair(16, 0);
  out.pair(26, 0);
  out.pair(36, 1);
  out.pair(17, 0);
  out.pair(27, 0);
  out.pair(37, 0);
  out.pair(40, 297);
  out.pair(41, 1.4);
  out.pair(42, 50);
  out.pair(43, 0);
  out.pair(44, 0);
  out.pair(50, 0);
  out.pair(51, 0);
  out.pair(71, 0);
  out.pair(72, 100);
  out.pair(73, 1);
  out.pair(74, 3);
  out.pair(75, 0);
  out.pair(76, 0);
  out.pair(77, 0);
  out.pair(78, 0);
  out.pair(0, 'ENDTAB');

  const linetypeIds: LinetypeId[] = ['continuous', 'dashed', 'dash-dot', 'dash-double-dot', 'dotted'];
  out.pair(0, 'TABLE');
  out.pair(2, 'LTYPE');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, linetypeIds.length);
  for (const id of linetypeIds) writeLinetype(out, id);
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'LAYER');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, layers.length);
  for (const l of layers) {
    out.pair(0, 'LAYER');
    out.pair(5, out.hid());
    out.pair(100, 'AcDbSymbolTableRecord');
    out.pair(100, 'AcDbLayerTableRecord');
    out.pair(2, dxfLayerName(l.name));
    out.pair(70, (l.locked ? 4 : 0) + (l.visible ? 0 : 1));
    out.pair(62, l.visible ? hexToAci(l.color) : -hexToAci(l.color));
    out.pair(6, LINETYPE_DXF[l.linetype]);
    out.pair(370, Math.round(l.lineweight * 100));
    out.pair(390, out.hid());
  }
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'STYLE');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 1);
  out.pair(0, 'STYLE');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTableRecord');
  out.pair(100, 'AcDbTextStyleTableRecord');
  out.pair(2, 'STANDARD');
  out.pair(70, 0);
  out.pair(40, 0);
  out.pair(41, 1);
  out.pair(50, 0);
  out.pair(71, 0);
  out.pair(42, 2.5);
  out.pair(3, 'txt');
  out.pair(4, '');
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'VIEW');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 0);
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'UCS');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 0);
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'APPID');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 1);
  out.pair(0, 'APPID');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTableRecord');
  out.pair(100, 'AcDbRegAppTableRecord');
  out.pair(2, 'ARCLITE');
  out.pair(70, 0);
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'DIMSTYLE');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 1);
  out.pair(0, 'ENDTAB');

  out.pair(0, 'TABLE');
  out.pair(2, 'BLOCK_RECORD');
  out.pair(5, out.hid());
  out.pair(100, 'AcDbSymbolTable');
  out.pair(70, 2);
  for (const name of ['*MODEL_SPACE', '*PAPER_SPACE']) {
    out.pair(0, 'BLOCK_RECORD');
    out.pair(5, out.hid());
    out.pair(100, 'AcDbSymbolTableRecord');
    out.pair(100, 'AcDbBlockTableRecord');
    out.pair(2, name);
  }
  out.pair(0, 'ENDTAB');
  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION');
  out.pair(2, 'BLOCKS');
  for (const name of ['*MODEL_SPACE', '*PAPER_SPACE']) {
    out.pair(0, 'BLOCK');
    out.pair(5, out.hid());
    out.pair(100, 'AcDbEntity');
    out.pair(8, '0');
    out.pair(100, 'AcDbBlockBegin');
    out.pair(2, name);
    out.pair(70, 0);
    out.pair(10, 0);
    out.pair(20, 0);
    out.pair(30, 0);
    out.pair(3, name);
    out.pair(1, '');
    out.pair(0, 'ENDBLK');
    out.pair(5, out.hid());
    out.pair(100, 'AcDbEntity');
    out.pair(8, '0');
    out.pair(100, 'AcDbBlockEnd');
  }
  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION');
  out.pair(2, 'ENTITIES');

  for (const e of piecesOnSheet(doc)) {
    if (!shown.has(e.layer)) continue;
    writeShape(out, e.geom, layerName(e.layer), e.color, e.linetype === BY_LAYER ? undefined : e.linetype, e.lineweight === BY_LAYER ? undefined : e.lineweight);
  }

  const resolved = resolveNotes(doc);
  for (const n of doc.notes.values()) {
    if (!onCurrentSheet(doc, n)) continue;
    if (!shown.has(n.layer)) continue;
    const layer = layerName(n.layer);
    const color: ColorRef = n.color === BY_LAYER ? BY_LAYER : n.color;
    if (n.body.kind === 'hatch') {
      try {
        const loops = hatchLoops(
          { entity: (id) => doc.entities.get(id), dimStyle: (name) => doc.settings.dimStyles.find((s) => s.name === name) },
          n.body,
        );
        writeHatch(out, loops, layer, color, n.body.pattern === 'solid');
      } catch {
        // A hatch that no longer resolves is omitted, same as on screen.
      }
      const r = resolved.get(n.id);
      if (r?.ok && n.body.pattern !== 'solid') {
        for (const p of r.r.prims) {
          if (p.k === 'seg') writeShape(out, segment(p.a, p.b), layer, color, undefined, n.lineweight === BY_LAYER ? undefined : n.lineweight);
        }
      }
      continue;
    }
    const r = resolved.get(n.id);
    if (!r?.ok) continue;
    for (const p of r.r.prims) {
      if (p.k === 'seg') writeShape(out, segment(p.a, p.b), layer, color, undefined, n.lineweight === BY_LAYER ? undefined : n.lineweight);
      else if (p.k === 'arc') writeShape(out, makeArc(p.center, p.radius, normalizeAngle(p.start), p.sweep), layer, color, undefined, n.lineweight === BY_LAYER ? undefined : n.lineweight);
      else if (p.k === 'text') writeText(out, p.at, p.height, p.angle, p.anchor, p.text, layer, color);
      else if (p.k === 'arrow') {
        const [a, b, c] = arrowCorners(p);
        writeSolid(out, a, b, c, layer, color);
      } else if (p.k === 'dot') {
        writeShape(out, segment(p.p, { x: p.p.x + convertLength(0.2, 'mm', doc.settings.units), y: p.p.y }), layer, color, undefined, n.lineweight === BY_LAYER ? undefined : n.lineweight);
      } else if (p.k === 'fill') writeHatch(out, p.loops, layer, color, true);
    }
  }

  out.pair(0, 'ENDSEC');

  out.pair(0, 'SECTION');
  out.pair(2, 'OBJECTS');
  out.pair(0, 'DICTIONARY');
  out.pair(5, 'C');
  out.pair(100, 'AcDbDictionary');
  out.pair(281, 1);
  out.pair(0, 'ENDSEC');
  out.pair(0, 'EOF');
  return out.text();
}
