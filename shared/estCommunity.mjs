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
import { HIDDEN_OR_BLANK_RE } from './estHiddenText.mjs';
import { canonicalJson, fromBase64, keyIdOf, publicKeyBytes, REGISTRY_TIERS, REGISTRY_VERSION, sha256Hex, signedBytes } from './estRegistry.mjs';

/** Display text never carries these (EST-14): the one rule, shared/estHiddenText.mjs, with order P's blank letters (P4-1). */
const INVISIBLE = HIDDEN_OR_BLANK_RE;
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

/**
 * The sandbox attack order (streams D and E, D-2 and E-6, one rule at the integration): letters of other
 * scripts that are drawn as a Latin letter (Cyrillic and Greek, upper and lower case, and the Latin
 * letters NFKD leaves alone), each to the Latin letter it reads as. NFKC folds widths and styles, never
 * another script's look-alike, so the vendor "Cybеr" (a Cyrillic е) was published and drawn as
 * "Cyber", and "Nоcturne" sat beside "Nocturne". An upper-case letter is read as it is drawn (a
 * Greek Η is an H, its lower case η an n), so the map is applied before and after the lower-casing.
 * Only what is drawn the same in the common fonts: not a transliteration.
 */
const LOOKALIKES = new Map(Object.entries({
  // Cyrillic, upper case (read before lower-casing)
  'А': 'a', 'В': 'b', 'Е': 'e', 'К': 'k', 'М': 'm', 'Н': 'h', 'О': 'o', 'Р': 'p', 'С': 'c', 'Т': 't', 'У': 'y', 'Х': 'x',
  'Ѕ': 's', 'І': 'i', 'Ј': 'j', 'Ү': 'y', 'Ь': 'b',
  // Cyrillic, lower case
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'ѕ': 's', 'і': 'i', 'ї': 'i', 'ј': 'j', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'г': 'r', 'ь': 'b', 'ӏ': 'l', 'ү': 'y',
  // Greek, upper case
  'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z', 'Η': 'h', 'Ι': 'i', 'Κ': 'k', 'Μ': 'm', 'Ν': 'n', 'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
  // Greek, lower case
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'ϲ': 'c', 'ω': 'w',
  // Latin letters NFKD leaves alone
  'ı': 'i', 'ȷ': 'j', 'ɑ': 'a', 'ɡ': 'g', 'ł': 'l', 'ø': 'o', 'đ': 'd',
  // Order P (stream P4, P4-1): Latin small capitals ("\u1d04\u028f\u0299\u1d07\u0280" was drawn as CYBER), which NFKC leaves alone
  '\u1d00': 'a', '\u0299': 'b', '\u1d04': 'c', '\u1d05': 'd', '\u1d07': 'e', '\ua730': 'f', '\u0262': 'g', '\u029c': 'h', '\u026a': 'i', '\u1d0a': 'j',
  '\u1d0b': 'k', '\u029f': 'l', '\u1d0d': 'm', '\u0274': 'n', '\u1d0f': 'o', '\u1d18': 'p', '\u0280': 'r', '\ua731': 's', '\u1d1b': 't', '\u1d1c': 'u',
  '\u1d20': 'v', '\u1d21': 'w', '\u028f': 'y', '\u1d22': 'z', '\u0269': 'i', '\u028b': 'u',
  // Armenian, Georgian (lower case: the fold lower-cases first)
  '\u0585': 'o', '\u057d': 'u', '\u0581': 'g', '\u0570': 'h', '\u0578': 'n', '\u0566': 'q', '\u056c': 'l', '\u10e7': 'y',
  ...cherokee(),
}));
const mapLookalikes = (s) => { let out = ''; for (const ch of s) out += LOOKALIKES.get(ch) ?? ch; return out; };

/**
 * Cherokee capitals drawn as Latin letters ("\u13df\u13a9\u13f4\u13ac\u13a1" is drawn as CYBER), keyed by their lower
 * case too (the fold lower-cases first, and Cherokee capitals have lower-case forms). Order P, stream P4 (P4-1).
 */
function cherokee() {
  const pairs = { '\u13a0': 'd', '\u13a1': 'r', '\u13a2': 't', '\u13a5': 'i', '\u13a9': 'y', '\u13aa': 'a', '\u13ab': 'j', '\u13ac': 'e', '\u13b3': 'w', '\u13b7': 'm',
    '\u13bb': 'h', '\u13c0': 'g', '\u13c2': 'h', '\u13c3': 'z', '\u13cf': 'b', '\u13d2': 'r', '\u13d9': 'v', '\u13da': 's', '\u13de': 'l', '\u13df': 'c', '\u13e2': 'p', '\u13e6': 'k', '\u13f4': 'b' };
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(pairs)) { out[k] = v; out[k.toLowerCase()] = v; }
  return out;
}

/** Letters NFKC would turn into another letter, read first (U+03F9 is drawn as C; NFKC makes it \u03a3). */
const BEFORE_NFKC = /[\u03f9]/g;

/**
 * Digits and signs drawn for a letter ("CYB3R", "Cyb\u20acr", "\u00a9yber"): read only where Cyber's own name is asked
 * for (`reservedName`, `reservedVendor`, `claimsCyber`), never in `foldName`, so "Synth 1" and "Synth l" stay two names.
 * Order P, stream P4 (P4-1).
 */
const LEET = Object.freeze({ '0': 'o', '1': 'i', '3': 'e', '6': 'b', '8': 'b', '\u20ac': 'e', '\u00a2': 'c', '\u00a9': 'c', '\u00ae': 'r', '|': 'l' });
const leet = (s) => s.replace(/[01368\u20ac\u00a2\u00a9\u00ae|]/g, (ch) => LEET[/** @type {keyof typeof LEET} */ (ch)]);
/**
 * A name's words as they read, Cyber's own name in mind: folded, digits read as letters, and a run of single
 * letters read as one word ("C.Y.B.E.R Official", "C y b e r" → "cyber", "official"). @param {unknown} s
 */
function cyberWords(s) {
  const words = leet(lookalikeFold(s).replace(/[\u20ac\u00a2\u00a9\u00ae]/g, (ch) => LEET[/** @type {keyof typeof LEET} */ (ch)])).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = [];
  let run = '';
  for (const w of words) {
    if ([...w].length === 1) { run += w; continue; }
    if (run) out.push(run);
    run = '';
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

/**
 * `s` as it reads: widths, styles and accents folded, lower case, look-alike letters as their Latin
 * letter, a trade mark sign dropped; spacing and punctuation kept. The one fold: `foldName`, the
 * reserved-name rules and the review queue's name check (shared/estNameCheck.mjs) all read it.
 * @param {unknown} s
 */
export function lookalikeFold(s) {
  const plain = String(s ?? '').replace(/[℠™]/g, ' ').replace(BEFORE_NFKC, 'c').normalize('NFKC').normalize('NFKD').replace(/\p{M}/gu, '');
  return mapLookalikes(mapLookalikes(plain).toLowerCase());
}

/**
 * A name folded for comparison: `lookalikeFold`, letters and digits only
 * ("C y-b_e r", "ＣＹＢＥＲ", "Cybеr", "Сyber", "Cybér" → "cyber"). @param {string} s
 */
export function foldName(s) {
  return lookalikeFold(s).replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whether a name is the owner's own, exactly ("Cyber", any case, width, spacing, accents or look-alike letters; "Cyber Audio…", "Cyber EST"). Asked of a plugin's name and a namespace's label, which may hold the word. @param {string} s */
export function reservedName(s) {
  const f = foldName(s);
  // Order P (stream P4, P4-1): and with digits and signs read as letters ("CYB3R", "Cyb\u20acr").
  const l = cyberWords(s).join('');
  return [f, l].some((x) => x === 'cyber' || x.startsWith('cyberaudio') || x === 'cyberest');
}

/**
 * Whether a vendor, a developer's name or a reviewer's display name **reads as Cyber's own**:
 * `reservedName`, or "Cyber" as a word of its own in it ("Cyber Official", "Cyber Inc", "by Cyber",
 * "Сyber Team" with a Cyrillic С), which read as Cyber's and were published; a word that only holds it
 * ("Cyberdyne", "Cyberpunk", "Hypercyber") is anyone's. A plugin's **name** may still hold the word
 * ("CYBER Delay": `reservedName` alone is asked of it, and the review queue's name check weighs it), and
 * so may a namespace's label (`cyber-tools.com` is someone's domain).
 * @param {string} s
 */
export function reservedVendor(s) {
  // Order P (stream P4, P4-1): words read through `cyberWords` (digits as letters, spaced letters as one word).
  return reservedName(s) || cyberWords(s).includes('cyber');
}

/**
 * Order P (stream P4, P4-2): whether display text **claims to be Cyber's** ("by Cyber", "Official Cyber plugin",
 * "made by the Cyber team", "from Cyber's catalogue"), read as `reservedVendor` reads (look-alike letters, digits,
 * spaced letters). Asked of a Community plugin's name, description, store summaries, tags and changelog and a
 * developer's bio, which no rule read: a summary "The official Cyber reverb, by Cyber" was listed. Saying what
 * it is for ("a reverb for Cyber", "works in Cyber", "Cyberpunk") is anyone's. @param {unknown} s
 */
export function claimsCyber(s) {
  const t = ` ${cyberWords(s).join(' ')} `;
  return / (?:by|from|official|offical|officially|authentic|genuine|endorsed|approved|certified|verified) (?:the )?cyber /.test(t)
    || / cyber(?: audio)?(?: s)? (?:own|official|team|staff|approved|endorsed|verified|certified|original|catalogue|catalog|inhouse|firstparty|in house|first party) /.test(t);
}

/** Stream E's name for the same rule (`reservedVendor`): one function, two call sites' words. */
export const readsAsCyber = reservedVendor;

/** Words a copy adds to a name it borrows ("ACIDZ 303 Pro", "Official ACIDZ 303", "ACIDZ 303 MK2", "ACIDZ 404"). */
const EDITION_WORD = /^(?:pro|plus|ii|iii|iv|mk|mkii|mkiii|mk\d+|deluxe|lite|light|x|xl|xp|max|ultra|hd|se|le|free|studio|official|edition|new|next|classic|original|legacy|remaster|remastered|reloaded|redux|the|cyber|v\d+|\d+)$/;
/** Letters a copy swaps for a digit drawn like them, both sides read the same ("ACIDZ 3O3", "AC1DZ"). */
const SKELETON = Object.freeze({ o: '0', i: '1', l: '1', e: '3', s: '5', b: '8', z: '2', g: '9', a: '4', t: '7' });
const skeleton = (words) => words.join('').replace(/[oilesbzgat]/g, (ch) => SKELETON[/** @type {keyof typeof SKELETON} */ (ch)]);
const coreWords = (s) => {
  const w = lookalikeFold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const core = w.filter((x) => !EDITION_WORD.test(x));
  return core.length ? core : w;
};

/**
 * Order P (stream P4, P4-3): whether `name` reads as `known`, a name it may not take (a plugin in Cyber's
 * catalogue): the same name folded (stream D's rule), or with a copy's edition words added or the numbers
 * changed ("ACIDZ 303 Pro", "ACIDZ 404", "Official ACIDZ 303", "Cyber ACIDZ 303"), or digits drawn for its
 * letters ("ACIDZ 3O3"). A name that only holds it among words of its own ("Toast Rack Reverb") is anyone's.
 * @param {unknown} name @param {unknown} known
 */
export function readsAsName(name, known) {
  const a = foldName(String(name ?? ''));
  const b = foldName(String(known ?? ''));
  if (!a || !b) return false;
  if (a === b) return true;
  const all = (s) => lookalikeFold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return skeleton(all(name)) === skeleton(all(known)) || skeleton(coreWords(name)) === skeleton(coreWords(known));
}

/**
 * Order P (stream P4, P4-3): whether a vendor or developer name reads as `known` (a curated vendor): the same
 * folded, or `known` then words of a company's ("Nick K Harrison Audio", "NickKHarrison Official", "N1ck K Harr1son").
 * Only for a `known` of 6 letters or more. @param {unknown} vendor @param {unknown} known
 */
export function readsAsVendor(vendor, known) {
  const a = foldName(String(vendor ?? ''));
  const b = foldName(String(known ?? ''));
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length < 6) return false;
  const sk = (x) => skeleton([x]);
  return sk(a).startsWith(sk(b));
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
  if (`${ns}.` === RESERVED_ID_PREFIX || reservedName(ns.split('.')[1] ?? '')) return null;
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
 * @param {{ id?: unknown, name?: unknown, vendor?: unknown, description?: unknown, license?: unknown, parameters?: unknown }} manifest
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
  // The sandbox attack order (stream E): the rest of est.json's text the public pages show (the licence, each
  // parameter's name and unit) takes no invisible or direction character either; est.json's own rule
  // (EST-M018) refuses a shorter set (U+061C, U+00AD, U+2060, U+180E and the BOM passed it).
  {
    const hidden = (v) => typeof v === 'string' && (INVISIBLE.test(v) || CONTROL.test(v));
    const params = Array.isArray(manifest.parameters) ? manifest.parameters : [];
    if (hidden(manifest.license) || params.some((p) => isObj(p) && (hidden(p.name) || hidden(p.unit)))) {
      return { code: 'display', error: 'The licence or a parameter\'s name or unit has an invisible, right-to-left or control character, which Cyber refuses.' };
    }
  }
  if (owner) return null;
  if (id.startsWith(RESERVED_ID_PREFIX)) return { code: 'reserved', error: `${RESERVED_ID_PREFIX}* ids are Cyber's own: publish under your own namespace.` };
  // The vendor may not read as Cyber's at all (`reservedVendor`); a plugin's name may hold the word ("Cyber Delay" is
  // a name; the review queue's name check weighs it) but is never Cyber's own name, in any letters that look like it.
  if (reservedVendor(String(manifest.vendor)) || reservedName(String(manifest.name))) return { code: 'reserved', error: 'The name "Cyber" is Cyber\'s own: use your own name as the vendor and in the plugin\'s name.' };
  // Order P (stream P4, P4-2): a name or description that claims to be Cyber's ("Official Cyber Reverb", "by Cyber").
  if (claimsCyber(manifest.name) || (typeof manifest.description === 'string' && claimsCyber(manifest.description))) return { code: 'reserved', error: 'The plugin\'s name or description reads as Cyber\'s own ("by Cyber", "official Cyber"): a Community plugin is its developer\'s. Say what it is for instead ("a reverb for Cyber").' };
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
/**
 * 1.506: what a developer signs for a publish, in one place for the CLI (`est sign --developer`,
 * sdk/packages/tools/src/publishClient.mjs) and the browser (src/components/est/store/publish/sign.ts):
 * the payload `{ id, version, contentHash, publishedAt }` and the bytes its signature covers.
 * @param {{ id: string, version: string }} manifest @param {string} contentHash the bundle's SHA-256, hex @param {string} publishedAt an ISO time
 * @returns {{ payload: { id: string, version: string, contentHash: string, publishedAt: string }, bytes: Uint8Array }}
 */
export function developerSigningInput(manifest, contentHash, publishedAt) {
  const payload = { id: String(manifest.id), version: String(manifest.version), contentHash: String(contentHash), publishedAt: String(publishedAt) };
  return { payload, bytes: developerSignedBytes(payload) };
}
/** What the community index's signature covers. @param {unknown} obj */
export function communitySignedBytes(obj) {
  return new TextEncoder().encode(`est-registry/1 community\n${canonicalJson(obj)}`);
}
/**
 * 1.917 (Picked by Cyber): what a **pick statement**'s signature covers (the community key):
 * `{ id, version, contentHash, developer, pickedAt, picked: 'cyber' }`. Its own domain, so a pick can
 * never be read as a version's countersignature or an index, nor either of them as a pick.
 * @param {unknown} obj
 */
export function pickSignedBytes(obj) {
  return new TextEncoder().encode(`est-registry/1 pick\n${canonicalJson(obj)}`);
}
/**
 * 1.917: what the **picked index**'s signature covers (the community key): the community index's shape
 * holding only picked plugins, with the whole community blocklist. Its own domain, so it is never taken
 * for the full community index (a subset served in its place would hide every other plugin's update).
 * @param {unknown} obj
 */
export function pickedIndexSignedBytes(obj) {
  return new TextEncoder().encode(`est-registry/1 picked\n${canonicalJson(obj)}`);
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
  // 1.513 (stream 9, found by the Community dry run): and the list this function returns, so it is
  // idempotent. The client sanitises the root twice (`sanitiseIndex`, then `trustedCommunityRoot`), and
  // the second pass dropped the list, so no device ever took the delegation and no `dev.<10 hex>`
  // developer's plugin was offered.
  const dr = isObj(raw.developerRoot) ? raw.developerRoot : null;
  const drList = Array.isArray(raw.developerRoot) ? raw.developerRoot.slice(0, 2) : dr ? (Array.isArray(dr.keys) ? dr.keys.slice(0, 2) : dr.publicKey ? [dr] : []) : [];
  const developerRoot = drList.map(key).filter(Boolean).map((k) => { const { revoked, ...rest } = k; void revoked; return rest; });
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
        // 1.917: Picked by Cyber (an admin's choice, the version's pick statement beside it: `verifyPick`).
        ...(v.picked === true ? { picked: true, pickUrl: rel(v.pickUrl, `${base}/pick.json`) } : {}),
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
export async function verifyCommunityIndex(rawIndex, rawSig, communityKeys, now = Date.now(), { picked = false } = {}) {
  if (!isObj(rawSig) || rawSig.alg !== 'ed25519' || typeof rawSig.sig !== 'string') return { ok: false, why: 'the community index is not signed' };
  const k = (communityKeys ?? []).find((x) => x.keyId === rawSig.keyId);
  if (!k || !isObj(rawIndex) || !isObj(rawIndex.community) || rawIndex.community.keyId !== k.keyId) return { ok: false, why: 'the community index is signed with a key the registry does not name' };
  let bytes;
  // 1.917: the picked index is checked in its own domain (`pickedIndexSignedBytes`), never the full index's.
  try { bytes = picked ? pickedIndexSignedBytes(rawIndex) : communitySignedBytes(rawIndex); } catch { return { ok: false, why: 'the community index is not JSON' }; }
  if (!(await verifyBytes(bytes, rawSig.sig, k.pub))) return { ok: false, why: 'the community index\'s signature does not match: it was changed after signing' };
  let index;
  try { index = sanitiseCommunityIndex(rawIndex); } catch (err) { return { ok: false, why: err instanceof Error ? err.message : String(err) }; }
  if (expiredAt(index.community.expiresAt, now)) return { ok: false, why: `the community index expired on ${index.community.expiresAt}` };
  return { ok: true, index };
}

/**
 * 1.917 (Picked by Cyber): the picked index checked end to end, as `verifyCommunityIndex` but in the
 * picked domain, and with every version not marked picked dropped (this file can only carry picks).
 * @param {any} rawIndex @param {any} rawSig @param {{ keyId: string, pub: Uint8Array }[]} communityKeys @param {number} [now]
 */
export async function verifyPickedIndex(rawIndex, rawSig, communityKeys, now = Date.now()) {
  const r = await verifyCommunityIndex(rawIndex, rawSig, communityKeys, now, { picked: true });
  if (!r.ok || !r.index) return r;
  const plugins = r.index.plugins
    .map((p) => ({ ...p, versions: p.versions.filter((v) => v.picked === true) }))
    .filter((p) => p.versions.length)
    .map((p) => ({ ...p, latest: p.versions.some((v) => v.version === p.latest) ? p.latest : p.versions[0].version }));
  return { ok: true, index: { ...r.index, plugins } };
}

/**
 * 1.917 (Picked by Cyber): a version's pick statement checked: `{ alg, keyId, payload: { id, version,
 * contentHash, developer, pickedAt, picked: 'cyber' }, sig }`, signed by a community key the root names,
 * naming exactly this version's bytes. It stands in for the developer's own signature (an admin picked
 * the plugin; its maker signed nothing), so the developer it names must still own the id's namespace in
 * the root or the delegation (the caller checks, as for any community version). Never a tier: a pick is
 * not Reviewed, and a community key can sign nothing else. `{ ok: true, developer }` or `{ ok: false, why }`.
 * @param {any} rawPick @param {{ id: string, version: string, contentHash: string }} expect
 * @param {{ keyId: string, pub: Uint8Array }[]} communityKeys
 */
export async function verifyPick(rawPick, expect, communityKeys) {
  if (!isObj(rawPick) || rawPick.alg !== 'ed25519' || !isObj(rawPick.payload) || typeof rawPick.keyId !== 'string' || typeof rawPick.sig !== 'string') return { ok: false, why: 'the pick is not signed' };
  const p = rawPick.payload;
  if (Object.keys(p).sort().join(',') !== 'contentHash,developer,id,picked,pickedAt,version') return { ok: false, why: 'the pick covers other fields than { id, version, contentHash, developer, pickedAt, picked }' };
  if (p.picked !== 'cyber') return { ok: false, why: 'the pick does not say Cyber picked it' };
  if (p.id !== expect.id || p.version !== expect.version || p.contentHash !== expect.contentHash) return { ok: false, why: 'the pick names another version or other bytes' };
  if (typeof p.developer !== 'string' || !DEVELOPER_ID_RE.test(p.developer)) return { ok: false, why: 'the pick names no developer' };
  if (typeof p.pickedAt !== 'string' || !Number.isFinite(Date.parse(p.pickedAt))) return { ok: false, why: 'the pick has no date' };
  const k = (communityKeys ?? []).find((x) => x.keyId === rawPick.keyId);
  if (!k) return { ok: false, why: 'the pick is signed with a key Cyber does not trust' };
  if (!(await verifyBytes(pickSignedBytes(p), rawPick.sig, k.pub))) return { ok: false, why: 'the pick\'s signature does not match: it was changed after signing' };
  return { ok: true, developer: p.developer };
}

/**
 * 1.917 (Picked by Cyber): the id a picked plugin is listed under: `dev.<10 hex>.<slug>`, the slug the
 * old id's last part (lower-case letters, digits and hyphens, at most 40). An id already under the
 * developer's assigned namespace is kept. The 1.898 prompt's `com.example.<name>` ids all meet here, so
 * two makers' "glow-filter" become two plugins. Null for a developer id that is not one.
 * @param {string} oldId @param {string} developerId
 */
export function pickedIdOf(oldId, developerId) {
  const ns = assignedNamespaceOf(developerId);
  if (!ns) return null;
  const id = String(oldId ?? '');
  if (id.startsWith(`${ns}.`) && ID_RE.test(id)) return id;
  const last = id.split('.').pop() ?? '';
  const slug = last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${ns}.${slug.length >= 2 ? slug : 'plugin'}`;
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
