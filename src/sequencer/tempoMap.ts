import type { AutomationLane, AutomationPoint, AutomationTarget } from './sequencerTypes';
import { bend } from './laneValue';

/**
 * The tempo rule (Cyber_Tempo_Map_Work_Order.md §2.2): the one module that relates the song's
 * beats and seconds. Pure: it imports types and `laneValue.ts` only (no DOM, Web Audio or store).
 *
 * The song's tempo map is the Master's **tempo lane**, an ordinary automation lane with the target
 * `{ kind: 'master', param: 'tempo' }` (§2.1): its points in BPM through `valueToBpm`, a straight
 * line between two points, a step where two share a beat, `curve` bending a ramp. The lane is
 * **in force** when it exists, is on and has a point; otherwise the song plays at its one `tempo`.
 *
 * `Tempo` is a number (a constant tempo, exactly today's arithmetic: `60 / bpm` a beat) or a
 * `TempoClock` compiled from the lane. Every function here takes either, so a pure helper widens
 * its `tempo: number` to `Tempo` and a song without a lane keeps its results bit for bit.
 *
 * The maths (§2.2): a straight segment B0 → B1 over Δb beats takes `60·Δb·ln(B1/B0)/(B1 − B0)`
 * seconds, inverted in closed form; a bent segment is integrated by composite Simpson with
 * `SIMPSON_STEPS` fixed sub-steps and inverted by `BISECT_STEPS` fixed bisections, so every peer,
 * the export and every test get the same numbers. Before the first point (negative beats too) and
 * after the last, the tempo is that point's.
 */

/** The tempo lane's range (`MIN_TEMPO`…`MAX_TEMPO` in sequencerTypes; a test keeps them equal). */
export const TEMPO_LANE_MIN = 40;
export const TEMPO_LANE_MAX = 240;
/** Fixed sub-steps of a bent segment's integral (composite Simpson; even). */
export const SIMPSON_STEPS = 64;
/** Fixed bisections inverting a bent segment. */
export const BISECT_STEPS = 48;

/** A compiled tempo point: its beat, its BPM, and the bend of the segment to the next point. */
export interface TempoPoint { readonly beat: number; readonly bpm: number; readonly curve: number }

/** The compiled tempo lane (§3 "Clock"). Plain data: it can be posted to a worker. */
export interface TempoClock {
  readonly kind: 'clock';
  /** The lane's points, sorted, in BPM. At least one. */
  readonly points: readonly TempoPoint[];
  /** Seconds from beat 0 to each point (negative for a point before beat 0). */
  readonly secs: readonly number[];
  /** `tempoKey`: a short hash of the points. */
  readonly key: string;
}

/** A constant tempo (BPM) or a compiled tempo lane. */
export type Tempo = number | TempoClock;

const isClock = (t: Tempo): t is TempoClock => typeof t !== 'number';
/** Seconds a beat at a constant tempo, as the code before the map wrote it. */
const spbOfNumber = (bpm: number): number => 60 / Math.max(1, bpm);

// --- The lane ------------------------------------------------------------------------------------

/** The tempo lane's target. */
export const TEMPO_TARGET: Readonly<AutomationTarget> = Object.freeze({ kind: 'master', param: 'tempo' });

/** True for the tempo lane's target. */
export function isTempoTarget(t: AutomationTarget): boolean {
  return t.kind === 'master' && t.param === 'tempo';
}

/** A lane value (0…1) as BPM (linear, 40…240), clean to 1e-9 BPM so 0.44 reads 128 exactly. */
export function valueToBpm(v: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  return Math.round((TEMPO_LANE_MIN + c * (TEMPO_LANE_MAX - TEMPO_LANE_MIN)) * 1e9) / 1e9;
}

/** BPM as a lane value (0…1). */
export function bpmToValue(bpm: number): number {
  const b = Math.min(TEMPO_LANE_MAX, Math.max(TEMPO_LANE_MIN, Number.isFinite(bpm) ? bpm : 120));
  return (b - TEMPO_LANE_MIN) / (TEMPO_LANE_MAX - TEMPO_LANE_MIN);
}

/** The song's tempo lane (in force or not), or null. */
export function tempoLaneOf(seq: { automation?: readonly AutomationLane[] }): AutomationLane | null {
  return seq.automation?.find(l => isTempoTarget(l.target)) ?? null;
}

/** True when the tempo lane is in force: it exists, is on and has a point. */
export function tempoLaneInForce(seq: { automation?: readonly AutomationLane[] }): boolean {
  const l = tempoLaneOf(seq);
  return !!l && l.on && l.points.length > 0;
}

const clockMemo = new WeakMap<readonly AutomationPoint[], TempoClock>();

/**
 * The song's tempo: its tempo lane's clock when the lane is in force, else the number `tempo`.
 * Memoised on the lane's `points` array, so the same lane gives the same clock object. Given a
 * `tempo` that is already a `Tempo` clock (a helper's own state), it is returned as it is.
 */
export function songTempo(seq: { tempo: Tempo; automation?: readonly AutomationLane[] }): Tempo {
  if (isClock(seq.tempo)) return seq.tempo;
  const lane = tempoLaneOf(seq);
  if (!lane || !lane.on || !lane.points.length) return seq.tempo;
  let c = clockMemo.get(lane.points);
  if (!c) { c = compileClock(lane.points); clockMemo.set(lane.points, c); }
  return c;
}

/** A clock from a lane's points (sorted, as the sanitiser leaves them). At least one point. */
export function compileClock(lanePoints: readonly AutomationPoint[]): TempoClock {
  const src = lanePoints.length ? lanePoints : [{ beat: 0, value: bpmToValue(120), curve: 0 }];
  const points: TempoPoint[] = src.map(p => ({ beat: p.beat, bpm: valueToBpm(p.value), curve: Number.isFinite(p.curve) ? p.curve : 0 }));
  const secs: number[] = new Array<number>(points.length);
  const p0 = points[0]!;
  secs[0] = (p0.beat * 60) / p0.bpm;
  for (let i = 1; i < points.length; i++) secs[i] = secs[i - 1]! + segSeconds(points[i - 1]!, points[i]!, points[i]!.beat);
  return { kind: 'clock', points, secs, key: hashPoints(points) };
}

// --- One segment -----------------------------------------------------------------------------------

/** True when segment a → b is a straight line in BPM (or flat). */
const straight = (a: TempoPoint, b: TempoPoint): boolean => Math.abs(a.curve) < 1e-6 || a.bpm === b.bpm;

/** The BPM along segment a → b at `x` (a.beat ≤ x ≤ b.beat), as `laneValue`'s `along`. */
function segBpm(a: TempoPoint, b: TempoPoint, x: number): number {
  const span = b.beat - a.beat;
  if (span <= 0) return b.bpm;
  const t = Math.min(1, Math.max(0, (x - a.beat) / span));
  return a.bpm + (b.bpm - a.bpm) * bend(t, a.curve, b.bpm >= a.bpm);
}

/** Seconds of 60/B over beats [a.beat, b.beat] when the BPM goes linearly from B0 to Bx over `db` beats. */
function linearSeconds(b0: number, bx: number, db: number): number {
  const d = bx - b0;
  if (Math.abs(d) <= 1e-12 * b0) return (60 * db) / b0;
  return (60 * db * Math.log1p(d / b0)) / d;
}

/** Seconds from a.beat to x along segment a → b (x in [a.beat, b.beat]). */
function segSeconds(a: TempoPoint, b: TempoPoint, x: number): number {
  const db = x - a.beat;
  if (db <= 0) return 0;
  if (a.bpm === b.bpm) return (60 * db) / a.bpm;
  if (straight(a, b)) return linearSeconds(a.bpm, segBpm(a, b, x), db);
  // Bent: composite Simpson with SIMPSON_STEPS fixed sub-steps (one Richardson step on top). `bend` is t^e from the segment's
  // start, or 1 − (1 − t)^e towards its end (e = 1 + 4|curve|); below e = 2 its curvature is
  // unbounded at that sharp end, so there Simpson runs over v with t = v² (or 1 − t = v²).
  const span = b.beat - a.beat;
  const tx = Math.min(1, db / span);
  const rising = b.bpm >= a.bpm;
  const c = rising ? a.curve : -a.curve;
  const at = (t: number) => 60 / (a.bpm + (b.bpm - a.bpm) * bend(t, a.curve, rising));
  const n = SIMPSON_STEPS;
  // Simpson over n sub-steps and over n/2 (the same samples), extrapolated once (Boole's rule).
  const simpson = (g: (u: number) => number, u0: number, u1: number) => {
    const h = (u1 - u0) / n;
    const ends = g(u0) + g(u1);
    let odd = 0, even2 = 0, odd2 = 0;
    for (let k = 1; k < n; k++) {
      const v = g(u0 + k * h);
      if (k % 2) odd += v;
      else if ((k / 2) % 2) odd2 += v;
      else even2 += v;
    }
    const fine = ((ends + 4 * odd + 2 * (odd2 + even2)) * h) / 3;
    const coarse = ((ends + 4 * odd2 + 2 * even2) * 2 * h) / 3;
    return fine + (fine - coarse) / 15;
  };
  if (Math.abs(c) >= 0.25) return simpson(at, 0, tx) * span;
  if (c < 0) return simpson(v => at(v * v) * 2 * v, 0, Math.sqrt(tx)) * span;
  return simpson(v => at(1 - v * v) * 2 * v, Math.sqrt(1 - tx), 1) * span;
}

/** The beat `s` seconds after a.beat along segment a → b (0 ≤ s ≤ the segment's seconds). */
function segBeatAfter(a: TempoPoint, b: TempoPoint, s: number): number {
  if (s <= 0) return a.beat;
  const db = b.beat - a.beat;
  if (a.bpm === b.bpm) return a.beat + (s * a.bpm) / 60;
  if (straight(a, b)) {
    const d = b.bpm - a.bpm;
    // beat = b0 + Δb·(exp(s·(B1 − B0)/(60·Δb)) − 1)·B0/(B1 − B0)
    return Math.min(b.beat, a.beat + ((db * a.bpm) / d) * Math.expm1((s * d) / (60 * db)));
  }
  let lo = a.beat, hi = b.beat;
  for (let k = 0; k < BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (segSeconds(a, b, mid) < s) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The index of the last point at or before `beat` (−1: before the first), as `laneValue`'s `pointBefore`. */
function pointAtOrBefore(points: readonly TempoPoint[], beat: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.beat <= beat) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

// --- Beats and seconds -----------------------------------------------------------------------------

/** The BPM at a beat. */
export function bpmAt(t: Tempo, beat: number): number {
  if (!isClock(t)) return t;
  const p = t.points, n = p.length;
  const i = pointAtOrBefore(p, beat);
  if (i < 0) return p[0]!.bpm;
  if (i >= n - 1) return p[n - 1]!.bpm;
  return segBpm(p[i]!, p[i + 1]!, beat);
}

/** Seconds from beat 0 to `beat` (negative for a negative beat). */
export function secondsAt(t: Tempo, beat: number): number {
  if (!isClock(t)) return beat * spbOfNumber(t);
  const p = t.points, n = p.length;
  const i = pointAtOrBefore(p, beat);
  if (i < 0) return t.secs[0]! + ((beat - p[0]!.beat) * 60) / p[0]!.bpm;
  if (i >= n - 1) return t.secs[n - 1]! + ((beat - p[n - 1]!.beat) * 60) / p[n - 1]!.bpm;
  return t.secs[i]! + segSeconds(p[i]!, p[i + 1]!, beat);
}

/** The beat `seconds` from beat 0 (the inverse of `secondsAt`). */
export function beatAt(t: Tempo, seconds: number): number {
  if (!isClock(t)) return seconds / spbOfNumber(t);
  const p = t.points, S = t.secs, n = p.length;
  if (seconds < S[0]!) return p[0]!.beat + ((seconds - S[0]!) * p[0]!.bpm) / 60;
  // The last point whose seconds are at or before `seconds`.
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (S[mid]! <= seconds) lo = mid + 1; else hi = mid;
  }
  const i = lo - 1;
  if (i >= n - 1) return p[n - 1]!.beat + ((seconds - S[n - 1]!) * p[n - 1]!.bpm) / 60;
  return segBeatAfter(p[i]!, p[i + 1]!, seconds - S[i]!);
}

/** Seconds from beat `a` to beat `b` (negative when b is before a). A number: `(b − a)·60/bpm`. */
export function secondsBetween(t: Tempo, a: number, b: number): number {
  if (!isClock(t)) return (b - a) * spbOfNumber(t);
  return secondsAt(t, b) - secondsAt(t, a);
}

/**
 * Seconds of `beats` beats from `from` (`secondsBetween(t, from, from + beats)`). A number:
 * `beats·60/bpm`, exactly as a length times the seconds a beat was written before the map.
 */
export function secondsOver(t: Tempo, from: number, beats: number): number {
  if (!isClock(t)) return beats * spbOfNumber(t);
  return secondsAt(t, from + beats) - secondsAt(t, from);
}

/**
 * The beat `seconds` after beat `from` (before it when negative). A number: `from + seconds·bpm/60`.
 * `rate` (1 by default) counts `seconds` at that many seconds a song second (an unwarped clip's
 * source seconds at its repitch rate): a number gives `from + seconds/(60/bpm·rate)`, as written
 * before the map.
 */
export function beatsAfter(t: Tempo, from: number, seconds: number, rate = 1): number {
  if (!isClock(t)) return from + seconds / (spbOfNumber(t) * rate);
  return beatAt(t, secondsAt(t, from) + seconds / rate);
}

/**
 * How many beats `seconds` take from beat `from` (`beatsAfter(t, from, seconds, rate) − from`;
 * negative seconds count back). A number: `seconds/(60/bpm·rate)`, exactly as a duration over the
 * seconds a beat was written before.
 */
export function beatsOver(t: Tempo, from: number, seconds: number, rate = 1): number {
  if (!isClock(t)) return seconds / (spbOfNumber(t) * rate);
  return beatAt(t, secondsAt(t, from) + seconds / rate) - from;
}

/** The BPM between beats a and b when it does not change there (a step at b does not count), else null. */
export function constantBetween(t: Tempo, a: number, b: number): number | null {
  if (!isClock(t)) return t;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const B = bpmAt(t, lo);
  if (hi <= lo) return B;
  const p = t.points, n = p.length;
  const eq = (x: number) => Math.abs(x - B) <= 1e-9;
  if (lo < p[0]!.beat && !eq(p[0]!.bpm)) return null;
  for (let k = 0; k + 1 < n; k++) {
    const s = p[k]!, e = p[k + 1]!;
    if (e.beat <= s.beat || e.beat <= lo || s.beat >= hi) continue;
    if (s.bpm !== e.bpm || !eq(s.bpm)) return null;
  }
  if (hi > p[n - 1]!.beat && !eq(p[n - 1]!.bpm)) return null;
  return B;
}

/**
 * The beats in (b0, b1) where a scheduler window must end (§3 "Tempo break"): each point, and
 * every `rampStep` beats inside a ramp (from the ramp's start). Sorted, without repeats. None for
 * a number.
 */
export function tempoBreaks(t: Tempo, b0: number, b1: number, rampStep: number): number[] {
  if (!isClock(t) || !(b1 > b0)) return [];
  const out: number[] = [];
  const p = t.points, n = p.length;
  const add = (x: number) => { if (x > b0 + 1e-9 && x < b1 - 1e-9 && out[out.length - 1] !== x) out.push(x); };
  for (let k = 0; k < n; k++) {
    const s = p[k]!;
    if (s.beat >= b1) break;
    add(s.beat);
    const e = p[k + 1];
    if (!e || e.beat <= s.beat || e.bpm === s.bpm || e.beat <= b0 || !(rampStep > 0)) continue;
    // Inside the ramp: from its start, every rampStep (the first one at or after b0).
    const first = Math.max(1, Math.ceil((b0 - s.beat) / rampStep - 1e-9));
    for (let j = first; ; j++) {
      const x = s.beat + j * rampStep;
      if (x >= e.beat - 1e-9 || x >= b1) break;
      add(x);
    }
  }
  return out;
}

/** The slowest BPM between beats a and b (inclusive). */
export function minBpmBetween(t: Tempo, a: number, b: number): number {
  return extremeBpm(t, a, b, Math.min);
}

/** The fastest BPM between beats a and b (inclusive). */
export function maxBpmBetween(t: Tempo, a: number, b: number): number {
  return extremeBpm(t, a, b, Math.max);
}

function extremeBpm(t: Tempo, a: number, b: number, pick: (x: number, y: number) => number): number {
  if (!isClock(t)) return t;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  // Every segment is monotonic between its points, so the extremes are at the ends or the points.
  let v = pick(bpmAt(t, lo), bpmAt(t, hi));
  for (const p of t.points) if (p.beat >= lo && p.beat <= hi) v = pick(v, p.bpm);
  return v;
}

/** A key for render caches: `String(t)` for a number, else a short hash of the clock's points. */
export function tempoKey(t: Tempo): string {
  return isClock(t) ? t.key : String(t);
}

/** cyrb53 of the points (beat, BPM, curve), base 36. */
function hashPoints(points: readonly TempoPoint[]): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const str = points.map(p => `${p.beat}:${p.bpm}:${p.curve}`).join(';');
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `map${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/**
 * Seconds a beat at a constant tempo, for code not yet moved onto the map (the guards'
 * `MIGRATING_B`/`MIGRATING_C` rows). @deprecated Use `secondsBetween`/`secondsOver`; this goes
 * with the last migrating row.
 */
export const spbOf = (tempo: number): number => spbOfNumber(tempo);
