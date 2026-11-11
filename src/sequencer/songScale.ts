import type { Scale } from './scales';

/**
 * 1.376 (Cyber_Instruments_MIDI_Work_Order_3.md, stream 9): the song's key and scale, Live 12's.
 * **Every reader of a scale goes through `scaleOf`**: the roll's highlight and Fold to scale, drawing
 * and moving notes in scale mode, the computer keys' scale, the note tools (Transformations and
 * Generators), the Scale MIDI effect's "Use the song's scale". Pure.
 *
 * Precedence: a clip's own scale (`clip.scale`), else the song's (`songScale`), else none. With no
 * clip (the keys with no clip open), the song's scale, else the project's last scale (`lastScale`,
 * 1.5/1.353's fallback) so a song without a scale behaves as before.
 */

interface SongScaleFields { songScale?: Scale | null; lastScale?: Scale | null }

export function scaleOf(seq: SongScaleFields, clip?: { scale?: Scale | null } | null): Scale | null {
  if (clip) return clip.scale ?? seq.songScale ?? null;
  return seq.songScale ?? seq.lastScale ?? null;
}

/**
 * The scale a new clip is stamped with: none while the song has a scale (the clip follows it), else
 * the project's last scale (1.5's rule). `undefined` when nothing is stamped.
 */
export function newClipScale(seq: SongScaleFields): Scale | undefined {
  return seq.songScale ? undefined : seq.lastScale ?? undefined;
}

/** A clip given its starting scale when it has none of its own (every place that makes a clip). */
export function withNewClipScale<C extends { scale?: Scale | null }>(seq: SongScaleFields, clip: C): C {
  if (clip.scale !== undefined) return clip;
  const s = newClipScale(seq);
  return s ? { ...clip, scale: s } : clip;
}

/** Whether a clip follows the song's scale (it has none of its own and the song has one). */
export const followsSong = (seq: SongScaleFields, clip: { scale?: Scale | null }): boolean => !clip.scale && !!seq.songScale;
