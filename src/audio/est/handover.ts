/**
 * DEV-E (1.325; Cyber_EST_Developers_Work_Order.md DEV-E §2): **hot reload keeps the project
 * playing.** When Follow `est dev` re-points an insert or a track to a new build, the strip (or the
 * Synth wrapper) would otherwise drop the old instance at once and play dry (an insert) or nothing
 * (an instrument) while the new one compiles and loads. Follow arms a handover here just before it
 * re-points; the one who rebuilds takes it (`takeEstHandover`) and keeps the old instance playing
 * until the new one is ready, then crossfades (`EST_FADE_S`):
 *
 * - an **insert** (`insert.ts`'s `handoverFrom`): the input feeds both; the old instance's output is
 *   heard until the new one's `ready`, then the two cross over in one 20 ms ramp each way (their gains
 *   sum to one throughout), so the gap is none: no block is dry or silent. The new instance starts
 *   from the state Follow captured onto the block (`captureEstState`).
 * - an **instrument** (`synth.ts`): notes held through the swap are released cleanly on the old
 *   instance (`allNotesOff`, its own release), which keeps sounding for its tail and then fades out;
 *   the new instance takes the notes played from then on.
 *
 * Only Follow arms one, so a version switch, an undo, a peer's change or a project opening still
 * rebuilds as before. An armed handover nobody takes lapses after `EST_HANDOVER_TTL_MS`. Light: no
 * imports, so the follower's chunk, the strip and the Synth wrapper may all hold it.
 */

/** How long an armed handover waits to be taken (ms). */
export const EST_HANDOVER_TTL_MS = 5000;
/** The instrument's fade (s): the insert's `EST_FADE_S` (insert.ts), kept here so the Synth wrapper needs no insert. */
export const EST_HANDOVER_FADE_S = 0.02;
/** An instrument's old instance: how long its released notes may ring before it fades out (s). */
export const EST_HANDOVER_TAIL_S = 1.5;

const armed = new Map<string, number>();
const keyOf = (kind: 'insert' | 'track', id: string, slotId = '') => `${kind}:${id}:${slotId}`;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Follow: the insert `slotId` on `stripId` (or the track's instrument) is about to be re-pointed. */
export function armEstHandover(kind: 'insert' | 'track', id: string, slotId?: string): void {
  armed.set(keyOf(kind, id, slotId), nowMs() + EST_HANDOVER_TTL_MS);
}

/** Whether a handover is armed for it (taken: once). */
export function takeEstHandover(kind: 'insert' | 'track', id: string | undefined, slotId?: string): boolean {
  if (!id) return false;
  const k = keyOf(kind, id, slotId);
  const until = armed.get(k);
  armed.delete(k);
  return until !== undefined && until >= nowMs();
}

/** Tests. */
export function resetEstHandoversForTests(): void { armed.clear(); }
