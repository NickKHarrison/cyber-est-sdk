// shared/storePack.mjs — 1.515 (EST Store Phase C, stream 1): a **sound pack**, a store item beside the
// plugins: presets, a drum kit, a PAD program or a folder of samples, installed into the person's
// Browser. **No code runs**: a pack's files are audio, a PAD program's `program.json` and preset JSON,
// nothing else (never a script, a page, a bundle or anything executable). Pure: no DOM, no Node, no store.
//
// A pack is a signed record like a plugin version:
//
//   { id, version, kind: 'samples' | 'kit' | 'pad-program' | 'presets', name, summary, tags,
//     files: [{ path, hash, bytes, type: 'audio' | 'program' | 'preset' }], previewHash?, sizeBytes, licence }
//
// - First-party packs are signed into the registry by the owner's key (sdk/packages/tools/src/registry.mjs
//   `publishRegistry`, from `est-plugins/registry/packs/<id>/pack.json`): the record is written as
//   `v1/packs/<id>/<version>/pack.json` (canonical JSON), its files as `v1/packs/<id>/<version>/files/<hash>.pack`,
//   and the signed index lists it (`packs`, `packIndexEntry`) with the record's SHA-256: the trust chain
//   is the index signature → the record's hash → each file's hash (every upload is checked against it).
// - Limits: `PACK_MAX_BYTES` (200 MB) a pack, `PACK_MAX_FILES` (2000, an account's uploads at most).
// - Community packs come later through the same publish path (the seam is server/storePacks.mjs'
//   `community`, closed with EST_COMMUNITY_OPEN).
//
// The store lists a pack as a `StorePackListing` (`type: 'pack'`), beside the plugins' listings
// (`type: 'plugin'`, shared/storeListing.mjs).
import { cleanTag, shownCount, STORE_ID_RE, STORE_TAGS_MAX, STORE_VERSION_RE } from './storeListing.mjs';

export const PACK_KINDS = Object.freeze(/** @type {const} */ (['samples', 'kit', 'pad-program', 'presets']));
export const PACK_FILE_TYPES = Object.freeze(/** @type {const} */ (['audio', 'program', 'preset']));
/** A pack, at most (every file together). */
export const PACK_MAX_BYTES = 200 * 1024 * 1024;
/** A pack's files, at most (an account holds 2000 uploads). */
export const PACK_MAX_FILES = 2000;
/** One audio file, at most (an upload's own limit). */
export const PACK_AUDIO_MAX_BYTES = 150 * 1024 * 1024;
/** A `program.json` or a preset file, at most. */
export const PACK_JSON_MAX_BYTES = 256 * 1024;
/** The record's own JSON, at most (2000 files of the longest path fit). */
export const PACK_RECORD_MAX_BYTES = 1024 * 1024;
/** A path inside a pack, at most. */
export const PACK_PATH_MAX = 200;
/** Play on a pack's card plays at most this long (the browser never decodes more for it). */
export const PACK_PREVIEW_SECONDS = 30;
/**
 * The pack claims an account may make (as the plugins', server/estLibrary.mjs `EST_ACCOUNT_LIMITS`):
 * at most 50 packs held and 20 installs an hour. Their bytes count in the account's storage, as any upload.
 */
export const PACK_ACCOUNT_LIMITS = Object.freeze({ packs: 50, installsPerHour: 20 });

/** The kinds as people read them. */
export const PACK_KIND_WORDS = Object.freeze({ samples: 'Samples', kit: 'Drum kit', 'pad-program': 'PAD program', presets: 'Presets' });

/** The extensions an audio file of a pack may have (the uploads' audio, `src/workspace/uploads.ts`). */
const AUDIO_EXT_RE = /\.(wav|mp3|flac|ogg|opus|aiff?|m4a)$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Whether a code point is shown: not a control character, nor a zero-width or direction mark. @param {number} n */
const shown = (n) => n >= 32 && n !== 127 && !(n >= 0x200b && n <= 0x200f) && !(n >= 0x202a && n <= 0x202e) && !(n >= 0x2066 && n <= 0x2069);
const allShown = (s) => [...s].every((c) => shown(/** @type {number} */ (c.codePointAt(0))));
const text = (v, max) => (typeof v === 'string' ? [...v].filter((c) => shown(/** @type {number} */ (c.codePointAt(0)))).join('').trim().slice(0, max) : '');

/** A file's last path part. @param {string} p */
export const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);

/**
 * What a path inside a pack holds, by its name: 'audio', 'program' (a file named `program.json`),
 * 'preset' (any other `.json`), or null (refused: anything else, executable or not).
 * @param {string} p
 */
export function fileTypeOf(p) {
  const name = baseName(p).toLowerCase();
  if (name === 'program.json') return 'program';
  if (name.endsWith('.json')) return 'preset';
  if (AUDIO_EXT_RE.test(name)) return 'audio';
  return null;
}

/**
 * A path inside a pack, checked: relative, '/'-separated, no empty, '.' or '..' part, no backslash,
 * no control, zero-width or direction character, at most `PACK_PATH_MAX`. Null when it is not one.
 * @param {unknown} p
 */
export function cleanPackPath(p) {
  if (typeof p !== 'string' || !p || p.length > PACK_PATH_MAX || !allShown(p)) return null;
  if (p.includes('\\') || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..' || x.trim() !== x)) return null;
  return p;
}

/**
 * An audio file's type from its first bytes, as an upload's (`server/workspace.mjs` `sniffType`), or
 * null when the bytes are not audio Cyber reads. @param {Uint8Array} b
 */
export function sniffPackAudio(b) {
  const at = (i, s) => b.length >= i + s.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'fLaC')) return 'audio/flac';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'FORM') && (at(8, 'AIFF') || at(8, 'AIFC'))) return 'audio/aiff';
  if (at(4, 'ftyp')) return 'audio/mp4';
  if (at(0, 'ID3') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

/** A pack file's media type for serving and uploading, by its name. @param {string} p */
export function mediaTypeOf(p) {
  const n = baseName(p).toLowerCase();
  if (n.endsWith('.json')) return 'application/json';
  const ext = n.slice(n.lastIndexOf('.') + 1);
  return ({ wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', aif: 'audio/aiff', aiff: 'audio/aiff', m4a: 'audio/mp4' })[ext] ?? 'application/octet-stream';
}

/** Which file types each kind may carry, and which it must. */
const KIND_RULES = Object.freeze({
  samples: { may: ['audio'], needs: 'audio' },
  kit: { may: ['audio'], needs: 'audio' },
  'pad-program': { may: ['audio', 'program'], needs: 'program' },
  presets: { may: ['preset'], needs: 'preset' },
});

/**
 * @typedef {{ path: string, hash: string, bytes: number, type: 'audio' | 'program' | 'preset' }} PackFile
 * @typedef {{
 *   id: string, version: string, kind: 'samples' | 'kit' | 'pad-program' | 'presets', name: string, summary: string, tags: string[],
 *   files: PackFile[], previewHash?: string, sizeBytes: number, licence: string,
 * }} StorePack
 */

/**
 * A pack record checked against every rule: `{ ok: true, pack }` (the record as kept: only its own
 * fields, the tags cleaned) or `{ ok: false, error }` in words. The publisher refuses a pack that is
 * not one; a reader drops it (`sanitisePack`).
 * @param {unknown} raw
 * @returns {{ ok: true, pack: StorePack, error?: undefined } | { ok: false, error: string, pack?: undefined }}
 */
export function checkPack(raw) {
  const no = (error) => ({ ok: /** @type {const} */ (false), error });
  if (!isObj(raw)) return no('a pack is an object');
  const r = /** @type {any} */ (raw);
  if (typeof r.id !== 'string' || !STORE_ID_RE.test(r.id)) return no('bad pack id');
  if (typeof r.version !== 'string' || !STORE_VERSION_RE.test(r.version)) return no(`${r.id}: bad version`);
  if (!PACK_KINDS.includes(r.kind)) return no(`${r.id}: its kind is one of ${PACK_KINDS.join(', ')}`);
  const name = text(r.name, 80);
  if (!name) return no(`${r.id}: it needs a name`);
  if (typeof r.name !== 'string' || !allShown(r.name)) return no(`${r.id}: its name has a control, zero-width or direction character`);
  if (typeof r.summary === 'string' && !allShown(r.summary)) return no(`${r.id}: its summary has a control, zero-width or direction character`);
  const licence = text(r.licence, 200);
  if (!licence) return no(`${r.id}: it needs a licence (what a person may do with its sounds)`);
  if (!Array.isArray(r.files) || !r.files.length) return no(`${r.id}: it has no files`);
  if (r.files.length > PACK_MAX_FILES) return no(`${r.id}: a pack holds at most ${PACK_MAX_FILES} files`);
  const rule = KIND_RULES[/** @type {keyof typeof KIND_RULES} */ (r.kind)];
  /** @type {PackFile[]} */
  const files = [];
  const paths = new Set();
  const hashes = new Set();
  let size = 0;
  for (const f of r.files) {
    if (!isObj(f)) return no(`${r.id}: a file is not one`);
    const p = cleanPackPath(f.path);
    if (!p) return no(`${r.id}: the path ${JSON.stringify(String(f.path).slice(0, 80))} is not a plain relative path`);
    const type = fileTypeOf(p);
    if (!type) return no(`${r.id}: ${p} is not audio, a program.json or preset JSON (a pack never holds anything else)`);
    if (f.type !== type) return no(`${r.id}: ${p} is ${type}, not ${String(f.type)}`);
    if (!rule.may.includes(type)) return no(`${r.id}: a ${r.kind} pack cannot hold ${p}`);
    if (typeof f.hash !== 'string' || !HASH_RE.test(f.hash)) return no(`${r.id}: ${p} has no SHA-256`);
    const bytes = f.bytes;
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return no(`${r.id}: ${p} has no size`);
    if (bytes > (type === 'audio' ? PACK_AUDIO_MAX_BYTES : PACK_JSON_MAX_BYTES)) return no(`${r.id}: ${p} is too large`);
    const key = p.toLowerCase();
    if (paths.has(key)) return no(`${r.id}: ${p} is in it twice`);
    if (hashes.has(f.hash)) return no(`${r.id}: ${p} has the same bytes as another file`);
    paths.add(key);
    hashes.add(f.hash);
    size += bytes;
    files.push({ path: p, hash: f.hash, bytes, type });
  }
  if (size > PACK_MAX_BYTES) return no(`${r.id}: a pack is at most ${PACK_MAX_BYTES / 1024 / 1024} MB`);
  if (!files.some((f) => f.type === rule.needs)) return no(`${r.id}: a ${r.kind} pack needs ${rule.needs === 'program' ? 'a program.json' : rule.needs === 'preset' ? 'a preset' : 'audio'}`);
  if (r.kind === 'pad-program' && files.filter((f) => f.type === 'program').length !== 1) return no(`${r.id}: a PAD program pack holds one program.json`);
  if (r.sizeBytes !== undefined && r.sizeBytes !== size) return no(`${r.id}: its sizeBytes is not the sum of its files`);
  let previewHash;
  if (r.previewHash !== undefined && r.previewHash !== null) {
    if (!files.some((f) => f.type === 'audio' && f.hash === r.previewHash)) return no(`${r.id}: its preview is not one of its audio files`);
    previewHash = r.previewHash;
  }
  const tags = [];
  for (const t of Array.isArray(r.tags) ? r.tags : []) { const c = cleanTag(t); if (c && !tags.includes(c) && tags.length < STORE_TAGS_MAX) tags.push(c); }
  return {
    ok: true,
    pack: { id: r.id, version: r.version, kind: r.kind, name, summary: text(r.summary, 280), tags, files, ...(previewHash ? { previewHash } : {}), sizeBytes: size, licence },
  };
}

/** A pack as read, or null when it is not one (`checkPack`'s rules). @param {unknown} raw @returns {StorePack | null} */
export const sanitisePack = (raw) => checkPack(raw).pack ?? null;

/** Where the registry keeps a pack version's files (relative to `/est/v1/`). @param {string} id @param {string} version */
export const packBase = (id, version) => `packs/${id}/${version}`;
/** A pack file's path in the registry: content addressed, so immutable. @param {string} id @param {string} version @param {string} hash */
export const packFilePath = (id, version, hash) => `${packBase(id, version)}/files/${hash}.pack`;

/**
 * @typedef {{
 *   id: string, version: string, kind: StorePack['kind'], name: string, summary: string, tags: string[], licence: string,
 *   tier: 'curated' | 'community', sizeBytes: number, fileCount: number, previewHash: string | null, publishedAt: string,
 *   recordUrl: string, recordHash: string, signatureUrl: string,
 * }} PackIndexEntry
 */

/**
 * A pack's line in the signed index: what the store lists without reading the record, and the
 * record's hash, which the index signature covers.
 * @param {StorePack} pack @param {{ recordHash: string, publishedAt: string, tier?: 'curated' | 'community' }} o
 * @returns {PackIndexEntry}
 */
export function packIndexEntry(pack, { recordHash, publishedAt, tier = 'curated' }) {
  const base = packBase(pack.id, pack.version);
  return {
    id: pack.id, version: pack.version, kind: pack.kind, name: pack.name, summary: pack.summary, tags: pack.tags, licence: pack.licence,
    tier, sizeBytes: pack.sizeBytes, fileCount: pack.files.length, previewHash: pack.previewHash ?? null, publishedAt,
    recordUrl: `${base}/pack.json`, recordHash, signatureUrl: `${base}/signature.json`,
  };
}

/**
 * The index's `packs` as read (after its signature is checked over the raw object): each entry checked,
 * a bad one dropped. @param {unknown} raw @returns {PackIndexEntry[]}
 */
export function sanitisePackIndex(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {PackIndexEntry[]} */
  const out = [];
  for (const e of raw.slice(0, 2000)) {
    if (!isObj(e) || typeof e.id !== 'string' || !STORE_ID_RE.test(e.id) || typeof e.version !== 'string' || !STORE_VERSION_RE.test(e.version)) continue;
    if (!PACK_KINDS.includes(e.kind) || typeof e.recordHash !== 'string' || !HASH_RE.test(e.recordHash)) continue;
    const base = packBase(e.id, e.version);
    if (e.recordUrl !== `${base}/pack.json`) continue;
    const sizeBytes = Number.isSafeInteger(e.sizeBytes) && e.sizeBytes > 0 && e.sizeBytes <= PACK_MAX_BYTES ? e.sizeBytes : 0;
    const fileCount = Number.isSafeInteger(e.fileCount) && e.fileCount > 0 && e.fileCount <= PACK_MAX_FILES ? e.fileCount : 0;
    if (!sizeBytes || !fileCount) continue;
    out.push({
      id: e.id, version: e.version, kind: e.kind, name: text(e.name, 80) || e.id, summary: text(e.summary, 280),
      tags: (Array.isArray(e.tags) ? e.tags : []).map(cleanTag).filter((t) => t !== null).slice(0, STORE_TAGS_MAX),
      licence: text(e.licence, 200), tier: /** @type {'curated' | 'community'} */ (e.tier === 'community' ? 'community' : 'curated'), sizeBytes, fileCount,
      previewHash: typeof e.previewHash === 'string' && HASH_RE.test(e.previewHash) ? e.previewHash : null,
      publishedAt: Number.isFinite(Date.parse(String(e.publishedAt ?? ''))) ? new Date(Date.parse(String(e.publishedAt))).toISOString() : '',
      recordUrl: `${base}/pack.json`, recordHash: e.recordHash, signatureUrl: `${base}/signature.json`,
    });
  }
  return out;
}

/**
 * @typedef {{
 *   type: 'pack', id: string, version: string, kind: StorePack['kind'], name: string, summary: string, tags: string[],
 *   developer: { id: string | null, name: string }, tier: 'cyber' | 'community', licence: string, sizeBytes: number, fileCount: number,
 *   previewHash: string | null, publishedAt: string, counts: { installs: number }, price: null,
 * }} StorePackListing
 */

/**
 * A pack as the store lists it (`type: 'pack'`). Every pack is free until the paid switch, under the
 * same rules as a plugin (`price` null; no amount is ever written in code). `installs` counts accounts,
 * below 5 given as 0 (counts only, never who).
 * @param {PackIndexEntry} e @param {{ installs?: number, developer?: { id: string | null, name: string } }} [o]
 * @returns {StorePackListing}
 */
export function packListing(e, o = {}) {
  return {
    type: 'pack', id: e.id, version: e.version, kind: e.kind, name: e.name, summary: e.summary, tags: e.tags,
    developer: o.developer ?? { id: null, name: 'Cyber' }, tier: e.tier === 'community' ? 'community' : 'cyber',
    licence: e.licence, sizeBytes: e.sizeBytes, fileCount: e.fileCount, previewHash: e.previewHash, publishedAt: e.publishedAt,
    counts: { installs: shownCount(o.installs) }, price: null,
  };
}

/** A pack listing as the app reads it, or null. @param {unknown} raw @returns {StorePackListing | null} */
export function sanitisePackListing(raw) {
  const r = /** @type {any} */ (raw);
  if (!isObj(r) || r.type !== 'pack') return null;
  const [e] = sanitisePackIndex([{ ...r, recordHash: '0'.repeat(64), recordUrl: `${packBase(String(r.id), String(r.version))}/pack.json`, tier: r.tier === 'community' ? 'community' : 'curated' }]);
  if (!e) return null;
  const l = packListing(e, { developer: { id: null, name: text(r.developer?.name, 120) || 'Cyber' } });
  l.counts = { installs: Math.max(0, Math.floor(Number(r.counts?.installs) || 0)) };
  return l;
}
