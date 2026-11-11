// The SDK's float maths, the same algorithms as the Rust crate's (sdk/rust/est/src/math.rs), step
// for step, so a block renders the same samples in both languages (Cyber's suite compares them).
// Deterministic: plain WebAssembly arithmetic, the same bits on every host. AssemblyScript's own
// Math is deterministic too, but it is not the Rust crate's, so the blocks use these.

const LN2: f64 = 0.6931471805599453;
const LN10: f64 = 2.302585092994046;
const SQRT2: f64 = 1.4142135623730951;
const TAU: f64 = 6.283185307179586;

/** Round half away from zero. */
export function round(x: f64): f64 {
  if (!(Math.abs(x) < 4.5e15)) return x;
  const t = <f64><i64>x;
  const d = x - t;
  return d >= 0.5 ? t + 1 : d <= -0.5 ? t - 1 : t;
}

export function floor(x: f64): f64 {
  if (!(Math.abs(x) < 4.5e15)) return x;
  const t = <f64><i64>x;
  return t > x ? t - 1 : t;
}

/** e^x, to within a few ulps over the range audio needs. */
export function exp(x: f64): f64 {
  if (isNaN(x)) return x;
  if (x > 709.0) return Infinity;
  if (x < -745.0) return 0.0;
  const kf = round(x / LN2);
  const r = x - kf * LN2;
  let term = 1.0;
  let sum = 1.0;
  let n = 1.0;
  while (n < 18.0) {
    term *= r / n;
    sum += term;
    n += 1.0;
  }
  const k = <i64>kf;
  if (k < -1022) return sum * reinterpret<f64>(<u64>1 << 52) * reinterpret<f64>(<u64>(k + 1022 + 1023) << 52);
  return sum * reinterpret<f64>(<u64>(k + 1023) << 52);
}

/** The natural logarithm (NaN for x < 0, -Infinity for 0). */
export function ln(x0: f64): f64 {
  if (isNaN(x0) || x0 < 0.0) return NaN;
  if (x0 == 0.0) return -Infinity;
  if (x0 == Infinity) return x0;
  let x = x0;
  let e: i64 = 0;
  if (x < 2.2250738585072014e-308) { x *= 4503599627370496.0; e -= 52; }
  const bits = reinterpret<u64>(x);
  e += <i64>((bits >> 52) & 0x7ff) - 1023;
  let m = reinterpret<f64>((bits & 0x000fffffffffffff) | (<u64>1023 << 52));
  if (m > SQRT2) { m /= 2.0; e += 1; }
  const s = (m - 1.0) / (m + 1.0);
  const s2 = s * s;
  let term = s;
  let sum = 0.0;
  let n = 1.0;
  while (n < 40.0) {
    sum += term / n;
    term *= s2;
    n += 2.0;
  }
  return 2.0 * sum + <f64>e * LN2;
}

/** Decibels to a linear gain. */
export function dbToGain(db: f64): f64 { return exp(db * LN10 / 20.0); }

/** A linear gain to decibels. */
export function gainToDb(g: f64): f64 { return 20.0 * ln(g) / LN10; }

/** The coefficient of a one-pole smoother reaching 63 % in `seconds` at `sampleRate`. */
export function onePole(seconds: f64, sampleRate: f64): f64 {
  return seconds <= 0.0 || sampleRate <= 0.0 ? 1.0 : 1.0 - exp(-1.0 / (seconds * sampleRate));
}

/** sin(x) for |x| ≤ π/4, by its Taylor series to x²¹. */
function sinSeries(x: f64): f64 {
  const x2 = x * x;
  let term = x;
  let sum = x;
  let n = 2.0;
  while (n < 22.0) {
    term *= -x2 / (n * (n + 1.0));
    sum += term;
    n += 2.0;
  }
  return sum;
}

/** cos(x) for |x| ≤ π/4, by its Taylor series to x²⁰. */
function cosSeries(x: f64): f64 {
  const x2 = x * x;
  let term = 1.0;
  let sum = 1.0;
  let n = 1.0;
  while (n < 21.0) {
    term *= -x2 / (n * (n + 1.0));
    sum += term;
    n += 2.0;
  }
  return sum;
}

/** sin(2π·t), `t` in turns. */
export function sinTurns(t: f64): f64 {
  if (!isFinite(t)) return NaN;
  let y = t - round(t);
  if (y > 0.25) y = 0.5 - y;
  else if (y < -0.25) y = -0.5 - y;
  const a = y < 0.0 ? -y : y;
  const s = a <= 0.125 ? sinSeries(TAU * a) : cosSeries(TAU * (0.25 - a));
  return y < 0.0 ? -s : s;
}

/** cos(2π·t), `t` in turns. */
export function cosTurns(t: f64): f64 {
  if (!isFinite(t)) return NaN;
  const y = t - round(t);
  let a = y < 0.0 ? -y : y;
  let sign = 1.0;
  if (a > 0.25) { a = 0.5 - a; sign = -1.0; }
  const c = a <= 0.125 ? cosSeries(TAU * a) : sinSeries(TAU * (0.25 - a));
  return sign * c;
}

/** tan(π·t) for `t` in turns, 0 ≤ t < ½ (a filter's prewarped frequency: `t` = f / sample rate). */
export function tanHalfTurns(t: f64): f64 { return sinTurns(t * 0.5) / cosTurns(t * 0.5); }

/** 2^x. */
export function exp2(x: f64): f64 { return exp(x * LN2); }

/** log₂ x. */
export function log2(x: f64): f64 { return ln(x) / LN2; }

/** `x` limited to `lo`…`hi` (NaN becomes `lo`). */
export function clamp(x: f64, lo: f64, hi: f64): f64 { return x > hi ? hi : x >= lo ? x : lo; }

/** The frequency in Hz of MIDI key `key` (69 is A4 at 440 Hz; a fraction is a detune). */
export function keyToHz(key: f64): f64 { return 440.0 * exp2((key - 69.0) / 12.0); }
