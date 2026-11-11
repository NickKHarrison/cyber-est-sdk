import type { Scale } from './scales';
import { scaleOf } from './songScale';

/**
 * 1.375: the song's scale as the MIDI effects read it (the Scale effect's "Use the song's scale",
 * `ScaleFx.follow`). Since 1.376 it is the song's key (`scaleOf` with no clip: the song's scale,
 * else the scale last set in the piano roll). Pure, light.
 */
export function fxSongScale(seq: Parameters<typeof scaleOf>[0] | null | undefined): Scale | null {
  return seq ? scaleOf(seq) : null;
}
