/**
 * @cyber-est/tools: `addChecks` (1.914). **How a plugin behaves**, as Cyber checks it in the few seconds
 * after a person adds it (`src/audio/est/review/addChecks.ts`: does it make sound, does a note stop, is
 * it safe to hear, does it run light enough, do the controls do anything, is it the same at any sample
 * rate), as one function of a bundle's bytes: for a harness that tries many plugins, or a script. The
 * same code the app's compiling Worker runs, on Node's WebAssembly, with no time budget unless one is
 * given. Findings are facts with numbers (`report.findings`); `findingWords` and `addChecksMessageForAi`
 * word them. It does not run the install's own check: `validate` runs both and reports these as warnings.
 */
import { addChecksOf, type AddChecksOf } from '../../../../src/audio/est/review/addChecksOf';
import type { AddChecksOptions } from '../../../../src/audio/est/review/addChecks';
import { nodeDeps } from './host';

export function addChecks(bytes: Uint8Array, opts: AddChecksOptions = {}): Promise<AddChecksOf> {
  return addChecksOf(bytes, nodeDeps, { budgetMs: Infinity, ...opts });
}
