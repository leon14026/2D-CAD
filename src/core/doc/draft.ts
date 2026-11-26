import type { Block, Insert } from './blocks';
import type { Change } from './changes';
import type { Constraint } from './constraints';
import type { Doc, DocSettings, Entity, Layer } from './model';
import type { DimStyle, Note, NoteEnv } from './notes';
import type { Sheet } from './sheets';

/** Thrown when a command cannot run. The document and history are left unchanged. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * A working copy that a command edits. When the command finishes, `changes()` lists exactly
 * what differs from the original document, with before and after values for undo.
 */
export class Draft {
  private readonly touched = new Map<number, Entity | null>();
  private readonly touchedNotes = new Map<number, Note | null>();
  private readonly touchedInserts = new Map<number, Insert | null>();
  private readonly touchedConstraints = new Map<number, Constraint | null>();
  private layersNow: readonly Layer[];
  private sheetsNow: readonly Sheet[];
  private blocksNow: readonly Block[];
  private settingsNow: DocSettings;
  private nextIdNow: number;

  constructor(readonly base: Doc) {
    this.layersNow = base.layers;
    this.sheetsNow = base.sheets;
    this.blocksNow = base.blocks;
    this.settingsNow = base.settings;
    this.nextIdNow = base.nextId;
  }

  get layers(): readonly Layer[] {
    return this.layersNow;
  }

  get sheets(): readonly Sheet[] {
    return this.sheetsNow;
  }

  get blocks(): readonly Block[] {
    return this.blocksNow;
  }

  get settings(): DocSettings {
    return this.settingsNow;
  }

  entity(id: number): Entity | undefined {
    if (this.touched.has(id)) return this.touched.get(id) ?? undefined;
    return this.base.entities.get(id);
  }

  /** All entities as they stand in the draft. */
  *entities(): IterableIterator<Entity> {
    for (const [id, e] of this.base.entities) {
      if (!this.touched.has(id)) yield e;
    }
    for (const e of this.touched.values()) if (e) yield e;
  }

  note(id: number): Note | undefined {
    if (this.touchedNotes.has(id)) return this.touchedNotes.get(id) ?? undefined;
    return this.base.notes.get(id);
  }

  /** All notes as they stand in the draft. */
  *notes(): IterableIterator<Note> {
    for (const [id, n] of this.base.notes) {
      if (!this.touchedNotes.has(id)) yield n;
    }
    for (const n of this.touchedNotes.values()) if (n) yield n;
  }

  insert(id: number): Insert | undefined {
    if (this.touchedInserts.has(id)) return this.touchedInserts.get(id) ?? undefined;
    return this.base.inserts.get(id);
  }

  *inserts(): IterableIterator<Insert> {
    for (const [id, ins] of this.base.inserts) {
      if (!this.touchedInserts.has(id)) yield ins;
    }
    for (const ins of this.touchedInserts.values()) if (ins) yield ins;
  }

  constraint(id: number): Constraint | undefined {
    if (this.touchedConstraints.has(id)) return this.touchedConstraints.get(id) ?? undefined;
    return this.base.constraints.get(id);
  }

  *constraints(): IterableIterator<Constraint> {
    for (const [id, c] of this.base.constraints) {
      if (!this.touchedConstraints.has(id)) yield c;
    }
    for (const c of this.touchedConstraints.values()) if (c) yield c;
  }

  putNote(n: Note): void {
    this.touchedNotes.set(n.id, n);
  }

  deleteNote(id: number): void {
    this.touchedNotes.set(id, null);
  }

  putInsert(ins: Insert): void {
    this.touchedInserts.set(ins.id, ins);
  }

  deleteInsert(id: number): void {
    this.touchedInserts.set(id, null);
  }

  putConstraint(c: Constraint): void {
    this.touchedConstraints.set(c.id, c);
  }

  deleteConstraint(id: number): void {
    this.touchedConstraints.set(id, null);
  }

  /** Ids of entities this command has added, changed or deleted so far. */
  touchedEntityIds(): number[] {
    return [...this.touched.keys()];
  }

  /** Lets notes be measured against the draft's geometry and styles. */
  env(): NoteEnv {
    return {
      entity: (id) => this.entity(id),
      dimStyle: (name: string): DimStyle | undefined => this.settingsNow.dimStyles.find((s) => s.name === name),
    };
  }

  layer(id: number): Layer | undefined {
    return this.layersNow.find((l) => l.id === id);
  }

  allocateId(): number {
    const id = this.nextIdNow;
    this.nextIdNow += 1;
    return id;
  }

  putEntity(e: Entity): void {
    this.touched.set(e.id, e);
  }

  deleteEntity(id: number): void {
    this.touched.set(id, null);
  }

  setLayers(layers: readonly Layer[]): void {
    this.layersNow = layers;
  }

  setSheets(sheets: readonly Sheet[]): void {
    this.sheetsNow = sheets;
  }

  setBlocks(blocks: readonly Block[]): void {
    this.blocksNow = blocks;
  }

  setSettings(settings: DocSettings): void {
    this.settingsNow = settings;
  }

  /** Sheet field for a new object on the current sheet (omitted on the first sheet). */
  sheetField(): { sheet?: string } {
    const name = this.settingsNow.currentSheet;
    const first = this.sheetsNow[0]?.name;
    return name !== first ? { sheet: name } : {};
  }

  changes(): Change[] {
    const out: Change[] = [];
    for (const [id, after] of this.touched) {
      const before = this.base.entities.get(id) ?? null;
      if (before !== after) out.push({ kind: 'entity', id, before, after });
    }
    for (const [id, after] of this.touchedNotes) {
      const before = this.base.notes.get(id) ?? null;
      if (before !== after) out.push({ kind: 'note', id, before, after });
    }
    for (const [id, after] of this.touchedInserts) {
      const before = this.base.inserts.get(id) ?? null;
      if (before !== after) out.push({ kind: 'insert', id, before, after });
    }
    for (const [id, after] of this.touchedConstraints) {
      const before = this.base.constraints.get(id) ?? null;
      if (before !== after) out.push({ kind: 'constraint', id, before, after });
    }
    if (this.layersNow !== this.base.layers) {
      out.push({ kind: 'layers', before: this.base.layers, after: this.layersNow });
    }
    if (this.sheetsNow !== this.base.sheets) {
      out.push({ kind: 'sheets', before: this.base.sheets, after: this.sheetsNow });
    }
    if (this.blocksNow !== this.base.blocks) {
      out.push({ kind: 'blocks', before: this.base.blocks, after: this.blocksNow });
    }
    if (this.settingsNow !== this.base.settings) {
      out.push({ kind: 'settings', before: this.base.settings, after: this.settingsNow });
    }
    if (this.nextIdNow !== this.base.nextId) {
      out.push({ kind: 'nextId', before: this.base.nextId, after: this.nextIdNow });
    }
    return out;
  }
}
