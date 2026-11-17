/**
 * 1.653: the catalogue's DSP toolkit (est-plugins/catalogue-src/tools/dsp, AssemblyScript). Each piece
 * is held to the rule it exists for, on the scenarios of the code reviews that found it broken by hand
 * (docs/releases/1.647.md, review n572 area D: D-01 … D-24; docs/releases/1.651.md, review 2 area D:
 * D2-01 … D2-17). Both modules are built with asc (a dev dependency) at the start of the file:
 * - the probe (tools/dsp/test/probe), each block behind plain exports, driven sample by sample;
 * - the test instrument (tools/dsp/test/synth), sine voices on the allocator, envelope, declick and step
 *   clock, packed with its est.json, metered and run as Cyber's install runs it (`standInInstance`,
 *   the stand-in host's NOTE_END count, the store review's subnormal counter, the conformance run).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { standInInstance } from '../../src/audio/est/install/conformance';
import { countDenormals, DENORMAL_COUNTER } from '../../src/audio/est/review/denormals';
import { findAsc } from '../packages/tools/src/index';
import { estShim } from '../testing/golden';
import { conform, packed, repo, type Packed } from './helpers';

const DSP = 'est-plugins/catalogue-src/tools/dsp';
const SR = 48000;
const tmp = mkdtempSync(join(tmpdir(), 'est-dsp-toolkit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function build(dir: string, entry: string, out: string): Uint8Array {
  const asc = findAsc(repo(dir));
  expect(asc, 'asc (the assemblyscript dev dependency)').toBeTruthy();
  const r = spawnSync(asc!, [entry, '--config', 'asconfig.json', '--target', 'release', '--outFile', out], { cwd: repo(dir), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return new Uint8Array(readFileSync(out));
}

type Fn = (...a: number[]) => number;
let P: Record<string, Fn>;
let mem: WebAssembly.Memory;
let synthWasm: Uint8Array;
let synth: Packed;

beforeAll(async () => {
  const probe = build(`${DSP}/test/probe`, 'index.ts', join(tmp, 'probe.wasm'));
  const module = new WebAssembly.Module(probe as BufferSource);
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  const inst = new WebAssembly.Instance(module, {});
  P = inst.exports as unknown as Record<string, Fn>;
  mem = inst.exports.memory as WebAssembly.Memory;
  synthWasm = build(`${DSP}/test/synth`, 'assembly/index.ts', join(tmp, 'synth.wasm'));
  synth = await packed(`${DSP}/test/synth`, synthWasm);
}, 120_000);

/** The probe's output, `n` values. */
const outOf = (n: number) => new Float64Array(mem.buffer, P.output_ptr!(), n).slice();
const isSub = (x: number) => x !== 0 && Math.abs(x) < 2.2250738585072014e-308;
const db = (x: number) => 20 * Math.log10(Math.abs(x));
/** The largest isolated step: |x[i] − x[i−1]| less the steps either side (a click, not a waveform's slope). */
function clickStep(a: ArrayLike<number>, from: number, to: number): number {
  let m = 0;
  for (let i = from + 2; i < to - 1; i++) {
    const d = Math.abs(a[i]! - a[i - 1]!);
    const around = Math.max(Math.abs(a[i - 1]! - a[i - 2]!), Math.abs(a[i + 1]! - a[i]!));
    m = Math.max(m, d - around);
  }
  return m;
}

// --- The test instrument, rendered as installed -------------------------------------------------------

type Ev = Record<string, unknown> & { type: string; time: number };
const on = (time: number, key: number, noteId = key, velocity = 0.8): Ev => ({ type: 'noteOn', time, key, velocity, noteId, channel: 0, port: 0 });
const off = (time: number, key: number, noteId = key): Ev => ({ type: 'noteOff', time, key, velocity: 0, noteId, channel: 0, port: 0 });
const param = (time: number, id: number, value: number): Ev => ({ type: 'param', time, id, value });
const pedal = (time: number, down: boolean): Ev => ({ type: 'midi', time, data: [0xb0, 64, down ? 127 : 0] });
const transport = (time: number, beat: number, extra: Record<string, unknown> = {}): Ev => ({ type: 'transport', time, playing: true, tempo: 120, beat, num: 4, den: 4, ...extra });

const R = { active: 20, held: 21, keySum: 22, waiting: 23, fired: 24, inBar: 25, index: 26 } as const;
const FADE = 1, SUSTAIN = 2, RELEASE = 3, CLOCK = 4, SWING = 5, DECAY = 7;

interface Run { L: Float32Array; noteEnds: number; reads: { frame: number; id: number; value: number }[]; tail: number }

function render(events: Ev[], seconds: number, module = synth.module): Run {
  const inst = standInInstance({ module, shim: estShim(), manifest: synth.bundle.manifest }, SR, { queueSize: 4096 });
  expect(inst.boot.some(b => b.type === 'ready')).toBe(true);
  inst.send({ type: 'events', events });
  const frames = Math.round(seconds * SR);
  const L = new Float32Array(frames);
  const reads: Run['reads'] = [];
  const zero = new Float32Array(128);
  for (let at = 0; at < frames; at += 128) {
    const { out, posted } = inst.block(zero, zero, at);
    expect(posted.find(x => x.type === 'error')).toBeUndefined();
    L.set(out[0]!.subarray(0, Math.min(128, frames - at)), at);
    for (const m of posted) if (m.type === 'param') for (const c of (m as unknown as { changes: { id: number; value: number }[] }).changes) reads.push({ frame: at, id: c.id, value: c.value });
  }
  const noteEnds = (inst.proc as unknown as { noteEnds?: number }).noteEnds ?? 0;
  const tail = (inst.proc as unknown as { tail(): number }).tail();
  inst.send({ type: 'dispose' });
  return { L, noteEnds, reads, tail };
}
/** A readout's last value at or before `seconds`. */
function readAt(r: Run, id: number, seconds: number): number {
  let v = NaN;
  for (const x of r.reads) if (x.id === id && x.frame <= seconds * SR) v = x.value;
  return v;
}
const peak = (a: Float32Array, from: number, to: number) => { let m = 0; for (let i = Math.floor(from * SR); i < Math.min(a.length, to * SR); i++) m = Math.max(m, Math.abs(a[i]!)); return m; };

describe('the steal rules (pick on slots set by hand)', () => {
  const IDLE = 0, HELD = 1, PEDAL = 2, RELEASED = 3, STEAL = 4;
  const set = (which: number, slots: [number, number, number?, number?][]) => slots.forEach(([state, age, owned = 1, waiting = 0], s) => P.slotSet!(which, s, state, age, owned, waiting));

  it('1.666: the SDK rule (OldestVoiceAllocator) takes the oldest note whatever its state; the toolkit\'s takes a released one first', () => {
    const slots: [number, number][] = [[HELD, 1], [RELEASED, 3], [HELD, 2], [PEDAL, 4]];
    set(0, slots); set(1, slots);
    expect(P.slotPick!(0, 0)).toBe(1); // STEAL_OLDEST: released before held
    expect(P.slotPick!(1, 0)).toBe(0); // the SDK rule: the oldest, held or not
    set(1, [[RELEASED, 5], [PEDAL, 2], [HELD, 3], [HELD, 4]]);
    expect(P.slotPick!(1, 0)).toBe(1); // a pedal-held note as old as any
  });

  it('1.666: the SDK rule still takes an idle voice first, a choke\'s fade before any note, and a voice fading for a waiting note last', () => {
    set(1, [[HELD, 1], [HELD, 2], [IDLE, 9], [HELD, 3]]);
    expect(P.slotPick!(1, 0)).toBe(2);
    set(1, [[HELD, 1], [STEAL, 7, 0, 0], [HELD, 2], [HELD, 3]]);
    expect(P.slotPick!(1, 0)).toBe(1);
    set(1, [[STEAL, 1, 0, 1], [HELD, 4], [RELEASED, 2], [HELD, 3]]);
    expect(P.slotPick!(1, 0)).toBe(2);
    set(1, [[STEAL, 1, 0, 1], [STEAL, 2, 0, 1], [STEAL, 3, 0, 1], [STEAL, 4, 0, 1]]);
    expect(P.slotPick!(1, 0)).toBe(0);
  });

  it('1.666: with protectPlayed the SDK rule never takes a played note\'s held voice', () => {
    set(1, [[HELD, 1, 1], [HELD, 2, 0], [RELEASED, 3, 1], [HELD, 0, 1]]);
    expect(P.slotPick!(1, 1)).toBe(1);
    set(1, [[HELD, 1, 1], [HELD, 2, 1], [HELD, 3, 1], [HELD, 4, 1]]);
    expect(P.slotPick!(1, 1)).toBe(-1);
  });
});

describe('the voice allocator (on the test instrument, as installed)', () => {
  it('passes the install\'s conformance run (every note it starts ends, the tail kept)', () => {
    const r = conform(synth, 4);
    expect(r.problem).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.noteEnds).toBe(r.notesSent);
  });

  it('D-01: a note let go during the steal\'s fade starts released: 21 notes give 21 NOTE_ENDs, then silence', () => {
    const evs: Ev[] = [];
    for (let k = 0; k < 20; k++) evs.push(on(0.01 + k * 0.005, 60 + k, 100 + k));
    evs.push(on(0.5, 90, 200), off(0.5005, 90, 200));
    for (let k = 0; k < 20; k++) evs.push(off(1, 60 + k, 100 + k));
    const r = render(evs, 4);
    expect(peak(r.L, 0.6, 0.9)).toBeGreaterThan(0.01);
    expect(peak(r.L, 3, 4)).toBe(0);
    expect(r.noteEnds).toBe(21);
    expect(readAt(r, R.active, 4)).toBe(0);
  });

  it('D-18, D2-09: two note-offs inside the fade mark the waiting note released once (it does not flip back and hold)', () => {
    const evs: Ev[] = [];
    for (let k = 0; k < 16; k++) evs.push(on(0.01 + k * 0.005, 60 + k, 100 + k));
    evs.push(on(0.5, 90, 200), off(0.5005, 90, 200), off(0.501, 90, 200));
    const r = render(evs.concat(Array.from({ length: 16 }, (_, k) => off(2, 60 + k, 100 + k))), 4);
    // The waiting note started released: by 1.5 s only the fifteen held notes are held, and it has ended.
    expect(readAt(r, R.held, 1.5)).toBe(15);
    expect(readAt(r, R.active, 1.5)).toBe(15);
    expect(readAt(r, R.active, 4)).toBe(0);
    expect(r.noteEnds).toBe(17);
  });

  it('D2-14: sixteen held, then two together: the 18th never takes the 17th\'s voice, and the held count does not leak', () => {
    const evs: Ev[] = [];
    for (let k = 0; k < 16; k++) evs.push(on(0.01 + k * 0.005, 60 + k));
    evs.push(on(0.5, 90), on(0.5, 91));
    const r = render(evs.concat(Array.from({ length: 16 }, (_, k) => off(2, 60 + k)), [off(2, 90), off(2, 91)]), 4);
    let sum = 90 + 91;
    for (let k = 62; k <= 75; k++) sum += k; // the two oldest (60, 61) were taken
    expect(readAt(r, R.keySum, 1)).toBe(sum);
    expect(readAt(r, R.held, 1)).toBe(16);
    expect(readAt(r, R.waiting, 1)).toBe(0);
    expect(readAt(r, R.held, 3)).toBe(0);
    expect(r.noteEnds).toBe(18);
  });

  it('D-17: a closed hat chokes the open one in its group, and the open one gets its NOTE_END', () => {
    const r = render([on(0.1, 46), on(0.5, 42), off(0.6, 42), off(0.7, 46)], 3);
    expect(readAt(r, R.active, 0.55)).toBe(1);
    expect(readAt(r, R.keySum, 0.55)).toBe(42);
    expect(r.noteEnds).toBe(2);
    expect(peak(r.L, 2, 3)).toBe(0);
  });

  it('D2-04: the pedal holds a let-go note; stolen while held, it still gets its NOTE_END; let go, the rest release', () => {
    const evs: Ev[] = [pedal(0.01, true), on(0.05, 30), off(0.1, 30)];
    for (let k = 0; k < 16; k++) evs.push(on(0.5 + k * 0.005, 60 + k));
    for (let k = 0; k < 16; k++) evs.push(off(0.8, 60 + k));
    evs.push(pedal(1.5, false));
    const r = render(evs, 4);
    // Held by the pedal past its key-up, until a note needed its voice (the pedal-held voice is taken first).
    expect(peak(r.L, 0.3, 0.45)).toBeGreaterThan(0.01);
    expect(readAt(r, R.active, 1.2)).toBe(16);
    expect(readAt(r, R.held, 1.2)).toBe(0);
    expect(readAt(r, R.active, 4)).toBe(0);
    expect(r.noteEnds).toBe(17);
  });

  it('a host choke (any key) ends every note at once with its NOTE_END, a waiting one too', () => {
    const evs: Ev[] = [];
    for (let k = 0; k < 16; k++) evs.push(on(0.01 + k * 0.005, 60 + k, 100 + k));
    evs.push(on(0.5, 90, 200), { type: 'choke', time: 0.501, key: -1, noteId: -1, channel: -1, port: -1 });
    const r = render(evs, 1.5);
    expect(r.noteEnds).toBe(17);
    expect(peak(r.L, 0.6, 1.5)).toBe(0);
  });

  it('D-10: a stolen voice fades over the steal fade (and, with no fade, its last sample is carried): no click', () => {
    for (const fade of [3, 0]) {
      const evs: Ev[] = [param(0, FADE, fade)];
      for (let k = 0; k < 16; k++) evs.push(on(0.01 + k * 0.002, 48 + k, 100 + k));
      evs.push(on(0.4, 84, 200));
      const r = render(evs, 0.6);
      expect(clickStep(r.L, Math.round(0.39 * SR), Math.round(0.45 * SR)), `fade ${fade} ms`).toBeLessThan(0.01);
    }
  });

  it('D-13, D-14: decays to a Sustain of 0, held for seconds, make no subnormal store', async () => {
    const module = new WebAssembly.Module(countDenormals(synthWasm) as BufferSource);
    const Real = WebAssembly.Instance;
    let made: WebAssembly.Instance | null = null;
    WebAssembly.Instance = function (m: WebAssembly.Module, imports?: WebAssembly.Imports) {
      const x = new Real(m, imports);
      if (m === module) made = x;
      return x;
    } as unknown as typeof WebAssembly.Instance;
    let inst: ReturnType<typeof standInInstance>;
    try { inst = standInInstance({ module, shim: estShim(), manifest: synth.bundle.manifest }, SR, { queueSize: 4096 }); } finally { WebAssembly.Instance = Real; }
    const counter = (made as unknown as WebAssembly.Instance).exports[DENORMAL_COUNTER] as WebAssembly.Global;
    inst.send({ type: 'events', events: [param(0, SUSTAIN, 0), param(0, DECAY, 0.05), on(0.01, 36), on(0.02, 60), on(0.03, 96)] });
    const zero = new Float32Array(128);
    const counts: number[] = [];
    let last = 0;
    for (let s = 0; s < 6; s++) {
      for (let k = 0; k < 375; k++) inst.block(zero, zero, (s * 375 + k) * 128);
      counts.push((counter.value as number) - last);
      last = counter.value as number;
    }
    inst.send({ type: 'dispose' });
    expect(counts.slice(1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('the tail covers the release to the envelope\'s end level, then the fade (D2-15: counted, not guessed)', () => {
    const r = render([param(0, RELEASE, 3), on(0.01, 60), off(0.2, 60)], 5);
    // Release 3 s to −80 dB is 4 s, plus 3 ms of fade.
    expect(r.tail).toBe(Math.ceil((3 * 80 / 60 + 0.003) * SR));
    // The voice ended inside its tail.
    let lastSound = 0;
    for (let i = 0; i < r.L.length; i++) if (r.L[i] !== 0) lastSound = i;
    expect(lastSound - Math.round(0.2 * SR)).toBeLessThanOrEqual(r.tail);
    expect(r.noteEnds).toBe(1);
  });
});

describe('the step clock (on the test instrument, as installed)', () => {
  it('D-12: a 32-beat jump forward re-syncs: no burst of skipped steps', () => {
    const r = render([param(0, CLOCK, 1), transport(0, 0), transport(1, 32.1)], 1.2);
    const before = readAt(r, R.fired, 0.999);
    expect(before).toBe(8); // beats 0 … 1.75 at 120 BPM: steps 0 … 7
    // Within 3 ms of the jump at most the step it lands on (here none: 32.1 is not on a step).
    expect(readAt(r, R.fired, 1.003) - before).toBeLessThanOrEqual(1);
    // Then on by one step at a time from 32.25.
    expect(readAt(r, R.index, 1.2)).toBeGreaterThanOrEqual(129);
  });

  it('D2-07: after 4/4 → 3/4 the steps follow the host\'s bar start: bar 3 in 3/4 plays as bar 1 in 3/4', () => {
    const a = render([param(0, CLOCK, 1), transport(0, 0), transport(4, 8, { num: 3, barStart: 8 })], 6);
    const b = render([param(0, CLOCK, 1), transport(0, 0, { num: 3 })], 2);
    // The step in bar a sixteenth later each 0.125 s, from the meter change (a) and from the start (b).
    for (let k = 0; k < 14; k++) {
      const t = k * 0.125 + 0.06;
      expect(readAt(a, R.inBar, 4 + t), `step ${k}`).toBe(readAt(b, R.inBar, t));
    }
    expect(readAt(b, R.inBar, 1.5 + 0.06)).toBe(0); // 3/4: twelve sixteenths a bar
  });

  it('D-05, D2-11: Swing raised after an off step fires no step again', () => {
    const swung = render([param(0, CLOCK, 1), param(0, SWING, 100), transport(0, 0)], 1);
    const raised = render([param(0, CLOCK, 1), transport(0, 0), param(0.15, SWING, 100)], 1);
    expect(readAt(raised, R.fired, 1)).toBe(readAt(swung, R.fired, 1));
  });
});

// --- The probe ---------------------------------------------------------------------------------------

describe('envelopes and smoothers flush below 1e-20', () => {
  it('D-13, D-14: an ADSR decaying to a Sustain of 0 never holds a level under the floor, and reaches exactly 0', () => {
    const n = 10 * SR;
    expect(P.adsrHeld!(n, 0.001, 0.05, 0, SR, 0)).toBe(0);
    const o = outOf(n);
    expect(o.some(isSub)).toBe(false);
    expect(o[n - 1]).toBe(0);
  });

  it('a release set by its −60 dB time is 60 dB down at that time (D2-12: a time constant is not a −60 dB time)', () => {
    const idle = P.adsrRelease!(4 * SR, 10, 1.5, SR, 1e-4, 0, 100);
    const o = outOf(4 * SR);
    expect(db(o[100 + Math.round(1.5 * SR)]!)).toBeCloseTo(-60, 1);
    // Idle at its end level (−80 dB): 2 s after the release.
    expect(Math.abs(idle - (100 + 2 * SR))).toBeLessThanOrEqual(2);
    expect(P.tailT60!(1.5, 80)).toBeCloseTo(2, 12);
    // The same 1.5 s as a time constant: 13.8 s to −80 dB.
    expect(P.tailTau!(1.5, 80)).toBeCloseTo(13.82, 2);
    expect(P.coefT60!(1.5, SR)).toBeCloseTo(Math.exp(-Math.log(1000) / (1.5 * SR)), 15);
  });

  it('holds the attack through an early release (once: a second release changes nothing), then releases', () => {
    P.adsrRelease!(SR, 480, 0.2, SR, 1e-4, 1, 100);
    const o = outOf(SR);
    const top = o.indexOf(1);
    // The attack's 480 steps of 1/480 sum to 1 at the 480th or 481st sample (rounding), released after.
    expect(top).toBeGreaterThanOrEqual(479);
    expect(top).toBeLessThanOrEqual(480);
    for (let i = 1; i < top; i++) expect(o[i]!).toBeGreaterThan(o[i - 1]!);
    expect(o[top + 1]!).toBeLessThan(1);
    expect(o[top + 1]!).toBeGreaterThan(0.999);
  });

  it('an AR with no end level releases to exactly 0, never through subnormal numbers', () => {
    expect(P.arRun!(20 * SR, 0.01, 0.1, SR, SR)).toBe(0);
    const o = outOf(20 * SR);
    expect(o.some(isSub)).toBe(false);
    expect(o[20 * SR - 1]).toBe(0);
  });

  it('D2-08, D2-13: a glide sent to 0 reaches exactly 0 and never holds a subnormal', () => {
    expect(P.glideRun!(10 * SR, 1, 0, 0.02, SR)).toBe(0);
    const o = outOf(10 * SR);
    expect(o.some(isSub)).toBe(false);
    expect(o[10 * SR - 1]).toBe(0);
    expect(P.coefOnePole!(0.02, SR)).toBeCloseTo(1 - Math.exp(-1 / (0.02 * SR)), 15);
  });
});

describe('the filters\' states flush', () => {
  it('D-11, D2-05: a struck mode rings at its frequency, 60 dB down in its T60, then exactly 0 with no subnormal state', () => {
    const n = 20 * SR;
    expect(P.modeDecay!(n, 440, 0.5, SR)).toBe(0);
    const o = outOf(n);
    expect(o.some(isSub)).toBe(false);
    expect(o[n - 1]).toBe(0);
    let pk0 = 0, pk1 = 0;
    for (let i = 0; i < 480; i++) { pk0 = Math.max(pk0, Math.abs(o[i]!)); pk1 = Math.max(pk1, Math.abs(o[SR / 2 + i]!)); }
    expect(db(pk1 / pk0)).toBeCloseTo(-60, 0);
  });

  it('a biquad\'s impulse response dies to exactly 0 with no subnormal state, and its response is RBJ\'s', () => {
    for (const kind of [0, 1, 2, 3, 4, 5, 6]) {
      expect(P.biquadImpulse!(10 * SR, kind, 1000, 4, 6, SR), `kind ${kind}`).toBe(0);
      const o = outOf(10 * SR);
      expect(o.some(isSub)).toBe(false);
      expect(o[10 * SR - 1]).toBe(0);
    }
    expect(P.biquadResponse!(0, 1000, Math.SQRT1_2, 0, SR, 1000)).toBeCloseTo(-3.0103, 3);
    expect(P.biquadResponse!(4, 1000, 1, 6, SR, 1000)).toBeCloseTo(6, 6);
    // What it does to a sine is what it says.
    for (const at of [200, 1000, 4000]) {
      const want = P.biquadResponse!(0, 1000, 2, 0, SR, at);
      expect(db(P.biquadSine!(0, 1000, 2, 0, SR, at, SR))).toBeCloseTo(want, 1);
    }
  });

  it('a one-pole\'s state flushes', () => {
    expect(P.onePoleImpulse!(10 * SR, 50, SR)).toBe(0);
    expect(outOf(10 * SR)[10 * SR - 1]).toBe(0);
  });
});

describe('the step clock', () => {
  const FR = 120 / (60 * SR); // a frame at 120 BPM, in beats
  /** Run the probe's clock over `frames` frames from `beat0`; `at(i)` may change things first. Fired steps out. */
  function run(frames: number, beat0: number, at?: (i: number, beat: number) => { beat?: number; barStart?: number; num?: number } | void) {
    const fired: { i: number; index: number; inBar: number; bar: number }[] = [];
    // The beat as a host gives it: from the last position set, plus frames at the tempo (never summed).
    let base = beat0, from = 0, barStart = 0, num = 4;
    for (let i = 0; i < frames; i++) {
      const c = at?.(i, base + (i - from) * FR);
      if (c) { if (c.beat !== undefined) { base = c.beat; from = i; } if (c.barStart !== undefined) barStart = c.barStart; if (c.num !== undefined) num = c.num; }
      if (P.clockAdvance!(base + (i - from) * FR, FR, barStart, num, 4)) fired.push({ i, index: P.clockIndex!(), inBar: P.clockInBar!(), bar: P.clockBar!() });
    }
    return fired;
  }

  it('fires each step once, on its sample, from a start on the beat', () => {
    P.clockSet!(0.25, 0, 0);
    const f = run(2 * SR, 0);
    expect(f.map(x => x.index)).toEqual(Array.from({ length: 16 }, (_, k) => k));
    expect(f.map(x => x.i)).toEqual(Array.from({ length: 16 }, (_, k) => k * 6000));
  });

  it('D-05, D2-02, D2-06, D2-11: Swing raised after an off step (or lowered before one) never replays or skips a step', () => {
    P.clockSet!(0.25, 0, 0);
    const raised = run(SR, 0, i => { if (i === 0.3 / FR) P.clockSwing!(0.5); });
    expect(raised.map(x => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    P.clockSet!(0.25, 0.5, 0);
    const throughout = run(SR, 0);
    expect(throughout.length).toBe(raised.length);
    // Swing lowered after the even step and before its swung off step: the off step fires at once, once.
    P.clockSet!(0.25, 0.5, 0);
    const lowered = run(SR, 0, i => { if (i === 0.3 / FR) P.clockSwing!(0); });
    expect(lowered.map(x => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(lowered[1]!.i).toBe(0.3 / FR);
  });

  it('D-12: a jump forward re-syncs without firing what it skipped (a step it lands on fires once)', () => {
    P.clockSet!(0.25, 0, 0);
    const f = run(SR, 0, i => (i === SR / 2 ? { beat: 33.1 } : undefined));
    const after = f.filter(x => x.i >= SR / 2 && x.i < SR / 2 + 0.003 * SR);
    expect(after).toEqual([]);
    expect(f.filter(x => x.i >= SR / 2)[0]!.index).toBe(133);
    P.clockSet!(0.25, 0, 0);
    const g = run(SR, 0, i => (i === SR / 2 ? { beat: 33 } : undefined));
    expect(g.filter(x => x.i >= SR / 2 && x.i < SR / 2 + 0.003 * SR).map(x => x.index)).toEqual([132]);
  });

  it('D-15: a loop back re-syncs (and says so): the loop\'s first step fires once and the steps run on from there', () => {
    P.clockSet!(0.25, 0, 0);
    let jumps = 0;
    const f = run(3 * SR, 0, (i, beat) => { if (P.clockJumped!()) jumps++; return beat >= 4 ? { beat: beat - 4 } : undefined; });
    expect(f.map(x => x.index).slice(0, 20)).toEqual([...Array.from({ length: 16 }, (_, k) => k), 0, 1, 2, 3]);
    expect(jumps).toBeGreaterThanOrEqual(1);
  });

  it('D2-07: steps count from the host\'s bar start, so 3/4 after two bars of 4/4 plays as 3/4 from the top', () => {
    P.clockSet!(0.25, 0, 0);
    const a = run(8 * SR, 0, i => (i === Math.round(8 / FR) ? { num: 3, barStart: 8 } : undefined));
    P.clockSet!(0.25, 0, 0);
    const b = run(4 * SR, 0, i => (i === 0 ? { num: 3 } : undefined));
    const fromA = a.filter(x => x.index >= 32).map(x => x.inBar);
    expect(fromA.slice(0, 36)).toEqual(b.map(x => x.inBar).slice(0, 36));
    // A sixteenth at a time across the change: never a stall, never a repeat.
    const idx = a.map(x => x.index);
    expect(idx).toEqual(Array.from({ length: idx.length }, (_, k) => k));
  });

  it('a bar start that moves off the grid re-lays it after the last step fired: it never stalls or repeats', () => {
    P.clockSet!(0.25, 0, 0);
    const f = run(2 * SR, 0, i => (i === 3000 * 5 ? { barStart: 1.3, num: 3 } : undefined));
    const t = f.map(x => x.i);
    for (let k = 1; k < t.length; k++) expect(t[k]! - t[k - 1]!).toBeLessThanOrEqual(2 * 6000); // the step dropped at the change and the next
    expect(new Set(f.map(x => `${x.bar}:${x.inBar}`)).size).toBe(f.length);
  });

  it('a start between steps waits for the next step, or with `landing` fires the step it lands in, once', () => {
    P.clockSet!(0.25, 0, 0);
    const f = run(SR / 4, 0.3);
    expect(f[0]!.index).toBe(2);
    P.clockSet!(0.25, 0, 1);
    const g = run(SR / 4, 0.3);
    expect(g.map(x => [x.i, x.index])[0]).toEqual([0, 1]);
    expect(g[1]!.index).toBe(2);
  });

  it('a render from bar 3 fires exactly the steps a run from the top fires from bar 3', () => {
    P.clockSet!(0.25, 0.3, 0);
    const whole = run(8 * SR, 0).filter(x => x.index >= 32).map(x => [x.index, x.inBar]);
    P.clockSet!(0.25, 0.3, 0);
    const part = run(4 * SR, 8).map(x => [x.index, x.inBar]);
    expect(part).toEqual(whole.slice(0, part.length));
  });
});

describe('seeded randomness by position', () => {
  it('D-06, D2-10: the same step, voice and key give the same value, whatever was drawn before', () => {
    const a = P.rand!(37, 2, 60, 1);
    for (let k = 0; k < 100; k++) P.rand!(k, k % 16, 30 + k, 1);
    expect(P.rand!(37, 2, 60, 1)).toBe(a);
    P.diceSeed!(37, 2, 60, 9);
    const run1 = [P.diceNext!(), P.diceNext!(), P.diceNext!()];
    P.diceSeed!(5, 0, 0, 0); P.diceNext!(); P.diceNext!();
    P.diceSeed!(37, 2, 60, 9);
    expect([P.diceNext!(), P.diceNext!(), P.diceNext!()]).toEqual(run1);
  });

  it('every argument changes the value, and the values are uniform in [0, 1)', () => {
    const base = P.rand!(10, 1, 60, 3);
    expect(P.rand!(11, 1, 60, 3)).not.toBe(base);
    expect(P.rand!(10, 2, 60, 3)).not.toBe(base);
    expect(P.rand!(10, 1, 61, 3)).not.toBe(base);
    expect(P.rand!(10, 1, 60, 4)).not.toBe(base);
    const bins = new Array(16).fill(0) as number[];
    const N = 64000;
    for (let k = 0; k < N; k++) { const v = P.rand!(k, k & 7, 36 + (k % 48), 1); expect(v >= 0 && v < 1).toBe(true); const b = Math.floor(v * 16); bins[b] = bins[b]! + 1; }
    for (const b of bins) expect(Math.abs(b - N / 16)).toBeLessThan(N / 16 * 0.06);
  });
});

describe('the tail calculator', () => {
  it('D-23: an echo\'s tail is its repeats at the tempo now, 60 dB under the first repeat by its end', () => {
    const delay = 0.75 * 60 / 60; // a dotted eighth at 60 BPM, seconds
    const fb = 0.7;
    const t = P.tailEcho!(delay, fb, 60);
    const repeats = Math.round(t / delay) - 1;
    expect(db(fb ** repeats)).toBeLessThanOrEqual(-60);
    expect(db(fb ** (repeats - 1))).toBeGreaterThan(-60);
    expect(P.tailEcho!(delay, 0, 60)).toBe(delay);
  });

  it('D2-03, D2-15: parts in turn add, parts beside take the longest; frames round up to the cap', () => {
    P.tailClear!();
    P.tailThen!(P.tailT60!(3, 80)); // a release to −80 dB: 4 s
    P.tailThen!(0.5); // then a noise's fall
    P.tailWith!(3); // beside: a held gate
    expect(P.tailSeconds!()).toBeCloseTo(4.5, 12);
    expect(P.tailFrames!(SR, 30)).toBe(4.5 * SR);
    P.tailWith!(12);
    expect(P.tailFrames!(SR, 11)).toBe(11 * SR);
    expect(P.tailCoef!(Math.exp(-Math.log(1000) / SR), SR, 60)).toBeCloseTo(1, 9);
  });
});

describe('declick and ramps', () => {
  it('D-10: a voice restarted while sounding, its last sample carried, makes no step', () => {
    const n = SR / 10;
    P.stealRestart!(n, 220, SR, 1234, 0);
    expect(clickStep(outOf(n), 1200, 1300)).toBeGreaterThan(0.1);
    P.stealRestart!(n, 220, SR, 1234, 1);
    expect(clickStep(outOf(n), 1200, 1300)).toBeLessThan(0.01);
  });

  it('D-07, D-08: a ramp arrives exactly at its target, and says so only then', () => {
    P.rampSnap!(1);
    P.rampTo!(0, 0.03, SR);
    let last = 1, maxStep = 0, doneAt = -1;
    for (let i = 0; i < SR / 10; i++) {
      const v = P.rampNext!();
      maxStep = Math.max(maxStep, Math.abs(v - last));
      last = v;
      if (doneAt < 0 && P.rampDone!()) { doneAt = i; expect(v).toBe(0); }
    }
    expect(doneAt).toBe(0.03 * SR - 1);
    expect(maxStep).toBeLessThan(1 / (0.03 * SR) + 1e-12);
  });
});
