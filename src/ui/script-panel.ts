/**
 * Bottom script panel: language, example, editor, run. Running a script goes through Actions,
 * so it is one undo step. Python is loaded only when the user runs Python, not when the panel
 * opens on JavaScript.
 */
import type { Actions } from '../app/actions';
import type { Store } from '../app/store';
import {
  EXAMPLES,
  exampleById,
  matchingExample,
  sourceOf,
  type ScriptLanguage,
} from '../script';
import { el } from './dom';

const HINT =
  'cad.line, cad.circle, cad.arc, cad.rect, cad.polyline, cad.layer, cad.polar, cad.title, cad.run, cad.print. Angles in degrees. One undo step.';

export function mountScriptPanel(root: HTMLElement, _store: Store, actions: Actions): void {
  let language: ScriptLanguage = 'javascript';

  const languageSelect = el('select', {
    className: 'al-script-select',
    attrs: { 'aria-label': 'Script language' },
  });
  languageSelect.append(
    el('option', { text: 'JavaScript', attrs: { value: 'javascript' } }),
    el('option', { text: 'Python', attrs: { value: 'python' } }),
  );

  const exampleSelect = el('select', {
    className: 'al-script-select',
    attrs: { 'aria-label': 'Example script' },
  });
  for (const example of EXAMPLES) {
    exampleSelect.append(el('option', { text: example.label, attrs: { value: example.id } }));
  }

  const editor = el('textarea', {
    className: 'al-script-editor',
    attrs: {
      spellcheck: 'false',
      'aria-label': 'Script',
      placeholder: 'cad.circle(0, 0, 10)',
    },
  });
  editor.value = sourceOf(EXAMPLES[0]!, language);

  const log = el('pre', { className: 'al-script-log', text: HINT });
  const run = el('button', {
    className: 'al-button al-button-primary',
    text: 'Run',
    attrs: { type: 'button' },
  });

  languageSelect.addEventListener('change', () => {
    const next = languageSelect.value === 'python' ? 'python' : 'javascript';
    const match = matchingExample(editor.value, language);
    language = next;
    if (match) {
      exampleSelect.value = match;
      editor.value = sourceOf(exampleById(match)!, next);
    }
  });

  exampleSelect.addEventListener('change', () => {
    const example = exampleById(exampleSelect.value);
    if (!example) return;
    editor.value = sourceOf(example, language);
  });

  run.addEventListener('click', () => {
    void (async () => {
      run.disabled = true;
      log.textContent = language === 'python' ? 'Loading Python…' : 'Running…';
      const result = await actions.runScript(language, editor.value);
      log.textContent = result.ok
        ? result.log.length > 0
          ? result.log.join('\n')
          : 'Script finished. Ctrl+Z undoes it as one step.'
        : (result.error ?? 'The script failed.');
      run.disabled = false;
    })();
  });

  root.append(
    el(
      'div',
      { className: 'al-script-toolbar' },
      el('h2', { text: 'Script' }),
      languageSelect,
      exampleSelect,
      run,
    ),
    editor,
    log,
  );
}
