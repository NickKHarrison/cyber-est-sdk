// Envelopes that end and flush. `Adsr`: a linear attack from wherever it is (a retrigger never
// clicks), then exponential segments: the decay toward Sustain and the release toward 0, each set by
// a −60 dB time (`t60Coef`) or a coefficient. It goes idle once its release (or a decay to a Sustain
// of 0) falls under `endLevel`, and every level under the denormal floor is exactly 0 (review n572
// D-13 and D-14: decays to a Sustain of 0 that sank to subnormal numbers while held). `Ar` is the
// attack and release alone; `Fall` a value that only decays (an FM index, a partial's level).

import { flush } from "./flush";
import { t60Coef } from "./smooth";

export const ENV_IDLE: i32 = 0;
export const ENV_ATTACK: i32 = 1;
export const ENV_DECAY: i32 = 2;
export const ENV_RELEASE: i32 = 3;

/** −80 dB: where an envelope is let go of, unless `endLevel` says otherwise. */
export const END_LEVEL: f64 = 1e-4;

export class Adsr {
  stage: i32 = ENV_IDLE;
  level: f64 = 0;
  /** The attack's rise a sample (linear, 0 → 1). */
  attackStep: f64 = 1;
  /** The decay's multiplier a sample, toward `sustain`. */
  decayCoef: f64 = 0;
  sustain: f64 = 1;
  /** The release's multiplier a sample, toward 0. */
  releaseCoef: f64 = 0;
  endLevel: f64 = END_LEVEL;
  /** A release during the attack waits for the attack to reach 1 (a short attack is never cut into a click). */
  holdAttack: bool = false;
  private pending: bool = false;

  /** The attack in seconds (at least one sample). */
  setAttack(seconds: f64, sampleRate: f64): void { const f = seconds * sampleRate; this.attackStep = 1.0 / (f > 1.0 ? f : 1.0); }
  /** The decay: −60 dB of the way to Sustain in `seconds`. */
  setDecayT60(seconds: f64, sampleRate: f64): void { this.decayCoef = t60Coef(seconds, sampleRate); }
  /** The release: −60 dB in `seconds`. */
  setReleaseT60(seconds: f64, sampleRate: f64): void { this.releaseCoef = t60Coef(seconds, sampleRate); }
  setSustain(level: f64): void { this.sustain = level < 0.0 ? 0.0 : level > 1.0 ? 1.0 : level; }

  /** The note started: attack from the current level. */
  start(): void { this.stage = ENV_ATTACK; this.pending = false; }
  /** The key went up (or a pedal let go): release from here. Calling it again changes nothing. */
  release(): void {
    if (this.stage == ENV_IDLE) return;
    if (this.stage == ENV_ATTACK && this.holdAttack) { this.pending = true; return; }
    this.stage = ENV_RELEASE;
  }
  /** Silence at once (a choke, a reset). */
  stop(): void { this.stage = ENV_IDLE; this.level = 0; this.pending = false; }
  get active(): bool { return this.stage != ENV_IDLE; }
  get attacking(): bool { return this.stage == ENV_ATTACK; }
  get released(): bool { return this.stage == ENV_RELEASE || this.pending; }

  /** One sample: the level after it (0 once idle). */
  next(): f64 {
    const st = this.stage;
    if (st == ENV_IDLE) return 0.0;
    let l = this.level;
    if (st == ENV_ATTACK) {
      l += this.attackStep;
      if (l >= 1.0) { l = 1.0; this.stage = this.pending ? ENV_RELEASE : ENV_DECAY; this.pending = false; }
      this.level = l;
      return l;
    }
    if (st == ENV_DECAY) {
      const s = this.sustain;
      l = s + (l - s) * this.decayCoef;
      if (abs<f64>(l - s) < 1e-20) l = s;
      if (s < this.endLevel && l < this.endLevel) { this.stop(); return 0.0; }
    } else {
      l = flush(l * this.releaseCoef);
      if (l < this.endLevel) { this.stop(); return 0.0; }
    }
    this.level = l;
    return l;
  }
}

/** An attack and a release (exponential, from a −60 dB time), idle under `endLevel`. */
export class Ar {
  stage: i32 = ENV_IDLE;
  level: f64 = 0;
  attackStep: f64 = 1;
  releaseCoef: f64 = 0;
  endLevel: f64 = END_LEVEL;

  setAttack(seconds: f64, sampleRate: f64): void { const f = seconds * sampleRate; this.attackStep = 1.0 / (f > 1.0 ? f : 1.0); }
  setReleaseT60(seconds: f64, sampleRate: f64): void { this.releaseCoef = t60Coef(seconds, sampleRate); }
  start(): void { this.stage = ENV_ATTACK; }
  release(): void { if (this.stage != ENV_IDLE) this.stage = ENV_RELEASE; }
  stop(): void { this.stage = ENV_IDLE; this.level = 0; }
  get active(): bool { return this.stage != ENV_IDLE; }

  next(): f64 {
    const st = this.stage;
    if (st == ENV_IDLE) return 0.0;
    let l = this.level;
    if (st == ENV_ATTACK) {
      l += this.attackStep;
      if (l >= 1.0) { l = 1.0; this.stage = ENV_DECAY; }
    } else if (st == ENV_RELEASE) {
      l = flush(l * this.releaseCoef);
      if (l < this.endLevel) { this.stop(); return 0.0; }
    }
    this.level = l;
    return l;
  }
}

/** A value that only decays (an FM index, a partial's level): `value *= coef`, flushed. */
export class Fall {
  value: f64 = 0;
  coef: f64 = 0;
  // @ts-ignore: decorator
  @inline next(): f64 { const v = this.value; this.value = flush(v * this.coef); return v; }
}
