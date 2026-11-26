/**
 * sound1, the AssemblyScript sound kit (sdk/as/sound1): every block and function its index exports,
 * held at 44.1, 48 and 96 kHz to four things: it never makes a value that is not a number and stays
 * inside a stated bound; it is stable at every setting, in range or not, and while its settings move;
 * silence after a loud burst holds no subnormal number and (for what feeds back) ends at exactly 0;
 * and it does what it says in seconds and Hz, the same at every rate.
 *
 * The probe (sdk/as/sound1/test/probe) is built with asc (a dev dependency) at the start of the file:
 * each block behind one `run(op, n)`, its settings and input chosen first, its output and a summary of
 * the whole run read after. One wasm instance per sample rate.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findAsc } from '../packages/tools/src/index';
import { repo } from './helpers';

const PROBE = 'sdk/as/sound1/test/probe';
const RATES = [44100, 48000, 96000];
const tmp = mkdtempSync(join(tmpdir(), 'est-sound-kit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Fn = (...a: number[]) => number;
let probe: WebAssembly.Module;

beforeAll(() => {
  const asc = findAsc(repo(PROBE));
  expect(asc, 'asc (the assemblyscript dev dependency)').toBeTruthy();
  const out = join(tmp, 'probe.wasm');
  const r = spawnSync(asc!, ['index.ts', '--config', 'asconfig.json', '--target', 'release', '--outFile', out], { cwd: repo(PROBE), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  probe = new WebAssembly.Module(new Uint8Array(readFileSync(out)) as BufferSource);
  expect(WebAssembly.Module.imports(probe)).toEqual([]);
}, 120_000);

// The probe's blocks (`run`'s first argument).
const OP = {
  sine: 1, saw: 2, square: 3, pulse: 4, triangle: 5, ownTriangle: 6, fm: 7,
  white: 10, pink: 11, random: 12, tableSine: 13, tableSaw: 14, tableFull: 15,
  lfoSine: 20, lfoTriangle: 21, lfoSaw: 22, lfoSquare: 23, lfoRandom: 24,
  lowpass: 30, highpass: 31, bandpass: 32, notch: 33, poleLow: 34, poleHigh: 35, smooth: 36,
  adsr: 40, perc: 41, delay: 50, echo: 51, pong: 52, reverb: 53, chorus: 54, flanger: 55,
  crusher: 60, comp: 61, limiter: 62, drive: 63, softClip: 64, input: 70,
} as const;
// The probe's inputs.
const IN = { none: 0, impulse: 1, noise: 2, sine: 3, square: 4, line: 5, corners: 6 } as const;
/** A setting: a number, or [mode, a, b, at?] (1 a line a→b, 2 the same by ratio, 3 random a…b each sample, 4 `a` until sample `at`, then `b`). */
type Setting = number | [number, number, number, number?];
const line = (a: number, b: number): Setting => [1, a, b];
const sweep = (a: number, b: number): Setting => [2, a, b];
const rand = (a: number, b: number): Setting => [3, a, b];
const step = (a: number, b: number, at: number): Setting => [4, a, b, at];

interface Stats { peak: number; bad: number; sub: number; under: number; lastNonZero: number; lastAbove: number; firstAbove: number; mark: number; changes: number; peakAfter: number; aux: number; min: number; peakR: number }
interface Kit {
  P: Record<string, Fn>;
  rate: number;
  /** The settings a block is called with, in its own argument order. */
  set(...v: Setting[]): void;
  /** The input: its kind, level, how many samples of it (-1: all the run) and its frequency. */
  input(kind: number, amp?: number, len?: number, hz?: Setting): void;
  /** What counts as "above", and where `peakAfter` (and an envelope's release) starts. */
  watch(level: number, from?: number): void;
  run(op: number, n: number): Stats;
  out(n: number, from?: number): Float64Array;
  outR(n: number, from?: number): Float64Array;
  /** Every block cleared (the kit prepared again), at another rate when one is given. */
  again(rate?: number): void;
}
function kit(rate: number): Kit {
  const inst = new WebAssembly.Instance(probe, {});
  const P = inst.exports as unknown as Record<string, Fn>;
  const mem = inst.exports.memory as WebAssembly.Memory;
  P.init!(rate);
  const MAX = P.max_frames!();
  const kept = (n: number, from: number) => { if (from + n > MAX) throw new Error(`the probe keeps ${MAX} samples: ${from} + ${n} asked`); };
  const put = (i: number, s: Setting) => { if (typeof s === 'number') P.setP!(i, 0, s, 0, 0); else P.setP!(i, s[0], s[1], s[2], s[3] ?? 0); };
  const self: Kit = {
    P, rate,
    set: (...v) => { for (let i = 0; i < 4; i++) put(i, v[i] ?? 0); },
    input: (kind, amp = 1, len = -1, hz = 0) => { P.setInput!(kind, amp, len); put(7, hz); },
    watch: (level, from = 0) => { P.setWatch!(level, from); },
    run: (op, n) => {
      P.run!(op, n);
      const s = (i: number) => P.stat!(i);
      return { peak: s(0), bad: s(1), sub: s(2), under: s(3), lastNonZero: s(4), lastAbove: s(5), firstAbove: s(6), mark: s(7), changes: s(8), peakAfter: s(9), aux: s(10), min: s(11), peakR: s(12) };
    },
    out: (n, from = 0) => { kept(n, from); return new Float64Array(mem.buffer, P.output_ptr!() + from * 8, n).slice(); },
    outR: (n, from = 0) => { kept(n, from); return new Float64Array(mem.buffer, P.output_r_ptr!() + from * 8, n).slice(); },
    again: to => { if (to !== undefined) self.rate = to; P.again!(self.rate); P.setWatch!(1e300, 0); P.setInput!(0, 1, -1); },
  };
  return self;
}

// --- Measuring ----------------------------------------------------------------------------------------

const db = (x: number) => 20 * Math.log10(Math.abs(x));
function rms(a: ArrayLike<number>, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (to - from));
}
/** Upward zero crossings. */
function crossings(a: ArrayLike<number>): number {
  let c = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) c++;
  return c;
}
/** Each bin's amplitude (0 to n/2) of `x`, whose length is a power of two. */
function spectrum(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const re = Float64Array.from(x as ArrayLike<number>), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]!; re[i] = re[j]!; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const vr = re[b]! * cr - im[b]! * ci, vi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vr; im[b] = im[a]! - vi; re[a] = re[a]! + vr; im[a] = im[a]! + vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const m = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) m[i] = Math.hypot(re[i]!, im[i]!) * 2 / n;
  return m;
}
const FFT = 65536;
/** The frequency nearest `hz` with a whole number of periods in FFT samples, and its bin. */
const onBin = (hz: number, rate: number) => { const bin = Math.round(hz * FFT / rate); return { bin, hz: bin * rate / FFT }; };
/** The loudest bin that is not a harmonic of `bin`, in dB under the fundamental (what folded back from above the Nyquist limit). */
function aliasDb(x: ArrayLike<number>, bin: number): number {
  const m = spectrum(x);
  let worst = 0;
  for (let i = 1; i < m.length; i++) if (i % bin !== 0 && m[i]! > worst) worst = m[i]!;
  return db(worst / m[bin]!);
}
/** The gain in dB of a block for a full-scale sine at `hz` (measured over the run's second half). */
function gainDb(k: Kit, op: number, hz: number, settings: Setting[], seconds = 1): number {
  k.again(); k.set(...settings); k.input(IN.sine, 1, -1, hz);
  const n = Math.round(k.rate * seconds);
  k.run(op, n);
  return db(rms(k.out(n >> 1, n >> 1)) * Math.SQRT2);
}
/** The decay time (to −60 dB) of an impulse response's low end, from the slope of its energy left (−5 to −35 dB). */
function rt60(x: Float64Array, rate: number): number {
  const c = 1 - Math.exp(-2 * Math.PI * 500 / rate);
  const e = new Float64Array(x.length);
  let a = 0, b = 0;
  for (let i = 0; i < x.length; i++) { a += (x[i]! - a) * c; b += (a - b) * c; e[i] = b * b; }
  for (let i = x.length - 2; i >= 0; i--) e[i] = e[i]! + e[i + 1]!;
  let i5 = -1, i35 = -1;
  for (let i = 0; i < x.length && i35 < 0; i++) {
    const d = 10 * Math.log10(e[i]! / e[0]!);
    if (i5 < 0 && d <= -5) i5 = i;
    if (d <= -35) i35 = i;
  }
  return (i35 - i5) / rate * 2;
}
/** A state-variable filter's gains in dB at `hz` for a cutoff and the kit's resonance (0 to 1): [low, high, band, notch]. */
function svfDb(hz: number, cutoff: number, resonance: number): [number, number, number, number] {
  const k = 2 * Math.exp(-3.2188758248682006 * resonance), w = hz / cutoff;
  const den = Math.hypot(1 - w * w, k * w);
  return [db(1 / den), db(w * w / den), db(w / den), db(Math.abs(1 - w * w) / den)];
}
/** Nothing that is not a number, and no subnormal. */
function clean(s: Stats): void {
  expect(s.bad).toBe(0);
  expect(s.sub).toBe(0);
}

describe.each(RATES)('sound1 at %i Hz', rate => {
  let k: Kit;
  beforeAll(() => { k = kit(rate); });
  const sec = (s: number) => Math.round(s * rate);
  /** A loud burst (half a second), then silence to `seconds`: the summary of the whole run. */
  const afterBurst = (op: number, settings: Setting[], seconds: number, kind: number = IN.corners, amp = 1, hz: Setting = 100) => {
    k.again(); k.set(...settings); k.input(kind, amp, sec(0.5), hz); k.watch(1e300, sec(0.5));
    return k.run(op, sec(seconds));
  };
  /** The run ended in a second of exact zeros. */
  const endsAtZero = (s: Stats, seconds: number) => expect(s.lastNonZero).toBeLessThan(sec(seconds) - rate);

  // --- Osc ------------------------------------------------------------------------------------------

  describe('Osc', () => {
    const waves = [['sine', OP.sine], ['saw', OP.saw], ['square', OP.square], ['pulse', OP.pulse], ['triangle', OP.triangle]] as const;

    it('plays the frequency asked: 440 Hz is 440 cycles a second for every wave (the same at every rate)', () => {
      for (const [name, op] of waves) {
        k.again(); k.set(440, name === 'pulse' ? 0.3 : 0);
        k.run(op, rate);
        const c = crossings(k.out(rate));
        expect(Math.abs(c - 440), `${name}: ${c} cycles`).toBeLessThanOrEqual(1);
      }
    });

    it('stays within ±1 at every frequency, in range or not, and while the frequency moves (bound 1: the band-limiting only rounds corners inward)', () => {
      for (const [name, op] of waves) {
        for (const hz of [-100, 0, 1e-3, 20, 440, 4186, rate / 4, 0.45 * rate, 0.5 * rate, rate, 1e9]) {
          k.again(); k.set(hz, 0.5);
          const s = k.run(op, 20000);
          clean(s);
          expect(s.peak, `${name} at ${hz} Hz`).toBeLessThanOrEqual(1 + 1e-12);
        }
        // A sweep to the Nyquist limit (the pulse's width swept out of range too), then a new random frequency every sample.
        k.again(); k.set(sweep(1, rate / 2), line(-1, 2));
        let s = k.run(op, 200000);
        clean(s);
        expect(s.peak, `${name} swept`).toBeLessThanOrEqual(1 + 1e-12);
        k.again(); k.set(rand(-1000, rate), rand(-1, 2));
        s = k.run(op, 200000);
        clean(s);
        expect(s.peak, `${name} modulated`).toBeLessThanOrEqual(1 + 1e-12);
      }
    });

    it('holds still at 0 Hz and below, and treats a frequency past the limit as 0.45 × the rate', () => {
      for (const [name, op] of waves) {
        for (const hz of [0, -440]) {
          k.again(); k.set(hz, 0.5);
          expect(k.run(op, 5000).changes, `${name} at ${hz}`).toBe(0);
        }
        k.again(); k.set(0.45 * rate, 0.5); k.run(op, 5000);
        const top = k.out(5000);
        k.again(); k.set(1e12, 0.5); k.run(op, 5000);
        expect(Array.from(k.out(5000)), name).toEqual(Array.from(top));
      }
    });

    it('sine: within 0.2 % of the exact sine; the phase stays in 0 to 1', () => {
      k.again(); k.set(441, 0);
      k.run(OP.sine, rate);
      const o = k.out(rate), ph = k.outR(rate);
      let worst = 0, p = 0, outside = 0;
      for (let i = 0; i < rate; i++) {
        worst = Math.max(worst, Math.abs(o[i]! - Math.sin(2 * Math.PI * p)));
        p += 441 / rate; if (p >= 1) p -= 1;
        if (!(ph[i]! >= 0 && ph[i]! < 1)) outside++;
      }
      expect(worst).toBeLessThan(0.002);
      expect(outside).toBe(0);
    });

    it('sine with fm: no fm is the plain sine; a quarter turn of fm gives the sidebands a phase modulation of π/2 has; any fm is safe', () => {
      const c = onBin(1000, rate), m = onBin(150, rate);
      k.again(); k.set(c.hz, 0); k.run(OP.sine, FFT);
      const plain = k.out(FFT);
      k.again(); k.set(c.hz, 0, m.hz); k.run(OP.fm, FFT);
      expect(Array.from(k.out(FFT))).toEqual(Array.from(plain));
      k.again(); k.set(c.hz, 0.25, m.hz);
      const s = k.run(OP.fm, FFT);
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(1 + 1e-12);
      const sp = spectrum(k.out(FFT));
      // Bessel J0(π/2) = 0.472 (the carrier), J1(π/2) = 0.567 (the first sidebands), J2(π/2) = 0.250.
      expect(sp[c.bin]!).toBeCloseTo(0.472, 1);
      expect(sp[c.bin + m.bin]!).toBeCloseTo(0.567, 1);
      expect(sp[c.bin - m.bin]!).toBeCloseTo(0.567, 1);
      expect(sp[c.bin + 2 * m.bin]!).toBeCloseTo(0.25, 1);
      for (const fm of [rand(-1000, 1000), rand(-1e9, 1e9), -0.75, 12345.678]) {
        k.again(); k.set(440, fm);
        const r = k.run(OP.sine, 50000);
        clean(r);
        expect(r.peak).toBeLessThanOrEqual(1 + 1e-12);
      }
    });

    it('band-limiting: what folds back is at least 40 dB under a 440 Hz saw, square and pulse; at 4186 Hz (the top C) at least 20 dB under, and well under the plain wave\'s', () => {
      // The plain (not band-limited) waves, on the same phase.
      const plain = (hz: number, f: (p: number) => number) => {
        const a = new Float64Array(FFT);
        let p = 0;
        for (let i = 0; i < FFT; i++) { a[i] = f(p); p += hz / rate; if (p >= 1) p -= 1; }
        return a;
      };
      const shapes: [string, number, number, (p: number) => number][] = [
        ['saw', OP.saw, 0, p => 2 * p - 1], ['square', OP.square, 0, p => (p < 0.5 ? 1 : -1)], ['pulse', OP.pulse, 0.25, p => (p < 0.25 ? 1 : -1)],
      ];
      for (const [name, op, width, f] of shapes) {
        const low = onBin(440, rate), high = onBin(4186, rate);
        k.again(); k.set(low.hz, width); k.run(op, FFT);
        const atLow = aliasDb(k.out(FFT), low.bin);
        k.again(); k.set(high.hz, width); k.run(op, FFT);
        const atHigh = aliasDb(k.out(FFT), high.bin);
        const naive = aliasDb(plain(high.hz, f), high.bin);
        expect(atLow, `${name} at 440 Hz: ${atLow.toFixed(1)} dB`).toBeLessThan(-40);
        // A two-sample polyBLEP's limit: measured −21 to −33 dB at the top C (the report has each figure).
        expect(atHigh, `${name} at 4186 Hz: ${atHigh.toFixed(1)} dB`).toBeLessThan(-20);
        expect(atHigh, `${name} at 4186 Hz: ${atHigh.toFixed(1)} dB against the plain wave's ${naive.toFixed(1)}`).toBeLessThan(naive - 8);
      }
    });

    it('triangle: the ideal triangle at a low note; at a high note its corner correction leaves less folded back than none, a doubled one or a reversed one', () => {
      k.again(); k.set(55, 0); k.run(OP.triangle, rate);
      const o = k.out(rate);
      let worst = 0, p = 0;
      for (let i = 0; i < rate; i++) {
        worst = Math.max(worst, Math.abs(o[i]! - (1 - 4 * Math.abs(p - 0.5))));
        p += 55 / rate; if (p >= 1) p -= 1;
      }
      // The correction's size at a corner is (4/3) × the phase step: 0.0017 at 44.1 kHz.
      expect(worst).toBeLessThan(0.002);
      const { bin, hz } = onBin(4186, rate);
      k.again(); k.set(hz, 0); k.run(OP.triangle, FFT);
      const kitWave = k.out(FFT);
      const own = (factor: number) => { k.again(); k.set(hz, factor); k.run(OP.ownTriangle, FFT); return k.out(FFT); };
      const kitDb = aliasDb(kitWave, bin), naive = aliasDb(own(0), bin), doubled = aliasDb(own(8), bin), reversed = aliasDb(own(-4), bin);
      const note = `kit ${kitDb.toFixed(1)} dB, none ${naive.toFixed(1)}, doubled ${doubled.toFixed(1)}, reversed ${reversed.toFixed(1)}`;
      expect(kitDb, note).toBeLessThan(-40);
      expect(kitDb, note).toBeLessThan(naive - 8);
      expect(kitDb, note).toBeLessThan(doubled - 3);
      expect(kitDb, note).toBeLessThan(reversed - 12);
      // The kit's is the probe's own with the factor 4 (the same arithmetic).
      const four = own(4);
      let diff = 0;
      for (let i = 0; i < FFT; i++) diff = Math.max(diff, Math.abs(four[i]! - kitWave[i]!));
      expect(diff).toBeLessThan(1e-12);
    });
  });

  // --- Noise ------------------------------------------------------------------------------------------

  describe('Noise', () => {
    it('white: −1 to 1, centred, as loud as uniform noise (rms 0.577)', () => {
      k.again();
      const s = k.run(OP.white, 200000);
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(1);
      expect(s.peak).toBeGreaterThan(0.99);
      const o = k.out(200000);
      expect(Math.abs(o.reduce((a, b) => a + b, 0) / o.length)).toBeLessThan(0.01);
      expect(rms(o)).toBeCloseTo(0.5774, 2);
    });

    it('random: 0 to 1, centred on a half', () => {
      k.again();
      const s = k.run(OP.random, 200000);
      clean(s);
      expect(s.min).toBeGreaterThanOrEqual(0);
      expect(s.peak).toBeLessThanOrEqual(1);
      const o = k.out(200000);
      expect(o.reduce((a, b) => a + b, 0) / o.length).toBeCloseTo(0.5, 1);
    });

    it('pink: bounded, falls 3 dB an octave, and 20 seconds of it hold no subnormal number', () => {
      k.again();
      const s = k.run(OP.pink, 20 * rate);
      clean(s);
      // The three poles' gains are 42.1, 8.0 and 2.4 at most, plus 0.18 of white, × 0.125: under 6.6 always. Noise comes nowhere
      // near that, so it is scaled to stay about within it: 20 seconds peak at 1.0 (rms 0.215, where white's is 0.58).
      expect(s.peak).toBeLessThan(6.6);
      expect(s.peak).toBeLessThan(1.25);
      expect(rms(k.out(400000))).toBeCloseTo(0.215, 1);
      k.again(); k.run(OP.pink, 8 * FFT);
      const power = (from: number, to: number) => {
        let p = 0;
        for (let part = 0; part < 8; part++) {
          const sp = spectrum(k.out(FFT, part * FFT));
          for (let i = Math.round(from * FFT / rate); i < Math.round(to * FFT / rate); i++) p += sp[i]! * sp[i]!;
        }
        return p;
      };
      // Pink noise has the same power in every octave (white would have 16 times more four octaves up: 12 dB).
      const low = power(200, 400), high = power(3200, 6400);
      expect(Math.abs(10 * Math.log10(high / low))).toBeLessThan(2.5);
    });

    it('is the same on every run: two fresh modules give one sequence, each Noise its own, and a reset starts it again', () => {
      const a = kit(rate), b = kit(rate);
      for (const op of [OP.white, OP.pink, OP.random]) {
        a.run(op, 4096); b.run(op, 4096);
        expect(Array.from(a.out(4096))).toEqual(Array.from(b.out(4096)));
      }
      a.again(); a.run(OP.white, 4096);
      const first = a.out(4096), second = a.outR(4096);
      expect(Array.from(first)).not.toEqual(Array.from(second));   // two Noise blocks, two seeds
      a.run(OP.white, 4096);
      expect(Array.from(a.out(4096))).not.toEqual(Array.from(first));   // it goes on
      a.again(); a.run(OP.white, 4096);
      expect(Array.from(a.out(4096))).toEqual(Array.from(first));       // the kit prepared again: from the start
      a.again(); a.run(OP.pink, 4096);
      const pink = a.out(4096);
      a.run(OP.pink, 4096); a.again(); a.run(OP.pink, 4096);
      expect(Array.from(a.out(4096))).toEqual(Array.from(pink));
    });
  });

  // --- Wavetable --------------------------------------------------------------------------------------

  describe('Wavetable', () => {
    it('with harmonic 1 alone it is a sine at the frequency asked', () => {
      k.again(); k.set(441); k.run(OP.tableSine, rate);
      const o = k.out(rate);
      expect(Math.abs(crossings(o) - 441)).toBeLessThanOrEqual(1);
      let worst = 0;
      for (let i = 0; i < rate; i++) worst = Math.max(worst, Math.abs(o[i]! - Math.sin(2 * Math.PI * ((i * 441 / rate) % 1))));
      expect(worst).toBeLessThan(1e-4);
    });

    it('32 harmonics at 2 kHz and 6 kHz: nothing folds back (55 dB under at least), and the peak is 1 at most', () => {
      for (const [name, op] of [['a saw', OP.tableSaw], ['every harmonic at full level', OP.tableFull]] as const) {
        for (const note of [110, 2000, 6000]) {
          const { bin, hz } = onBin(note, rate);
          k.again(); k.set(hz);
          const s = k.run(op, FFT);
          clean(s);
          expect(s.peak, `${name} at ${note}`).toBeLessThanOrEqual(1 + 1e-6);
          const a = aliasDb(k.out(FFT), bin);
          expect(a, `${name} at ${note} Hz: ${a.toFixed(1)} dB`).toBeLessThan(-55);
        }
      }
      // The low note keeps all 32 harmonics: its peak is the table's, 1.
      k.again(); k.set(55);
      expect(k.run(OP.tableFull, rate).peak).toBeGreaterThan(0.95);
    });

    it('is safe at any frequency: still at 0 and below, bounded past the limit and while swept', () => {
      for (const op of [OP.tableSine, OP.tableSaw, OP.tableFull]) {
        for (const hz of [0, -50]) { k.again(); k.set(hz); expect(k.run(op, 2000).changes).toBe(0); }
        for (const hz of [1e-3, 0.45 * rate, rate, 1e9, sweep(1, rate), rand(-1000, rate)]) {
          k.again(); k.set(hz);
          const s = k.run(op, 100000);
          clean(s);
          expect(s.peak).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    });
  });

  // --- Lfo --------------------------------------------------------------------------------------------

  describe('Lfo', () => {
    /** The phase before each sample, stepped as the block steps it. */
    const phases = (hz: number, n: number) => {
      const a = new Float64Array(n);
      let p = 0;
      for (let i = 0; i < n; i++) { a[i] = p; p += hz / rate; if (p >= 1) p -= 1; }
      return a;
    };

    it('sine, triangle, saw and square are their shapes at the rate asked (5 Hz: 5 cycles a second)', () => {
      const n = 2 * rate, p = phases(5, n);
      const shapes: [number, (p: number) => number, number][] = [
        [OP.lfoSine, x => Math.sin(2 * Math.PI * x), 0.002], [OP.lfoTriangle, x => 1 - 4 * Math.abs(x - 0.5), 0],
        [OP.lfoSaw, x => 2 * x - 1, 0], [OP.lfoSquare, x => (x < 0.5 ? 1 : -1), 0],
      ];
      for (const [op, f, tolerance] of shapes) {
        k.again(); k.set(5);
        const s = k.run(op, n);
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1 + 1e-12);
        const o = k.out(n);
        let worst = 0;
        for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(o[i]! - f(p[i]!)));
        expect(worst).toBeLessThanOrEqual(tolerance);
      }
      k.again(); k.set(5); k.run(OP.lfoSine, n);
      expect(Math.abs(crossings(k.out(n).subarray(1)) - 9)).toBeLessThanOrEqual(1);   // 10 cycles: 9 or 10 upward crossings after the start
    });

    it('random: a new value the rate asked times a second, held between; a rate of 0 or less holds one value', () => {
      k.again(); k.set(8);
      let s = k.run(OP.lfoRandom, 4 * rate);
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(1);
      expect(Math.abs(s.changes - 31)).toBeLessThanOrEqual(1);   // 32 values in 4 seconds: 31 changes
      // A rate whose phase lands exactly on 0 at each wrap (an eighth of the sample rate): still one new value a cycle.
      k.again(); k.set(rate / 8);
      s = k.run(OP.lfoRandom, 80000);
      expect(Math.abs(s.changes - 9999)).toBeLessThanOrEqual(1);
      k.again(); k.set(rate);   // held to half the sample rate: a new value every other sample
      s = k.run(OP.lfoRandom, 80000);
      expect(Math.abs(s.changes - 39999)).toBeLessThanOrEqual(1);
      for (const hz of [0, -3]) {
        k.again(); k.set(hz);
        s = k.run(OP.lfoRandom, 20000);
        expect(s.changes, `at ${hz} Hz`).toBe(0);
        expect(s.peak).toBeGreaterThan(0);   // the first value is drawn at the start
      }
    });

    it('is safe at any rate: still at 0 and below, bounded when huge or moving', () => {
      for (const op of [OP.lfoSine, OP.lfoTriangle, OP.lfoSaw, OP.lfoSquare, OP.lfoRandom]) {
        for (const hz of [-5, 0, 1e-6, 20, rate, 1e12, sweep(0.01, rate), rand(-100, rate)]) {
          k.again(); k.set(hz);
          const s = k.run(op, 100000);
          clean(s);
          expect(s.peak).toBeLessThanOrEqual(1 + 1e-12);
          expect(s.peakR).toBeLessThan(1);   // the phase
        }
        if (op !== OP.lfoRandom) for (const hz of [0, -5]) { k.again(); k.set(hz); expect(k.run(op, 5000).changes).toBe(0); }
      }
    });
  });

  // --- Filter -----------------------------------------------------------------------------------------

  describe('Filter', () => {
    const shapes = [['lowpass', OP.lowpass, 0], ['highpass', OP.highpass, 1], ['bandpass', OP.bandpass, 2], ['notch', OP.notch, 3]] as const;

    it('lowpass passes lows and cuts highs, highpass the reverse, bandpass peaks at the cutoff, notch removes it', () => {
      const g = (op: number, hz: number, res = 0) => gainDb(k, op, hz, [1000, res]);
      expect(g(OP.lowpass, 100)).toBeGreaterThan(-0.5);
      expect(g(OP.lowpass, 10000)).toBeLessThan(-38);
      expect(g(OP.highpass, 10000)).toBeGreaterThan(-0.5);
      expect(g(OP.highpass, 100)).toBeLessThan(-38);
      expect(g(OP.bandpass, 1000, 0.5)).toBeGreaterThan(g(OP.bandpass, 100, 0.5) + 20);
      expect(g(OP.bandpass, 1000, 0.5)).toBeGreaterThan(g(OP.bandpass, 10000, 0.5) + 20);
      expect(g(OP.notch, 1000)).toBeLessThan(-100);
      expect(g(OP.notch, 100)).toBeGreaterThan(-0.5);
      expect(g(OP.notch, 10000)).toBeGreaterThan(-0.5);
      // Resonance 1 is a peak of Q 12.5 (21.9 dB) at the cutoff; resonance 0 has none (−6 dB there).
      expect(g(OP.lowpass, 1000, 1)).toBeCloseTo(21.94, 0);
      expect(g(OP.lowpass, 1000, 0)).toBeCloseTo(-6.02, 1);
    });

    it('the same response at every sample rate: each shape is within 0.5 dB of the analogue filter two octaves either side of the cutoff', () => {
      for (const res of [0, 0.5, 1]) {
        for (const hz of [250, 500, 1000, 2000, 4000]) {
          const want = svfDb(hz, 1000, res);
          for (const [name, op, at] of shapes) {
            if (name === 'notch' && hz === 1000) continue;
            const got = gainDb(k, op, hz, [1000, res], 0.5);
            expect(Math.abs(got - want[at]), `${name} at ${hz} Hz, resonance ${res}: ${got.toFixed(2)} dB for ${want[at].toFixed(2)}`).toBeLessThan(0.5);
          }
        }
      }
    });

    it('a resonance out of range is the nearest in range; a cutoff out of range is 10 Hz or 0.45 × the rate', () => {
      const same = (a: Setting[], b: Setting[]) => {
        k.again(); k.set(...a); k.input(IN.noise); k.run(OP.lowpass, 20000);
        const x = k.out(20000);
        k.again(); k.set(...b); k.input(IN.noise); k.run(OP.lowpass, 20000);
        expect(Array.from(k.out(20000))).toEqual(Array.from(x));
      };
      same([1000, -1], [1000, 0]);
      same([1000, 2], [1000, 1]);
      same([1, 0.5], [10, 0.5]);
      same([-500, 0.5], [10, 0.5]);
      same([1e9, 0.5], [0.45 * rate, 0.5]);
    });

    it('is bounded by its resonance for any full-scale input: under 17.5 (1 + 4/π × Q, Q 12.5 at most), at a fixed or a swept cutoff', () => {
      for (const [name, op] of shapes) {
        const peaks: number[] = [];
        const go = (settings: Setting[], kind: number, hz: Setting, seconds: number) => {
          k.again(); k.set(...settings); k.input(kind, 1, -1, hz);
          const s = k.run(op, sec(seconds));
          clean(s);
          peaks.push(s.peak);
        };
        go([1000, 1], IN.square, 1000, 2);                      // the worst input: a square at the resonance
        go([1000, 1], IN.sine, sweep(20, 20000), 10);           // a full-scale sweep through it
        go([1000, 1], IN.corners, 0, 5);                        // full-scale noise
        go([sweep(1, 30000), 1], IN.corners, 0, 10);            // the cutoff swept from under its range to over the Nyquist limit
        go([sweep(30000, 1), 2], IN.square, 200, 10);
        go([100, line(-1, 2)], IN.square, 100, 5);              // the resonance swept through and out of its range
        expect(Math.max(...peaks), `${name}: ${peaks.map(p => p.toFixed(2)).join(' ')}`).toBeLessThan(17.5);
      }
    });

    it('stays stable while the cutoff and the resonance jump to a new random value every sample (measured under 22; held under 40)', () => {
      for (const [name, op] of shapes) {
        const peaks: number[] = [];
        for (const [kind, hz] of [[IN.corners, 0], [IN.square, 500], [IN.sine, sweep(20, 20000)]] as const) {
          for (const res of [1, rand(-1, 2)]) {
            k.again(); k.set(rand(1, 30000), res); k.input(kind, 1, -1, hz);
            const s = k.run(op, sec(10));
            clean(s);
            peaks.push(s.peak);
            // No slower growth either: the second half is no louder than the bound.
            expect(s.peakAfter).toBeLessThan(40);
          }
        }
        expect(Math.max(...peaks), `${name}: ${peaks.map(p => p.toFixed(1)).join(' ')}`).toBeLessThan(40);
      }
    });

    it('silence after a burst: no subnormal number in 20 seconds at any setting, and exactly 0 at the end', () => {
      for (const [, op] of shapes) {
        // The longest ring the filter has that still ends inside the run: 20 Hz at full resonance.
        const s = afterBurst(op, [20, 1], 20.5, IN.square, 1, 20);
        clean(s);
        endsAtZero(s, 20.5);
        for (const settings of [[10, 1], [1000, 1], [30000, 1], [10, 0], [1000, 0]] as Setting[][]) {
          const r = afterBurst(op, settings, 20.5);
          clean(r);
          // 10 Hz at full resonance rings for 20 seconds (a Q of 12.5 at 10 Hz) before it is under the floor.
          if (settings[0] !== 10 || settings[1] === 0) endsAtZero(r, 20.5);
        }
      }
    });

    it('tail(): at least as long as an impulse rings (to −60 dB)', () => {
      for (const op of [OP.bandpass, OP.lowpass]) {
        for (const [cutoff, res] of [[100, 1], [1000, 1], [1000, 0.5], [50, 0.8], [200, 0], [1000, 0.25], [5000, 0]] as const) {
          k.again(); k.set(cutoff, res); k.input(IN.impulse); k.watch(0);
          const peak = k.run(op, sec(4)).peak;
          k.again(); k.set(cutoff, res); k.input(IN.impulse); k.watch(peak * 0.001);
          const s = k.run(op, sec(4));
          expect(s.aux * rate + 1, `${cutoff} Hz, resonance ${res}: rings ${(s.lastAbove / rate).toFixed(4)} s, tail ${s.aux.toFixed(4)}`).toBeGreaterThanOrEqual(s.lastAbove);
          expect(s.aux).toBeLessThanOrEqual(3);
        }
      }
    });
  });

  // --- OnePole, Smooth --------------------------------------------------------------------------------

  describe('OnePole', () => {
    it('6 dB an octave about the cutoff, the same at every rate', () => {
      const low = (hz: number) => gainDb(k, OP.poleLow, hz, [1000]), high = (hz: number) => gainDb(k, OP.poleHigh, hz, [1000]);
      const want = (hz: number) => db(1 / Math.hypot(1, hz / 1000));
      // Within 0.75 dB of the analogue filter up to two octaves over the cutoff (0.63 dB at 4 kHz at 44.1 kHz, less at the higher rates).
      for (const hz of [100, 1000, 4000]) expect(Math.abs(low(hz) - want(hz)), `lowpass at ${hz}: ${low(hz).toFixed(2)}`).toBeLessThan(0.75);
      expect(low(100)).toBeGreaterThan(-0.2);
      expect(low(8000)).toBeLessThan(-15);
      expect(Math.abs(high(1000) - -3.01)).toBeLessThan(0.75);
      expect(high(100)).toBeLessThan(-19);
      expect(high(10000)).toBeGreaterThan(-1.5);
    });

    it('is bounded at any cutoff: the lowpass by its input (1), the highpass by twice it', () => {
      for (const hz of [-5, 0, 1, 1000, 0.45 * rate, 1e9, sweep(0.1, 1e6), rand(-100, rate)]) {
        k.again(); k.set(hz); k.input(IN.corners);
        let s = k.run(OP.poleLow, 100000);
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1);
        k.again(); k.set(hz); k.input(IN.corners);
        s = k.run(OP.poleHigh, 100000);
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(2);
      }
    });

    it('silence after a burst: no subnormal number, and exactly 0 (the slowest cutoff, 1 Hz, included)', () => {
      for (const op of [OP.poleLow, OP.poleHigh]) {
        for (const hz of [1, 0, 100, 20000]) {
          const s = afterBurst(op, [hz], 20.5, IN.square, 1, 0.5);
          clean(s);
          expect(s.under).toBe(0);
          endsAtZero(s, 20.5);
        }
      }
    });

    it('tail(): at least as long as an impulse rings (to −60 dB)', () => {
      for (const hz of [1, 10, 1000]) {
        k.again(); k.set(hz); k.input(IN.impulse); k.watch(0);
        const peak = k.run(OP.poleLow, sec(3)).peak;
        k.again(); k.set(hz); k.input(IN.impulse); k.watch(peak * 0.001);
        const s = k.run(OP.poleLow, sec(3));
        expect(s.aux * rate + 2, `${hz} Hz: rings ${(s.lastAbove / rate).toFixed(3)} s, tail ${s.aux.toFixed(3)}`).toBeGreaterThanOrEqual(s.lastAbove);
      }
    });
  });

  describe('Smooth', () => {
    it('starts on its first target, then glides: 63 % of the way after the time asked (the same at every rate), and lands exactly', () => {
      for (const seconds of [0.02, 0.1]) {
        k.again(); k.set(step(0.25, 1, 1), seconds);
        const n = sec(seconds * 40);
        const s = k.run(OP.smooth, n);
        clean(s);
        const o = k.out(n);
        expect(o[0]).toBe(0.25);
        const part = (o[sec(seconds)]! - 0.25) / 0.75;
        expect(part).toBeGreaterThan(0.622);
        expect(part).toBeLessThan(0.642);
        expect(o[n - 1]).toBe(1);
        let falls = 0, differs = 0;
        const value = k.outR(n);
        for (let i = 1; i < n; i++) { if (o[i]! < o[i - 1]!) falls++; if (value[i] !== o[i]) differs++; }
        expect(falls).toBe(0);
        expect(differs).toBe(0);   // `value` is what `next` returned
      }
    });

    it('a time of 0 or less jumps; a glide down to 0 ends at exactly 0 with no subnormal number; the short call glides in 20 ms', () => {
      for (const seconds of [0, -1, 1e-9]) {
        k.again(); k.set(step(0, 1, 1), seconds);
        k.run(OP.smooth, 10);
        expect(Array.from(k.out(4))).toEqual([0, 1, 1, 1]);
      }
      k.again(); k.set(step(1, 0, 1), 0.05);
      const s = k.run(OP.smooth, sec(20));
      clean(s);
      expect(s.under).toBe(0);
      endsAtZero(s, 20);
      for (const seconds of [rand(-1, 1), sweep(1e-6, 100), 1e9]) {
        k.again(); k.set(rand(-1, 1), seconds);
        const r = k.run(OP.smooth, 100000);
        clean(r);
        expect(r.peak).toBeLessThanOrEqual(1);
      }
      k.again(); k.P.defaults!(OP.smooth, 0, 1); k.P.defaults!(OP.smooth, 1, sec(0.02) + 1);
      expect(k.out(sec(0.02) + 1)[sec(0.02)]!).toBeCloseTo(0.632, 1);
    });
  });

  // --- Adsr -------------------------------------------------------------------------------------------

  describe('Adsr', () => {
    it('attack (a line), decay (to −60 dB of the way to the sustain), sustain, release (to −60 dB), each in the seconds asked at every rate', () => {
      const A = 0.1, D = 0.3, S = 0.5, R = 0.4, releaseAt = sec(1.5);
      k.again(); k.set(A, D, S, R); k.watch(1e300, releaseAt);
      const n = sec(3);
      const s = k.run(OP.adsr, n);
      clean(s);
      expect(s.peak).toBe(1);
      expect(s.min).toBe(0);
      const o = k.out(n);
      // The attack: a straight line that reaches 1 at A seconds.
      const top = o.indexOf(1);
      expect(Math.abs(top + 1 - A * rate)).toBeLessThanOrEqual(1);
      for (const i of [10, sec(0.03), sec(0.07)]) expect(o[i]!).toBeCloseTo((i + 1) / (A * rate), 6);
      // The decay: a thousandth of the way from 1 to the sustain is left after D seconds.
      const left = (o[top + sec(D)]! - S) / (1 - S);
      expect(left).toBeGreaterThan(0.0008);
      expect(left).toBeLessThan(0.00125);
      expect((o[top + sec(D / 2)]! - S) / (1 - S)).toBeCloseTo(Math.sqrt(0.001), 2);
      // The sustain holds until the key goes up.
      expect(o[releaseAt - 1]!).toBeCloseTo(S, 4);
      // The release: a thousandth of the level is left after R seconds, and it ends (at −80 dB) inside `releaseSeconds()`.
      const after = o[releaseAt + sec(R)]! / o[releaseAt - 1]!;
      expect(after).toBeGreaterThan(0.0008);
      expect(after).toBeLessThan(0.00125);
      expect(s.aux).toBeCloseTo(R * 1.34, 9);
      expect(s.mark).toBeGreaterThan(releaseAt + sec(R));
      expect(s.mark - releaseAt).toBeLessThanOrEqual(s.aux * rate);
      expect(o.subarray(s.mark).every(v => v === 0)).toBe(true);
      let rises = 0;
      for (let i = releaseAt + 1; i < s.mark; i++) if (!(o[i]! < o[i - 1]!)) rises++;
      expect(rises).toBe(0);
    });

    it('`done()` comes within `releaseSeconds()` of the release from any level, a full-level sustain included', () => {
      for (const [a, d, sus, r] of [[0.01, 0.1, 1, 0.5], [0.01, 0.1, 0.05, 2], [0.5, 0.5, 0.7, 0.003], [0.001, 0.002, 1, 0.0001], [0.01, 0.05, 1, 30]] as const) {
        const releaseAt = sec(0.4);
        k.again(); k.set(a, d, sus, r); k.watch(1e300, releaseAt);
        const s = k.run(OP.adsr, releaseAt + sec(r * 1.34 + 0.1));
        clean(s);
        expect(s.mark, `release ${r}`).toBeGreaterThan(releaseAt);
        expect(s.mark - releaseAt, `release ${r}: done after ${((s.mark - releaseAt) / rate).toFixed(4)} s of ${s.aux.toFixed(4)}`).toBeLessThanOrEqual(Math.ceil(s.aux * rate));
      }
    });

    it('`perc` rises, falls and ends by itself, the key still held', () => {
      for (const [a, d] of [[0.005, 0.25], [0.001, 0.05], [0.05, 2]] as const) {
        k.again(); k.set(a, d);
        const n = sec(a + d * 1.34 + 0.2);
        const s = k.run(OP.perc, n);
        clean(s);
        expect(s.peak).toBe(1);
        expect(s.mark).toBeGreaterThan(sec(a + d));              // −60 dB at `decay`; it ends at −80
        expect(s.mark).toBeLessThanOrEqual(sec(a) + Math.ceil(s.aux * rate) + 1);
        expect(k.out(1, n - 1)[0]).toBe(0);
      }
    });

    it('is safe with any times: 0 to 1 always, no subnormal number in a long decay to 0', () => {
      for (const settings of [[-1, -1, 2, -1], [0, 0, 0, 0], [1e9, 1e9, 0.5, 1e9], [rand(-1, 2), rand(-1, 2), rand(-1, 2), rand(-1, 2)], [0.001, 30, 0, 30]] as Setting[][]) {
        k.again(); k.set(...settings); k.watch(1e300, sec(1));
        const s = k.run(OP.adsr, sec(45));
        clean(s);
        expect(s.under).toBe(0);
        expect(s.peak).toBeLessThanOrEqual(1);
        expect(s.min).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // --- Delay, Echo, PingPong --------------------------------------------------------------------------

  describe('Delay', () => {
    it('gives back what went in the seconds asked ago, at every rate; a time under a sample is one sample, a time past its length is its length', () => {
      const at = (seconds: number) => {
        k.again(); k.set(seconds); k.input(IN.impulse, 0.75); k.watch(0.5);
        const s = k.run(OP.delay, sec(3));
        clean(s);
        expect(s.peak).toBe(0.75);
        expect(s.firstAbove).toBe(s.lastAbove);
        return s;
      };
      for (const seconds of [0.1, 0.5, 1]) expect(at(seconds).firstAbove).toBe(sec(seconds));
      expect(at(0).firstAbove).toBe(1);
      expect(at(-3).firstAbove).toBe(1);
      // Made for 1 second: 5 seconds asked is 1 second at every rate.
      const long = at(5);
      expect(long.firstAbove).toBe(rate);
      expect(long.aux).toBe(1);   // tail(): the longest time read so far
      const fresh = kit(rate);
      fresh.set(0.25); fresh.input(IN.impulse);
      expect(fresh.run(OP.delay, 100).aux).toBe(0.25);
    });

    it('a time between two samples is read between them, and a moving time is bounded by the input', () => {
      k.again(); k.set(100.5 / rate); k.input(IN.impulse); k.run(OP.delay, 200);
      const o = k.out(200);
      expect(o[100]!).toBeCloseTo(0.5, 6);
      expect(o[101]!).toBeCloseTo(0.5, 6);
      for (const seconds of [sweep(1e-6, 10), rand(-1, 3), line(2, -1)]) {
        k.again(); k.set(seconds); k.input(IN.corners);
        const s = k.run(OP.delay, sec(3));
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Echo', () => {
    it('the first echo comes the seconds asked after the sound (to the sample, at every rate), as loud as the sound', () => {
      for (const seconds of [0.05, 0.25, 1, 2]) {
        k.again(); k.set(seconds, 0.5, 1); k.input(IN.impulse); k.watch(0.9);
        const s = k.run(OP.echo, sec(seconds) + 100);
        expect(s.firstAbove).toBe(sec(seconds));
        expect(s.peak).toBe(1);
      }
      // Made for 2 seconds: a longer time is 2 seconds at every rate.
      k.again(); k.set(3.5, 0.5, 1); k.input(IN.impulse); k.watch(0.9);
      expect(k.run(OP.echo, sec(2.5)).firstAbove).toBe(sec(2));
    });

    it('each repeat is the feedback times the one before (tone 1); a feedback of 2 is held to 0.95, one under 0 is none', () => {
      // A short low note (220 Hz, well under the tone filter) and the level of each of its repeats.
      const repeats = (seconds: number, feedback: number, count: number) => {
        const len = sec(0.04);
        k.again(); k.set(seconds, feedback, 1); k.input(IN.sine, 1, len, 220);
        const n = sec(seconds * (count + 1));
        clean(k.run(OP.echo, n));
        return Array.from({ length: count }, (_, i) => rms(k.out(len, sec(seconds * (i + 1)))));
      };
      const half = repeats(0.25, 0.6, 5);
      for (let i = 1; i < half.length; i++) expect(half[i]! / half[i - 1]!).toBeCloseTo(0.6, 2);
      const most = repeats(0.05, 2, 8);
      for (let i = 1; i < most.length; i++) expect(most[i]! / most[i - 1]!).toBeCloseTo(0.95, 2);
      const none = repeats(0.1, -0.5, 3);
      expect(none[0]!).toBeGreaterThan(0.5);
      expect(none[1]).toBe(0);
      // A darker tone: the second repeat of noise is duller (less of it left) than with tone 1.
      const second = (tone: number) => {
        k.again(); k.set(0.1, 0.8, tone); k.input(IN.noise, 1, sec(0.05));
        k.run(OP.echo, sec(0.3));
        return rms(k.out(sec(0.05), sec(0.2))) / rms(k.out(sec(0.05), sec(0.1)));
      };
      expect(second(0)).toBeLessThan(0.5 * second(1));
    });

    it('`tail()` is at least the time the repeats take to fall 60 dB, and under 43 seconds at any setting', () => {
      for (const [seconds, feedback] of [[0.25, 0.5], [0.1, 0.8], [0.05, 0.95], [0.5, 0.95], [1, 0.9], [2, 2], [0.01, 0.3], [0.0001, 0.95], [0.3, 0]] as const) {
        k.again(); k.set(seconds, feedback, 1); k.input(IN.impulse); k.watch(0.001);
        const s = k.run(OP.echo, sec(45));
        clean(s);
        const note = `echo(${seconds}, ${feedback}): −60 dB after ${(s.lastAbove / rate).toFixed(2)} s, tail ${s.aux.toFixed(2)}`;
        expect(s.aux * rate, note).toBeGreaterThanOrEqual(s.lastAbove);
        expect(s.aux, note).toBeLessThan(43);
        expect(s.lastAbove, note).toBeLessThan(sec(40.5));   // nothing rings past 40 seconds
      }
    });

    it('never runs away: at the most feedback the echoes of a full-scale sound stay under 20 (1 / (1 − 0.95)), and die', () => {
      // The worst input: a square whose period is the echo's time, so every repeat adds up.
      k.again(); k.set(0.01, 2, 1); k.input(IN.square, 1, sec(5), 100); k.watch(1e300, sec(9));
      let s = k.run(OP.echo, sec(10));
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(20 * (1 + 1e-6));
      expect(s.peak).toBeGreaterThan(15);
      expect(s.peakAfter).toBeLessThan(s.peak * 1e-6);
      for (const settings of [[2, 2, 1], [rand(-1, 5), rand(-1, 2), rand(-1, 2)], [sweep(0.0001, 4), 2, 1], [line(3, -1), line(-1, 2), 0.5]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners, 1, sec(10));
        s = k.run(OP.echo, sec(20));
        clean(s);
        expect(s.peak).toBeLessThan(20);
      }
    });

    it('silence after a burst: no subnormal number in 20 seconds, and exactly 0 once the repeats have gone', () => {
      let s = afterBurst(OP.echo, [0.01, 0.9, 1], 20.5);
      clean(s);
      endsAtZero(s, 20.5);
      s = afterBurst(OP.echo, [0.003, 2, 0.3], 20.5);
      clean(s);
      endsAtZero(s, 20.5);
      s = afterBurst(OP.echo, [2, 2, 1], 20.5);   // still ringing at 20 s (it takes 40 to fall 60 dB)
      clean(s);
      if (rate === 48000) {
        // The longest echo there is, all the way down: 300 seconds, and the end is exact silence.
        s = afterBurst(OP.echo, [2, 2, 1], 300);
        clean(s);
        endsAtZero(s, 300);
      }
    });

    it('the short call (tone left out) is tone 1', () => {
      k.again(); k.P.defaults!(OP.echo, 0.1, sec(0.35));
      const short = k.out(sec(0.35));
      k.again(); k.set(0.1, 0.5, 1); k.input(IN.impulse); k.run(OP.echo, sec(0.35));
      expect(Array.from(short)).toEqual(Array.from(k.out(sec(0.35))));
    });
  });

  describe('PingPong', () => {
    it('the repeats alternate left, right, left, each the feedback times the one before', () => {
      const T = sec(0.1);
      k.again(); k.set(0.1, 0.5); k.input(IN.impulse);
      const s = k.run(OP.pong, 5 * T + 10);
      clean(s);
      const l = k.out(5 * T + 10), r = k.outR(5 * T + 10);
      expect([l[T], l[2 * T], l[3 * T], l[4 * T], l[5 * T]]).toEqual([1, 0, 0.25, 0, 0.0625]);
      expect([r[T], r[2 * T], r[3 * T], r[4 * T], r[5 * T]]).toEqual([0, 0.5, 0, 0.125, 0]);
      expect(l.filter(v => v !== 0).length).toBe(3);
      expect(r.filter(v => v !== 0).length).toBe(2);
    });

    it('`tail()` covers the repeats; a time past its length is its length (1 second) at every rate; the feedback is held to 0.95', () => {
      for (const [seconds, feedback] of [[0.25, 0.5], [0.1, 0.9], [1, 2], [0.02, 0.95], [0.3, 0]] as const) {
        k.again(); k.set(seconds, feedback); k.input(IN.impulse); k.watch(0.001);
        const s = k.run(OP.pong, sec(45));
        clean(s);
        const note = `pong(${seconds}, ${feedback}): −60 dB after ${(s.lastAbove / rate).toFixed(2)} s, tail ${s.aux.toFixed(2)}`;
        expect(s.aux * rate, note).toBeGreaterThanOrEqual(s.lastAbove);
        expect(s.aux, note).toBeLessThan(43);
      }
      k.again(); k.set(3, 0.5); k.input(IN.impulse); k.watch(0.9);
      expect(k.run(OP.pong, sec(1.5)).firstAbove).toBe(rate);
      k.again(); k.set(0.05, 2); k.input(IN.impulse); k.run(OP.pong, sec(0.2));
      expect(k.outR(1, sec(0.1))[0]!).toBeCloseTo(0.95, 6);
    });

    it('never runs away (under 20 at the most feedback), and silence after a burst ends at exactly 0 with no subnormal number', () => {
      // Its loop is two delays long: a square of that period is the worst input.
      k.again(); k.set(0.01, 2); k.input(IN.square, 1, sec(5), 50);
      let s = k.run(OP.pong, sec(6));
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(20 * (1 + 1e-6));
      for (const settings of [[1, 2], [rand(-1, 3), rand(-1, 2)], [sweep(0.0001, 4), 2]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners, 1, sec(8));
        s = k.run(OP.pong, sec(12));
        clean(s);
        expect(s.peak).toBeLessThan(20);
      }
      s = afterBurst(OP.pong, [0.01, 0.9], 20.5);
      clean(s);
      endsAtZero(s, 20.5);
      s = afterBurst(OP.pong, [1, 2], 20.5);
      clean(s);
    });
  });

  // --- Reverb -----------------------------------------------------------------------------------------

  describe('Reverb', () => {
    it('rings for the seconds asked (−60 dB, within 10 %) at every rate, and `tail()` covers what is heard', () => {
      for (const seconds of [0.5, 1, 2.5]) {
        const n = sec(seconds * 1.6 + 1);
        k.again(); k.set(seconds, 0); k.input(IN.impulse); k.watch(0);
        const peak = k.run(OP.reverb, 8192).peak;
        k.again(); k.set(seconds, 0); k.input(IN.impulse); k.watch(peak * 0.001);
        const s = k.run(OP.reverb, n);
        clean(s);
        const got = rt60(k.out(n), rate);
        const note = `reverb ${seconds} s: measured ${got.toFixed(2)} s; −60 dB under its peak after ${(s.lastAbove / rate).toFixed(2)} s; tail ${s.aux.toFixed(2)}`;
        expect(Math.abs(got - seconds) / seconds, note).toBeLessThan(0.1);
        expect(s.aux * rate, note).toBeGreaterThanOrEqual(s.lastAbove);
        expect(s.aux).toBeCloseTo(seconds * 1.25 + 0.3, 9);
      }
      for (const [seconds, damping] of [[20, 0], [20, 1], [3, 1], [0.2, 0.5]] as const) {
        k.again(); k.set(seconds, damping); k.input(IN.impulse); k.watch(0);
        const peak = k.run(OP.reverb, 8192).peak;
        k.again(); k.set(seconds, damping); k.input(IN.impulse); k.watch(peak * 0.001);
        const s = k.run(OP.reverb, sec(seconds * 1.3 + 1));
        expect(s.aux * rate, `reverb ${seconds} s, damping ${damping}: −60 dB after ${(s.lastAbove / rate).toFixed(2)} s, tail ${s.aux.toFixed(2)}`).toBeGreaterThanOrEqual(s.lastAbove);
      }
    });

    it('damping takes the highs away sooner; the two sides differ; times out of range are 0.2 and 20 seconds', () => {
      const highs = (damping: number) => {
        k.again(); k.set(2, damping); k.input(IN.impulse); k.run(OP.reverb, sec(1));
        const o = k.out(sec(0.5), sec(0.5));
        const d = o.map((v, i) => (i ? v - o[i - 1]! : 0));
        return rms(d) / rms(o);
      };
      expect(highs(1)).toBeLessThan(0.5 * highs(0));
      k.again(); k.set(2, 0.5); k.input(IN.noise, 1, sec(0.1)); k.run(OP.reverb, sec(1));
      const l = k.out(sec(1)), r = k.outR(sec(1));
      expect(rms(l.map((v, i) => v - r[i]!))).toBeGreaterThan(0.5 * rms(l));
      const tailOf = (seconds: number) => { k.again(); k.set(seconds, 0.5); k.input(IN.impulse); return k.run(OP.reverb, 100).aux; };
      expect(tailOf(-5)).toBeCloseTo(0.2 * 1.25 + 0.3, 9);
      expect(tailOf(400)).toBeCloseTo(20 * 1.25 + 0.3, 9);
      // The short call (2 seconds, damping 0.5) sounds.
      k.again(); k.P.defaults!(OP.reverb, 0, 5000);
      expect(k.out(5000).some(v => v !== 0)).toBe(true);
    });

    it('is bounded at the longest decay (20 s) for a minute of full-scale noise and a full-scale sweep (measured under 6.5; held under 12), and with any settings', () => {
      const peaks: number[] = [];
      k.again(); k.set(20, 0); k.input(IN.corners);
      let s = k.run(OP.reverb, sec(60));
      clean(s);
      peaks.push(s.peak);
      k.again(); k.set(20, 0); k.input(IN.sine, 1, -1, sweep(20, 5000));
      s = k.run(OP.reverb, sec(40));
      clean(s);
      peaks.push(s.peak);
      for (const settings of [[rand(-5, 40), rand(-1, 2)], [400, -3], [sweep(0.01, 100), line(2, -1)]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners);
        s = k.run(OP.reverb, sec(20));
        clean(s);
        peaks.push(s.peak);
      }
      expect(Math.max(...peaks), peaks.map(p => p.toFixed(2)).join(' ')).toBeLessThan(12);
    });

    it('silence after a burst: no subnormal number in 20 seconds, and exactly 0 once it has rung out', () => {
      for (const damping of [0, 1]) {
        const s = afterBurst(OP.reverb, [1, damping], 20.5);
        clean(s);
        endsAtZero(s, 20.5);
      }
      let s = afterBurst(OP.reverb, [20, 0.5], 20.5);   // still ringing
      clean(s);
      if (rate === 48000) {
        // The longest decay all the way down: 200 seconds, and the end is exact silence.
        s = afterBurst(OP.reverb, [20, 0], 200);
        clean(s);
        endsAtZero(s, 200);
      }
    });
  });

  // --- Chorus, Flanger --------------------------------------------------------------------------------

  describe('Chorus and Flanger', () => {
    it('Chorus: a moved copy of the sound, different each side, never louder than it; silent 50 ms (its tail) after the sound', () => {
      k.again(); k.input(IN.sine, 1, -1, 440); k.run(OP.input, sec(1));
      const dry = k.out(sec(1));
      k.again(); k.set(0.8, 0.5); k.input(IN.sine, 1, -1, 440);
      let s = k.run(OP.chorus, sec(1));
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(1 + 1e-6);
      expect(s.aux).toBe(0.05);
      const l = k.out(sec(1)), r = k.outR(sec(1));
      expect(rms(l.map((v, i) => v - dry[i]!), sec(0.1))).toBeGreaterThan(0.3);
      expect(rms(l.map((v, i) => v - r[i]!), sec(0.1))).toBeGreaterThan(0.05);
      expect(rms(l, sec(0.1))).toBeGreaterThan(0.5);
      for (const settings of [[rand(-5, 50), rand(-1, 2)], [1e9, 5], [-1, -1], [sweep(0.01, 100), line(2, -1)]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners);
        s = k.run(OP.chorus, sec(5));
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1 + 1e-6);
      }
      s = afterBurst(OP.chorus, [5, 1], 20.5);
      clean(s);
      expect(s.lastNonZero).toBeLessThanOrEqual(sec(0.5) + sec(0.05));
      // The short call: 0.8 Hz, depth 0.5.
      k.again(); k.P.defaults!(OP.chorus, 0.5, sec(0.1));
      expect(k.out(1, sec(0.1) - 1)[0]).toBe(0.5);
    });

    it('Flanger: a comb that sweeps; its feedback is held to 0.9, so a full-scale sound stays under 10 (1 / (1 − 0.9)); `tail()` covers its ring', () => {
      k.again(); k.input(IN.noise, 1, -1); k.run(OP.input, sec(1));
      const dry = k.out(sec(1));
      k.again(); k.set(0.3, 0.7, 0.5); k.input(IN.noise, 1, -1);
      let s = k.run(OP.flanger, sec(1));
      clean(s);
      const l = k.out(sec(1)), r = k.outR(sec(1));
      expect(rms(l.map((v, i) => v - dry[i]!), sec(0.1))).toBeGreaterThan(0.3);
      expect(rms(l.map((v, i) => v - r[i]!), sec(0.1))).toBeGreaterThan(0.05);
      // The worst input: a square whose period is the delay (3.5 ms), the sweep stopped, the feedback asked far too high.
      k.again(); k.set(0, 0, 2); k.input(IN.square, 1, -1, 1 / 0.0035);
      s = k.run(OP.flanger, sec(3));
      clean(s);
      expect(s.peak).toBeLessThanOrEqual(10 * (1 + 1e-6));
      expect(s.peak).toBeGreaterThan(8);
      for (const settings of [[rand(-5, 50), rand(-1, 2), rand(-1, 2)], [1e9, 5, 5], [sweep(0.01, 100), line(2, -1), 0.9]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners);
        s = k.run(OP.flanger, sec(10));
        clean(s);
        expect(s.peak).toBeLessThan(10);
      }
      for (const feedback of [0, 0.5, 0.9, 2]) {
        k.again(); k.set(0.3, 0.7, feedback); k.input(IN.impulse); k.watch(0.001);
        s = k.run(OP.flanger, sec(3));
        expect(s.aux * rate, `feedback ${feedback}: −60 dB after ${(s.lastAbove / rate).toFixed(3)} s, tail ${s.aux.toFixed(3)}`).toBeGreaterThanOrEqual(s.lastAbove);
      }
      s = afterBurst(OP.flanger, [0.3, 0.7, 2], 20.5);
      clean(s);
      endsAtZero(s, 20.5);
      // The short call: 0.3 Hz, depth 0.7, feedback 0.5: a steady input settles at 1 / (1 − 0.5).
      k.again(); k.P.defaults!(OP.flanger, 0.5, sec(0.5));
      expect(k.out(1, sec(0.5) - 1)[0]!).toBeCloseTo(1, 3);
    });
  });

  // --- Crusher, Compressor, Limiter -------------------------------------------------------------------

  describe('Crusher', () => {
    it('rounds to 2^bits steps across −1 to 1, never further from the input than half a step', () => {
      for (const bits of [1, 3, 8, 16]) {
        const steps = 2 ** bits / 2, n = 100000;
        k.again(); k.set(bits, rate); k.input(IN.line);
        const s = k.run(OP.crusher, n);
        clean(s);
        expect(s.peak).toBe(1);
        const o = k.out(n);
        const seen = new Set<number>();
        let offStep = 0, furthest = 0;
        for (let i = 0; i < n; i++) {
          const v = o[i]! * steps;
          if (v !== Math.round(v)) offStep++;
          seen.add(v);
          furthest = Math.max(furthest, Math.abs(o[i]! - (2 * i / (n - 1) - 1)));
        }
        expect(offStep).toBe(0);
        expect(furthest).toBeLessThanOrEqual(0.5 / steps + 1e-12);
        // 2^bits steps from −1 to 1: 2^bits + 1 levels with both ends.
        expect(seen.size).toBe(Math.min(2 ** bits + 1, seen.size));
        if (bits <= 8) expect(seen.size).toBe(2 ** bits + 1);
      }
    });

    it('holds each value for sample rate / rate samples: a rate in Hz, the same at every sample rate; bits and rates out of range are the nearest in range', () => {
      k.again(); k.set(16, 1000); k.input(IN.noise);
      let s = k.run(OP.crusher, sec(2));
      clean(s);
      expect(Math.abs(s.changes - 2000)).toBeLessThanOrEqual(2);
      k.again(); k.set(16, rate / 4); k.input(IN.noise);
      s = k.run(OP.crusher, 40000);
      expect(Math.abs(s.changes - 10000)).toBeLessThanOrEqual(2);
      const same = (a: Setting[], b: Setting[]) => {
        k.again(); k.set(...a); k.input(IN.noise); k.run(OP.crusher, 20000);
        const x = k.out(20000);
        k.again(); k.set(...b); k.input(IN.noise); k.run(OP.crusher, 20000);
        expect(Array.from(k.out(20000))).toEqual(Array.from(x));
      };
      same([0, rate], [1, rate]);
      same([-4, rate], [1, rate]);
      same([40, rate], [16, rate]);
      same([8, 1e9], [8, rate]);
      same([8, -5], [8, 20]);
      // Bits between two whole numbers too: a full-scale input is never rounded past full scale.
      for (const settings of [[rand(-5, 40), rand(-100, 2 * rate)], [sweep(0.1, 100), sweep(1, 1e6)], [1.6, rate], [2.5, rate], [line(1, 16), rate]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners);
        s = k.run(OP.crusher, 200000);
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1);
      }
      // The short call takes every sample; silence in is silence out, at once.
      k.again(); k.P.defaults!(OP.crusher, 0.3, 4);
      expect(Array.from(k.out(4))).toEqual([0.25, 0.25, 0.25, 0.25]);
      s = afterBurst(OP.crusher, [4, 100], 20.5);
      clean(s);
      endsAtZero(s, 20.5);
    });
  });

  describe('Compressor', () => {
    it('a steady sine 12 dB over the threshold at 4:1 settles about 9 dB down (8.3: it follows the level just under the peaks), the same at every rate', () => {
      for (const hz of [100, 1000]) {
        k.again(); k.set(-24, 4, 0.01, 0.15); k.input(IN.sine, 10 ** (-12 / 20), -1, hz);
        const s = k.run(OP.comp, sec(2));
        clean(s);
        const g = k.out(sec(0.5), sec(1.5));
        const mean = db(g.reduce((a, b) => a + b, 0) / g.length);
        expect(Math.abs(mean - -9), `${mean.toFixed(2)} dB`).toBeLessThan(1);
        expect(Math.abs(mean - -8.32), `${mean.toFixed(2)} dB`).toBeLessThan(0.1);
        expect(s.peak).toBe(1);   // the gain is never over 1
      }
    });

    it('under the threshold, or at a ratio of 1 or less, it leaves the sound alone; a huge ratio holds the level at the threshold', () => {
      k.again(); k.set(-6, 8, 0.01, 0.15); k.input(IN.sine, 0.4, -1, 300);
      expect(k.run(OP.comp, sec(1)).min).toBe(1);
      for (const ratio of [1, 0.5, 0, -4]) {
        k.again(); k.set(-30, ratio, 0.01, 0.15); k.input(IN.corners);
        expect(k.run(OP.comp, sec(1)).min).toBe(1);
      }
      k.again(); k.set(-20, 1e9, 0.0001, 0.15); k.input(IN.corners);
      k.run(OP.comp, sec(1));
      expect(k.out(1, sec(1) - 1)[0]!).toBeCloseTo(0.1, 3);
      // The short call: attack 10 ms, release 150 ms.
      k.again(); k.P.defaults!(OP.comp, 1, sec(1));
      const short = k.out(sec(1));
      k.again(); k.set(-12, 4, 0.01, 0.15); k.input(IN.corners);
      k.run(OP.comp, sec(1));
      expect(short[sec(1) - 1]!).toBeCloseTo(k.out(1, sec(1) - 1)[0]!, 9);
    });

    it('is safe with any settings (a gain over 0 and never over 1), and after a burst its gain comes back to exactly 1 with no subnormal number', () => {
      for (const settings of [[-200, 1e9, 0, 0], [20, 4, -1, -1], [rand(-100, 20), rand(-2, 100), rand(-1, 3), rand(-1, 10)], [-80, 1e9, 2, 5], [sweep(-0.01, -80), sweep(0.1, 1000), 1e9, 1e9]] as Setting[][]) {
        k.again(); k.set(...settings); k.input(IN.corners, 4);
        const s = k.run(OP.comp, sec(5));
        clean(s);
        expect(s.min).toBeGreaterThan(0);
        expect(s.min).toBeLessThanOrEqual(1);
        expect(s.peakR).toBeLessThanOrEqual(4);
      }
      for (const release of [0.15, 0.005]) {
        k.again(); k.set(-80, 20, 0.001, release); k.input(IN.corners, 4, sec(0.5));
        const n = sec(5);
        clean(k.run(OP.comp, n));
        const g = k.out(rate, n - rate);
        expect(g.every(v => v === 1)).toBe(true);
        const s = afterBurst(OP.comp, [-80, 20, 0.001, release], 20.5, IN.corners, 4);
        clean(s);
        expect(s.peakAfter).toBe(1);
      }
    });
  });

  describe('Limiter', () => {
    it('nothing passes the ceiling: |x| × gain is at or under it at every sample of a noisy input four times full scale', () => {
      for (const ceiling of [-1, -6, 0, -40]) {
        const c = 10 ** (ceiling / 20);
        for (const kind of [IN.noise, IN.corners]) {
          k.again(); k.set(ceiling); k.input(kind, 4);
          const s = k.run(OP.limiter, sec(5));
          clean(s);
          expect(s.peakR, `ceiling ${ceiling} dB`).toBeLessThanOrEqual(c * (1 + 1e-12));
          expect(s.peakR).toBeGreaterThan(c * 0.99);
          expect(s.min).toBeGreaterThan(0);
          expect(s.peak).toBeLessThanOrEqual(1);
        }
      }
      // A ceiling out of range is 0 dB or −40 dB; the short call's is −1 dB.
      k.again(); k.set(12); k.input(IN.corners, 4);
      expect(k.run(OP.limiter, 1000).peakR).toBe(1);
      k.again(); k.set(-300); k.input(IN.corners, 4);
      expect(k.run(OP.limiter, 1000).peakR).toBeCloseTo(0.01, 9);
      k.again(); k.P.defaults!(OP.limiter, 2, 10);
      expect(k.out(1)[0]! * 2).toBeCloseTo(10 ** (-1 / 20), 9);
    });

    it('leaves a sound under the ceiling alone, and lets go in the same time at every rate: back to exactly 1 (80 ms × ln(4 / ceiling) after a burst at 4)', () => {
      k.again(); k.set(-1); k.input(IN.sine, 0.8, -1, 440);
      expect(k.run(OP.limiter, sec(1)).min).toBe(1);
      const burst = sec(0.2), c = 10 ** (-1 / 20);
      k.again(); k.set(-1); k.input(IN.corners, 4, burst); k.watch(1);
      const s = k.run(OP.limiter, sec(2));
      clean(s);
      expect(Math.abs(s.firstAbove - (burst + 0.08 * Math.log(4 / c) * rate))).toBeLessThanOrEqual(2);
      const g = k.out(sec(1), sec(1));
      expect(g.every(v => v === 1)).toBe(true);
      const long = afterBurst(OP.limiter, [-40], 20.5, IN.corners, 4);
      clean(long);
      expect(long.peakAfter).toBe(1);
      for (const ceiling of [rand(-100, 20), sweep(-0.001, -60)]) {
        k.again(); k.set(ceiling); k.input(IN.corners, 4);
        const r = k.run(OP.limiter, sec(5));
        clean(r);
        expect(r.peakR).toBeLessThanOrEqual(1 + 1e-12);
      }
    });
  });

  // --- The plain functions ----------------------------------------------------------------------------

  describe('drive, softClip, mix, pan, tanhFast, sinPhase, quiet', () => {
    it('tanhFast: within 2.6 % of tanh, rising everywhere, never past ±1', () => {
      let before = -1, worst = 0, falls = 0, peak = 0;
      for (let x = -8; x <= 8; x += 0.001) {
        const y = k.P.fTanh!(x);
        if (y < before) falls++;
        peak = Math.max(peak, Math.abs(y));
        if (Math.abs(x) > 1e-9) worst = Math.max(worst, Math.abs(y / Math.tanh(x) - 1));
        before = y;
      }
      expect(falls).toBe(0);
      expect(peak).toBe(1);
      expect(worst).toBeLessThan(0.026);   // 2.59 % at its worst (near x = 1.6)
      expect(k.P.fTanh!(0)).toBe(0);
      expect(k.P.fTanh!(1e300)).toBe(1);
      expect(k.P.fTanh!(-1e300)).toBe(-1);
      expect(k.P.fTanh!(1e-6)).toBeCloseTo(1e-6, 12);
    });

    it('sinPhase: within 0.2 % of full scale of the exact sine over the whole turn', () => {
      let worst = 0;
      for (let i = 0; i < 100000; i++) worst = Math.max(worst, Math.abs(k.P.fSinPhase!(i / 100000) - Math.sin(2 * Math.PI * i / 100000)));
      expect(worst).toBeLessThan(0.002);
      expect(k.P.fSinPhase!(0)).toBe(0);
      expect(k.P.fSinPhase!(0.25)).toBeCloseTo(1, 12);
      expect(k.P.fSinPhase!(0.75)).toBeCloseTo(-1, 12);
    });

    it('softClip: follows a quiet input, rounds off toward ±1, never passes it', () => {
      expect(k.P.fSoftClip!(0.01)).toBeCloseTo(0.01, 5);
      let before = -1, falls = 0, peak = 0;
      for (let x = -20; x <= 20; x += 0.0005) {
        const y = k.P.fSoftClip!(x);
        peak = Math.max(peak, Math.abs(y));
        if (y < before) falls++;
        before = y;
      }
      expect(peak).toBe(1);
      expect(falls).toBe(0);
      k.again(); k.input(IN.corners, 50);
      const s = k.run(OP.softClip, 50000);
      clean(s);
      expect(s.peak).toBe(1);
    });

    it('drive: full scale stays full scale at every amount, the output is within ±1 for any input, more drive is denser', () => {
      for (const amount of [0, 0.1, 0.5, 1, -3, 7]) {
        expect(k.P.fDrive!(1, amount)).toBe(1);
        expect(k.P.fDrive!(-1, amount)).toBe(-1);
        expect(k.P.fDrive!(0, amount)).toBe(0);
        let before = -1, falls = 0, peak = 0;
        for (let x = -4; x <= 4; x += 0.001) {
          const y = k.P.fDrive!(x, amount);
          peak = Math.max(peak, Math.abs(y));
          if (y < before) falls++;
          before = y;
        }
        expect(peak, `drive at ${amount}`).toBe(1);
        expect(falls).toBe(0);
      }
      expect(k.P.fDrive!(0.05, 1)).toBeGreaterThan(k.P.fDrive!(0.05, 0.5));
      expect(k.P.fDrive!(0.05, 0.5)).toBeGreaterThan(k.P.fDrive!(0.05, 0));
      expect(k.P.fDrive!(0.3, -3)).toBe(k.P.fDrive!(0.3, 0));
      expect(k.P.fDrive!(0.3, 7)).toBe(k.P.fDrive!(0.3, 1));
      for (const amount of [rand(-1, 2), 1]) {
        k.again(); k.set(amount); k.input(IN.noise, 30);
        const s = k.run(OP.drive, 100000);
        clean(s);
        expect(s.peak).toBeLessThanOrEqual(1);
      }
    });

    it('mix: 0 is the dry sound, 1 the wet, a half the middle', () => {
      expect(k.P.fMix!(0.3, -0.7, 0)).toBe(0.3);
      expect(k.P.fMix!(0.3, -0.7, 1)).toBeCloseTo(-0.7, 15);
      expect(k.P.fMix!(0.3, -0.7, 0.5)).toBeCloseTo(-0.2, 15);
    });

    it('pan: 1 on both sides at the centre, the same power at every position, all to one side at the ends', () => {
      expect(k.P.fPanLeft!(0)).toBe(1);
      expect(k.P.fPanRight!(0)).toBe(1);
      for (let pan = -1; pan <= 1; pan += 0.05) expect(k.P.fPanLeft!(pan) ** 2 + k.P.fPanRight!(pan) ** 2).toBeCloseTo(2, 12);
      expect([k.P.fPanLeft!(-1), k.P.fPanRight!(-1)]).toEqual([Math.SQRT2, 0]);
      expect([k.P.fPanLeft!(1), k.P.fPanRight!(1)]).toEqual([0, Math.SQRT2]);
      expect([k.P.fPanLeft!(-9), k.P.fPanRight!(9)]).toEqual([Math.SQRT2, Math.SQRT2]);
    });

    it('quiet: exactly 0 under 1e-20 (subnormal numbers included), untouched from there up', () => {
      for (const x of [5e-324, 2.2e-308, 1e-21, 9.99e-21, -1e-21, -5e-324]) expect(Math.abs(k.P.fQuiet!(x))).toBe(0);
      for (const x of [1e-20, -1e-20, 1e-19, 0.5, -3, 0]) expect(k.P.fQuiet!(x)).toBe(x);
    });
  });
});

describe('sound1 across the sample rates', () => {
  it('prepares for the rate given (and for 48 kHz when the rate is not one)', () => {
    for (const rate of RATES) expect(kit(rate).P.rate!()).toBe(rate);
    expect(kit(0).P.rate!()).toBe(48000);
    expect(kit(-1).P.rate!()).toBe(48000);
  });

  it('a module prepared at one rate and then another behaves as one made at the other (buffers are sized once, for 96 kHz)', () => {
    const a = kit(44100);
    a.set(0.3, 0.6, 1); a.input(IN.noise, 1, 2000); a.run(OP.echo, 44100);
    a.again(96000);
    const b = kit(96000);
    for (const [op, settings] of [[OP.echo, [0.3, 0.6, 1]], [OP.reverb, [1.5, 0.3]], [OP.lowpass, [800, 0.7]], [OP.flanger, [0.5, 0.5, 0.5]], [OP.tableSaw, [3000]], [OP.adsr, [0.01, 0.2, 0.4, 0.1]]] as [number, Setting[]][]) {
      for (const x of [a, b]) { x.again(); x.set(...settings); x.input(IN.noise, 1, 5000); x.watch(1e300, 30000); x.run(op, 96000); }
      expect(Array.from(a.out(96000))).toEqual(Array.from(b.out(96000)));
    }
  });
});
