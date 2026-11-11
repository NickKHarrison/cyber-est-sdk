// shared/estCommunity.mjs — DEV-C (1.322; Cyber_EST_Developers_Work_Order.md DEV-C §1–§4, D-54;
// docs/est/EST_REGISTRY_ARCHITECTURE.md §2–§4): the Community tier's trust rules, shared by the app's
// server (the publish route, server/estPublish.mjs), the SDK's publisher (`est sign`, `est publish
// <file.est>`), the conformance app (`est-check/`) and the client (`src/audio/est/install/community.ts`).
// Pure: no DOM, no Node API; signatures checked with WebCrypto's Ed25519, as shared/estRegistry.mjs.
//
// **Two keys (D-54).** The owner's key (offline, on the Mac) signs the registry's root `index.json`
// as 1.305 does; since 1.322 the root may carry `community: { keys, developers }`: the community
// keys the owner trusts (the online key on `cyber-audio`, `EST_COMMUNITY_SIGNING_KEY`) and every
// developer's public keys. So the online key's authority is bounded by what the offline key published:
// - a version record's signature is held to its tier (`verifyTieredVersion`): an owner key may sign any
//   tier; a community key **only** `tier: 'community'`, so a community-key signature over a `curated`
//   or `reviewed` record is refused;
// - the community index (`community/index.json` + `.sig`, regenerated on every publish by the app
//   server, signed by the community key, carrying a signed `expiresAt`) is believed only when its key
//   is one the root names, and only for `community` versions;
// - a developer's own signature over `{ id, version, contentHash, publishedAt }` (`est sign`) is checked
//   against the developer's keys in the **root** (`verifyDeveloperSignature`), so a compromise of the
//   publishing service alone cannot attribute a bundle to a developer **the root lists**. It can for a
//   developer it delegates (1.401, below): since 1.401 the developer-root key sits on the same server
//   as the community key, so whoever holds that server could add a developer by delegation and publish
//   under them. That is an accepted risk (D-62) until the delegation is signed off that server; the
//   client's quarantine (1.411, `src/audio/est/install/community.ts`) offers a delegated developer only
//   once the device has seen them, with that key, for 48 hours, and the server logs every delegation
//   change (`[est-delegation]`) so the owner can block in that time.
//
// **Names (EST-14, registry §2).** `org.cyber.*` and the vendor "Cyber" (case- and width-folded, any
// punctuation or spacing) are the owner key's; display text never carries bidirectional or
// zero-width characters (refused, not stripped, at publish); a developer's ids live under a
// namespace `<tld>.<name>` (`com.acme`) they claimed once with a DNS TXT proof on `<name>.<tld>`,
// or (1.401, L9, D-60) under the namespace Cyber assigns every developer, `dev.` and the ten hex
// characters of their id (`dev-a1b2c3d4e5` → `dev.a1b2c3d4e5`), which no DNS proof can claim.
//
// **The developer root (1.401, L9, D-60).** The owner-signed root may also name `developerRoot: { keys }`,
// a key of its own held by the publishing service (`EST_DEVELOPER_ROOT_KEY`). It signs one file, the
// developer delegation (`community/developers.json` + `.sig`, a signed `expiresAt`), listing each
// developer's id, name, public keys and **only** their assigned `dev.<10 hex>` namespace. A client merges
// it under the root (`mergeDelegatedDevelopers`): a developer the root lists is the root's alone (a
// delegation for that id is ignored), a key another developer holds is dropped, any namespace but
// the developer's own `dev.<10 hex>` is dropped, and a `blocked` mark keeps every key out. So the
// developer-root key can add developers under their assigned namespaces and nothing else: never a
// DNS namespace, never `org.cyber.*`, never a tier, never a block lifted. A delegated developer is
// marked `delegated: true`, which the client's 48-hour quarantine reads (D-62).
//
// **The conformance result (DEV-C §2).** `cyber-est-check` answers `{ hash, ok, failed, validator,
// checkedAt, nonce }` signed with its own key (`est-check/1 result`); `cyber-audio` pins its public
// key (`EST_CHECK_PUBLIC_KEY`) and countersigns only a result that verifies, names the same hash and
// the nonce it sent, and is fresh (`checkResultRefusal`).
import { canonicalJson, fromBase64, keyIdOf, publicKeyBytes, REGISTRY_TIERS, REGISTRY_VERSION, sha256Hex, signedBytes } from './estRegistry.mjs';

/** Display text never carries these (EST-14): zero-width, bidirectional embeddings, overrides and isolates, the BOM. */
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/;
/** Other control characters (C0 and C1, but not a space). */
const CONTROL = /\p{Cc}/u;
const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const KEY_ID_RE = /^[0-9a-f]{16}$/;
const NAMESPACE_RE = /^([a-z]{2,24})\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
/** A developer's id: `dev-` and ten lower-case hex characters (server/estDevelopers.mjs makes them from `randomBytes`). */
const DEVELOPER_ID_RE = /^dev-[0-9a-f]{10}$/;
/**
 * The assigned namespaces' shape, `dev.<10 hex>` (the id without its `dev-`), and exactly the space kept
 * from DNS claims: any other `dev.<name>` (the `.dev` domain `<name>.dev`) is claimable as before.
 */
const ASSIGNED_NS_RE = /^dev\.[0-9a-f]{10}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('this runtime cannot check signatures (no WebCrypto)');
  return s;
};

/** The id prefix reserved to the owner key. */
export const RESERVED_ID_PREFIX = 'org.cyber.';
/** How long a community index (and a developer's publish token) is good for: the index carries it signed. */
export const COMMUNITY_EXPIRES_DAYS = 7;
/** A new plugin's version stays "early" this long with no block and no upheld report (D-52). */
export const EARLY_DAYS = 14;
/** A new version of a plugin already published waits this long before it is `latest` for others (registry §3 step 6). */
export const STAGING_HOURS = 72;
/** A conformance result older than this is refused (it was asked for this publish). */
export const CHECK_RESULT_MAX_AGE_MS = 10 * 60 * 1000;

// --- display text and names ------------------------------------------------------------------

/**
 * Why `s` cannot be shown as a plugin's or a developer's name, vendor or description, or null.
 * `max` its length in characters. Refused, never cleaned, so what is signed is what is shown.
 * @param {unknown} s @param {string} what @param {number} [max]
 */
export function displayRefusal(s, what, max = 120) {
  if (typeof s !== 'string' || !s.trim()) return `${what} is empty`;
  if (s.length > max) return `${what} is longer than ${max} characters`;
  if (INVISIBLE.test(s)) return `${what} has an invisible or right-to-left control character (zero-width or bidirectional), which Cyber refuses`;
  if (CONTROL.test(s)) return `${what} has a control character`;
  if (s !== s.trim()) return `${what} starts or ends with a space`;
  return null;
}

/** A name folded for comparison: NFKC, lower case, letters and digits only ("C y-b_e r", "ＣＹＢＥＲ" → "cyber"). @param {string} s */
export function foldName(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whether a vendor or display name is the owner's ("Cyber", any case, width or spacing; "Cyber Audio" too). @param {string} s */
export function reservedVendor(s) {
  const f = foldName(s);
  return f === 'cyber' || f.startsWith('cyberaudio') || f === 'cyberest';
}

/** The namespace an id lives under (`com.acme.delay` → `com.acme`), or null. @param {string} id */
export function namespaceOf(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const parts = id.split('.');
  if (parts.length < 3) return null;
  const ns = `${parts[0]}.${parts[1]}`;
  return NAMESPACE_RE.test(ns) ? ns : null;
}

/**
 * A claimable namespace (`com.acme`), lower-cased, or null. The owner's (`org.cyber`) is never
 * claimable, and (1.401, D-60) neither is any `dev.<10 hex>` name: that space is the assigned
 * namespaces' (`assignedNamespaceOf`), bound to a developer by Cyber, never by a DNS proof.
 * @param {unknown} raw
 */
export function namespaceValue(raw) {
  if (typeof raw !== 'string') return null;
  const ns = raw.trim().toLowerCase();
  if (!NAMESPACE_RE.test(ns)) return null;
  if (`${ns}.` === RESERVED_ID_PREFIX || reservedVendor(ns.split('.')[1] ?? '')) return null;
  if (ASSIGNED_NS_RE.test(ns)) return null;
  return ns;
}

/** 1.401 (L9, D-60): the namespace Cyber assigns a developer, `dev.` and the id's ten hex characters (`dev-a1b2c3d4e5` → `dev.a1b2c3d4e5`), or null for a malformed id. @param {unknown} developerId */
export function assignedNamespaceOf(developerId) {
  return typeof developerId === 'string' && DEVELOPER_ID_RE.test(developerId) ? `dev.${developerId.slice('dev-'.length)}` : null;
}

/** Whether a namespace has the assigned shape (`dev.<10 hex>`): believed only for the developer whose id it names. @param {unknown} ns */
export const isAssignedNamespace = (ns) => typeof ns === 'string' && ASSIGNED_NS_RE.test(ns);

/**
 * A namespace as a signed developer entry may carry it for developer `developerId`, or null: a DNS
 * namespace (`namespaceValue`), or the developer's **own** assigned one. Another developer's
 * `dev.<10 hex>` (a forged binding) is dropped.
 * @param {unknown} raw @param {string} developerId
 */
export function boundNamespaceValue(raw, developerId) {
  if (typeof raw !== 'string') return null;
  const ns = raw.trim().toLowerCase();
  if (ASSIGNED_NS_RE.test(ns)) return ns === assignedNamespaceOf(developerId) ? ns : null;
  return namespaceValue(ns);
}

/** The domain a namespace's proof is on (`com.acme` → `acme.com`). @param {string} ns */
export function domainOfNamespace(ns) {
  const m = NAMESPACE_RE.exec(ns);
  return m ? `${m[2]}.${m[1]}` : null;
}

/** The DNS name that carries a namespace's proof: `_cyber-est.<domain>`. @param {string} ns */
export const proofHostOf = (ns) => { const d = domainOfNamespace(ns); return d ? `_cyber-est.${d}` : null; };
/** The TXT record's text for a proof token. @param {string} token */
export const proofRecordOf = (token) => `cyber-est-verify=${token}`;

/**
 * Why a developer may not publish `manifest` (its id, name, vendor and description), or null.
 * `namespaces`: the namespaces this developer has proved. `owner`: signed with the owner key (the
 * owner's own publish, never the publishing service).
 * @param {{ id?: unknown, name?: unknown, vendor?: unknown, description?: unknown }} manifest
 * @param {{ namespaces: readonly string[], owner?: boolean }} who
 * @returns {{ code: string, error: string } | null}
 */
export function publishNameRefusal(manifest, { namespaces, owner = false }) {
  const id = manifest?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) return { code: 'bad-id', error: 'The plugin id is not a valid id (lower-case letters, digits, dots and dashes).' };
  for (const [field, what, max] of /** @type {const} */ ([['name', 'The plugin\'s name', 120], ['vendor', 'The vendor', 120]])) {
    const why = displayRefusal(manifest[field], what, max);
    if (why) return { code: 'display', error: `${why}.` };
  }
  if (manifest.description !== undefined && manifest.description !== '') {
    const why = displayRefusal(manifest.description, 'The description', 2000);
    if (why) return { code: 'display', error: `${why}.` };
  }
  if (owner) return null;
  if (id.startsWith(RESERVED_ID_PREFIX)) return { code: 'reserved', error: `${RESERVED_ID_PREFIX}* ids are Cyber's own: publish under your own namespace.` };
  if (reservedVendor(String(manifest.vendor)) || reservedVendor(String(manifest.name))) return { code: 'reserved', error: 'The name "Cyber" is Cyber\'s own: use your own name as the vendor and in the plugin\'s name.' };
  const ns = namespaceOf(id);
  if (!ns) return { code: 'namespace', error: `${id} is not under a namespace (your assigned dev.<ten characters>.plugin, or com.yourname.plugin).` };
  if (!namespaces.includes(ns)) {
    const own = namespaces.find(isAssignedNamespace);
    if (isAssignedNamespace(ns)) return { code: 'namespace', error: `${id} is under ${ns}, another developer's namespace.${own ? ` Yours is ${own}.` : ''}` };
    return { code: 'namespace', error: `${id} is under ${ns}, which you have not claimed.${own ? ` Publish under ${own} (yours, no proof needed), or claim ${ns}` : ` Claim it`} in Settings → Plugins → Developer, with its DNS proof.` };
  }
  return null;
}

// --- the bytes each signature covers ---------------------------------------------------------

/** What a developer's `est sign` covers: `est-developer/1 version\n<canonical JSON>`. @param {unknown} payload */
export function developerSignedBytes(payload) {
  return new TextEncoder().encode(`est-developer/1 version\n${canonicalJson(payload)}`);
}
/** What the community index's signature covers. @param {unknown} obj */
export function communitySignedBytes(obj) {
  return new TextEncoder().encode(`est-registry/1 community\n${canonicalJson(obj)}`);
}
/** 1.401 (D-60): what the developer delegation's signature (the developer-root key) covers. @param {unknown} obj */
export function delegationSignedBytes(obj) {
  return new TextEncoder().encode(`est-developer-root/1 delegation\n${canonicalJson(obj)}`);
}
/** What a conformance result's signature covers. @param {unknown} obj */
export function checkSignedBytes(obj) {
  return new TextEncoder().encode(`est-check/1 result\n${canonicalJson(obj)}`);
}

/** Whether `sig` (base64) is `pub`'s Ed25519 signature of `bytes`. False for malformed input. */
async function verifyBytes(bytes, sig, pub) {
  const s = typeof sig === 'string' ? fromBase64(sig) : null;
  if (!s || s.length !== 64 || !(pub instanceof Uint8Array) || pub.length !== 32) return false;
  try {
    const key = await subtle().importKey('raw', /** @type {any} */ (pub), { name: 'Ed25519' }, false, ['verify']);
    return await subtle().verify({ name: 'Ed25519' }, key, /** @type {any} */ (s), /** @type {any} */ (bytes));
  } catch { return false; }
}

/** A list of `{ keyId, publicKey }` as checked keys: `[{ keyId, pub }]` (a bad one dropped). */
async function keysOf(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list.slice(0, 16) : []) {
    const pub = publicKeyBytes(isObj(k) ? k.publicKey : k);
    if (pub) out.push({ keyId: await keyIdOf(pub), pub });
  }
  return out;
}

// --- the root's community part (owner-signed) ------------------------------------------------

/**
 * The root index's `community` part, checked: `{ keys: [{ keyId, publicKey }], developers: [{ id,
 * name, keys: [{ keyId, publicKey, revoked? }], namespaces: ['com.acme'] }] }`. A client believes a
 * community plugin only when its id is under one of its developer's namespaces here, so the
 * community key and one developer's key together cannot publish under another developer's namespace. Absent or bad: none (no Community tier).
 * The key ids are recomputed by `communityTrustOf`, never believed.
 */
export function sanitiseCommunityRoot(raw) {
  if (!isObj(raw)) return null;
  const key = (k) => (isObj(k) && typeof k.publicKey === 'string' && publicKeyBytes(k.publicKey) ? { publicKey: k.publicKey, ...(typeof k.keyId === 'string' && KEY_ID_RE.test(k.keyId) ? { keyId: k.keyId } : {}), ...(k.revoked === true ? { revoked: true } : {}) } : null);
  const keys = (Array.isArray(raw.keys) ? raw.keys.slice(0, 4) : []).map(key).filter(Boolean);
  const developers = [];
  for (const d of Array.isArray(raw.developers) ? raw.developers.slice(0, 5000) : []) {
    if (!isObj(d) || typeof d.id !== 'string' || !/^[a-z0-9-]{4,64}$/.test(d.id)) continue;
    const dk = (Array.isArray(d.keys) ? d.keys.slice(0, 8) : []).map(key).filter(Boolean);
    if (!dk.length) continue;
    // The namespaces the developer proved, as the owner signed them (only their plugins are believed: the integrator's review).
    // 1.401 (D-60): and their own assigned `dev.<10 hex>`; another developer's `dev.<10 hex>` is dropped.
    const namespaces = (Array.isArray(d.namespaces) ? d.namespaces.slice(0, 8) : []).map((n) => boundNamespaceValue(n, d.id)).filter((n) => !!n);
    developers.push({ id: d.id, name: typeof d.name === 'string' && !displayRefusal(d.name, 'name') ? d.name : d.id, keys: dk, namespaces, ...(d.blocked === true ? { blocked: true } : {}) });
  }
  // 1.401 (D-60): the developer-root key(s) the owner signed, at most two (rotation overlap).
  const dr = isObj(raw.developerRoot) ? raw.developerRoot : null;
  const developerRoot = (dr ? (Array.isArray(dr.keys) ? dr.keys.slice(0, 2) : dr.publicKey ? [dr] : []) : []).map(key).filter(Boolean).map((k) => { const { revoked, ...rest } = k; void revoked; return rest; });
  return keys.length ? { keys, developers, ...(developerRoot.length ? { developerRoot } : {}) } : null;
}

// --- the developer delegation (signed by the developer-root key; 1.401, D-60) ----------------

/**
 * The developer delegation as sent, checked: `{ est: 1, developerRoot: { keyId, updatedAt, expiresAt },
 * developers: [{ id, name, keys: [{ publicKey, revoked? }], namespaces: ['dev.<10 hex>'], blocked? }] }`.
 * Each entry keeps **only** its own assigned namespace: whatever else it names is dropped, so this
 * file can never bind a DNS namespace or another developer's. Throws with words when it is not one.
 */
export function sanitiseDelegation(raw) {
  if (!isObj(raw) || raw.est !== REGISTRY_VERSION || !isObj(raw.developerRoot) || !Array.isArray(raw.developers)) throw new Error('the developer delegation is not an EST v1 delegation');
  const c = raw.developerRoot;
  if (typeof c.keyId !== 'string' || !KEY_ID_RE.test(c.keyId)) throw new Error('the developer delegation names no key');
  if (typeof c.updatedAt !== 'string' || !Number.isFinite(Date.parse(c.updatedAt))) throw new Error('the developer delegation has no date');
  if (typeof c.expiresAt !== 'string' || !Number.isFinite(Date.parse(c.expiresAt))) throw new Error('the developer delegation has no expiry');
  const developers = [];
  for (const d of raw.developers.slice(0, 20000)) {
    if (!isObj(d) || typeof d.id !== 'string' || !DEVELOPER_ID_RE.test(d.id)) continue;
    const own = assignedNamespaceOf(d.id);
    const keys = (Array.isArray(d.keys) ? d.keys.slice(0, 8) : []).filter((k) => isObj(k) && typeof k.publicKey === 'string' && publicKeyBytes(k.publicKey)).map((k) => ({ publicKey: k.publicKey, ...(k.revoked === true ? { revoked: true } : {}) }));
    if (!keys.length) continue;
    const namespaces = Array.isArray(d.namespaces) && d.namespaces.includes(own) ? [own] : [];
    developers.push({ id: d.id, name: typeof d.name === 'string' && !displayRefusal(d.name, 'name') ? d.name : d.id, keys, namespaces, ...(d.blocked === true ? { blocked: true } : {}) });
  }
  return { est: REGISTRY_VERSION, developerRoot: { keyId: c.keyId, updatedAt: new Date(Date.parse(c.updatedAt)).toISOString(), expiresAt: new Date(Date.parse(c.expiresAt)).toISOString() }, developers };
}

/**
 * The developer delegation checked end to end against the root's `developerRoot` keys: the signature
 * names one of them, matches the bytes, and the delegation has not expired. `{ ok: true, delegation }`
 * or `{ ok: false, why }`. No `developerRoot` in the root: refused in words (the manual path stands).
 * @param {any} rawDoc @param {any} rawSig @param {{ publicKey: string }[] | undefined} developerRoot @param {number} [now]
 */
export async function verifyDelegation(rawDoc, rawSig, developerRoot, now = Date.now()) {
  const keys = await keysOf(developerRoot);
  if (!keys.length) return { ok: false, why: 'the registry names no developer-root key: developers are signed into the root by hand' };
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || typeof rawSig.sig !== 'string') return { ok: false, why: 'the developer delegation is not signed' };
  const k = keys.find((x) => x.keyId === rawSig.keyId);
  if (!k || !isObj(rawDoc) || !isObj(rawDoc.developerRoot) || rawDoc.developerRoot.keyId !== k.keyId) return { ok: false, why: 'the developer delegation is signed with a key the registry does not name as its developer root' };
  let bytes;
  try { bytes = delegationSignedBytes(rawDoc); } catch { return { ok: false, why: 'the developer delegation is not JSON' }; }
  if (!(await verifyBytes(bytes, rawSig.sig, k.pub))) return { ok: false, why: 'the developer delegation\'s signature does not match: it was changed after signing' };
  let delegation;
  try { delegation = sanitiseDelegation(rawDoc); } catch (err) { return { ok: false, why: err instanceof Error ? err.message : String(err) }; }
  if (expiredAt(delegation.developerRoot.expiresAt, now)) return { ok: false, why: `the developer delegation expired on ${delegation.developerRoot.expiresAt}` };
  return { ok: true, delegation };
}

/**
 * The root's community part with a verified delegation's developers added under it (D-60):
 * - a developer the root lists is the root's alone: a delegated entry for the same id is ignored
 *   (so a root `blocked` mark, or the keys the owner signed, can never be overridden);
 * - a delegated key that another developer already holds (root or an earlier entry) is dropped;
 * - a delegated developer keeps only its own `dev.<10 hex>` (`sanitiseDelegation` already held it);
 * - a `blocked` delegated developer stays listed as blocked (`communityTrustOf` skips its keys).
 * Delegated entries carry `delegated: true`. Pure: the inputs are not changed. A null root stays null.
 * @param {ReturnType<typeof sanitiseCommunityRoot>} root @param {ReturnType<typeof sanitiseDelegation> | null | undefined} delegation
 */
export function mergeDelegatedDevelopers(root, delegation) {
  if (!root || !delegation) return root;
  const ids = new Set(root.developers.map((d) => d.id));
  // Keys compared by their bytes (two spellings of one key are one key).
  const bytesOf = (pk) => Array.from(publicKeyBytes(pk) ?? []).join(',');
  const held = new Set(root.developers.flatMap((d) => d.keys.map((k) => bytesOf(k.publicKey))));
  const added = [];
  for (const d of delegation.developers) {
    if (ids.has(d.id)) continue;
    const keys = d.keys.filter((k) => !held.has(bytesOf(k.publicKey)));
    if (!keys.length) continue;
    for (const k of keys) held.add(bytesOf(k.publicKey));
    ids.add(d.id);
    added.push({ ...d, keys, namespaces: d.namespaces.filter((n) => n === assignedNamespaceOf(d.id)), delegated: true });
  }
  return { ...root, developers: [...root.developers, ...added] };
}

/**
 * The trust the root gives: the community keys and each developer's live keys, by key id.
 * @param {{ keys?: any[], developers?: any[] } | null | undefined} community
 * @returns {Promise<{ communityKeys: { keyId: string, pub: Uint8Array }[], developerKeys: Map<string, { developer: string, pub: Uint8Array }> }>}
 */
export async function communityTrustOf(community) {
  const communityKeys = await keysOf(community?.keys);
  const developerKeys = new Map();
  for (const d of community?.developers ?? []) {
    if (d.blocked) continue;
    for (const k of d.keys) {
      if (k.revoked) continue;
      const pub = publicKeyBytes(k.publicKey);
      if (pub) developerKeys.set(await keyIdOf(pub), { developer: d.id, pub });
    }
  }
  return { communityKeys, developerKeys };
}

// --- version records: the tier held to the key (D-54) ----------------------------------------

/**
 * A version's countersignature checked against **the key that signed it and that key's tier**:
 * an owner key may sign any tier; a community key only `community`. The payload must name the
 * expected id, version and hash, and its `tier` must be the record's (`expect.tier`).
 * `{ ok: true, by: 'owner' | 'community' }` or `{ ok: false, why }`.
 * @param {any} rawSig @param {{ id: string, version: string, contentHash: string, tier: string }} expect
 * @param {{ ownerKeys: Uint8Array[], communityKeys: { keyId: string, pub: Uint8Array }[] }} keys
 */
export async function verifyTieredVersion(rawSig, expect, { ownerKeys, communityKeys }) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || !isObj(rawSig.payload) || typeof rawSig.keyId !== 'string') return { ok: false, why: 'not signed' };
  const p = rawSig.payload;
  if (p.id !== expect.id || p.version !== expect.version || p.contentHash !== expect.contentHash) return { ok: false, why: 'the signature names another version' };
  if (!REGISTRY_TIERS.includes(p.tier) || p.tier !== expect.tier) return { ok: false, why: `the signature states the tier ${String(p.tier)}, not ${expect.tier}` };
  for (const pub of ownerKeys ?? []) {
    if ((await keyIdOf(pub)) !== rawSig.keyId) continue;
    return (await verifyBytes(signedBytes('version', p), rawSig.sig, pub)) ? { ok: true, by: 'owner' } : { ok: false, why: 'the signature does not match' };
  }
  const ck = (communityKeys ?? []).find((k) => k.keyId === rawSig.keyId);
  if (!ck) return { ok: false, why: 'signed with a key Cyber does not trust' };
  // D-54: the online key's authority ends at Community.
  if (p.tier !== 'community') return { ok: false, why: `a community key may sign only community records, not ${p.tier}` };
  return (await verifyBytes(signedBytes('version', p), rawSig.sig, ck.pub)) ? { ok: true, by: 'community' } : { ok: false, why: 'the signature does not match' };
}

/**
 * A developer's signature (`est sign`) checked against the developer's key: `{ alg, keyId, payload:
 * { id, version, contentHash, publishedAt }, sig }`. `developerKeys`: key id → `{ developer, pub }`
 * (the root's on the client; the account's live keys on the server). `{ ok: true, developer, keyId }` or `{ ok: false, why }`.
 * @param {any} rawSig @param {{ id: string, version: string, contentHash: string }} expect
 * @param {Map<string, { developer: string, pub: Uint8Array }>} developerKeys
 */
export async function verifyDeveloperSignature(rawSig, expect, developerKeys) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || !isObj(rawSig.payload) || typeof rawSig.keyId !== 'string') return { ok: false, why: 'the bundle is not signed by its developer (est sign)' };
  const p = rawSig.payload;
  if (Object.keys(p).sort().join(',') !== 'contentHash,id,publishedAt,version') return { ok: false, why: 'the developer\'s signature covers other fields than { id, version, contentHash, publishedAt }' };
  if (p.id !== expect.id || p.version !== expect.version || p.contentHash !== expect.contentHash) return { ok: false, why: 'the developer\'s signature names another version or other bytes' };
  if (typeof p.publishedAt !== 'string' || !Number.isFinite(Date.parse(p.publishedAt))) return { ok: false, why: 'the developer\'s signature has no date' };
  const k = developerKeys.get(rawSig.keyId);
  if (!k) return { ok: false, why: 'the developer\'s key is not one Cyber knows (registered, not revoked)' };
  if (!(await verifyBytes(developerSignedBytes(p), rawSig.sig, k.pub))) return { ok: false, why: 'the developer\'s signature does not match the bytes' };
  return { ok: true, developer: k.developer, keyId: rawSig.keyId };
}

// --- the community index (signed by the community key) ---------------------------------------

/** Whether a dated file has passed its signed `expiresAt` at `now`. */
export function expiredAt(expiresAt, now = Date.now()) {
  return typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now;
}

/**
 * The community index as sent, checked: `{ est: 1, community: { keyId, updatedAt, expiresAt },
 * plugins: [{ id, name, vendor, kind, summary, features, developer, latest, versions: [{ version,
 * contentHash, bundleUrl, manifestUrl, signatureUrl, developerUrl, publishedAt, validatedAt, tier:
 * 'community', early, stagedUntil?, yanked?, sizeBytes }] }] }`. A non-community version is dropped:
 * this index can never carry another tier. Throws with words when it is not one.
 */
export function sanitiseCommunityIndex(raw) {
  if (!isObj(raw) || raw.est !== REGISTRY_VERSION || !isObj(raw.community) || !Array.isArray(raw.plugins)) throw new Error('the community index is not an EST v1 community index');
  const c = raw.community;
  if (typeof c.keyId !== 'string' || !KEY_ID_RE.test(c.keyId)) throw new Error('the community index names no key');
  if (typeof c.updatedAt !== 'string' || !Number.isFinite(Date.parse(c.updatedAt))) throw new Error('the community index has no date');
  if (typeof c.expiresAt !== 'string' || !Number.isFinite(Date.parse(c.expiresAt))) throw new Error('the community index has no expiry');
  const rel = (p, fallback) => (typeof p === 'string' && /^community\/plugins\/[a-z0-9.-]+\/[0-9A-Za-z.+-]+\/[a-z.]+$/.test(p) && !p.includes('..') ? p : fallback);
  const plugins = [];
  for (const p of raw.plugins.slice(0, 5000)) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id) || !Array.isArray(p.versions)) continue;
    const kind = p.kind === 'instrument' ? 'instrument' : p.kind === 'effect' ? 'effect' : null;
    if (!kind || displayRefusal(p.name, 'name') || displayRefusal(p.vendor, 'vendor')) continue;
    const versions = [];
    for (const v of p.versions.slice(0, 500)) {
      if (!isObj(v) || v.tier !== 'community' || typeof v.version !== 'string' || !VERSION_RE.test(v.version) || typeof v.contentHash !== 'string' || !HASH_RE.test(v.contentHash)) continue;
      const base = `community/plugins/${p.id}/${v.version}`;
      versions.push({
        version: v.version, contentHash: v.contentHash, tier: 'community',
        bundleUrl: rel(v.bundleUrl, `${base}/bundle.est`), manifestUrl: rel(v.manifestUrl, `${base}/est.json`),
        signatureUrl: rel(v.signatureUrl, `${base}/signature.json`), developerUrl: rel(v.developerUrl, `${base}/developer.json`),
        publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt.slice(0, 40) : '', validatedAt: typeof v.validatedAt === 'string' ? v.validatedAt.slice(0, 40) : '',
        early: v.early !== false, ...(typeof v.stagedUntil === 'string' && Number.isFinite(Date.parse(v.stagedUntil)) ? { stagedUntil: v.stagedUntil } : {}),
        ...(v.yanked === true ? { yanked: true } : {}), sizeBytes: Number.isSafeInteger(v.sizeBytes) && v.sizeBytes > 0 ? v.sizeBytes : 0,
      });
    }
    if (!versions.length) continue;
    plugins.push({
      id: p.id, name: p.name, vendor: p.vendor, kind, tier: 'community',
      summary: typeof p.summary === 'string' && !displayRefusal(p.summary, 'summary', 2000) ? p.summary : '',
      features: Array.isArray(p.features) ? p.features.filter((f) => typeof f === 'string').slice(0, 20).map((f) => f.slice(0, 40)) : [],
      developer: typeof p.developer === 'string' ? p.developer.slice(0, 64) : '',
      latest: typeof p.latest === 'string' && versions.some((v) => v.version === p.latest) ? p.latest : versions[0].version,
      versions,
    });
  }
  return { est: REGISTRY_VERSION, community: { keyId: c.keyId, updatedAt: new Date(Date.parse(c.updatedAt)).toISOString(), expiresAt: new Date(Date.parse(c.expiresAt)).toISOString() }, plugins };
}

/**
 * The community index checked end to end against the root's community keys: the signature file
 * names one of them, the signature is that key's, the index has not expired. `{ ok: true, index }`
 * or `{ ok: false, why }`.
 * @param {any} rawIndex @param {any} rawSig @param {{ keyId: string, pub: Uint8Array }[]} communityKeys @param {number} [now]
 */
export async function verifyCommunityIndex(rawIndex, rawSig, communityKeys, now = Date.now()) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || typeof rawSig.sig !== 'string') return { ok: false, why: 'the community index is not signed' };
  const k = (communityKeys ?? []).find((x) => x.keyId === rawSig.keyId);
  if (!k || !isObj(rawIndex) || !isObj(rawIndex.community) || rawIndex.community.keyId !== k.keyId) return { ok: false, why: 'the community index is signed with a key the registry does not name' };
  let bytes;
  try { bytes = communitySignedBytes(rawIndex); } catch { return { ok: false, why: 'the community index is not JSON' }; }
  if (!(await verifyBytes(bytes, rawSig.sig, k.pub))) return { ok: false, why: 'the community index\'s signature does not match: it was changed after signing' };
  let index;
  try { index = sanitiseCommunityIndex(rawIndex); } catch (err) { return { ok: false, why: err instanceof Error ? err.message : String(err) }; }
  if (expiredAt(index.community.expiresAt, now)) return { ok: false, why: `the community index expired on ${index.community.expiresAt}` };
  return { ok: true, index };
}

/**
 * Whether a community version is offered to someone now: not yanked, and past its staging (a new
 * version of a plugin already out waits `STAGING_HOURS` for everyone but those with early updates).
 */
export function offeredNow(v, now = Date.now(), { earlyUpdates = false } = {}) {
  if (v.yanked) return false;
  if (!earlyUpdates && v.stagedUntil && Date.parse(v.stagedUntil) > now) return false;
  return true;
}

// --- the conformance result (cyber-est-check) ------------------------------------------------

/**
 * Why a conformance result is not one `cyber-audio` may countersign, or null: it must be signed by
 * the pinned check key, name `hash` and the `nonce` this publish sent, say `ok`, and be fresh.
 * @param {any} raw `{ result: { hash, ok, failed, validator, checkedAt, nonce }, keyId, sig }`
 * @param {{ hash: string, nonce: string, checkKey: Uint8Array | null, now?: number }} o
 */
export async function checkResultRefusal(raw, { hash, nonce, checkKey, now = Date.now() }) {
  if (!checkKey) return 'the conformance service is not set up on this server (EST_CHECK_PUBLIC_KEY)';
  if (!isObj(raw) || !isObj(raw.result) || typeof raw.sig !== 'string') return 'the conformance service sent an unsigned result';
  if (raw.keyId !== (await keyIdOf(checkKey))) return 'the conformance result is signed with another key than the pinned one';
  if (!(await verifyBytes(checkSignedBytes(raw.result), raw.sig, checkKey))) return 'the conformance result\'s signature does not match';
  const r = raw.result;
  if (r.hash !== hash) return 'the conformance result names other bytes than the ones published';
  if (r.nonce !== nonce) return 'the conformance result was not asked for this publish';
  if (typeof r.checkedAt !== 'string' || !Number.isFinite(Date.parse(r.checkedAt)) || Math.abs(now - Date.parse(r.checkedAt)) > CHECK_RESULT_MAX_AGE_MS) return 'the conformance result is out of date';
  if (r.ok !== true) {
    const failed = Array.isArray(r.failed) ? r.failed.filter((x) => typeof x === 'string').slice(0, 10).map((x) => x.slice(0, 200)) : [];
    return `the bundle did not pass the conformance run${failed.length ? `: ${failed.join('; ')}` : ''}`;
  }
  return null;
}

/** The bundle's SHA-256 (hex), re-exported for the callers that have only this module. */
export const contentHashOf = sha256Hex;
