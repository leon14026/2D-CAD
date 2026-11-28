/**
 * The frame around the drawing: top bar, status bar, empty state, messages, keyboard
 * shortcuts and the command palette's list.
 */
import { canRedo, canUndo, redoLabel, undoLabel } from '../core/doc';
import { APP_NAME } from './brand';
import { convertLength, LENGTH_UNITS, UNIT_WORDS, type LengthUnit } from '../core/geom';
import { SNAP_KINDS } from '../core/spatial';
import { POLAR_STEPS_DEGREES } from '../core/tools';
import { screenScaleLabel } from '../render/viewport';
import { CommandPalette, type PaletteEntry } from '../ui/command-palette';
import { el, icon, requireElement } from '../ui/dom';
import { ToolRail } from '../ui/rail';
import type { Actions } from './actions';
import type { DraftingController } from './drafting';
import { isTyping } from './interaction';
import { isPhone } from './phone';
import { isDirty, type AppState, type Store } from './store';
import { ANNOTATE_BUTTONS, DRAW_BUTTONS, LAYOUT_BUTTONS, MODIFY_BUTTONS, SNAP_NAMES, TOOL_BUTTONS } from './tools';

export function paletteEntries(actions: Actions, store: Store, drafting: DraftingController): PaletteEntry[] {
  const s = () => store.get();
  return [
    ...TOOL_BUTTONS.map((b) => ({ label: b.palette, ...(b.key && { keys: b.key.toUpperCase() }), run: () => drafting.start(b.id) })),
    { label: 'Stop the tool in use', keys: 'Esc', run: () => drafting.stop(), enabled: () => drafting.active },
    { label: 'Join the selected pieces into one polyline', run: () => actions.joinSelection(), enabled: () => s().selection.size >= 2 },
    { label: 'Explode the selected polylines and block inserts', run: () => actions.explodeSelection(), enabled: () => s().selection.size > 0 },
    { label: 'Add a sheet', run: () => actions.addSheet(`Sheet ${s().session.doc.sheets.length + 1}`) },
    ...s().session.doc.sheets.map((sheet) => ({
      label: s().session.doc.settings.currentSheet === sheet.name ? `Stay on sheet ${sheet.name}` : `Switch to sheet ${sheet.name}`,
      run: () => actions.useSheet(sheet.name),
    })),
    { label: 'Delete the selection', keys: 'Del', run: () => actions.deleteSelection(), enabled: () => s().selection.size > 0 },
    { label: `Turn snaps ${s().snapOn ? 'off' : 'on'}`, keys: 'Shift S', run: () => actions.toggleSnaps() },
    { label: `Turn ortho ${s().ortho ? 'off' : 'on'} (horizontal and vertical only)`, keys: 'Shift O', run: () => actions.toggleOrtho() },
    { label: `Turn angle tracking ${s().polarOn ? 'off' : 'on'}`, keys: 'Shift T', run: () => actions.togglePolar() },
    ...POLAR_STEPS_DEGREES.map((step) => ({ label: `Track angles every ${step}°`, run: () => actions.setPolarStep(step) })),
    ...SNAP_KINDS.map((k) => ({
      label: s().snapKinds.has(k) ? `Stop snapping to ${SNAP_NAMES[k]}` : `Snap to ${SNAP_NAMES[k]}`,
      run: () => actions.toggleSnapKind(k),
    })),
    { label: 'Zoom to fit the drawing', keys: 'F', run: () => actions.fit() },
    { label: 'Zoom in', keys: '+', run: () => actions.zoom(1.25) },
    { label: 'Zoom out', keys: '−', run: () => actions.zoom(0.8) },
    { label: 'Select all', keys: 'Ctrl A', run: () => actions.selectAll() },
    { label: 'Select with a box', run: () => actions.beginBoxSelect() },
    { label: 'Clear the selection', keys: 'Esc', run: () => actions.clearSelection(), enabled: () => s().selection.size > 0 },
    { label: 'Undo', keys: 'Ctrl Z', run: () => actions.undo(), enabled: () => canUndo(s().session) },
    { label: 'Redo', keys: 'Ctrl Y', run: () => actions.redo(), enabled: () => canRedo(s().session) },
    { label: 'Show or hide the grid', keys: 'G', run: () => actions.toggleGrid() },
    { label: 'Show or hide lineweights', keys: 'W', run: () => actions.toggleLineweights() },
    { label: 'Show or hide the layers panel', keys: '[', run: () => actions.toggleLayersPanel() },
    { label: 'Show or hide the selection panel', keys: ']', run: () => actions.toggleSelectionPanel() },
    { label: 'Show or hide the script panel', keys: '`', run: () => actions.toggleScriptPanel() },
    { label: s().showConstraints ? 'Hide constraints' : 'Show constraints', keys: 'Shift C', run: () => actions.toggleConstraints() },
    ...LENGTH_UNITS.flatMap((u) => [
      {
        label: `Treat drawing units as ${UNIT_WORDS[u]} (keep the numbers)`,
        enabled: () => s().session.doc.settings.units !== u,
        run: () => actions.setUnits(u, false),
      },
      {
        label: `Scale the drawing to ${UNIT_WORDS[u]}`,
        enabled: () => s().session.doc.settings.units !== u,
        run: () => actions.setUnits(u, true),
      },
    ]),
    { label: 'Open a drawing…', keys: 'Ctrl O', run: () => requireElement('#al-file', HTMLInputElement).click() },
    { label: 'Save the drawing', keys: 'Ctrl S', run: () => void actions.save() },
    { label: 'Export as DXF', run: () => actions.exportDxf() },
    { label: 'Export as SVG', run: () => actions.exportSvg() },
    { label: 'Export as PDF (1:1)', run: () => actions.exportPdf() },
    { label: 'Export as PNG', run: () => void actions.exportPng() },
    { label: 'Load the example bracket', run: () => void actions.loadExample() },
    { label: 'Show the script panel', run: () => actions.showScriptPanel() },
    { label: 'Load the large test drawing (20,000 entities)', run: () => void actions.loadExample(true) },
    { label: 'Start a new drawing', run: () => actions.newDrawing() },
    { label: 'Open the file inspector', run: () => window.open('./inspect.html', '_self') },
    ...s().session.doc.layers.flatMap((l) => [
      { label: `${l.visible ? 'Hide' : 'Show'} layer ${l.name}`, run: () => actions.setLayerVisible(l.id, !l.visible) },
      { label: `${l.locked ? 'Unlock' : 'Lock'} layer ${l.name}`, run: () => actions.setLayerLocked(l.id, !l.locked) },
    ]),
  ];
}

function exportMenu(actions: Actions): HTMLElement {
  const menu = el('div', { className: 'al-menu', attrs: { role: 'menu', hidden: '' } });
  const items: { label: string; run: () => void }[] = [
    { label: 'Export as DXF', run: () => actions.exportDxf() },
    { label: 'Export as SVG', run: () => actions.exportSvg() },
    { label: 'Export as PDF (1:1)', run: () => actions.exportPdf() },
    { label: 'Export as PNG', run: () => void actions.exportPng() },
  ];
  for (const item of items) {
    menu.append(
      el('button', {
        className: 'al-menu-item',
        text: item.label,
        attrs: { type: 'button', role: 'menuitem' },
        on: {
          click: () => {
            menu.setAttribute('hidden', '');
            item.run();
          },
        },
      }),
    );
  }
  const wrap = el('div', { className: 'al-menu-wrap' });
  const button = el(
    'button',
    {
      className: 'al-button',
      attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      on: {
        click: () => {
          const open = menu.hasAttribute('hidden');
          if (open) menu.removeAttribute('hidden');
          else menu.setAttribute('hidden', '');
          button.setAttribute('aria-expanded', open ? 'true' : 'false');
        },
      },
    },
    icon('export'),
    'Export',
  );
  wrap.append(button, menu);
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target as Node)) {
      menu.setAttribute('hidden', '');
      button.setAttribute('aria-expanded', 'false');
    }
  });
  return wrap;
}

export function mountShell(store: Store, actions: Actions, drafting: DraftingController, build: string): CommandPalette {
  const palette = new CommandPalette(() => paletteEntries(actions, store, drafting));

  // Tool rail.
  const rail = new ToolRail(
    requireElement('#al-tools', HTMLElement),
    [
      { label: 'Draw', buttons: DRAW_BUTTONS },
      { label: 'Modify', buttons: MODIFY_BUTTONS },
      { label: 'Annotate', buttons: ANNOTATE_BUTTONS },
      { label: 'Layout', buttons: LAYOUT_BUTTONS },
    ],
    (id) =>
      id === null ? drafting.stop() : drafting.start(id),
  );

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
    el('button', { className: 'al-button al-button-primary', attrs: { type: 'button' }, on: { click: () => void actions.save() } }, icon('save'), 'Save'),
    exportMenu(actions),
    el(
      'button',
      {
        className: 'al-button',
        attrs: { type: 'button', id: 'al-script-toggle' },
        on: { click: () => actions.toggleScriptPanel() },
      },
      icon('script'),
      'Script',
    ),
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
    el('p', { text: 'Open an ArchiLite, DXF or DWG file, drop one here, or look around the example bracket.' }),
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
  const units = requireElement('#al-units', HTMLButtonElement);
  const grid = requireElement('#al-grid-toggle', HTMLButtonElement);
  const weights = requireElement('#al-weight-toggle', HTMLButtonElement);
  const snaps = requireElement('#al-snap-toggle', HTMLButtonElement);
  const ortho = requireElement('#al-ortho-toggle', HTMLButtonElement);
  const polar = requireElement('#al-polar-toggle', HTMLButtonElement);
  const sheetBtn = requireElement('#al-sheet', HTMLButtonElement);
  grid.addEventListener('click', () => actions.toggleGrid());
  weights.addEventListener('click', () => actions.toggleLineweights());
  snaps.addEventListener('click', () => actions.toggleSnaps());
  ortho.addEventListener('click', () => actions.toggleOrtho());
  polar.addEventListener('click', () => actions.togglePolar());
  sheetBtn.addEventListener('click', () => actions.cycleSheet());
  units.addEventListener('click', () => actions.cycleUnits());
  requireElement('#al-build', HTMLElement).textContent = build;

  // Messages.
  const toast = requireElement('#al-toast', HTMLElement);
  let toastTimer = 0;
  const sheetBackdrop = el('div', {
    className: 'al-sheet-backdrop',
    attrs: { hidden: '' },
    on: { click: () => actions.closeSheets() },
  });
  document.body.append(sheetBackdrop);

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
    empty.hidden = doc.entities.size + doc.notes.size + doc.inserts.size > 0;
    scale.textContent = `Scale ${screenScaleLabel(s.viewport, convertLength(1, doc.settings.units, 'mm'))}`;
    units.textContent = doc.settings.units;
    const nextUnit = LENGTH_UNITS[(LENGTH_UNITS.indexOf(doc.settings.units) + 1) % LENGTH_UNITS.length] as LengthUnit;
    units.title = `These numbers are ${UNIT_WORDS[doc.settings.units]}. Click to treat them as ${UNIT_WORDS[nextUnit]} without scaling.`;
    sheetBtn.textContent = doc.settings.currentSheet;
    sheetBtn.title = doc.sheets.length > 1 ? `Sheet ${doc.settings.currentSheet} (click to switch)` : `Sheet ${doc.settings.currentSheet}`;
    const things = doc.entities.size + doc.notes.size + doc.inserts.size;
    const notes = doc.notes.size > 0 ? `, ${doc.notes.size} ${doc.notes.size === 1 ? 'annotation' : 'annotations'}` : '';
    const inserts = doc.inserts.size > 0 ? `, ${doc.inserts.size} ${doc.inserts.size === 1 ? 'insert' : 'inserts'}` : '';
    count.textContent = s.selection.size > 0 ? `${s.selection.size} of ${things} selected` : `${doc.entities.size} entities${notes}${inserts}`;
    grid.setAttribute('aria-pressed', String(s.showGrid));
    grid.textContent = s.showGrid ? 'Grid on' : 'Grid off';
    weights.setAttribute('aria-pressed', String(s.lineweights));
    weights.textContent = s.lineweights ? 'Lineweights on' : 'Lineweights off';
    snaps.setAttribute('aria-pressed', String(s.snapOn));
    snaps.textContent = s.snapOn ? 'Snaps on' : 'Snaps off';
    ortho.setAttribute('aria-pressed', String(s.ortho));
    ortho.textContent = s.ortho ? 'Ortho on' : 'Ortho off';
    polar.setAttribute('aria-pressed', String(s.polarOn));
    polar.textContent = s.polarOn ? `Tracking ${s.polarStep}°` : 'Tracking off';
    rail.show(s.tool?.id ?? null);
    document.body.classList.toggle('al-drafting', s.tool !== null);
    document.body.classList.toggle('al-hide-left', !s.showLayers);
    document.body.classList.toggle('al-hide-right', !s.showSelection);
    document.body.classList.toggle('al-show-script', s.showScript);
    sheetBackdrop.hidden = !(isPhone() && (s.showLayers || s.showSelection || s.showScript));
    const scriptToggle = document.getElementById('al-script-toggle');
    if (scriptToggle) {
      scriptToggle.setAttribute('aria-pressed', String(s.showScript));
      scriptToggle.setAttribute('title', s.showScript ? 'Hide the script panel (`)' : 'Show the script panel (`)');
    }
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

  // Keyboard: the tool in use sees keys first (typed points, options, Enter, Esc).
  window.addEventListener(
    'keydown',
    (e) => {
      if (palette.isOpen || (isTyping(e) && !drafting.ownsInput(e.target))) return;
      if (drafting.key(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

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
    if (mod && key === 's') return run(() => void actions.save());
    if (mod && key === 'o') return run(() => fileInput.click());
    if (mod || e.altKey) return;
    if (e.shiftKey && key === 's') return run(() => actions.toggleSnaps());
    if (e.shiftKey && key === 'o') return run(() => actions.toggleOrtho());
    if (e.shiftKey && key === 't') return run(() => actions.togglePolar());
    if (e.shiftKey && key === 'c') return run(() => actions.toggleConstraints());
    const tool = e.shiftKey ? undefined : TOOL_BUTTONS.find((b) => b.key === key);
    if (tool) return run(() => drafting.start(tool.id));
    if (key === 'escape') {
      return run(() => {
        if (store.get().boxSelect) store.set({ boxSelect: false });
        actions.clearSelection();
      });
    }
    if (key === 'delete' || key === 'backspace') return run(() => actions.deleteSelection());
    if (key === 'f') return run(() => actions.fit());
    if (key === 'g') return run(() => actions.toggleGrid());
    if (key === 'w') return run(() => actions.toggleLineweights());
    if (key === '[') return run(() => actions.toggleLayersPanel());
    if (key === ']') return run(() => actions.toggleSelectionPanel());
    if (key === '`') return run(() => actions.toggleScriptPanel());
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
