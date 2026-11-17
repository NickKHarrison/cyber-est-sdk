/**
 * 1.652: **the behaviour checks**, EST-C024 to EST-C030. The two code reviews of the first-party
 * catalogue (docs/releases/1.647.md and the n572 reviews) found the same seven bug classes again and
 * again; each is now a check `est validate`, `est test`, the store's automatic review and signing day
 * run on every bundle, played on the `est-plugin` processor's own code (`standInInstance`, the metered
 * module, as at install):
 *
 * - **EST-C024** (instruments): a flood of overlapping notes, retriggers of one key and a choke pair
 *   (GM hats 46 then 42), then every key up: each note-on gets exactly one NOTE_END and the sound ends
 *   (against a run with no notes) within the reported tail.
 * - **EST-C025** (instruments): 64 held notes, then notes that must steal, each released twice inside
 *   the steal's fade (0.2 to 2.5 ms after its note-on): the same accounting.
 * - **EST-C026** (pattern plugins with a parameter named Swing): Swing raised from its minimum to its
 *   maximum at beat k + 0.3, against Swing kept at its minimum: in the 0.07 beat after the change (no straight
 *   or swung step due there) nothing new sounds, where a replayed step would.
 * - **EST-C027** (every kind): notes held, then released (an effect: the test loop, then zeros), then
 *   10 s of silence: the module's stores of subnormal floats (1.437's counter, `denormals.ts`) while held
 *   and in the silence's last 5 s.
 * - **EST-C028** (every kind): notes (an effect: the test loop) then nothing, with no transport and with
 *   the transport stopped at 60 BPM (a tempo-synced echo is longest there): once the tail the plugin
 *   reports has passed, its output is 60 dB under its loudest (or under 2× a run with nothing played).
 * - **EST-C029** (pattern plugins): a render started at bar 3 (beat 8) against a render from bar 1, from
 *   2 s after bar 3 (anything hit before it rung out): within 1 % RMS.
 * - **EST-C030** (pattern plugins): a forward jump of 32 beats: the energy just after it is no more than
 *   twice that of a start at the jump's target plus the ring-out of what played before.
 *
 * Each runs at the plugin's defaults and on its first `presets` bundle presets (`BEHAVIOUR_PRESETS`;
 * `'all'` for the catalogue's signing day), and reports the first state that fails. A **pattern plugin**
 * is one whose features include `sequencer`, `drum-machine` or `arpeggiator`, or one with a parameter
 * named Swing (`behaviourShape`). Nothing here refuses an install: they are the validator's
 * (`install: false` in rules.ts), the store's review signals and signing day's. Pure apart from
 * WebAssembly and Binaryen (the subnormal counter).
 */
import type { EstParam } from '../EstNode';
import type { EstBundle } from '../install/bundle';
import { standInInstance } from '../install/conformance';
import { meter } from '../install/estMeter';
import { fillLoop } from '../testLoop';
import { countDenormals, DENORMAL_COUNTER } from './denormals';

export const BEHAVIOUR_RULES = ['EST-C024', 'EST-C025', 'EST-C026', 'EST-C027', 'EST-C028', 'EST-C029', 'EST-C030'] as const;
export type BehaviourRule = typeof BEHAVIOUR_RULES[number];

/** The presets each check plays besides the defaults (the first ones), unless asked for more. */
export const BEHAVIOUR_PRESETS = 3;
const SR = 48000;
const F = 128;
/** Subnormal stores in one second that count as a stuck state (one stuck at the block rate is 375 a second). */
export const SUBNORMAL_STUCK = 100;
/** The longest tail EST-C024/C025 wait for, and the longest EST-C028 checks (seconds). */
export const SETTLE_MAX_S = 20;
export const TAIL_MAX_S = 30;
/** EST-C028: after the tail, under the loudest by 60 dB, or this absolute floor (−80 dBFS). */
export const TAIL_REL = 1e-3;
export const QUIET = 1e-4;
/** EST-C029: the largest RMS difference, as a share of the full render's RMS. */
export const FROM_BAR_RMS = 0.01;
/** EST-C029: the longest it waits after beat 8 for what played before to ring out (seconds). */
export const FROM_BAR_SKIP_MAX = 8;
/** EST-C030: the most the energy after a jump may be over a start there plus the ring-out. */
export const JUMP_ENERGY = 2;
/** EST-C026: where Swing is raised (beats), and the window after it in which nothing new may sound. */
export const SWING_AT = [0.3, 1.3, 2.3, 3.3];
export const SWING_WINDOW_BEATS = 0.07;
/** EST-C026: the difference's energy over the window, as a share of the run's own there, that fails. */
export const SWING_NEW = 0.1;

export type BehaviourStatus = 'pass' | 'fail' | 'skip';
export interface BehaviourFinding { rule: BehaviourRule; status: BehaviourStatus; message: string; where?: string }

export interface BehaviourInput {
  bundle: Pick<EstBundle, 'manifest' | 'module' | 'presets'>;
  /** The metered module (the install's), compiled. */
  module: WebAssembly.Module;
  shim: WebAssembly.Module;
}
export interface BehaviourOptions {
  /** How many bundle presets to play besides the defaults (default `BEHAVIOUR_PRESETS`). */
  presets?: number | 'all';
  /** Only these checks (the tests). */
  only?: readonly BehaviourRule[];
}

export interface BehaviourShape { instrument: boolean; pattern: boolean; swing: EstParam | null }

const PATTERN_FEATURES = ['sequencer', 'drum-machine', 'arpeggiator'];
/** Which checks apply: instruments, pattern plugins (and which parameter is Swing). */
export function behaviourShape(manifest: { kind: string; features: string[] }, params: EstParam[]): BehaviourShape {
  const swing = params.find(p => /\bswing\b/i.test(p.name) && p.max > p.min) ?? null;
  return { instrument: manifest.kind === 'instrument', pattern: !!swing || manifest.features.some(f => PATTERN_FEATURES.includes(f)), swing };
}

type Ev = Record<string, unknown> & { type: string; time: number };
const on = (time: number, key: number, noteId: number, velocity = 0.8): Ev => ({ type: 'noteOn', time, key, velocity, noteId, channel: 0, port: 0 });
const off = (time: number, key: number, noteId: number): Ev => ({ type: 'noteOff', time, key, velocity: 0, noteId, channel: 0, port: 0 });
const transport = (time: number, beat: number, playing: boolean, tempo = 120): Ev => ({ type: 'transport', time, playing, tempo, beat, num: 4, den: 4 });
const param = (time: number, id: number, value: number): Ev => ({ type: 'param', time, id, value });

/** A state: the defaults (null) or a preset's bytes, and its words. */
interface State { bytes: Uint8Array | null; label: string }

interface Run { L: Float32Array; R: Float32Array; noteEnds: number; tails: number[]; error: string | null; counts: number[] | null }
/** `count`: the subnormal counter's copy, metered as installed (`'plain'`: unmetered, for a copy whose every store-as-a-call spends the fuel). */
interface RunOpts { input?: [Float32Array, Float32Array]; inputFrom?: number; tailAt?: number[]; count?: boolean | 'plain' }

class Player {
  private counted: WebAssembly.Module | null = null;
  private countedPlain: WebAssembly.Module | null = null;
  params: EstParam[] = [];
  constructor(private input: BehaviourInput) {}

  private start(module: WebAssembly.Module, catchInstance: boolean) {
    const Real = WebAssembly.Instance;
    let instance: WebAssembly.Instance | null = null;
    if (catchInstance) {
      WebAssembly.Instance = function (m: WebAssembly.Module, imports?: WebAssembly.Imports) {
        const made = new Real(m, imports);
        if (m === module) instance = made;
        return made;
      } as unknown as typeof WebAssembly.Instance;
    }
    try {
      const inst = standInInstance({ module, shim: this.input.shim, manifest: this.input.bundle.manifest }, SR, { queueSize: 8192 });
      return { inst, instance: instance as WebAssembly.Instance | null };
    } finally {
      WebAssembly.Instance = Real;
    }
  }

  /** One run: a fresh instance, the state, the events, `seconds` of blocks. */
  run(state: State, events: Ev[], seconds: number, opts: RunOpts = {}): Run {
    const frames = Math.ceil((seconds * SR) / F) * F;
    const L = new Float32Array(frames), R = new Float32Array(frames);
    const tails: number[] = [];
    let module = this.input.module;
    if (opts.count) module = opts.count === 'plain' ? this.plainCounted() : this.meteredCounted();
    let { inst, instance } = this.start(module, !!opts.count);
    // A counted copy (every load and store a call) may run past the call budget at set-up: counted unmetered then, as 1.437's test counts.
    if (!inst.boot.some(b => b.type === 'ready')) {
      inst.send({ type: 'dispose' });
      if (!opts.count || opts.count === 'plain') return { L, R, noteEnds: 0, tails, error: 'it did not start', counts: null };
      module = this.plainCounted();
      ({ inst, instance } = this.start(module, true));
      if (!inst.boot.some(b => b.type === 'ready')) { inst.send({ type: 'dispose' }); return { L, R, noteEnds: 0, tails, error: 'it did not start', counts: null }; }
    }
    if (!this.params.length) this.params = ((inst.boot.find(b => b.type === 'ready')?.params as EstParam[] | undefined) ?? []);
    if (state.bytes) {
      const back = inst.ask({ type: 'state:set', bytes: state.bytes.slice().buffer });
      if (!back || back.ok !== true) { inst.send({ type: 'dispose' }); return { L, R, noteEnds: 0, tails, error: 'it refused the preset', counts: null }; }
    }
    if (events.length) inst.send({ type: 'events', events: [...events].sort((a, b) => a.time - b.time) });
    const counter = opts.count && instance ? (instance.exports[DENORMAL_COUNTER] as WebAssembly.Global) : null;
    const counts: number[] = [];
    let lastCount = 0;
    const zero = new Float32Array(F);
    const tailAt = new Set(opts.tailAt ?? []);
    const proc = inst.proc as unknown as { tail(): number; noteEnds?: number; dead?: boolean };
    let error: string | null = null;
    const inFrom = opts.inputFrom ?? 0;
    for (let at = 0; at < frames; at += F) {
      let inL: Float32Array = zero, inR: Float32Array = zero;
      if (opts.input) {
        const s = at + inFrom;
        if (s + F <= opts.input[0].length) { inL = opts.input[0].subarray(s, s + F); inR = opts.input[1].subarray(s, s + F); }
      }
      const { out, posted } = inst.block(inL, inR, at);
      const err = posted.find(m => m.type === 'error');
      if (err || proc.dead) { error = err ? `${String(err.phase)}: ${String(err.message)}` : 'it stopped'; break; }
      L.set(out[0], at);
      R.set(out[1], at);
      if (tailAt.has(at)) tails.push(proc.tail());
      if (counter && (at + F) % SR === 0) { const now = counter.value as number; counts.push(now - lastCount); lastCount = now; }
    }
    const noteEnds = proc.noteEnds ?? 0;
    inst.send({ type: 'dispose' });
    return { L, R, noteEnds, tails, error, counts: counter ? counts : null };
  }

  private countedBytes: Uint8Array | null = null;
  /** The counted copy's bytes: coalesced when V8 cannot compile it as the pass leaves it (too many locals). */
  private countedOf(): Uint8Array {
    if (this.countedBytes) return this.countedBytes;
    let bytes = countDenormals(this.input.bundle.module);
    try { new WebAssembly.Module(bytes as BufferSource); } catch { bytes = countDenormals(this.input.bundle.module, { coalesce: true }); }
    this.countedBytes = bytes;
    return bytes;
  }
  private meteredCounted(): WebAssembly.Module {
    this.countedOf();
    try { this.counted ??= new WebAssembly.Module(meter(this.countedBytes!, { mode: 'local' }).bytes as BufferSource); } catch { return this.plainCounted(); }
    return this.counted;
  }
  /** The counted copy without the meter (for a module whose counted copy spends the fuel). */
  private plainCounted(): WebAssembly.Module {
    this.countedOf();
    this.countedPlain ??= new WebAssembly.Module(this.countedBytes! as BufferSource);
    return this.countedPlain;
  }
}

const peakOf = (a: Float32Array, b: Float32Array, from = 0, to = a.length) => {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(to, a.length); i++) { const v = Math.max(Math.abs(a[i]!), Math.abs(b[i]!)); if (v > m) m = v; }
  return m;
};
const energyOf = (a: Float32Array, b: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(to, a.length); i++) e += a[i]! * a[i]! + b[i]! * b[i]!;
  return e;
};
const sec = (s: number) => Math.round(s * SR);
const db = (x: number) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : 'silence');

const settleOf = (tailFrames: number) => (tailFrames === 0xffffffff ? SETTLE_MAX_S : Math.min(SETTLE_MAX_S, tailFrames / SR)) + 1;

/** EST-C024's notes: overlapping notes, one key retriggered, a burst, the GM hats; every key up by `UP`. */
const FLOOD_UP = 2;
function floodEvents(): { events: Ev[]; notes: number } {
  const events: Ev[] = [];
  let id = 1;
  const note = (t: number, key: number, len: number, vel: number) => { const n = id++; events.push(on(t, key, n, vel), off(Math.min(FLOOD_UP, t + len), key, n)); };
  for (let k = 0; k < 50; k++) note(0.02 + k * 0.03, 36 + ((k * 7) % 61), 0.4, 0.3 + (k % 7) / 10);
  for (let k = 0; k < 10; k++) note(0.3 + k * 0.02, 60, 0.1, 0.9);
  for (let j = 0; j < 24; j++) note(0.5 + j * 0.0005, 40 + j * 2, 0.6, 0.8);
  note(1.6, 46, 0.3, 0.9);
  note(1.65, 42, 0.2, 0.9);
  return { events, notes: id - 1 };
}

/** EST-C025's notes: 64 held, then three that steal, each let go twice inside the fade. */
const STEAL_UP = 1;
function stealEvents(): { events: Ev[]; notes: number } {
  const events: Ev[] = [];
  let id = 1;
  const held: [number, number][] = [];
  for (let k = 0; k < 64; k++) { const n = id++; events.push(on(0.05 + k * 0.001, 32 + k, n, 0.7)); held.push([32 + k, n]); }
  const doubled: [number, number, number, number][] = [[0.5, 96, 0.0005, 0.0015], [0.6, 97, 0.001, 0.002], [0.7, 98, 0.0002, 0.0025]];
  for (const [t, key, a, b] of doubled) { const n = id++; events.push(on(t, key, n, 0.9), off(t + a, key, n), off(t + b, key, n)); }
  for (const [key, n] of held) events.push(off(STEAL_UP, key, n));
  return { events, notes: id - 1 };
}

/** The test loop, `seconds` long (an effect's signal). */
function loopOf(seconds: number): [Float32Array, Float32Array] {
  const l = new Float32Array(sec(seconds)), r = new Float32Array(sec(seconds));
  fillLoop(l, r, SR);
  return [l, r];
}

const CHORD = [48, 55, 60, 64];
const chordHeld = (until: number): Ev[] => CHORD.flatMap((k, i) => [on(0, k, 900 + i, 0.8), off(until, k, 900 + i)]);

/** Run the behaviour checks a bundle's kind admits; one finding per rule. Never throws for the plugin's faults. */
export function behaviourChecks(input: BehaviourInput, opts: BehaviourOptions = {}): BehaviourFinding[] {
  const player = new Player(input);
  const m = input.bundle.manifest;
  const want = opts.presets ?? BEHAVIOUR_PRESETS;
  const presets = input.bundle.presets.slice(0, want === 'all' ? undefined : want);
  const states: State[] = [{ bytes: null, label: 'at its defaults' }, ...presets.map(p => ({ bytes: p.bytes, label: `with its preset "${p.name}" (${p.path})` }))];
  // The parameters, from a first run.
  player.run(states[0]!, [], 0.01);
  const shape = behaviourShape(m, player.params);
  const only = (r: BehaviourRule) => !opts.only || opts.only.includes(r);
  const findings: BehaviourFinding[] = [];
  const each = (rule: BehaviourRule, applies: string | null, check: (s: State) => string | null) => {
    if (!only(rule)) { findings.push({ rule, status: 'skip', message: 'not asked for' }); return; }
    if (applies) { findings.push({ rule, status: 'skip', message: applies }); return; }
    for (const s of states) {
      let problem: string | null;
      try { problem = check(s); } catch (err) { problem = `the check could not run (${err instanceof Error ? err.message : String(err)})`; }
      if (problem) { findings.push({ rule, status: 'fail', message: `${s.label}: ${problem}`, where: s.bytes ? `preset:${presets[states.indexOf(s) - 1]!.path}` : 'phase:behaviour' }); return; }
    }
    findings.push({ rule, status: 'pass', message: '' });
  };
  const notInstrument = shape.instrument ? null : 'applies to instruments';
  const notPattern = shape.pattern ? null : 'applies to pattern plugins (features sequencer, drum-machine or arpeggiator, or a Swing parameter)';
  const effectIn = shape.instrument ? undefined : loopOf(4);

  /** The note accounting of C024 and C025: one NOTE_END a note, and the sound ended (against no notes). */
  const accounting = (s: State, plan: { events: Ev[]; notes: number }, up: number): string | null => {
    const probe = player.run(s, [], 0.01, { tailAt: [0] });
    const settle = settleOf(probe.tails[0] ?? 0);
    const seconds = up + settle;
    const r = player.run(s, plan.events, seconds);
    if (r.error) return `it stopped (${r.error})`;
    const base = player.run(s, [], seconds);
    const from = sec(seconds - 0.5);
    const loud = peakOf(r.L, r.R, from), basePeak = peakOf(base.L, base.R, from);
    const runPeak = peakOf(r.L, r.R);
    const parts: string[] = [];
    if (r.noteEnds !== plan.notes) parts.push(`${plan.notes} notes got ${r.noteEnds} NOTE_ENDs (${r.noteEnds < plan.notes ? 'a note never ended, or its NOTE_END was never sent' : 'a note ended more than once'})`);
    const tailCapped = (probe.tails[0] ?? 0) === 0xffffffff || (probe.tails[0] ?? 0) / SR > SETTLE_MAX_S;
    if (!tailCapped && loud > Math.max(2 * basePeak, TAIL_REL * runPeak, QUIET)) parts.push(`it still sounded at ${db(loud)} ${settle.toFixed(1)} s after every key was up (with no notes: ${db(basePeak)})`);
    return parts.length ? parts.join('; ') : null;
  };

  each('EST-C024', notInstrument, s => accounting(s, floodEvents(), FLOOD_UP));
  each('EST-C025', notInstrument, s => accounting(s, stealEvents(), STEAL_UP));

  // C026: Swing raised part-way into a beat, against Swing kept at its minimum: the two runs are the same up to
  // the change, and just after it (beat k + 0.3, before any straight or swung step is due on a grid of eighths,
  // sixteenths or thirty-seconds) nothing new may sound.
  each('EST-C026', shape.pattern ? (shape.swing ? null : 'the plugin has no parameter named Swing') : notPattern, s => {
    const sw = shape.swing!;
    for (const withChord of [false, true]) {
      let heard = false;
      for (const beatAt of SWING_AT) {
        const seconds = (beatAt + 0.5) * 0.5;
        const extra = withChord ? chordHeld(seconds) : [];
        const a = player.run(s, [param(0, sw.id, sw.min), transport(0, 0, true), param(beatAt * 0.5, sw.id, sw.max), ...extra], seconds, { input: effectIn });
        const c = player.run(s, [param(0, sw.id, sw.min), transport(0, 0, true), ...extra], seconds, { input: effectIn });
        if (a.error || c.error) return `it stopped (${a.error ?? c.error})`;
        if (peakOf(c.L, c.R) < QUIET) continue;
        heard = true;
        const at = sec(beatAt * 0.5), to = at + sec(SWING_WINDOW_BEATS * 0.5);
        const d = new Float32Array(to - at), dR = new Float32Array(to - at);
        for (let i = at; i < to; i++) { d[i - at] = a.L[i]! - c.L[i]!; dR[i - at] = a.R[i]! - c.R[i]!; }
        const ed = energyOf(d, dR, 0, d.length), ec = energyOf(c.L, c.R, at, to);
        if (ed > Math.max(SWING_NEW * ec, 1e-7 * d.length)) {
          return `Swing raised from ${sw.min} to ${sw.max} at beat ${beatAt} sounded something new at once (${(10 * Math.log10(ed / Math.max(ec, 1e-12))).toFixed(1)} dB against the run with Swing kept), where no step was due: a step played again${withChord ? ' (keys held)' : ''}`;
        }
      }
      if (heard) return null;
    }
    return null;
  });

  // C027: subnormal stores while held and in the silence after.
  each('EST-C027', null, s => {
    const events: Ev[] = [transport(0, 0, false)];
    let input: [Float32Array, Float32Array] | undefined;
    let held: [number, number] | null = null;
    if (shape.instrument) {
      [36, 48, 55, 60, 64, 72].forEach((k, i) => events.push(on(0, k, i + 1, 0.9), off(3, k, i + 1)));
      for (let k = 0; k < 5; k++) events.push(on(3 + k * 0.1, 60 + k * 3, 20 + k, 0.8), off(3.05 + k * 0.1, 60 + k * 3, 20 + k));
      held = [1, 3];
    } else input = loopOf(3.6);
    const seconds = 14;
    let r = player.run(s, events, seconds, { count: true, input });
    // The counted copy may spend a block's fuel where the installed module does not (1.634): counted unmetered then.
    if (r.error) r = player.run(s, events, seconds, { count: 'plain', input });
    if (r.error) return `it stopped (${r.error})`;
    const counts = r.counts ?? [];
    if (held) {
      const worst = Math.max(...counts.slice(held[0], held[1]));
      if (worst > SUBNORMAL_STUCK) return `${worst} subnormal stores in a second while notes were held (a state stuck in the subnormal range: flush values below 1e-20 to 0)`;
    }
    const last = counts.slice(-5);
    const worst = Math.max(0, ...last);
    if (worst > SUBNORMAL_STUCK) return `${worst} subnormal stores a second in the last 5 s of 10 s of silence (a state stuck in the subnormal range: flush values below 1e-20 to 0)`;
    return null;
  });

  // C028: once the reported tail has passed, the output is 60 dB under its loudest.
  each('EST-C028', null, s => {
    for (const tempo of [null, 60] as const) {
      const release = shape.instrument ? 1 : 2;
      const events: Ev[] = tempo ? [transport(0, 0, false, tempo)] : [];
      if (shape.instrument) [36, 48, 55, 60, 64, 67, 72].forEach((k, i) => events.push(on(0.01, k, i + 1, 1), off(release, k, i + 1)));
      const input = shape.instrument ? undefined : loopOf(release);
      const probe = player.run(s, events, release + 0.01, { input, tailAt: [Math.floor(sec(release) / F) * F] });
      if (probe.error) return `it stopped (${probe.error})`;
      const t0 = probe.tails[0] ?? 0;
      if (t0 === 0xffffffff) return null;
      if (t0 / SR > TAIL_MAX_S) continue;
      const seconds = release + t0 / SR + 1.5;
      const endAt = Math.floor(sec(seconds) / F) * F - F;
      const r = player.run(s, events, seconds, { input, tailAt: [endAt] });
      if (r.error) return `it stopped (${r.error})`;
      const tail = Math.max(t0, r.tails[0] ?? 0);
      if (tail === 0xffffffff || tail / SR > TAIL_MAX_S) continue;
      const from = sec(release) + tail + F + sec(0.02);
      if (from >= r.L.length - sec(0.25)) continue;
      const base = player.run(s, tempo ? [transport(0, 0, false, tempo)] : [], seconds);
      const loudest = peakOf(r.L, r.R);
      const after = peakOf(r.L, r.R, from), basePeak = peakOf(base.L, base.R, from);
      if (after > Math.max(TAIL_REL * loudest, QUIET, 2 * basePeak)) {
        return `it still sounded at ${db(after)} (its loudest ${db(loudest)}) after the ${(tail / SR).toFixed(2)} s tail it reports${tempo ? ` at ${tempo} BPM` : ''}: an export or a freeze cuts it there`;
      }
    }
    return null;
  });

  /** A pattern run's events: the transport (and, if `chord`, keys held) from `beat`. */
  const patternRun = (s: State, beat: number, seconds: number, chord: boolean, at = 0) => {
    const loop = shape.instrument ? undefined : loopOf(seconds + beat * 0.5 + 1);
    return player.run(s, [transport(at, beat, true), ...(chord ? chordHeld(seconds) : [])], seconds, { input: loop, inputFrom: sec(beat * 0.5) });
  };

  // C029: a render from bar 3 against the full render from there.
  each('EST-C029', notPattern, s => {
    // From 2 s after beat 8, or once what played before it has rung out by its reported tail (at most 8 s).
    const probe = player.run(s, [], 0.01, { tailAt: [0] });
    const t = probe.tails[0] ?? 0;
    const skip = Math.min(FROM_BAR_SKIP_MAX, Math.max(2, (t === 0xffffffff ? Infinity : t / SR) + 0.5));
    const span = 4;
    const a = patternRun(s, 0, 4 + skip + span, false);
    const b = patternRun(s, 8, skip + span, false);
    if (a.error || b.error) return `it stopped (${a.error ?? b.error})`;
    const off4 = sec(4), from = sec(4 + skip), to = sec(4 + skip + span);
    let diff = 0, ref = 0;
    for (let i = from; i < to; i++) {
      const dl = a.L[i]! - b.L[i - off4]!, dr = a.R[i]! - b.R[i - off4]!;
      diff += dl * dl + dr * dr;
      ref += a.L[i]! * a.L[i]! + a.R[i]! * a.R[i]!;
    }
    const rms = Math.sqrt(ref / (2 * (to - from)));
    if (rms < QUIET) return null;
    const rel = Math.sqrt(diff / ref);
    if (rel > FROM_BAR_RMS) return `a render started at beat 8 differs from the render from beat 0 by ${(rel * 100).toFixed(1)} % RMS, ${skip.toFixed(1)} s and more after beat 8: seed randomness and modulation from the song position, not from a count of notes or hits or the time since it started`;
    return null;
  });

  // C030: a forward jump of 32 beats does not fire every skipped step.
  each('EST-C030', notPattern, s => {
    for (const chord of [false, true]) {
      const loop = shape.instrument ? undefined : loopOf(25);
      const extra = chord ? chordHeld(3) : [];
      const j = player.run(s, [transport(0, 0, true), transport(2, 36, true), ...extra], 3, { input: loop });
      const k = player.run(s, [transport(0, 0, false), transport(2, 36, true), ...extra], 3, { input: loop });
      const l = player.run(s, [transport(0, 0, true), transport(2, 4, false), ...extra], 3, { input: loop });
      if (j.error || k.error || l.error) return `it stopped (${j.error ?? k.error ?? l.error})`;
      if (peakOf(k.L, k.R, sec(2)) < QUIET && peakOf(j.L, j.R, 0, sec(2)) < QUIET) continue;
      const from = sec(2), to = sec(2.1);
      const ej = energyOf(j.L, j.R, from, to), ek = energyOf(k.L, k.R, from, to), el = energyOf(l.L, l.R, from, to);
      if (ej > JUMP_ENERGY * (ek + el) + 1e-6) return `a jump from beat 4 to beat 36 gave ${(10 * Math.log10(ej / Math.max(ek + el, 1e-12))).toFixed(1)} dB more energy in the next 100 ms than a start at beat 36 with the ring-out of what played before: skipped steps fired at once`;
      return null;
    }
    return null;
  });

  return findings;
}
