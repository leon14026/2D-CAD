import type { Change } from './changes';
import type { Doc, DocSettings, Entity, Layer } from './model';
import type { DimStyle, Note, NoteEnv } from './notes';

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
  private layersNow: readonly Layer[];
  private settingsNow: DocSettings;
  private nextIdNow: number;

  constructor(readonly base: Doc) {
    this.layersNow = base.layers;
    this.settingsNow = base.settings;
    this.nextIdNow = base.nextId;
  }

  get layers(): readonly Layer[] {
    return this.layersNow;
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

  putNote(n: Note): void {
    this.touchedNotes.set(n.id, n);
  }

  deleteNote(id: number): void {
    this.touchedNotes.set(id, null);
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

  setSettings(settings: DocSettings): void {
    this.settingsNow = settings;
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
    if (this.layersNow !== this.base.layers) {
      out.push({ kind: 'layers', before: this.base.layers, after: this.layersNow });
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
