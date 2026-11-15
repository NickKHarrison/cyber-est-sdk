// shared/storeDemo.mjs — the EST Store's first-party demos (1.605): a short musical clip of each curated
// plugin, rendered at build time by scripts/est-demo-clips.mjs (an original arrangement per plugin,
// scripts/est-demo-scores.mjs) and committed under public/est-demos/, with its index
// `public/est-demos/index.json`:
//
//   { v: 1, plugins: { [pluginId]: { file: '<id>.mp3', version, hash, seconds, bytes, lufs } } }
//
// `hash` is the bundle the demo was rendered from (the version's content hash), so a demo shows only for
// its exact version, as the card art (shared/storeArt.mjs). A listing's `demo` is `{ url, seconds }`:
// the server (server/storeListings.mjs) and the app's catalogue fallback (src/components/est/store/
// storeData.ts) both through `storeDemoOf`; the detail's `DemoPlayer` plays it. A developer's demo clip
// (1.505, `/store/dev/demo/<id>/<hash>`) keeps its own shape; `isStoreDemoUrl` takes both. Pure and light.

export const DEMO_PATH = '/est-demos/';
export const DEMO_INDEX_PATH = '/est-demos/index.json';

/** The store's demo level: integrated loudness (LUFS) and the true-peak ceiling (dBTP). */
export const DEMO_LUFS = -16;
export const DEMO_CEILING_DB = -1;
/** A first-party demo's length (seconds) and size. */
export const DEMO_MIN_SECONDS = 20;
export const DEMO_MAX_SECONDS = 40;
export const DEMO_MAX_FILE_BYTES = 600 * 1024;
/**
 * The whole folder's budget (bytes): never precached by the service worker, fetched only on Play, and
 * (1.624) streamed from disk by the server, never held in its memory. 1.624 gives every catalogue plugin a
 * demo: 70 demos of 29.9 s on average at 112 kbit/s (14 KB a second) are 28.0 MB (29,382,929 bytes, about
 * 420 KB each). 32 MB (33,554,432 bytes) holds them with room for nine more of the average length; a plugin past that
 * moves this number with its arithmetic here (the per-file cap, 600 KB, is about 43 s at the bit rate).
 */
export const DEMO_BUDGET_BYTES = 32 * 1024 * 1024;

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const FILE_RE = /^[a-z0-9][a-z0-9.-]{0,140}\.mp3$/;
/** A first-party demo's URL: this origin's demo folder, with its bundle's `?v=<hash8>`. */
export const FIRST_PARTY_DEMO_URL_RE = /^\/est-demos\/[a-z0-9][a-z0-9.-]{0,140}\.mp3\?v=[0-9a-f]{8}$/;
/** 1.505: a developer's demo clip's URL (the store's own route). */
export const DEV_DEMO_URL_RE = /^\/store\/dev\/demo\/[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]\/[0-9a-f]{64}$/;

/**
 * @typedef {{ file: string, version: string, hash: string, seconds: number, bytes: number, lufs: number | null }} StoreDemoRow
 * @typedef {{ v: 1, plugins: Record<string, StoreDemoRow> }} StoreDemoIndex
 * @typedef {{ url: string, seconds: number }} StoreDemo
 */

/** The index as read (anything malformed dropped, row by row). @param {unknown} raw @returns {StoreDemoIndex} */
export function cleanDemoIndex(raw) {
  /** @type {Record<string, StoreDemoRow>} */
  const plugins = {};
  const src = raw && typeof raw === 'object' ? /** @type {any} */ (raw).plugins : null;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [id, r] of Object.entries(src)) {
      if (!ID_RE.test(id) || !r || typeof r !== 'object') continue;
      if (typeof r.hash !== 'string' || !HASH_RE.test(r.hash) || typeof r.file !== 'string' || !FILE_RE.test(r.file)) continue;
      const seconds = Number(r.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > DEMO_MAX_SECONDS + 1) continue;
      plugins[id] = {
        file: r.file, version: typeof r.version === 'string' ? r.version.slice(0, 40) : '', hash: r.hash,
        seconds: Math.round(seconds * 10) / 10,
        bytes: Number.isSafeInteger(r.bytes) && r.bytes > 0 ? r.bytes : 0,
        lufs: Number.isFinite(r.lufs) ? r.lufs : null,
      };
    }
  }
  return { v: 1, plugins };
}

/**
 * A plugin's first-party demo for a listing: only when the index holds a demo rendered from `hash` (the
 * listing's latest version), else null. The url carries the hash's first 8 characters, so a new
 * demo is a new address.
 * @param {StoreDemoIndex | null | undefined} index @param {string} id @param {string} hash @returns {StoreDemo | null}
 */
export function storeDemoOf(index, id, hash) {
  const row = index?.plugins?.[id];
  if (!row || !row.file || row.hash !== hash) return null;
  return { url: `${DEMO_PATH}${row.file}?v=${row.hash.slice(0, 8)}`, seconds: row.seconds };
}

/** Whether a listing's demo url is one of ours (a first-party demo or a developer's clip). @param {unknown} url */
export const isStoreDemoUrl = (url) => typeof url === 'string' && (FIRST_PARTY_DEMO_URL_RE.test(url) || DEV_DEMO_URL_RE.test(url));

/**
 * A listing's `demo` as read (either side): the url one of ours, the length within its kind's bound (a
 * developer's clip at most 30 s, half a second over for an encoder's rounding; a first-party demo
 * `DEMO_MAX_SECONDS`). @param {unknown} raw @returns {StoreDemo | null}
 */
export function cleanStoreDemo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = /** @type {any} */ (raw);
  const seconds = Number(d.seconds);
  if (!isStoreDemoUrl(d.url) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const max = FIRST_PARTY_DEMO_URL_RE.test(d.url) ? DEMO_MAX_SECONDS + 1 : 31;
  return seconds <= max ? { url: d.url, seconds: Math.round(seconds * 10) / 10 } : null;
}
