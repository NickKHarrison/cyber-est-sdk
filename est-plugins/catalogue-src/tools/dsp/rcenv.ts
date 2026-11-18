// `RcAdsr`: the envelope of a resistor and capacitor, as analogue envelope chips make it. The attack is
// an exponential rise toward an asymptote above the peak (`overshoot`, 1.3 of the peak by default) that
// stops at the peak, so it starts fast and is still moving when it arrives; the decay and release are
// exponential falls toward Sustain and toward 0. It keeps the toolkit's envelope rules (`envelope.ts`): a
// retrigger rises from wherever the level is (never a click), it goes idle once the release (or a decay
// to a Sustain of 0) falls under `endLevel`, and every level under the denormal floor is exactly 0.
// Imported from its own file (never from `index.ts`), so a plugin that does not use it keeps its bytes.

import { exp, ln } from "est";
import { flush } from "./flush";
import { END_LEVEL, ENV_ATTACK, ENV_DECAY, ENV_IDLE, ENV_RELEASE } from "./envelope";

export class RcAdsr {
  stage: i32 = ENV_IDLE;
  level: f64 = 0;
  /** The attack's asymptote, as a multiple of the peak (over 1). */
  overshoot: f64 = 1.3;
  /** The attack's multiplier a step, on the distance to the asymptote. */
  attackCoef: f64 = 0;
  /** The decay's multiplier a step, on the distance to `sustain`. */
  decayCoef: f64 = 0;
  sustain: f64 = 1;
  /** The release's multiplier a step. */
  releaseCoef: f64 = 0;
  endLevel: f64 = END_LEVEL;

  /** The attack: from 0 to the peak in `seconds` (ln(o / (o − 1)) time constants; at least one step). `rate`: steps a second. */
  setAttack(seconds: f64, rate: f64): void {
    const n = seconds * rate;
    const o = this.overshoot;
    this.attackCoef = n <= 1.0 ? 0.0 : exp(-ln(o / (o - 1.0)) / n);
  }
  /** The decay: 60 dB of the way to Sustain in `seconds`. */
  setDecayT60(seconds: f64, rate: f64): void { const n = seconds * rate; this.decayCoef = n <= 1.0 ? 0.0 : exp(-6.907755278982137 / n); }
  /** The release: 60 dB down in `seconds`. */
  setReleaseT60(seconds: f64, rate: f64): void { const n = seconds * rate; this.releaseCoef = n <= 1.0 ? 0.0 : exp(-6.907755278982137 / n); }
  setSustain(level: f64): void { this.sustain = level < 0.0 ? 0.0 : level > 1.0 ? 1.0 : level; }

  /** The note started: attack from the current level. */
  start(): void { this.stage = ENV_ATTACK; }
  /** The key went up: release from here. Calling it again changes nothing. */
  release(): void { if (this.stage != ENV_IDLE) this.stage = ENV_RELEASE; }
  /** Silence at once (a choke, a reset). */
  stop(): void { this.stage = ENV_IDLE; this.level = 0; }
  get active(): bool { return this.stage != ENV_IDLE; }
  get released(): bool { return this.stage == ENV_RELEASE; }

  /** One step: the level after it (0 once idle). */
  next(): f64 {
    const st = this.stage;
    if (st == ENV_IDLE) return 0.0;
    let l = this.level;
    if (st == ENV_ATTACK) {
      const o = this.overshoot;
      l = o + (l - o) * this.attackCoef;
      if (l >= 1.0) { l = 1.0; this.stage = ENV_DECAY; }
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
