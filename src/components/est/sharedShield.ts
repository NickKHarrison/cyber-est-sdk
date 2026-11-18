/**
 * 1.795 (Cyber_EST_Shared_Plugins_Work_Order.md §3.5, D-64, stream 5): the shield over a **shared**
 * plugin's own window (a bundle this device holds because a project it opened names it, never one the
 * person added or installed). The window is drawn at once; until the person presses on it once, a
 * transparent layer the host owns lies over the frame, and every frame message that would write is
 * dropped (`shieldDrops`: a parameter change, a gesture, a key handed back), while the host's own
 * messages to the frame (its values, readouts, meters, the spectrum, the theme) go on, so it draws.
 * The first press lifts it for that plugin in that project for the session (this tab, memory only).
 * After that the frame's write budget (`frameCommitBudget.ts`, the sandbox attack's E-1) applies as to
 * any window. This is what makes "you see it at once" safe against E-1: a window nobody touched can
 * change nothing (the song, the undo history, a live room's doc).
 *
 * Light and pure but for the session's set: no React, no store.
 */

/** The shield's words (on the layer, and its name to a screen reader): the contract's. */
export { SHARED_SHIELD_WORDS } from '../../../shared/estSharedPlugins.mjs';

/** The frame messages a shielded window may not send: each would write (or, for a key, play into a take). */
const WRITES: ReadonlySet<string> = new Set(['est:param', 'est:gesture', 'est:key']);

/** Whether a shielded frame's message of `type` is dropped. */
export const shieldDrops = (type: string): boolean => WRITES.has(type);

/** The shield's key: one plugin (its exact bundle) in one project (none: a window outside a project). */
export const shieldKeyOf = (projectId: string | null, hash: string): string => `${projectId ?? ''}|${hash}`;

/** Whether a library record is a shared plugin's (`source: 'shared'`: stream 4's records). */
export const isSharedRecord = (installed: { source: string } | null | undefined): boolean => installed?.source === 'shared';

/**
 * The open project's id, for the shield's key: a seam the app sets (`src/audio/est/uiUrl.ts`, loaded
 * before any plugin window shows its own page), so this file and the frame import nothing of the app.
 */
let projectOf: () => string | null = () => null;
export function setShieldProjectSource(fn: () => string | null): void { projectOf = fn; }
/** The shield's key for `hash` in the open project. */
export const shieldKeyNow = (hash: string): string => shieldKeyOf(projectOf(), hash);

const armed = new Set<string>();
const listeners = new Set<() => void>();

/** Whether the person has pressed this plugin's window in this project this session. */
export const sharedArmed = (key: string): boolean => armed.has(key);

/** The first press: the shield lifts for this plugin in this project for the session. */
export function armShared(key: string): void {
  if (armed.has(key)) return;
  armed.add(key);
  for (const fn of [...listeners]) fn();
}

/** Hear a shield lifting (for `useSyncExternalStore`). */
export function subscribeSharedShield(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests, and a project closed: every shield back. */
export function resetSharedShields(): void {
  armed.clear();
  for (const fn of [...listeners]) fn();
}
