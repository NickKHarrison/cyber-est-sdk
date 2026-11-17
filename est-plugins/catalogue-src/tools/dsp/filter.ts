// Filters whose states never sink to subnormal numbers: each state is set to 0 under the denormal
// floor as it is written (review n572 D-11: a modal resonator's rotating states stuck near 1e-322 for
// a held note's whole life; review 2 D2-05 the same on a vibraphone bar). `OnePole` (a low-pass and
// its high-pass), `Biquad` (RBJ's cookbook, transposed direct form II) and `Mode` (a decaying
// resonance, a rotating phasor: a bar's or a bell's partial).

import { cosTurns, exp, sinTurns, tanHalfTurns } from "est";
import { DENORMAL_FLOOR, flush } from "./flush";

/** A one-pole low-pass (`lp`) and the high-pass left over (`hp`), flushed. */
export class OnePole {
  coef: f64 = 1;
  z: f64 = 0;
  /** The cutoff in Hz (clamped under Nyquist). */
  setCutoff(hz: f64, sampleRate: f64): void {
    let f = hz;
    if (f > 0.49 * sampleRate) f = 0.49 * sampleRate;
    if (f < 0.0) f = 0.0;
    this.coef = 1.0 - exp(-6.283185307179586 * f / sampleRate);
  }
  reset(): void { this.z = 0; }
  // @ts-ignore: decorator
  @inline lp(x: f64): f64 { const y = flush(this.z + (x - this.z) * this.coef); this.z = y; return y; }
  // @ts-ignore: decorator
  @inline hp(x: f64): f64 { return x - this.lp(x); }
}

export const BQ_LOWPASS: i32 = 0;
export const BQ_HIGHPASS: i32 = 1;
export const BQ_BANDPASS: i32 = 2;
export const BQ_NOTCH: i32 = 3;
export const BQ_PEAK: i32 = 4;
export const BQ_LOWSHELF: i32 = 5;
export const BQ_HIGHSHELF: i32 = 6;

/** RBJ's cookbook biquad, transposed direct form II, its two states flushed together. */
export class Biquad {
  b0: f64 = 1; b1: f64 = 0; b2: f64 = 0; a1: f64 = 0; a2: f64 = 0;
  z1: f64 = 0; z2: f64 = 0;

  /** `kind` (BQ_*), centre or cutoff `hz`, `q`, and `gainDb` for a peak or shelf. */
  set(kind: i32, hz: f64, q: f64, gainDb: f64, sampleRate: f64): void {
    let f = hz / sampleRate;
    if (f > 0.49) f = 0.49;
    if (f < 1e-6) f = 1e-6;
    const qq = q > 1e-3 ? q : 1e-3;
    const c = cosTurns(f), s = sinTurns(f);
    const alpha = s / (2.0 * qq);
    const A = Math.pow(10.0, gainDb / 40.0);
    let b0: f64 = 1, b1: f64 = 0, b2: f64 = 0, a0: f64 = 1, a1: f64 = 0, a2: f64 = 0;
    if (kind == BQ_LOWPASS) { b1 = 1.0 - c; b0 = b1 * 0.5; b2 = b0; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha; }
    else if (kind == BQ_HIGHPASS) { b1 = -(1.0 + c); b0 = (1.0 + c) * 0.5; b2 = b0; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha; }
    else if (kind == BQ_BANDPASS) { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha; }
    else if (kind == BQ_NOTCH) { b0 = 1; b1 = -2.0 * c; b2 = 1; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha; }
    else if (kind == BQ_PEAK) { b0 = 1.0 + alpha * A; b1 = -2.0 * c; b2 = 1.0 - alpha * A; a0 = 1.0 + alpha / A; a1 = -2.0 * c; a2 = 1.0 - alpha / A; }
    else {
      const sq = 2.0 * Math.sqrt(A) * alpha;
      if (kind == BQ_LOWSHELF) {
        b0 = A * ((A + 1.0) - (A - 1.0) * c + sq); b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * c); b2 = A * ((A + 1.0) - (A - 1.0) * c - sq);
        a0 = (A + 1.0) + (A - 1.0) * c + sq; a1 = -2.0 * ((A - 1.0) + (A + 1.0) * c); a2 = (A + 1.0) + (A - 1.0) * c - sq;
      } else {
        b0 = A * ((A + 1.0) + (A - 1.0) * c + sq); b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * c); b2 = A * ((A + 1.0) + (A - 1.0) * c - sq);
        a0 = (A + 1.0) - (A - 1.0) * c + sq; a1 = 2.0 * ((A - 1.0) - (A + 1.0) * c); a2 = (A + 1.0) - (A - 1.0) * c - sq;
      }
    }
    const inv = 1.0 / a0;
    this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv; this.a1 = a1 * inv; this.a2 = a2 * inv;
  }
  reset(): void { this.z1 = 0; this.z2 = 0; }
  // @ts-ignore: decorator
  @inline process(x: f64): f64 {
    const y = this.b0 * x + this.z1;
    const z1 = this.b1 * x - this.a1 * y + this.z2;
    const z2 = this.b2 * x - this.a2 * y;
    // Both together: flushing one alone can feed the other a step, a limit cycle at the floor.
    if (abs<f64>(z1) + abs<f64>(z2) < DENORMAL_FLOOR) { this.z1 = 0; this.z2 = 0; } else { this.z1 = z1; this.z2 = z2; }
    return y;
  }
  /** The magnitude response at `hz`, in dB (for a test or a drawing). */
  responseDb(hz: f64, sampleRate: f64): f64 {
    const w = hz / sampleRate;
    const c1 = cosTurns(w), s1 = sinTurns(w), c2 = cosTurns(2.0 * w), s2 = sinTurns(2.0 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1.0 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return 10.0 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}

/**
 * A decaying resonance at `hz` (a rotating phasor, `re` + i·`im`), excited by `strike` or by input,
 * falling 60 dB in its `t60`, both parts flushed: a bar's, a tine's or a bell's partial.
 */
export class Mode {
  re: f64 = 0; im: f64 = 0;
  cr: f64 = 1; ci: f64 = 0;
  set(hz: f64, t60: f64, sampleRate: f64): void {
    const f = hz / sampleRate;
    const r = t60 * sampleRate > 1.0 ? exp(-6.907755278982137 / (t60 * sampleRate)) : 0.0;
    this.cr = r * cosTurns(f); this.ci = r * sinTurns(f);
  }
  /** Add `amp` to the resonance (a hit). */
  strike(amp: f64): void { this.re += amp; }
  reset(): void { this.re = 0; this.im = 0; }
  /** One sample (`x` the input added): the resonance's sine part. */
  // @ts-ignore: decorator
  @inline process(x: f64): f64 {
    const re = this.re * this.cr - this.im * this.ci + x;
    const im = this.re * this.ci + this.im * this.cr;
    this.re = flush(re); this.im = flush(im);
    return this.im;
  }
}

/** tan(π·f) for a cutoff as a fraction of the rate: the SDK's, for a state-variable filter of your own. */
export function prewarp(hz: f64, sampleRate: f64): f64 { return tanHalfTurns(hz / sampleRate); }
