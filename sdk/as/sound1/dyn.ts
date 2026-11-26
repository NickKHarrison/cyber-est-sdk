// sound1's level tools: saturation, a bit crusher, a compressor, a limiter, and the small helpers
// (mix, pan, decibels).

import { clamp, exp, ln } from "est";
import { Block, sampleRate } from "./core";
import { quiet, tanhFast } from "./fast";

/** A soft clip: follows the input when quiet, rounds off towards ±1 and never passes it. */
// @ts-ignore: decorator
@inline export function softClip(x: f64): f64 { return tanhFast(x); }

/**
 * Saturation, from a little warmth to heavy distortion: `amount` 0 to 1. A full-scale input stays at
 * full scale, so turning it up makes the sound denser, not painfully louder. The output is within ±1.
 */
export function drive(x: f64, amount: f64): f64 {
  const a = amount > 0.0 ? (amount < 1.0 ? amount : 1.0) : 0.0;
  const g = 1.0 + a * a * 40.0;
  const y = tanhFast(x * g) / tanhFast(g);
  // An input past full scale would come out past ±1 (by up to 1.31 at no drive): held at ±1.
  return y > 1.0 ? 1.0 : (y < -1.0 ? -1.0 : y);
}

/** `dry` and `wet` mixed: `amount` 0 is all dry, 1 all wet. */
// @ts-ignore: decorator
@inline export function mix(dry: f64, wet: f64, amount: f64): f64 { return dry + (wet - dry) * amount; }
/** The left gain for a pan position -1 (left) to 1 (right); the centre is 1. */
export function panLeft(pan: f64): f64 { return Math.sqrt(1.0 - clamp(pan, -1.0, 1.0)); }
/** The right gain for a pan position. */
export function panRight(pan: f64): f64 { return Math.sqrt(1.0 + clamp(pan, -1.0, 1.0)); }

/** A bit crusher: `process(x, bits, rateHz)`: fewer bits is grittier (1 to 16), a lower rate is more robotic. */
export class Crusher extends Block {
  private held: f64 = 0.0;
  private count: f64 = 1.0;
  constructor() { super(); }
  reset(): void { this.held = 0.0; this.count = 1.0; }
  process(x: f64, bits: f64, rateHz: f64 = 48000.0): f64 {
    this.count += clamp(rateHz, 20.0, sampleRate()) / sampleRate();
    if (this.count >= 1.0) {
      this.count -= 1.0;
      // A whole number of steps (bits between two whole numbers too), so a full-scale input rounds to full scale, not past it.
      const steps = <f64><i64>(exp(clamp(bits, 1.0, 16.0) * 0.6931471805599453) * 0.5 + 0.5);
      const v = x * steps;
      const f = <f64><i64>v;
      this.held = (v - f >= 0.5 ? f + 1.0 : v - f <= -0.5 ? f - 1.0 : f) / steps;
    }
    return this.held;
  }
}

/**
 * A compressor. `const g = this.comp.gain(l, r, thresholdDb, ratio);` then multiply both sides by `g`:
 * what is louder than the threshold is turned down by the ratio (4 means 4:1). `attack` and `release`
 * in seconds.
 */
export class Compressor extends Block {
  private env: f64 = 0.0;
  private aIn: f64 = -1.0;
  private rIn: f64 = -1.0;
  private aC: f64 = 1.0;
  private rC: f64 = 1.0;
  private rel: f64 = 0.1;
  constructor() { super(); }
  reset(): void { this.env = 0.0; }
  prepare(): void { this.aIn = -1.0; this.rIn = -1.0; }
  gain(l: f64, r: f64, thresholdDb: f64, ratio: f64, attack: f64 = 0.01, release: f64 = 0.15): f64 {
    if (attack != this.aIn) { this.aIn = attack; const n = clamp(attack, 0.0001, 2.0) * sampleRate(); this.aC = 1.0 - exp(-1.0 / n); }
    if (release != this.rIn) { this.rIn = release; this.rel = clamp(release, 0.005, 5.0); this.rC = 1.0 - exp(-1.0 / (this.rel * sampleRate())); }
    const al = abs<f64>(l), ar = abs<f64>(r);
    const x = al > ar ? al : ar;
    const e = this.env;
    this.env = quiet(e + (x - e) * (x > e ? this.aC : this.rC));
    const thr = exp(clamp(thresholdDb, -80.0, 0.0) * 0.11512925464970229);
    if (this.env <= thr) return 1.0;
    const rt = ratio > 1.0 ? ratio : 1.0;
    // (env / thr) ^ (1/ratio − 1): the gain that leaves `over / ratio` above the threshold.
    return exp(ln(this.env / thr) * (1.0 / rt - 1.0));
  }
  tail(): f64 { return 0.0; }
}

/**
 * A limiter: nothing passes the ceiling. `const g = this.limiter.gain(l, r, ceilingDb);` then multiply
 * both sides by `g`. It lets go slowly, so it pumps less than a clip.
 */
export class Limiter extends Block {
  private env: f64 = 0.0;
  private rC: f64 = 0.0;
  constructor() { super(); }
  reset(): void { this.env = 0.0; }
  prepare(): void { this.rC = exp(-1.0 / (0.08 * sampleRate())); }
  gain(l: f64, r: f64, ceilingDb: f64 = -1.0): f64 {
    const al = abs<f64>(l), ar = abs<f64>(r);
    const x = al > ar ? al : ar;
    const e = quiet(this.env * this.rC);
    this.env = x > e ? x : e;
    const c = exp(clamp(ceilingDb, -40.0, 0.0) * 0.11512925464970229);
    return this.env > c ? c / this.env : 1.0;
  }
}
