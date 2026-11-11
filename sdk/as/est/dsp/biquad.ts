import { clamp, cosTurns, exp, ln, round, sinTurns } from "../math";

const LN10: f64 = 2.302585092994046;

/** A `Biquad`'s shape (Robert Bristow-Johnson's Audio EQ Cookbook). */
export enum BiquadKind { Peak = 0, LowShelf = 1, HighShelf = 2, LowPass = 3, HighPass = 4 }

/** Rust's `BiquadKind::from_index`. */
export function biquadKindFromIndex(i: f64): BiquadKind {
  const r = round(i);
  return r == 1 ? BiquadKind.LowShelf : r == 2 ? BiquadKind.HighShelf : r == 3 ? BiquadKind.LowPass : r == 4 ? BiquadKind.HighPass : BiquadKind.Peak;
}

/** A biquad's coefficients, normalised (a0 = 1). */
export class Coefficients {
  b0: f64 = 1;
  b1: f64 = 0;
  b2: f64 = 0;
  a1: f64 = 0;
  a2: f64 = 0;
  copyFrom(c: Coefficients): void { this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2; }
}

/**
 * The cookbook's coefficients into `out` (Rust's `coefficients(…)` returns them; AssemblyScript
 * writes them so nothing allocates): `freq` in Hz (kept within 1 Hz and 0.499 of the sample rate),
 * `q` at least 0.01, `gainDb` for the peak and the shelves.
 */
export function coefficientsInto(out: Coefficients, kind: BiquadKind, freq: f64, q0: f64, gainDb: f64, sampleRate: f64): void {
  const f = clamp(freq, 1.0, 0.499 * sampleRate);
  const q = q0 > 0.01 ? q0 : 0.01;
  const w = f / sampleRate;
  const cw = cosTurns(w);
  const sw = sinTurns(w);
  const alpha = sw / (2.0 * q);
  const a = exp(gainDb * LN10 / 40.0);
  const sa = exp(gainDb * LN10 / 80.0);
  let b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64;
  if (kind == BiquadKind.LowShelf) {
    b0 = a * ((a + 1.0) - (a - 1.0) * cw + 2.0 * sa * alpha);
    b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cw);
    b2 = a * ((a + 1.0) - (a - 1.0) * cw - 2.0 * sa * alpha);
    a0 = (a + 1.0) + (a - 1.0) * cw + 2.0 * sa * alpha;
    a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cw);
    a2 = (a + 1.0) + (a - 1.0) * cw - 2.0 * sa * alpha;
  } else if (kind == BiquadKind.HighShelf) {
    b0 = a * ((a + 1.0) + (a - 1.0) * cw + 2.0 * sa * alpha);
    b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cw);
    b2 = a * ((a + 1.0) + (a - 1.0) * cw - 2.0 * sa * alpha);
    a0 = (a + 1.0) - (a - 1.0) * cw + 2.0 * sa * alpha;
    a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cw);
    a2 = (a + 1.0) - (a - 1.0) * cw - 2.0 * sa * alpha;
  } else if (kind == BiquadKind.LowPass) {
    b0 = (1.0 - cw) / 2.0; b1 = 1.0 - cw; b2 = (1.0 - cw) / 2.0; a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
  } else if (kind == BiquadKind.HighPass) {
    b0 = (1.0 + cw) / 2.0; b1 = -(1.0 + cw); b2 = (1.0 + cw) / 2.0; a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
  } else {
    b0 = 1.0 + alpha * a; b1 = -2.0 * cw; b2 = 1.0 - alpha * a; a0 = 1.0 + alpha / a; a1 = -2.0 * cw; a2 = 1.0 - alpha / a;
  }
  out.b0 = b0 / a0; out.b1 = b1 / a0; out.b2 = b2 / a0; out.a1 = a1 / a0; out.a2 = a2 / a0;
}

/** The magnitude of `c`'s response at `freq` Hz, in dB. */
export function responseDb(c: Coefficients, freq: f64, sampleRate: f64): f64 {
  const w = freq / sampleRate;
  const c1 = cosTurns(w);
  const c2 = cosTurns(2.0 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2.0 * (c.b0 * c.b1 + c.b1 * c.b2) * c1 + 2.0 * c.b0 * c.b2 * c2;
  const den = 1.0 + c.a1 * c.a1 + c.a2 * c.a2 + 2.0 * (c.a1 + c.a1 * c.a2) * c1 + 2.0 * c.a2 * c2;
  return 10.0 * ln(num / den) / LN10;
}

/** One biquad section (transposed direct form II, f64 state). The Rust crate's `Biquad`, sample for sample. */
export class Biquad {
  private c: Coefficients = new Coefficients();
  private z1: f64 = 0;
  private z2: f64 = 0;

  set(kind: BiquadKind, freq: f64, q: f64, gainDb: f64, sampleRate: f64): void { coefficientsInto(this.c, kind, freq, q, gainDb, sampleRate); }
  setCoefficients(c: Coefficients): void { this.c.copyFrom(c); }
  coefficients(): Coefficients { return this.c; }
  /** Clear the memory. */
  reset(): void { this.z1 = 0; this.z2 = 0; }
  @inline process(x: f64): f64 {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  /** The response at `freq` Hz, in dB. */
  responseDb(freq: f64, sampleRate: f64): f64 { return responseDb(this.c, freq, sampleRate); }
}
