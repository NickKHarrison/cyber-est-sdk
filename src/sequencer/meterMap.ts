import { MAX_BEATS, MAX_METER_POINTS, sanitiseSig, sigAccent, sigBeats, sigUnit, tk, type MeterPoint, type SequencerState, type TimeSig } from './sequencerTypes';

/**
 * The meter rule (Cyber_Tempo_Map_Work_Order.md §2.3): the one module that places the song's bars
 * across time-signature changes. Pure: types, `sigBeats`, `sigUnit` and `sigAccent` (never the 4/4
 * constant, `beatsPerBar.test.ts`).
 *
 * The song's meter is its signature at beat 0 (`sig`, absent 4/4) and its changes after beat 0
 * (`meterMap`, each on a bar line of the meter before it). Compiled, it is a list of segments,
 * each with the beat it starts at, its signature and the 0-based index of its first bar, so bars
 * are numbered continuously across the changes: after eight 4/4 bars, a 3/4 bar 9 starts at beat
 * 32 and bar 10 at 35.
 */

/** A stretch of one signature: from `beat` (the first is at 0), its first bar being `bar` (0-based). */
export interface MeterSegment { readonly beat: number; readonly sig: TimeSig; readonly bar: number }
/** The compiled meter: at least one segment, the first at beat 0. */
export type Meter = readonly MeterSegment[];

const EPS = 1e-9;
const FOUR_FOUR: Readonly<TimeSig> = Object.freeze({ num: 4, den: 4 });
const sameSig = (a: TimeSig, b: TimeSig) => a.num === b.num && a.den === b.den;

const plainMemo = new WeakMap<TimeSig, Meter>();
const fourFourMeter: Meter = Object.freeze([Object.freeze({ beat: 0, sig: FOUR_FOUR, bar: 0 })]);
const mapMemo = new WeakMap<readonly MeterPoint[], { sig: TimeSig | undefined; meter: Meter }>();

/** The song's meter. Memoised on `sig` and `meterMap` (the store replaces them, never edits them). */
export function songMeter(seq: Pick<SequencerState, 'sig' | 'meterMap'>): Meter {
  const sig = seq.sig;
  const points = seq.meterMap;
  if (!points?.length) {
    if (!sig) return fourFourMeter;
    let m = plainMemo.get(sig);
    if (!m) { m = Object.freeze([Object.freeze({ beat: 0, sig, bar: 0 })]); plainMemo.set(sig, m); }
    return m;
  }
  const hit = mapMemo.get(points);
  if (hit && hit.sig === sig) return hit.meter;
  const meter = compileMeter(sig ?? FOUR_FOUR, points);
  mapMemo.set(points, { sig, meter });
  return meter;
}

/** The segments of a signature at 0 and its changes (sanitised: on bar lines, sorted). */
export function compileMeter(sig: TimeSig, points: readonly MeterPoint[]): Meter {
  const out: MeterSegment[] = [{ beat: 0, sig, bar: 0 }];
  for (const p of points) {
    const prev = out[out.length - 1]!;
    if (!(p.beat > prev.beat)) continue;
    out.push({ beat: p.beat, sig: p.sig, bar: prev.bar + Math.round((p.beat - prev.beat) / sigBeats(prev.sig)) });
  }
  return Object.freeze(out.map(s => Object.freeze(s)));
}

/** The index of the segment holding `beat` (the first for a negative beat). */
function segIndexAt(m: Meter, beat: number): number {
  let lo = 1, hi = m.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m[mid]!.beat <= beat + EPS) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

/** The segment holding `beat`. */
export function segmentAt(m: Meter, beat: number): MeterSegment {
  return m[segIndexAt(m, beat)]!;
}

/** The signature in force at `beat`. */
export function meterAt(m: Meter, beat: number): TimeSig {
  return segmentAt(m, beat).sig;
}

/** The bar (in beats) in force at `beat`. */
export function barBeatsAt(m: Meter, beat: number): number {
  return sigBeats(meterAt(m, beat));
}

/** The bar line at or before `beat`. */
export function barStartAt(m: Meter, beat: number): number {
  const s = segmentAt(m, beat);
  const len = sigBeats(s.sig);
  return tk(s.beat + Math.floor((beat - s.beat) / len + EPS) * len);
}

/** The bar line at or after `beat` (a beat on a bar line is its own). */
export function nextBarLine(m: Meter, beat: number): number {
  const i = segIndexAt(m, beat);
  const s = m[i]!;
  const len = sigBeats(s.sig);
  const line = tk(s.beat + Math.ceil((beat - s.beat) / len - EPS) * len);
  const next = m[i + 1];
  return next && line > next.beat ? next.beat : line;
}

/** The 0-based index of the bar holding `beat` (negative before 0). */
export function barIndexAt(m: Meter, beat: number): number {
  const s = segmentAt(m, beat);
  return s.bar + Math.floor((beat - s.beat) / sigBeats(s.sig) + EPS);
}

/** The beat where 0-based bar `bar` starts. */
export function beatOfBar(m: Meter, bar: number): number {
  let i = m.length - 1;
  while (i > 0 && m[i]!.bar > bar) i--;
  const s = m[i]!;
  return tk(s.beat + (bar - s.bar) * sigBeats(s.sig));
}

/** A bar line: its beat, its 0-based bar index and the signature of the bar it starts. */
export interface BarLine { beat: number; bar: number; sig: TimeSig }

/** The bar lines in [b0, b1), numbered continuously across the segments. */
export function barLinesBetween(m: Meter, b0: number, b1: number): BarLine[] {
  const out: BarLine[] = [];
  if (!(b1 > b0)) return out;
  for (let i = segIndexAt(m, b0); i < m.length; i++) {
    const s = m[i]!;
    if (i > 0 && s.beat >= b1) break;
    const end = Math.min(b1, m[i + 1]?.beat ?? Infinity);
    const len = sigBeats(s.sig);
    for (let k = Math.max(i === 0 ? -Infinity : 0, Math.ceil((b0 - s.beat) / len - EPS)); ; k++) {
      const beat = tk(s.beat + k * len);
      if (beat >= end - EPS) break;
      out.push({ beat, bar: s.bar + k, sig: s.sig });
    }
  }
  return out;
}

/**
 * The click's beats in [b0, b1) across the meter (as `sigClicks` for one signature): one on every
 * beat of the signature in force (its denominator's note), counted from its segment's start,
 * accented on each bar's first.
 */
export function meterClicks(m: Meter, b0: number, b1: number): { beat: number; accent: boolean }[] {
  const out: { beat: number; accent: boolean }[] = [];
  if (!(b1 > b0)) return out;
  for (let i = segIndexAt(m, b0); i < m.length; i++) {
    const s = m[i]!;
    if (i > 0 && s.beat >= b1 - EPS) break;
    const end = Math.min(b1, m[i + 1]?.beat ?? Infinity);
    const unit = sigUnit(s.sig), num = s.sig.num;
    const lo = Math.max(b0, i === 0 ? -Infinity : s.beat);
    for (let k = Math.ceil((lo - s.beat) / unit - EPS); s.beat + k * unit < end - EPS; k++) {
      out.push({ beat: s.beat + k * unit || 0, accent: ((k % num) + num) % num === 0 });
    }
  }
  return out;
}

/** The accent span of the signature in force at `beat` (`sigAccent`). */
export function accentAt(m: Meter, beat: number): number {
  return sigAccent(meterAt(m, beat));
}

/**
 * The step a grid makes at `beat`: a grid of a bar or less is anchored at the bar line (so in a
 * bar the grid does not divide, 7/8 on a 1/4 grid, the bar's last step is shorter); a longer grid
 * (several bars) at the segment's start.
 */
function gridAnchor(m: Meter, beat: number, grid: number): { to: number; anchor: number } {
  const i = segIndexAt(m, beat);
  const s = m[i]!;
  const len = sigBeats(s.sig);
  const segEnd = m[i + 1]?.beat ?? Infinity;
  if (grid > len + EPS) return { to: segEnd, anchor: s.beat };
  const bar = s.beat + Math.floor((beat - s.beat) / len + EPS) * len;
  return { to: Math.min(segEnd, bar + len), anchor: bar };
}

/** Snap a beat to the grid (beats a step; null: ticks) through the meter (§2.3 `snapSong`). */
export function snapSong(m: Meter, beat: number, grid: number | null): number {
  if (!grid) return tk(beat);
  const { to, anchor } = gridAnchor(m, beat, grid);
  let best = anchor + Math.round((beat - anchor) / grid) * grid;
  // On or past the next bar line (or the segment's end): the line. Nearer the line than the last
  // step (a bar the grid does not divide): the line too.
  if (best > to - EPS || to - beat <= beat - best + EPS) best = to;
  return tk(best);
}

/** Snap a beat down to the grid through the meter (§2.3 `snapDownSong`). */
export function snapDownSong(m: Meter, beat: number, grid: number | null): number {
  if (!grid) return tk(beat);
  const { anchor } = gridAnchor(m, beat, grid);
  return tk(anchor + Math.floor((beat - anchor) / grid + EPS) * grid);
}

/** A key for caches: the segments' beats and signatures. */
export function meterKey(m: Meter): string {
  return m.map(s => `${s.beat}:${s.sig.num}/${s.sig.den}`).join(';');
}

/**
 * The meter map with its rules (§2.1): points after beat 0, on ticks and below `MAX_BEATS`, each
 * moved to the nearest bar line of the meter before it (counted from the point before, or from 0;
 * ties to the later line); a point that lands on another (or on 0) gives way to the later one in
 * the list; a point equal to the meter before it is dropped; at most `MAX_METER_POINTS`.
 * `undefined` for none. `sig` is the song's signature at 0 (absent: 4/4).
 */
export function sanitiseMeterMap(raw: unknown, sig: TimeSig | undefined): MeterPoint[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const cands: { beat: number; sig: TimeSig; idx: number }[] = [];
  raw.slice(0, MAX_METER_POINTS * 4).forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const o = r as Record<string, unknown>;
    if (typeof o.beat !== 'number' || !Number.isFinite(o.beat)) return;
    const s = sanitiseSig(o.sig);
    if (!s) return;
    cands.push({ beat: tk(o.beat), sig: s, idx });
  });
  cands.sort((a, b) => a.beat - b.beat || a.idx - b.idx);
  const base = sig ?? FOUR_FOUR;
  const kept: { beat: number; sig: TimeSig; idx: number }[] = [];
  const before = () => kept[kept.length - 1] ?? { beat: 0, sig: base, idx: -1 };
  for (const c of cands) {
    if (kept.length >= MAX_METER_POINTS) break;
    let prev = before();
    const len = sigBeats(prev.sig);
    const k = Math.floor((c.beat - prev.beat) / len + 0.5 + EPS);
    let beat: number;
    if (k > 0) beat = tk(prev.beat + k * len);
    else {
      // It lands on the point before it (or on beat 0, the song's own `sig`).
      const top = kept[kept.length - 1];
      if (!top || c.idx < top.idx) continue;
      // The later in the list wins, at that point's bar line.
      kept.pop();
      prev = before();
      beat = top.beat;
    }
    if (beat >= MAX_BEATS) continue;
    if (sameSig(c.sig, prev.sig)) continue;
    kept.push({ beat, sig: c.sig, idx: c.idx });
  }
  return kept.length ? kept.map(p => ({ beat: p.beat, sig: p.sig })) : undefined;
}
