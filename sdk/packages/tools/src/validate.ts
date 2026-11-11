/**
 * @cyber-est/tools: `validate` (EST Phase 4, docs/est/EST_Phase4_Work_Order.md §1 and §6). Runs, in
 * order, Cyber's own install check (`checkBundle` in `src/audio/est/install/pipeline.ts`, the code
 * the compiling Worker runs: the bundle reader, the module inspection, the meter, the conformance
 * run) and then the checks only the validator makes (determinism, the bundle presets' round trip,
 * the UI probe, the block cost), and reports every rule of `rules.ts` as `pass`, `fail`, `warn` or
 * `skip`. `ok` is true when no check failed; a bundle `ok` here installs in Cyber (every install
 * rule passed), and may be refused by nothing stricter.
 *
 * The report (`validation.json`) is the same for the same bundle on any machine except what sits
 * under `measured` (the block cost, the timings and the time stamp) and `EST-P001`'s status, which
 * follows the measured cost.
 */
import { checkBundle, type InstallCheck } from '../../../../src/audio/est/install/pipeline';
import { EST_BLOCK_BUDGET_US, EST_RULES, EST_RULES_VERSION, EST_RULE_STEPS, type EstRule } from '../../../../src/audio/est/install/rules';
import { standInInstance, type ConformanceReport } from '../../../../src/audio/est/install/conformance';
import { nodeDeps } from './host';
import { packDir, sha256 } from './pack.mjs';
import { readProject } from './project';
import { probeUi, type UiFinding } from './ui';

export const TOOL_NAME = '@cyber-est/tools';
export const TOOL_VERSION = '0.1.0';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface ValidationCheck {
  rule: string;
  title: string;
  severity: 'error' | 'warning';
  status: CheckStatus;
  /** What was found, in plain words; empty for a pass (the rule's title stays in `title`). */
  message: string;
  /** How to fix it (empty for a pass or a skip). */
  fix: string;
  /** A path in the bundle, `est.json:<field>` or `phase:<phase>`, when known. */
  where?: string;
}

export interface ValidationReport {
  ok: boolean;
  plugin: { id: string | null; version: string | null; name: string | null; kind: string | null; hash: string };
  /** Every rule, in the table's order (a rule with several findings appears once per finding). */
  checks: ValidationCheck[];
  summary: { pass: number; fail: number; warn: number; skip: number };
  /** The conformance run's report (its `blockUs` moved to `measured`), or null when it did not run. */
  conformance: Omit<ConformanceReport, 'blockUs'> | null;
  /** What metering added (deterministic); its time is under `measured`. */
  meter: { moduleBytes: number; meteredBytes: number; addedBytes: number; points: number } | null;
  /** What depends on the machine and the moment. */
  measured: { blockUs: number | null; budgetUs: number; readMs: number; meterMs: number; compileMs: number; conformanceMs: number; at: string };
  tool: { name: string; version: string };
  rules: { version: string; count: number };
  /**
   * 1.400 (P3): advice that is not a rule (nothing fails or counts as a warning): today an output
   * peak above full scale under the stress run (`peakNote`). Deterministic, as the checks are.
   */
  notes: string[];
}

/** Full scale: a sample past ±1 clips once it leaves the browser. */
export const FULL_SCALE = 1;

/**
 * 1.400 (P3): the advice for the conformance run's peak, or null at or under full scale. The run is
 * a stress test (full-scale clicks with every parameter swept to its extremes), so a template's
 * +12 dB gain reaches about 3 there: the words say so, and what to check.
 */
export function peakNote(peak: number): string | null {
  if (!(peak > FULL_SCALE)) return null;
  const db = 20 * Math.log10(peak);
  return `the output peaked at ${peak.toFixed(2)} (+${db.toFixed(1)} dBFS), above full scale (1.0), under the stress signal: full-scale clicks with every parameter swept to its extremes, not your defaults. `
    + 'Cyber clamps a plugin\'s samples at ±4 and shows "Output limited" on its card, and the install refuses past +18 dBFS (EST-C015). '
    + 'If it is loud at the defaults too, lower the gain or clamp the feedback and resonance; est dev --json shows the meters at the defaults.';
}

export interface ValidateOptions {
  /** Seconds of conformance signal (default 10, as at install). */
  seconds?: number;
  sampleRate?: number;
  /** `{ dir }` only: the module to pack (default: the project's build output, `readProject`). */
  module?: string;
  /** `{ dir }` only: a LICENSE to pack when the folder has none. */
  license?: string;
  /** The report's time stamp (default now). */
  now?: () => Date;
}

const stepIndex = (r: EstRule) => EST_RULE_STEPS.indexOf(r.step);

/**
 * Validate a bundle (`.est` bytes) or a plugin folder (`{ dir }`, packed first with the same code
 * as `pack`).
 */
export async function validate(input: Uint8Array | { dir: string }, opts: ValidateOptions = {}): Promise<ValidationReport> {
  const bytes = input instanceof Uint8Array ? input : packDir(input.dir, { module: opts.module ?? readProject(input.dir).wasm, license: opts.license }).bytes;
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const r = await checkBundle(bytes, { expectHash: null, seconds: opts.seconds, sampleRate: opts.sampleRate }, nodeDeps);
  return reportOf(bytes, r, at, r.ok ? { state: probeState(r) } : {});
}

/** The validator's own checks that need a live instance (beyond the install's), run after a passed install check. */
export interface ExtraChecks {
  /** `EST-C020`/`EST-C011` once more: whether a fresh instance saves its state (null: it does). */
  state?: string | null;
}

/**
 * A fresh instance asked for its state once more (the install's state check, EST-C009 to EST-C011
 * and EST-C020, asked the probe instance after its parameter scan; this asks one that has done
 * nothing else), reported as EST-C020.
 */
export function probeState(r: Extract<InstallCheck, { ok: true }>): string | null {
  const inst = standInInstance({ module: r.module, shim: r.shim, manifest: r.bundle.manifest });
  try {
    const posted = inst.send({ type: 'state:get', req: 1 });
    const err = posted.find(m => m.type === 'error');
    if (err) return `it stopped while saving its state (${String(err.phase)}: ${String(err.message)})`;
    const reply = posted.find(m => m.type === 'reply' && m.req === 1);
    if (!reply) return 'it did not answer when asked for its state';
    if (!(reply.bytes instanceof ArrayBuffer)) return `it did not save its state (${String(reply.error ?? 'no bytes')}: clap.state's save returned false, wrote more than 4 MiB, or the plugin has no clap.state)`;
    return null;
  } finally {
    inst.send({ type: 'dispose' });
  }
}

/** The report of an install check's result (exported for the tests that compare it with the Worker's). */
export function reportOf(bytes: Uint8Array, r: InstallCheck, at: string, extra: ExtraChecks = {}): ValidationReport {
  const bundle = r.bundle;
  const report = r.report ?? null;
  const failedRule = r.ok ? null : r.rule;
  const failed = failedRule ? EST_RULES.find(x => x.id === failedRule) ?? null : null;
  const failedStep = r.ok ? EST_RULE_STEPS.indexOf('conformance') + 1 : failed ? stepIndex(failed) : 0;
  const conformanceOk = r.ok;
  const m = bundle?.manifest;
  const instrument = m?.kind === 'instrument';
  const uiFindings: UiFinding[] = bundle && m?.ui ? probeUi(m.ui.path, bundle.files) : [];
  const checks: ValidationCheck[] = [];
  const add = (rule: EstRule, status: CheckStatus, message: string, where?: string | null) => {
    const c: ValidationCheck = { rule: rule.id, title: rule.title, severity: rule.severity, status, message, fix: status === 'fail' || status === 'warn' ? rule.fix : '' };
    if (where) c.where = where;
    checks.push(c);
  };
  for (const rule of EST_RULES) {
    if (rule.install) {
      if (!r.ok && rule.id === failedRule) { add(rule, 'fail', r.message, r.where); continue; }
      if (rule.step === 'expect') { add(rule, 'skip', 'checked only when the host asks for a bundle by its hash'); continue; }
      // Rules in the failed step (other than the one that failed) and after it were not reached.
      if (stepIndex(rule) >= failedStep) { add(rule, 'skip', 'not reached: an earlier check failed'); continue; }
      if (rule.step === 'conformance' && report) {
        // EST-C004 holds for a note effect too (DEV-F, 1.321: its note ports, both ways).
        const notePorts = !!m && (m.notes.inputs > 0 || m.notes.outputs > 0);
        if (rule.id === 'EST-C004' && !instrument && !notePorts) { add(rule, 'skip', 'applies to instruments and note effects'); continue; }
        if (['EST-C016', 'EST-C017'].includes(rule.id) && !instrument) { add(rule, 'skip', 'applies to instruments'); continue; }
        if (rule.id === 'EST-C012' && !report.presets) { add(rule, 'skip', 'the bundle has no presets'); continue; }
        if (rule.id === 'EST-C017' && !report.tailChecked) { add(rule, 'skip', 'the reported tail did not end within the run'); continue; }
      }
      if (rule.id === 'EST-B014' && !m?.presets) { add(rule, 'skip', 'the bundle has no presets'); continue; }
      if (rule.id === 'EST-C020' && extra.state) { add(rule, 'fail', extra.state, 'phase:state'); continue; }
      add(rule, 'pass', '');
      continue;
    }
    // The validator's own checks.
    if (rule.step === 'determinism') {
      if (!conformanceOk || !report) { add(rule, 'skip', 'not reached: the conformance run did not pass'); continue; }
      if (rule.id === 'EST-C018') { if (report.deterministic) add(rule, 'pass', ''); else add(rule, 'fail', 'two runs of the same signal and events gave different output', 'phase:process'); continue; }
      if (rule.id === 'EST-C019') {
        if (!report.presets) add(rule, 'skip', 'the bundle has no presets');
        else if (report.presetsExact) add(rule, 'pass', '');
        else add(rule, 'warn', 'a bundle preset, loaded and saved again, gave other bytes', 'phase:presets');
        continue;
      }
    }
    if (rule.step === 'ui') {
      if (!bundle) { add(rule, 'skip', 'not reached: the bundle could not be read'); continue; }
      if (!m?.ui) { add(rule, 'skip', 'no custom UI (the host generates one)'); continue; }
      const found = uiFindings.filter(f => f.rule === rule.id);
      if (rule.id !== 'EST-U001' && uiFindings.some(f => f.rule === 'EST-U001')) { add(rule, 'skip', 'not reached: the UI page could not be read'); continue; }
      if (!found.length) { add(rule, 'pass', ''); continue; }
      for (const f of found.slice(0, 20)) add(rule, rule.severity === 'warning' ? 'warn' : 'fail', f.message, f.where);
      continue;
    }
    if (rule.step === 'performance') {
      if (!conformanceOk || !report) { add(rule, 'skip', 'not reached: the conformance run did not pass'); continue; }
      if (report.blockUs > EST_BLOCK_BUDGET_US) add(rule, 'warn', `a block cost ${report.blockUs.toFixed(1)} µs on this machine, over the budget of ${EST_BLOCK_BUDGET_US} µs`, 'phase:process');
      else add(rule, 'pass', '');
      continue;
    }
    add(rule, 'skip', 'not checked');
  }
  const summary = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;
  let conformance: ValidationReport['conformance'] = null;
  if (report) { const { blockUs: _b, ...rest } = report; conformance = rest; }
  const metered = r.metered;
  return {
    ok: summary.fail === 0,
    plugin: { id: m?.id ?? null, version: m?.version ?? null, name: m?.name ?? null, kind: m?.kind ?? null, hash: bundle?.hash ?? sha256(bytes) },
    checks,
    summary,
    conformance,
    meter: bundle && metered ? { moduleBytes: bundle.module.length, meteredBytes: metered.length, addedBytes: metered.length - bundle.module.length, points: r.points ?? 0 } : null,
    measured: { blockUs: report ? report.blockUs : null, budgetUs: EST_BLOCK_BUDGET_US, ...r.timings, at },
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    rules: { version: EST_RULES_VERSION, count: EST_RULES.length },
    notes: [report ? peakNote(report.peak) : null].filter((n): n is string => !!n),
  };
}

/** A report in readable lines (what `est validate` prints). */
export function formatReport(v: ValidationReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const who = v.plugin.id ? `${v.plugin.name ?? v.plugin.id} (${v.plugin.id} ${v.plugin.version})` : 'the bundle';
  lines.push(`${v.ok ? 'PASS' : 'FAIL'} ${who}  ${v.plugin.hash}`);
  for (const c of v.checks) {
    if (c.status === 'pass' && !opts.verbose) continue;
    if (c.status === 'skip' && !opts.verbose) continue;
    const mark = c.status === 'fail' ? 'x' : c.status === 'warn' ? '!' : c.status === 'skip' ? '-' : '.';
    lines.push(`  ${mark} ${c.rule} ${c.status.toUpperCase()}: ${c.message || c.title}${c.where ? `  [${c.where}]` : ''}`);
    if (c.fix) lines.push(`      fix: ${c.fix}`);
  }
  for (const n of v.notes ?? []) lines.push(`  ! note: ${n}`);
  lines.push(`  ${v.summary.pass} passed, ${v.summary.fail} failed, ${v.summary.warn} warnings, ${v.summary.skip} skipped`);
  if (v.conformance && v.measured.blockUs !== null) lines.push(`  block ${v.measured.blockUs.toFixed(1)} µs (budget ${v.measured.budgetUs}), peak ${v.conformance.peak.toFixed(3)}, deterministic ${v.conformance.deterministic}`);
  if (v.meter) lines.push(`  metered: +${v.meter.addedBytes} bytes, ${v.meter.points} points`);
  return lines.join('\n');
}
