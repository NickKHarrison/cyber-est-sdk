// sound1's probe (not a plugin): every block behind one `run(op, n)`, so sdk/tests/soundKit.test.ts can
// drive each for many samples in one call and read what came out. The test sets the settings a block
// is called with (`setP`: a constant, a sweep, a random value a sample, a switch part-way), its input
// (`setInput`) and then runs it; the first MAX samples of the left and right outputs are kept, and a
// summary of the whole run (`stat`). Top-level code is constants only, as in an EST module: the blocks
// are made in `init`, which also prepares the kit for the rate. One wasm instance per sample rate.

import {
  Adsr, Chorus, Compressor, Crusher, Delay, Echo, Filter, Flanger, Lfo, Limiter, Noise, OnePole, Osc, PingPong, Reverb, Smooth, Wavetable,
  drive, exp, ln, mix, panLeft, panRight, prepareSound, quiet, sampleRate, sinPhase, sinTurns, softClip, tanhFast,
} from "sound1";

// The kit's modules are built without AssemblyScript's own abort import (asconfig.json: abort=index/abort).
// @ts-ignore: used by the compiler
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

const MAX: i32 = 1 << 19;
const OUT_L = memory.data(MAX * 8, 16);
const OUT_R = memory.data(MAX * 8, 16);
const PARAMS = memory.data(8 * 32, 16);   // 8 settings: mode, a, b, at
const STATS = memory.data(16 * 8, 16);

export function output_ptr(): usize { return OUT_L; }
export function output_r_ptr(): usize { return OUT_R; }
export function max_frames(): i32 { return MAX; }

/** The blocks, one of each (two of what a test compares). */
class Rig {
  osc: Osc = new Osc();
  mod: Osc = new Osc();
  noise: Noise = new Noise();
  noise2: Noise = new Noise();
  src: Noise = new Noise();
  sineTable: Wavetable = new Wavetable();
  sawTable: Wavetable = new Wavetable();
  fullTable: Wavetable = new Wavetable();
  lfo: Lfo = new Lfo();
  filter: Filter = new Filter();
  pole: OnePole = new OnePole();
  smooth: Smooth = new Smooth();
  adsr: Adsr = new Adsr();
  delay: Delay = new Delay(1.0);
  echo: Echo = new Echo(2.0);
  pong: PingPong = new PingPong(1.0);
  reverb: Reverb = new Reverb();
  chorus: Chorus = new Chorus();
  flanger: Flanger = new Flanger();
  crusher: Crusher = new Crusher();
  comp: Compressor = new Compressor();
  limiter: Limiter = new Limiter();
  constructor() {
    this.sineTable.harmonic(1, 1.0);
    for (let k = 1; k <= 32; k++) { this.sawTable.harmonic(k, 1.0 / <f64>k); this.fullTable.harmonic(k, 1.0); }
  }
}
let rig: Rig | null = null;

/** Make the blocks (once) and prepare the kit for `rate`. */
export function init(rate: f64): void {
  if (rig == null) rig = new Rig();
  prepareSound(rate);
}
/** The kit prepared again (every block reset). */
export function again(rate: f64): void { prepareSound(rate); }
export function rate(): f64 { return sampleRate(); }

// --- Settings --------------------------------------------------------------------------------------

/** Setting `i` (0 to 7): mode 0 `a`; 1 a line from a to b over the run; 2 the same by ratio; 3 a random value from a to b each sample; 4 `a` until sample `at`, then `b`. */
export function setP(i: i32, mode: i32, a: f64, b: f64, at: i32): void {
  const p = PARAMS + (<usize>(i & 7) << 5);
  store<f64>(p, <f64>mode); store<f64>(p, a, 8); store<f64>(p, b, 16); store<f64>(p, <f64>at, 24);
}
let rnd: u32 = 0x1234567;
// @ts-ignore: decorator
@inline function uniform(): f64 { let x = rnd; x ^= x << 13; x ^= x >> 17; x ^= x << 5; rnd = x; return <f64>x * 2.3283064365386963e-10; }
function pv(i: i32, at: i32, n: i32): f64 {
  const p = PARAMS + (<usize>i << 5);
  const mode = <i32>load<f64>(p), a = load<f64>(p, 8), b = load<f64>(p, 16);
  if (mode == 0) return a;
  if (mode == 1) return a + (b - a) * <f64>at / <f64>n;
  if (mode == 2) return a * exp(ln(b / a) * <f64>at / <f64>n);
  if (mode == 3) return a + (b - a) * uniform();
  return at < <i32>load<f64>(p, 24) ? a : b;
}

// --- The input ---------------------------------------------------------------------------------------

let inKind: i32 = 0;
let inAmp: f64 = 1.0;
let inLen: i32 = -1;
let inPhase: f64 = 0.0;
/**
 * The input: kind 0 silence, 1 one sample of `amp` at the start, 2 white noise (the kit's), 3 a sine,
 * 4 a square, 5 a line from -amp to amp over the run, 6 white noise at full scale's corners (±amp).
 * The sine's and square's frequency is setting 7. `len` samples of it, then silence (-1: all the run).
 */
export function setInput(kind: i32, amp: f64, len: i32): void { inKind = kind; inAmp = amp; inLen = len; }
function input(g: Rig, at: i32, n: i32): f64 {
  if (inLen >= 0 && at >= inLen) return 0.0;
  const k = inKind;
  if (k == 0) return 0.0;
  if (k == 1) return at == 0 ? inAmp : 0.0;
  if (k == 2) return g.src.white() * inAmp;
  if (k == 5) return inAmp * (2.0 * <f64>at / <f64>(n > 1 ? n - 1 : 1) - 1.0);
  if (k == 6) return g.src.white() < 0.0 ? -inAmp : inAmp;
  const p = inPhase;
  let q = p + pv(7, at, n) / sampleRate();
  q -= <f64><i64>q;
  inPhase = q;
  return k == 3 ? inAmp * sinTurns(p) : (p < 0.5 ? inAmp : -inAmp);
}

// --- The summary -------------------------------------------------------------------------------------

let sPeak: f64 = 0.0;
let sBad: f64 = 0.0;        // not a number, or infinite
let sSub: f64 = 0.0;        // subnormal
let sUnder: f64 = 0.0;      // not 0 and under 1e-20
let sLastNonZero: f64 = -1.0;
let sLastAbove: f64 = -1.0;
let sFirstAbove: f64 = -1.0;
let sMark: f64 = -1.0;      // an op's own (when an envelope finished …)
let sChanges: f64 = 0.0;    // how often the left output changed
let sPeakAfter: f64 = 0.0;  // the peak from `after` on
let sAux: f64 = 0.0;        // an op's own (a tail in seconds …)
let sMinL: f64 = 0.0;
let sPeakR: f64 = 0.0;
let threshold: f64 = 1e300;
let after: i32 = 0;
let last: f64 = 0.0;
/** What `stat(5)` and `stat(6)` count as above, and where `stat(9)` starts. */
export function setWatch(level: f64, from: i32): void { threshold = level; after = from; }
/** 0 peak, 1 bad values, 2 subnormals, 3 under the floor, 4 last non-zero sample, 5 last above, 6 first above, 7 the op's mark, 8 changes, 9 peak after, 10 the op's own, 11 the least left value, 12 the right output's peak. */
export function stat(i: i32): f64 {
  switch (i) {
    case 0: return sPeak; case 1: return sBad; case 2: return sSub; case 3: return sUnder; case 4: return sLastNonZero;
    case 5: return sLastAbove; case 6: return sFirstAbove; case 7: return sMark; case 8: return sChanges; case 9: return sPeakAfter;
    case 10: return sAux; case 11: return sMinL; case 12: return sPeakR;
  }
  return 0.0;
}
// @ts-ignore: decorator
@inline function see(v: f64): void {
  const a = abs<f64>(v);
  if (!(a < 1e300)) sBad += 1.0;
  else if (a != 0.0) { if (a < 2.2250738585072014e-308) sSub += 1.0; if (a < 1e-20) sUnder += 1.0; }
}
// @ts-ignore: decorator
@inline function rec(at: i32, l: f64, r: f64): void {
  if (at < MAX) { store<f64>(OUT_L + (<usize>at << 3), l); store<f64>(OUT_R + (<usize>at << 3), r); }
  see(l); see(r);
  const al = abs<f64>(l), ar = abs<f64>(r);
  const a = al > ar ? al : ar;
  if (a > sPeak) sPeak = a;
  if (ar > sPeakR) sPeakR = ar;
  if (at >= after && a > sPeakAfter) sPeakAfter = a;
  if (a != 0.0) sLastNonZero = <f64>at;
  if (a >= threshold) { sLastAbove = <f64>at; if (sFirstAbove < 0.0) sFirstAbove = <f64>at; }
  if (at > 0 && l != last) sChanges += 1.0;
  if (at == 0 || l < sMinL) sMinL = l;
  last = l;
}

// --- The run -----------------------------------------------------------------------------------------

let ownPhase: f64 = 0.0;
/** A triangle with the corner correction scaled by `k` (0: none), on its own phase: what `Osc.triangle` is compared with. */
function ownTriangle(hz: f64, k: f64): f64 {
  const dt = hz / sampleRate();
  const p = ownPhase;
  let q = p + dt;
  if (q >= 1.0) q -= 1.0;
  ownPhase = q;
  let h = p + 0.5;
  if (h >= 1.0) h -= 1.0;
  return 1.0 - 4.0 * abs<f64>(p - 0.5) + k * dt * (corner(p, dt) - corner(h, dt));
}
function corner(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt - 1.0; return -(1.0 / 3.0) * x * x * x; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt + 1.0; return (1.0 / 3.0) * x * x * x; }
  return 0.0;
}

/**
 * Block `op` for `n` samples, called with settings 0 to 3 (in the block's own argument order) and the
 * input. The summary starts again; the blocks keep their state (call `again` to clear them).
 */
export function run(op: i32, n: i32): void {
  const g = rig!;
  sPeak = 0.0; sBad = 0.0; sSub = 0.0; sUnder = 0.0; sLastNonZero = -1.0; sLastAbove = -1.0; sFirstAbove = -1.0;
  sMark = -1.0; sChanges = 0.0; sPeakAfter = 0.0; sAux = 0.0; sMinL = 0.0; sPeakR = 0.0; last = 0.0;
  inPhase = 0.0; ownPhase = 0.0;
  for (let i = 0; i < n; i++) {
    const a = pv(0, i, n), b = pv(1, i, n), c = pv(2, i, n), d = pv(3, i, n);
    let l = 0.0, r = 0.0;
    switch (op) {
      case 1: l = g.osc.sine(a, b); r = g.osc.phase; break;
      case 2: l = g.osc.saw(a); r = g.osc.phase; break;
      case 3: l = g.osc.square(a); r = g.osc.phase; break;
      case 4: l = g.osc.pulse(a, b); r = g.osc.phase; break;
      case 5: l = g.osc.triangle(a); r = g.osc.phase; break;
      case 6: l = ownTriangle(a, b); break;
      case 7: l = g.osc.sine(a, g.mod.sine(c) * b); break;               // a carrier, a modulator at `c`, the amount `b`
      case 10: l = g.noise.white(); r = g.noise2.white(); break;
      case 11: l = g.noise.pink(); break;
      case 12: l = g.noise.random(); break;
      case 13: l = g.sineTable.next(a); break;
      case 14: l = g.sawTable.next(a); break;
      case 15: l = g.fullTable.next(a); break;
      case 20: l = g.lfo.sine(a); r = g.lfo.phase; break;
      case 21: l = g.lfo.triangle(a); r = g.lfo.phase; break;
      case 22: l = g.lfo.saw(a); r = g.lfo.phase; break;
      case 23: l = g.lfo.square(a); r = g.lfo.phase; break;
      case 24: l = g.lfo.random(a); r = g.lfo.phase; break;
      case 30: l = g.filter.lowpass(input(g, i, n), a, b); sAux = g.filter.tail(); break;
      case 31: l = g.filter.highpass(input(g, i, n), a, b); sAux = g.filter.tail(); break;
      case 32: l = g.filter.bandpass(input(g, i, n), a, b); sAux = g.filter.tail(); break;
      case 33: l = g.filter.notch(input(g, i, n), a, b); sAux = g.filter.tail(); break;
      case 34: l = g.pole.lowpass(input(g, i, n), a); sAux = g.pole.tail(); break;
      case 35: l = g.pole.highpass(input(g, i, n), a); break;
      case 36: l = g.smooth.next(a, b); r = g.smooth.value; break;
      case 40: {
        g.adsr.set(a, b, c, d);
        if (i == 0) g.adsr.start();
        if (i == after) g.adsr.release();
        l = g.adsr.next();
        if (sMark < 0.0 && i > 0 && g.adsr.done()) sMark = <f64>i;
        sAux = g.adsr.releaseSeconds();
        break;
      }
      case 41: {
        g.adsr.perc(a, b);
        if (i == 0) g.adsr.start();
        l = g.adsr.next();
        if (sMark < 0.0 && i > 0 && g.adsr.done()) sMark = <f64>i;
        sAux = g.adsr.releaseSeconds();
        break;
      }
      case 50: { l = g.delay.read(a); g.delay.write(input(g, i, n)); sAux = g.delay.tail(); break; }
      case 51: { l = g.echo.process(input(g, i, n), a, b, c); if (i == 0) sAux = g.echo.tail(); break; }
      case 52: { const x = input(g, i, n); g.pong.process(x, x, a, b); l = g.pong.l; r = g.pong.r; if (i == 0) sAux = g.pong.tail(); break; }
      case 53: { const x = input(g, i, n); g.reverb.process(x, x, a, b); l = g.reverb.l; r = g.reverb.r; if (i == 0) sAux = g.reverb.tail(); break; }
      case 54: { const x = input(g, i, n); g.chorus.process(x, x, a, b); l = g.chorus.l; r = g.chorus.r; sAux = g.chorus.tail(); break; }
      case 55: { const x = input(g, i, n); g.flanger.process(x, x, a, b, c); l = g.flanger.l; r = g.flanger.r; if (i == 0) sAux = g.flanger.tail(); break; }
      case 56: { const x = input(g, i, n); g.reverb.process(x, -x, a, b); l = g.reverb.l; r = g.reverb.r; break; }
      case 60: l = g.crusher.process(input(g, i, n), a, b); break;
      case 61: { const x = input(g, i, n); l = g.comp.gain(x, x, a, b, c, d); r = x * l; break; }
      case 62: { const x = input(g, i, n); l = g.limiter.gain(x, x * 0.5, a); r = x * l; break; }
      case 63: l = drive(input(g, i, n), a); break;
      case 64: l = softClip(input(g, i, n)); break;
      case 70: l = input(g, i, n); break;                                 // the input alone
      default: break;
    }
    rec(i, l, r);
  }
}
/** The default arguments (a block called the short way). */
export function defaults(op: i32, x: f64, n: i32): void {
  const g = rig!;
  for (let i = 0; i < n; i++) {
    let l = 0.0, r = 0.0;
    switch (op) {
      case 1: l = g.osc.sine(x); break;
      case 30: l = g.filter.lowpass(x, 1000.0); break;
      case 36: l = g.smooth.next(x); break;
      case 51: l = g.echo.process(i == 0 ? 1.0 : 0.0, x, 0.5); break;
      case 53: g.reverb.process(i == 0 ? 1.0 : 0.0, 0.0); l = g.reverb.l; r = g.reverb.r; break;
      case 54: g.chorus.process(x, x); l = g.chorus.l; r = g.chorus.r; break;
      case 55: g.flanger.process(x, x); l = g.flanger.l; r = g.flanger.r; break;
      case 60: l = g.crusher.process(x, 4.0); break;
      case 61: l = g.comp.gain(x, x, -12.0, 4.0); break;
      case 62: l = g.limiter.gain(x, x); break;
      default: break;
    }
    if (i < MAX) { store<f64>(OUT_L + (<usize>i << 3), l); store<f64>(OUT_R + (<usize>i << 3), r); }
  }
}

// --- The plain functions ---------------------------------------------------------------------------

export function fDrive(x: f64, amount: f64): f64 { return drive(x, amount); }
export function fSoftClip(x: f64): f64 { return softClip(x); }
export function fMix(dry: f64, wet: f64, amount: f64): f64 { return mix(dry, wet, amount); }
export function fPanLeft(pan: f64): f64 { return panLeft(pan); }
export function fPanRight(pan: f64): f64 { return panRight(pan); }
export function fTanh(x: f64): f64 { return tanhFast(x); }
export function fSinPhase(p: f64): f64 { return sinPhase(p); }
export function fQuiet(x: f64): f64 { return quiet(x); }
