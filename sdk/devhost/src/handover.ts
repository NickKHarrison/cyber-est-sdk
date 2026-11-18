/**
 * 1.803 (the loop): **a rebuild hands over.** When `est dev` has a new build and an instance is
 * playing, the page no longer stops the old one first. It keeps playing while the new module is
 * checked and made; then the two cross over in one short ramp each way, and the new instance takes
 * what the old one was doing: the keys still held, the parameter values, the state where it loads,
 * and the transport where it was.
 *
 * This is Follow's handover in Cyber (`src/audio/est/handover.ts`: the old instance plays until the
 * new one is ready, then a crossfade of `EST_HANDOVER_FADE_S`, the old let go only once the audio
 * clock has passed the fade), done here for the page's one instance. The pure parts are in this
 * file (the tests'); `engine.ts` does the audio.
 */
import type { EstParam } from '@/audio/est/EstNode';
import { EST_HANDOVER_FADE_S } from '@/audio/est/handover';

/** The crossfade, s: Cyber's own (20 ms each way, the gains summing to one). */
export const HANDOVER_FADE_S = EST_HANDOVER_FADE_S;

/** What a hand-over carried to the new instance (`--json`'s `reload` line). */
export interface Kept {
  /** Keys that were held, sent to the new instance as note-ons. */
  notes: number;
  /** Parameter values carried (the ids both builds have). */
  params: number;
  /** Whether the old instance's state loaded in the new one. */
  state: boolean;
}

const READONLY = 8; // CLAP_PARAM_IS_READONLY as the frame protocol's FLAGS.READONLY names it

/**
 * The old instance's values the new one takes: every id both have and the new one lets the host
 * write, clamped into the new range (a range may have changed with the build).
 */
export function carriedParams(before: readonly Pick<EstParam, 'id' | 'value'>[], next: readonly EstParam[]): { id: number; value: number }[] {
  const out: { id: number; value: number }[] = [];
  for (const b of before) {
    const p = next.find(x => x.id === b.id);
    if (!p || p.flags & READONLY || !Number.isFinite(b.value)) continue;
    out.push({ id: p.id, value: Math.min(p.max, Math.max(p.min, b.value)) });
  }
  return out;
}

/** Whether a start failed because the plugin refused the state it was given (so: start it without). */
export const refusedState = (err: unknown): boolean => /refused the state/i.test(err instanceof Error ? err.message : String(err));

/** The keys held now, as the engine remembers them (a key pressed twice is held until its last release). */
export class HeldKeys {
  private keys = new Map<number, { velocity: number; src: string }>();
  on(key: number, velocity: number, src: string) { this.keys.set(key, { velocity, src }); }
  off(key: number) { this.keys.delete(key); }
  clear() { this.keys.clear(); }
  list(): { key: number; velocity: number; src: string }[] { return [...this.keys].map(([key, v]) => ({ key, ...v })); }
  get size() { return this.keys.size; }
}

/** The `reload` line a hand-over (or a refused one) logs. */
export function reloadLine(r: { ok: true; ms: number; kept: Kept; hash?: string } | { ok: false; ms: number; message: string; next?: string }): { type: 'reload'; [k: string]: unknown } {
  const ms = Math.round(r.ms);
  if (r.ok) return { type: 'reload', ok: true, ms, kept: r.kept, ...(r.hash ? { hash: r.hash } : {}) };
  // The old instance is still the one playing: nothing was carried because nothing changed hands.
  return { type: 'reload', ok: false, ms, kept: { notes: 0, params: 0, state: false }, message: r.message, ...(r.next ? { next: r.next } : {}), playing: 'the last good build' };
}
