import { mulberry32 } from './humanise';
import type { Note } from './sequencerTypes';

/**
 * 1.354 (Cyber_Instruments_MIDI_Work_Order.md stream 7): a note's **chance** and **velocity
 * range** (Live 11's probability and velocity deviation), decided per note per pass.
 *
 * The seed rule: one mulberry32 draw sequence from (the clip's id, the note's id, the pass), so
 * the decision depends only on song data and the pass number, never on how the transport cuts the
 * song into windows or on the clock. An arrangement clip's pass is the content repeat the note
 * falls in plus `SONG_PASS_STRIDE` × the song loop's pass (the transport counts the loop's wraps
 * since Play; every render and the MIDI file play the song once, pass 0); a Session clip's is its
 * launch's repeat. The same song played twice from the same place, an export and a live room's
 * peers hear the same notes.
 */

/** A song loop's pass moves the pass by this much, past any clip's repeat count (512 bars of 1-beat content). */
export const SONG_PASS_STRIDE = 4096;

/** FNV-1a over a string's UTF-16 units (ids are short ASCII). */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The seed of one note's pass. */
export function noteSeed(clipId: string, noteId: string, pass: number): number {
  let h = (hashId(clipId) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ hashId(noteId), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (pass >>> 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ Math.floor(pass / 4294967296), 0x27d4eb2d) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Whether the note has a chance or a range to roll at all. */
export function rolls(n: Pick<Note, 'chance' | 'velRange'>): boolean {
  return (n.chance !== undefined && n.chance < 100) || !!n.velRange;
}

/**
 * One pass of a note: whether it plays, and its velocity (`velocity` given already through the
 * clip's velocity scale). The first draw decides the chance (plays when draw × 100 < chance), the
 * second the velocity, uniform over `velocity … velocity + velRange` (whole steps, kept 1…127).
 */
export function rollNote(
  n: Pick<Note, 'id' | 'chance' | 'velRange'>, velocity: number, clipId: string, pass: number,
): { plays: boolean; velocity: number } {
  if (!rolls(n)) return { plays: true, velocity };
  const r = mulberry32(noteSeed(clipId, n.id, pass));
  const c = r();
  if (n.chance !== undefined && n.chance < 100 && c * 100 >= n.chance) return { plays: false, velocity };
  const range = n.velRange ?? 0;
  if (!range) return { plays: true, velocity };
  const d = Math.floor(r() * (Math.abs(range) + 1)) * Math.sign(range);
  return { plays: true, velocity: Math.max(1, Math.min(127, velocity + d)) };
}

/** The pass of a song loop from the transport's unwrapped and wrapped beats (0 with no loop). */
export function songLoopPass(u: number, b: number, loop: { on: boolean; start: number; end: number } | undefined): number {
  if (!loop?.on) return 0;
  const len = loop.end - loop.start;
  if (!(len > 0)) return 0;
  return Math.max(0, Math.round((u - b) / len));
}
