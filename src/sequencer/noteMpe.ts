/**
 * 1.377 (Cyber_Instruments_MIDI_Work_Order_3.md, stream 10): **MPE as note expression** (Live 11's).
 * A note recorded from an MPE controller keeps its own pitch slide (the bend on its channel, in
 * semitones), pressure (0–1) and slide (CC 74, 0–1) as three short point lists in the note's own time
 * (beats from its start): `Note.mpe`. Recorded through `input.ts`' `noteExpression` →
 * `recording.ts`' `recordNoteExpr`, played by `mpePlayback.ts` (live and offline, the instrument's
 * `noteExpr` at each change), written to a MIDI file on per-note channels (an MPE lower zone,
 * `mpeChannels`) and read back. Pure.
 */

import type { Clip, Note } from './sequencerTypes';

export type MpeDim = 'bend' | 'pressure' | 'slide';
export const MPE_DIMS: readonly MpeDim[] = ['bend', 'pressure', 'slide'];
/** A point: beats from the note's start, and the value. */
export type MpePoint = readonly [t: number, v: number];
export type NoteMpe = Partial<Record<MpeDim, MpePoint[]>>;

/** Each dimension holds at most this many points (thinned first). */
export const MAX_MPE_POINTS = 64;
/** The bend's range in semitones (the MPE specification's per-note default, `MPE_BEND_RANGE`). */
export const MPE_BEND_SEMIS = 48;
/** Rest values: no slide, no pressure, the slide controller centred (CC 74 at 64). */
export const MPE_REST: Readonly<Record<MpeDim, number>> = { bend: 0, pressure: 0, slide: 64 / 127 };
/** How close the thinned line stays to what was played: 1/16 semitone for the bend, half a 7-bit step for the others. */
export const MPE_TOLERANCE: Readonly<Record<MpeDim, number>> = { bend: 1 / 16, pressure: 1 / 254, slide: 1 / 254 };

const TICK = 1 / 960;
const tk = (b: number) => Math.round(b / TICK) * TICK;
const range = (d: MpeDim): [number, number] => (d === 'bend' ? [-MPE_BEND_SEMIS, MPE_BEND_SEMIS] : [0, 1]);
const clampTo = (d: MpeDim, v: number) => { const [lo, hi] = range(d); return Math.min(hi, Math.max(lo, v)); };

/**
 * One dimension's samples as points: sorted, within the note (0…length), the last of several on a
 * tick kept, then thinned (Ramer–Douglas–Peucker within `MPE_TOLERANCE`), at most MAX_MPE_POINTS (the
 * tolerance doubles until they fit). A run that never leaves rest is no list at all.
 */
export function thinMpe(dim: MpeDim, samples: readonly { t: number; v: number }[], length: number): MpePoint[] {
  const pts: [number, number][] = [];
  for (const s of [...samples].filter(s => Number.isFinite(s.t) && Number.isFinite(s.v)).sort((a, b) => a.t - b.t)) {
    const t = tk(Math.min(Math.max(0, s.t), Math.max(0, length))), v = clampTo(dim, s.v);
    const last = pts[pts.length - 1];
    if (last && last[0] === t) last[1] = v; else pts.push([t, v]);
  }
  if (!pts.length || pts.every(p => Math.abs(p[1] - MPE_REST[dim]) < 1e-9)) return [];
  let tol = MPE_TOLERANCE[dim];
  for (;;) {
    const kept = rdp(pts, tol);
    if (kept.length <= MAX_MPE_POINTS) return kept.map(p => [p[0], round(dim, p[1])] as const);
    tol *= 2;
  }
}

const round = (d: MpeDim, v: number) => (d === 'bend' ? Math.round(v * 1000) / 1000 : Math.round(v * 10000) / 10000);

function rdp(pts: readonly [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a]!, pb = pts[b]!;
    let worst = -1, dist = tol;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i]!;
      const span = pb[0] - pa[0];
      const line = span > 0 ? pa[1] + ((pb[1] - pa[1]) * (p[0] - pa[0])) / span : pb[1];
      const d = Math.abs(p[1] - line);
      if (d > dist) { dist = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A note's expression from samples of each dimension (empty dimensions left out; null when none). */
export function noteMpeFrom(samples: readonly { t: number; dim: MpeDim; v: number }[], length: number): NoteMpe | null {
  const out: NoteMpe = {};
  for (const d of MPE_DIMS) {
    const pts = thinMpe(d, samples.filter(s => s.dim === d), length);
    if (pts.length) out[d] = pts;
  }
  return Object.keys(out).length ? out : null;
}

/** A note's `mpe` from anything (storage, a peer, a MIDI file), or undefined. */
export function sanitiseNoteMpe(raw: unknown, length: number): NoteMpe | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: NoteMpe = {};
  for (const d of MPE_DIMS) {
    const list = r[d];
    if (!Array.isArray(list)) continue;
    const pts: MpePoint[] = [];
    let last = -1;
    for (const p of list.slice(0, MAX_MPE_POINTS)) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const t = tk(Math.min(Math.max(0, p[0]), length));
      if (t < last) continue;
      const v = round(d, clampTo(d, p[1]));
      // Two on one tick: the later one.
      if (t === last) pts[pts.length - 1] = [t, v]; else pts.push([t, v]);
      last = t;
    }
    if (pts.length) out[d] = pts;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A dimension's value at `t` beats into the note: linear between points, held before the first and after the last; rest with none. */
export function mpeAt(pts: readonly MpePoint[] | undefined, t: number, dim: MpeDim): number {
  if (!pts || !pts.length) return MPE_REST[dim];
  if (t <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (t <= b[0]) {
      const a = pts[i - 1]!;
      const span = b[0] - a[0];
      return span > 0 ? a[1] + ((b[1] - a[1]) * (t - a[0])) / span : b[1];
    }
  }
  return pts[pts.length - 1]![1];
}

/** Whether a note has any expression. */
export const hasMpe = (n: { mpe?: NoteMpe }): boolean => !!n.mpe && MPE_DIMS.some(d => (n.mpe![d]?.length ?? 0) > 0);

/**
 * The changes to send over a note: sampled every `step` beats from 0 to `length` (and at every
 * point), a dimension sent when it moved at least its tolerance since it was last sent (its first
 * value always, at 0). Each change carries every dimension that moved there. Pure: the live
 * scheduler and the offline render both post these.
 */
export function mpeChanges(mpe: NoteMpe, length: number, step: number): { t: number; bend?: number; pressure?: number; slide?: number }[] {
  const times = new Set<number>([0]);
  const st = step > 0 ? step : length;
  for (let t = st; t < length - 1e-9 && times.size < 4096; t += st) times.add(t);
  for (const d of MPE_DIMS) for (const p of mpe[d] ?? []) if (p[0] <= length) times.add(p[0]);
  const sorted = [...times].sort((a, b) => a - b);
  const last: Partial<Record<MpeDim, number>> = {};
  const out: { t: number; bend?: number; pressure?: number; slide?: number }[] = [];
  for (const t of sorted) {
    const ch: { t: number; bend?: number; pressure?: number; slide?: number } = { t };
    let moved = false;
    for (const d of MPE_DIMS) {
      if (!mpe[d]?.length) continue;
      const v = mpeAt(mpe[d], t, d);
      const prev = last[d];
      if (prev === undefined || Math.abs(v - prev) >= MPE_TOLERANCE[d]) { ch[d] = v; last[d] = v; moved = true; }
    }
    if (moved) out.push(ch);
  }
  return out;
}

/**
 * An MPE lower zone for a MIDI file (channel 1 the master, 2–16 members): each note with expression
 * gets a member channel not in use by an overlapping note (the least recently freed first, as an MPE
 * controller rotates); with all fifteen busy the oldest is shared. Notes without expression keep
 * channel 1. Returns each note's channel 1–16, in the notes' order. Pure.
 */
export function mpeChannels(notes: readonly { start: number; length: number; mpe?: NoteMpe }[]): number[] {
  const order = notes.map((n, i) => i).sort((a, b) => notes[a]!.start - notes[b]!.start || a - b);
  const freeAt = new Array<number>(17).fill(-Infinity);
  const out = new Array<number>(notes.length).fill(1);
  for (const i of order) {
    const n = notes[i]!;
    if (!hasMpe(n)) continue;
    let best = 2;
    for (let ch = 2; ch <= 16; ch++) if (freeAt[ch]! < freeAt[best]!) best = ch;
    // Prefer a channel already free at the note's start (the one freed longest ago is `best` either way).
    out[i] = best;
    freeAt[best] = n.start + n.length;
  }
  return out;
}

/** The 14-bit pitch bend value (0–16383, centre 8192) for `semis` over ±MPE_BEND_SEMIS. */
export function bendWord(semis: number): number {
  return Math.max(0, Math.min(16383, Math.round(8192 + (clampTo('bend', semis) / MPE_BEND_SEMIS) * 8192)));
}
/** Back from the 14-bit word. */
export const semisOfBend = (word: number): number => ((word - 8192) / 8192) * MPE_BEND_SEMIS;

/**
 * The clip note a scheduled note came from (`notesInWindow` gives the clip, the pitch and the song
 * beat): the note of that pitch at that place in the clip's content, within `tol` beats (a groove's
 * shift needs more), or null.
 */
export function sourceNote(c: Pick<Clip, 'start' | 'offset' | 'contentLength' | 'notes'>, pitch: number, startBeat: number, tol = Infinity): Note | null {
  const pos = (((startBeat - (c.start - c.offset)) % c.contentLength) + c.contentLength) % c.contentLength;
  let best: Note | null = null;
  let dist = Infinity;
  for (const n of c.notes) {
    if (n.pitch !== pitch) continue;
    const d = Math.min(Math.abs(n.start - pos), Math.abs(n.start - pos + c.contentLength), Math.abs(n.start - pos - c.contentLength));
    if (d < dist) { dist = d; best = n; }
  }
  return dist <= tol ? best : null;
}
