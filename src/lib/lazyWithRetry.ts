import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Recovery after a deploy (1.35, U-1). Each deploy replaces the hashed chunks in `/assets`, so a
 * tab left open across one cannot fetch a page it has not opened yet ("Failed to fetch dynamically
 * imported module"), and `React.lazy` caches the failure, so a boundary's Retry rethrows it.
 *
 * Three parts, all here so the entry bundle can install the first without loading the app:
 * - `installChunkRecovery()` (called once by `main.tsx`): on Vite's `vite:preloadError`, when the
 *   chunk is really gone (the server answers 404 for it), flush the save and reload once. A
 *   `sessionStorage` time stops a loop; no storage, offline, or a save that failed: no reload, and
 *   the error boundary says "Cyber was updated" instead.
 * - `importWithRetry()` / `lazyWithRetry()`: a failed chunk import is tried once more, with a
 *   cache-busting query; if that fails too, a `ChunkLoadError` is thrown.
 * - `isChunkLoadError()` and `reloadForUpdate()` for the error boundary's message and button.
 *
 * Keep this file light: the entry bundle imports it.
 */

/** A chunk could not be loaded twice: the app was most likely updated under this tab. */
export class ChunkLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ChunkLoadError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** What the error boundary (and a failed playback key) says for a chunk error. */
export const UPDATED_MESSAGE = 'Cyber was updated. Reload to continue.';

/** Chrome, Firefox and Safari's messages for a failed module fetch, and Vite's for a CSS preload. */
const CHUNK_MESSAGE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** Whether an error is a chunk that could not be fetched (rather than a crash in the code). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'ChunkLoadError') return true;
  return typeof e.message === 'string' && CHUNK_MESSAGE.test(e.message);
}

/** The chunk's URL in a failed import's message (Chrome and Firefox name it; Safari does not). */
export function chunkUrlOf(err: unknown): string | null {
  const msg = err && typeof err === 'object' ? (err as { message?: unknown }).message : null;
  if (typeof msg !== 'string') return null;
  const m = /(https?:\/\/[^\s'"]+)/.exec(msg);
  return m?.[1]?.replace(/[).,;]+$/, '') ?? null;
}

function sameOrigin(url: string): boolean {
  try { return new URL(url).origin === location.origin; } catch { return false; }
}

/** One busted retry per chunk URL, shared by every importer of it, so it is evaluated once. */
const busted = new Map<string, Promise<unknown>>();

/**
 * Import a chunk; if the fetch fails, try once more. The retry adds a cache-busting query to the
 * chunk's URL when the browser named it (a failed module fetch can be remembered by the browser for
 * the URL); with `cacheBust: false`, or when there is no URL, it calls `load` again. A module that
 * keeps state other code shares (the transport, the synth input) passes `cacheBust: false`: a
 * busted URL is a second copy of the module if the first URL loads later. A second failure throws
 * a `ChunkLoadError`; an error thrown by the module's own code is passed through untouched.
 */
export async function importWithRetry<M>(load: () => Promise<M>, opts: { cacheBust?: boolean } = {}): Promise<M> {
  try {
    return await load();
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    const url = opts.cacheBust === false ? null : chunkUrlOf(err);
    try {
      if (url && /\.m?js(\?|$)/.test(url) && sameOrigin(url)) {
        let p = busted.get(url);
        if (!p) {
          const retryUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
          p = import(/* @vite-ignore */ retryUrl);
          busted.set(url, p);
          p.catch(() => busted.delete(url));
        }
        return (await p) as M;
      }
      return await load();
    } catch (err2) {
      if (!isChunkLoadError(err2)) throw err2;
      throw new ChunkLoadError(err2 instanceof Error ? err2.message : String(err2), err2);
    }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the same bound as React.lazy's */
/** `React.lazy` with `importWithRetry`: a module's default export… */
export function lazyWithRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T>;
/** …or the named export `key`. */
export function lazyWithRetry<M, K extends keyof M>(load: () => Promise<M>, key: K): LazyExoticComponent<M[K] extends ComponentType<any> ? M[K] : never>;
export function lazyWithRetry(load: () => Promise<any>, key?: PropertyKey): LazyExoticComponent<ComponentType<any>> {
  return lazy(() => importWithRetry(load).then(m => ({ default: m[key ?? 'default'] })));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- Reload after a deploy ---------------------------------------------------------------------

/** When this tab last reloaded for a missing chunk (ms since epoch), in sessionStorage. */
export const RELOAD_FLAG = 'cyber-chunk-reload-at';
/** No second automatic reload within this long of the first: a chunk still missing after a
 *  reload is not fixed by another, and the error boundary offers the reload instead. */
export const RELOAD_GUARD_MS = 60_000;
/** A save that hangs does not hold the reload for ever (it is then treated as failed). */
const FLUSH_TIMEOUT_MS = 8_000;

let flushFn: (() => Promise<boolean>) | null = null;

/**
 * What to save before a reload; App registers it (the workspace save signed in, the session
 * autosave signed out). It resolves true when the work is safe to reload over.
 */
export function setReloadFlush(fn: (() => Promise<boolean>) | null): void {
  flushFn = fn;
}

/** Save what there is to save; false when the save failed or took too long. */
export async function flushBeforeReload(): Promise<boolean> {
  if (!flushFn) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      flushFn(),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The error boundary's Reload: save, then reload (the person asked, so no guard). */
export async function reloadForUpdate(): Promise<void> {
  await flushBeforeReload();
  markReload(Date.now());
  location.reload();
}

/** Whether this tab reloaded for a chunk a moment ago; true when storage cannot tell (no loop). */
function reloadedRecently(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_FLAG));
    return Number.isFinite(at) && at > 0 && now - at < RELOAD_GUARD_MS;
  } catch {
    return true;
  }
}

function markReload(now: number): boolean {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Whether the chunk is gone from the server (a deploy), rather than the network failing. */
async function chunkGone(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.status === 404 || res.status === 410) return true;
    // A host that answers every path with the app's page also means the chunk is gone.
    return res.ok && /text\/html/i.test(res.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

let handling = false;

/** The `vite:preloadError` listener (exported for tests). */
export async function handlePreloadError(event: Event): Promise<void> {
  if (handling) return;
  handling = true;
  try {
    const now = Date.now();
    if (reloadedRecently(now)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const url = chunkUrlOf((event as Event & { payload?: unknown }).payload);
    if (url && sameOrigin(url) && !(await chunkGone(url))) return; // a blip: the retry handles it
    if (!(await flushBeforeReload())) return;
    if (!markReload(now)) return;
    location.reload();
  } finally {
    handling = false;
  }
}

let installed = false;

/** Listen for Vite's failed-chunk event (once; `main.tsx` calls it at startup). */
export function installChunkRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('vite:preloadError', e => { void handlePreloadError(e); });
}
