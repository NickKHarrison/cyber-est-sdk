import type { AutomationPoint } from './sequencerTypes';

/**
 * A lane's value at a beat (1.63: out of automation.ts, so the MIDI effects (`midiFx.ts`) can read
 * their lanes without importing the lane module and what it imports). Pure, no imports but a type.
 */

/**
 * Where a bent segment is at `t` (0…1 along it), as a fraction of its rise. `curve` 0 is straight;
 * towards 1 the segment's middle bows up (it rises early, or falls late), towards −1 down.
 */
export function bend(t: number, curve: number, rising: boolean): number {
  const c = rising ? curve : -curve;
  if (Math.abs(c) < 1e-6) return t;
  const e = 1 + 4 * Math.abs(c);
  return c > 0 ? 1 - Math.pow(1 - t, e) : Math.pow(t, e);
}

/** The index of the last point at or before `beat` (−1: before the first). Points are sorted. */
export function pointBefore(points: readonly AutomationPoint[], beat: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.beat <= beat) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

/** The value of `p`'s segment (from `a` to `b`) at `beat`. */
function along(a: AutomationPoint, b: AutomationPoint, beat: number): number {
  const span = b.beat - a.beat;
  if (span <= 0) return b.value;
  const t = Math.min(1, Math.max(0, (beat - a.beat) / span));
  return a.value + (b.value - a.value) * bend(t, a.curve, b.value >= a.value);
}

/**
 * A lane's value (0…1) at a beat: the first point's before it, the last point's after it, and
 * between two points their segment (bent by the first one's `curve`). Two points on one beat are
 * a step: the later one holds from that beat. An empty lane is 0.
 */
export function automationValue(points: readonly AutomationPoint[], beat: number): number {
  const n = points.length;
  if (!n) return 0;
  const i = pointBefore(points, beat);
  if (i < 0) return points[0]!.value;
  if (i >= n - 1) return points[n - 1]!.value;
  return along(points[i]!, points[i + 1]!, beat);
}

/** 1.655: the song's tick (1/960 beat), the grid a gate's lane is read on. */
const GATE_TICK = 1 / 960;

/**
 * 1.655 (the parity fuzzer): a gate's lane over [b0, b1) beats (an on/off control at 0.5 of its 0…1
 * range: LOOPGRAB's Grab): whether it is on at `b0`, and each beat in (b0, b1) where it turns on or off.
 * Read at the song's ticks (absolute: tick k is beat k/960), so the transport's windows and a render,
 * however each cuts its stretch, find the same beats; a step drawn on a beat (two points on it) changes
 * exactly there. `mod` (a modulator's) moves each value first, as the lanes' sampling does. Pure.
 */
export function gateEdges(points: readonly AutomationPoint[], b0: number, b1: number, mod?: (beat: number, v: number) => number): { on: boolean; edges: { beat: number; on: boolean }[] } {
  const at = (b: number) => { const v = automationValue(points, b); return (mod ? mod(b, v) : v) >= 0.5; };
  let state = at(b0);
  const first = state;
  const edges: { beat: number; on: boolean }[] = [];
  for (let k = Math.floor(b0 / GATE_TICK + 1e-9) + 1; k * GATE_TICK < b1 - 1e-9; k++) {
    const b = k * GATE_TICK;
    const s = at(b);
    if (s !== state) { edges.push({ beat: b, on: s }); state = s; }
  }
  return { on: first, edges };
}
