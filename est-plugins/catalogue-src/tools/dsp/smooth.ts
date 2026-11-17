// One-pole smoothers that flush. `Glide` follows a target with `x += (target - x) * coef`, set to 0
// under the denormal floor (a smoother sent to 0 used to sink to a subnormal and stay there: review 2
// D2-08's scratch fader, D2-13's Stage and Wow). `coef` comes from a time constant or a −60 dB time
// (`onePoleCoef`, `t60Coef`), so the two are never confused (review 2 D2-12).

import { exp, onePole } from "est";
import { flush } from "./flush";

/** The per-sample coefficient of a one-pole with time constant `seconds` (63 % of the way per `seconds`; the SDK's `onePole`). */
export function onePoleCoef(seconds: f64, sampleRate: f64): f64 { return onePole(seconds, sampleRate); }

/** The per-sample multiplier of an exponential decay that falls 60 dB in `seconds`. */
export function t60Coef(seconds: f64, sampleRate: f64): f64 {
  const n = seconds * sampleRate;
  return n <= 1.0 ? 0.0 : exp(-6.907755278982137 / n);
}

/** A one-pole glide toward a target, flushed below the denormal floor. */
export class Glide {
  value: f64 = 0;
  target: f64 = 0;
  coef: f64 = 1;

  /** The coefficient from a time constant in seconds. */
  setTime(seconds: f64, sampleRate: f64): void { this.coef = onePoleCoef(seconds, sampleRate); }
  /** Jump to `v` (on activate, or a reset). */
  snap(v: f64): void { this.value = v; this.target = v; }
  /** One sample toward `target`. */
  // @ts-ignore: decorator
  @inline next(): f64 {
    const v = flush(this.value + (this.target - this.value) * this.coef);
    this.value = v;
    return v;
  }
  /** One sample toward `t` (sets the target). */
  // @ts-ignore: decorator
  @inline to(t: f64): f64 { this.target = t; return this.next(); }
  /** At its target to within `eps`: set exactly to it (so a path that tests equality can switch). */
  settle(eps: f64): bool {
    if (abs<f64>(this.value - this.target) < eps) { this.value = this.target; return true; }
    return false;
  }
}
