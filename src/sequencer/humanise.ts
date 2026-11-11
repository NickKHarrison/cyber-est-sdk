import { TICKS_PER_BEAT, type Clip, type Humanise } from './sequencerTypes';
import type { ScheduledNote } from './arrangement';

/**
 * Humanise (Cyber_Arrangement_Work_Order.md §2.2, stream E): a clip's notes played a little
 * off the grid and a little uneven in velocity, the same every time. Each hit's jitter comes
 * from a seeded RNG (mulberry32) keyed on the clip's seed, the hit's position on the timeline
 * (in ticks) and its pitch, so it does not depend on how the transport cuts the song into
 * windows: playback, a loop's every pass and the offline render all hear the same hits. A
 * looped clip's repeats differ from each other (their positions differ) but never between runs.
 */

/** The most a hit moves at timing 1 (ms, either way). */
export const HUMANISE_MAX_MS = 20;
/** The most a hit's velocity moves at velocity 1 (either way, of 127). */
export const HUMANISE_MAX_VELOCITY = 32;

/** mulberry32: a small, fast, seeded PRNG. Returns a function giving [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One hit's seed: the clip's seed mixed with its tick and pitch (an integer hash). */
function hitSeed(seed: number, tick: number, pitch: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (tick >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ Math.floor(tick / 4294967296), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ ((pitch + 1) * 0x27d4eb2d), 0x165667b1) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Triangular in [-1, 1] (two uniforms): most hits move a little, few move the most. */
const tri = (r: () => number) => r() + r() - 1;

/**
 * The jitter of one hit: how many ms it moves (bounded by `timing` × 20 ms) and its new
 * velocity (bounded by `velocity` × 32, kept in 1…127). No humanise: no change.
 */
export function humaniseHit(
  note: Pick<ScheduledNote, 'startBeat' | 'pitch' | 'velocity'>,
  h: Humanise | null | undefined,
): { dtMs: number; velocity: number } {
  if (!h || (h.timing <= 0 && h.velocity <= 0)) return { dtMs: 0, velocity: note.velocity };
  const tick = Math.round(note.startBeat * TICKS_PER_BEAT);
  const r = mulberry32(hitSeed(h.seed, tick, note.pitch));
  const dt = tri(r) * Math.min(1, Math.max(0, h.timing)) * HUMANISE_MAX_MS;
  const dv = tri(r) * Math.min(1, Math.max(0, h.velocity)) * HUMANISE_MAX_VELOCITY;
  const velocity = h.velocity > 0 ? Math.max(1, Math.min(127, Math.round(note.velocity + dv))) : note.velocity;
  return { dtMs: h.timing > 0 ? dt : 0, velocity };
}

/**
 * The notes of `clip` among `notes`, humanised: start and end moved by the hit's ms converted
 * to beats at `tempo`, velocity jittered. Other clips' notes come back as they were (the same
 * objects). Prefer `humaniseHit`'s ms where swing is applied after (swing reads the exact
 * position of a note).
 */
export function humanised<T extends ScheduledNote>(notes: readonly T[], clip: Pick<Clip, 'id' | 'humanise'>, tempo: number): T[] {
  const h = clip.humanise;
  if (!h) return [...notes];
  const beatsPerMs = tempo / 60000;
  return notes.map(n => {
    if (n.clipId !== clip.id) return n;
    const { dtMs, velocity } = humaniseHit(n, h);
    // Never before the song's start: a note at 0 moves only later (its length kept).
    const db = Math.max(-n.startBeat, dtMs * beatsPerMs);
    return { ...n, startBeat: n.startBeat + db, endBeat: n.endBeat + db, velocity };
  });
}

/** `humaniseHit` for a scheduled note, finding its clip among `clips` (none: no change). */
export function humaniseScheduled(
  n: Pick<ScheduledNote, 'clipId' | 'startBeat' | 'pitch' | 'velocity'>,
  clips: readonly Pick<Clip, 'id' | 'humanise'>[],
): { dtMs: number; velocity: number } {
  const c = clips.find(x => x.id === n.clipId);
  return humaniseHit(n, c?.humanise);
}

/** A fresh seed for the re-roll button (never the current one). */
export function nextSeed(current: number, rand: () => number = Math.random): number {
  for (let i = 0; i < 8; i++) {
    const s = 1 + Math.floor(rand() * 2147483646);
    if (s !== current) return s;
  }
  return current === 1 ? 2 : 1;
}
