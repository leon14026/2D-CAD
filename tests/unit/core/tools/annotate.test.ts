import { describe, expect, it } from 'vitest';
import { resolveNotes, type Note } from '../../../../src/core/doc';
import { circle, degToRad, rectangle, segment, type Shape } from '../../../../src/core/geom';
import {
  currentBase,
  currentPrompt,
  DEFAULT_MEMORY,
  drafting,
  feed,
  feedTyped,
  NOT_HERE,
  startTool,
  TOOLS,
  type Drafting,
  type ToolId,
  type ToolInput,
} from '../../../../src/core/tools';
import { docOf } from '../docs';

const P = (x: number, y: number): ToolInput => ({ kind: 'point', point: { x, y } });
const PICK = (id: number): ToolInput => ({ kind: 'pick', id, point: { x: 0, y: 0 } });
const O = (key: string): ToolInput => ({ kind: 'option', key });
const N = (value: number): ToolInput => ({ kind: 'number', value });
const T = (text: string): ToolInput => ({ kind: 'text', text });
const ENTER: ToolInput = { kind: 'enter' };
const NOT_HERE_TEXT = NOT_HERE;

/** Starts a tool in a drawing holding the given shapes; ids run from 2. */
function begin(id: ToolId, shapes: Shape[] = []) {
  const built = docOf(shapes);
  return startTool(drafting(built.session), id);
}

/** Feeds inputs in turn; each one must be accepted. */
function run(d: Drafting, ...inputs: ToolInput[]): Drafting {
  let cur = d;
  for (const i of inputs) {
    const o = feed(cur, i);
    expect(o.error, JSON.stringify(i)).toBeNull();
    cur = o.drafting;
  }
  return cur;
}

function refused(d: Drafting, i: ToolInput, why: string | RegExp): void {
  const o = feed(d, i);
  if (typeof why === 'string') expect(o.error).toBe(why);
  else expect(o.error).toMatch(why);
  expect(o.drafting).toBe(d);
}

const notes = (d: Drafting): Note[] => [...d.session.doc.notes.values()];
const lastNote = (d: Drafting): Note => notes(d).at(-1) as Note;
const promptText = (d: Drafting) => currentPrompt(d)?.text;
const previewOf = (d: Drafting, id: ToolId, x: number, y: number) => {
  const a = d.active!;
  return TOOLS[id].preview(a.state, { x, y }, { doc: d.session.doc, selection: [], memory: d.memory });
};

describe('linear and aligned dimensions', () => {
  const wall = () => begin('dimLinear', [segment({ x: 0, y: 0 }, { x: 40, y: 0 })]);

  it('asks for three points and ties the first two to the line’s ends', () => {
    let d = wall();
    expect(promptText(d)).toBe('First point');
    d = run(d, P(0, 0));
    expect(promptText(d)).toBe('Second point');
    expect(currentBase(d)).toEqual({ x: 0, y: 0 });
    d = run(d, P(40, 0));
    expect(promptText(d)).toBe('Where the dimension line goes');
    d = run(d, P(20, 10));
    expect(lastNote(d).body).toEqual({
      kind: 'linear',
      orient: 'horizontal',
      a: { kind: 'end', id: 2, end: 'start' },
      b: { kind: 'end', id: 2, end: 'end' },
      at: { x: 20, y: 10 },
      style: 'ISO',
    });
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.text).toBe('40.00');
    expect(d.active?.state.step).toBe(0); // ready for the next one
    expect(promptText(d)).toBe('First point');
  });

  it('placing the line beside the points makes it vertical', () => {
    const d = run(begin('dimLinear'), O('r'), P(0, 0), P(0, 25), P(-10, 12));
    expect(lastNote(d).body).toMatchObject({ kind: 'linear', orient: 'vertical', a: { kind: 'free', p: { x: 0, y: 0 } } });
  });

  it('aligned dimensions follow the points', () => {
    const d = run(begin('dimAligned'), O('r'), P(0, 0), P(30, 40), P(-8, 6));
    expect(lastNote(d).body).toMatchObject({ kind: 'aligned', at: { x: -8, y: 6 } });
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.text).toBe('(50.00)');
  });

  it('refuses a second point on the first, and anything but a point', () => {
    let d = run(wall(), P(0, 0));
    refused(d, P(0, 0), 'That is the same point as the one before.');
    refused(d, PICK(2), NOT_HERE_TEXT);
    d = run(d, P(40, 0));
    refused(d, T('x'), NOT_HERE_TEXT);
  });

  it('Enter stops the tool at any step', () => {
    for (const steps of [[], [P(0, 0)], [P(0, 0), P(5, 0)]]) {
      expect(run(wall(), ...steps, ENTER).active).toBeNull();
    }
  });

  it('shows the rubber band, then the dimension as it would look', () => {
    let d = wall();
    expect(previewOf(d, 'dimLinear', 5, 5)).toEqual([]);
    d = run(d, P(0, 0));
    expect(previewOf(d, 'dimLinear', 5, 5)).toHaveLength(1);
    expect(previewOf(d, 'dimLinear', 0, 0)).toEqual([]);
    d = run(d, P(40, 0));
    expect(previewOf(d, 'dimLinear', 20, 10).length).toBeGreaterThan(3);
    expect(previewOf(d, 'dimAligned', 20, 10).length).toBeGreaterThan(3);
  });

  it('typed numbers are not points', () => {
    const d = run(wall(), P(0, 0));
    refused(d, N(5), NOT_HERE_TEXT);
    expect(feedTyped(d, '10,0', null).error).toBeNull();
  });

  it('option r switches the tool between driving and measuring only', () => {
    let d = wall();
    expect(currentPrompt(d)?.options).toEqual([{ key: 'r', label: 'Measure only' }]);
    d = run(d, O('r'));
    expect(d.memory.dimReference).toBe(true);
    expect(currentPrompt(d)?.options).toEqual([{ key: 'r', label: 'Hold the drawing' }]);
    d = run(d, P(0, 0), P(40, 0), P(20, 8));
    expect(lastNote(d).reference).toBe(true);
    expect(d.session.doc.constraints.size).toBe(0);
  });
});

describe('radius and diameter dimensions', () => {
  const round = (id: ToolId) => begin(id, [circle({ x: 10, y: 10 }, 5), segment({ x: 0, y: 0 }, { x: 1, y: 1 })]);

  it('pick a circle, then say where it goes', () => {
    let d = round('dimRadius');
    expect(currentPrompt(d)).toEqual({
      text: 'Pick a circle or an arc',
      accepts: 'pick',
      options: [{ key: 'r', label: 'Measure only' }],
      enter: 'finish',
    });
    d = run(d, PICK(2));
    expect(promptText(d)).toBe('Where the dimension goes');
    expect(currentBase(d)).toBeNull();
    d = run(d, P(20, 10));
    expect(lastNote(d).body).toEqual({ kind: 'radius', target: 2, at: { x: 20, y: 10 }, style: 'ISO' });
    expect(promptText(d)).toBe('Pick a circle or an arc');
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.text).toBe('R5.00');
  });

  it('diameter asks for a direction', () => {
    let d = run(round('dimDiameter'), PICK(2));
    expect(promptText(d)).toBe('Direction of the dimension line');
    d = run(d, P(10, 30));
    expect(lastNote(d).body).toMatchObject({ kind: 'diameter', target: 2 });
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.text).toBe('Ø10.00');
  });

  it('refuses things that are not round, and the wrong kind of input at each step', () => {
    let d = round('dimRadius');
    refused(d, PICK(3), 'Pick a circle or an arc.');
    refused(d, PICK(99), 'Pick a circle or an arc.');
    refused(d, P(1, 1), NOT_HERE_TEXT);
    d = run(d, PICK(2));
    refused(d, PICK(2), NOT_HERE_TEXT);
    expect(run(d, ENTER).active).toBeNull();
    expect(run(round('dimRadius'), ENTER).active).toBeNull();
    expect(run(round('dimRadius'), O('r')).memory.dimReference).toBe(true);
  });

  it('previews', () => {
    let d = round('dimRadius');
    expect(previewOf(d, 'dimRadius', 20, 10)).toEqual([]);
    d = run(d, PICK(2));
    expect(previewOf(d, 'dimRadius', 20, 10).length).toBeGreaterThan(0);
    expect(previewOf(d, 'dimRadius', 10, 10)).toEqual([]); // on the centre: nothing to draw
  });
});

describe('angle dimension', () => {
  it('corner, one point on each side, then where the arc goes', () => {
    let d = begin('dimAngle');
    expect(['Corner of the angle', 'A point on the first side', 'A point on the second side', 'Where the arc goes']).toEqual(
      [promptText(d), promptText((d = run(d, P(0, 0)))), promptText((d = run(d, P(10, 0)))), promptText((d = run(d, P(0, 10))))],
    );
    expect(currentBase(d)).toEqual({ x: 0, y: 0 });
    d = run(d, O('r'), P(7, 7));
    expect(lastNote(d).body).toMatchObject({ kind: 'angle', at: { x: 7, y: 7 } });
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.text).toBe('(90.0°)');
    expect(currentBase(d)).toBeNull();
  });

  it('refuses repeated points and other kinds of input; Enter stops', () => {
    let d = run(begin('dimAngle'), P(0, 0));
    refused(d, P(0, 0), 'That is the same point as the one before.');
    refused(d, PICK(2), NOT_HERE_TEXT);
    d = run(d, P(10, 0));
    refused(d, P(10, 0), 'That is the same point as the one before.');
    expect(run(d, ENTER).active).toBeNull();
  });

  it('previews the sides, then the arc', () => {
    let d = begin('dimAngle');
    expect(previewOf(d, 'dimAngle', 1, 1)).toEqual([]);
    d = run(d, P(0, 0));
    expect(previewOf(d, 'dimAngle', 5, 5)).toHaveLength(1);
    expect(previewOf(d, 'dimAngle', 0, 0)).toEqual([]);
    d = run(d, P(10, 0), P(0, 10));
    expect(previewOf(d, 'dimAngle', 7, 7).length).toBeGreaterThan(1);
  });
});

describe('text and leaders', () => {
  it('text: a point, then the words; two lines with \\n', () => {
    let d = begin('text');
    expect(promptText(d)).toBe('Where the text starts');
    expect(currentBase(d)).toBeNull();
    d = run(d, P(1, 2));
    expect(currentPrompt(d)).toEqual({ text: 'Type the text (\\n starts a new line)', accepts: 'text', options: [], enter: 'back' });
    expect(previewOf(d, 'text', 5, 2)).toHaveLength(1);
    expect(previewOf(d, 'text', 1, 2)).toEqual([]);
    d = run(d, T('Hello'));
    expect(lastNote(d).body).toEqual({ kind: 'text', at: { x: 1, y: 2 }, height: 3.5, angle: 0, anchor: 'left', text: 'Hello' });
    expect(promptText(d)).toBe('Where the text starts');
    expect(previewOf(d, 'text', 5, 2)).toEqual([]);
  });

  it('text typed in the entry box: spaces trimmed, \\n starts a new line', () => {
    const d = run(begin('text'), P(1, 2));
    const o = feedTyped(d, '  Line one\\nLine two ', null);
    expect(o.error).toBeNull();
    expect(lastNote(o.drafting).body).toMatchObject({ text: 'Line one\nLine two' });
  });

  it('text: refuses empty or missing words; Enter goes back a step, then stops', () => {
    let d = run(begin('text'), P(1, 2));
    refused(d, T(''), 'Type the text, then press Enter.');
    refused(d, P(3, 3), 'Type the text, then press Enter.');
    d = run(d, ENTER);
    expect(d.active?.state.step).toBe(0);
    refused(d, T('x'), NOT_HERE_TEXT);
    expect(run(d, ENTER).active).toBeNull();
  });

  it('leader: the arrow end first, then corners, then the note', () => {
    let d = begin('leader');
    expect(promptText(d)).toBe('Point the arrow at');
    d = run(d, P(0, 0));
    expect(promptText(d)).toBe('Next point of the leader');
    expect(currentBase(d)).toEqual({ x: 0, y: 0 });
    expect(previewOf(d, 'leader', 5, 5)).toHaveLength(1);
    expect(previewOf(d, 'leader', 0, 0)).toEqual([]);
    d = run(d, P(10, 10), P(20, 10), ENTER);
    expect(promptText(d)).toBe('Type the note, or press Enter for none');
    expect(currentBase(d)).toBeNull();
    d = run(d, T('Ø5 THRU'));
    expect(lastNote(d).body).toMatchObject({ kind: 'leader', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }], text: 'Ø5 THRU' });
  });

  it('leader: Enter with no note makes a leader without text', () => {
    const d = run(begin('leader'), P(0, 0), P(10, 10), ENTER, ENTER);
    expect(lastNote(d).body).toMatchObject({ kind: 'leader', text: '' });
  });

  it('leader: refusals', () => {
    let d = begin('leader');
    refused(d, PICK(2), NOT_HERE_TEXT);
    d = run(d, P(0, 0));
    refused(d, ENTER, 'A leader needs at least two points.');
    refused(d, P(0, 0), 'That is the same point as the one before.');
    refused(d, T('x'), NOT_HERE_TEXT);
    d = run(d, P(5, 5), ENTER);
    refused(d, P(9, 9), 'Type the text, then press Enter.');
    expect(run(begin('leader'), ENTER).active).toBeNull();
  });
});

describe('centre mark', () => {
  const round = () => begin('centreMark', [circle({ x: 10, y: 10 }, 5), segment({ x: 0, y: 0 }, { x: 1, y: 1 })]);

  it('a cross, or centre lines when toggled with L', () => {
    let d = round();
    expect(currentPrompt(d)?.options).toEqual([{ key: 'l', label: 'Centre lines' }]);
    expect(currentBase(d)).toBeNull();
    d = run(d, PICK(2));
    expect(lastNote(d).body).toEqual({ kind: 'centre', target: 2, extended: false, style: 'ISO' });
    d = run(d, O('l'));
    expect(currentPrompt(d)?.options).toEqual([{ key: 'l', label: 'Cross only' }]);
    d = run(d, PICK(2));
    expect(lastNote(d).body).toMatchObject({ extended: true });
    expect(previewOf(d, 'centreMark', 0, 0)).toEqual([]);
  });

  it('refuses what is not round, and anything else', () => {
    const d = round();
    refused(d, PICK(3), 'Pick a circle or an arc.');
    refused(d, PICK(99), 'Pick a circle or an arc.');
    refused(d, P(1, 1), NOT_HERE_TEXT);
    expect(run(d, ENTER).active).toBeNull();
  });
});

describe('hatch', () => {
  const shapes = () => [rectangle({ x: 0, y: 0 }, { x: 100, y: 100 }), circle({ x: 50, y: 50 }, 10), segment({ x: 0, y: 0 }, { x: 1, y: 1 })];

  it('boundary, islands, Enter: one hatch with the remembered pattern, angle and spacing', () => {
    let d = begin('hatch', shapes());
    expect(currentBase(d)).toBeNull();
    expect(currentPrompt(d)).toEqual({
      text: 'Pick a closed shape to hatch',
      accepts: 'pick',
      options: [
        { key: 'p', label: 'Pattern: Lines' },
        { key: 'a', label: 'Angle: 45°' },
        { key: 's', label: 'Spacing: 3' },
      ],
      enter: 'finish',
    });
    d = run(d, PICK(2));
    expect(promptText(d)).toBe('Pick an island to leave clear, or Enter to hatch');
    d = run(d, PICK(3), ENTER);
    expect(lastNote(d).body).toEqual({ kind: 'hatch', loops: [[2], [3]], pattern: 'lines', spacing: 3, angle: degToRad(45) });
    expect(promptText(d)).toBe('Pick a closed shape to hatch');
    const r = resolveNotes(d.session.doc).get(lastNote(d).id);
    expect(r?.ok && r.r.area).toBeCloseTo(100 * 100 - 100 * Math.PI, 9);
  });

  it('P cycles the pattern; a solid hatch has no angle or spacing', () => {
    let d = begin('hatch', shapes());
    const seen: string[] = [d.memory.hatchPattern];
    for (let i = 0; i < 5; i++) {
      d = run(d, O('p'));
      seen.push(d.memory.hatchPattern);
    }
    expect(seen).toEqual(['lines', 'cross', 'double', 'dots', 'solid', 'lines']);
    d = run(d, O('p'), O('p'), O('p'), O('p'));
    expect(d.memory.hatchPattern).toBe('solid');
    expect(currentPrompt(d)?.options).toEqual([{ key: 'p', label: 'Pattern: Solid' }]);
    refused(d, O('a'), NOT_HERE_TEXT);
    refused(d, O('s'), NOT_HERE_TEXT);
    d = run(d, PICK(2), ENTER);
    expect(lastNote(d).body).toMatchObject({ pattern: 'solid' });
  });

  it('angle and spacing are typed, remembered, and come back to the step they were asked from', () => {
    let d = begin('hatch', shapes());
    d = run(d, O('a'));
    expect(currentPrompt(d)).toEqual({ text: 'Hatch angle in degrees', accepts: 'number', options: [], defaultValue: 45 });
    refused(d, T('x'), 'Type a number.');
    d = run(d, N(30));
    expect(d.memory.hatchAngle).toBe(30);
    expect(d.active?.state.step).toBe(0);
    d = run(d, PICK(2), O('s'));
    expect(currentPrompt(d)).toEqual({ text: 'Distance between hatch lines', accepts: 'number', options: [], defaultValue: 3 });
    refused(d, N(0), 'The spacing must be more than 0.');
    refused(d, N(-2), 'The spacing must be more than 0.');
    d = run(d, N(5));
    expect(d.memory.hatchSpacing).toBe(5);
    expect(d.active?.state.step).toBe(1); // back to choosing islands
    d = run(d, ENTER);
    expect(lastNote(d).body).toMatchObject({ spacing: 5, angle: degToRad(30), loops: [[2]] });
  });

  it('Enter takes the default at the angle and spacing prompts', () => {
    let d = run(begin('hatch', shapes()), O('a'), ENTER, O('s'), ENTER);
    expect(d.memory).toMatchObject({ hatchAngle: 45, hatchSpacing: 3 });
    expect(d.active?.state.step).toBe(0);
  });

  it('refuses open shapes, shapes picked twice, and the wrong kind of input; Enter at the start stops', () => {
    let d = begin('hatch', shapes());
    refused(d, PICK(4), /not a closed shape/);
    refused(d, PICK(99), /not a closed shape/);
    refused(d, P(1, 1), NOT_HERE_TEXT);
    refused(d, O('z'), NOT_HERE_TEXT);
    d = run(d, PICK(2));
    refused(d, PICK(2), 'That shape is already part of this hatch.');
    expect(run(begin('hatch', shapes()), ENTER).active).toBeNull();
  });

  it('refuses at the command, not the tool, when the geometry will not do: the tool and the drawing stay as they were', () => {
    const d = run(begin('hatch', [rectangle({ x: 0, y: 0 }, { x: 10, y: 10 }), circle({ x: 10, y: 5 }, 2)]), PICK(2), PICK(3));
    const o = feed(d, ENTER);
    expect(o.error).toBe('Island 1 touches the outer boundary. Islands must lie inside it.');
    expect(o.drafting).toBe(d);
  });

  it('has nothing to preview', () => {
    const d = run(begin('hatch', shapes()), PICK(2));
    expect(previewOf(d, 'hatch', 1, 1)).toEqual([]);
  });
});

describe('title block', () => {
  it('places the sheet at the corner clicked, at the remembered size', () => {
    let d = begin('titleBlock');
    expect(currentBase(d)).toBeNull();
    expect(currentPrompt(d)).toEqual({ text: 'Lower left corner of the A4 sheet', accepts: 'point', options: [{ key: 's', label: 'Sheet size: A4' }], enter: 'finish' });
    expect(previewOf(d, 'titleBlock', 0, 0).length).toBeGreaterThan(8);
    d = run(d, P(100, 200));
    expect(lastNote(d).body).toMatchObject({ kind: 'titleBlock', at: { x: 100, y: 200 }, size: 'A4' });
    expect(d.active).toBeNull();
  });

  it('S steps through the sheet sizes', () => {
    let d = begin('titleBlock');
    const sizes: string[] = [d.memory.sheet];
    for (let i = 0; i < 5; i++) {
      d = run(d, O('s'));
      sizes.push(d.memory.sheet);
    }
    expect(sizes).toEqual(['A4', 'A3', 'A2', 'A1', 'A0', 'A4']);
    d = run(d, O('s'), P(0, 0));
    expect(lastNote(d).body).toMatchObject({ size: 'A3' });
  });

  it('refuses a number or a pick; Enter stops', () => {
    const d = begin('titleBlock');
    refused(d, N(3), NOT_HERE_TEXT);
    refused(d, PICK(2), NOT_HERE_TEXT);
    expect(run(d, ENTER).active).toBeNull();
    expect(DEFAULT_MEMORY.sheet).toBe('A4');
  });
});
