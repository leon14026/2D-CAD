/**
 * Everything the user can do, as plain functions over the store and the view. Buttons, keys
 * and the command palette all call these, so behaviour stays the same however it is reached.
 */
import {
  CommandError,
  createSession,
  executeUnchecked,
  releasedMessage,
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
import { LENGTH_UNITS, type LengthUnit } from '../core/geom';
import { applyJavaScript, applyPython, type ScriptLanguage } from '../script';
import { exportDxf, exportPdf, exportSvg, importDxf, IoError, looksLikeDxf } from '../io';
import { ensurePython } from './python';
import { isSelectable, type SnapKind } from '../core/spatial';
import { exportPng } from '../render/png';
import { RULER } from '../render/rulers';
import type { CanvasView } from '../render/view';
import { fitRect, panBy, zoomAt } from '../render/viewport';
import { EXAMPLE_FILE, LARGE_EXAMPLE_FILE } from './examples';
import { isPhone } from './phone';
import { saveToast, writeLocalFile, type SaveHost } from './save';
import { doRedo, doUndo, isDirty, type Store } from './store';

const FIT_MARGIN = 28;
/** Width the tool rail takes from the left of the drawing area when it is one column, gap included (CSS pixels). */
export const RAIL_WIDTH = 42;

/** The rail's width now, gap included: on short windows it continues in a second column. */
function railWidth(): number {
  const rail = document.getElementById('al-tools');
  return rail && rail.offsetWidth > 0 ? rail.offsetWidth + (RAIL_WIDTH - 36) : RAIL_WIDTH;
}

/** Space the rail occupies: a left column on the desk, a bottom strip on a phone. */
function chromeInsets(): { left: number; bottom: number } {
  if (isPhone()) {
    const rail = document.getElementById('al-tools');
    const bottom = rail && rail.offsetHeight > 0 ? rail.offsetHeight + 8 : 56;
    return { left: RULER, bottom };
  }
  return { left: RULER + railWidth(), bottom: 0 };
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
    const { left, bottom } = chromeInsets();
    const vp = fitRect(ext, width - left, height - RULER - bottom, FIT_MARGIN, this.store.get().viewport);
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
    this.store.set((s) => {
      const open = !s.showLayers;
      return { showLayers: open, ...(open && isPhone() ? { showSelection: false, showScript: false } : {}) };
    });
  }

  toggleSelectionPanel(): void {
    this.store.set((s) => {
      const open = !s.showSelection;
      return { showSelection: open, ...(open && isPhone() ? { showLayers: false, showScript: false } : {}) };
    });
  }

  toggleScriptPanel(): void {
    this.store.set((s) => {
      const open = !s.showScript;
      return { showScript: open, ...(open && isPhone() ? { showLayers: false, showSelection: false } : {}) };
    });
  }

  toggleConstraints(): void {
    this.store.set((s) => ({ showConstraints: !s.showConstraints }));
  }

  showScriptPanel(): void {
    this.store.set(isPhone() ? { showScript: true, showLayers: false, showSelection: false } : { showScript: true });
  }

  closeSheets(): void {
    this.store.set({ showLayers: false, showSelection: false, showScript: false });
  }

  /**
   * Next drag is a selection box. On a phone a drag otherwise pans, so this is how you
   * window-select. Left to right takes what is inside; right to left also takes what it touches.
   */
  beginBoxSelect(): void {
    this.store.set({
      boxSelect: true,
      tool: null,
      toolError: null,
      message: {
        kind: 'info',
        text: 'Drag a box to select. Left to right takes what is inside; right to left also takes what it touches.',
      },
    });
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
      this.store.set({
        message: {
          kind: 'info',
          text: isPhone()
            ? 'Loading Python… This downloads about 12 MB from this site, then runs from files on this page.'
            : 'Loading Python…',
        },
      });
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

  /**
   * `convert` false keeps the numbers and only changes the label (a 100 mm line becomes
   * 100 in). `convert` true keeps real sizes (100 mm becomes 3.937 in).
   */
  setUnits(units: LengthUnit, convert: boolean): void {
    this.run('doc.setUnits', { units, convert });
  }

  /** Relabels drawing units to the next unit in the list. Numbers do not change. */
  cycleUnits(): void {
    const from = this.store.get().session.doc.settings.units;
    const i = LENGTH_UNITS.indexOf(from);
    const next = LENGTH_UNITS[(i + 1) % LENGTH_UNITS.length] as LengthUnit;
    this.setUnits(next, false);
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

  selectIds(ids: readonly number[]): void {
    this.store.set({ selection: new Set(ids) });
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
      if (r.released > 0) this.store.set({ message: { kind: 'info', text: releasedMessage(r.released) } });
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

  setNoteReference(id: number, reference: boolean): void {
    this.run('note.setReference', { id, reference });
  }

  setConstraintValue(id: number, value: number): void {
    this.run('constraint.setValue', { id, value });
  }

  setConstraintFix(id: number, p: { readonly x: number; readonly y: number }): void {
    this.run('constraint.setFix', { id, p });
  }

  removeConstraint(id: number): void {
    this.run('constraint.delete', { ids: [id] });
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

  /** Writes the drawing as an .archilite file on this device. Nothing is uploaded. */
  async save(): Promise<void> {
    const s = this.store.get();
    const name = nativeName(s.fileName, s.session.doc.settings.title);
    const blob = new Blob([saveDocument(s.session.doc)], { type: 'application/json' });
    const channel = await writeLocalFile(name, blob, this.saveHost());
    if (channel === null) return;
    this.store.set({ savedDoc: s.session.doc, fileName: name, message: { kind: 'info', text: saveToast(name, channel) } });
  }

  /** On a phone: picker, then share, then the same download the desk uses. */
  private saveHost(): SaveHost {
    const w = window as Window & { showSaveFilePicker?: SaveHost['showSaveFilePicker'] };
    return {
      ...(isPhone() && w.showSaveFilePicker ? { showSaveFilePicker: w.showSaveFilePicker.bind(w) } : {}),
      ...(isPhone() && navigator.canShare ? { canShare: (data) => navigator.canShare!(data) } : {}),
      ...(isPhone() && navigator.share ? { share: (data) => navigator.share!(data) } : {}),
      download: (name, blob) => this.download(name, blob),
    };
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
