// shared/storeListing.mjs — the EST Store's listing (1.497, Phase A of the EST App Store plan): one
// listing per plugin, built by the server (server/storeListings.mjs) from the curated index and, while
// the community surface is open to the requester, the Community records; the app reads the same shape
// through `sanitiseStoreListing`. Pure: no DOM, no Node, no store.
//
//   { type: 'plugin', id, name, vendor, developer: { id | null, name }, kind: 'instrument' | 'effect',
//     tier: 'cyber' | 'reviewed' | 'community', early, tags, summary,
//     latest: { version, contentHash, sizeBytes, publishedAt },
//     counts: { installs, plays, wishlists }, price: null | { display }, licence: 'free' | 'paid', hasOwnUi,
//     art: null | { url, width, height }, checked: boolean, demo: { url, seconds } | null, links: { homepage?, source?, support? },
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
// 1.605: a curated listing's `demo` is its first-party demo (shared/storeDemo.mjs: rendered at build time
// by scripts/est-demo-clips.mjs, `/est-demos/<id>.mp3?v=<hash8>`, 20–40 s), only when it was rendered
// from the listing's latest version; `cleanStoreDemo` takes either shape.
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
import { cleanStoreDemo, DEV_DEMO_URL_RE } from './storeDemo.mjs';

/** As `src/audio/est/slot.ts`. */
export const STORE_ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
export const STORE_VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TAG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** 1.505: a developer's demo clip's URL, the store's own route only (1.605: a first-party demo's is shared/storeDemo.mjs'). */
export const STORE_DEMO_URL_RE = DEV_DEMO_URL_RE;
/** 1.505: the links a listing may carry (shared/estPluginMeta.mjs `META_LINKS`). */
export const STORE_LINKS = Object.freeze(['homepage', 'source', 'support']);
/** An https link kept (no credentials, at most 300 characters), else null. @param {unknown} raw */
function httpsLink(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') && ![...raw].some((c) => !shown(/** @type {number} */ (c.codePointAt(0)))) ? u.href : null;
}
/** A developer's demo clip (≤ 30 s) or, 1.605, a first-party demo (≤ 40 s): shared/storeDemo.mjs. @param {unknown} d @returns {{ url: string, seconds: number } | null} */
const demoOf = (d) => cleanStoreDemo(d);
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
 *   sale?: { display: string, endsAt: string } | null, checked?: boolean, hidden?: boolean }} p
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
    // 1.668: the plugin checks passed on the latest version's bytes (shared/storeChecked.mjs; the server's index only).
    checked: p.checked === true,
    // 1.519: a running sale shows only on a paid listing (its normal price stays in `price`).
    sale: licence === 'paid' ? saleOf(p.sale) : null,
    // 1.825: only on an admin's list, a plugin hidden from the store (shared/storeHidden.mjs); absent otherwise, so every other answer is unchanged.
    ...(p.hidden === true ? { hidden: /** @type {true} */ (true) } : {}),
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
 *   checked: boolean,
 *   hidden?: true,
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

/** 1.535: each publication time parsed once (sorts compare them n log n times a request). @type {Map<string, number>} */
const parsedAt = new Map();
const newestOf = (p) => {
  const s = p.latest.publishedAt;
  let t = parsedAt.get(s);
  if (t === undefined) { t = Date.parse(s) || 0; if (parsedAt.size >= 10_000) parsedAt.clear(); parsedAt.set(s, t); }
  return t;
};
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

/** 1.530: a plugin's shelves at most, by default (shared/storeFront.mjs: an admin's 1–4). */
export const MAX_SHELF_REPEATS = 2;
/**
 * 1.887: the front page's repeats under the collection grid: a plugin on at most one row below it (the grid
 * already shows every plugin once). Spread `strict` (`spreadShelves`): no floor is topped up with a repeat and
 * a row with too few plugins left is left out. `/store/charts` and a category page keep their rows whole.
 */
export const FRONT_MAX_REPEATS = 1;
/** 1.530: a shelf is never cut below this many (or all its candidates, if fewer) by spreading. */
export const SHELF_MIN = 4;
/** 1.530: the largest shelf an admin may set (shared/storeFront.mjs). */
export const SHELF_SIZE_MAX = 24;

/**
 * 1.530: each shelf of `STORE_SHELVES`, in order, with its whole ranked candidate list (not cut to a
 * size, empty ones kept). Early plugins sit on no shelf.
 * @param {StoreListing[]} list @param {number} now
 * @returns {{ id: string, title: string, ids: string[] }[]}
 */
export function shelfCandidatesOf(list, now) {
  const shown = list.filter((p) => !p.early);
  /** @type {Record<string, (l: StoreListing[]) => StoreListing[]>} */
  const pick = {
    new: (l) => sortListings(l.filter((p) => newestOf(p) && now - newestOf(p) <= NEW_DAYS * DAY_MS), 'new'),
    'most-played': (l) => sortListings(l.filter((p) => p.counts.plays > 0), 'plays'),
    'from-cyber': (l) => sortListings(l.filter((p) => p.tier === 'cyber'), 'new'),
    instruments: (l) => sortListings(l.filter((p) => p.kind === 'instrument'), 'plays'),
    effects: (l) => sortListings(l.filter((p) => p.kind === 'effect'), 'plays'),
  };
  return STORE_SHELVES.map((s) => ({
    id: s.id, title: s.title,
    ids: (s.tag ? sortListings(shown.filter((p) => p.tags.includes(/** @type {string} */ (s.tag))), 'plays') : (pick[s.id]?.(shown) ?? [])).map((p) => p.id),
  }));
}

/**
 * 1.530: the shelves **spread**, so the same plugins do not fill every shelf. Each `{ id, title, ids,
 * size?, pinned? }` (ids its whole ranked candidates) is cut to its size (`SHELF_SIZE` by default) with
 * every plugin on at most `maxRepeats` shelves (never clamped to one by default). Every (shelf, plugin)
 * candidate is ranked by its place relative to its shelf (rank ÷ the shelf's size) and taken best first,
 * so a plugin stays where it ranks best and a shelf whose plugin is spent elsewhere takes its own next
 * candidates. `featured` (the carousel's ids) each count as one appearance; `pinned` ids go first and
 * are exempt (neither limited nor counted). A shelf never drops below `SHELF_MIN` (or every candidate,
 * when fewer) because of spreading: it is topped up from its own candidates, those on the fewest rows so
 * far first (1.531; then by rank), repeats and all. Then (1.531, `distinctRows`) a row holding exactly an earlier row's plugins takes its next-ranked
 * candidates instead, or is left out (returned empty) when it has none. 1.531 spreads every plugin row
 * the front draws through this one function (shared/storeFront.mjs `applyFront`: the charts' rows too).
 * Pure and deterministic (ties: the shelf's order, then its rank).
 * 1.887: `strict` (the front under the collection grid): no floor topped up with a repeat, an admin's pinned
 * plugins counted as their row's, and a row left under its floor left out unless it is pinned or `keep`
 * (a campaign's own row, an admin's choice).
 * @param {{ id: string, title: string, ids: string[], size?: number, pinned?: string[], keep?: boolean }[]} shelves
 * @param {{ maxRepeats?: number, featured?: string[], min?: number, strict?: boolean }} [o]
 * @returns {{ id: string, title: string, ids: string[] }[]}
 */
export function spreadShelves(shelves, { maxRepeats = MAX_SHELF_REPEATS, featured = [], min = SHELF_MIN, strict = false } = {}) {
  /** @type {Map<string, number>} */
  const uses = new Map();
  for (const id of featured) uses.set(id, 1);
  const state = shelves.map((s) => {
    const size = Math.max(0, Math.min(SHELF_SIZE_MAX, Math.floor(s.size ?? SHELF_SIZE)));
    const pinned = (s.pinned ?? []).filter((id, i, a) => a.indexOf(id) === i).slice(0, size);
    return { s, size, pinned, room: size - pinned.length, rest: s.ids.filter((id, i, a) => !pinned.includes(id) && a.indexOf(id) === i), took: /** @type {Set<string>} */ (new Set()), dropped: false };
  });
  // 1.887: strict, an admin's pinned plugins (the Staff picks) count as their row's, so no other row repeats them.
  if (strict) for (const st of state) for (const id of st.pinned) uses.set(id, (uses.get(id) ?? 0) + 1);
  const entries = [];
  state.forEach((st, si) => {
    const scale = Math.max(1, Math.min(st.rest.length, st.room));
    st.rest.forEach((id, rank) => entries.push({ si, id, rank, score: rank / scale }));
  });
  entries.sort((a, b) => a.score - b.score || a.si - b.si || a.rank - b.rank);
  for (const e of entries) {
    const st = /** @type {typeof state[number]} */ (state[e.si]);
    if (st.took.size >= st.room) continue;
    const n = uses.get(e.id) ?? 0;
    if (n >= maxRepeats) continue;
    st.took.add(e.id);
    uses.set(e.id, n + 1);
  }
  for (const st of state) {
    const floor = Math.min(Math.max(0, Math.min(min, st.size) - st.pinned.length), st.rest.length, st.room);
    // 1.531: topped up with the candidates on the fewest rows so far (then by rank), so a floor repeats as little as it can.
    const order = st.rest.filter((id) => !st.took.has(id)).map((id, rank) => ({ id, rank })).sort((a, b) => (uses.get(a.id) ?? 0) - (uses.get(b.id) ?? 0) || a.rank - b.rank);
    for (const { id } of order) {
      if (st.took.size >= floor) break;
      // 1.887: strict (the front below the collection grid) tops up only with plugins on no row yet.
      if (strict && (uses.get(id) ?? 0) >= maxRepeats) continue;
      st.took.add(id); uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    // 1.887: strict, a row left under its floor (and not an admin's pinned row) is left out, its plugins freed.
    if (strict && !st.pinned.length && !st.s.keep && st.took.size < Math.min(min, st.size)) {
      for (const id of st.took) uses.set(id, (uses.get(id) ?? 1) - 1);
      st.took.clear();
      st.dropped = true;
    }
  }
  distinctRows(state, featured, maxRepeats);
  return state.map((st) => ({ id: st.s.id, title: st.s.title, ids: st.dropped ? [] : [...st.pinned, ...st.rest.filter((id) => st.took.has(id))] }));
}

/** Whether two id lists hold the same plugins (whatever their order). @param {Set<string>} a @param {Set<string>} b */
const samePlugins = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));

/**
 * 1.531: **no two rows the same plugins.** A small catalogue can leave two rows holding exactly the same
 * plugins after spreading (the charts' Top 10 and New and notable once did, in the same order). Walking
 * the rows in order, a row whose plugins (as a set, so the same order too) equal an earlier row's takes
 * as many of its candidates again, those on the fewest earlier rows first (then under `maxRepeats`, then
 * on the fewest rows, then its own rank), so its next-ranked candidates come in for the shared ones; it
 * keeps its length and is drawn in its own ranked order. A row that still holds an earlier row's plugins
 * (it has no other candidates) is left out of the front (`dropped`). A row with pinned plugins is an admin's choice
 * and is left as it is. Mutates `state` (spreadShelves' own).
 * @param {{ pinned: string[], rest: string[], took: Set<string>, dropped?: boolean }[]} state
 * @param {string[]} featured @param {number} maxRepeats
 */
function distinctRows(state, featured, maxRepeats) {
  /** @type {Map<string, number>} */
  const uses = new Map();
  for (const id of featured) uses.set(id, 1);
  for (const st of state) for (const id of st.took) uses.set(id, (uses.get(id) ?? 0) + 1);
  /** @type {Set<string>[]} */
  const kept = [];
  for (const st of state) {
    if (!st.took.size) continue;
    if (st.pinned.length) { kept.push(new Set(st.took)); continue; }
    if (kept.some((k) => samePlugins(k, st.took))) {
      // Rebuilt from its candidates: those on the fewest earlier rows first, then under the limit, then fewest uses, then rank.
      const onRows = (id) => kept.filter((k) => k.has(id)).length;
      const order = st.rest.map((id, rank) => ({ id, rank, rows: onRows(id), over: (uses.get(id) ?? 0) - (st.took.has(id) ? 1 : 0) >= maxRepeats ? 1 : 0 }))
        .sort((a, b) => a.rows - b.rows || a.over - b.over || (uses.get(a.id) ?? 0) - (uses.get(b.id) ?? 0) || a.rank - b.rank);
      const next = new Set(order.slice(0, st.took.size).map((x) => x.id));
      for (const id of st.took) if (!next.has(id)) uses.set(id, (uses.get(id) ?? 1) - 1);
      for (const id of next) if (!st.took.has(id)) uses.set(id, (uses.get(id) ?? 0) + 1);
      st.took = next;
      if (kept.some((k) => samePlugins(k, st.took))) {
        st.dropped = true;
        for (const id of st.took) uses.set(id, (uses.get(id) ?? 1) - 1);
        continue;
      }
    }
    kept.push(new Set(st.took));
  }
}

/**
 * The front page's shelves (`STORE_SHELVES`, in order), each at most `SHELF_SIZE` ids, spread (1.530,
 * `spreadShelves`); a shelf with nothing on it is left out. Early plugins sit on no shelf. GET
 * /store/front applies an admin's overrides on top (shared/storeFront.mjs `applyFront`).
 * @param {StoreListing[]} list @param {number} now @param {{ maxRepeats?: number, featured?: string[] }} [o]
 * @returns {{ id: string, title: string, ids: string[] }[]}
 */
export function shelvesOf(list, now, o = {}) {
  return spreadShelves(shelfCandidatesOf(list, now), o).filter((s) => s.ids.length > 0);
}

/**
 * A wishlist as sent: plugin ids, deduplicated in order. `{ ok: true, ids }` or `{ ok: false, error }`
 * (more than `WISHLIST_MAX`, or an id that is not one, refuses the whole list).
 * @param {unknown} raw
 * @returns {{ ok: true, ids: string[], error?: undefined } | { ok: false, error: string, ids?: undefined }}
 */
export function cleanWishlist(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'send { ids: [...] }' };
  // 1.534 (pre-launch review 3, P3-A1): a Set, and refused as soon as it passes the cap (an includes() loop over a 96 KB body held the event loop ~120 ms).
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== 'string' || !STORE_ID_RE.test(id)) return { ok: false, error: 'bad plugin id' };
    seen.add(id);
    if (seen.size > WISHLIST_MAX) return { ok: false, error: `A wishlist holds at most ${WISHLIST_MAX} plugins.` };
  }
  return { ok: true, ids: [...seen] };
}
