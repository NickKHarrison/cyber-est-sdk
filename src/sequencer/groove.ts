import { mulberry32 } from './humanise';
import { noteSeed } from './noteChance';
import { TICKS_PER_BEAT, tk, type Note } from './sequencerTypes';

/**
 * 1.358 (Cyber_Instruments_MIDI_Work_Order_2.md stream 11): Live's **groove pool**. A groove is a
 * template of timing and velocity offsets over a cycle of grid steps; a MIDI clip names one
 * (`clip.groove`, an id in the song's `grooves`) and plays its notes moved by it, **at playback**
 * (`notesInWindow`, `sessionNotes`, so every render and the MIDI file too), never by rewriting its
 * notes; **Commit** writes the grooved timing into the notes (`commitGroove`, equal to what plays).
 *
 * Where a note goes: its content start's nearest step of `base` beats picks the template's step
 * (the cycle repeats from the clip's content start, so the groove follows the clip, not the song's
 * bar lines); it moves by step.t × base × Timing × the pool's Amount, plus Random × Amount × a
 * seeded draw in ±base/4 (`noteSeed(clip, note, GROOVE_PASS)`: the same every pass, so Commit
 * equals playback), its end with it (its length kept); its velocity moves by step.v × 64 ×
 * Velocity × Amount. Absent groove or Amount 0: no change.
 */

export const MAX_GROOVES = 32;
export const MAX_GROOVE_STEPS = 64;
/** The pool's global amount, percent (Live's 0…130 %). */
export const MAX_GROOVE_AMOUNT = 130;
/** The seed's pass for a groove's Random (a fixed pass, so every pass and Commit agree). */
const GROOVE_PASS = 0x67726f6f;
const EPS = 1e-9;

export interface GrooveStep {
  /** Timing offset, a share of a step (−0.5…0.5). */
  t: number;
  /** Velocity offset, −1…1 (× 64 at Velocity 100 %). */
  v: number;
}
export interface Groove {
  id: string;
  name: string;
  /** Beats a step (Live's Base): 1/4 (16ths), 1/2 (8ths), 1/3 (8th triplets)… */
  base: number;
  /** The template's cycle, step by step. */
  steps: GrooveStep[];
  /** Percent 0…100 of the template's timing. */
  timing: number;
  /** Percent 0…100 of random timing (seeded). */
  random: number;
  /** Percent −100…100 of the template's velocity. */
  velocity: number;
}

/** The pool's settings and grooves, as a song holds them (`SequencerState.grooves`, `grooveAmount`). */
export interface GroovePool { grooves?: readonly Groove[]; grooveAmount?: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// --- Templates -------------------------------------------------------------------------------

/** A swing at `pct` % (50: straight, 66.7: a triplet feel, 75: dotted): the off-step moves late. */
const swing = (pct: number): GrooveStep[] => [{ t: 0, v: 0 }, { t: Math.round((2 * pct / 100 - 1) * 1e4) / 1e4, v: -0.1 }];

export interface GrooveTemplate { key: string; name: string; base: number; steps: GrooveStep[] }
/** The built-in templates (Live's library, in short). */
export const GROOVE_TEMPLATES: readonly GrooveTemplate[] = [
  ...[50, 54, 58, 62, 66, 71, 75].map(p => ({ key: `swing16-${p}`, name: `Swing 16ths ${p}`, base: 0.25, steps: swing(p) })),
  ...[50, 54, 58, 62, 66, 71, 75].map(p => ({ key: `swing8-${p}`, name: `Swing 8ths ${p}`, base: 0.5, steps: swing(p) })),
  ...[54, 58, 62, 66, 71].map(p => ({ key: `mpc16-${p}`, name: `MPC 16 Swing ${p}`, base: 0.25, steps: [{ t: 0, v: 0.15 }, { t: Math.round((2 * p / 100 - 1) * 1e4) / 1e4, v: -0.25 }] })),
  { key: 'shuffle', name: 'Shuffle', base: 0.5, steps: [{ t: 0, v: 0.1 }, { t: 1 / 3, v: -0.2 }] },
  { key: 'laidback', name: 'Laid back', base: 0.25, steps: [{ t: 0.04, v: 0 }, { t: 0.14, v: -0.15 }, { t: 0.08, v: -0.05 }, { t: 0.18, v: -0.2 }] },
  { key: 'push', name: 'Push', base: 0.25, steps: [{ t: 0, v: 0.1 }, { t: -0.12, v: -0.1 }, { t: -0.05, v: 0.05 }, { t: -0.15, v: -0.15 }] },
];

/** A groove made from a template, at full timing, no random, full velocity. */
export function grooveFromTemplate(t: GrooveTemplate, id: string): Groove {
  return { id, name: t.name, base: t.base, steps: t.steps.map(s => ({ ...s })), timing: 100, random: 0, velocity: 100 };
}

/**
 * "Extract groove" (Live's): a groove from a clip's own timing and velocities over a cycle of
 * `cycleBeats` (a bar by default) at `base`: each step's offset is the mean distance of the notes
 * nearest it from it (a share of a step), its velocity the mean of theirs against the clip's mean
 * (÷ 64). A step no note is near is straight.
 */
export function extractGroove(notes: readonly Note[], id: string, name: string, base = 0.25, cycleBeats = 4): Groove {
  const n = clamp(Math.round(cycleBeats / base), 1, MAX_GROOVE_STEPS);
  const sums = Array.from({ length: n }, () => ({ t: 0, v: 0, c: 0 }));
  const live = notes.filter(x => !x.muted);
  const mean = live.length ? live.reduce((a, x) => a + x.velocity, 0) / live.length : 100;
  for (const x of live) {
    const step = Math.round(x.start / base);
    const s = sums[((step % n) + n) % n]!;
    s.t += (x.start - step * base) / base;
    s.v += (x.velocity - mean) / 64;
    s.c++;
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return { id, name, base, steps: sums.map(s => (s.c ? { t: r4(clamp(s.t / s.c, -0.5, 0.5)), v: r4(clamp(s.v / s.c, -1, 1)) } : { t: 0, v: 0 })), timing: 100, random: 0, velocity: 100 };
}

/** 1.381: an onset heard in an audio clip: its song beat (or its beat into the clip) and its level as a velocity (1…127). */
export interface GrooveOnset { beat: number; velocity: number }

/** Onsets closer than this (beats) are one hit (a kick and a hat detected together). */
export const ONSET_MERGE_BEATS = 1 / 32;

/**
 * 1.381 (Cyber_Instruments_MIDI_Work_Order_3.md, stream 14): Extract groove from audio. A groove from
 * an audio clip's onsets against its warp grid: onsets nearer each other than `ONSET_MERGE_BEATS`
 * are one hit (its loudest), then each step's timing and velocity as `extractGroove` reads notes
 * (the cycle from `phase`, the song beat its first step falls on: the clip's start, so a groove taken
 * from a loop on bar 3 lines up with bars). Pure.
 */
export function grooveFromOnsets(onsets: readonly GrooveOnset[], id: string, name: string, opts: { base?: number; cycleBeats?: number; phase?: number } = {}): Groove {
  const sorted = onsets.filter(o => Number.isFinite(o.beat) && Number.isFinite(o.velocity)).sort((a, b) => a.beat - b.beat);
  const hits: GrooveOnset[] = [];
  for (const o of sorted) {
    const last = hits[hits.length - 1];
    if (last && o.beat - last.beat < ONSET_MERGE_BEATS) { if (o.velocity > last.velocity) hits[hits.length - 1] = { beat: last.beat, velocity: o.velocity }; continue; }
    hits.push({ ...o });
  }
  const phase = opts.phase ?? 0;
  const notes: Note[] = hits.map((h, i) => ({ id: `o${i}`, pitch: 60, start: h.beat - phase, length: 1 / 16, velocity: clamp(Math.round(h.velocity), 1, 127) }));
  return extractGroove(notes, id, name, opts.base, opts.cycleBeats);
}

/**
 * 1.381: the pool's groove made from a template already (the same name, base and steps), so a
 * template dropped again reuses it rather than filling the pool with copies; null when there is none.
 */
export function poolGrooveFor(pool: readonly Groove[] | undefined, t: GrooveTemplate): Groove | null {
  return pool?.find(g => g.name === t.name && Math.abs(g.base - t.base) < 1e-9 && g.steps.length === t.steps.length
    && g.steps.every((s, i) => Math.abs(s.t - t.steps[i]!.t) < 1e-9 && Math.abs(s.v - t.steps[i]!.v) < 1e-9)) ?? null;
}

/**
 * 1.381: what a Browser Grooves row sets on a clip: a template's groove (the pool's copy when it has
 * one, else a new groove with `id`), or a pool groove's id; null when the row names nothing known.
 */
export function grooveForRow(pool: readonly Groove[] | undefined, row: { template?: string; pool?: string }, id: string): Groove | string | null {
  if (row.template) {
    const t = GROOVE_TEMPLATES.find(x => x.key === row.template);
    if (!t) return null;
    return poolGrooveFor(pool, t)?.id ?? grooveFromTemplate(t, id);
  }
  if (row.pool) return pool?.some(g => g.id === row.pool) ? row.pool : null;
  return null;
}

// --- Sanitising ------------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** A groove in range, or null. */
export function sanitiseGroove(raw: unknown): Groove | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  // eslint-disable-next-line no-control-regex
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
  const base = tk(clamp(fin(r.base, 0.25), 1 / 32, 4));
  const steps = Array.isArray(r.steps) ? r.steps.slice(0, MAX_GROOVE_STEPS).map(s => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return { t: clamp(fin(o.t, 0), -0.5, 0.5), v: clamp(fin(o.v, 0), -1, 1) };
  }) : [];
  if (!steps.length) steps.push({ t: 0, v: 0 });
  return {
    id: r.id, name: name || 'Groove', base, steps,
    timing: Math.round(clamp(fin(r.timing, 100), 0, 100)),
    random: Math.round(clamp(fin(r.random, 0), 0, 100)),
    velocity: Math.round(clamp(fin(r.velocity, 100), -100, 100)),
  };
}
/** The pool: up to MAX_GROOVES, ids unique, or undefined for none. */
export function sanitiseGrooves(raw: unknown): Groove[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Groove[] = [];
  const seen = new Set<string>();
  for (const g of raw) {
    if (out.length >= MAX_GROOVES) break;
    const s = sanitiseGroove(g);
    if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
  }
  return out.length ? out : undefined;
}
/** The global amount, whole percent 0…130, or undefined for 100. */
export function sanitiseGrooveAmount(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const v = Math.round(clamp(raw, 0, MAX_GROOVE_AMOUNT));
  return v === 100 ? undefined : v;
}
/** A clip's groove reference (an id), or undefined. */
export const sanitiseGrooveRef = (raw: unknown): string | undefined => (typeof raw === 'string' && ID_RE.test(raw) ? raw : undefined);

// --- Playback --------------------------------------------------------------------------------

/** A clip's groove resolved against the pool, with the amount (0…1.3); null: plays straight. */
export interface ResolvedGroove { g: Groove; amount: number }
export function resolveGroove(pool: GroovePool, id: string | undefined): ResolvedGroove | null {
  if (!id || !pool.grooves) return null;
  const g = pool.grooves.find(x => x.id === id);
  const amount = (pool.grooveAmount ?? 100) / 100;
  if (!g || amount <= 0) return null;
  return { g, amount };
}

/** The most a resolved groove moves a note, in beats (either way): the window's margin. */
export function grooveReach(r: ResolvedGroove): number {
  const maxT = Math.max(...r.g.steps.map(s => Math.abs(s.t)));
  return r.g.base * r.amount * ((maxT * r.g.timing) / 100 + (0.25 * r.g.random) / 100) + 1 / TICKS_PER_BEAT;
}

/**
 * Where one note moves: `dt` beats and `dv` velocity steps, from its content start (beats from the
 * content's beat 0). Pure; the same for every pass of the note.
 */
export function grooveShift(start: number, clipId: string, noteId: string, r: ResolvedGroove): { dt: number; dv: number } {
  const { g, amount } = r;
  const step = Math.round(start / g.base + EPS);
  const s = g.steps[((step % g.steps.length) + g.steps.length) % g.steps.length]!;
  let dt = s.t * g.base * (g.timing / 100) * amount;
  if (g.random > 0) dt += (mulberry32(noteSeed(clipId, noteId, GROOVE_PASS))() * 2 - 1) * 0.25 * g.base * (g.random / 100) * amount;
  const dv = Math.round(s.v * 64 * (g.velocity / 100) * amount) || 0;
  return { dt, dv };
}

/**
 * Commit (Live's): the clip's notes with its groove written in (start moved, length kept,
 * velocity moved, every value on ticks and in range); the clip then names no groove. The same
 * moves as playback, kept inside the content (a note never starts before 0 or at its end).
 */
export function commitGroove(notes: readonly Note[], clipId: string, contentLength: number, r: ResolvedGroove): Note[] {
  return notes.map(n => {
    const { dt, dv } = grooveShift(n.start, clipId, n.id, r);
    const start = tk(clamp(n.start + dt, 0, contentLength - 1 / TICKS_PER_BEAT));
    return { ...n, start, velocity: clamp(n.velocity + dv, 1, 127) };
  });
}
