import { clamp, exp2, log2, round, tanHalfTurns } from "../math";
import { DEFAULT_SAMPLE_RATE, Smoother } from "./smoother";

/** A `Filter`'s response. */
export enum FilterMode { Low = 0, Band = 1, High = 2, Notch = 3 }

/** The mode of a stepped parameter's value (0 low, 1 band, 2 high, 3 notch): Rust's `FilterMode::from_index`. */
export function filterModeFromIndex(i: f64): FilterMode {
  const r = round(i);
  return r == 1 ? FilterMode.Band : r == 2 ? FilterMode.High : r == 3 ? FilterMode.Notch : FilterMode.Low;
}

/**
 * A 12 dB/octave state-variable filter (Andrew Simper's trapezoidal form), low-, band-, high-pass
 * or notch, its cutoff gliding in octaves and its resonance linearly (5 ms by default). Resonance
 * runs 0 (Q 0.5) to 1 (Q 50); the band-pass is 0 dB at the cutoff. The Rust crate's `Filter`,
 * sample for sample.
 */
export class Filter {
  private mode: FilterMode = FilterMode.Low;
  private sampleRate: f64 = DEFAULT_SAMPLE_RATE;
  /** log₂ of the cutoff in Hz. */
  private cut: Smoother = new Smoother(0.005);
  private res: Smoother = new Smoother(0.005);
  private k: f64 = 2;
  private a1: f64 = 0;
  private a2: f64 = 0;
  private a3: f64 = 0;
  private ic1: f64 = 0;
  private ic2: f64 = 0;

  constructor() {
    this.cut.jump(log2(1000.0));
    this.update();
  }
  setSampleRate(sampleRate: f64): void {
    this.sampleRate = sampleRate;
    this.cut.setSampleRate(sampleRate);
    this.res.setSampleRate(sampleRate);
    this.update();
  }
  setMode(mode: FilterMode): void { this.mode = mode; }
  /** The cutoff in Hz (kept within 10 Hz and 0.49 of the sample rate). */
  setCutoff(hz: f64): void { this.cut.setTarget(log2(clamp(hz, 10.0, 30000.0))); }
  /** The resonance, 0…1. */
  setResonance(r: f64): void { this.res.setTarget(clamp(r, 0.0, 1.0)); }
  /** The glide time of the cutoff and the resonance (0: none). */
  setSmoothing(seconds: f64): void { this.cut.setTime(seconds); this.res.setTime(seconds); }
  /** Clear the filter's memory and jump to the cutoff and resonance set. */
  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
    this.cut.reset();
    this.res.reset();
    this.update();
  }
  /** The cutoff in Hz now. */
  cutoff(): f64 { return clamp(exp2(this.cut.value()), 10.0, 0.49 * this.sampleRate); }

  private update(): void {
    const g = tanHalfTurns(this.cutoff() / this.sampleRate);
    this.k = 2.0 - 1.98 * this.res.value();
    this.a1 = 1.0 / (1.0 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** One sample through the filter. */
  @inline process(x: f64): f64 {
    if (!this.cut.settled() || !this.res.settled()) {
      this.cut.next();
      this.res.next();
      this.update();
    }
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1;
    this.ic2 = 2.0 * v2 - this.ic2;
    if (this.mode == FilterMode.Band) return this.k * v1;
    if (this.mode == FilterMode.High) return x - this.k * v1 - v2;
    if (this.mode == FilterMode.Notch) return x - this.k * v1;
    return v2;
  }
}
