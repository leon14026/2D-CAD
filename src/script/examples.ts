/** The three example scripts. Each JavaScript/Python pair issues the same `cad` calls. */

export type ExampleId = 'bolt-circle' | 'flange' | 'slot-pattern';
export type ScriptLanguage = 'javascript' | 'python';

export interface ExampleScript {
  readonly id: ExampleId;
  readonly label: string;
  readonly js: string;
  readonly py: string;
}

export const EXAMPLES: readonly ExampleScript[] = [
  {
    id: 'bolt-circle',
    label: 'Bolt circle',
    js: `cad.title('Bolt circle');
cad.layer('Outline');
cad.circle(0, 0, 50);
cad.circle(0, 0, 20);
cad.layer('Holes');
for (let i = 0; i < 6; i++) {
  const p = cad.polar(0, 0, 35, i * 60);
  cad.circle(p.x, p.y, 4);
}
`,
    py: `cad.title('Bolt circle')
cad.layer('Outline')
cad.circle(0, 0, 50)
cad.circle(0, 0, 20)
cad.layer('Holes')
for i in range(6):
    p = cad.polar(0, 0, 35, i * 60)
    cad.circle(p.x, p.y, 4)
`,
  },
  {
    id: 'flange',
    label: 'Flange',
    js: `cad.title('Flange');
cad.layer('Outline');
cad.circle(0, 0, 60);
cad.circle(0, 0, 25);
cad.layer('Holes');
for (let i = 0; i < 8; i++) {
  const p = cad.polar(0, 0, 45, i * 45);
  cad.circle(p.x, p.y, 6);
}
`,
    py: `cad.title('Flange')
cad.layer('Outline')
cad.circle(0, 0, 60)
cad.circle(0, 0, 25)
cad.layer('Holes')
for i in range(8):
    p = cad.polar(0, 0, 45, i * 45)
    cad.circle(p.x, p.y, 6)
`,
  },
  {
    id: 'slot-pattern',
    label: 'Slot pattern',
    js: `cad.title('Slot pattern');
cad.layer('Slots');
function slot(x, y) {
  cad.polyline([
    [x, y],
    [x + 20, y, 1],
    [x + 20, y + 8],
    [x, y + 8, 1],
  ], true);
}
for (let row = 0; row < 2; row++) {
  for (let col = 0; col < 3; col++) {
    slot(col * 40, row * 24);
  }
}
`,
    py: `cad.title('Slot pattern')
cad.layer('Slots')

def slot(x, y):
    cad.polyline([
        [x, y],
        [x + 20, y, 1],
        [x + 20, y + 8],
        [x, y + 8, 1],
    ], True)

for row in range(2):
    for col in range(3):
        slot(col * 40, row * 24)
`,
  },
];

export function exampleById(id: string): ExampleScript | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export function sourceOf(example: ExampleScript, language: ScriptLanguage): string {
  return language === 'javascript' ? example.js : example.py;
}

/** If `text` is exactly one of the examples in `language`, that example's id; otherwise null. */
export function matchingExample(text: string, language: ScriptLanguage): ExampleId | null {
  for (const example of EXAMPLES) {
    if (sourceOf(example, language) === text) return example.id;
  }
  return null;
}
