import { onePole } from "../math";

/** The sample rate a block assumes until `setSampleRate`. */
export const DEFAULT_SAMPLE_RATE: f64 = 48000;

/**
 * A one-pole glide to a target: reaches 63 % of a step in `seconds`, then snaps to the target once
 * within 1e-9 of it (so `settled` is exact). The Rust crate's `Smoother`, sample for sample.
 */
export class Smoother {
  private v: f64 = 0;
  private t: f64 = 0;
  private coef: f64;
  private sampleRate: f64 = DEFAULT_SAMPLE_RATE;

  constructor(private seconds: f64) {
    this.coef = onePole(seconds, DEFAULT_SAMPLE_RATE);
  }
  setSampleRate(sampleRate: f64): void {
    this.sampleRate = sampleRate;
    this.coef = onePole(this.seconds, sampleRate);
  }
  /** The glide's time constant (0: none, the value jumps). */
  setTime(seconds: f64): void {
    this.seconds = seconds;
    this.coef = onePole(seconds, this.sampleRate);
  }
  setTarget(target: f64): void { this.t = target; }
  /** Jump to `value` at once (no glide). */
  jump(value: f64): void { this.v = value; this.t = value; }
  /** Jump to the target at once. */
  reset(): void { this.v = this.t; }
  /** One sample's step; the new value. */
  @inline next(): f64 {
    if (this.v != this.t) {
      this.v += (this.t - this.v) * this.coef;
      const d = this.t - this.v;
      if (d < 1e-9 && d > -1e-9) this.v = this.t;
    }
    return this.v;
  }
  value(): f64 { return this.v; }
  target(): f64 { return this.t; }
  settled(): bool { return this.v == this.t; }
}
