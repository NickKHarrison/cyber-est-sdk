// sound1's sources and shapers: oscillators, noise, a wavetable, the LFO, filters and a smoother.
// Every `next`-like method is called once a sample and takes its settings as arguments (Hz, seconds,
// 0 to 1), so there is nothing to set up: the sample rate is the kit's.

import { clamp, exp } from "est";
import { Block, sampleRate } from "./core";
import { quiet, sinPhase, tanPiFast } from "./fast";

/** The polyBLEP residual: what rounds a step at phase `t` (0 to 1) moving `dt` a sample. */
// @ts-ignore: decorator
@inline function blep(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}
/** The polyBLAMP residual: what rounds a corner. */
// @ts-ignore: decorator
@inline function blamp(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt - 1.0; return -(1.0 / 3.0) * x * x * x; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt + 1.0; return (1.0 / 3.0) * x * x * x; }
  return 0.0;
}

/**
 * An oscillator, -1 to 1, band-limited (no aliasing whine on high notes). Call ONE of its waves once
 * a sample with the frequency in Hz: `this.osc.saw(this.hz)`. Use one `Osc` per sound source.
 */
export class Osc extends Block {
  phase: f64 = 0.0;
  constructor() { super(); }
  reset(): void { this.phase = 0.0; }

  /** The phase's step for `hz`, kept under the Nyquist limit; moves the phase and returns the phase before. */
  // @ts-ignore: decorator
  @inline private step(dt: f64): f64 {
    const p = this.phase;
    let q = p + dt;
    if (q >= 1.0) q -= 1.0;
    this.phase = q;
    return p;
  }
  // @ts-ignore: decorator
  @inline private dtOf(hz: f64): f64 { const d = hz / sampleRate(); return d > 0.0 ? (d < 0.45 ? d : 0.45) : 0.0; }

  /** A sine. `fm` adds to the phase, in turns (frequency modulation: another oscillator's output times an amount). */
  sine(hz: f64, fm: f64 = 0.0): f64 {
    let p = this.step(this.dtOf(hz)) + fm;
    p -= <f64><i64>p;
    if (p < 0.0) p += 1.0;
    return sinPhase(p);
  }
  saw(hz: f64): f64 {
    const dt = this.dtOf(hz);
    const p = this.step(dt);
    return 2.0 * p - 1.0 - blep(p, dt);
  }
  square(hz: f64): f64 { return this.pulse(hz, 0.5); }
  /** A pulse wave; `width` 0.05 to 0.95 (0.5 is a square). */
  pulse(hz: f64, width: f64): f64 {
    const dt = this.dtOf(hz);
    const p = this.step(dt);
    const w = width > 0.05 ? (width < 0.95 ? width : 0.95) : 0.05;
    let q = p + 1.0 - w;
    if (q >= 1.0) q -= 1.0;
    return (p < w ? 1.0 : -1.0) + blep(p, dt) - blep(q, dt);
  }
  triangle(hz: f64): f64 {
    const dt = this.dtOf(hz);
    const p = this.step(dt);
    let q = p + 0.5;
    if (q >= 1.0) q -= 1.0;
    // The corners' slope changes by 8·dt a sample; the residual of a unit change is blamp / 2.
    return 1.0 - 4.0 * abs<f64>(p - 0.5) - 4.0 * dt * (blamp(q, dt) - blamp(p, dt));
  }
}

/** The seed the next `Noise` takes: each gets its own, the same on every run. */
let noiseSeeds: u32 = 0x9e3779b9;

/** Noise, -1 to 1, the same on every run (so an export equals what was heard). */
export class Noise extends Block {
  private seed: u32;
  private x: u32;
  private b0: f64 = 0.0;
  private b1: f64 = 0.0;
  private b2: f64 = 0.0;
  constructor() {
    super();
    noiseSeeds = noiseSeeds * 1664525 + 1013904223;
    this.seed = noiseSeeds | 1;
    this.x = this.seed;
  }
  reset(): void { this.x = this.seed; this.b0 = 0.0; this.b1 = 0.0; this.b2 = 0.0; }
  /** White noise (hiss). */
  // @ts-ignore: decorator
  @inline white(): f64 {
    let x = this.x;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    this.x = x;
    return <f64><i32>x * 4.656612873077393e-10;
  }
  /** Pink noise (softer, like rain): about -1 to 1 (as loud as white noise at a third of its level). */
  pink(): f64 {
    const w = this.white();
    this.b0 = quiet(0.99765 * this.b0 + w * 0.0990460);
    this.b1 = quiet(0.96300 * this.b1 + w * 0.2965164);
    this.b2 = quiet(0.57000 * this.b2 + w * 1.0526913);
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.125;
  }
  /** A random value 0 to 1 (for a chance, or a random pitch). */
  random(): f64 { return this.white() * 0.5 + 0.5; }
}

/** A table's size and how many band-limited copies it keeps (each an octave higher has half the harmonics). */
const TABLE: i32 = 1024;
const LEVELS: i32 = 6;
const HARMONICS: i32 = 32;
// Built tables are shared by every `Wavetable` with the same harmonics: a list of (hash, pointer).
let tableKeys: usize = 0;
let tableCount: i32 = 0;
const TABLE_SLOTS: i32 = 16;

/**
 * A wavetable oscillator: a wave drawn from harmonics. In the constructor, `this.wave.harmonic(1, 1.0);
 * this.wave.harmonic(2, 0.5);` (harmonic number 1 to 32, its level); then `this.wave.next(hz)` once a
 * sample. Band-limited: high notes drop the harmonics that would alias.
 */
export class Wavetable extends Block {
  private amps: StaticArray<f64> = new StaticArray<f64>(HARMONICS);
  private data: usize = 0;
  private phase: f64 = 0.0;
  constructor() { super(); }
  /** Harmonic `n` (1 is the fundamental) at `level` (0 to 1). Constructor only. */
  harmonic(n: i32, level: f64): void { if (n >= 1 && n <= HARMONICS) { unchecked(this.amps[n - 1] = level); this.data = 0; } }
  reset(): void { this.phase = 0.0; }

  prepare(): void {
    if (this.data != 0) return;
    // The same harmonics share one table.
    let h: u64 = 1469598103934665603;
    for (let i = 0; i < HARMONICS; i++) { h ^= reinterpret<u64>(unchecked(this.amps[i])); h *= 1099511628211; }
    if (tableKeys == 0) { tableKeys = heap.alloc(<usize>TABLE_SLOTS * 16); memory.fill(tableKeys, 0, <usize>TABLE_SLOTS * 16); }
    for (let i = 0; i < tableCount; i++) {
      if (load<u64>(tableKeys + (<usize>i << 4)) == h) { this.data = <usize>load<u64>(tableKeys + (<usize>i << 4), 8); return; }
    }
    const bytes = <usize>(LEVELS * (TABLE + 1)) << 2;
    const d = heap.alloc(bytes);
    memory.fill(d, 0, bytes);
    let peak = 1e-9;
    for (let lv = 0; lv < LEVELS; lv++) {
      const top = HARMONICS >> lv;
      const base = d + (<usize>(lv * (TABLE + 1)) << 2);
      for (let k = 1; k <= top; k++) {
        const a = unchecked(this.amps[k - 1]);
        if (a == 0.0) continue;
        // sin(2π k i / TABLE) by rotation: exact enough over one table, and cheap.
        const w = 6.283185307179586 * <f64>k / <f64>TABLE;
        const c = cosOf(w), s = sinOf(w);
        let re = 1.0, im = 0.0;
        for (let i = 0; i < TABLE; i++) {
          const p = base + (<usize>i << 2);
          store<f32>(p, load<f32>(p) + <f32>(a * im));
          const nr = re * c - im * s;
          im = re * s + im * c;
          re = nr;
        }
      }
      if (lv == 0) for (let i = 0; i < TABLE; i++) { const v = abs<f64>(<f64>load<f32>(base + (<usize>i << 2))); if (v > peak) peak = v; }
    }
    // One level for all, so every octave is as loud; the last sample repeats the first (no wrap test while playing).
    const g = <f32>(1.0 / peak);
    for (let lv = 0; lv < LEVELS; lv++) {
      const base = d + (<usize>(lv * (TABLE + 1)) << 2);
      for (let i = 0; i < TABLE; i++) { const p = base + (<usize>i << 2); store<f32>(p, load<f32>(p) * g); }
      store<f32>(base + (<usize>TABLE << 2), load<f32>(base));
    }
    this.data = d;
    if (tableCount < TABLE_SLOTS) {
      store<u64>(tableKeys + (<usize>tableCount << 4), h);
      store<u64>(tableKeys + (<usize>tableCount << 4), <u64>d, 8);
      tableCount++;
    }
  }

  /** One sample at `hz`, -1 to 1. */
  next(hz: f64): f64 {
    const d = this.data;
    if (d == 0) return 0.0;
    let dt = hz / sampleRate();
    dt = dt > 0.0 ? (dt < 0.45 ? dt : 0.45) : 0.0;
    // The copy whose top harmonic stays under the Nyquist limit.
    let lv = 0;
    let top = <f64>HARMONICS * dt;
    while (top > 0.45 && lv < LEVELS - 1) { top *= 0.5; lv++; }
    const p = this.phase;
    let q = p + dt;
    if (q >= 1.0) q -= 1.0;
    this.phase = q;
    const x = p * <f64>TABLE;
    const i = <i32>x;
    const f = x - <f64>i;
    const at = d + (<usize>(lv * (TABLE + 1) + i) << 2);
    const a = <f64>load<f32>(at), b = <f64>load<f32>(at, 4);
    return a + (b - a) * f;
  }
}

// sin and cos of a small angle, by series (the tables are built once: exactness over speed).
function sinOf(x: f64): f64 { let t = x, s = x; const x2 = x * x; for (let n = 1; n < 12; n++) { t *= -x2 / <f64>((2 * n) * (2 * n + 1)); s += t; } return s; }
function cosOf(x: f64): f64 { let t = 1.0, s = 1.0; const x2 = x * x; for (let n = 1; n < 12; n++) { t *= -x2 / <f64>((2 * n - 1) * (2 * n)); s += t; } return s; }

/** A slow oscillator for movement, -1 to 1: `this.lfo.sine(5.0)` once a sample (the rate in Hz). */
export class Lfo extends Block {
  phase: f64 = 0.0;
  private held: f64 = 0.0;
  private seed: u32 = 0x2545f491;
  private fresh: bool = true;
  constructor() { super(); }
  reset(): void { this.phase = 0.0; this.held = 0.0; this.seed = 0x2545f491; this.fresh = true; }
  // @ts-ignore: decorator
  @inline private step(hz: f64): f64 {
    const p = this.phase;
    let d = hz / sampleRate();
    d = d > 0.0 ? (d < 0.5 ? d : 0.5) : 0.0;
    let q = p + d;
    if (q >= 1.0) q -= 1.0;
    this.phase = q;
    return p;
  }
  sine(hz: f64): f64 { return sinPhase(this.step(hz)); }
  triangle(hz: f64): f64 { const p = this.step(hz); return 1.0 - 4.0 * abs<f64>(p - 0.5); }
  /** A rising ramp. */
  saw(hz: f64): f64 { return 2.0 * this.step(hz) - 1.0; }
  square(hz: f64): f64 { return this.step(hz) < 0.5 ? 1.0 : -1.0; }
  /** A new random value `hz` times a second (sample and hold). */
  random(hz: f64): f64 {
    const before = this.phase;
    this.step(hz);
    // A new value at the start and each time the phase wraps (not whenever the phase is 0: a rate of 0 holds).
    if (this.phase < before || this.fresh) {
      this.fresh = false;
      let x = this.seed;
      x ^= x << 13; x ^= x >> 17; x ^= x << 5;
      this.seed = x;
      this.held = <f64><i32>x * 4.656612873077393e-10;
    }
    return this.held;
  }
}

/**
 * A resonant filter (state-variable): stable at every setting and while its cutoff moves. Call one of
 * its shapes once a sample: `this.filter.lowpass(x, cutoffHz, resonance)`; resonance 0 to 1.
 */
export class Filter extends Block {
  private s1: f64 = 0.0;
  private s2: f64 = 0.0;
  private hz: f64 = -1.0;
  private res: f64 = -1.0;
  private k: f64 = 2.0;
  private a1: f64 = 0.0;
  private a2: f64 = 0.0;
  private a3: f64 = 0.0;
  private low: f64 = 0.0;
  private band: f64 = 0.0;
  constructor() { super(); }
  reset(): void { this.s1 = 0.0; this.s2 = 0.0; }
  prepare(): void { this.hz = -1.0; }

  private tune(hz: f64, res: f64): void {
    const sr = sampleRate();
    const f = hz > 10.0 ? (hz < 0.45 * sr ? hz : 0.45 * sr) : 10.0;
    const g = tanPiFast(f / sr);
    if (res != this.res) {
      const r = res > 0.0 ? (res < 1.0 ? res : 1.0) : 0.0;
      // Damping from 2 (no peak) down to 0.08 (a loud ring), evenly by ear.
      this.k = 2.0 * exp(-3.2188758248682006 * r);
      this.res = res;
    }
    const k = this.k;
    this.a1 = 1.0 / (1.0 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    this.hz = hz;
  }
  // @ts-ignore: decorator
  @inline private run(x: f64, hz: f64, res: f64): void {
    if (hz != this.hz || res != this.res) this.tune(hz, res);
    const v3 = x - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    const n1 = quiet(2.0 * v1 - this.s1), n2 = 2.0 * v2 - this.s2;
    this.s1 = n1;
    // Once the first state has gone the second only creeps down (for minutes at a low cutoff): it goes with it.
    this.s2 = n1 == 0.0 && abs<f64>(n2) < 1e-15 ? 0.0 : quiet(n2);
    this.band = v1;
    this.low = v2;
  }
  lowpass(x: f64, hz: f64, resonance: f64 = 0.0): f64 { this.run(x, hz, resonance); return this.low; }
  highpass(x: f64, hz: f64, resonance: f64 = 0.0): f64 { this.run(x, hz, resonance); return x - this.k * this.band - this.low; }
  bandpass(x: f64, hz: f64, resonance: f64 = 0.0): f64 { this.run(x, hz, resonance); return this.band; }
  notch(x: f64, hz: f64, resonance: f64 = 0.0): f64 { this.run(x, hz, resonance); return x - this.k * this.band; }
  /** How long it rings: 2.2 × Q / cutoff seconds to -60 dB, and 0.6 of a cycle more (what a filter with no peak takes). */
  tail(): f64 {
    if (this.hz <= 0.0) return 0.0;
    const f = this.hz > 10.0 ? this.hz : 10.0;
    const t = (2.2 / this.k + 0.6) / f;
    return t < 3.0 ? t : 3.0;
  }
}

/** A gentle one-pole filter (6 dB an octave): `lowpass(x, hz)` darkens, `highpass(x, hz)` thins. */
export class OnePole extends Block {
  private z: f64 = 0.0;
  private hz: f64 = -1.0;
  private c: f64 = 1.0;
  constructor() { super(); }
  reset(): void { this.z = 0.0; }
  prepare(): void { this.hz = -1.0; }
  // @ts-ignore: decorator
  @inline private lp(x: f64, hz: f64): f64 {
    if (hz != this.hz) {
      const sr = sampleRate();
      const f = hz > 1.0 ? (hz < 0.45 * sr ? hz : 0.45 * sr) : 1.0;
      this.c = 1.0 - exp(-6.283185307179586 * f / sr);
      this.hz = hz;
    }
    const y = quiet(this.z + (x - this.z) * this.c);
    this.z = y;
    return y;
  }
  lowpass(x: f64, hz: f64): f64 { return this.lp(x, hz); }
  highpass(x: f64, hz: f64): f64 { return x - this.lp(x, hz); }
  tail(): f64 { return this.hz > 0.0 ? clamp(1.1 / this.hz, 0.0, 1.5) : 0.0; }
}

/** A value that glides to where it is told: `this.smooth.next(target, seconds)` once a sample. (Parameters read with `param()` are smoothed already.) */
export class Smooth extends Block {
  value: f64 = 0.0;
  private fresh: bool = true;
  private sec: f64 = -1.0;
  private c: f64 = 1.0;
  constructor() { super(); }
  reset(): void { this.fresh = true; }
  prepare(): void { this.sec = -1.0; }
  next(target: f64, seconds: f64 = 0.02): f64 {
    if (this.fresh) { this.fresh = false; this.value = target; return target; }
    if (seconds != this.sec) {
      const n = seconds * sampleRate();
      this.c = n > 1.0 ? 1.0 - exp(-1.0 / n) : 1.0;
      this.sec = seconds;
    }
    const v = this.value + (target - this.value) * this.c;
    this.value = abs<f64>(v - target) < 1e-12 ? target : v;
    return this.value;
  }
}
