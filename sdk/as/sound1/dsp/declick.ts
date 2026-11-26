// Click-free changes. `Declick` carries what a voice last added to the mix when it is taken while
// still sounding, and lets it fall over a couple of milliseconds instead of dropping to 0 in one
// sample (review n572 D-10: a stolen voice restarted its phases at 0, a step of 0.088). `Ramp` is
// a linear gain move that says when it has arrived, so a path is switched only once its level is
// exactly where the switch needs it (review n572 D-07: the bit-exact copy switched in while the
// make-up had not settled, a 2.7 dB step; D-08: a weight cut from full to 0 when its envelope fell).

import { exp } from "est";
import { flush } from "./flush";

/** A voice's carried last sample, falling with a time constant (`setTime`). */
export class Declick {
  carry: f64 = 0;
  coef: f64 = 0.99;
  /** The fall's time constant (2 ms is inaudible and long enough). */
  setTime(seconds: f64, sampleRate: f64): void { this.coef = exp(-1.0 / (seconds * sampleRate)); }
  /** The voice was taken while sounding: what it last added (`last`) is carried on. */
  take(last: f64): void { this.carry = last + this.carry; }
  clear(): void { this.carry = 0; }
  /** The carry for this sample (add it to the voice's output); it falls for the next. */
  // @ts-ignore: decorator
  @inline next(): f64 { const c = this.carry; this.carry = flush(c * this.coef); return c; }
}

/** A linear move to a target over a set time; `done` once exactly there. */
export class Ramp {
  value: f64 = 1;
  target: f64 = 1;
  private step: f64 = 0;
  private left: i32 = 0;
  /** Jump to `v`. */
  snap(v: f64): void { this.value = v; this.target = v; this.left = 0; this.step = 0; }
  /** Move to `t` over `seconds`. */
  to(t: f64, seconds: f64, sampleRate: f64): void {
    if (t == this.target && (this.left > 0 || this.value == t)) return;
    this.target = t;
    const n = <i32>(seconds * sampleRate);
    if (n <= 1) { this.snap(t); return; }
    this.left = n;
    this.step = (t - this.value) / <f64>n;
  }
  get done(): bool { return this.left == 0; }
  /** One sample: the gain for it. */
  next(): f64 {
    if (this.left > 0) {
      this.left--;
      this.value = this.left == 0 ? this.target : this.value + this.step;
    }
    return this.value;
  }
}
