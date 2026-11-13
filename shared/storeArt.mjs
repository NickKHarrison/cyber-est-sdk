// shared/storeArt.mjs — the EST Store's card art (1.504): a picture of each curated plugin's own window,
// made at build time by scripts/est-card-art.mjs and committed under public/est-art/, with its index
// `public/est-art/index.json`:
//
//   { v: 1, plugins: { [pluginId]: { file: '<id>.webp' | null, version, hash, width, height } } }
//
// `hash` is the bundle the picture was made from (the version's content hash). A listing carries
// `art: { url, width, height } | null`: the server (server/storeListings.mjs) and the app's catalogue
// fallback (src/components/est/store/storeData.ts) both through `storeArtOf`. Pure and light: Home's
// EST PLUGINS cards read it too (src/components/est/store/PluginArt.tsx).

export const ART_PATH = '/est-art/';
export const ART_INDEX_PATH = '/est-art/index.json';

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const FILE_RE = /^[a-z0-9][a-z0-9.-]{0,140}\.webp$/;
const size = (v) => (Number.isInteger(v) && v > 0 && v <= 4096 ? v : null);

/**
 * @typedef {{ file: string | null, version: string, hash: string, width: number | null, height: number | null }} StoreArtRow
 * @typedef {{ v: 1, plugins: Record<string, StoreArtRow> }} StoreArtIndex
 * @typedef {{ url: string, width: number, height: number }} StoreArt
 */

/** The index as read (anything malformed dropped, row by row). @param {unknown} raw @returns {StoreArtIndex} */
export function cleanArtIndex(raw) {
  /** @type {Record<string, StoreArtRow>} */
  const plugins = {};
  const src = raw && typeof raw === 'object' ? /** @type {any} */ (raw).plugins : null;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [id, r] of Object.entries(src)) {
      if (!ID_RE.test(id) || !r || typeof r !== 'object' || typeof r.hash !== 'string' || !HASH_RE.test(r.hash)) continue;
      const file = typeof r.file === 'string' && FILE_RE.test(r.file) ? r.file : null;
      plugins[id] = { file, version: typeof r.version === 'string' ? r.version.slice(0, 40) : '', hash: r.hash, width: size(r.width), height: size(r.height) };
    }
  }
  return { v: 1, plugins };
}

/**
 * A plugin's art for a listing: only when the index holds a picture made from `hash` (the listing's
 * latest version), else null. `anyVersion`: any picture of the plugin (Home's card of an installed
 * older version: it is a picture of the plugin). The url carries the hash's first 8 characters, so a
 * new picture is a new address.
 * @param {StoreArtIndex | null | undefined} index @param {string} id @param {string} hash
 * @param {{ anyVersion?: boolean }} [o] @returns {StoreArt | null}
 */
export function storeArtOf(index, id, hash, o = {}) {
  const row = index?.plugins?.[id];
  if (!row || !row.file || !row.width || !row.height) return null;
  if (!o.anyVersion && row.hash !== hash) return null;
  return { url: `${ART_PATH}${row.file}?v=${row.hash.slice(0, 8)}`, width: row.width, height: row.height };
}

/** A listing's `art` as read (the app's side): the shape checked, the url only one of ours. @param {unknown} raw @returns {StoreArt | null} */
export function cleanStoreArt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {any} */ (raw);
  const w = size(r.width), h = size(r.height);
  if (typeof r.url !== 'string' || !w || !h) return null;
  // Only a picture of this origin's art folder (a Community screenshot will have its own rule).
  if (!/^\/est-art\/[a-z0-9][a-z0-9.-]{0,140}\.webp(\?v=[0-9a-f]{8})?$/.test(r.url)) return null;
  return { url: r.url, width: w, height: h };
}
