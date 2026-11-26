// The denormal floor every block of the toolkit flushes at. A recursive state (a decay, a smoother,
// a filter, a resonator) that falls under it is set to exactly 0, so silence never runs on subnormal
// numbers (the meter cannot see their cost; review n572 D-11, D-13, D-14 and review 2 D2-05, D2-08,
// D2-13 were each a state left to sink there).

/** States whose size falls under this are set to 0. */
export const DENORMAL_FLOOR: f64 = 1e-20;

/** `x`, or 0 when its size is under `DENORMAL_FLOOR`. */
// @ts-ignore: decorator
@inline export function flush(x: f64): f64 { return abs<f64>(x) < DENORMAL_FLOOR ? 0.0 : x; }
