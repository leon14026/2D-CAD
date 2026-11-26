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
  onCurrentSheet,
  saveDocument,
  type DimStyle,
  type Doc,
} from '../core/doc';
import { applyJavaScript, applyPython, type ScriptLanguage } from '../script';
import { exportDxf, exportPdf, exportSvg, importDxf, IoError, looksLikeDxf } from '../io';
import { ensurePython } from './python';
import { isSelectable, type SnapKind } from '../core/spatial';
import { exportPng } from '../render/png';
import { RULER } from '../render/rulers';
import type { CanvasView } from '../render/view';
import { fitRect, panBy, zoomAt } from '../render/viewport';
import { EXAMPLE_FILE, LARGE_EXAMPLE_FILE } from './examples';
import { doRedo, doUndo, isDirty, type Store } from './store';

const FIT_MARGIN = 28;
/** Width the tool rail takes from the left of the drawing area when it is one column, gap included (CSS pixels). */
export const RAIL_WIDTH = 42;

/** The rail's width now, gap included: on short windows it continues in a second column. */
function railWidth(): number {
  const rail = document.getElementById('al-tools');
  return rail && rail.offsetWidth > 0 ? rail.offsetWidth + (RAIL_WIDTH - 36) : RAIL_WIDTH;
}

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
    const left = RULER + railWidth();
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

  toggleScriptPanel(): void {
    this.store.set((s) => ({ showScript: !s.showScript }));
  }

  showScriptPanel(): void {
    this.store.set({ showScript: true });
  }

  /**
   * Runs a script against the current drawing as one undo step. Python loads Pyodide from
   * this origin the first time; JavaScript never does.
   */
  async runScript(language: ScriptLanguage, source: string): Promise<{ ok: boolean; log: string[]; error?: string }> {
    try {
      if (language === 'javascript') {
        const { session, log } = applyJavaScript(this.store.get().session, source);
        this.store.set({
          session,
          message: { kind: 'info', text: log.length > 0 ? log.join('\n') : 'Script finished.' },
        });
        if (session.doc !== this.store.get().savedDoc) this.fit();
        return { ok: true, log };
      }
      this.store.set({ message: { kind: 'info', text: 'Loading Python…' } });
      const py = await ensurePython();
      const { session, log } = await applyPython(this.store.get().session, source, py);
      this.store.set({
        session,
        message: { kind: 'info', text: log.length > 0 ? log.join('\n') : 'Script finished.' },
      });
      if (session.doc !== this.store.get().savedDoc) this.fit();
      return { ok: true, log };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.store.set({ message: { kind: 'error', text: error } });
      return { ok: false, log: [], error };
    }
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
    const everything = [...doc.entities.values(), ...doc.notes.values(), ...doc.inserts.values()];
    this.store.set({
      selection: new Set(everything.filter((e) => isSelectable(doc, e) && onCurrentSheet(doc, e)).map((e) => e.id)),
    });
  }

  addSheet(name: string, size?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0'): void {
    if (this.run('sheet.add', { name, ...(size ? { size } : {}) })) this.fit();
  }

  useSheet(name: string): void {
    if (this.run('sheet.setCurrent', { name })) {
      this.store.set({ selection: new Set() });
      this.fit();
    }
  }

  cycleSheet(): void {
    const doc = this.store.get().session.doc;
    if (doc.sheets.length < 2) {
      this.store.set({ message: { kind: 'info', text: 'This drawing has one sheet. Search commands for “Add a sheet”.' } });
      return;
    }
    const i = doc.sheets.findIndex((s) => s.name === doc.settings.currentSheet);
    const next = doc.sheets[(i + 1) % doc.sheets.length]!;
    this.useSheet(next.name);
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

  /** Changes fields of an annotation, such as its text or a title block's fields. */
  editNote(id: number, patch: Record<string, unknown>): void {
    this.run('note.edit', { id, patch });
  }

  /** Saves a dimension style under its name (replacing one of that name, or adding one) and uses it. */
  saveDimStyle(style: DimStyle): void {
    if (this.run('dimstyle.set', { style })) this.run('dimstyle.use', { name: style.name });
  }

  useDimStyle(name: string): void {
    this.run('dimstyle.use', { name });
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

  /** Opens drawing text (.archilite or DXF). Returns false (and shows why) if the file can't be read. */
  openText(text: string, fileName: string | null): boolean {
    const name = fileName ?? 'This file';
    const fail = (detail: string): false => {
      this.store.set({ message: { kind: 'error', text: `${name} could not be opened.`, detail } });
      return false;
    };
    try {
      if (looksLikeDxf(text) || name.toLowerCase().endsWith('.dxf')) {
        const { doc, skipped } = importDxf(text);
        this.show(doc, fileName);
        this.store.set({
          message: {
            kind: 'info',
            text:
              skipped === 0
                ? `Opened ${name}`
                : `Opened ${name}. ${skipped === 1 ? 'One object' : `${skipped} objects`} of a kind ArchiLite does not draw ${skipped === 1 ? 'was' : 'were'} left out.`,
          },
        });
        return true;
      }
      this.show(loadDocument(text), fileName);
      return true;
    } catch (err) {
      if (err instanceof FileFormatError || err instanceof IoError) return fail(err.message);
      throw err;
    }
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
    const name = nativeName(s.fileName, s.session.doc.settings.title);
    this.download(name, new Blob([saveDocument(s.session.doc)], { type: 'application/json' }));
    this.store.set({ savedDoc: s.session.doc, fileName: name, message: { kind: 'info', text: `Saved ${name}` } });
  }

  exportDxf(): void {
    const doc = this.store.get().session.doc;
    this.download(`${slug(doc.settings.title)}.dxf`, new Blob([exportDxf(doc)], { type: 'application/dxf' }), `Exported ${slug(doc.settings.title)}.dxf`);
  }

  exportSvg(): void {
    const doc = this.store.get().session.doc;
    this.download(`${slug(doc.settings.title)}.svg`, new Blob([exportSvg(doc)], { type: 'image/svg+xml' }), `Exported ${slug(doc.settings.title)}.svg`);
  }

  exportPdf(): void {
    const doc = this.store.get().session.doc;
    this.download(`${slug(doc.settings.title)}.pdf`, new Blob([exportPdf(doc)], { type: 'application/pdf' }), `Exported ${slug(doc.settings.title)}.pdf`);
  }

  async exportPng(): Promise<void> {
    const doc = this.store.get().session.doc;
    const blob = await exportPng(doc);
    this.download(`${slug(doc.settings.title)}.png`, blob, `Exported ${slug(doc.settings.title)}.png`);
  }

  private download(name: string, blob: Blob, message?: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (message) this.store.set({ message: { kind: 'info', text: message } });
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

function nativeName(fileName: string | null, title: string): string {
  if (fileName && fileName.toLowerCase().endsWith(FILE_EXTENSION)) return fileName;
  return `${slug(title)}${FILE_EXTENSION}`;
}
