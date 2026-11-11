/**
 * EST Phase 4 (docs/est/EST_Phase4_Work_Order.md §1, D-37): the install check, moved out of the
 * compiling Worker (`estWorker.ts`) so the SDK's validator (`@cyber-est/tools`' `validate`) runs **the
 * same code** in Node: read and check the bundle (`bundle.ts`), the content hash asked for, meter
 * the module (`estMeter.ts`, D-30, `local` placement), compile the metered bytes and the host shim,
 * check the fuel exports, and the conformance run (`conformance.ts`). The Worker is a thin caller:
 * a failure here becomes its `refused` reply; the validator turns it into `validation.json`'s checks.
 *
 * It decides nothing by where it runs: what differs is given as `deps` (how to load the meter,
 * compile and time). It never throws for the plugin's faults: they come back as `ok: false` with
 * the refusal's `code` (the UI's words), `message` (unchanged from Phase 3) and `rule` (`rules.ts`).
 * Anything else (a bug, a host without WebAssembly) is thrown, and the Worker words it `'worker'`.
 *
 * Pure apart from `deps` (no DOM, no Worker globals, no Web Audio).
 */
import type { Metered } from './estMeter';
import { EstBundleError, readBundle, type EstBundle } from './bundle';
import { runConformance, type ConformanceReport } from './conformance';
import { isMetered } from './fuel';
import type { EstInstallRefusal, InstallTimings } from './workerProtocol';

export interface InstallCheckDeps {
  /** The meter (loaded lazily in the Worker: Binaryen is its own chunk). */
  loadMeter(): Promise<(bytes: Uint8Array, opts: { mode: 'local' }) => Metered>;
  /** Compile WebAssembly bytes (the Worker's `WebAssembly.compile`; never the page, D-27). */
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>;
  /** The host shim, compiled. */
  shim(): Promise<WebAssembly.Module>;
  now(): number;
}

export interface InstallCheckOptions {
  /** The content hash asked for (a reference install), or null (a file from disk). */
  expectHash?: string | null;
  /** Seconds of conformance signal (default the conformance run's 10). */
  seconds?: number;
  sampleRate?: number;
}

/** Where the check stopped. */
export type InstallCheckStage = 'read' | 'expect' | 'meter' | 'compile' | 'conformance';

export interface InstallChecked {
  ok: true;
  bundle: EstBundle;
  metered: Uint8Array;
  points: number;
  module: WebAssembly.Module;
  shim: WebAssembly.Module;
  report: ConformanceReport;
  timings: InstallTimings;
}

export interface InstallRefused {
  ok: false;
  stage: InstallCheckStage;
  code: EstInstallRefusal;
  message: string;
  /** The rule (`rules.ts`); null only for a fault that is not the plugin's. */
  rule: string | null;
  /** A path in the bundle, `est.json:<field>` or `phase:<phase>`, when known. */
  where: string | null;
  /** What was learnt before it stopped (the validator reports it). */
  bundle?: EstBundle;
  metered?: Uint8Array;
  points?: number;
  report?: ConformanceReport;
  timings: InstallTimings;
}

export type InstallCheck = InstallChecked | InstallRefused;

/** The rule of a meter failure, from the meter's own words (`estMeter.ts`). */
export function meterRuleOf(message: string): string {
  if (/already imports env\.log_execution/.test(message)) return 'EST-W012';
  if (/uses a WebAssembly feature EST does not run/.test(message)) return 'EST-W011';
  if (/unsupported expression id/.test(message)) return 'EST-W013';
  return 'EST-W014';
}

/**
 * The rule of a failed conformance run: its own, except that a module with a start function that
 * did not boot is refused for the start function (it traps before the host can give it fuel).
 */
export function conformanceRuleOf(report: ConformanceReport, bundle: Pick<EstBundle, 'wasm'>): string {
  if (report.phase === 'boot' && bundle.wasm.start) return 'EST-W015';
  return report.rule ?? 'EST-C001';
}

/** Run the install's checks on a bundle's bytes. */
export async function checkBundle(bytes: Uint8Array, opts: InstallCheckOptions, deps: InstallCheckDeps): Promise<InstallCheck> {
  const timings: InstallTimings = { readMs: 0, meterMs: 0, compileMs: 0, conformanceMs: 0 };
  const t0 = deps.now();
  let bundle: EstBundle;
  try {
    bundle = await readBundle(bytes);
  } catch (err) {
    if (!(err instanceof EstBundleError)) throw err;
    timings.readMs = deps.now() - t0;
    return { ok: false, stage: 'read', code: err.code, message: err.message, rule: err.rule, where: err.where, timings };
  }
  timings.readMs = deps.now() - t0;
  if (opts.expectHash && bundle.hash !== opts.expectHash) {
    return { ok: false, stage: 'expect', code: 'hash', message: 'the bundle is not the one asked for (its content hash differs)', rule: 'EST-B015', where: null, bundle, timings };
  }
  const t1 = deps.now();
  const meter = await deps.loadMeter();
  let metered: Uint8Array;
  let points: number;
  try {
    const r = meter(bundle.module, { mode: 'local' });
    metered = r.bytes;
    points = r.points;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    timings.meterMs = deps.now() - t1;
    return { ok: false, stage: 'meter', code: 'module', message: `the module could not be metered (${why})`, rule: meterRuleOf(why), where: bundle.manifest.module.path, bundle, timings };
  }
  const t2 = deps.now();
  timings.meterMs = t2 - t1;
  let module: WebAssembly.Module, shimModule: WebAssembly.Module;
  try {
    [module, shimModule] = await Promise.all([deps.compile(metered), deps.shim()]);
  } catch (err) {
    // Phase 3 words a compile failure as the Worker's own ('worker'); the rule is the module's.
    timings.compileMs = deps.now() - t2;
    return { ok: false, stage: 'compile', code: 'worker', message: err instanceof Error ? err.message : String(err), rule: 'EST-W014', where: bundle.manifest.module.path, bundle, metered, points, timings };
  }
  if (!isMetered(module)) {
    timings.compileMs = deps.now() - t2;
    return { ok: false, stage: 'compile', code: 'module', message: 'the metered module lost its fuel exports', rule: 'EST-W014', where: bundle.manifest.module.path, bundle, metered, points, timings };
  }
  const t3 = deps.now();
  timings.compileMs = t3 - t2;
  const report = runConformance({ module, shim: shimModule, manifest: bundle.manifest, seconds: opts.seconds, sampleRate: opts.sampleRate, presets: bundle.presets });
  timings.conformanceMs = deps.now() - t3;
  if (!report.ok) {
    const rule = conformanceRuleOf(report, bundle);
    // EST tidy (1.286, D-43): a start function's refusal names the way that works, `_initialize`.
    const why = rule === 'EST-W015' ? `${report.problem} (the module has a start function, which runs before the host can give it fuel: export _initialize() instead, which the host calls once with fuel)` : report.problem;
    return {
      ok: false, stage: 'conformance', code: 'conformance', message: `the conformance run refused it (${report.phase}): ${why}`,
      rule, where: report.phase ? `phase:${report.phase}` : null, bundle, metered, points, report, timings,
    };
  }
  return { ok: true, bundle, metered, points, module, shim: shimModule, report, timings };
}
