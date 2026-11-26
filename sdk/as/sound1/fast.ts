// Cheap, deterministic maths for what runs every sample (plain arithmetic: the same bits on every
// machine). The EST library's `exp`, `ln` and `sinTurns` are exact and slower: fine once a block.

/** tanh(x), within 2.6 %: x(27 + x²)/(27 + 9x²) up to 3, then exactly ±1. Rising everywhere, never past ±1. */
// @ts-ignore: decorator
@inline export function tanhFast(x: f64): f64 {
  if (x >= 3.0) return 1.0;
  if (x <= -3.0) return -1.0;
  const x2 = x * x;
  const y = x * (27.0 + x2) / (27.0 + 9.0 * x2);
  // Just under 3 the division can round one step past 1.
  return y > 1.0 ? 1.0 : (y < -1.0 ? -1.0 : y);
}

/** tan(π·t) for 0 ≤ t ≤ 0.45 (a filter's cutoff over the sample rate), within 1 %. */
// @ts-ignore: decorator
@inline export function tanPiFast(t: f64): f64 {
  const x = 3.141592653589793 * t;
  const x2 = x * x;
  // Padé [5/4]: x(945 − 105x² + x⁴)/(945 − 420x² + 15x⁴).
  return x * (945.0 - 105.0 * x2 + x2 * x2) / (945.0 - 420.0 * x2 + 15.0 * x2 * x2);
}

/** sin(2π·p) for a phase 0 ≤ p < 1, within 0.1 %: a parabola refined once. */
// @ts-ignore: decorator
@inline export function sinPhase(p: f64): f64 {
  const x = p < 0.5 ? p : p - 1.0;        // −0.5 … 0.5
  const y = 8.0 * x * (1.0 - 2.0 * abs<f64>(x));
  return y * (0.775 + 0.225 * abs<f64>(y));
}

/** A value set to exactly 0 once it is too small to hear and small enough to slow a processor. */
// @ts-ignore: decorator
@inline export function quiet(x: f64): f64 { return abs<f64>(x) < 1e-20 ? 0.0 : x; }
