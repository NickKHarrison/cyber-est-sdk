/**
 * 1.210 (Cyber_Clip_View_Session_Resume_And_Game_DAW_Work_Order.md V3, D4): the rules the song in
 * the store follows beyond the model's own limits, set while the store holds a song that is not the
 * DAW's (the Game DAW's game song: `src/game/daw/gameDawHold.ts`). Null: the DAW's song, no extra
 * rule. Dependency-free, so the model (`roomForTracks`), the scene limit and the store's `addTrack`
 * read it without importing the game.
 *
 * And the DAW's song while it is held aside (`heldDawSong`): what the signed-out autosave and a DAW
 * project's save write in place of the store's song, so the DAW's song is never saved as the game's.
 */

export type RuledTrackKind = 'synth' | 'pads' | 'audio' | 'group';

export interface SongRules {
  /** The most tracks the song may hold (every kind together). */
  maxTracks: number;
  /** The most scenes it may hold. */
  maxScenes: number;
  /** Whether a track of this kind may be added. */
  allowKind(kind: RuledTrackKind): boolean;
  /** Who says no, in the person's words ("The Game DAW holds at most 32 tracks"). */
  tracksFullText: string;
  /** Why a kind is refused ("The Game DAW is MIDI only: no audio tracks"). */
  kindRefusal(kind: RuledTrackKind): string;
}

let rules: SongRules | null = null;
let held: unknown = null;
const heldListeners = new Set<(held: boolean) => void>();

/** The rules in force now (null: the DAW's song). */
export function songRules(): SongRules | null { return rules; }
/** Put rules in force (null: none). The Game DAW's hold only. */
export function setSongRules(r: SongRules | null): void { rules = r; }

/** The DAW's song while the store holds another (null: the store's song is the DAW's). */
export function heldDawSong<T = unknown>(): T | null { return held as T | null; }
/** Hold the DAW's song aside (null: let it go). The Game DAW's hold only. */
export function setHeldDawSong(song: unknown): void {
  const was = held !== null;
  held = song ?? null;
  if (was === (held !== null)) return;
  for (const fn of heldListeners) { try { fn(held !== null); } catch (e) { console.warn('[song] a listener of the held song failed:', e); } }
}
/** Hear when the DAW's song is held aside (true) or comes back (false); returns the unsubscribe. */
export function onHeldDawSongChange(fn: (held: boolean) => void): () => void {
  heldListeners.add(fn);
  return () => { heldListeners.delete(fn); };
}
