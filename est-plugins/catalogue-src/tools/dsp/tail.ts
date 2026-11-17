// The tail calculator: how long a plugin sounds after its input or last note stops, from what it
// is made of, so `tail()` (and an export's or a freeze's cut) never comes short. A −60 dB time
// and a time constant are told apart by name (review 2 D2-12: a "1.5 s fade" that was a 1.5 s
// time constant took 13.8 s to its cut); a release counted to the voice's own end level (review 2
// D2-15: strings end at −80 dB, 1.34 × their release); an echo by its repeats at the tempo now
// (review n572 D-23); and parts that follow one another add, while parts side by side take the
// longest (review 2 D2-03: the harp's release, the noise's fall and a held gate left out).

/** Decibels in a factor of e: 20·log10(e). */
const DB_PER_NEPER: f64 = 8.685889638065035;

/** How long an exponential with −60 dB time `t60` takes to fall `dbDown` decibels. */
export function t60To(t60: f64, dbDown: f64): f64 { return t60 <= 0.0 ? 0.0 : t60 * dbDown / 60.0; }

/** How long a one-pole with time constant `tau` takes to fall `dbDown` decibels (8.69 dB a `tau`). */
export function tauTo(tau: f64, dbDown: f64): f64 { return tau <= 0.0 ? 0.0 : tau * dbDown / DB_PER_NEPER; }

/** How long a per-sample multiplier `coef` at `sampleRate` takes to fall `dbDown` decibels. */
export function coefTo(coef: f64, sampleRate: f64, dbDown: f64): f64 {
  if (coef <= 0.0) return 0.0;
  if (coef >= 1.0) return f64.POSITIVE_INFINITY;
  return dbDown / (-20.0 * Math.log10(coef)) / sampleRate;
}

/**
 * How long an echo with `delay` seconds between repeats and `feedback` gain a repeat takes to fall
 * `dbDown` decibels under its first repeat (the repeats it needs, times the delay, plus that delay).
 */
export function echoTo(delay: f64, feedback: f64, dbDown: f64): f64 {
  if (delay <= 0.0) return 0.0;
  const g = abs<f64>(feedback);
  if (g <= 0.0) return delay;
  if (g >= 1.0) return f64.POSITIVE_INFINITY;
  return delay * (1.0 + Math.ceil(dbDown / (-20.0 * Math.log10(g))));
}

/** A reverb's time to fall `dbDown` decibels from its RT60. */
export function rt60To(rt60: f64, dbDown: f64): f64 { return t60To(rt60, dbDown); }

/**
 * A tail made of parts: `then` adds a part that follows the ones before (a release, then a pre-delay
 * running out), `with` a part that sounds beside them (the longest wins). `frames` is the answer.
 */
export class Tail {
  private run: f64 = 0;
  private longest: f64 = 0;
  /** Start again. */
  clear(): Tail { this.run = 0; this.longest = 0; return this; }
  /** A part after the parts so far. */
  then(seconds: f64): Tail { if (seconds > 0.0) this.run += seconds; return this; }
  /** A part beside: the whole is at least the run so far plus it. */
  with(seconds: f64): Tail { const s = seconds > 0.0 ? seconds : 0.0; if (s > this.longest) this.longest = s; return this; }
  /** The longest of the run and the parts beside, in seconds. */
  get seconds(): f64 { return this.run > this.longest ? this.run : this.longest; }
  /** In frames at `sampleRate`, at most `capSeconds` (est.json's `limits.tailSeconds`), rounded up. */
  frames(sampleRate: f64, capSeconds: f64): u32 {
    let s = this.seconds;
    if (!(s <= capSeconds)) s = capSeconds;
    return <u32>Math.ceil(s * sampleRate);
  }
}
