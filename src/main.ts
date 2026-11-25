import './ui/theme.css';
import { APP_NAME } from './app/brand';
import { buildInfo } from './app/build-info';
import { paintSheet } from './render/grid-painter';
import { screenToWorld, type Viewport } from './render/viewport';
import { formatCoordinate } from './ui/format';

/** Phase 0 uses a fixed scale; zoom and pan arrive in Phase 3. */
const PX_PER_MM = 4;

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`${APP_NAME}: missing element ${selector}`);
  return el;
}

const canvas = requireElement('#al-canvas', HTMLCanvasElement);
const coordX = requireElement('#al-coord-x', HTMLElement);
const coordY = requireElement('#al-coord-y', HTMLElement);
const build = requireElement('#al-build', HTMLElement);

const context = canvas.getContext('2d', { alpha: false });
if (!context) throw new Error(`${APP_NAME}: Canvas 2D is not available in this browser`);
const ctx: CanvasRenderingContext2D = context;

let viewport: Viewport = { originX: 0, originY: 0, pxPerUnit: PX_PER_MM };

function render(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  viewport = {
    originX: Math.round(width / 2),
    originY: Math.round(height / 2),
    pxPerUnit: PX_PER_MM,
  };
  paintSheet({ ctx, width, height, dpr }, viewport);
  canvas.dataset['originX'] = String(viewport.originX);
  canvas.dataset['originY'] = String(viewport.originY);
  canvas.dataset['pxPerUnit'] = String(viewport.pxPerUnit);
}

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const world = screenToWorld(viewport, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  coordX.textContent = formatCoordinate(world.x);
  coordY.textContent = formatCoordinate(world.y);
});

new ResizeObserver(render).observe(canvas);
build.textContent = `v${buildInfo.version} · ${buildInfo.sha}`;
render();
