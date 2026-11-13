// shared/estRegistry.mjs — EST Phase 5b (1.305; docs/est/EST_REGISTRY_ARCHITECTURE.md §1; D-26, D-48):
// the signed registry's format, shared by the publisher (`sdk/packages/cli`'s `est sign` and `est
// publish`), the app's server (its catalogue for the install limits, server/estRegistry.mjs) and the
// client (`src/audio/est/install/registry.ts`). Pure: no DOM, no Node API; signatures are checked
// with WebCrypto's Ed25519 (`globalThis.crypto.subtle`: Node 20+, Chromium 137+, Firefox 129+,
// Safari 17+). Signing is the publisher's (Node's `crypto.sign`), never here.
//
// The files, under `/est/v1/` on the plugin origin:
// - `index.json` (canonical JSON) and `index.sig` (`{ alg: 'ed25519', keyId, sig }`): the signed index
//   `{ est: 1, registry: { name, url, keyId, updatedAt }, plugins: [...], blocklist: [...] }`;
// - `blocklist.json` and `blocklist.sig`: the same blocklist on its own, signed (hosts that fetch only it);
// - `plugins/<id>/<version>/est.json` (the bundle's manifest), `signature.json` (the registry's
//   countersignature `{ alg, keyId, payload: { id, version, contentHash, tier, publishedAt }, sig }`)
//   and `bundle.est` (the bytes, immutable);
// - `plugins/<id>/meta.json`: the description and changelog, display text only (never trusted).
//
// What is signed is `est-registry/1 <kind>\n<canonical JSON>` (UTF-8), `kind` one of `index`,
// `blocklist`, `version`, so a signature over one file can never be replayed as another. The key is
// Ed25519; hosts pin its 32-byte public key (base64) and know it by its id (the first 16 hex digits
// of its SHA-256) and show its fingerprint (all 64, in groups of four).
//
// 1.314 (LR-8b stream C; EST-05, EST-11, EST-14): the index and `blocklist.json` carry a signed
// `registry.expiresAt` (7 days from the publish): a host refuses an expired index from the network
// and shows a held one as out of date, so a withheld index cannot freeze the blocklist. A host may
// pin **two keys** (current and next, `pinnedKeysOf`): a file signed by either verifies, so a key
// rotation overlaps rather than cuts over. Display text drops zero-width and bidirectional
// characters (`stripInvisible`). The tier-against-key check in `verifyVersionSignature` (a
// community key may sign only `community` records, D-54) waits for the dynamic registry (DEV-C):
// there is one key today, so `tier` is signed but not held to a key.

import { sanitisePackIndex } from './storePack.mjs';
import { sanitiseCommunityRoot } from './estCommunity.mjs';

/** The protocol's version (the `v1` in the path, `est: 1` in the files). */
export const REGISTRY_VERSION = 1;
/** The index's size cap (§1: paged past 2 MB, which this registry never reaches). */
export const REGISTRY_INDEX_MAX_BYTES = 2 * 1024 * 1024;
/** The trust tiers (§4). */
export const REGISTRY_TIERS = Object.freeze(['curated', 'reviewed', 'community']);

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const KEY_ID_RE = /^[0-9a-f]{16}$/;
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 1.314 (EST-14): zero-width and bidirectional control characters, which display text never carries. */
export const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Whether `s` carries any of them. @param {string} s */
export const hasInvisible = (s) => { INVISIBLE_RE.lastIndex = 0; return INVISIBLE_RE.test(s); };
/** `s` without them. @param {string} s */
export const stripInvisible = (s) => s.replace(INVISIBLE_RE, '');
const text = (v, max) => (typeof v === 'string' ? stripInvisible(v).slice(0, max) : '');
/** 1.314 (EST-11): how long a published index or blocklist is good for (`expiresAt`), unless the publish says otherwise. */
export const REGISTRY_EXPIRES_DAYS = 7;

/**
 * Canonical JSON: object keys sorted, no whitespace, `undefined` members left out; throws on a
 * number that JSON cannot carry. The bytes every signature covers.
 * @param {unknown} v @returns {string}
 */
export function canonicalJson(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('a registry file holds a number JSON cannot carry');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (isObj(v)) {
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  throw new Error('a registry file holds a value JSON cannot carry');
}

/** The bytes a signature of `kind` covers (1.515: a sound pack's record, 'pack'). @param {'index' | 'blocklist' | 'version' | 'pack'} kind @param {unknown} obj */
export function signedBytes(kind, obj) {
  return new TextEncoder().encode(`est-registry/1 ${kind}\n${canonicalJson(obj)}`);
}

/** @param {string} b64 @returns {Uint8Array | null} */
export function fromBase64(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64.trim())) return null;
  try {
    const s = atob(b64.trim());
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch { return null; }
}
/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
/** Bytes as WebCrypto takes them. @param {Uint8Array | ArrayBuffer} b @returns {any} */
const src = (b) => /** @type {any} */ (b);
const hex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

/**
 * 1.314 (EST-11): the pinned keys from `EST_REGISTRY_PUBLIC_KEY`, which may hold two (current and
 * next) separated by commas or whitespace; a value that is not a key is left out. @param {unknown} raw
 * @returns {Uint8Array[]}
 */
export function pinnedKeysOf(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean).map(publicKeyBytes).filter((k) => !!k);
}

/** A pinned public key: 32 raw Ed25519 bytes from base64 (raw, or the 44-byte SPKI DER), or null. @param {unknown} raw */
export function publicKeyBytes(raw) {
  const b = typeof raw === 'string' ? fromBase64(raw) : null;
  if (!b) return null;
  if (b.length === 32) return b;
  // SPKI DER of an Ed25519 key: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>.
  const SPKI = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
  if (b.length === 44 && SPKI.every((x, i) => b[i] === x)) return b.slice(12);
  return null;
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('this browser cannot check signatures (no WebCrypto)');
  return s;
};

/** The key's fingerprint: its SHA-256 in hex, in groups of four. @param {Uint8Array} pub */
export async function fingerprintOf(pub) {
  const h = hex(await subtle().digest('SHA-256', src(pub)));
  return (h.match(/.{4}/g) ?? []).join(' ');
}
/** The key's id: the first 16 hex digits of its SHA-256 (what `keyId` in the files names). @param {Uint8Array} pub */
export async function keyIdOf(pub) {
  return hex(await subtle().digest('SHA-256', src(pub))).slice(0, 16);
}
/** The SHA-256 of bytes, hex. @param {Uint8Array | ArrayBuffer} bytes */
export async function sha256Hex(bytes) {
  return hex(await subtle().digest('SHA-256', src(bytes)));
}

/**
 * Whether `sig` (base64) is the key's Ed25519 signature of `kind`'s bytes of `obj`. False for any
 * malformed input; throws only when this runtime has no Ed25519 (the caller says so).
 * @param {'index' | 'blocklist' | 'version'} kind @param {unknown} obj @param {unknown} sig @param {Uint8Array} pub
 */
export async function verifySigned(kind, obj, sig, pub) {
  const s = typeof sig === 'string' ? fromBase64(sig) : null;
  if (!s || s.length !== 64 || !(pub instanceof Uint8Array) || pub.length !== 32) return false;
  let data;
  try { data = signedBytes(kind, obj); } catch { return false; }
  let key;
  try {
    key = await subtle().importKey('raw', src(pub), { name: 'Ed25519' }, false, ['verify']);
  } catch (err) {
    throw new Error(`this browser cannot check the registry's signature (Ed25519: ${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  return subtle().verify({ name: 'Ed25519' }, key, src(s), src(data));
}

/**
 * A blocklist checked entry by entry (a bad entry is dropped, never the whole list).
 * @returns {{ id: string, version?: string, hash?: string, reason: string, at: string }[]}
 */
export function sanitiseBlocklist(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, 2000)) {
    if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) continue;
    const entry = { id: e.id, reason: text(e.reason, 300) || 'blocked by the registry', at: text(e.at, 40) };
    if (typeof e.version === 'string' && VERSION_RE.test(e.version)) entry.version = e.version;
    if (typeof e.hash === 'string' && HASH_RE.test(e.hash)) entry.hash = e.hash;
    out.push(entry);
  }
  return out;
}

/** The blocklist entry that blocks `ref`, or null: same id, and the version and hash when the entry names them. */
export function blockOf(blocklist, ref) {
  for (const e of blocklist ?? []) {
    if (e.id !== ref.id) continue;
    if (e.version && e.version !== ref.version) continue;
    if (e.hash && e.hash !== ref.hash) continue;
    return e;
  }
  return null;
}

/** A relative path inside the registry (no scheme, no host, no `..`), or null. @param {unknown} p */
export function registryPath(p) {
  if (typeof p !== 'string' || !p || p.length > 300 || /^[a-z][a-z0-9+.-]*:|^\/\/|\\|\0/i.test(p)) return null;
  const clean = p.replace(/^\/+/, '');
  const parts = clean.split('/');
  if (parts.some(x => x === '' || x === '.' || x === '..')) return null;
  return clean;
}

/**
 * The index as sent, checked: the shape, every plugin and version (a bad one dropped, so one
 * mistake never hides the catalogue), the paths relative to the registry. Throws with words when
 * the index itself is not one. (The signature is checked first, by the caller, over the raw object.)
 */
export function sanitiseIndex(raw) {
  if (!isObj(raw) || raw.est !== REGISTRY_VERSION || !isObj(raw.registry) || !Array.isArray(raw.plugins)) throw new Error('the registry index is not an EST v1 index');
  const r = raw.registry;
  if (typeof r.keyId !== 'string' || !KEY_ID_RE.test(r.keyId)) throw new Error('the registry index names no key');
  if (typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt))) throw new Error('the registry index has no date');
  const plugins = [];
  for (const p of raw.plugins.slice(0, 5000)) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id) || !Array.isArray(p.versions)) continue;
    const kind = p.kind === 'instrument' ? 'instrument' : p.kind === 'effect' ? 'effect' : null;
    if (!kind) continue;
    const versions = [];
    for (const v of p.versions.slice(0, 500)) {
      if (!isObj(v) || typeof v.version !== 'string' || !VERSION_RE.test(v.version) || typeof v.contentHash !== 'string' || !HASH_RE.test(v.contentHash)) continue;
      const bundleUrl = registryPath(v.bundleUrl);
      const manifestUrl = registryPath(v.manifestUrl);
      if (!bundleUrl || !manifestUrl) continue;
      const sizeBytes = Number.isSafeInteger(v.sizeBytes) && v.sizeBytes > 0 ? v.sizeBytes : 0;
      versions.push({
        version: v.version, contentHash: v.contentHash, bundleUrl, manifestUrl,
        signatureUrl: registryPath(v.signatureUrl) ?? `plugins/${p.id}/${v.version}/signature.json`,
        publishedAt: text(v.publishedAt, 40), tier: REGISTRY_TIERS.includes(v.tier) ? v.tier : 'community',
        ...(v.yanked === true ? { yanked: true } : {}),
        estAbi: text(v.estAbi, 20), compat: text(v.compat, 60), sizeBytes, cpuClass: text(v.cpuClass, 20),
      });
    }
    if (!versions.length) continue;
    plugins.push({
      id: p.id, name: text(p.name, 120) || p.id, vendor: text(p.vendor, 120), kind,
      features: Array.isArray(p.features) ? p.features.filter(f => typeof f === 'string').slice(0, 20).map(f => f.slice(0, 40)) : [],
      latest: typeof p.latest === 'string' && versions.some(v => v.version === p.latest) ? p.latest : versions[0].version,
      tier: REGISTRY_TIERS.includes(p.tier) ? p.tier : (versions[0].tier ?? 'community'),
      tags: Array.isArray(p.tags) ? p.tags.filter(f => typeof f === 'string').slice(0, 20).map(f => f.slice(0, 40)) : [],
      summary: text(p.summary, 500), icon: null, versions,
    });
  }
  return {
    est: REGISTRY_VERSION,
    registry: {
      name: text(r.name, 120) || 'EST registry', url: text(r.url, 300), keyId: r.keyId, updatedAt: new Date(Date.parse(r.updatedAt)).toISOString(),
      // 1.314 (EST-11): when the index stops being good ('' for an index published before 1.314).
      expiresAt: typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) ? new Date(Date.parse(r.expiresAt)).toISOString() : '',
    },
    plugins,
    blocklist: sanitiseBlocklist(raw.blocklist),
    // 1.322 (DEV-C, D-54): the community keys and developers' keys the owner signed into the root, or null.
    community: sanitiseCommunityRoot(raw.community),
    // 1.515 (EST Store Phase C, stream 1): the sound packs the registry signs (shared/storePack.mjs), [] for none.
    packs: sanitisePackIndex(raw.packs),
  };
}

/**
 * 1.405 (LOW-2, the pre-review of 2026-11-09): from this instant an index or a blocklist file must
 * carry a signed `expiresAt`. Every file the live registry has published since 1.314 does (7 days from
 * its publish); one signed before 1.314 has none and is still validly signed, so without this a device
 * holding no newer copy (a new device, cleared site data) would take a frozen old index from whoever
 * serves `/est/v1/` and never call it stale. Set to the day of the fix: the live registry's files all
 * carried `expiresAt` that day (est-plugins/registry-dist/v1/, published 2026-11-08).
 */
export const REGISTRY_EXPIRY_REQUIRED_FROM = '2026-11-09T00:00:00.000Z';

/**
 * 1.314 (EST-11): whether an index (or a blocklist file) with a signed `expiresAt` has passed it at `now` (ms).
 * 1.405 (LOW-2): one with no `expiresAt` counts as expired from `REGISTRY_EXPIRY_REQUIRED_FROM` on
 * (before it, it never expires, as in 1.314), so every caller refuses it from the network and calls a
 * held copy 'stale-expired'. The reference list the app carries is not a registry file: offline it
 * stays as it was.
 */
export function registryExpired(file, now = Date.now()) {
  const at = file?.registry?.expiresAt;
  if (typeof at === 'string' && !!at && Number.isFinite(Date.parse(at))) return Date.parse(at) <= now;
  return now >= Date.parse(REGISTRY_EXPIRY_REQUIRED_FROM);
}

/** The pinned key `rawSig` names, out of one or several, or null. @param {any} rawSig @param {Uint8Array | Uint8Array[]} pinned */
async function keyFor(rawSig, pinned) {
  const keys = Array.isArray(pinned) ? pinned : [pinned];
  if (!isObj(rawSig) || typeof rawSig.keyId !== 'string') return null;
  for (const k of keys) if ((await keyIdOf(k)) === rawSig.keyId) return k;
  return null;
}

/**
 * The index checked end to end: the signature file's key is the pinned key, the signature is the
 * pinned key's over the index, and the index is well formed. `{ ok: true, index }` or
 * `{ ok: false, why }` (words for the Settings page). 1.314: `pinned` may be several keys (either verifies).
 * @param {any} rawIndex @param {any} rawSig @param {Uint8Array | Uint8Array[]} pinned
 * @returns {Promise<{ ok: true, index: ReturnType<typeof sanitiseIndex>, keyId: string, why?: undefined } | { ok: false, why: string, index?: undefined, keyId?: undefined }>}
 */
export async function verifyIndex(rawIndex, rawSig, pinned) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || typeof rawSig.sig !== 'string') return { ok: false, why: 'the registry index is not signed' };
  // 1.314 (EST-11): one of the pinned keys (current or next), the one the signature names.
  const key = await keyFor(rawSig, pinned);
  const keyId = key ? await keyIdOf(key) : null;
  if (!key || !isObj(rawIndex) || !isObj(rawIndex.registry) || rawIndex.registry.keyId !== keyId) return { ok: false, why: 'the registry index is signed with another key than the one Cyber trusts' };
  if (!(await verifySigned('index', rawIndex, rawSig.sig, key))) return { ok: false, why: 'the registry index\'s signature does not match: it was changed after signing' };
  try {
    return { ok: true, index: sanitiseIndex(rawIndex), keyId: /** @type {string} */ (keyId) };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 1.314 (EST-05): `blocklist.json` checked end to end against the pinned key(s): `{ ok: true,
 * blocklist, updatedAt, expiresAt, keyId }` or `{ ok: false, why }`. Fetched hourly, apart from the index.
 * @param {any} rawFile @param {any} rawSig @param {Uint8Array | Uint8Array[]} pinned
 * @returns {Promise<{ ok: true, blocklist: ReturnType<typeof sanitiseBlocklist>, updatedAt: string, expiresAt: string, keyId: string, why?: undefined } | { ok: false, why: string, blocklist?: undefined, updatedAt?: undefined, expiresAt?: undefined, keyId?: undefined }>}
 */
export async function verifyBlocklist(rawFile, rawSig, pinned) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || typeof rawSig.sig !== 'string') return { ok: false, why: 'the blocklist is not signed' };
  const key = await keyFor(rawSig, pinned);
  const keyId = key ? await keyIdOf(key) : null;
  if (!key || !isObj(rawFile) || rawFile.est !== REGISTRY_VERSION || !isObj(rawFile.registry) || rawFile.registry.keyId !== keyId) return { ok: false, why: 'the blocklist is signed with another key than the one Cyber trusts' };
  if (!(await verifySigned('blocklist', rawFile, rawSig.sig, key))) return { ok: false, why: 'the blocklist\'s signature does not match: it was changed after signing' };
  const r = rawFile.registry;
  if (typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt))) return { ok: false, why: 'the blocklist has no date' };
  const expiresAt = typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) ? new Date(Date.parse(r.expiresAt)).toISOString() : '';
  return { ok: true, blocklist: sanitiseBlocklist(rawFile.blocklist), updatedAt: new Date(Date.parse(r.updatedAt)).toISOString(), expiresAt, keyId: /** @type {string} */ (keyId) };
}

/**
 * A version's countersignature (`signature.json`) checked against the pinned key(s) and the index's
 * record of that version. @param {any} rawSig @param {{ id: string, version: string, contentHash: string }} expect
 * @param {Uint8Array | Uint8Array[]} pinned @returns {Promise<boolean>}
 */
export async function verifyVersionSignature(rawSig, expect, pinned) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || !isObj(rawSig.payload)) return false;
  const p = rawSig.payload;
  // 1.314 (EST-11): either pinned key. (The tier-against-key rule, D-54, comes with the dynamic registry: one key today.)
  const key = await keyFor(rawSig, pinned);
  if (!key) return false;
  if (p.id !== expect.id || p.version !== expect.version || p.contentHash !== expect.contentHash) return false;
  return verifySigned('version', p, rawSig.sig, key);
}

/** Every version of the index as a flat list (blocked ones marked), newest index order kept. */
export function catalogueOf(index) {
  const out = [];
  for (const p of index?.plugins ?? []) {
    for (const v of p.versions) {
      const ref = { id: p.id, version: v.version, hash: v.contentHash };
      const block = blockOf(index.blocklist, ref);
      out.push({ ...ref, name: p.name, vendor: p.vendor, kind: p.kind, tier: v.tier, bytes: v.sizeBytes, bundleUrl: v.bundleUrl, signatureUrl: v.signatureUrl, summary: p.summary, features: p.features, yanked: v.yanked === true, latest: p.latest === v.version, blocked: block ? block.reason : null });
    }
  }
  return out;
}
