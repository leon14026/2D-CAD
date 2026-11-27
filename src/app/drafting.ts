/**
 * Connects the drafting engine (src/core/tools) to the screen: where a click lands after
 * snaps and tracking, what the overlay and the box beside the cursor show, and which keys
 * the active tool takes.
 */
import { angleOf, degToRad, distance, normalizeAngle, radToDeg, sub, type Vec2 } from '../core/geom';
import { findSnap, pickAt, type SnapHit } from '../core/spatial';
import {
  currentBase,
  currentPreview,
  currentPrompt,
  feed,
  feedTyped,
  startTool,
  TOOLS,
  track,
  type Drafting,
  type Outcome,
  type Prompt,
  type ToolId,
  type ToolInput,
} from '../core/tools';
import type { CanvasView } from '../render/view';
import { screenToWorld, type Point } from '../render/viewport';
import type { CursorEntry } from '../ui/entry';
import { formatCoordinate } from '../ui/format';
import { PICK_RADIUS } from './interaction';
import { visibleConstraintMarks, type AppState, type Store } from './store';

/** How close (CSS pixels) the cursor must be to a snap point. */
export const SNAP_RADIUS_PX = 10;
/** How close (CSS pixels) the cursor must be to a tracking line. */
export const TRACK_REACH_PX = 8;

/** Characters that start typing a point or a number. */
const TYPING_START = /^[0-9.@+-]$/;

export interface Resolved {
  readonly point: Vec2;
  readonly snap: SnapHit | null;
  /** Tracking direction, or null. */
  readonly angle: number | null;
}

export class DraftingController {
  private cursor: Point | null = null;
  private shift = false;

  constructor(
    private readonly store: Store,
    private readonly view: CanvasView,
    private readonly entry: CursorEntry,
  ) {
    store.subscribe((s, p) => {
      if (s.tool !== p.tool || s.session !== p.session || s.viewport !== p.viewport || s.toolError !== p.toolError) this.refresh();
    });
  }

  private drafting(s: AppState = this.store.get()): Drafting {
    return { session: s.session, memory: s.toolMemory, active: s.tool };
  }

  private selection(s: AppState = this.store.get()): number[] {
    return [...s.selection];
  }

  /** True if `target` is the box beside the cursor. */
  ownsInput(target: EventTarget | null): boolean {
    return target === this.entry.input;
  }

  get active(): boolean {
    return this.store.get().tool !== null;
  }

  prompt(): Prompt | null {
    return currentPrompt(this.drafting(), this.selection());
  }

  start(id: ToolId): void {
    const s = this.store.get();
    this.entry.clear();
    this.store.set({ tool: startTool(this.drafting(s), id, this.selection(s)).active, toolError: null, hover: null });
  }

  stop(): void {
    if (!this.active) return;
    this.entry.clear();
    this.store.set({ tool: null, toolError: null });
  }

  /** Where the next point goes if the cursor is at `p`: snapped, tracked or as it is. */
  resolve(p: Point): Resolved {
    const s = this.store.get();
    const vp = s.viewport;
    const world = screenToWorld(vp, p);
    const prompt = this.prompt();
    if (!prompt || (prompt.accepts !== 'point' && prompt.accepts !== 'pointOrNumber')) return { point: world, snap: null, angle: null };
    const base = currentBase(this.drafting(s));
    if (s.snapOn) {
      const snap = findSnap(s.session.doc, world, SNAP_RADIUS_PX / vp.pxPerUnit, { kinds: s.snapKinds, from: base });
      if (snap) return { point: snap.point, snap, angle: null };
    }
    if (base) {
      const t = track(base, world, {
        ortho: s.ortho || this.shift,
        polarStep: s.polarOn ? degToRad(s.polarStep) : null,
        reach: TRACK_REACH_PX / vp.pxPerUnit,
      });
      return { point: t.point, snap: null, angle: t.angle };
    }
    return { point: world, snap: null, angle: null };
  }

  /** The cursor moved (or left the drawing area, with null). Shift forces ortho. */
  move(p: Point | null, shift = false): Vec2 | null {
    this.cursor = p;
    this.shift = shift;
    return this.refresh();
  }

  /** Redraws the tool's feedback; returns the point a click would place. */
  private refresh(): Vec2 | null {
    const s = this.store.get();
    const prompt = this.prompt();
    if (!s.tool || !prompt) {
      this.view.setDraft(null);
      this.entry.show(null);
      return null;
    }
    const d = this.drafting(s);
    const base = currentBase(d);
    let readout: string | null = null;
    let resolved: Resolved | null = null;
    if (this.cursor) {
      resolved = this.resolve(this.cursor);
      this.view.setDraft({ preview: currentPreview(d, resolved.point, this.selection(s)), base, snap: resolved.snap, angle: resolved.angle });
      if (base && (prompt.accepts === 'point' || prompt.accepts === 'pointOrNumber')) {
        const v = sub(resolved.point, base);
        const angle = radToDeg(normalizeAngle(angleOf(v)));
        readout = `${formatCoordinate(distance(base, resolved.point))} at ${formatCoordinate(angle, 1)}°`;
      }
    } else {
      this.view.setDraft(null);
    }
    this.entry.show({ tool: TOOLS[s.tool.id].label, prompt, at: this.cursor, readout, error: s.toolError });
    return resolved?.point ?? null;
  }

  private commit(outcome: Outcome): void {
    const d = outcome.drafting;
    this.store.set({ session: d.session, tool: d.active, toolMemory: d.memory, toolError: outcome.error });
  }

  input(i: ToolInput): void {
    this.commit(feed(this.drafting(), i, this.selection()));
  }

  click(p: Point): void {
    this.input({ kind: 'point', point: this.resolve(p).point });
  }

  enter(): void {
    this.input({ kind: 'enter' });
  }

  /** A click while the tool wants an object picked. */
  pick(p: Point): void {
    const s = this.store.get();
    const world = screenToWorld(s.viewport, p);
    const id = pickAt(s.session.doc, world, PICK_RADIUS / s.viewport.pxPerUnit, visibleConstraintMarks(s));
    if (id === null) this.store.set({ toolError: 'Nothing there to pick. Click on a line, arc or circle.' });
    else this.input({ kind: 'pick', id, point: world });
  }

  /** Submits what is typed in the box; nothing typed is the same as Enter. */
  submit(text: string): void {
    if (text.trim() === '') {
      this.entry.clear();
      this.enter();
      return;
    }
    const s = this.store.get();
    const base = currentBase(this.drafting(s));
    let direction: number | null = null;
    if (base && this.cursor) {
      const r = this.resolve(this.cursor);
      if (r.angle !== null) direction = r.angle;
      else if (r.point.x !== base.x || r.point.y !== base.y) direction = angleOf(sub(r.point, base));
    }
    const outcome = feedTyped(this.drafting(s), text, direction, this.selection(s));
    if (outcome.error === null) this.entry.clear();
    this.commit(outcome);
  }

  /**
   * Keys for the active tool, seen before the app's own shortcuts. Returns true if the key was
   * used here.
   */
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (this.entry.typing) {
      if (e.key === 'Enter') this.submit(this.entry.value);
      else if (e.key === 'Escape') this.entry.clear();
      else return false;
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Escape') this.stop();
    else if (e.key === 'Enter') this.enter();
    else if (this.prompt()?.accepts === 'text' && e.key.length === 1) this.entry.begin(e.key);
    else if (TYPING_START.test(e.key)) this.entry.begin(e.key);
    else {
      const option = this.prompt()?.options.find((o) => o.key === e.key.toLowerCase());
      if (!option || e.shiftKey) return false;
      this.input({ kind: 'option', key: option.key });
    }
    return true;
  }
}
