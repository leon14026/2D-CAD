import './ui/theme.css';
import { Actions } from './app/actions';
import { buildInfo } from './app/build-info';
import { DraftingController } from './app/drafting';
import { watchConstraints } from './app/constraint-warning';
import { attachInteraction } from './app/interaction';
import { mountShell } from './app/shell';
import { initialState, Store } from './app/store';
import { installTestHook } from './app/testing';
import { CanvasView } from './render/view';
import { requireElement } from './ui/dom';
import { CursorEntry } from './ui/entry';
import { mountLayersPanel, mountSelectionPanel } from './ui/panels';
import { mountScriptPanel } from './ui/script-panel';

const stage = requireElement('#al-stage', HTMLElement);
const rect = stage.getBoundingClientRect();
// An empty drawing opens with the origin in the middle at 4 pixels per millimetre.
const store = new Store(initialState({ originX: Math.round(rect.width / 2), originY: Math.round(rect.height / 2), pxPerUnit: 4 }));
const view = new CanvasView(stage, requireElement('#al-canvas', HTMLCanvasElement), requireElement('#al-overlay', HTMLCanvasElement), store);
const actions = new Actions(store, view);
const drafting = new DraftingController(store, view, new CursorEntry(requireElement('#al-entry', HTMLElement)));

mountLayersPanel(requireElement('#al-layers-panel', HTMLElement), store, actions);
mountSelectionPanel(requireElement('#al-selection-panel', HTMLElement), store, {
  tool: (id) => drafting.start(id),
  join: () => actions.joinSelection(),
  explode: () => actions.explodeSelection(),
  remove: () => actions.deleteSelection(),
  editNote: (id, patch) => actions.editNote(id, patch),
  useDimStyle: (name) => actions.useDimStyle(name),
  saveDimStyle: (style) => actions.saveDimStyle(style),
});
mountScriptPanel(requireElement('#al-script-panel', HTMLElement), store, actions);
mountShell(store, actions, drafting, `v${buildInfo.version} (${buildInfo.sha})`);
attachInteraction(store, view, drafting, { x: requireElement('#al-coord-x', HTMLElement), y: requireElement('#al-coord-y', HTMLElement) });
installTestHook(store, view, actions);
// Last on purpose: it sets a message from inside a listener, and listeners after it would see the
// older state. Registered last, the toast has already shown the command's own message.
watchConstraints(store);

view.renderNow();
performance.mark('archilite-ready');
// Ruler labels use B612; redraw them once the font has arrived.
void document.fonts.ready.then(() => view.invalidate(false));
