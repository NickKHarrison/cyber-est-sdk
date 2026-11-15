/**
 * 1.551: `postMessage` from a popped-out window's own realm.
 *
 * A message's `source` is the window of the code that called `postMessage` (the HTML standard's
 * incumbent settings object), not the window the target frame sits in. The app's code runs in the
 * page's realm, so a message it posts to a frame drawn in a popup (1.495's Pop out) arrives with the
 * **page's** window as its `source`, while the frame's `parent` is the popup. EST's frame wrapper
 * (`server/estFrameWrap.mjs`) relays its parent's messages only (`e.source === parent`), so every
 * message the host posted to a popped-out plugin frame was dropped: `est:init` never reached the
 * plugin's page, and a page that waits for it (REESE WORKSHOP's `await ready`) drew nothing.
 *
 * `installRealmPoster(win)` gives a popup one function of its own realm, loaded from a `blob:`
 * script (the page's `script-src` allows `blob:`; a popup inherits the page's policy), and
 * `postFrom(win, target, data, origin)` posts through it, so the message's `source` is the popup.
 * A post asked for before the popup's script has run waits for it, in order (at most `SETTLE_MS`). For the page's own
 * window, or one without a poster (a test, a script refused), it posts directly.
 *
 * DOM only: no store, no audio.
 */

const POSTER = '__cyberRealmPost';
const POSTER_JS = `window.${POSTER} = function (target, data, origin) { target.postMessage(data, origin); };`;

/** How long a post waits for the popup's script at most. */
export const SETTLE_MS = 2000;

type Poster = (target: Window, data: unknown, origin: string) => void;
type Pending = { target: Window; data: unknown; origin: string }[];

/** Popups whose poster is loading: the posts waiting for it. */
const loading = new WeakMap<Window, Pending>();

const posterOf = (win: Window): Poster | null => {
  try {
    const f = (win as unknown as Record<string, unknown>)[POSTER];
    return typeof f === 'function' ? f as Poster : null;
  } catch { return null; }
};

const direct = (target: Window, data: unknown, origin: string) => {
  try { target.postMessage(data, origin); } catch { /* the frame went */ }
};

/** Give `win` (a same-origin popup) its own poster. Once per window; nothing for the page's own. */
export function installRealmPoster(win: Window): void {
  if (typeof window === 'undefined' || win === window || posterOf(win) || loading.has(win)) return;
  let doc: Document;
  try { doc = win.document; } catch { return; }
  if (typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return;
  // Best effort: a popup opens whatever happens here (posts then go directly).
  let url: string;
  let script: HTMLScriptElement;
  try {
    url = URL.createObjectURL(new Blob([POSTER_JS], { type: 'text/javascript' }));
    script = doc.createElement('script');
  } catch { return; }
  const queue: Pending = [];
  loading.set(win, queue);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = () => {
    if (loading.get(win) !== queue) return;
    if (timer) clearTimeout(timer);
    loading.delete(win);
    URL.revokeObjectURL(url);
    const f = posterOf(win);
    for (const m of queue.splice(0)) {
      if (f) { try { f(m.target, m.data, m.origin); } catch { /* the frame went */ } } else direct(m.target, m.data, m.origin);
    }
  };
  script.onload = settle;
  script.onerror = settle;
  // A script that never answers (refused without an event): the waiting posts go directly.
  timer = setTimeout(settle, SETTLE_MS);
  try {
    script.src = url;
    (doc.head ?? doc.documentElement).appendChild(script);
  } catch { settle(); }
}

/** Post `data` to `target` as code of `from` (the window the target frame is drawn in). */
export function postFrom(from: Window | null | undefined, target: Window, data: unknown, origin: string): void {
  if (!from || typeof window === 'undefined' || from === window) { direct(target, data, origin); return; }
  const q = loading.get(from);
  if (q) { q.push({ target, data, origin }); return; }
  const f = posterOf(from);
  if (f) { try { f(target, data, origin); } catch { /* the frame went */ } return; }
  direct(target, data, origin);
}
