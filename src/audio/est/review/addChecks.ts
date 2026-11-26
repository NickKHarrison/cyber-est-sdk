/**
 * 1.914: **the add-time checks**. When a person adds a plugin of their own (a pasted answer, a zip, a
 * `.est`), the install pipeline says whether it may run; these say how it **behaves**, in a few seconds,
 * off the audio thread (the compiling Worker; Node for the kit), on the `est-plugin` processor's own code
 * (`standInInstance`, the metered module, as at install and as the behaviour checks of `behaviour.ts`):
 *
 * 1. **sound**: an instrument silent for played notes (five keys, a soft one); an effect whose output is
 *    silence, or its input whatever its controls say (EST-C031).
 * 2. **stops**: a released chord (an effect: the test loop, then nothing) that never dies away (EST-C032);
 *    the cheap forms of EST-C024 (a NOTE_END a note) and EST-C028 (sound past the reported tail).
 * 3. **safe**: the level of a full chord at its defaults (EST-C033), a DC offset (EST-C034), output that is
 *    not finite or that the host's output check limits (EST-C035), a click when a note ends (EST-C036).
 * 4. **light**: the fuel a block spends with 1, 8 and 16 notes held (an effect: full-scale noise), against
 *    the processor's own slow-stop bound (EST-C037), the hottest functions named from a profiling build
 *    (`meter(…, { profile: true })`, `est profile`'s machinery) when the caller can make one.
 * 5. **controls**: in a plugin of at most twelve parameters, one that never changes the output, at its
 *    ends and again with every other parameter at seeded random values (EST-C038); a corner of them all
 *    (every one at its maximum, its minimum, two seeded mixes) that stops the plugin or gives output that
 *    is not finite (EST-C039: the conformance run moves one at a time); a window naming a parameter the
 *    plugin lacks (EST-U006).
 * 6. **rate**: pitch, a release or an echo that is the same count of frames at 44.1 and 48 kHz (EST-C040);
 *    subnormal stores in silence (EST-C027's own count at the defaults, on the counted copy the caller gives).
 *
 * **Findings are facts with numbers** (`code`, `numbers`); every word a person or their assistant reads is
 * `addCheckWords.ts`'. Nothing here refuses anything: the rules are the validator's warnings
 * (`install: false`, `severity: 'warning'` in rules.ts), so a plugin that is merely imperfect is still
 * added, and no install rule is loosened. A **time budget** (`budgetMs`, the caller's clock) is checked
 * before every run: a check not reached is `not-checked`, never guessed. The checks run in the order of
 * what matters before a person plays: sound, stops, safe, light, then the rest.
 *
 * It compiles nothing and imports no Binaryen: the caller gives the metered module compiled and,
 * optionally, ways to get the profiling build and the subnormal counter's copy compiled (`profiled`,
 * `counted`), so the compile sites stay the compiling Worker and Node's kit, and in the Worker Binaryen
 * stays in the one meter chunk. Pure apart from WebAssembly (no DOM, no Node).
 */
import type { EstParam } from '../EstNode';
import type { EstBundle } from '../install/bundle';
import { standInInstance } from '../install/conformance';
import type { MeterProfile } from '../install/estMeter';
import { fillLoop } from '../testLoop';
import { windowParamRefs } from './uiParams';

export const ADD_CHECK_IDS = ['sound', 'stops', 'safe', 'light', 'controls', 'rate'] as const;
export type AddCheckId = typeof ADD_CHECK_IDS[number];
/** The rules these checks report under: the new ones, and three of the behaviour checks' in their cheap form. */
export const ADD_CHECK_RULES = ['EST-C031', 'EST-C032', 'EST-C033', 'EST-C034', 'EST-C035', 'EST-C036', 'EST-C037', 'EST-C038', 'EST-C039', 'EST-C040', 'EST-U006'] as const;
export type AddCheckRule = typeof ADD_CHECK_RULES[number] | 'EST-C024' | 'EST-C027' | 'EST-C028';

/** `serious`: shown before the person plays (silent, stuck, dangerously loud, too heavy to run). */
export type AddSeverity = 'serious' | 'warning' | 'note';

export type AddCode =
  | 'silent' | 'silent-keys' | 'silent-soft' | 'does-nothing'
  | 'stuck' | 'rings' | 'note-end' | 'past-tail'
  | 'loud' | 'hot' | 'dc' | 'not-finite' | 'limited' | 'click-off'
  | 'too-heavy' | 'heavy'
  | 'dead-controls' | 'extreme-combo'
  | 'rate-pitch' | 'rate-time' | 'rate-delay' | 'subnormal'
  | 'window-params' | 'stopped';

export interface HotFunction { name: string | null; index: number; share: number }

export interface AddFinding {
  check: AddCheckId;
  rule: AddCheckRule;
  code: AddCode;
  severity: AddSeverity;
  /** What was measured (levels linear unless the key ends `Db`; times in seconds). */
  numbers: Record<string, number>;
  /** Names: parameters, keys, files (each cleaned and cut by the words). */
  names?: string[];
  /** EST-C037: where the fuel went, the most first. */
  functions?: HotFunction[];
  /** The processor's own words when it stopped. */
  detail?: string;
}

export interface AddCheckState { id: AddCheckId; status: 'clean' | 'findings' | 'not-checked'; /** Why it was not checked (`time`: the budget ran out). */ why?: 'time' | 'kind' | 'error'; /** The wall time it took (absent: not run). */ ms?: number }

export interface AddCheckReport {
  /** The report's shape (a stored report of another shape is dropped). */
  v: 1;
  kind: 'instrument' | 'effect' | 'other';
  checks: AddCheckState[];
  findings: AddFinding[];
  /** What the safe check measured at the defaults (null: not reached). */
  level: { peak: number; rms: number } | null;
  /** The fuel a block spent, as a share of the block's budget, by notes held (an effect: one entry, `0`). */
  load: { voices: number; mean: number; peak: number; us: number }[];
  /** The trim (dB, negative) that brings the measured peak to −6 dBFS, when the only fix is level; else null. */
  trimDb: number | null;
  /** Wall time the checks took, and whether the budget cut them short. */
  ms: number;
  cut: boolean;
}

export interface AddChecksInput {
  bundle: Pick<EstBundle, 'manifest' | 'module' | 'presets'> & { files?: EstBundle['files'] };
  /** The metered module (the install's), compiled, and the host shim. */
  module: WebAssembly.Module;
  shim: WebAssembly.Module;
  /**
   * The subnormal counter's copy of the module (review/denormals.ts' `countDenormals`: every float store
   * counted), compiled: metered as installed when that compiles, and plain (a counted copy may spend the
   * fuel where the installed module does not, as EST-C027 allows). Absent: the count is not made.
   */
  counted?: () => Promise<CountedModule | null> | CountedModule | null;
  /** The profiling build, compiled, with its function table (absent: hot functions are not named). */
  profiled?: () => Promise<{ module: WebAssembly.Module; profile: MeterProfile } | null> | { module: WebAssembly.Module; profile: MeterProfile } | null;
}

export interface CountedModule { metered: WebAssembly.Module | null; plain: WebAssembly.Module; /** The counter's exported global. */ counter: string }

/** A profiling build's exports for function `k` (estMeter.ts' `profileFuelExport`, `profileCallsExport`: held equal by a test). */
const profileFuelExport = (k: number) => `est_profile_fuel_${k}`;
const profileCallsExport = (k: number) => `est_profile_calls_${k}`;
/** Subnormal stores in one second that count as a stuck state (behaviour.ts' `SUBNORMAL_STUCK`, EST-C027's: held equal by a test). */
export const SUBNORMAL_STUCK = 100;
/** The count's run, EST-C027's own lengths: seconds of signal, of silence after it, and how many last seconds are judged. */
export const SUBNORMAL_RUN = { signal: 3, silence: 10, judged: 5 } as const;

export interface AddChecksOptions {
  /** The wall time the checks may take (default `ADD_CHECKS_BUDGET_MS`; `Infinity` for the kit). */
  budgetMs?: number;
  now?: () => number;
  /** Only these checks (the tests). */
  only?: readonly AddCheckId[];
  /** Leave the subnormal count out (the kit's validator runs EST-C027 itself). */
  subnormals?: boolean;
  /** The most parameters a plugin may have for each to be judged (default `CONTROLS_MAX`). */
  controls?: number;
}

/** A few seconds: what adding a plugin may wait for its behaviour to be known (the plugin is usable meanwhile). */
export const ADD_CHECKS_BUDGET_MS = 4000;
const SR = 48000;
const F = 128;
/** Below this peak there is no sound (−80 dBFS), as the behaviour checks' `QUIET`. */
export const SILENT = 1e-4;
/** Two outputs are the same within this (a float's rounding, not a sound). */
export const SAME = 1e-6;
/** EST-C032: still sounding, 5.5 to 6.5 s after the release, over this share of its held level (−50 dB) … */
export const STUCK_REL = 0.003;
/** … and no quieter than this share of the second before (under 1 dB a second: it is not dying away). */
export const STUCK_DECAY = 0.9;
/** EST-C032: how long after the release it listens (seconds). */
export const STUCK_WAIT_S = 6.5;
/**
 * EST-C033: a full chord's peak past +9.5 dBFS is dangerous to hear (the host clamps at +12); past +6 dBFS it
 * is twice full scale and clips whatever follows it. Measured over the catalogue (1.914's sweep): a
 * four-note chord at full velocity peaks at or under 0 dBFS in all but two shipped instruments (+2.4, +6.4).
 */
export const LOUD_SERIOUS = 3;
export const LOUD_WARN = 2;
/** The host's output check clamps at ±4 (estProcessor.ts): a peak past it is "Output limited". */
export const HOST_CLAMP = 4;
/** The level the safe trim aims a chord's peak at (−6 dBFS), and the most it trims (dB). */
export const TRIM_TARGET = 0.5;
export const TRIM_MAX_DB = -36;
/** EST-C034: a channel's mean past this (as `soundChecks.ts`' DC_LIMIT). */
export const DC_LIMIT = 0.05;
/** EST-C036: a step, as the note ends, over this share of the held level and this many times the largest step while held. */
export const CLICK_REL = 0.2;
export const CLICK_TIMES = 4;
/** EST-C037: the processor stops an instance whose blocks each use 90 % of the fuel (`SLOW_SHARE`); every shipped bundle stays under 75 %. */
export const HEAVY_STOP = 0.9;
export const HEAVY_WARN = 0.75;
export const LOAD_VOICES = [1, 8, 16] as const;
/**
 * EST-C038: a plugin with at most this many parameters has each one judged, and a suspect tried again in
 * this many random states. A larger plugin's controls depend on each other, on modes and on time in ways a
 * second of audio cannot show (the catalogue's sweep: Glide, Bend range, Fills, a Meter switch), so there
 * the check says nothing rather than guess.
 */
export const CONTROLS_MAX = 12;
export const CONTROLS_RETRIES = 3;
/** EST-C040: 44.1 against 48 kHz, a time that is the same count of frames is this ratio in seconds. */
export const RATE_RATIO = 48000 / 44100;

const CLAP_STEPPED = 1, CLAP_HIDDEN = 4, CLAP_READONLY = 8, CLAP_BYPASS = 16;

type Ev = Record<string, unknown> & { type: string; time: number };
const on = (time: number, key: number, noteId: number, velocity = 0.8): Ev => ({ type: 'noteOn', time, key, velocity, noteId, channel: 0, port: 0 });
const off = (time: number, key: number, noteId: number): Ev => ({ type: 'noteOff', time, key, velocity: 0, noteId, channel: 0, port: 0 });
const transport = (time: number, beat: number, playing: boolean, tempo = 120): Ev => ({ type: 'transport', time, playing, tempo, beat, num: 4, den: 4 });
const param = (time: number, id: number, value: number): Ev => ({ type: 'param', time, id, value });

interface Run {
  L: Float32Array; R: Float32Array;
  /** Frames rendered (a run may stop early). */
  frames: number;
  error: { phase: string; message: string } | null;
  /** The plugin's own peak before the host's clamp, samples not finite, samples clamped. */
  rawPeak: number; nonFinite: number; clipped: number;
  noteEnds: number;
  /** A block's fuel as a share of the block's budget: every block, in order. */
  fuel: number[];
  tails: Map<number, number>;
  ms: number;
  /** `RunOpts.second` ended it. */
  stoppedEarly?: boolean;
}
interface RunOpts {
  sr?: number;
  input?: [Float32Array, Float32Array];
  /** Read the reported tail at these frames (block starts). */
  tailAt?: number[];
  /** Stop once the output has stayed under `SILENT / 10` for 0.3 s after this frame, and (when given) `until` says it may. */
  quietAfter?: number;
  until?: (frame: number, noteEnds: number) => boolean;
  module?: WebAssembly.Module;
  /** Called with the instance the processor made of `module` (the profiling build's counters). */
  instance?: (i: WebAssembly.Instance) => void;
  /** Called after each whole second of audio; true ends the run there (`stoppedEarly`). */
  second?: (n: number) => boolean;
}

interface Proc { tail(): number; noteEnds?: number; dead?: boolean; statPoints?: number; statPeak?: number; statNonFinite?: number; statClipped?: number; blockFuel?: number }

class Rig {
  params: EstParam[] = [];
  runs = 0;
  constructor(private input: AddChecksInput, private now: () => number) {}

  run(events: Ev[], seconds: number, o: RunOpts = {}): Run {
    this.runs++;
    const sr = o.sr ?? SR;
    const frames = Math.ceil((seconds * sr) / F) * F;
    const L = new Float32Array(frames), R = new Float32Array(frames);
    const module = o.module ?? this.input.module;
    const Real = WebAssembly.Instance;
    let caught: WebAssembly.Instance | null = null;
    if (o.instance) {
      WebAssembly.Instance = function (m: WebAssembly.Module, imports?: WebAssembly.Imports) {
        const made = new Real(m, imports);
        if (m === module) caught = made;
        return made;
      } as unknown as typeof WebAssembly.Instance;
    }
    let inst: ReturnType<typeof standInInstance>;
    try {
      inst = standInInstance({ module, shim: this.input.shim, manifest: this.input.bundle.manifest }, sr, { queueSize: 4096 });
    } finally {
      WebAssembly.Instance = Real;
    }
    const out: Run = { L, R, frames: 0, error: null, rawPeak: 0, nonFinite: 0, clipped: 0, noteEnds: 0, fuel: [], tails: new Map(), ms: 0 };
    const ready = inst.boot.find(b => b.type === 'ready');
    if (!ready) {
      const err = inst.boot.find(b => b.type === 'error');
      inst.send({ type: 'dispose' });
      out.error = { phase: err ? String(err.phase) : 'boot', message: err ? String(err.message) : 'it did not start' };
      return out;
    }
    if (caught && o.instance) o.instance(caught);
    if (!this.params.length) this.params = (ready.params as EstParam[] | undefined) ?? [];
    if (events.length) inst.send({ type: 'events', events: [...events].sort((a, b) => a.time - b.time) });
    const proc = inst.proc as unknown as Proc;
    const budget = proc.blockFuel || 1;
    const zero = new Float32Array(F);
    const tailAt = new Set(o.tailAt ?? []);
    let lastPoints = proc.statPoints ?? 0;
    let quietFrom = -1;
    const quietNeed = Math.round(0.3 * sr);
    const t0 = this.now();
    let at = 0;
    for (; at < frames; at += F) {
      let inL: Float32Array = zero, inR: Float32Array = zero;
      if (o.input && at + F <= o.input[0].length) { inL = o.input[0].subarray(at, at + F); inR = o.input[1].subarray(at, at + F); }
      const { out: block, posted } = inst.block(inL, inR, at);
      const err = posted.find(m => m.type === 'error');
      const points = proc.statPoints ?? 0;
      out.fuel.push((points - lastPoints) / budget);
      lastPoints = points;
      if (err || proc.dead) { out.error = { phase: err ? String(err.phase) : 'stopped', message: err ? String(err.message) : 'it stopped' }; break; }
      L.set(block[0], at);
      R.set(block[1], at);
      if (tailAt.has(at)) out.tails.set(at, proc.tail());
      if (o.second && (at + F) % sr === 0 && o.second((at + F) / sr)) { out.stoppedEarly = true; at += F; break; }
      if (o.quietAfter !== undefined && at >= o.quietAfter) {
        let loud = false;
        for (let i = 0; i < F; i++) if (Math.abs(block[0][i]!) > SILENT / 10 || Math.abs(block[1][i]!) > SILENT / 10) { loud = true; break; }
        if (loud) quietFrom = -1;
        else if (quietFrom < 0) quietFrom = at;
        if (quietFrom >= 0 && at + F - quietFrom >= quietNeed && (!o.until || o.until(at + F, proc.noteEnds ?? 0))) { at += F; break; }
      }
    }
    out.ms = this.now() - t0;
    out.frames = Math.min(at, frames);
    out.rawPeak = proc.statPeak ?? 0;
    out.nonFinite = proc.statNonFinite ?? 0;
    out.clipped = proc.statClipped ?? 0;
    out.noteEnds = proc.noteEnds ?? 0;
    inst.send({ type: 'dispose' });
    return out;
  }
}

const peakOf = (r: Run, from = 0, to = r.frames) => {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(to, r.frames); i++) { const v = Math.max(Math.abs(r.L[i]!), Math.abs(r.R[i]!)); if (v > m) m = v; }
  return m;
};
const rmsOf = (r: Run, from: number, to: number) => {
  let e = 0;
  const a = Math.max(0, from), b = Math.min(to, r.frames);
  for (let i = a; i < b; i++) e += r.L[i]! * r.L[i]! + r.R[i]! * r.R[i]!;
  return b > a ? Math.sqrt(e / (2 * (b - a))) : 0;
};
const meanOf = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]!;
  return to > from ? s / (to - from) : 0;
};
/** The largest difference between two runs over what both rendered. */
const diffOf = (a: Run, b: Run) => {
  let m = 0;
  const n = Math.min(a.frames, b.frames);
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(a.L[i]! - b.L[i]!), Math.abs(a.R[i]! - b.R[i]!));
    if (d > m) m = d;
  }
  return a.frames !== b.frames ? Math.max(m, 1) : m;
};
/** The largest step between neighbouring samples (the mono sum) over a span. */
const stepOf = (r: Run, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(1, from); i < Math.min(to, r.frames); i++) {
    const d = Math.abs((r.L[i]! + r.R[i]!) - (r.L[i - 1]! + r.R[i - 1]!)) / 2;
    if (d > m) m = d;
  }
  return m;
};

function loopOf(seconds: number, sr = SR): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sr);
  const l = new Float32Array(n), r = new Float32Array(n);
  fillLoop(l, r, sr);
  return [l, r];
}

/** A seeded generator (xorshift32): the same plugin is checked with the same values every time. */
function seeded(text: string) {
  let s = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) s = Math.imul(s ^ text.charCodeAt(i), 0x01000193) >>> 0;
  if (!s) s = 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * The period (seconds) of a steady tone in a run's span, by normalised autocorrelation: the first lag
 * whose correlation is a local peak over 0.9, refined between samples; null for a sound with no clear
 * pitch (noise, a chord, a sweep), which the rate check then leaves alone.
 */
export function periodOf(x: Float32Array, from: number, to: number, sr: number): number | null {
  const n = to - from;
  if (n < 2048) return null;
  const maxLag = Math.min(2400, Math.floor(n / 2));
  let e0 = 0;
  for (let i = from; i < to - maxLag; i++) e0 += x[i]! * x[i]!;
  if (e0 < 1e-9) return null;
  const nac = (lag: number) => {
    let c = 0, e1 = 0;
    for (let i = from; i < to - maxLag; i++) { c += x[i]! * x[i + lag]!; e1 += x[i + lag]! * x[i + lag]!; }
    return c / Math.sqrt(e0 * e1 + 1e-30);
  };
  let prev = nac(15), cur = nac(16), fell = false;
  for (let lag = 16; lag < maxLag; lag++) {
    const next = nac(lag + 1);
    if (cur < 0.5) fell = true;
    if (fell && cur > 0.9 && cur >= prev && cur >= next) {
      const denom = prev - 2 * cur + next;
      const shift = denom < 0 ? 0.5 * (prev - next) / denom : 0;
      return (lag + shift) / sr;
    }
    prev = cur;
    cur = next;
  }
  return null;
}

const usable = (p: EstParam) => p.max > p.min && Number.isFinite(p.min) && Number.isFinite(p.max) && !(p.flags & (CLAP_HIDDEN | CLAP_READONLY | CLAP_BYPASS));
const snap = (p: EstParam, v: number) => (p.flags & CLAP_STEPPED ? Math.round(v) : v);
/** A parameter's value part-way along its range (a log parameter along its ratio). */
const along = (p: EstParam, t: number) => snap(p, p.scale === 'log' && p.min > 0 ? p.min * Math.pow(p.max / p.min, t) : p.min + (p.max - p.min) * t);

/** Features that make silent keys ordinary: a kit maps a few keys, a sampler its zones. */
const KEYED = ['drum', 'drums', 'drum-machine', 'percussion', 'sampler'];

/** Run the add-time checks. Never throws for the plugin's faults; a check that could not run is `not-checked`. */
export async function addTimeChecks(input: AddChecksInput, opts: AddChecksOptions = {}): Promise<AddCheckReport> {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const started = now();
  const deadline = started + (opts.budgetMs ?? ADD_CHECKS_BUDGET_MS);
  const late = () => now() > deadline;
  const rig = new Rig(input, now);
  const m = input.bundle.manifest;
  const instrument = m.kind === 'instrument';
  // A note effect (notes in and out) works on notes: the sound it is given passes through by design, so the
  // checks of sound have nothing to say about it.
  const noteEffect = !instrument && (m.notes?.outputs ?? 0) > 0;
  const effect = !instrument && !noteEffect && (m.audio?.inputs ?? 0) > 0;
  const kind: AddCheckReport['kind'] = instrument ? 'instrument' : effect ? 'effect' : 'other';
  const report: AddCheckReport = { v: 1, kind, checks: [], findings: [], level: null, load: [], trimDb: null, ms: 0, cut: false };
  const find = (f: AddFinding) => { report.findings.push(f); };
  const stopped = (check: AddCheckId, r: Run): boolean => {
    if (!r.error) return false;
    // A plugin that stops in one check stops in the next: said once.
    if (!report.findings.some(f => f.code === 'stopped')) find({ check, rule: 'EST-C039', code: 'stopped', severity: 'serious', numbers: {}, detail: `${r.error.phase}: ${r.error.message}`.slice(0, 200) });
    return true;
  };
  /** Whether what both checks need was found: the effect's output is its input at the defaults. */
  let transparent = false;

  const checks: Record<AddCheckId, () => void | Promise<void>> = {
    // --- 1. Does it make sound? -------------------------------------------------------------------
    sound() {
      if (instrument) {
        const keys = [36, 48, 60, 72, 84];
        const plan = (playing: boolean) => {
          const ev: Ev[] = [transport(0, 0, playing)];
          keys.forEach((k, i) => ev.push(on(0.01 + i * 0.3, k, i + 1, 0.8), off(0.21 + i * 0.3, k, i + 1)));
          ev.push(on(1.51, 60, 9, 0.25), off(1.71, 60, 9));
          return ev;
        };
        const peaks = (r: Run) => [0, 1, 2, 3, 4, 5].map(i => peakOf(r, Math.round((0.01 + i * 0.3) * SR), Math.round((0.31 + i * 0.3) * SR)));
        let r = rig.run(plan(false), 1.9);
        if (stopped('sound', r)) return;
        let got = peaks(r);
        if (got.every(p => p < SILENT)) {
          // An arpeggiator or a pattern instrument may wait for the transport.
          r = rig.run(plan(true), 1.9);
          if (stopped('sound', r)) return;
          got = peaks(r);
        }
        const silentKeys = keys.filter((_, i) => got[i]! < SILENT);
        if (silentKeys.length === keys.length) {
          // A slow attack (a pad, a sound effect that builds) says nothing in 0.2 s: one note held for 2 s.
          const held = rig.run([transport(0, 0, true), on(0.01, 60, 1, 0.9)], 2);
          if (stopped('sound', held)) return;
          if (peakOf(held) >= SILENT) return;
        }
        if (silentKeys.length === keys.length) { find({ check: 'sound', rule: 'EST-C031', code: 'silent', severity: 'serious', numbers: { notes: keys.length } }); return; }
        const keyed = m.features.some(f => KEYED.includes(f));
        if (silentKeys.length && !keyed) find({ check: 'sound', rule: 'EST-C031', code: 'silent-keys', severity: 'warning', numbers: { silent: silentKeys.length, of: keys.length }, names: silentKeys.map(String) });
        if (got[2]! >= SILENT && got[5]! < SILENT && !keyed) find({ check: 'sound', rule: 'EST-C031', code: 'silent-soft', severity: 'note', numbers: { velocity: 0.25, loud: got[2]! } });
        return;
      }
      if (!effect) return;
      const loop = loopOf(1);
      const ref: Run = { L: loop[0], R: loop[1], frames: loop[0].length, error: null, rawPeak: 0, nonFinite: 0, clipped: 0, noteEnds: 0, fuel: [], tails: new Map(), ms: 0 };
      let r = rig.run([transport(0, 0, true)], 1, { input: loop });
      if (stopped('sound', r)) return;
      if (peakOf(r) < SILENT) {
        // A gate that opens only while the song is stopped is unlikely, but a silent effect is asked twice.
        r = rig.run([transport(0, 0, false)], 1, { input: loop });
        if (stopped('sound', r)) return;
        if (peakOf(r) < SILENT) { find({ check: 'sound', rule: 'EST-C031', code: 'silent', severity: 'serious', numbers: { input: peakOf(ref) } }); return; }
      }
      transparent = diffOf(r, ref) < SAME;
    },

    // --- 2. Does a note stop? ---------------------------------------------------------------------
    stops() {
      const release = instrument ? 0.5 : 1;
      const relFrame = Math.floor((release * SR) / F) * F;
      const events: Ev[] = [transport(0, 0, false)];
      const chord = [48, 60, 67];
      if (instrument) chord.forEach((k, i) => events.push(on(0.02, k, i + 1, 0.8), off(release, k, i + 1)));
      else if (!effect) return;
      const input = instrument ? undefined : loopOf(release);
      let tailS = Infinity;
      const r = rig.run(events, release + STUCK_WAIT_S, {
        input, tailAt: [relFrame], quietAfter: relFrame + F,
        // Listen past the reported tail (when it is short enough to wait for), so a late NOTE_END is counted.
        until: (frame, ends) => (instrument && ends >= chord.length) || frame >= relFrame + Math.min(tailS, STUCK_WAIT_S - 1) * SR + 0.5 * SR,
      });
      if (stopped('stops', r)) return;
      const t = r.tails.get(relFrame) ?? 0;
      tailS = t === 0xffffffff ? Infinity : t / SR;
      const held = peakOf(r, 0, relFrame + F);
      if (held < SILENT) return; // nothing sounded: the sound check's finding
      const sec = (s: number) => Math.round(s * SR);
      const ended = r.frames < sec(release + STUCK_WAIT_S) - F;
      if (!ended) {
        const w1 = rmsOf(r, sec(release + STUCK_WAIT_S - 2), sec(release + STUCK_WAIT_S - 1));
        const w2 = rmsOf(r, sec(release + STUCK_WAIT_S - 1), sec(release + STUCK_WAIT_S));
        // A plugin that sounds with nothing played (a drone, a noise floor) is not a stuck note.
        const base = rig.run([transport(0, 0, false)], 0.5);
        const own = peakOf(base);
        if (w2 > STUCK_REL * held && w2 >= STUCK_DECAY * w1 && own < 0.5 * w2) {
          find({ check: 'stops', rule: 'EST-C032', code: instrument ? 'stuck' : 'rings', severity: 'serious', numbers: { after: STUCK_WAIT_S, level: w2, held, tail: Number.isFinite(tailS) ? tailS : -1 } });
          return;
        }
      }
      if (Number.isFinite(tailS) && tailS <= STUCK_WAIT_S - 1.5) {
        const from = relFrame + sec(tailS) + F + sec(0.02);
        const after = peakOf(r, from);
        // What it sounds by itself with nothing played (a noise floor, an ident) is not a tail.
        const own = from < r.frames - sec(0.1) && after > Math.max(1e-3 * held, SILENT) ? peakOf(rig.run([transport(0, 0, false)], 1)) : 0;
        if (from < r.frames - sec(0.1) && after > Math.max(1e-3 * held, SILENT, 2 * own)) {
          find({ check: 'stops', rule: 'EST-C028', code: 'past-tail', severity: 'warning', numbers: { tail: tailS, level: after, held } });
        }
        // The sound is over and the tail has passed (with a second to spare, as EST-C024 waits), and the host was
        // not told every note ended: it keeps the plugin running in silence.
        const over = r.frames >= relFrame + sec(tailS + 1) && peakOf(r, r.frames - sec(0.4)) < SILENT;
        if (instrument && over && r.noteEnds !== chord.length) {
          find({ check: 'stops', rule: 'EST-C024', code: 'note-end', severity: 'warning', numbers: { notes: chord.length, ends: r.noteEnds } });
        }
      }
    },

    // --- 3. Is it safe to hear? -------------------------------------------------------------------
    safe() {
      const sec = (s: number) => Math.round(s * SR);
      let r: Run;
      if (instrument) {
        const ev: Ev[] = [transport(0, 0, false)];
        [48, 55, 60, 64].forEach((k, i) => ev.push(on(0.02, k, i + 1, 1), off(1, k, i + 1)));
        r = rig.run(ev, 1.3);
      } else if (effect) r = rig.run([transport(0, 0, true)], 1.3, { input: loopOf(1) });
      else return;
      const raw = Math.max(r.rawPeak, peakOf(r));
      report.level = { peak: raw, rms: rmsOf(r, sec(0.1), sec(1)) };
      if (r.nonFinite > 0) find({ check: 'safe', rule: 'EST-C035', code: 'not-finite', severity: 'serious', numbers: { samples: r.nonFinite } });
      if (stopped('safe', r)) return;
      if (r.clipped > 0 || raw > HOST_CLAMP) find({ check: 'safe', rule: 'EST-C035', code: 'limited', severity: 'serious', numbers: { peak: raw, samples: r.clipped } });
      else if (raw > LOUD_SERIOUS) find({ check: 'safe', rule: 'EST-C033', code: 'loud', severity: 'serious', numbers: { peak: raw, rms: report.level.rms } });
      else if (raw > LOUD_WARN) find({ check: 'safe', rule: 'EST-C033', code: 'hot', severity: 'warning', numbers: { peak: raw, rms: report.level.rms } });
      if (raw > LOUD_WARN && r.nonFinite === 0) report.trimDb = Math.max(TRIM_MAX_DB, Math.floor(20 * Math.log10(TRIM_TARGET / raw)));
      const dcL = meanOf(r.L, sec(0.5), Math.min(sec(1), r.frames)), dcR = meanOf(r.R, sec(0.5), Math.min(sec(1), r.frames));
      const dc = Math.abs(dcL) >= Math.abs(dcR) ? dcL : dcR;
      if (Math.abs(dc) > DC_LIMIT) find({ check: 'safe', rule: 'EST-C034', code: 'dc', severity: 'warning', numbers: { dc } });
      if (!instrument || late()) return;
      // A click as a note ends: one note let go at two moments (two phases of its wave), both must step.
      const offs = [0.3, 1.117];
      const c = rig.run([transport(0, 0, false), on(0.02, 60, 1, 1), off(offs[0]!, 60, 1), on(0.8, 60, 2, 1), off(offs[1]!, 60, 2)], 1.6);
      if (c.error) return;
      const steps = offs.map((o) => {
        const at = sec(o);
        const heldPeak = peakOf(c, at - sec(0.1), at);
        const steady = stepOf(c, at - sec(0.1), at - 2);
        const after = stepOf(c, at - 1, at + sec(0.25));
        return { heldPeak, steady, after, click: heldPeak > SILENT && after > CLICK_REL * heldPeak && after > CLICK_TIMES * steady };
      });
      if (steps.every(s => s.click)) {
        const worst = steps.reduce((a, b) => (a.after / a.heldPeak > b.after / b.heldPeak ? a : b));
        find({ check: 'safe', rule: 'EST-C036', code: 'click-off', severity: 'warning', numbers: { step: worst.after, held: worst.heldPeak, steady: worst.steady } });
      }
    },

    // --- 4. Does it run light enough? -------------------------------------------------------------
    async light() {
      const seconds = (64 * F) / SR;
      const scenario = (voices: number): { events: Ev[]; input?: [Float32Array, Float32Array] } => {
        if (instrument) {
          const ev: Ev[] = [transport(0, 0, true)];
          for (let i = 0; i < voices; i++) ev.push(on(0.005, 36 + i * 3, i + 1, 0.9));
          return { events: ev };
        }
        // An effect's heaviest input: full-scale noise (seeded), every sample another.
        const n = Math.round(seconds * SR) + F;
        const l = new Float32Array(n), rr = new Float32Array(n);
        const rnd = seeded('load');
        for (let i = 0; i < n; i++) { l[i] = rnd() * 2 - 1; rr[i] = rnd() * 2 - 1; }
        return { events: [transport(0, 0, true)], input: [l, rr] };
      };
      let worst: { voices: number; mean: number; peak: number; stopped: string | null } | null = null;
      for (const voices of instrument ? LOAD_VOICES : [0]) {
        if (!instrument && !effect) return;
        const s = scenario(voices);
        const r = rig.run(s.events, seconds, { input: s.input });
        const steady = r.fuel.slice(8);
        const mean = steady.length ? steady.reduce((a, b) => a + b, 0) / steady.length : Math.max(0, ...r.fuel);
        const peak = Math.max(0, ...r.fuel);
        report.load.push({ voices, mean, peak, us: r.fuel.length ? (r.ms * 1000) / r.fuel.length : 0 });
        const row = { voices, mean, peak, stopped: r.error ? `${r.error.phase}: ${r.error.message}`.slice(0, 200) : null };
        if (!worst || row.stopped || mean > worst.mean) worst = row;
        if (r.error || mean >= HEAVY_STOP || late()) break;
      }
      if (!worst) return;
      const serious = !!worst.stopped || worst.mean >= HEAVY_STOP;
      if (!serious && worst.mean < HEAVY_WARN && worst.peak < HEAVY_STOP) return;
      const f: AddFinding = {
        check: 'light', rule: 'EST-C037', code: serious ? 'too-heavy' : 'heavy', severity: serious ? 'serious' : 'warning',
        numbers: { voices: worst.voices, mean: worst.mean, peak: worst.peak, one: report.load[0]?.mean ?? worst.mean },
        ...(worst.stopped ? { detail: worst.stopped } : {}),
      };
      find(f);
      // Where the fuel goes: the profiling build on the same notes, its counters read from the instance.
      if (!input.profiled || late()) return;
      try {
        const prof = await input.profiled();
        if (!prof) return;
        let made: WebAssembly.Instance | null = null;
        const s = scenario(worst.voices);
        const read = () => prof.profile.functions.map((fn, k) => {
          const g = made?.exports[profileFuelExport(k)] as WebAssembly.Global | undefined;
          const c = made?.exports[profileCallsExport(k)] as WebAssembly.Global | undefined;
          return { ...fn, fuel: g ? Number(g.value) : 0, calls: c ? Number(c.value) : 0 };
        });
        // Counters before the notes' blocks (set-up) are taken off: only what the blocks spent.
        let before: ReturnType<typeof read> | null = null;
        rig.run(s.events, (32 * F) / SR, { input: s.input, module: prof.module, instance: (i) => { made = i; before = read(); } });
        const after = read();
        const rows = after.map((a, k) => ({ name: a.name, index: a.index, fuel: a.fuel - (before?.[k]?.fuel ?? 0) })).filter(x => x.fuel > 0);
        const total = rows.reduce((a, b) => a + b.fuel, 0);
        if (total > 0) f.functions = rows.sort((a, b) => b.fuel - a.fuel).slice(0, 3).map(x => ({ name: x.name, index: x.index, share: x.fuel / total }));
      } catch { /* the finding stands without names */ }
    },

    // --- 5. Do the controls do anything? ----------------------------------------------------------
    controls() {
      if (!instrument && !effect) return;
      const seconds = 1.2;
      const input = instrument ? undefined : loopOf(seconds);
      const phrase: Ev[] = [transport(0, 0, true)];
      // Two overlapping notes at different velocities (glide, voices, velocity), a release, a low note, a held high one.
      if (instrument) phrase.push(on(0.01, 60, 1, 0.9), off(0.22, 60, 1), on(0.12, 67, 2, 0.5), off(0.3, 67, 2), on(0.3, 36, 3, 1), off(0.38, 36, 3), on(0.45, 76, 4, 0.7), off(0.9, 76, 4));
      // A kit's drums each have their own key and their own controls, and an analyser's controls are its display's:
      // neither is judged by whether a control changes this phrase's sound.
      const judged = !m.features.some(f => KEYED.includes(f) || f === 'analyzer');
      const play = (set: Ev[]) => rig.run([...set, ...phrase], seconds, { input });
      const ref = play([]);
      if (stopped('controls', ref)) return;
      const all = rig.params.filter(usable);
      // A plugin that makes no sound has no controls to judge: the sound check said so.
      const mute = peakOf(ref) < SILENT;
      const broken = (r: Run) => (r.error ? 'stops' : r.nonFinite > 0 ? 'not-finite' : null);
      const rnd = seeded(`${m.id}:controls`);
      const limit = opts.controls ?? CONTROLS_MAX;
      if (all.length <= limit && !mute && judged) {
        const suspects: EstParam[] = [];
        let walked = 0;
        for (const p of all) {
          if (late()) break;
          walked++;
          let changed = false;
          for (const v of [p.min, p.max]) {
            if (v === p.def) continue;
            const r = play([param(0, p.id, v)]);
            if (r.error || diffOf(r, ref) > SAME) changed = true;
          }
          if (!changed) suspects.push(p);
        }
        // A control that needs another to matter (a depth at 0, a mode switched off): tried again with every
        // other parameter at seeded random values, its own at each end.
        const dead: EstParam[] = [];
        for (const p of suspects) {
          if (late()) { walked = -1; break; }
          let alive = false;
          for (let k = 0; k < CONTROLS_RETRIES && !alive; k++) {
            const others = all.filter(q => q.id !== p.id).map(q => param(0, q.id, along(q, rnd())));
            const a = play([...others, param(0, p.id, p.min)]);
            const b = play([...others, param(0, p.id, p.max)]);
            if (a.error || b.error || diffOf(a, b) > SAME) alive = true;
          }
          if (!alive) dead.push(p);
        }
        const everyDead = walked === all.length && dead.length === all.length;
        // An analyser passes its sound through on purpose.
        const nothing = effect && transparent && everyDead && !m.features.includes('analyzer');
        if (nothing) find({ check: 'sound', rule: 'EST-C031', code: 'does-nothing', severity: 'warning', numbers: { params: all.length } });
        else if (dead.length && !everyDead) find({ check: 'controls', rule: 'EST-C038', code: 'dead-controls', severity: 'note', numbers: { dead: dead.length, of: all.length }, names: dead.map(p => p.name) });
      } else if (effect && transparent && all.length === 0 && !m.features.includes('analyzer')) {
        find({ check: 'sound', rule: 'EST-C031', code: 'does-nothing', severity: 'warning', numbers: { params: 0 } });
      }
      // The corners: every parameter at its maximum, at its minimum, and two seeded mixes of ends. The
      // conformance run moves one parameter at a time; a person turns several.
      if (all.length > 1 && !broken(ref)) {
        const corners: ((p: EstParam) => number)[] = [p => p.max, p => p.min, p => (rnd() < 0.5 ? p.min : p.max), p => (rnd() < 0.5 ? p.min : p.max)];
        for (const corner of corners) {
          if (late()) break;
          const values = all.map(p => ({ p, v: corner(p) }));
          const r = play(values.map(x => param(0, x.p.id, x.v)));
          const why = broken(r);
          if (!why) continue;
          // Which parameters it takes: each put back to its default in turn; the ones whose return mends it.
          const needed: typeof values = [];
          for (const x of values.slice(0, 32)) {
            if (late()) break;
            const without = play(values.filter(y => y !== x).map(y => param(0, y.p.id, y.v)));
            if (!broken(without)) needed.push(x);
          }
          const shown = (needed.length ? needed : values).slice(0, 8);
          find({ check: 'controls', rule: 'EST-C039', code: 'extreme-combo', severity: 'warning', numbers: { samples: r.nonFinite, kind: why === 'stops' ? 0 : 1, params: all.length, named: needed.length }, names: shown.map(x => `${x.p.name} = ${Number(x.v.toPrecision(4))}`), ...(r.error ? { detail: `${r.error.phase}: ${r.error.message}`.slice(0, 200) } : {}) });
          break;
        }
      }
      // The window's own names for the parameters (a lexical look at its files).
      const missing = windowParamRefs(m.ui?.path ?? null, inputFiles(), rig.params.map(p => p.id));
      if (missing.length) find({ check: 'controls', rule: 'EST-U006', code: 'window-params', severity: 'warning', numbers: { missing: missing.length }, names: missing.slice(0, 12).map(x => `${x.id} (${x.where})`) });
    },

    // --- 6. Rate and determinism, the cheap versions ----------------------------------------------
    async rate() {
      const rates = [48000, 44100] as const;
      if (instrument) {
        const got = rates.map((sr) => {
          const r = rig.run([transport(0, 0, false), on(0.01, 69, 1, 0.9), off(0.35, 69, 1)], 1.2, { sr });
          if (r.error) return null;
          const mono = new Float32Array(r.frames);
          for (let i = 0; i < r.frames; i++) mono[i] = (r.L[i]! + r.R[i]!) / 2;
          const period = periodOf(mono, Math.round(0.1 * sr), Math.round(0.3 * sr), sr);
          // The release: from the note-off to the last sample within 40 dB of the held level (null: it had not fallen by the end).
          const held = peakOf(r, Math.round(0.2 * sr), Math.round(0.35 * sr));
          const offAt = Math.round(0.35 * sr);
          let last = -1;
          for (let i = r.frames - 1; i >= offAt; i--) if (Math.max(Math.abs(r.L[i]!), Math.abs(r.R[i]!)) >= 0.01 * held) { last = i; break; }
          const fall = last >= 0 && last < r.frames - Math.round(0.05 * sr) ? (last - offAt) / sr : null;
          return { period, fall, held };
        });
        const [a, b] = got;
        if (!a || !b) return;
        const near = (x: number, y: number, tol: number) => Math.abs(x / y - 1) < tol;
        if (a.period && b.period && near(b.period / a.period, RATE_RATIO, 0.01)) {
          find({ check: 'rate', rule: 'EST-C040', code: 'rate-pitch', severity: 'warning', numbers: { hz48: 1 / a.period, hz441: 1 / b.period } });
        } else if (a.fall && b.fall && a.fall >= 0.2 && a.held > SILENT && near(b.fall / a.fall, RATE_RATIO, 0.01)) {
          find({ check: 'rate', rule: 'EST-C040', code: 'rate-time', severity: 'warning', numbers: { s48: a.fall, s441: b.fall } });
        }
      } else if (effect) {
        // A click in: the strongest thing that comes back later than 2 ms after it, in frames, at both rates.
        const got = rates.map((sr) => {
          const n = Math.round(0.6 * sr);
          const l = new Float32Array(n), rr = new Float32Array(n);
          const at = Math.round(0.02 * sr);
          l[at] = 1; rr[at] = 1;
          const r = rig.run([transport(0, 0, false)], 0.6, { sr, input: [l, rr] });
          if (r.error) return null;
          let best = 0, lag = -1;
          for (let i = at + Math.round(0.002 * sr); i < r.frames; i++) {
            const v = Math.max(Math.abs(r.L[i]!), Math.abs(r.R[i]!));
            if (v > best) { best = v; lag = i - at; }
          }
          return { lag, best };
        });
        const [a, b] = got;
        if (a && b && a.best >= 0.05 && b.best >= 0.05 && a.lag >= 96 && Math.abs(a.lag - b.lag) <= 1) {
          find({ check: 'rate', rule: 'EST-C040', code: 'rate-delay', severity: 'warning', numbers: { frames: a.lag, s48: a.lag / 48000, s441: b.lag / 44100 } });
        }
      } else return;
      if (opts.subnormals === false || late()) return;
      // The subnormal count (EST-C027's, at the defaults): notes or the loop, then silence, on a copy with every
      // float store counted (many times slower). It is asked once a second of audio whether the budget is spent,
      // and ends there, said as cut short rather than guessed.
      if (!input.counted) return;
      const copy = await input.counted();
      if (!copy) return;
      if (late()) { report.cut = true; return; }
      const { signal, silence, judged } = SUBNORMAL_RUN;
      const events: Ev[] = [transport(0, 0, false)];
      if (instrument) [36, 48, 60, 72].forEach((k, i) => events.push(on(0, k, i + 1, 0.9), off(signal, k, i + 1)));
      const count = (module: WebAssembly.Module): { counts: number[]; run: Run } => {
        let global: WebAssembly.Global | null = null;
        let last = 0;
        const counts: number[] = [];
        const run = rig.run(events, signal + silence, {
          input: instrument ? undefined : loopOf(signal), module,
          instance: (i) => { global = (i.exports[copy.counter] as WebAssembly.Global | undefined) ?? null; },
          second: () => { const now = global ? Number(global.value) : 0; counts.push(now - last); last = now; return late(); },
        });
        return { counts, run };
      };
      let got = count(copy.metered ?? copy.plain);
      if (got.run.error && copy.metered && !late()) got = count(copy.plain);
      if (got.run.stoppedEarly) { report.cut = true; return; }
      if (got.run.error || got.counts.length < signal + silence) return;
      const worst = Math.max(0, ...got.counts.slice(-judged));
      if (worst > SUBNORMAL_STUCK) find({ check: 'rate', rule: 'EST-C027', code: 'subnormal', severity: 'warning', numbers: { stores: worst } });
    },
  };
  const inputFiles = () => input.bundle.files ?? new Map<string, Uint8Array>();

  for (const id of ADD_CHECK_IDS) {
    if (opts.only && !opts.only.includes(id)) continue;
    if (kind === 'other') { report.checks.push({ id, status: 'not-checked', why: 'kind' }); continue; }
    if (late()) { report.checks.push({ id, status: 'not-checked', why: 'time' }); report.cut = true; continue; }
    const t0 = now();
    try {
      await checks[id]();
    } catch {
      report.checks.push({ id, status: 'not-checked', why: 'error' });
      continue;
    }
    report.checks.push({ id, status: 'clean', ms: Math.round(now() - t0) });
  }
  for (const c of report.checks) if (c.status === 'clean' && report.findings.some(f => f.check === c.id)) c.status = 'findings';
  if (late()) report.cut = report.cut || report.checks.some(c => c.why === 'time');
  report.ms = now() - started;
  return report;
}

/** The findings shown before a person plays. */
export const seriousOf = (r: Pick<AddCheckReport, 'findings'>): AddFinding[] => r.findings.filter(f => f.severity === 'serious');
