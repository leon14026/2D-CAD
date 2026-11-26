import { describe, expect, it } from 'vitest';
import { createSession, newDocument } from '../../../../src/core/doc';
import { segment } from '../../../../src/core/geom';
import {
  attempt,
  currentBase,
  InputError,
  currentPreview,
  currentPrompt,
  DEFAULT_MEMORY,
  drafting,
  feed,
  feedTyped,
  isToolId,
  startTool,
  stopTool,
  TOOLS,
} from '../../../../src/core/tools';

const fresh = () => drafting(createSession(newDocument()));

describe('drafting driver', () => {
  it('starts with no tool and the default memory', () => {
    const d = fresh();
    expect(d.active).toBeNull();
    expect(d.memory).toEqual(DEFAULT_MEMORY);
    expect(currentPrompt(d)).toBeNull();
    expect(currentBase(d)).toBeNull();
    expect(currentPreview(d, { x: 0, y: 0 })).toEqual([]);
  });

  it('ignores input while no tool is active', () => {
    const d = fresh();
    expect(feed(d, { kind: 'enter' })).toEqual({ drafting: d, error: null });
    expect(feedTyped(d, '1,2', null)).toEqual({ drafting: d, error: null });
  });

  it('reports the active tool’s prompt, base and preview', () => {
    let d = startTool(fresh(), 'line');
    expect(currentPrompt(d)?.text).toBe('First point');
    d = feed(d, { kind: 'point', point: { x: 1, y: 2 } }).drafting;
    expect(currentBase(d)).toEqual({ x: 1, y: 2 });
    expect(currentPreview(d, { x: 4, y: 6 })).toEqual([segment({ x: 1, y: 2 }, { x: 4, y: 6 })]);
  });

  it('typed text goes through the step’s rules; mistakes are explained and change nothing', () => {
    const d = startTool(fresh(), 'line');
    const bad = feedTyped(d, '@5,5', null);
    expect(bad.error).toMatch(/no last point yet/);
    expect(bad.drafting).toBe(d);
    const one = feedTyped(d, '1,1', null).drafting;
    const two = feedTyped(one, '10', Math.PI / 2);
    expect(two.error).toBeNull();
    expect([...two.drafting.session.doc.entities.values()][0]?.geom).toEqual(segment({ x: 1, y: 1 }, { x: 1, y: 11 }));
  });

  it('a refused input keeps everything as it was', () => {
    const d = feed(startTool(fresh(), 'line'), { kind: 'point', point: { x: 0, y: 0 } }).drafting;
    const r = feed(d, { kind: 'point', point: { x: 0, y: 0 } });
    expect(r.error).toMatch(/same point/);
    expect(r.drafting).toBe(d);
  });

  it('remembers values between uses of a tool', () => {
    let d = startTool(fresh(), 'circle');
    d = feed(d, { kind: 'point', point: { x: 0, y: 0 } }).drafting;
    d = feed(d, { kind: 'number', value: 7 }).drafting;
    expect(d.memory).toEqual({ ...DEFAULT_MEMORY, radius: 7 });
    expect(stopTool(d).memory.radius).toBe(7);
  });

  it('stopping is safe when nothing is active', () => {
    const d = fresh();
    expect(stopTool(d)).toBe(d);
    expect(stopTool(startTool(d, 'arc')).active).toBeNull();
  });

  it('knows its tools by id', () => {
    expect(isToolId('line')).toBe(true);
    expect(isToolId('hatch')).toBe(false);
    expect(isToolId('toString')).toBe(false);
    for (const [id, def] of Object.entries(TOOLS)) expect(def.id).toBe(id);
  });

  it('attempt turns expected refusals into messages and passes bugs on', () => {
    expect(attempt(() => 3, InputError)).toEqual({ ok: true, value: 3 });
    expect(
      attempt(() => {
        throw new InputError('No.');
      }, InputError),
    ).toEqual({ ok: false, error: 'No.' });
    expect(() =>
      attempt(() => {
        throw new TypeError('bug');
      }, InputError),
    ).toThrow(TypeError);
  });
});
