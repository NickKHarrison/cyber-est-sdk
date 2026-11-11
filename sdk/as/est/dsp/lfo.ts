import { clamp, floor, sinTurns } from "../math";
import { Wave, wrap1 } from "./oscillator";
import { DEFAULT_SAMPLE_RATE } from "./smoother";

/**
 * A low-frequency oscillator, −1…1: free at a rate in Hz, or synced to the song's tempo with a
 * cycle of `beats` (feed it `io.transport.tempo`). Plain shapes: the sine and the triangle start
 * at 0 rising, the saw at −1, the square at +1. The Rust crate's `Lfo`, sample for sample.
 */
export class Lfo {
  private ph: f64 = 0;
  private inc: f64 = 0;
  private rate: f64 = 1;
  private sync: f64 = 0;
  private tempo: f64 = 120;
  private sampleRate: f64 = DEFAULT_SAMPLE_RATE;
  private wave: Wave = Wave.Sine;

  constructor() { this.update(); }
  private update(): void {
    const hz = this.sync > 0 ? this.tempo / 60.0 / this.sync : this.rate;
    this.inc = clamp(hz / this.sampleRate, 0.0, 0.5);
  }
  setSampleRate(sampleRate: f64): void { this.sampleRate = sampleRate; this.update(); }
  /** The free rate in Hz (used while not synced). */
  setRate(hz: f64): void { this.rate = hz; this.update(); }
  /** Synced: one cycle every `beats` beats (0: free, at the rate). */
  setSync(beats: f64): void { this.sync = beats > 0 ? beats : 0; this.update(); }
  /** The song's tempo in BPM (a synced LFO follows it). */
  setTempo(bpm: f64): void { if (bpm > 0 && bpm != this.tempo) { this.tempo = bpm; this.update(); } }
  setWave(wave: Wave): void { this.wave = wave; }
  /** Restart at `phase` (0…1 turns). */
  reset(phase: f64): void { this.ph = clamp(phase - floor(phase), 0.0, 0.999999999); }
  phase(): f64 { return this.ph; }

  @inline next(): f64 {
    const t = this.ph;
    let y: f64;
    if (this.wave == Wave.Saw) y = 2.0 * t - 1.0;
    else if (this.wave == Wave.Square) y = t < 0.5 ? 1.0 : -1.0;
    else if (this.wave == Wave.Triangle) {
      const u = wrap1(t + 0.25);
      y = 1.0 - 4.0 * (u > 0.5 ? u - 0.5 : 0.5 - u);
    } else y = sinTurns(t);
    this.ph = wrap1(t + this.inc);
    return y;
  }
}
