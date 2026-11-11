//! The float maths `core` lacks (exp, ln, sin, tan), deterministic (the same bits on every host: EST renders are
//! compared bit for bit, and a live room's peers must hear the same thing).

const LN2: f64 = core::f64::consts::LN_2;
const LN10: f64 = core::f64::consts::LN_10;

/// Round half away from zero.
pub fn round(x: f64) -> f64 {
    if !(x.abs() < 4.5e15) { return x }
    let t = x as i64 as f64;
    let d = x - t;
    if d >= 0.5 { t + 1.0 } else if d <= -0.5 { t - 1.0 } else { t }
}

pub fn floor(x: f64) -> f64 {
    if !(x.abs() < 4.5e15) { return x }
    let t = x as i64 as f64;
    if t > x { t - 1.0 } else { t }
}

/// e^x, to within a few ulps over the range audio needs.
pub fn exp(x: f64) -> f64 {
    if x.is_nan() { return x }
    if x > 709.0 { return f64::INFINITY }
    if x < -745.0 { return 0.0 }
    // x = k·ln2 + r, |r| ≤ ln2/2; e^r by its series, then scaled by 2^k through the exponent bits.
    let k = round(x / LN2);
    let r = x - k * LN2;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut n = 1.0;
    while n < 18.0 {
        term *= r / n;
        sum += term;
        n += 1.0;
    }
    let k = k as i64;
    if k < -1022 { return sum * f64::from_bits(1u64 << 52) * f64::from_bits(((k + 1022 + 1023) as u64) << 52) }
    sum * f64::from_bits(((k + 1023) as u64) << 52)
}

/// The natural logarithm (NaN for x < 0, -inf for 0).
pub fn ln(x: f64) -> f64 {
    if x.is_nan() || x < 0.0 { return f64::NAN }
    if x == 0.0 { return f64::NEG_INFINITY }
    if x.is_infinite() { return x }
    // x = m·2^e with m in [1, 2); ln m = 2·atanh((m-1)/(m+1)).
    let (mut x, mut e) = (x, 0i64);
    if x < f64::MIN_POSITIVE { x *= 4503599627370496.0; e -= 52 } // subnormal: scale by 2^52 first
    let bits = x.to_bits();
    e += ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | (1023u64 << 52));
    if m > core::f64::consts::SQRT_2 { m /= 2.0; e += 1 }
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let mut term = s;
    let mut sum = 0.0;
    let mut n = 1.0;
    while n < 40.0 {
        sum += term / n;
        term *= s2;
        n += 2.0;
    }
    2.0 * sum + e as f64 * LN2
}

/// Decibels to a linear gain.
pub fn db_to_gain(db: f64) -> f64 { exp(db * LN10 / 20.0) }

/// A linear gain to decibels.
pub fn gain_to_db(g: f64) -> f64 { 20.0 * ln(g) / LN10 }

/// The coefficient of a one-pole smoother reaching 63 % in `seconds` at `sample_rate`.
pub fn one_pole(seconds: f64, sample_rate: f64) -> f64 {
    if seconds <= 0.0 || sample_rate <= 0.0 { 1.0 } else { 1.0 - exp(-1.0 / (seconds * sample_rate)) }
}

/// sin(x) for |x| ≤ π/4, by its Taylor series to x²¹ (exact to the last bit or two there).
fn sin_series(x: f64) -> f64 {
    let x2 = x * x;
    let mut term = x;
    let mut sum = x;
    let mut n = 2.0;
    while n < 22.0 {
        term *= -x2 / (n * (n + 1.0));
        sum += term;
        n += 2.0;
    }
    sum
}

/// cos(x) for |x| ≤ π/4, by its Taylor series to x²⁰.
fn cos_series(x: f64) -> f64 {
    let x2 = x * x;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut n = 1.0;
    while n < 21.0 {
        term *= -x2 / (n * (n + 1.0));
        sum += term;
        n += 2.0;
    }
    sum
}

const TAU: f64 = 2.0 * core::f64::consts::PI;

/// sin(2π·t): `t` in turns (any value; a phase in 0…1 is the usual one). Accurate to about 1e-16
/// absolute, and relative near 0 (each eighth of a turn is its own series).
pub fn sin_turns(t: f64) -> f64 {
    if !t.is_finite() { return f64::NAN }
    // Reduce to −½ … ½ turns, then fold to −¼ … ¼ (sin is symmetric about ±¼).
    let mut y = t - round(t);
    if y > 0.25 { y = 0.5 - y } else if y < -0.25 { y = -0.5 - y }
    let a = if y < 0.0 { -y } else { y };
    let s = if a <= 0.125 { sin_series(TAU * a) } else { cos_series(TAU * (0.25 - a)) };
    if y < 0.0 { -s } else { s }
}

/// cos(2π·t), `t` in turns (accurate near 0 turns too: 1 − cos of a small angle keeps its bits).
pub fn cos_turns(t: f64) -> f64 {
    if !t.is_finite() { return f64::NAN }
    let y = t - round(t);
    let mut a = if y < 0.0 { -y } else { y };
    let mut sign = 1.0;
    if a > 0.25 { a = 0.5 - a; sign = -1.0 }
    let c = if a <= 0.125 { cos_series(TAU * a) } else { sin_series(TAU * (0.25 - a)) };
    sign * c
}

/// tan(π·t) for `t` in turns, 0 ≤ t < ½ (a filter's prewarped frequency: `t` = f / sample rate).
pub fn tan_half_turns(t: f64) -> f64 { sin_turns(t * 0.5) / cos_turns(t * 0.5) }

/// 2^x.
pub fn exp2(x: f64) -> f64 { exp(x * LN2) }

/// log₂ x.
pub fn log2(x: f64) -> f64 { ln(x) / LN2 }

/// `x` limited to `lo ..= hi` (NaN becomes `lo`).
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 { if x > hi { hi } else if x >= lo { x } else { lo } }

/// The frequency in Hz of MIDI key `key` (69 is A4 at 440 Hz; a fraction is a detune).
pub fn key_to_hz(key: f64) -> f64 { 440.0 * exp2((key - 69.0) / 12.0) }
