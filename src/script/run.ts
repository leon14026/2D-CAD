import { commitDraft, Draft, type Session } from '../core/doc';
import { createCad } from './host';
import { runJavaScript } from './js';
import { runPython, type PythonRuntime } from './python';

export const SCRIPT_COMMAND = 'script.run';
export const SCRIPT_LABEL = 'Run script';

export function applyJavaScript(session: Session, source: string): { session: Session; log: string[] } {
  const draft = new Draft(session.doc);
  const log: string[] = [];
  runJavaScript(createCad(draft, log), source);
  const executed = commitDraft(session, draft, SCRIPT_COMMAND, SCRIPT_LABEL, { log });
  return { session: executed.session, log };
}

export async function applyPython(
  session: Session,
  source: string,
  py: PythonRuntime,
): Promise<{ session: Session; log: string[] }> {
  const draft = new Draft(session.doc);
  const log: string[] = [];
  await runPython(createCad(draft, log), source, py, log);
  const executed = commitDraft(session, draft, SCRIPT_COMMAND, SCRIPT_LABEL, { log });
  return { session: executed.session, log };
}
