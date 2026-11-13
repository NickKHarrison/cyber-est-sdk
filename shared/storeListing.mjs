// shared/storeListing.mjs — the EST Store's listing (1.497, Phase A of the EST App Store plan): one
// listing per plugin, built by the server (server/storeListings.mjs) from the curated index and, while
// the community surface is open to the requester, the Community records; the app reads the same shape
// through `sanitiseStoreListing`. Pure: no DOM, no Node, no store.
//
//   { type: 'plugin', id, name, vendor, developer: { id | null, name }, kind: 'instrument' | 'effect',
//     tier: 'cyber' | 'reviewed' | 'community', early, tags, summary,
//     latest: { version, contentHash, sizeBytes, publishedAt },
//     counts: { installs, plays, wishlists }, price: null | { display }, licence: 'free' | 'paid', hasOwnUi,
//     art: null | { url, width, height }, demo: { url, seconds } | null, links: { homepage?, source?, support? },
//     reviewApproved, sale: null | { display, endsAt } }
//
// 1.504: `art` is a picture of the plugin's own window (shared/storeArt.mjs: made at build time by
// scripts/est-card-art.mjs, `/est-art/<id>.webp?v=<hash8>`), only when it was made from the listing's
// latest version; null draws the card's fallback.
//
// 1.505 (Phase B, stream 1): `demo` is the developer's demo clip (≤ 30 s, served by server/storeDev.mjs
// at `/store/dev/demo/<id>/<hash>`, the only URL shape kept) and `links` the developer's https links,
// both from the store page they write in My plugins; null and {} for a plugin without them.
//
// 1.508: `reviewApproved` is true while an admin's approval of a Community listing's version waits for
// the owner to sign it into the registry (server/estReview.mjs): the store says "Review approved,
// waiting to be published". Only a Community listing can be waiting; a signed Reviewed one is `tier`.
//
// **Counts are counts only, never who.** `installs` and `wishlists` count accounts, so a count below
// `COUNT_SHOWN_FROM` (5) is given as 0 (a small number could say who, as the public plugin pages do);
// `plays` counts presses of Play on a store page over the last 30 days and is given as it is.
// `price` is null and `licence` 'free' for every listing until the paid switch (1.501,
// `STORE_PAID_OPEN`) is on: the amount is Stripe's, never written in code. A paid listing is always of
// a tier that may be sold (`STORE_PAID_TIERS`: Reviewed or Cyber's own), never Community. Publicly the
// store is the EST Store (STORE in the app).
//
// 1.519 (bundles and launch sales, built closed): `sale` is a running launch sale's own Stripe price
// (`{ display, endsAt }`, shared/storeBundle.mjs' rules) on a paid listing, else null; after it ends the
// listing shows its normal price again.
//
// 1.515 (Phase C, stream 1): every listing says what it is, `type: 'plugin' | 'pack'`: a plugin's here,
// a sound pack's in shared/storePack.mjs (`StorePackListing`), listed by GET /store/packs beside these.
import { cleanStoreArt } from './storeArt.mjs';

/** As `src/audio/est/slot.ts`. */
export const STORE_ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
export const STORE_VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TAG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** 1.505: a demo clip's URL, the store's own route only. */
export const STORE_DEMO_URL_RE = /^\/store\/dev\/demo\/[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]\/[0-9a-f]{64}$/;
/** 1.505: the links a listing may carry (shared/estPluginMeta.mjs `META_LINKS`). */
export const STORE_LINKS = Object.freeze(['homepage', 'source', 'support']);
/** An https link kept (no credentials, at most 300 characters), else null. @param {unknown} raw */
function httpsLink(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') && ![...raw].some((c) => !shown(/** @type {number} */ (c.codePointAt(0)))) ? u.href : null;
}
/** @param {unknown} d @returns {{ url: string, seconds: number } | null} */
function demoOf(d) {
  if (!d || typeof d !== 'object') return null;
  const x = /** @type {any} */ (d);
  const seconds = Number(x.seconds);
  return typeof x.url === 'string' && STORE_DEMO_URL_RE.test(x.url) && Number.isFinite(seconds) && seconds > 0 && seconds <= 31 ? { url: x.url, seconds: Math.round(seconds * 10) / 10 } : null;
}
/** @param {unknown} l @returns {Record<string, string>} */
function linksOf(l) {
  /** @type {Record<string, string>} */
  const out = {};
  if (l && typeof l === 'object' && !Array.isArray(l)) for (const k of STORE_LINKS) { const v = httpsLink(/** @type {any} */ (l)[k]); if (v) out[k] = v; }
  return out;
}

export const STORE_KINDS = Object.freeze(['instrument', 'effect']);
export const STORE_TIERS = Object.freeze(['cyber', 'reviewed', 'community']);
export const STORE_SORTS = Object.freeze(['new', 'plays', 'installs', 'name', 'rated']); // 1.509: 'rated', Highest rated (shared/storeReviews.mjs `sortByRating`)
export const STORE_LICENCES = Object.freeze(['free', 'paid']);
/**
 * 1.501 (the owner's decision of 12 Nov): the tiers a paid listing may have. A plugin is sold only once
 * Cyber has reviewed it (or it is Cyber's own): a Community listing is never offered for sale, whatever
 * the price table says (the builder makes it free, and the table's write refuses it).
 */
export const STORE_PAID_TIERS = Object.freeze(['cyber', 'reviewed']);
/** Whether a listing of `tier` may be sold. @param {unknown} tier */
export const mayBeSold = (tier) => STORE_PAID_TIERS.includes(/** @type {any} */ (tier));
/** The most listings one page of GET /store/listings carries. */
export const STORE_PAGE_MAX = 60;
/** A listing's tags, at most. */
export const STORE_TAGS_MAX = 8;
/** An account's wishlist, at most (ids only). */
export const WISHLIST_MAX = 500;
/** An account count (installs, wishlists) below this is given as 0. */
export const COUNT_SHOWN_FROM = 5;
/** The days `counts.plays` sums. */
export const PLAYS_DAYS = 30;
/** How many ids a shelf holds, at most. */
export const SHELF_SIZE = 12;
/** "New this week": a latest version published this many days ago or less. */
export const NEW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The shelves of GET /store/front, in order, with their titles: the one place they are written.
 * `tag` shelves hold the listings carrying that tag; the others are named by their id.
 * @type {readonly { id: string, title: string, tag?: string }[]}
 */
export const STORE_SHELVES = Object.freeze([
  { id: 'new', title: 'New this week' },
  { id: 'most-played', title: 'Most played' },
  { id: 'from-cyber', title: 'From Cyber' },
  { id: 'instruments', title: 'Instruments' },
  { id: 'effects', title: 'Effects' },
  { id: 'sequencers', title: 'Sequencers', tag: 'sequencer' },
  { id: 'drums', title: 'Drums and breaks', tag: 'drums' },
  { id: 'game', title: 'For games', tag: 'game' },
]);

/** The registry's tier as the store names it ('curated' is Cyber's own catalogue). @param {unknown} t */
export function storeTierOf(t) {
  return t === 'community' ? 'community' : t === 'reviewed' ? 'reviewed' : 'cyber';
}

/** A tag as kept: lowercase, a-z, 0-9 and '-', at most 32 characters; null otherwise. @param {unknown} s */
export function cleanTag(s) {
  if (typeof s !== 'string') return null;
  const t = s.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return TAG_RE.test(t) ? t : null;
}

/** A manifest's features as store tags (the generic ones say nothing). */
const FEATURE_TAGS = Object.freeze({
  synthesizer: 'synth', 'drum-machine': 'drums', drum: 'drums', sampler: 'sampler', arpeggiator: 'arpeggiator', sequencer: 'sequencer',
  delay: 'delay', reverb: 'reverb', equalizer: 'eq', filter: 'filter', distortion: 'distortion', chorus: 'chorus', modulation: 'modulation',
  mastering: 'mastering', utility: 'utility', bass: 'bass', compressor: 'compressor', dynamics: 'dynamics', pitch: 'pitch',
});

/**
 * A plugin's store tags: the curated map's (est-plugins/registry/store-tags.json) first, then the
 * tags its developer wrote (the index's `tags`), then what its features say; with none of these, its
 * kind. Deduplicated, at most `STORE_TAGS_MAX`, never empty.
 * @param {{ kind: string, tags?: unknown, features?: unknown }} p @param {unknown} [curated]
 */
export function tagsFor(p, curated) {
  const out = [];
  const add = (t) => { const c = cleanTag(t); if (c && !out.includes(c) && out.length < STORE_TAGS_MAX) out.push(c); };
  if (Array.isArray(curated)) curated.forEach(add);
  if (Array.isArray(p.tags)) p.tags.forEach(add);
  if (Array.isArray(p.features)) for (const f of p.features) { const t = typeof f === 'string' ? FEATURE_TAGS[/** @type {keyof typeof FEATURE_TAGS} */ (f)] : undefined; if (t) add(t); }
  if (!out.length) add(p.kind === 'instrument' ? 'instrument' : 'effect');
  return out;
}

/** An account count as shown (below `COUNT_SHOWN_FROM`: 0). @param {unknown} n */
export const shownCount = (n) => { const k = Math.max(0, Math.floor(Number(n) || 0)); return k < COUNT_SHOWN_FROM ? 0 : k; };

/** Whether a code point is shown: not a control character, nor a zero-width or direction mark. @param {number} n */
const shown = (n) => n >= 32 && n !== 127 && !(n >= 0x200b && n <= 0x200f) && !(n >= 0x202a && n <= 0x202e) && !(n >= 0x2066 && n <= 0x2069);
const text = (v, max) => (typeof v === 'string' ? [...v].filter((c) => shown(/** @type {number} */ (c.codePointAt(0)))).join('').slice(0, max) : '');
const count = (v) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * One listing, from what the server knows (it builds them; the app checks what it reads with
 * `sanitiseStoreListing`, the same rules).
 * @param {{ id: string, name?: string, vendor?: string, developer?: { id?: string | null, name?: string } | null, kind?: string, tier?: string,
 *   early?: boolean, tags?: string[], summary?: string, latest: { version: string, contentHash: string, sizeBytes?: number, publishedAt?: string },
 *   counts?: { installs?: number, plays?: number, wishlists?: number }, price?: { display: string } | null, licence?: string, hasOwnUi?: boolean,
 *   art?: { url: string, width: number, height: number } | null,
 *   demo?: { url: string, seconds: number } | null, links?: Record<string, string> | null, reviewApproved?: boolean,
 *   sale?: { display: string, endsAt: string } | null }} p
 * @returns {StoreListing}
 */
export function buildStoreListing(p) {
  const vendor = text(p.vendor, 120);
  const devName = text(p.developer?.name, 120) || vendor || 'Cyber';
  const devId = typeof p.developer?.id === 'string' && /^dev-[a-z0-9]{10}$/.test(p.developer.id) ? p.developer.id : null;
  const tier = STORE_TIERS.includes(/** @type {any} */ (p.tier)) ? /** @type {StoreListing['tier']} */ (p.tier) : 'community';
  // 1.501: paid only in a tier that may be sold (Reviewed or Cyber's own).
  const licence = p.licence === 'paid' && mayBeSold(tier) ? 'paid' : 'free';
  return {
    type: 'plugin',
    id: p.id,
    name: text(p.name, 120) || p.id,
    vendor: vendor || devName,
    developer: { id: devId, name: devName },
    kind: p.kind === 'instrument' ? 'instrument' : 'effect',
    tier,
    early: p.early === true,
    tags: (Array.isArray(p.tags) ? p.tags : []).map(cleanTag).filter((t) => t !== null).slice(0, STORE_TAGS_MAX),
    summary: text(p.summary, 500),
    latest: {
      version: p.latest.version,
      contentHash: p.latest.contentHash,
      sizeBytes: count(p.latest.sizeBytes),
      publishedAt: Number.isFinite(Date.parse(String(p.latest.publishedAt ?? ''))) ? new Date(Date.parse(String(p.latest.publishedAt))).toISOString() : '',
    },
    counts: { installs: shownCount(p.counts?.installs), plays: count(p.counts?.plays), wishlists: shownCount(p.counts?.wishlists) },
    price: licence === 'paid' && p.price && typeof p.price.display === 'string' && p.price.display ? { display: text(p.price.display, 40) } : null,
    licence,
    hasOwnUi: p.hasOwnUi === true,
    art: cleanStoreArt(p.art),
    demo: demoOf(p.demo),
    links: linksOf(p.links),
    reviewApproved: p.reviewApproved === true && tier === 'community',
    // 1.519: a running sale shows only on a paid listing (its normal price stays in `price`).
    sale: licence === 'paid' ? saleOf(p.sale) : null,
  };
}

/** A sale's public part, `{ display, endsAt }`, or null. @param {unknown} v */
function saleOf(v) {
  const r = v && typeof v === 'object' ? /** @type {any} */ (v) : null;
  const display = text(r?.display, 40);
  const t = Date.parse(String(r?.endsAt ?? ''));
  return display && Number.isFinite(t) ? { display, endsAt: new Date(t).toISOString() } : null;
}

/**
 * @typedef {{
 *   type: 'plugin', id: string, name: string, vendor: string, developer: { id: string | null, name: string },
 *   kind: 'instrument' | 'effect', tier: 'cyber' | 'reviewed' | 'community', early: boolean, tags: string[], summary: string,
 *   latest: { version: string, contentHash: string, sizeBytes: number, publishedAt: string },
 *   counts: { installs: number, plays: number, wishlists: number }, price: { display: string } | null, licence: 'free' | 'paid', hasOwnUi: boolean,
 *   art: { url: string, width: number, height: number } | null,
 *   demo: { url: string, seconds: number } | null, links: Record<string, string>,
 *   reviewApproved: boolean,
 *   sale: { display: string, endsAt: string } | null,
 * }} StoreListing
 */

/**
 * A listing as read (the app's side): the shape checked field by field, or null when it is not one.
 * @param {unknown} raw @returns {StoreListing | null}
 */
export function sanitiseStoreListing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {any} */ (raw);
  // 1.515: a sound pack is not a plugin's listing (an older server sends no type: a plugin).
  if (r.type !== undefined && r.type !== 'plugin') return null;
  if (typeof r.id !== 'string' || !STORE_ID_RE.test(r.id)) return null;
  const l = r.latest;
  if (!l || typeof l !== 'object' || typeof l.version !== 'string' || !STORE_VERSION_RE.test(l.version) || typeof l.contentHash !== 'string' || !HASH_RE.test(l.contentHash)) return null;
  const listing = buildStoreListing({ ...r, latest: l });
  // A shown count is already rounded by the server: the app keeps what it was sent.
  listing.counts = { installs: count(r.counts?.installs), plays: count(r.counts?.plays), wishlists: count(r.counts?.wishlists) };
  return listing;
}

const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

/**
 * The listings a query keeps. `early`: show early plugins too (new Community plugins, not yet two
 * weeks old; hidden by default, as on the public plugin pages).
 * @param {StoreListing[]} list @param {{ q?: string, kind?: string, tier?: string, tag?: string, early?: boolean }} f
 */
export function filterListings(list, { q = '', kind = '', tier = '', tag = '', early = false } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean).slice(0, 8);
  const t = cleanTag(tag);
  return list
    .filter((p) => !kind || p.kind === kind)
    .filter((p) => !tier || p.tier === tier)
    .filter((p) => !t || p.tags.includes(t))
    .filter((p) => early || !p.early)
    .filter((p) => !words.length || words.every((w) => fold(`${p.name} ${p.vendor} ${p.developer.name} ${p.summary} ${p.tags.join(' ')} ${p.id}`).includes(w)));
}

const newestOf = (p) => Date.parse(p.latest.publishedAt) || 0;
const byName = (a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id);

/** The listings in an order (a copy). Ties go by name, then id, so a page boundary never moves. @param {StoreListing[]} list @param {string} sort */
export function sortListings(list, sort) {
  const out = [...list];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'plays') return out.sort((a, b) => b.counts.plays - a.counts.plays || newestOf(b) - newestOf(a) || byName(a, b));
  if (sort === 'installs') return out.sort((a, b) => b.counts.installs - a.counts.installs || newestOf(b) - newestOf(a) || byName(a, b));
  return out.sort((a, b) => newestOf(b) - newestOf(a) || byName(a, b));
}

/** A page cursor: the offset, as an opaque string. @param {number} n */
export const cursorOf = (n) => `o${n.toString(36)}`;
/** A cursor read back: its offset, or 0 when it is not one. @param {unknown} c */
export function offsetOf(c) {
  const m = typeof c === 'string' ? /^o([0-9a-z]{1,8})$/.exec(c) : null;
  const n = m ? parseInt(/** @type {string} */ (m[1]), 36) : 0;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * One page: at most `limit` (at most `STORE_PAGE_MAX`) from the cursor's offset, the next page's
 * cursor (null on the last page) and how many matched.
 * @param {StoreListing[]} list @param {unknown} cursor @param {number} [limit]
 */
export function pageOf(list, cursor, limit = STORE_PAGE_MAX) {
  const size = Math.max(1, Math.min(STORE_PAGE_MAX, Math.floor(Number(limit)) || STORE_PAGE_MAX));
  const from = Math.min(offsetOf(cursor), list.length);
  const listings = list.slice(from, from + size);
  return { listings, next: from + size < list.length ? cursorOf(from + size) : null, total: list.length };
}

/** Whole weeks since the Unix epoch (a Thursday): the weekly pick's turn. @param {number} now */
export const weekOf = (now) => Math.floor(now / (7 * DAY_MS));

/**
 * The first-party pick of the week: Cyber's own listings by id, one a week in turn; null when there is none.
 * @param {StoreListing[]} list @param {number} now
 */
export function weeklyPick(list, now) {
  const own = list.filter((p) => p.tier === 'cyber' && !p.early).sort((a, b) => a.id.localeCompare(b.id));
  return own.length ? /** @type {StoreListing} */ (own[weekOf(now) % own.length]) : null;
}

/**
 * The front page's shelves (`STORE_SHELVES`, in order), each at most `SHELF_SIZE` ids; a shelf with
 * nothing on it is left out. Early plugins sit on no shelf.
 * @param {StoreListing[]} list @param {number} now
 * @returns {{ id: string, title: string, ids: string[] }[]}
 */
export function shelvesOf(list, now) {
  const shown = list.filter((p) => !p.early);
  /** @type {Record<string, (l: StoreListing[]) => StoreListing[]>} */
  const pick = {
    new: (l) => sortListings(l.filter((p) => newestOf(p) && now - newestOf(p) <= NEW_DAYS * DAY_MS), 'new'),
    'most-played': (l) => sortListings(l.filter((p) => p.counts.plays > 0), 'plays'),
    'from-cyber': (l) => sortListings(l.filter((p) => p.tier === 'cyber'), 'new'),
    instruments: (l) => sortListings(l.filter((p) => p.kind === 'instrument'), 'plays'),
    effects: (l) => sortListings(l.filter((p) => p.kind === 'effect'), 'plays'),
  };
  const out = [];
  for (const s of STORE_SHELVES) {
    const rows = s.tag ? sortListings(shown.filter((p) => p.tags.includes(/** @type {string} */ (s.tag))), 'plays') : (pick[s.id]?.(shown) ?? []);
    const ids = rows.slice(0, SHELF_SIZE).map((p) => p.id);
    if (ids.length) out.push({ id: s.id, title: s.title, ids });
  }
  return out;
}

/**
 * A wishlist as sent: plugin ids, deduplicated in order. `{ ok: true, ids }` or `{ ok: false, error }`
 * (more than `WISHLIST_MAX`, or an id that is not one, refuses the whole list).
 * @param {unknown} raw
 * @returns {{ ok: true, ids: string[], error?: undefined } | { ok: false, error: string, ids?: undefined }}
 */
export function cleanWishlist(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'send { ids: [...] }' };
  const ids = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !STORE_ID_RE.test(id)) return { ok: false, error: 'bad plugin id' };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > WISHLIST_MAX) return { ok: false, error: `A wishlist holds at most ${WISHLIST_MAX} plugins.` };
  return { ok: true, ids };
}
