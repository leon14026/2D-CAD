/**
 * The frame around the drawing: top bar, status bar, empty state, messages, keyboard
 * shortcuts and the command palette's list.
 */
import { canRedo, canUndo, redoLabel, undoLabel } from '../core/doc';
import { APP_NAME } from './brand';
import { convertLength } from '../core/geom';
import { screenScaleLabel } from '../render/viewport';
import { CommandPalette, type PaletteEntry } from '../ui/command-palette';
import { el, icon, requireElement } from '../ui/dom';
import type { Actions } from './actions';
import { isTyping } from './interaction';
import { isDirty, type AppState, type Store } from './store';

export function paletteEntries(actions: Actions, store: Store): PaletteEntry[] {
  const s = () => store.get();
  return [
    { label: 'Zoom to fit the drawing', keys: 'F', run: () => actions.fit() },
    { label: 'Zoom in', keys: '+', run: () => actions.zoom(1.25) },
    { label: 'Zoom out', keys: '−', run: () => actions.zoom(0.8) },
    { label: 'Select all', keys: 'Ctrl A', run: () => actions.selectAll() },
    { label: 'Clear the selection', keys: 'Esc', run: () => actions.clearSelection(), enabled: () => s().selection.size > 0 },
    { label: 'Undo', keys: 'Ctrl Z', run: () => actions.undo(), enabled: () => canUndo(s().session) },
    { label: 'Redo', keys: 'Ctrl Y', run: () => actions.redo(), enabled: () => canRedo(s().session) },
    { label: 'Show or hide the grid', keys: 'G', run: () => actions.toggleGrid() },
    { label: 'Show or hide lineweights', keys: 'W', run: () => actions.toggleLineweights() },
    { label: 'Show or hide the layers panel', keys: 'L', run: () => actions.toggleLayersPanel() },
    { label: 'Show or hide the selection panel', keys: 'P', run: () => actions.toggleSelectionPanel() },
    { label: 'Open a drawing…', keys: 'Ctrl O', run: () => requireElement('#al-file', HTMLInputElement).click() },
    { label: 'Save the drawing', keys: 'Ctrl S', run: () => actions.save() },
    { label: 'Load the example bracket', run: () => void actions.loadExample() },
    { label: 'Load the large test drawing (20,000 entities)', run: () => void actions.loadExample(true) },
    { label: 'Start a new drawing', run: () => actions.newDrawing() },
    { label: 'Open the file inspector', run: () => window.open('./inspect.html', '_self') },
    ...s().session.doc.layers.flatMap((l) => [
      { label: `${l.visible ? 'Hide' : 'Show'} layer ${l.name}`, run: () => actions.setLayerVisible(l.id, !l.visible) },
      { label: `${l.locked ? 'Unlock' : 'Lock'} layer ${l.name}`, run: () => actions.setLayerLocked(l.id, !l.locked) },
    ]),
  ];
}

export function mountShell(store: Store, actions: Actions, build: string): CommandPalette {
  const palette = new CommandPalette(() => paletteEntries(actions, store));

  // Top bar.
  const title = requireElement('#al-title', HTMLElement);
  const dirty = requireElement('#al-dirty', HTMLElement);
  const fileName = requireElement('#al-file-name', HTMLElement);
  const fileInput = requireElement('#al-file', HTMLInputElement);
  requireElement('#al-search', HTMLButtonElement).addEventListener('click', () => palette.open());
  const undoButton = el('button', { className: 'al-button al-icon-button', attrs: { type: 'button' }, on: { click: () => actions.undo() } }, icon('undo'));
  const redoButton = el('button', { className: 'al-button al-icon-button', attrs: { type: 'button' }, on: { click: () => actions.redo() } }, icon('redo'));
  requireElement('#al-history', HTMLElement).append(undoButton, redoButton);
  requireElement('#al-file-actions', HTMLElement).append(
    el('button', { className: 'al-button', attrs: { type: 'button' }, on: { click: () => fileInput.click() } }, icon('open'), 'Open'),
    el('button', { className: 'al-button al-button-primary', attrs: { type: 'button' }, on: { click: () => actions.save() } }, icon('save'), 'Save'),
  );
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void actions.openFile(file);
  });

  // Empty state.
  const empty = requireElement('#al-empty', HTMLElement);
  empty.append(
    el('h2', { text: 'Open a drawing to start' }),
    el('p', { text: 'Open an .archilite file, drop one here, or look around the example bracket.' }),
    el(
      'div',
      { className: 'al-group' },
      el('button', { className: 'al-button al-button-primary', text: 'Load the example', attrs: { type: 'button' }, on: { click: () => void actions.loadExample() } }),
      el('button', { className: 'al-button', text: 'Open a drawing', attrs: { type: 'button' }, on: { click: () => fileInput.click() } }),
    ),
  );

  // Drop a file anywhere on the drawing area.
  const stage = requireElement('#al-stage', HTMLElement);
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) void actions.openFile(file);
  });

  // Status bar.
  const scale = requireElement('#al-scale', HTMLElement);
  const count = requireElement('#al-count', HTMLElement);
  const units = requireElement('#al-units', HTMLElement);
  const grid = requireElement('#al-grid-toggle', HTMLButtonElement);
  const weights = requireElement('#al-weight-toggle', HTMLButtonElement);
  grid.addEventListener('click', () => actions.toggleGrid());
  weights.addEventListener('click', () => actions.toggleLineweights());
  requireElement('#al-build', HTMLElement).textContent = build;

  // Messages.
  const toast = requireElement('#al-toast', HTMLElement);
  let toastTimer = 0;

  const render = (s: AppState, p: AppState | null) => {
    const doc = s.session.doc;
    title.textContent = doc.settings.title;
    document.title = `${doc.settings.title} – ${APP_NAME}`;
    dirty.hidden = !isDirty(s);
    fileName.textContent = s.fileName ?? '';
    undoButton.disabled = !canUndo(s.session);
    redoButton.disabled = !canRedo(s.session);
    undoButton.title = canUndo(s.session) ? `Undo ${undoLabel(s.session)} (Ctrl Z)` : 'Nothing to undo';
    redoButton.title = canRedo(s.session) ? `Redo ${redoLabel(s.session)} (Ctrl Y)` : 'Nothing to redo';
    undoButton.setAttribute('aria-label', undoButton.title);
    redoButton.setAttribute('aria-label', redoButton.title);
    empty.hidden = doc.entities.size > 0;
    scale.textContent = `Scale ${screenScaleLabel(s.viewport, convertLength(1, doc.settings.units, 'mm'))}`;
    units.textContent = doc.settings.units;
    count.textContent = s.selection.size > 0 ? `${s.selection.size} of ${doc.entities.size} selected` : `${doc.entities.size} entities`;
    grid.setAttribute('aria-pressed', String(s.showGrid));
    grid.textContent = s.showGrid ? 'Grid on' : 'Grid off';
    weights.setAttribute('aria-pressed', String(s.lineweights));
    weights.textContent = s.lineweights ? 'Lineweights on' : 'Lineweights off';
    document.body.classList.toggle('al-hide-left', !s.showLayers);
    document.body.classList.toggle('al-hide-right', !s.showSelection);
    if (s.message !== p?.message) {
      clearTimeout(toastTimer);
      if (s.message) {
        toast.replaceChildren(el('span', { text: s.message.text }));
        if (s.message.detail) toast.append(el('small', { text: s.message.detail }));
        toast.classList.toggle('is-error', s.message.kind === 'error');
        toast.hidden = false;
        toastTimer = window.setTimeout(() => store.set({ message: null }), s.message.kind === 'error' ? 9000 : 3500);
      } else {
        toast.hidden = true;
      }
    }
  };
  toast.addEventListener('click', () => store.set({ message: null }));
  render(store.get(), null);
  store.subscribe(render);

  // Keyboard shortcuts.
  window.addEventListener('keydown', (e) => {
    if (palette.isOpen || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (mod && key === 'k') return run(() => palette.open());
    if (mod && key === 'z' && !e.shiftKey) return run(() => actions.undo());
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) return run(() => actions.redo());
    if (mod && key === 'a') return run(() => actions.selectAll());
    if (mod && key === 's') return run(() => actions.save());
    if (mod && key === 'o') return run(() => fileInput.click());
    if (mod || e.altKey) return;
    if (key === 'escape') return run(() => actions.clearSelection());
    if (key === 'f') return run(() => actions.fit());
    if (key === 'g') return run(() => actions.toggleGrid());
    if (key === 'w') return run(() => actions.toggleLineweights());
    if (key === 'l') return run(() => actions.toggleLayersPanel());
    if (key === 'p') return run(() => actions.toggleSelectionPanel());
    if (key === '+' || key === '=') return run(() => actions.zoom(1.25));
    if (key === '-' || key === '_') return run(() => actions.zoom(0.8));
    const step = 60;
    if (key === 'arrowleft') return run(() => actions.pan(step, 0));
    if (key === 'arrowright') return run(() => actions.pan(-step, 0));
    if (key === 'arrowup') return run(() => actions.pan(0, step));
    if (key === 'arrowdown') return run(() => actions.pan(0, -step));
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty(store.get())) e.preventDefault();
  });

  return palette;
}
