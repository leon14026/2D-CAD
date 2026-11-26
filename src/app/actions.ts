/**
 * Everything the user can do, as plain functions over the store and the view. Buttons, keys
 * and the command palette all call these, so behaviour stays the same however it is reached.
 */
import {
  CommandError,
  createSession,
  executeUnchecked,
  FILE_EXTENSION,
  FileFormatError,
  findLayer,
  loadDocument,
  newDocument,
  saveDocument,
  type Doc,
} from '../core/doc';
import { isSelectable, type SnapKind } from '../core/spatial';
import { RULER } from '../render/rulers';
import type { CanvasView } from '../render/view';
import { fitRect, panBy, zoomAt } from '../render/viewport';
import { EXAMPLE_FILE, LARGE_EXAMPLE_FILE } from './examples';
import { doRedo, doUndo, isDirty, type Store } from './store';

const FIT_MARGIN = 28;
/** Width the tool rail takes from the left of the drawing area, gap included (CSS pixels). */
export const RAIL_WIDTH = 42;

export class Actions {
  constructor(
    readonly store: Store,
    readonly view: CanvasView,
  ) {}

  // ---------- view ----------

  /** Fits everything shown into the drawing area, clear of the rulers and the tool rail. */
  fit(): void {
    const ext = this.view.extents();
    if (!ext) return;
    const { width, height } = this.view;
    const left = RULER + RAIL_WIDTH;
    const vp = fitRect(ext, width - left, height - RULER, FIT_MARGIN, this.store.get().viewport);
    this.store.set({ viewport: { ...vp, originX: vp.originX + left, originY: vp.originY + RULER } });
  }

  zoom(factor: number): void {
    const { width, height } = this.view;
    this.store.set((s) => ({ viewport: zoomAt(s.viewport, { x: width / 2, y: height / 2 }, factor) }));
  }

  pan(dx: number, dy: number): void {
    this.store.set((s) => ({ viewport: panBy(s.viewport, dx, dy) }));
  }

  toggleGrid(): void {
    this.store.set((s) => ({ showGrid: !s.showGrid }));
  }

  toggleLineweights(): void {
    this.store.set((s) => ({ lineweights: !s.lineweights }));
  }

  toggleLayersPanel(): void {
    this.store.set((s) => ({ showLayers: !s.showLayers }));
  }

  toggleSelectionPanel(): void {
    this.store.set((s) => ({ showSelection: !s.showSelection }));
  }

  // ---------- snaps and tracking ----------

  toggleSnaps(): void {
    this.store.set((s) => ({ snapOn: !s.snapOn }));
  }

  toggleSnapKind(kind: SnapKind): void {
    this.store.set((s) => {
      const kinds = new Set(s.snapKinds);
      if (kinds.has(kind)) kinds.delete(kind);
      else kinds.add(kind);
      return { snapKinds: kinds, snapOn: true };
    });
  }

  toggleOrtho(): void {
    this.store.set((s) => ({ ortho: !s.ortho }));
  }

  togglePolar(): void {
    this.store.set((s) => ({ polarOn: !s.polarOn }));
  }

  setPolarStep(degrees: number): void {
    this.store.set({ polarOn: true, polarStep: degrees });
  }

  // ---------- selection ----------

  selectAll(): void {
    const doc = this.store.get().session.doc;
    this.store.set({ selection: new Set([...doc.entities.values()].filter((e) => isSelectable(doc, e)).map((e) => e.id)) });
  }

  clearSelection(): void {
    if (this.store.get().selection.size > 0) this.store.set({ selection: new Set() });
  }

  // ---------- editing ----------

  undo(): void {
    doUndo(this.store);
  }

  redo(): void {
    doRedo(this.store);
  }

  /** Runs a document command; problems are shown as a message rather than thrown. */
  run(id: string, params: unknown): boolean {
    try {
      const r = executeUnchecked(this.store.get().session, id, params);
      this.store.set({ session: r.session });
      return true;
    } catch (err) {
      if (err instanceof CommandError) {
        this.store.set({ message: { kind: 'error', text: err.message } });
        return false;
      }
      throw err;
    }
  }

  /** Joins the selected pieces into one polyline. */
  joinSelection(): void {
    const ids = [...this.store.get().selection];
    if (ids.length < 2) {
      this.store.set({ message: { kind: 'error', text: 'Select at least two pieces that meet end to end, then join them.' } });
      return;
    }
    if (this.run('entity.join', { ids })) this.store.set({ selection: new Set([ids[0] as number]) });
  }

  /** Breaks the selected polylines into separate lines and arcs. */
  explodeSelection(): void {
    const ids = [...this.store.get().selection];
    if (ids.length === 0) return;
    this.run('entity.explode', { ids });
  }

  deleteSelection(): void {
    const ids = [...this.store.get().selection];
    if (ids.length === 0) return;
    if (this.run('entity.delete', { ids })) this.store.set({ message: { kind: 'info', text: `Deleted ${ids.length === 1 ? 'one object' : `${ids.length} objects`}. Ctrl+Z brings ${ids.length === 1 ? 'it' : 'them'} back.` } });
  }

  setLayerVisible(id: number, visible: boolean): void {
    this.run('layer.update', { id, visible });
  }

  setLayerLocked(id: number, locked: boolean): void {
    this.run('layer.update', { id, locked });
  }

  setCurrentLayer(id: number): void {
    this.run('layer.setCurrent', { id });
  }

  // ---------- files ----------

  private confirmDiscard(): boolean {
    return !isDirty(this.store.get()) || window.confirm('Discard the unsaved changes to this drawing?');
  }

  private show(doc: Doc, fileName: string | null): void {
    this.store.set({
      session: createSession(doc),
      savedDoc: doc,
      fileName,
      selection: new Set(),
      hover: null,
    });
    this.fit();
  }

  newDrawing(): void {
    if (!this.confirmDiscard()) return;
    this.show(newDocument(), null);
    const { width, height } = this.view;
    this.store.set({ viewport: { originX: width / 2, originY: height / 2, pxPerUnit: 4 } });
  }

  /** Opens drawing text. Returns false (and shows why) if the file can't be read. */
  openText(text: string, fileName: string | null): boolean {
    let doc: Doc;
    try {
      doc = loadDocument(text);
    } catch (err) {
      if (err instanceof FileFormatError) {
        this.store.set({
          message: {
            kind: 'error',
            text: `${fileName ?? 'This file'} could not be opened.`,
            detail: err.message,
          },
        });
        return false;
      }
      throw err;
    }
    this.show(doc, fileName);
    return true;
  }

  async openFile(file: File): Promise<void> {
    if (!this.confirmDiscard()) return;
    this.openText(await file.text(), file.name);
  }

  async loadExample(large = false): Promise<void> {
    if (!this.confirmDiscard()) return;
    const response = await fetch(`./${large ? LARGE_EXAMPLE_FILE : EXAMPLE_FILE}`);
    if (!response.ok) {
      this.store.set({ message: { kind: 'error', text: `The example could not be loaded (${response.status}).` } });
      return;
    }
    this.openText(await response.text(), null);
  }

  /** Downloads the drawing as an .archilite file. Nothing is uploaded anywhere. */
  save(): void {
    const s = this.store.get();
    const name = s.fileName ?? `${slug(s.session.doc.settings.title)}${FILE_EXTENSION}`;
    const blob = new Blob([saveDocument(s.session.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.store.set({ savedDoc: s.session.doc, fileName: name, message: { kind: 'info', text: `Saved ${name}` } });
  }

  layerName(id: number): string {
    return findLayer(this.store.get().session.doc, id)?.name ?? '?';
  }
}

/** A file name from a drawing title: "Example bracket" → "example-bracket". */
export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'drawing';
}
