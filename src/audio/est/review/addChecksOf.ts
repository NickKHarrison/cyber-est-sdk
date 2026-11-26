/**
 * 1.914: **the add-time checks as one function of a bundle's bytes** (`addTimeChecks`, addChecks.ts): what
 * the compiling Worker's `checks` request runs, what the kit and a harness call in Node. The bundle is
 * read and metered exactly as at install (`readBundle`, the `local` meter) and compiled through the
 * caller's `deps` (the Worker's or Node's: this file compiles nothing itself), with the profiling build
 * made only if a check asks for it. It does **not** run the install's own check again: give it a bundle
 * the install pipeline passed (`checkBundle`), or call `validate`, which runs both.
 *
 * Throws only for a bundle that cannot be read, metered or compiled (an `EstBundleError`, or the
 * compiler's own); a plugin's faults under test come back in the report.
 */
import { readBundle } from '../install/bundle';
import { isMetered } from '../install/fuel';
import type { InstallCheckDeps } from '../install/pipeline';
import { ADD_CHECKS_BUDGET_MS, addTimeChecks, type AddCheckReport, type AddChecksOptions } from './addChecks';

export interface AddChecksOf {
  hash: string;
  id: string;
  version: string;
  name: string;
  report: AddCheckReport;
}

export class AddChecksHashError extends Error {}

export interface AddChecksOfOptions extends AddChecksOptions {
  expectHash?: string | null;
  /**
   * The same plugin's module built with its functions' names kept (a build made from source): the
   * profiling build is made of it, so a heavy plugin's functions are named. Only ever metered with the
   * profiling meter and played for its counters; the checks themselves play the bundle's own module.
   */
  named?: Uint8Array;
}

export async function addChecksOf(bytes: Uint8Array, deps: InstallCheckDeps, opts: AddChecksOfOptions = {}): Promise<AddChecksOf> {
  const started = deps.now();
  const bundle = await readBundle(bytes);
  if (opts.expectHash && bundle.hash !== opts.expectHash) throw new AddChecksHashError('the bundle is not the one asked for (its content hash differs)');
  const meter = await deps.loadMeter();
  const [module, shim] = await Promise.all([deps.compile(meter(bundle.module, { mode: 'local' }).bytes), deps.shim()]);
  if (!isMetered(module)) throw new Error('the metered module lost its fuel exports');
  // The profiling meter (est profile's: the same rewrite with a counter a function) and the subnormal counter's
  // copy, both Binaryen's, both through the meter's own file (in the Worker: its one lazy chunk); only ever run here.
  const profiled = async () => {
    const em = await import('../install/estMeter');
    const p = em.meter(opts.named ?? bundle.module, { mode: 'local', profile: true });
    return p.profile ? { module: await deps.compile(p.bytes), profile: p.profile } : null;
  };
  const counted = async () => {
    const em = await import('../install/estMeter');
    let bytes = em.countDenormals(bundle.module);
    let plain: WebAssembly.Module;
    // Coalesced when the engine cannot compile it as the pass leaves it (too many locals), as EST-C027 does.
    try { plain = await deps.compile(bytes); } catch { bytes = em.countDenormals(bundle.module, { coalesce: true }); plain = await deps.compile(bytes); }
    let metered: WebAssembly.Module | null = null;
    try { metered = await deps.compile(em.meter(bytes, { mode: 'local' }).bytes); } catch { /* counted unmetered */ }
    return { metered, plain, counter: em.DENORMAL_COUNTER };
  };
  // The budget counts from the call: reading, metering and compiling are part of what the person waits for.
  const budget = opts.budgetMs ?? ADD_CHECKS_BUDGET_MS;
  const left = Number.isFinite(budget) ? Math.max(500, budget - (deps.now() - started)) : budget;
  const { expectHash: _e, named: _n, ...checkOpts } = opts;
  const report = await addTimeChecks({ bundle, module, shim, profiled, ...(opts.subnormals === false ? {} : { counted }) }, { now: deps.now, ...checkOpts, budgetMs: left });
  return { hash: bundle.hash, id: bundle.manifest.id, version: bundle.manifest.version, name: bundle.manifest.name, report };
}
