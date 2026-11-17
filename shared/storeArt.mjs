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
//
// 1.690 (STORE live updates, stream 5): an index may also carry `release`, the rows of the active store
// release's `art-index.json` (shared/storeReleaseWeb.mjs `releaseArtRows`: each picture's same-origin
// hashed URL, `/est-net/v1/store/art/<sha256>.webp`), set only by the app while STORE_RELEASES_OPEN is on.
// A release row wins for its plugin; the build's own picture, when it shows the same bundle, rides along
// as `fallback`. Without `release` every answer is exactly 1.504's. (No import: the SDK's public mirror
// carries this file; shared/storeReleaseWeb.mjs takes the pattern from here.)

export const ART_PATH = '/est-art/';
export const ART_INDEX_PATH = '/est-art/index.json';

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const FILE_RE = /^[a-z0-9][a-z0-9.-]{0,140}\.webp$/;
const size = (v) => (Number.isInteger(v) && v > 0 && v <= 4096 ? v : null);

/**
 * @typedef {{ file: string | null, version: string, hash: string, width: number | null, height: number | null }} StoreArtRow
 * @typedef {{ url: string, version: string, hash: string, width: number, height: number }} StoreArtReleaseRow
 * @typedef {{ v: 1, plugins: Record<string, StoreArtRow>, release?: Record<string, StoreArtReleaseRow> }} StoreArtIndex
 * @typedef {{ url: string, width: number, height: number, fallback?: string }} StoreArt
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
  const built = buildArtOf(index, id, hash, o);
  // 1.690: the release's picture first (its address is its own hash), the build's copy as its fallback.
  const rel = index?.release?.[id];
  if (rel && (o.anyVersion || rel.hash === hash)) {
    return { url: rel.url, width: rel.width, height: rel.height, ...(built && built.url !== rel.url ? { fallback: built.url } : {}) };
  }
  return built;
}
/** The build's own picture (1.504's rule). @param {StoreArtIndex | null | undefined} index @param {string} id @param {string} hash @param {{ anyVersion?: boolean }} o */
function buildArtOf(index, id, hash, o) {
  const row = index?.plugins?.[id];
  if (!row || !row.file || !row.width || !row.height) return null;
  if (!o.anyVersion && row.hash !== hash) return null;
  return { url: `${ART_PATH}${row.file}?v=${row.hash.slice(0, 8)}`, width: row.width, height: row.height };
}

/** 1.690: a store release's picture by its hash, served from the app's own origin. */
export const RELEASE_ART_URL_RE = /^\/est-net\/v1\/store\/art\/[0-9a-f]{64}\.(?:webp|png|jpg)$/;
const BUILD_ART_URL_RE = /^\/est-art\/[a-z0-9][a-z0-9.-]{0,140}\.webp(\?v=[0-9a-f]{8})?$/;

/** A listing's `art` as read (the app's side): the shape checked, the url only one of ours. @param {unknown} raw @returns {StoreArt | null} */
export function cleanStoreArt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {any} */ (raw);
  const w = size(r.width), h = size(r.height);
  if (typeof r.url !== 'string' || !w || !h) return null;
  // Only a picture of this origin's art folder (a Community screenshot will have its own rule);
  // 1.690: or a store release's picture by its hash, with the build's picture as its fallback.
  if (BUILD_ART_URL_RE.test(r.url)) return { url: r.url, width: w, height: h };
  if (!RELEASE_ART_URL_RE.test(r.url)) return null;
  return { url: r.url, width: w, height: h, ...(typeof r.fallback === 'string' && BUILD_ART_URL_RE.test(r.fallback) ? { fallback: r.fallback } : {}) };
}
