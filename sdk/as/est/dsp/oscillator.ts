import { clamp, floor, round, sinTurns } from "../math";
import { DEFAULT_SAMPLE_RATE } from "./smoother";

/** An oscillator's (or an `Lfo`'s) waveform. */
export enum Wave { Sine = 0, Saw = 1, Square = 2, Triangle = 3 }

/** The wave of a stepped parameter's value (0 sine, 1 saw, 2 square, 3 triangle): Rust's `Wave::from_index`. */
export function waveFromIndex(i: f64): Wave {
  const r = round(i);
  return r == 1 ? Wave.Saw : r == 2 ? Wave.Square : r == 3 ? Wave.Triangle : Wave.Sine;
}

/** `x` in 0…2 brought into 0…1. */
// @ts-ignore: decorator
@inline export function wrap1(x: f64): f64 { return x >= 1.0 ? x - 1.0 : x; }

// @ts-ignore: decorator
@inline function blep(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

// @ts-ignore: decorator
@inline function blamp(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = 1.0 - t / dt;
    return x * x * x / 6.0;
  } else if (t > 1.0 - dt) {
    const x = 1.0 - (1.0 - t) / dt;
    return x * x * x / 6.0;
  }
  return 0.0;
}

/**
 * An audio oscillator: a sine, or a saw, square or triangle band-limited by polyBLEP (polyBLAMP for
 * the triangle's corners). Every wave starts at phase 0 and runs −1…1; the sine and the triangle
 * start at 0 rising, the square at +1, the saw at −1. The Rust crate's `Oscillator`, sample for sample.
 */
export class Oscillator {
  private ph: f64 = 0;
  private inc: f64 = 440.0 / DEFAULT_SAMPLE_RATE;
  private freq: f64 = 440;
  private sampleRate: f64 = DEFAULT_SAMPLE_RATE;
  private wave: Wave = Wave.Sine;

  setSampleRate(sampleRate: f64): void { this.sampleRate = sampleRate; this.setFrequency(this.freq); }
  /** The frequency in Hz (0 to just under half the sample rate). */
  setFrequency(hz: f64): void {
    this.freq = hz;
    this.inc = clamp(hz / this.sampleRate, 0.0, 0.49);
  }
  setWave(wave: Wave): void { this.wave = wave; }
  /** Restart at `phase` (0…1 turns). */
  reset(phase: f64): void { this.ph = clamp(phase - floor(phase), 0.0, 0.999999999); }
  phase(): f64 { return this.ph; }
  frequency(): f64 { return this.freq; }

  /** The next sample. */
  @inline next(): f64 {
    const t = this.ph;
    const dt = this.inc;
    let y: f64;
    if (this.wave == Wave.Saw) y = 2.0 * t - 1.0 - blep(t, dt);
    else if (this.wave == Wave.Square) y = (t < 0.5 ? 1.0 : -1.0) + blep(t, dt) - blep(wrap1(t + 0.5), dt);
    else if (this.wave == Wave.Triangle) {
      const u = wrap1(t + 0.25);
      const naive = 1.0 - 4.0 * (u > 0.5 ? u - 0.5 : 0.5 - u);
      y = naive + 8.0 * dt * (blamp(u, dt) - blamp(wrap1(t + 0.75), dt));
    } else y = sinTurns(t);
    this.ph = wrap1(t + dt);
    return y;
  }
}
