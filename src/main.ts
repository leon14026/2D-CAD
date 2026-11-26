import './ui/theme.css';
import { Actions } from './app/actions';
import { buildInfo } from './app/build-info';
import { attachInteraction } from './app/interaction';
import { mountShell } from './app/shell';
import { initialState, Store } from './app/store';
import { installTestHook } from './app/testing';
import { CanvasView } from './render/view';
import { requireElement } from './ui/dom';
import { mountLayersPanel, mountSelectionPanel } from './ui/panels';

const stage = requireElement('#al-stage', HTMLElement);
const rect = stage.getBoundingClientRect();
// An empty drawing opens with the origin in the middle at 4 pixels per millimetre.
const store = new Store(initialState({ originX: Math.round(rect.width / 2), originY: Math.round(rect.height / 2), pxPerUnit: 4 }));
const view = new CanvasView(stage, requireElement('#al-canvas', HTMLCanvasElement), requireElement('#al-overlay', HTMLCanvasElement), store);
const actions = new Actions(store, view);

mountLayersPanel(requireElement('#al-layers-panel', HTMLElement), store, actions);
mountSelectionPanel(requireElement('#al-selection-panel', HTMLElement), store);
mountShell(store, actions, `v${buildInfo.version} (${buildInfo.sha})`);
attachInteraction(store, view, { x: requireElement('#al-coord-x', HTMLElement), y: requireElement('#al-coord-y', HTMLElement) });
installTestHook(store, view, actions);

view.renderNow();
performance.mark('archilite-ready');
// Ruler labels use B612; redraw them once the font has arrived.
void document.fonts.ready.then(() => view.invalidate(false));
