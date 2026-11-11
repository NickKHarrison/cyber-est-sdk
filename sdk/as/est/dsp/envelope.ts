import { DEFAULT_SAMPLE_RATE } from "./smoother";

/** Where an `Envelope` is. */
export enum Stage { Idle = 0, Attack = 1, Decay = 2, Sustain = 3, Release = 4 }

/**
 * A linear ADSR, 0…1: `start` attacks from the level it is at, `release` falls to 0 in exactly the
 * release time, and `tailFrames()` is that time in frames (an instrument's `tail()`). Times in
 * seconds. The Rust crate's `Envelope`, sample for sample.
 */
export class Envelope {
  private st: Stage = Stage.Idle;
  private lvl: f64 = 0;
  private step: f64 = 0;
  private sampleRate: f64 = DEFAULT_SAMPLE_RATE;
  private attack: f64 = 0.005;
  private decay: f64 = 0.1;
  private sustain: f64 = 0.7;
  private rel: f64 = 0.3;

  setSampleRate(sampleRate: f64): void { this.sampleRate = sampleRate; }
  setAttack(seconds: f64): void { this.attack = seconds > 0 ? seconds : 0; }
  setDecay(seconds: f64): void { this.decay = seconds > 0 ? seconds : 0; }
  /** The sustain level, 0…1. */
  setSustain(level: f64): void { this.sustain = level > 1 ? 1 : level > 0 ? level : 0; }
  setRelease(seconds: f64): void { this.rel = seconds > 0 ? seconds : 0; }
  setAdsr(attack: f64, decay: f64, sustain: f64, release: f64): void {
    this.setAttack(attack);
    this.setDecay(decay);
    this.setSustain(sustain);
    this.setRelease(release);
  }

  private frames(seconds: f64): f64 { const f = seconds * this.sampleRate; return f > 1.0 ? f : 1.0; }

  /** The note started: attack from the current level. */
  start(): void {
    this.st = Stage.Attack;
    this.step = 1.0 / this.frames(this.attack);
  }
  /** The note was released: fall to 0 over the release time. */
  release(): void {
    if (this.st == Stage.Idle) return;
    this.st = Stage.Release;
    this.step = this.lvl / this.frames(this.rel);
  }
  /** Silent at once. */
  reset(): void { this.st = Stage.Idle; this.lvl = 0; this.step = 0; }

  /** The next sample's level. */
  @inline next(): f64 {
    const s = this.st;
    if (s == Stage.Attack) {
      this.lvl += this.step;
      if (this.lvl >= 1.0) {
        this.lvl = 1.0;
        this.st = Stage.Decay;
        this.step = (1.0 - this.sustain) / this.frames(this.decay);
      }
    } else if (s == Stage.Decay) {
      this.lvl -= this.step;
      if (this.lvl <= this.sustain) { this.lvl = this.sustain; this.st = Stage.Sustain; }
    } else if (s == Stage.Sustain) {
      this.lvl = this.sustain;
    } else if (s == Stage.Release) {
      this.lvl -= this.step;
      if (this.lvl <= 0.0) { this.lvl = 0.0; this.st = Stage.Idle; }
    }
    return this.lvl;
  }
  level(): f64 { return this.lvl; }
  stage(): Stage { return this.st; }
  /** Whether it still sounds (any stage but Idle). */
  isActive(): bool { return this.st != Stage.Idle; }
  /** The release in frames, plus one: the most a released note goes on sounding. */
  tailFrames(): u32 { return <u32>this.frames(this.rel) + 1; }
}
