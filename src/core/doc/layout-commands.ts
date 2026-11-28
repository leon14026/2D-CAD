/**
 * Commands for blocks, sheets and constraints (Phase 9).
 */
import type { Vec2 } from '../geom';
import { explodeInsert, findBlock, membersFromEntities, MAX_BLOCK_MEMBERS, MAX_BLOCKS, type Block, type Insert } from './blocks';
import { define, optional, readIds, readStyleProps, requireEditable, requireUnlocked, type StyleProps } from './command-kit';
import {
  CONSTRAINT_KINDS,
  constraintProblem,
  constraintRefuseMessage,
  solveConstraints,
  unmetOnDraft,
  type Constraint,
  type ConstraintBody,
} from './constraints';
import { CommandError, type Draft } from './draft';
import { MAX_NAME_LENGTH } from './model';
import { readPointRef } from './note-validate';
import { SHEET_SIZES, type PointRef } from './notes';
import { MAX_SHEETS, findSheet, type Sheet } from './sheets';
import { deleteConstraintPair } from './driving';
import { BY_LAYER, readName } from './styles';
import { join, readBoolean, readNumber, readObject, readOneOf, readPoint, readPositiveInteger, ValidationError } from './validate';

function requireUniqueBlock(draft: Draft, name: string, except?: string): void {
  const key = name.toLowerCase();
  const clash = draft.blocks.find((b) => b.name.toLowerCase() === key && b.name !== except);
  if (clash) throw new CommandError(`A block called "${clash.name}" already exists.`);
}

function requireUniqueSheet(draft: Draft, name: string, except?: string): void {
  const key = name.toLowerCase();
  const clash = draft.sheets.find((s) => s.name.toLowerCase() === key && s.name !== except);
  if (clash) throw new CommandError(`A sheet called "${clash.name}" already exists.`);
}

function boundRef(ref: PointRef, path: string): PointRef {
  if (ref.kind === 'free') throw new ValidationError(path, 'must name a point on a drawn shape, not a free point');
  return ref;
}

function readConstraintBody(v: unknown, path: string): ConstraintBody {
  const head = readObject(v, path, ['kind'], ['a', 'b', 'value', 'p', 'of', 'target', 'axis']);
  const kind = readOneOf(head['kind'], join(path, 'kind'), CONSTRAINT_KINDS);
  const pos = (n: unknown, p: string) => {
    const x = readNumber(n, p);
    if (!(x > 0)) throw new ValidationError(p, `must be more than 0, not ${x}`);
    return x;
  };
  switch (kind) {
    case 'coincident':
    case 'horizontal':
    case 'vertical': {
      const o = readObject(v, path, ['kind', 'a', 'b']);
      return { kind, a: boundRef(readPointRef(o['a'], join(path, 'a')), join(path, 'a')), b: boundRef(readPointRef(o['b'], join(path, 'b')), join(path, 'b')) };
    }
    case 'distance': {
      const o = readObject(v, path, ['kind', 'a', 'b', 'value'], ['axis']);
      const axis = Object.hasOwn(o, 'axis') ? readOneOf(o['axis'], join(path, 'axis'), ['x', 'y'] as const) : undefined;
      return {
        kind,
        a: boundRef(readPointRef(o['a'], join(path, 'a')), join(path, 'a')),
        b: boundRef(readPointRef(o['b'], join(path, 'b')), join(path, 'b')),
        value: pos(o['value'], join(path, 'value')),
        ...(axis ? { axis } : {}),
      };
    }
    case 'fix': {
      const o = readObject(v, path, ['kind', 'a', 'p']);
      return { kind, a: boundRef(readPointRef(o['a'], join(path, 'a')), join(path, 'a')), p: readPoint(o['p'], join(path, 'p')) };
    }
    case 'midpoint': {
      const o = readObject(v, path, ['kind', 'a', 'of']);
      return { kind, a: boundRef(readPointRef(o['a'], join(path, 'a')), join(path, 'a')), of: readPositiveInteger(o['of'], join(path, 'of')) };
    }
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'concentric':
    case 'tangent': {
      const o = readObject(v, path, ['kind', 'a', 'b']);
      return { kind, a: readPositiveInteger(o['a'], join(path, 'a')), b: readPositiveInteger(o['b'], join(path, 'b')) };
    }
    case 'angle': {
      const o = readObject(v, path, ['kind', 'a', 'b', 'value']);
      const value = readNumber(o['value'], join(path, 'value'));
      if (!(value > 0) || value >= Math.PI) throw new ValidationError(join(path, 'value'), 'must be an angle in radians between 0 and π, not including the ends');
      return { kind, a: readPositiveInteger(o['a'], join(path, 'a')), b: readPositiveInteger(o['b'], join(path, 'b')), value };
    }
    case 'radius':
    case 'length': {
      const o = readObject(v, path, ['kind', 'target', 'value']);
      return { kind, target: readPositiveInteger(o['target'], join(path, 'target')), value: pos(o['value'], join(path, 'value')) };
    }
  }
}

function requireConstraintApplies(draft: Draft, body: ConstraintBody): void {
  const probe: Constraint = { id: 1, body };
  const why = constraintProblem(draft.env(), probe);
  if (why) throw new CommandError(why);
}

// ---------- blocks ----------

export interface CreateBlockParams {
  readonly name: string;
  readonly ids: readonly number[];
  readonly at: Vec2;
}

const createBlock = define<CreateBlockParams, { insert: number }>({
  id: 'block.create',
  label: 'Create block',
  parse(raw) {
    const o = readObject(raw, '', ['name', 'ids', 'at']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH), ids: readIds(o['ids'], 'ids'), at: readPoint(o['at'], 'at') };
  },
  run(draft, p) {
    if (draft.blocks.length >= MAX_BLOCKS) throw new CommandError(`A drawing can hold at most ${MAX_BLOCKS} blocks.`);
    requireUniqueBlock(draft, p.name);
    for (const id of p.ids) {
      if (draft.insert(id)) throw new CommandError('Explode a block insert before putting it inside another block.');
    }
    const entities = p.ids.map((id) => requireEditable(draft, id));
    if (entities.length === 0) throw new CommandError('Select at least one shape to turn into a block.');
    if (entities.length > MAX_BLOCK_MEMBERS) throw new CommandError(`A block can hold at most ${MAX_BLOCK_MEMBERS} shapes.`);
    const first = entities[0]!;
    const block: Block = { name: p.name, members: membersFromEntities(entities, p.at) };
    draft.setBlocks([...draft.blocks, block]);
    for (const e of entities) draft.deleteEntity(e.id);
    const id = draft.allocateId();
    const ins: Insert = {
      id,
      layer: first.layer,
      z: id,
      color: BY_LAYER,
      linetype: BY_LAYER,
      lineweight: BY_LAYER,
      block: p.name,
      at: p.at,
      rotation: 0,
      scale: 1,
      flipped: false,
      ...draft.sheetField(),
    };
    draft.putInsert(ins);
    return { insert: id };
  },
});

export interface InsertBlockParams extends StyleProps {
  readonly name: string;
  readonly at: Vec2;
  readonly rotation?: number;
  readonly scale?: number;
  readonly flipped?: boolean;
  readonly layer?: number;
}

const insertBlock = define<InsertBlockParams, { id: number }>({
  id: 'block.insert',
  label: 'Insert block',
  parse(raw) {
    const o = readObject(raw, '', ['name', 'at'], ['rotation', 'scale', 'flipped', 'layer', 'color', 'linetype', 'lineweight']);
    const rotation = optional(o, 'rotation', readNumber);
    const scale = optional(o, 'scale', (v, path) => {
      const n = readNumber(v, path);
      if (!(n > 0)) throw new ValidationError(path, `must be more than 0, not ${n}`);
      return n;
    });
    const flipped = optional(o, 'flipped', readBoolean);
    const layer = optional(o, 'layer', readPositiveInteger);
    return {
      name: readName(o['name'], 'name', MAX_NAME_LENGTH),
      at: readPoint(o['at'], 'at'),
      ...(rotation !== undefined && { rotation }),
      ...(scale !== undefined && { scale }),
      ...(flipped !== undefined && { flipped }),
      ...(layer !== undefined && { layer }),
      ...readStyleProps(o),
    };
  },
  run(draft, p) {
    const block = findBlock(draft.blocks, p.name);
    if (!block) throw new CommandError(`There is no block called "${p.name}".`);
    const layer = p.layer ?? draft.settings.currentLayer;
    requireUnlocked(draft, layer);
    const id = draft.allocateId();
    draft.putInsert({
      id,
      layer,
      z: id,
      color: p.color ?? BY_LAYER,
      linetype: p.linetype ?? BY_LAYER,
      lineweight: p.lineweight ?? BY_LAYER,
      block: block.name,
      at: p.at,
      rotation: p.rotation ?? 0,
      scale: p.scale ?? 1,
      flipped: p.flipped ?? false,
      ...draft.sheetField(),
    });
    return { id };
  },
});

export interface ExplodeInsertParams {
  readonly ids: readonly number[];
}

const explodeInserts = define<ExplodeInsertParams, { ids: number[] }>({
  id: 'insert.explode',
  label: 'Explode insert',
  parse(raw) {
    const o = readObject(raw, '', ['ids']);
    return { ids: readIds(o['ids'], 'ids') };
  },
  run(draft, p) {
    const inserts = p.ids.map((id) => {
      const ins = draft.insert(id);
      if (!ins) throw new CommandError(`There is no block insert with id ${id}.`);
      requireUnlocked(draft, ins.layer);
      return ins;
    });
    const ids: number[] = [];
    for (const ins of inserts) {
      const block = findBlock(draft.blocks, ins.block);
      if (!block) throw new CommandError(`The block "${ins.block}" is gone.`);
      const pieces = explodeInsert(block, ins);
      draft.deleteInsert(ins.id);
      if (pieces.length === 0) continue;
      pieces.forEach((piece, i) => {
        const id = i === 0 ? ins.id : draft.allocateId();
        draft.putEntity({
          id,
          layer: ins.layer,
          z: i === 0 ? ins.z : id,
          color: piece.color === BY_LAYER ? ins.color : piece.color,
          linetype: piece.linetype === BY_LAYER ? ins.linetype : piece.linetype,
          lineweight: piece.lineweight === BY_LAYER ? ins.lineweight : piece.lineweight,
          geom: piece.geom,
          ...(ins.sheet ? { sheet: ins.sheet } : {}),
        });
        ids.push(id);
      });
    }
    if (ids.length === 0) throw new CommandError('There is nothing to explode in those inserts.');
    return { ids };
  },
});

export interface DeleteBlockParams {
  readonly name: string;
}

const deleteBlock = define<DeleteBlockParams, Record<string, never>>({
  id: 'block.delete',
  label: 'Delete block',
  parse(raw) {
    const o = readObject(raw, '', ['name']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH) };
  },
  run(draft, p) {
    const block = findBlock(draft.blocks, p.name);
    if (!block) throw new CommandError(`There is no block called "${p.name}".`);
    for (const ins of draft.inserts()) {
      if (ins.block.toLowerCase() === block.name.toLowerCase()) {
        throw new CommandError(`Block "${block.name}" is still inserted. Explode or delete those inserts first.`);
      }
    }
    draft.setBlocks(draft.blocks.filter((b) => b.name !== block.name));
    return {};
  },
});

// ---------- sheets ----------

export interface AddSheetParams {
  readonly name: string;
  readonly size?: (typeof SHEET_SIZES)[number];
}

const addSheet = define<AddSheetParams, Record<string, never>>({
  id: 'sheet.add',
  label: 'Add sheet',
  parse(raw) {
    const o = readObject(raw, '', ['name'], ['size']);
    const size = optional(o, 'size', (v, path) => readOneOf(v, path, SHEET_SIZES));
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH), ...(size !== undefined && { size }) };
  },
  run(draft, p) {
    if (draft.sheets.length >= MAX_SHEETS) throw new CommandError(`A drawing can hold at most ${MAX_SHEETS} sheets.`);
    requireUniqueSheet(draft, p.name);
    const sheet: Sheet = { name: p.name, size: p.size ?? 'A4' };
    draft.setSheets([...draft.sheets, sheet]);
    draft.setSettings({ ...draft.settings, currentSheet: sheet.name });
    return {};
  },
});

export interface SheetNameParams {
  readonly name: string;
}

const setCurrentSheet = define<SheetNameParams, Record<string, never>>({
  id: 'sheet.setCurrent',
  label: 'Switch sheet',
  parse(raw) {
    const o = readObject(raw, '', ['name']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH) };
  },
  run(draft, p) {
    const sheet = findSheet({ sheets: draft.sheets }, p.name);
    if (!sheet) throw new CommandError(`There is no sheet called "${p.name}".`);
    if (draft.settings.currentSheet !== sheet.name) draft.setSettings({ ...draft.settings, currentSheet: sheet.name });
    return {};
  },
});

export interface RenameSheetParams {
  readonly name: string;
  readonly newName: string;
}

const renameSheet = define<RenameSheetParams, Record<string, never>>({
  id: 'sheet.rename',
  label: 'Rename sheet',
  parse(raw) {
    const o = readObject(raw, '', ['name', 'newName']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH), newName: readName(o['newName'], 'newName', MAX_NAME_LENGTH) };
  },
  run(draft, p) {
    const sheet = findSheet({ sheets: draft.sheets }, p.name);
    if (!sheet) throw new CommandError(`There is no sheet called "${p.name}".`);
    if (sheet.name === p.newName) return {};
    requireUniqueSheet(draft, p.newName, sheet.name);
    const from = sheet.name;
    const to = p.newName;
    draft.setSheets(draft.sheets.map((s) => (s.name === from ? { ...s, name: to } : s)));
    const assigned = to === draft.sheets[0]!.name ? undefined : to;
    for (const e of [...draft.entities()]) {
      if (e.sheet !== from) continue;
      draft.putEntity(assigned ? { ...e, sheet: assigned } : { id: e.id, layer: e.layer, z: e.z, color: e.color, linetype: e.linetype, lineweight: e.lineweight, geom: e.geom });
    }
    for (const n of [...draft.notes()]) {
      if (n.sheet !== from) continue;
      draft.putNote(assigned ? { ...n, sheet: assigned } : omitSheet(n));
    }
    for (const ins of [...draft.inserts()]) {
      if (ins.sheet !== from) continue;
      draft.putInsert({ ...ins, ...(assigned ? { sheet: assigned } : { sheet: undefined }) });
    }
    for (const c of [...draft.constraints()]) {
      if (c.sheet !== from) continue;
      draft.putConstraint(assigned ? { ...c, sheet: assigned } : omitSheet(c));
    }
    if (draft.settings.currentSheet === from) draft.setSettings({ ...draft.settings, currentSheet: to });
    return {};
  },
});

function sheetOfName(sheet: string | undefined, first: string): string {
  return sheet ?? first;
}

function omitSheet<T extends { readonly sheet?: string }>(obj: T): T {
  const { sheet: _s, ...rest } = obj;
  return rest as T;
}

const deleteSheet = define<SheetNameParams, Record<string, never>>({
  id: 'sheet.delete',
  label: 'Delete sheet',
  parse(raw) {
    const o = readObject(raw, '', ['name']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH) };
  },
  run(draft, p) {
    const sheet = findSheet({ sheets: draft.sheets }, p.name);
    if (!sheet) throw new CommandError(`There is no sheet called "${p.name}".`);
    if (draft.sheets.length === 1) throw new CommandError('A drawing needs at least one sheet.');
    if (draft.settings.currentSheet === sheet.name) {
      throw new CommandError(`"${sheet.name}" is the current sheet. Switch to another sheet first.`);
    }
    const first = draft.sheets[0]!.name;
    const used = (obj: { sheet?: string }) => sheetOfName(obj.sheet, first) === sheet.name;
    for (const e of draft.entities()) if (used(e)) throw new CommandError(`Sheet "${sheet.name}" is not empty. Move or delete its contents first.`);
    for (const n of draft.notes()) if (used(n)) throw new CommandError(`Sheet "${sheet.name}" is not empty. Move or delete its contents first.`);
    for (const ins of draft.inserts()) if (used(ins)) throw new CommandError(`Sheet "${sheet.name}" is not empty. Move or delete its contents first.`);
    for (const c of draft.constraints()) if (used(c)) throw new CommandError(`Sheet "${sheet.name}" is not empty. Move or delete its contents first.`);
    draft.setSheets(draft.sheets.filter((s) => s.name !== sheet.name));
    return {};
  },
});

export interface SetSheetSizeParams {
  readonly name: string;
  readonly size: (typeof SHEET_SIZES)[number];
}

const setSheetSize = define<SetSheetSizeParams, Record<string, never>>({
  id: 'sheet.setSize',
  label: 'Set sheet size',
  parse(raw) {
    const o = readObject(raw, '', ['name', 'size']);
    return { name: readName(o['name'], 'name', MAX_NAME_LENGTH), size: readOneOf(o['size'], 'size', SHEET_SIZES) };
  },
  run(draft, p) {
    const sheet = findSheet({ sheets: draft.sheets }, p.name);
    if (!sheet) throw new CommandError(`There is no sheet called "${p.name}".`);
    if (sheet.size !== p.size) draft.setSheets(draft.sheets.map((s) => (s.name === sheet.name ? { ...s, size: p.size } : s)));
    return {};
  },
});

// ---------- constraints ----------

export interface AddConstraintParams {
  readonly body: ConstraintBody;
}

const addConstraint = define<AddConstraintParams, { id: number }>({
  id: 'constraint.add',
  label: 'Add constraint',
  parse(raw) {
    const o = readObject(raw, '', ['body']);
    return { body: readConstraintBody(o['body'], 'body') };
  },
  run(draft, p) {
    requireConstraintApplies(draft, p.body);
    const id = draft.allocateId();
    draft.putConstraint({ id, body: p.body, ...draft.sheetField() });
    return { id };
  },
});

export interface DeleteConstraintParams {
  readonly ids: readonly number[];
}

const deleteConstraints = define<DeleteConstraintParams, { deleted: number }>({
  id: 'constraint.delete',
  label: 'Delete constraint',
  parse(raw) {
    const o = readObject(raw, '', ['ids']);
    return { ids: readIds(o['ids'], 'ids') };
  },
  run(draft, p) {
    for (const id of p.ids) {
      if (!draft.constraint(id)) throw new CommandError(`There is no constraint with id ${id}.`);
    }
    for (const id of p.ids) deleteConstraintPair(draft, id);
    return { deleted: p.ids.length };
  },
});

const solveNow = define<Record<string, never>, Record<string, never>>({
  id: 'constraint.solve',
  label: 'Solve constraints',
  parse(raw) {
    readObject(raw, '', [], []);
    return {};
  },
  run() {
    // commitDraft always re-solves; this command exists so a script can force a pass.
    return {};
  },
});

export interface SetConstraintValueParams {
  readonly id: number;
  readonly value: number;
}

const setConstraintValue = define<SetConstraintValueParams, { id: number }>({
  id: 'constraint.setValue',
  label: 'Set constraint value',
  parse(raw) {
    const o = readObject(raw, '', ['id', 'value']);
    const value = readNumber(o['value'], 'value');
    return { id: readPositiveInteger(o['id'], 'id'), value };
  },
  run(draft, p) {
    const c = draft.constraint(p.id);
    if (!c) throw new CommandError(`There is no constraint with id ${p.id}.`);
    const b = c.body;
    let next: ConstraintBody;
    if (b.kind === 'distance' || b.kind === 'radius' || b.kind === 'length') {
      if (!(p.value > 0)) throw new CommandError('The value must be more than 0.');
      next = { ...b, value: p.value };
    } else if (b.kind === 'angle') {
      if (!(p.value > 0) || p.value >= Math.PI) throw new CommandError('The angle must be between 0 and 180°, not including the ends.');
      next = { ...b, value: p.value };
    } else {
      throw new CommandError('This constraint has no value to change.');
    }
    requireConstraintApplies(draft, next);
    draft.putConstraint({ ...c, body: next });
    solveConstraints(draft);
    const unmet = unmetOnDraft(draft);
    if (unmet.length > 0) {
      const bad = draft.constraint(unmet[0]!.id) ?? { ...c, body: next };
      throw new CommandError(constraintRefuseMessage(bad));
    }
    return { id: c.id };
  },
});

export interface SetConstraintFixParams {
  readonly id: number;
  readonly p: { readonly x: number; readonly y: number };
}

const setConstraintFix = define<SetConstraintFixParams, { id: number }>({
  id: 'constraint.setFix',
  label: 'Set fixed point',
  parse(raw) {
    const o = readObject(raw, '', ['id', 'p']);
    return { id: readPositiveInteger(o['id'], 'id'), p: readPoint(o['p'], 'p') };
  },
  run(draft, p) {
    const c = draft.constraint(p.id);
    if (!c) throw new CommandError(`There is no constraint with id ${p.id}.`);
    if (c.body.kind !== 'fix') throw new CommandError('That constraint does not hold a point still.');
    const next: ConstraintBody = { ...c.body, p: p.p };
    requireConstraintApplies(draft, next);
    draft.putConstraint({ ...c, body: next });
    solveConstraints(draft);
    const unmet = unmetOnDraft(draft);
    if (unmet.length > 0) {
      const bad = draft.constraint(unmet[0]!.id) ?? { ...c, body: next };
      throw new CommandError(constraintRefuseMessage(bad));
    }
    return { id: c.id };
  },
});

export { readConstraintBody };

export const LAYOUT_COMMANDS = {
  'block.create': createBlock,
  'block.insert': insertBlock,
  'block.delete': deleteBlock,
  'insert.explode': explodeInserts,
  'sheet.add': addSheet,
  'sheet.setCurrent': setCurrentSheet,
  'sheet.rename': renameSheet,
  'sheet.delete': deleteSheet,
  'sheet.setSize': setSheetSize,
  'constraint.add': addConstraint,
  'constraint.delete': deleteConstraints,
  'constraint.solve': solveNow,
  'constraint.setValue': setConstraintValue,
  'constraint.setFix': setConstraintFix,
} as const;
