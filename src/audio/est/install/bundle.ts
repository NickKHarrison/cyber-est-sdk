/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §4; the specification draft §1 to §3): the `.est`
 * bundle reader. Pure (no DOM, no Web Audio, no store; WebCrypto's SHA-256 only), run by the
 * compiling Worker (`estWorker.ts`) and the tests. It **refuses before anything executes**: the
 * archive, every path, the manifest and every hash are checked here, and the module's imports,
 * exports and memory are read from its bytes without compiling it.
 *
 * The archive rules (spec §2, made strict so one set of files has one archive and nothing hides in
 * it): a ZIP of stored entries only, at most `BUNDLE_MAX_ENTRIES` and `BUNDLE_MAX_BYTES`, the
 * entries contiguous from byte 0 and the central directory and its end record straight after
 * (no prepended or trailing bytes, no archive comment, no ZIP64, no encryption, no data
 * descriptors), each local header agreeing with its central record and its CRC-32; `est.json` the
 * first entry; relative paths of `[A-Za-z0-9._-]` segments only (no absolute path, no `..`, no
 * backslash, no duplicate even by case), no symlink (a Unix mode in the external attributes);
 * directory entries are allowed and ignored. `scripts/est-pack.mjs` writes this shape.
 *
 * The content hash (`EstRef.hash`) is the SHA-256 of the archive's bytes (spec §2).
 */

import { encodeBase64 } from '../base64';
import type { EstManifestInfo, EstPreset } from '../library';
import { EST_HASH_RE, EST_ID_RE, EST_MIGRATE_MAX, EST_STATE_INLINE_MAX, EST_VERSION_RE, type EstMigrateEntry } from '../slot';
import { parseEstRange } from '../migrate';

export const BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
export const BUNDLE_MAX_ENTRIES = 512;
/** A module's memory: the default maximum and the hard cap, in 64 KiB pages (spec §3.1; `EstNode.ts`'s `EST_DEFAULT_PAGES`, `EST_HARD_MAX_PAGES`). */
export const DEFAULT_MEMORY_PAGES = 256;
export const HARD_MAX_MEMORY_PAGES = 2048;
/**
 * EST 1.1 (1.327, DEV-H, D-56): the editions this host runs (`abi.est`). A bundle for a newer 1.x
 * edition is refused with words that say so (`EST-M019`); a 1.0 bundle reads exactly as before, and
 * a 1.1 field in a 1.0 manifest is refused (`EST-M020`), so 1.0 never changes meaning.
 */
export const EST_HOST_EDITIONS = ['1.0', '1.1'] as const;
export type EstEdition = (typeof EST_HOST_EDITIONS)[number];
/** EST 1.1: the most channels on a main port (1.0: 2). */
export const EST_MAX_CHANNELS = 8;
/** EST 1.1: a preset's picture at most (a `.webp` in the bundle, spec §6). */
export const PRESET_IMAGE_MAX_BYTES = 64 * 1024;
/** EST 1.1: a preset picture's width and height at most (a small file may declare a huge picture). */
export const PRESET_IMAGE_MAX_PX = 1024;
/** What a module may import (spec §3.1; the runtime's own allowlist, `estProcessor.ts`'s `WASI`). */
export const ALLOWED_WASI = ['clock_time_get', 'random_get', 'fd_write', 'proc_exit', 'args_get', 'args_sizes_get', 'environ_get', 'environ_sizes_get'] as const;

/** Why a bundle was refused, as a code the UI can word (and the message says in plain words). */
export type EstBundleRefusal = 'zip' | 'path' | 'symlink' | 'size' | 'manifest' | 'hash' | 'module';

/**
 * A refusal: `code` for the UI's words, `message` in plain words, and since EST Phase 4 the
 * validator's `rule` (`rules.ts`, e.g. `EST-W004`) and, when it is known, `where` (a path in the
 * bundle, or `est.json:<field>`).
 */
export class EstBundleError extends Error {
  readonly code: EstBundleRefusal;
  readonly rule: string;
  readonly where: string | null;
  constructor(code: EstBundleRefusal, message: string, rule: string, where: string | null = null) {
    super(message);
    this.name = 'EstBundleError';
    this.code = code;
    this.rule = rule;
    this.where = where;
  }
}

const refuse = (code: EstBundleRefusal, message: string, rule: string, where: string | null = null): never => { throw new EstBundleError(code, message, rule, where); };

// --- The archive ------------------------------------------------------------------------------

export interface ZipEntry { name: string; data: Uint8Array }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Why a path inside a bundle is not allowed, or null. */
export function pathRefusal(name: string): string | null {
  if (!name || name.length > 255) return 'an empty or over-long path';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return `an absolute path (${name})`;
  if (name.includes('\\')) return `a backslash in a path (${name})`;
  const segs = name.split('/');
  for (const s of segs) {
    if (s === '..' || s === '.') return `a relative step in a path (${name})`;
    if (!SEGMENT.test(s)) return `a path with characters EST does not allow (${JSON.stringify(name)})`;
  }
  return null;
}

/** The entries of a stored ZIP, under the strict rules above (directories left out). */
export function readStoredZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > BUNDLE_MAX_BYTES) refuse('size', `the bundle is ${bytes.length} bytes, over the limit of ${BUNDLE_MAX_BYTES}`, 'EST-B004');
  if (bytes.length < 22) refuse('zip', 'not a ZIP archive (too short)', 'EST-B001');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (dv.getUint32(eocd, true) !== 0x06054b50) refuse('zip', 'not a canonical ZIP archive (no end record at the end: a comment or trailing bytes)', 'EST-B001');
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const onDisk = dv.getUint16(eocd + 8, true);
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const commentLen = dv.getUint16(eocd + 20, true);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) refuse('zip', 'a multi-disk ZIP archive', 'EST-B001');
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) refuse('zip', 'a ZIP64 archive', 'EST-B001');
  if (commentLen !== 0) refuse('zip', 'an archive comment', 'EST-B001');
  if (total > BUNDLE_MAX_ENTRIES) refuse('size', `${total} entries, over the limit of ${BUNDLE_MAX_ENTRIES}`, 'EST-B004');
  if (cdOffset + cdSize !== eocd) refuse('zip', 'bytes between the central directory and its end record', 'EST-B001');
  const dec = new TextDecoder('utf-8', { fatal: true });
  const out: ZipEntry[] = [];
  const seen = new Set<string>();
  let at = cdOffset;
  let expect = 0;
  for (let i = 0; i < total; i++) {
    if (at + 46 > eocd || dv.getUint32(at, true) !== 0x02014b50) refuse('zip', 'a damaged central directory', 'EST-B003');
    const madeBy = dv.getUint16(at + 4, true);
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const csize = dv.getUint32(at + 20, true);
    const usize = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen2 = dv.getUint16(at + 32, true);
    const external = dv.getUint32(at + 38, true);
    const offset = dv.getUint32(at + 42, true);
    if (at + 46 + nameLen + extraLen + commentLen2 > eocd) refuse('zip', 'a damaged central directory', 'EST-B003');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLen);
    let name: string;
    try { name = dec.decode(nameBytes); } catch { name = refuse('path', 'a path that is not UTF-8', 'EST-B005'); }
    at += 46 + nameLen + extraLen + commentLen2;
    if (flags & 0x0001) refuse('zip', `${name} is encrypted`, 'EST-B002', name);
    if (flags & 0x0008) refuse('zip', `${name} has a data descriptor (sizes must be in its header)`, 'EST-B002', name);
    if (method !== 0) refuse('zip', `${name} is compressed (EST bundles store every entry uncompressed)`, 'EST-B002', name);
    if (csize !== usize) refuse('zip', `${name}'s sizes disagree`, 'EST-B002', name);
    const host = madeBy >>> 8;
    const mode = external >>> 16;
    if (host === 3 && (mode & 0o170000) === 0o120000) refuse('symlink', `${name} is a symbolic link`, 'EST-B006', name);
    // The local record: exactly where the previous one ended (no gaps, no overlaps, nothing before).
    if (offset !== expect) refuse('zip', `${name} is not where the archive's layout puts it`, 'EST-B001', name);
    if (offset + 30 > cdOffset || dv.getUint32(offset, true) !== 0x04034b50) refuse('zip', `${name}'s local header is damaged`, 'EST-B003', name);
    const lFlags = dv.getUint16(offset + 6, true);
    const lMethod = dv.getUint16(offset + 8, true);
    const lCrc = dv.getUint32(offset + 14, true);
    const lCsize = dv.getUint32(offset + 18, true);
    const lUsize = dv.getUint32(offset + 22, true);
    const lNameLen = dv.getUint16(offset + 26, true);
    const lExtraLen = dv.getUint16(offset + 28, true);
    const lName = bytes.subarray(offset + 30, offset + 30 + lNameLen);
    if (lFlags !== flags || lMethod !== method || lCrc !== crc || lCsize !== csize || lUsize !== usize
      || lNameLen !== nameLen || !sameBytes(lName, nameBytes)) {
      refuse('zip', `${name}'s local header disagrees with the central directory`, 'EST-B003', name);
    }
    const start = offset + 30 + lNameLen + lExtraLen;
    const end = start + csize;
    if (end > cdOffset) refuse('zip', `${name} runs past the archive's data`, 'EST-B003', name);
    expect = end;
    const data = bytes.subarray(start, end);
    if (crc32(data) !== crc) refuse('hash', `${name} does not match its CRC-32 (a damaged or altered bundle)`, 'EST-B009', name);
    if (name.endsWith('/')) {
      if (csize !== 0) refuse('zip', `the directory ${name} has data`, 'EST-B002', name);
      if (i === 0) refuse('manifest', 'est.json is not the first entry', 'EST-B008', name);
      const dir = name.slice(0, -1);
      const why = pathRefusal(dir);
      if (why) refuse('path', why, 'EST-B005', name);
      continue;
    }
    const why = pathRefusal(name);
    if (why) refuse('path', why, 'EST-B005', name);
    const key = name.toLowerCase();
    if (seen.has(key)) refuse('path', `${name} is in the archive twice`, 'EST-B007', name);
    seen.add(key);
    if (i === 0 && name !== 'est.json') refuse('manifest', 'est.json is not the first entry', 'EST-B008', name);
    out.push({ name, data });
  }
  if (expect !== cdOffset) refuse('zip', 'bytes between the entries and the central directory', 'EST-B001');
  if (at !== eocd) refuse('zip', 'a damaged central directory', 'EST-B003');
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- The manifest -----------------------------------------------------------------------------

/** `est.json` as validated: what the host keeps of it (unknown keys are ignored, spec §1). */
export interface EstManifest {
  est: 1;
  id: string;
  version: string;
  name: string;
  vendor: string;
  description: string;
  license: string;
  kind: 'effect' | 'instrument';
  features: string[];
  abi: { est: string; clap: string };
  /** EST 1.1 (1.327): the edition `abi.est` names, one this host runs. */
  edition: EstEdition;
  module: { path: string; sha256: string; bytes: number };
  /** `audio` (EST 1.1, protocol v3): the page may ask for an analysis of the plugin's output; absent: false. */
  ui: { path: string; sha256: string; size: { w: number; h: number }; resizable: boolean; audio?: boolean } | null;
  assets: { path: string; sha256: string }[];
  audio: { inputs: number; outputs: number };
  /** EST 1.1: the sidechain input's channels (`audio.inputs[1]`, `"role": "sidechain"`); 0: none. */
  sidechain: number;
  notes: { inputs: number; outputs: number };
  limits: { maxLatencyFrames: number; memoryPagesMax: number; tailSeconds: number };
  /** `scale` (EST tidy, 1.286, D-44): present only when est.json gives one; absent is linear. */
  /** `modulatable` (EST 1.1): Cyber's modulators may send it `PARAM_MOD` (CLAP_PARAM_IS_MODULATABLE); present only when true. */
  parameters: { id: number; name: string; unit: string; scale?: EstParamScale; modulatable?: true }[];
  stateVersion: number;
  /** EST Phase 3 (spec §6): the bundle's preset index, `presets/index.json`, when it has one. */
  presets: string | null;
  /** 1.337 (R-F): what this version does with its earlier versions' settings (`migrate`, EST-M022); empty when it says nothing. */
  migrate: EstMigrateEntry[];
}

/** A parameter's scale hint (spec §1, D-44): how a knob, a slider and a lane move over its range. */
export type EstParamScale = 'linear' | 'log';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Each manifest problem's rule, from the field its message starts with (`rules.ts`'s EST-M rows). */
const MANIFEST_RULES: [RegExp, string][] = [
  // 1.314 (EST-14): first, so the character's rule wins over the field's.
  [/has a zero-width or direction character/, 'EST-M018'],
  // EST 1.1 (1.327, DEV-H): before the fields' own rules, as M018.
  [/is an EST 1\.1 field/, 'EST-M020'],
  [/^abi\.est asks for EST/, 'EST-M019'],
  [/^audio\.inputs\[1\]/, 'EST-M021'],
  // 1.337 (R-F): the migrate list, before `parameters` (its message may name both).
  [/^migrate\b/, 'EST-M022'],
  [/^(not a JSON object|no "est"|schema version)/, 'EST-M001'],
  [/^id\b/, 'EST-M002'],
  [/^version\b/, 'EST-M003'],
  [/^(name|vendor|description|license|url)\b/, 'EST-M004'],
  [/^kind\b/, 'EST-M005'],
  [/^(features|the first feature)\b/, 'EST-M006'],
  [/^abi\b/, 'EST-M007'],
  [/^(no module|module\b)/, 'EST-M008'],
  [/^ui\b/, 'EST-M009'],
  [/^assets\b/, 'EST-M010'],
  [/^(no audio ports|audio\b|an effect needs)/, 'EST-M011'],
  [/^(notes\b|an instrument needs)/, 'EST-M012'],
  [/^limits\b/, 'EST-M013'],
  [/^permissions\b/, 'EST-M014'],
  [/^parameters\b/, 'EST-M015'],
  [/^stateVersion\b/, 'EST-M016'],
  [/^presets\b/, 'EST-M017'],
];
/** The EST-M rule of a manifest problem (`what`, as `bad` words it); EST-M001 when none matches. */
export const manifestRuleOf = (what: string): string => MANIFEST_RULES.find(([re]) => re.test(what))?.[1] ?? 'EST-M001';
const fieldOf = (what: string): string | null => {
  const m = /^([A-Za-z][\w.[\]]*)\s/.exec(what);
  return m && !/^(not|no|the|an|schema)$/.test(m[1]!) ? `est.json:${m[1]}` : 'est.json';
};
const bad = (what: string): never => refuse('manifest', `est.json: ${what}`, manifestRuleOf(what), fieldOf(what));

function plainText(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string') return bad(`${field} is not text`);
  if (required && !v.trim()) return bad(`${field} is empty`);
  if (v.length > max) return bad(`${field} is longer than ${max} characters`);
  for (const ch of v) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) bad(`${field} has a control character`);
    // 1.314 (EST-14): zero-width and bidirectional controls, which could make one name look like another.
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) bad(`${field} has a zero-width or direction character (U+${c.toString(16).toUpperCase().padStart(4, '0')})`);
  }
  return v;
}

function int(v: unknown, field: string, min: number, max: number, def?: number): number {
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return bad(`${field} is not a whole number from ${min} to ${max}`);
  return v;
}

function hashOf(v: unknown, field: string): string {
  if (typeof v !== 'string' || !EST_HASH_RE.test(v)) return bad(`${field} is not a SHA-256 in lower-case hex`);
  return v;
}

/** A 1.1 field in a 1.0 manifest is refused (EST-M020): 1.0's meaning never changes. */
const need11 = (edition: EstEdition, field: string) => { if (edition === '1.0') bad(`${field} is an EST 1.1 field: set "abi": { "est": "1.1", "clap": "1.2" } to use it`); };

/**
 * A port list's main port channels (0: none). 1.0: at most one port of 1 or 2 channels, as before.
 * EST 1.1: up to `EST_MAX_CHANNELS` on the main port, and on the inputs a second port, the
 * sidechain (`{ "role": "sidechain", "channels": 1 | 2 }`), returned as `sidechain`.
 */
function ports(v: unknown, field: string, edition: EstEdition, sidechainOk: boolean): { main: number; sidechain: number } {
  const most = sidechainOk && edition !== '1.0' ? 2 : 1;
  if (!Array.isArray(v) || v.length > most) {
    if (Array.isArray(v) && v.length === 2 && sidechainOk) need11(edition, `${field}[1]`);
    return bad(`${field} must list at most ${most === 1 ? 'one (main) port' : 'a main port and a sidechain'}`);
  }
  if (!v.length) return { main: 0, sidechain: 0 };
  const p = v[0];
  if (!isObj(p)) return bad(`${field}[0] is not an object`);
  if (p.role !== undefined && p.role !== 'main') {
    if (edition === '1.0') need11(edition, `${field}[0].role`);
    bad(`${field}[0].role is not "main" (the first port is the main one)`);
  }
  const ch = int(p.channels, `${field}[0].channels`, 1, edition === '1.0' ? 2 : EST_MAX_CHANNELS);
  let sidechain = 0;
  if (v.length === 2) {
    const sc = v[1];
    if (!isObj(sc)) return bad(`${field}[1] is not an object`);
    if (sc.role !== 'sidechain') bad(`${field}[1].role is not "sidechain" (a second input is the sidechain)`);
    sidechain = int(sc.channels, `${field}[1].channels`, 1, 2);
  }
  return { main: ch, sidechain };
}

/** The manifest from its parsed JSON (spec §1), or an `EstBundleError` saying what is wrong. */
export function parseManifest(raw: unknown): EstManifest {
  if (!isObj(raw)) return bad('not a JSON object');
  if (raw.est !== 1) return bad(typeof raw.est === 'number' ? `schema version ${raw.est} is not one this host knows` : 'no "est": 1');
  const id = typeof raw.id === 'string' && EST_ID_RE.test(raw.id) ? raw.id : bad('id is not a reverse-DNS id of [a-z0-9.-]');
  const version = typeof raw.version === 'string' && EST_VERSION_RE.test(raw.version) ? raw.version : bad('version is not a semantic version');
  const name = plainText(raw.name, 'name', 60);
  const vendor = plainText(raw.vendor, 'vendor', 60);
  const description = plainText(raw.description, 'description', 400, false);
  if (raw.url !== undefined && (typeof raw.url !== 'string' || !/^https:\/\/[^\s]{1,300}$/.test(raw.url))) bad('url is not an https address');
  const license = plainText(raw.license, 'license', 64);
  const kind = raw.kind === 'effect' || raw.kind === 'instrument' ? raw.kind : bad('kind is neither "effect" nor "instrument"');
  if (!Array.isArray(raw.features) || !raw.features.length || raw.features.length > 32) bad('features is not a list of 1 to 32 names');
  const features = (raw.features as unknown[]).map((f, i) => plainText(f, `features[${i}]`, 64));
  if (features[0] !== (kind === 'effect' ? 'audio-effect' : 'instrument')) bad(`the first feature must be "${kind === 'effect' ? 'audio-effect' : 'instrument'}"`);
  if (!isObj(raw.abi) || typeof raw.abi.est !== 'string' || !/^1\.\d{1,4}$/.test(raw.abi.est)) bad('abi.est is not a 1.x edition');
  const abi = { est: String((raw.abi as Record<string, unknown>).est), clap: plainText((raw.abi as Record<string, unknown>).clap, 'abi.clap', 16) };
  // EST 1.1 (1.327): a newer edition than this host's is refused in words (never read as 1.0).
  if (!(EST_HOST_EDITIONS as readonly string[]).includes(abi.est)) bad(`abi.est asks for EST ${abi.est}, which this host does not run (it runs EST ${EST_HOST_EDITIONS.join(' and ')}): update Cyber, or build the plugin for an edition it runs`);
  const edition = abi.est as EstEdition;
  if (!/^1\.\d{1,4}(\.\d{1,4})?$/.test(abi.clap)) bad('abi.clap is not a CLAP 1.x version');
  if (!isObj(raw.module)) bad('no module');
  const m = raw.module as Record<string, unknown>;
  const modulePath = typeof m.path === 'string' && !pathRefusal(m.path) ? m.path : bad('module.path is not a path in the bundle');
  const module = { path: modulePath, sha256: hashOf(m.sha256, 'module.sha256'), bytes: int(m.bytes, 'module.bytes', 8, BUNDLE_MAX_BYTES) };
  let ui: EstManifest['ui'] = null;
  if (raw.ui !== undefined && raw.ui !== null) {
    if (!isObj(raw.ui)) bad('ui is not an object');
    const u = raw.ui as Record<string, unknown>;
    if (typeof u.path !== 'string' || pathRefusal(u.path) || !/\.html$/.test(u.path)) bad('ui.path is not an .html path in the bundle');
    const size = isObj(u.size) ? u.size : bad('ui.size is missing');
    ui = { path: u.path as string, sha256: hashOf(u.sha256, 'ui.sha256'), size: { w: int(size.w, 'ui.size.w', 120, 2000), h: int(size.h, 'ui.size.h', 80, 1400) }, resizable: u.resizable === true };
    // EST 1.1 (protocol v3): the page may ask for an analysis of the output (never samples).
    if (u.audio !== undefined) {
      if (typeof u.audio !== 'boolean') bad('ui.audio is not true or false');
      if (u.audio === true) { need11(edition, 'ui.audio'); ui.audio = true; }
    }
  }
  if (raw.assets !== undefined && !Array.isArray(raw.assets)) bad('assets is not a list');
  const assets = ((raw.assets ?? []) as unknown[]).map((a, i) => {
    if (!isObj(a) || typeof a.path !== 'string' || pathRefusal(a.path)) return bad(`assets[${i}].path is not a path in the bundle`);
    return { path: a.path, sha256: hashOf(a.sha256, `assets[${i}].sha256`) };
  });
  if (!isObj(raw.audio)) bad('no audio ports');
  const ins = ports((raw.audio as Record<string, unknown>).inputs, 'audio.inputs', edition, true);
  const outs = ports((raw.audio as Record<string, unknown>).outputs, 'audio.outputs', edition, false);
  const audio = { inputs: ins.main, outputs: outs.main };
  const sidechain = ins.sidechain;
  if (sidechain && !audio.inputs) bad('audio.inputs[1] (a sidechain) needs a main input before it');
  if (kind === 'effect' && (audio.inputs === 0 || audio.outputs === 0)) bad('an effect needs an audio input and output');
  const n = isObj(raw.notes) ? raw.notes : {};
  const notes = { inputs: int(n.inputs, 'notes.inputs', 0, 1, 0), outputs: int(n.outputs, 'notes.outputs', 0, 1, 0) };
  if (kind === 'instrument' && notes.inputs < 1) bad('an instrument needs a note input');
  const l = isObj(raw.limits) ? raw.limits : {};
  const limits = {
    maxLatencyFrames: int(l.maxLatencyFrames, 'limits.maxLatencyFrames', 0, 192000, 0),
    memoryPagesMax: int(l.memoryPagesMax, 'limits.memoryPagesMax', 1, HARD_MAX_MEMORY_PAGES, DEFAULT_MEMORY_PAGES),
    tailSeconds: int(l.tailSeconds, 'limits.tailSeconds', 0, 60, 0),
  };
  if (raw.permissions !== undefined && (!Array.isArray(raw.permissions) || raw.permissions.length > 0)) {
    bad('permissions must be empty (EST 1.0 grants none to a plugin)');
  }
  if (raw.parameters !== undefined && (!Array.isArray(raw.parameters) || raw.parameters.length > 512)) bad('parameters is not a list of at most 512');
  const parameters = ((raw.parameters ?? []) as unknown[]).map((p, i) => {
    if (!isObj(p)) return bad(`parameters[${i}] is not an object`);
    const out: EstManifest['parameters'][number] = { id: int(p.id, `parameters[${i}].id`, 0, 0xffffffff), name: plainText(p.name, `parameters[${i}].name`, 255), unit: plainText(p.unit, `parameters[${i}].unit`, 16, false) };
    if (p.scale !== undefined) {
      if (p.scale !== 'linear' && p.scale !== 'log') return bad(`parameters[${i}].scale is neither "linear" nor "log"`);
      out.scale = p.scale;
    }
    // EST 1.1: Cyber's modulators may send it PARAM_MOD (the DSP flags it CLAP_PARAM_IS_MODULATABLE: EST-C022).
    if (p.modulatable !== undefined) {
      if (typeof p.modulatable !== 'boolean') return bad(`parameters[${i}].modulatable is not true or false`);
      if (p.modulatable) { need11(edition, `parameters[${i}].modulatable`); out.modulatable = true; }
    }
    return out;
  });
  const stateVersion = int(raw.stateVersion, 'stateVersion', 1, 1_000_000, 1);
  let presets: string | null = null;
  if (raw.presets !== undefined && raw.presets !== null) {
    if (typeof raw.presets !== 'string' || pathRefusal(raw.presets) || !/\.json$/.test(raw.presets)) bad('presets is not a .json path in the bundle');
    presets = raw.presets as string;
  }
  const migrate = migrateOf(raw.migrate, parameters);
  return { est: 1, id, version, name, vendor, description, license, kind, features, abi, edition, module, ui, assets, audio, sidechain, notes, limits, parameters, stateVersion, presets, migrate };
}

/**
 * 1.337 (R-F): the `migrate` list (EST-M022 when it is not one): at most `EST_MIGRATE_MAX` entries,
 * each `{ from, params?, state? }` with `from` a version range (`parseEstRange`), `params` old CLAP
 * ids (decimal strings) to new ids or null, every new id one the manifest's `parameters` list,
 * and `state` "keep" (the default) or "drop". A manifest with the field lists its parameters, so
 * the ids can be checked. Absent or empty: nothing to migrate.
 */
function migrateOf(v: unknown, parameters: EstManifest['parameters']): EstMigrateEntry[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > EST_MIGRATE_MAX) return bad(`migrate is not a list of at most ${EST_MIGRATE_MAX} entries`);
  if (!parameters.length) bad('migrate needs the parameters list (every new id must be one of them)');
  const ids = new Set(parameters.map(p => String(p.id)));
  return v.map((e, i) => {
    if (!isObj(e)) return bad(`migrate[${i}] is not an object`);
    if (typeof e.from !== 'string' || !parseEstRange(e.from)) return bad(`migrate[${i}].from is not a version range (comparators separated by spaces, such as ">=1.0.0 <1.2.0", a version, or "*")`);
    const params: Record<string, string | null> = {};
    if (e.params !== undefined) {
      if (!isObj(e.params)) return bad(`migrate[${i}].params is not an object of old id to new id or null`);
      const entries = Object.entries(e.params);
      if (entries.length > 512) return bad(`migrate[${i}].params names more than 512 parameters`);
      for (const [k, to] of entries) {
        if (!/^\d{1,10}$/.test(k) || Number(k) > 0xffffffff) return bad(`migrate[${i}].params has a key that is not a CLAP id (a decimal string): "${k.slice(0, 40)}"`);
        if (to !== null && (typeof to !== 'string' || !/^\d{1,10}$/.test(to) || Number(to) > 0xffffffff)) return bad(`migrate[${i}].params.${k} is neither a CLAP id (a decimal string) nor null`);
        if (to !== null && !ids.has(to)) return bad(`migrate[${i}].params.${k} names parameter ${to}, which parameters does not list`);
        params[k] = to;
      }
    }
    if (e.state !== undefined && e.state !== 'keep' && e.state !== 'drop') return bad(`migrate[${i}].state is neither "keep" nor "drop"`);
    return { from: e.from, params, state: e.state === 'drop' ? 'drop' : 'keep' };
  });
}

/** What the rest of the host keeps (`EstInstalled.manifest`, library.ts). */
export function manifestInfo(m: EstManifest): EstManifestInfo {
  return {
    id: m.id, version: m.version, name: m.name, vendor: m.vendor, description: m.description, kind: m.kind,
    features: m.features.slice(),
    ui: m.ui ? { path: m.ui.path, w: m.ui.size.w, h: m.ui.size.h, resizable: m.ui.resizable } : null,
    audio: { ...m.audio },
    limits: { ...m.limits },
    notes: { ...m.notes },
    ...(logParamsOf(m).length ? { logParams: logParamsOf(m) } : {}),
    // EST 1.1 (1.327): only a 1.1 bundle's record carries these (a 1.0 record is as before).
    ...(m.edition !== '1.0' ? { edition: m.edition } : {}),
    ...(m.sidechain ? { sidechain: m.sidechain } : {}),
    ...(modulatableOf(m).length ? { modulatable: modulatableOf(m) } : {}),
    ...(m.ui?.audio ? { uiAudio: true as const } : {}),
    // 1.337 (R-F): the migrate list and the parameters' names (what a switch's toast calls them).
    ...(m.migrate.length ? { migrate: m.migrate.map(e => ({ from: e.from, params: { ...e.params }, state: e.state })) } : {}),
    ...(m.parameters.length ? { paramNames: Object.fromEntries(m.parameters.map(p => [String(p.id), p.name])) } : {}),
  };
}

/** EST 1.1: the ids est.json marks `"modulatable": true`. */
export const modulatableOf = (m: Pick<EstManifest, 'parameters'>): number[] => m.parameters.filter(p => p.modulatable).map(p => p.id);

/** The ids est.json marks `"scale": "log"` (EST tidy, 1.286, D-44). */
export const logParamsOf = (m: Pick<EstManifest, 'parameters'>): number[] => m.parameters.filter(p => p.scale === 'log').map(p => p.id);

// --- Presets (EST Phase 3; spec §6) -------------------------------------------------------------

/** At most this many presets in a bundle. */
export const BUNDLE_MAX_PRESETS = 128;

/** One bundle preset as validated: its state stream's bytes from the bundle. */
export interface EstBundlePreset {
  /** Its path in the bundle: unique, so the preset's id. */
  path: string;
  name: string;
  tags: string[];
  stateVersion: number;
  bytes: Uint8Array;
  /** EST 1.1: the preset's picture (a `.webp` in the bundle, its path) and its author. */
  image?: string;
  author?: string;
}

/**
 * The presets a bundle's index lists (`{ "presets": [{ "name", "path", "tags", "stateVersion" }] }`),
 * each a state stream in the bundle of 1 byte to `EST_STATE_INLINE_MAX` (a preset loads into a
 * slot's inline state, D-17), with a state version no newer than the manifest's. Throws an
 * `EstBundleError` ('manifest') saying what is wrong.
 */
export function parsePresets(manifest: EstManifest, files: Map<string, Uint8Array>): EstBundlePreset[] {
  if (!manifest.presets) return [];
  const where = manifest.presets;
  const no = (what: string): never => refuse('manifest', `${where}: ${what}`, 'EST-B014', where);
  const json = files.get(where);
  if (!json) return no('is not in the bundle');
  if (json.length > 64 * 1024) no('is over 64 KB');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch { raw = no('is not valid JSON'); }
  if (!isObj(raw) || !Array.isArray(raw.presets)) return no('has no "presets" list');
  const list = raw.presets as unknown[];
  if (list.length > BUNDLE_MAX_PRESETS) no(`lists ${list.length} presets (at most ${BUNDLE_MAX_PRESETS})`);
  const seen = new Set<string>();
  const reserved = new Set(['est.json', manifest.module.path, where, ...(manifest.ui ? [manifest.ui.path] : [])]);
  return list.map((p, i) => {
    const at = `presets[${i}]`;
    if (!isObj(p)) return no(`${at} is not an object`);
    let name: string;
    try { name = plainText(p.name, `${at}.name`, 60); } catch (e) { return no((e as Error).message.replace(/^est\.json: /, '')); }
    if (typeof p.path !== 'string' || pathRefusal(p.path) || reserved.has(p.path)) return no(`${at}.path is not a state file in the bundle`);
    if (seen.has(p.path)) no(`${p.path} is listed twice`);
    seen.add(p.path);
    const bytes = files.get(p.path);
    if (!bytes) return no(`${p.path} is not in the bundle`);
    if (bytes.length < 1 || bytes.length > EST_STATE_INLINE_MAX) no(`${p.path} is ${bytes.length} bytes (1 to ${EST_STATE_INLINE_MAX})`);
    if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > 8)) no(`${at}.tags is not a list of at most 8`);
    const tags = ((p.tags ?? []) as unknown[]).map((t, k) => {
      try { return plainText(t, `${at}.tags[${k}]`, 32); } catch (e) { return no((e as Error).message.replace(/^est\.json: /, '')); }
    });
    let stateVersion = manifest.stateVersion;
    if (p.stateVersion !== undefined) {
      if (typeof p.stateVersion !== 'number' || !Number.isInteger(p.stateVersion) || p.stateVersion < 1 || p.stateVersion > manifest.stateVersion) {
        no(`${at}.stateVersion is not a whole number from 1 to the manifest's ${manifest.stateVersion}`);
      }
      stateVersion = p.stateVersion as number;
    }
    const out: EstBundlePreset = { path: p.path, name, tags, stateVersion, bytes };
    // EST 1.1 (1.327, DEV-H): a picture and an author (EST-B016), in a 1.1 bundle only.
    if (p.image !== undefined || p.author !== undefined) {
      const pic = (what: string): never => refuse('manifest', `${where}: ${what}`, 'EST-B016', where);
      if (manifest.edition === '1.0') pic(`${at} has an image or author, which are EST 1.1 fields: set "abi": { "est": "1.1" }`);
      if (p.author !== undefined) {
        try { out.author = plainText(p.author, `${at}.author`, 60); } catch (e) { return pic((e as Error).message.replace(/^est\.json: /, '')); }
      }
      if (p.image !== undefined) {
        if (typeof p.image !== 'string' || pathRefusal(p.image) || !/\.webp$/.test(p.image) || reserved.has(p.image)) return pic(`${at}.image is not a .webp path in the bundle`);
        const img = files.get(p.image);
        if (!img) return pic(`${p.image} is not in the bundle`);
        if (img.length > PRESET_IMAGE_MAX_BYTES) pic(`${p.image} is ${img.length} bytes (at most ${PRESET_IMAGE_MAX_BYTES})`);
        if (!isWebp(img)) pic(`${p.image} is not a WebP image`);
        const dims = webpSize(img);
        if (!dims) pic(`${p.image} has no WebP picture header (VP8, VP8L or VP8X) to read its size from`);
        if (dims!.w > PRESET_IMAGE_MAX_PX || dims!.h > PRESET_IMAGE_MAX_PX) pic(`${p.image} is ${dims!.w} × ${dims!.h} (at most ${PRESET_IMAGE_MAX_PX} × ${PRESET_IMAGE_MAX_PX})`);
        out.image = p.image;
      }
    }
    return out;
  });
}

/**
 * A WebP's declared width and height, from its first chunk (`VP8 `, `VP8L` or `VP8X`), or null
 * when it has none of them or the header is cut short. Read before anything decodes it, so a 64 KiB
 * file that declares 16383 × 16383 (about 1 GiB decoded) is refused.
 */
export function webpSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  const d = 20;
  if (fourcc === 'VP8 ') {
    if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    return { w: (b[d + 6]! | (b[d + 7]! << 8)) & 0x3fff, h: (b[d + 8]! | (b[d + 9]! << 8)) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    if (b[d] !== 0x2f) return null;
    const x = b[d + 1]! | (b[d + 2]! << 8) | (b[d + 3]! << 16) | (b[d + 4]! << 24);
    return { w: (x & 0x3fff) + 1, h: ((x >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    return { w: (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16)) + 1, h: (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16)) + 1 };
  }
  return null;
}

/** Whether bytes are a WebP file (`RIFF` <size> `WEBP`, the size within the file). */
export function isWebp(b: Uint8Array): boolean {
  if (b.length < 16) return false;
  const tag = (o: number, t: string) => t.split('').every((c, k) => b[o + k] === c.charCodeAt(0));
  const size = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0;
  return tag(0, 'RIFF') && tag(8, 'WEBP') && size + 8 <= b.length && size >= 8;
}

/** A bundle's presets as the rest of the host takes them (`EstLibrary.presets`): `{ id, name, tags, state }`, the state in base64. */
export const estPresetsOf = (presets: readonly EstBundlePreset[], files?: ReadonlyMap<string, Uint8Array>): EstPreset[] =>
  presets.map(p => {
    const out: EstPreset = { id: p.path, name: p.name, tags: p.tags.slice(), state: encodeBase64(p.bytes) };
    // EST 1.1: the picture as a data URL (validated WebP, at most 64 KiB), the author as text.
    const img = p.image ? files?.get(p.image) : undefined;
    if (img) out.image = `data:image/webp;base64,${encodeBase64(img)}`;
    if (p.author) out.author = p.author;
    return out;
  });

// --- The module, read without compiling it ---------------------------------------------------

export type WasmKind = 'function' | 'table' | 'memory' | 'global' | 'tag';
/** A function type as `inspectWasm` reads it: value types by their text names (1.314). */
export interface WasmFuncType { params: string[]; results: string[] }
export interface WasmInspection {
  /** 1.314 (EST-02): a function import carries its type (`type`), from the type section. */
  imports: { module: string; name: string; kind: WasmKind; type?: WasmFuncType }[];
  exports: { name: string; kind: WasmKind }[];
  memory: { imported: boolean; min: number; max: number | null; shared: boolean; memory64: boolean } | null;
  tables: number;
  /** EST Phase 4: whether it has a start section (it traps under the meter: `EST-W015`). */
  start: boolean;
  /** 1.314: the type section's function types, in order. */
  types: WasmFuncType[];
}

const KINDS: WasmKind[] = ['function', 'table', 'memory', 'global', 'tag'];
/** WebAssembly's value types by their byte (`valtype`): the numbers, v128 and the two reference types. */
const VALTYPES: Record<number, string> = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128', 0x70: 'funcref', 0x6f: 'externref' };

/**
 * 1.314 (EST-02): the WASI preview-1 types of the eight imports EST allows (`ALLOWED_WASI`). An
 * import of one of these names with any other type is refused (`EST-W017`): the host's function
 * would read arguments of the wrong kind (a `random_get(f64 buf, f64 len)` handed it a length of
 * 10^15 and the host looped outside the meter).
 */
export const WASI_TYPES: Readonly<Record<(typeof ALLOWED_WASI)[number], WasmFuncType>> = {
  clock_time_get: { params: ['i32', 'i64', 'i32'], results: ['i32'] },
  random_get: { params: ['i32', 'i32'], results: ['i32'] },
  fd_write: { params: ['i32', 'i32', 'i32', 'i32'], results: ['i32'] },
  proc_exit: { params: ['i32'], results: [] },
  args_get: { params: ['i32', 'i32'], results: ['i32'] },
  args_sizes_get: { params: ['i32', 'i32'], results: ['i32'] },
  environ_get: { params: ['i32', 'i32'], results: ['i32'] },
  environ_sizes_get: { params: ['i32', 'i32'], results: ['i32'] },
};

const sameType = (a: WasmFuncType, b: WasmFuncType) => a.params.length === b.params.length && a.results.length === b.results.length
  && a.params.every((t, i) => t === b.params[i]) && a.results.every((t, i) => t === b.results[i]);
const typeText = (t: WasmFuncType) => `(${t.params.join(', ')}) -> (${t.results.join(', ')})`;

/**
 * 1.314 (EST-02): why a module's WASI imports may not run, by their types, or null: every function
 * import of `wasi_snapshot_preview1` has exactly its preview-1 type (`WASI_TYPES`). The names are
 * `moduleRefusalOf`'s `EST-W004`; this is `EST-W017`, checked again by the compiling Worker before
 * every compile of stored bytes (`estWorker.ts`), so a stored module cannot boot with another type.
 */
export function wasiTypeRefusal(w: Pick<WasmInspection, 'imports'>): { rule: string; message: string } | null {
  for (const im of w.imports) {
    if (im.module !== 'wasi_snapshot_preview1' || im.kind !== 'function') continue;
    const want = (WASI_TYPES as Record<string, WasmFuncType | undefined>)[im.name];
    if (!want) continue;
    if (!im.type || !sameType(im.type, want)) {
      return { rule: 'EST-W017', message: `the module imports wasi_snapshot_preview1.${im.name} as ${im.type ? typeText(im.type) : 'an unknown type'}, not WASI preview 1's ${typeText(want)}` };
    }
  }
  return null;
}

/** A module's imports, exports and memory, from its bytes (throws an `EstBundleError` on a malformed one). */
export function inspectWasm(b: Uint8Array): WasmInspection {
  const fail = (why: string, rule = 'EST-W002'): never => refuse('module', `module.wasm is not a valid WebAssembly module (${why})`, rule, 'module.wasm');
  if (b.length < 8 || b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) fail('no magic number', 'EST-W001');
  if (b[4] !== 1 || b[5] !== 0 || b[6] !== 0 || b[7] !== 0) fail('not version 1 (a component or a newer format)', 'EST-W001');
  let i = 8;
  const leb = (): number => {
    let r = 0, shift = 0, byte: number;
    do {
      if (i >= b.length || shift > 35) fail('a truncated number');
      byte = b[i++]!;
      r += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return r;
  };
  const dec = new TextDecoder('utf-8', { fatal: true });
  const str = (): string => {
    const n = leb();
    if (i + n > b.length) fail('a truncated name');
    let s = '';
    try { s = dec.decode(b.subarray(i, i + n)); } catch { fail('a name that is not UTF-8'); }
    i += n;
    return s;
  };
  // 1.411 (INFO 3): every flag value's min (and max) is read, so the rest of the section is read where
  // it is (before, a 64-bit memory's limits were left unread and the next entry read from the middle
  // of them); a flag beyond the three WebAssembly defines (max, shared, 64-bit) is refused.
  const limits = () => {
    if (i >= b.length) fail('truncated limits');
    const flags = b[i++]!;
    if (flags > 0x07) fail('limits with unknown flags');
    const min = leb();
    const max = flags & 1 ? leb() : null;
    return { min, max, shared: !!(flags & 2), memory64: !!(flags & 4) };
  };
  const valtype = (): string => {
    const t = VALTYPES[b[i++]!];
    if (!t) fail('an unknown value type');
    return t!;
  };
  const out: WasmInspection = { imports: [], exports: [], memory: null, tables: 0, start: false, types: [] };
  let last = 0;
  while (i < b.length) {
    const id = b[i++]!;
    const size = leb();
    const end = i + size;
    if (end > b.length) fail('a section runs past the end');
    if (id !== 0) {
      // Sections in their order: 13 (tags) sits between memory and globals, 12 (data count) before code.
      const rank = id === 12 ? 9.5 : id === 13 ? 5.5 : id;
      if (rank <= last) fail('sections out of order or repeated');
      last = rank;
    }
    if (id === 1) {
      // 1.314 (EST-02): the function types, so an import's type index names a type.
      const n = leb();
      for (let k = 0; k < n; k++) {
        if (b[i++] !== 0x60) fail('a type that is not a function type');
        const params: string[] = [];
        const results: string[] = [];
        const np = leb();
        for (let j = 0; j < np; j++) params.push(valtype());
        const nr = leb();
        for (let j = 0; j < nr; j++) results.push(valtype());
        out.types.push({ params, results });
      }
    } else if (id === 2) {
      const n = leb();
      for (let k = 0; k < n; k++) {
        const module = str();
        const name = str();
        const kind = b[i++]!;
        if (kind > 4) fail('an import of an unknown kind');
        const im: WasmInspection['imports'][number] = { module, name, kind: KINDS[kind]! };
        if (kind === 0) {
          const t = out.types[leb()];
          if (t) im.type = t;
        }
        out.imports.push(im);
        if (kind === 1) { i++; limits(); out.tables++; }
        else if (kind === 2) { const l = limits(); out.memory = { imported: true, ...l }; }
        else if (kind === 3) {
          // 1.411 (INFO 3): a global import's type read as a whole value type: a number or v128; a
          // reference or any other type is refused (no EST module imports one), then its mutability.
          const t = valtype();
          if (t === 'funcref' || t === 'externref') fail('a global import of a reference type');
          if (i >= b.length || b[i]! > 1) fail('a global import of an unknown mutability');
          i++;
        }
        else if (kind === 4) { i++; leb(); }
      }
    } else if (id === 4) {
      const n = leb();
      for (let k = 0; k < n; k++) { i++; limits(); out.tables++; }
    } else if (id === 5) {
      const n = leb();
      if (n > 1) fail('more than one memory', 'EST-W008');
      if (n === 1 && !out.memory) out.memory = { imported: false, ...limits() };
    } else if (id === 7) {
      const n = leb();
      for (let k = 0; k < n; k++) {
        const name = str();
        const kind = b[i++]!;
        if (kind > 4) fail('an export of an unknown kind');
        leb();
        out.exports.push({ name, kind: KINDS[kind]! });
      }
    } else if (id === 8) {
      out.start = true;
    } else if (id > 13) fail(`an unknown section ${id}`);
    if (i > end) fail('a section is longer than it says');
    i = end;
  }
  return out;
}

/**
 * Why a module may not run under EST (spec §3.1: the import allowlist, the export shape, the
 * memory within `limits.memoryPagesMax`), or null. The same rules the runtime enforces again when
 * it instantiates.
 */
export function moduleRefusal(w: WasmInspection, memoryPagesMax = DEFAULT_MEMORY_PAGES): string | null {
  return moduleRefusalOf(w, memoryPagesMax)?.message ?? null;
}

/**
 * 1.400 (P3): what usually puts a forbidden import in a module, for the imports a first plugin
 * trips on (AssemblyScript's runtime asks the host for them), or null for any other.
 * `EST-W004`'s message names it after the import.
 */
export function importHint(module: string, name: string): string | null {
  if (module !== 'env') return null;
  if (name === 'seed') return 'AssemblyScript\'s Math.random asks the host for a seed. Use a generator of your own seeded from a constant (an xorshift: the cookbook\'s drum-synth has one), so every render is the same';
  if (name === 'abort') return 'AssemblyScript\'s runtime reports a failed assertion through it. Keep the template\'s `abort` function and asconfig.json\'s "use": ["abort=assembly/index/abort"], which trap instead';
  if (name === 'trace' || name.startsWith('console.')) return 'that is AssemblyScript\'s console or trace. A plugin prints nothing: remove the call (est dev shows the meters and the parameters while it plays)';
  if (name === 'Date.now' || name === 'performance.now') return 'that is the clock. A plugin may not read the time: count samples instead (the sample rate comes to activate)';
  return null;
}

/** `moduleRefusal` with its rule (EST Phase 4: `EST-W003` to `EST-W010`). */
export function moduleRefusalOf(w: WasmInspection, memoryPagesMax = DEFAULT_MEMORY_PAGES): { rule: string; message: string } | null {
  for (const im of w.imports) {
    if (im.module !== 'wasi_snapshot_preview1' || im.kind !== 'function' || !(ALLOWED_WASI as readonly string[]).includes(im.name)) {
      const hint = importHint(im.module, im.name);
      return { rule: 'EST-W004', message: `the module imports ${im.module}.${im.name} (${im.kind}), which EST does not allow${hint ? `: ${hint}` : ''}` };
    }
  }
  // 1.314 (EST-02): the right names with the right types.
  const typed = wasiTypeRefusal(w);
  if (typed) return typed;
  const kinds = new Map(w.exports.map(e => [e.name, e.kind]));
  if (kinds.get('clap_entry') !== 'global') return { rule: 'EST-W003', message: 'the module does not export clap_entry as a global' };
  if (kinds.get('malloc') !== 'function' || kinds.get('free') !== 'function') return { rule: 'EST-W003', message: 'the module does not export malloc and free' };
  if (kinds.get('memory') !== 'memory') return { rule: 'EST-W003', message: 'the module does not export its memory' };
  if (w.exports.filter(e => e.kind === 'table').length !== 1 || w.tables !== 1) return { rule: 'EST-W005', message: 'the module must have and export exactly one table' };
  if (kinds.has('refuel') || kinds.has('fuel_left')) return { rule: 'EST-W006', message: 'the module already exports refuel or fuel_left (names the host\'s metering adds)' };
  const cap = Math.min(memoryPagesMax, HARD_MAX_MEMORY_PAGES);
  const m = w.memory;
  if (!m) return { rule: 'EST-W007', message: 'the module has no memory' };
  if (m.imported) return { rule: 'EST-W007', message: 'the module imports its memory; EST modules export theirs' };
  if (m.memory64) return { rule: 'EST-W008', message: 'the module has a 64-bit memory (EST 1.0 is wasm32 only)' };
  if (m.shared) return { rule: 'EST-W008', message: 'the module has a shared memory (EST 1.0 has no threads)' };
  if (m.min > cap) return { rule: 'EST-W009', message: `the module needs ${m.min} pages of memory, over its limit of ${cap}` };
  if (m.max === null) return { rule: 'EST-W010', message: `the module declares no memory maximum (EST needs one, at most ${cap} pages)` };
  if (m.max > cap) return { rule: 'EST-W009', message: `the module may grow to ${m.max} pages, over its limit of ${cap} (est.json's limits.memoryPagesMax)` };
  return null;
}

// --- The whole bundle -------------------------------------------------------------------------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

export interface EstBundle {
  /** The content hash: the SHA-256 of the archive (spec §2). */
  hash: string;
  bytes: number;
  manifest: EstManifest;
  info: EstManifestInfo;
  /** Every file by path (est.json included). */
  files: Map<string, Uint8Array>;
  module: Uint8Array;
  wasm: WasmInspection;
  /** EST Phase 3: the presets its index lists (empty without one). */
  presets: EstBundlePreset[];
}

/**
 * Read and check a bundle: the archive, the manifest, every file's hash and that every file is
 * listed, then the module's shape and the preset index (EST Phase 3). Nothing in it runs (whether
 * each preset loads is the conformance run's). Throws an `EstBundleError`.
 */
export async function readBundle(bytes: Uint8Array): Promise<EstBundle> {
  const entries = readStoredZip(bytes);
  const files = new Map(entries.map(e => [e.name, e.data]));
  const json = files.get('est.json');
  if (!json) return refuse('manifest', 'no est.json', 'EST-B010');
  if (json.length > 256 * 1024) refuse('size', 'est.json is over 256 KB', 'EST-B004', 'est.json');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch { raw = refuse('manifest', 'est.json is not valid JSON', 'EST-B010', 'est.json'); }
  const manifest = parseManifest(raw);
  const listed = new Map<string, string>([[manifest.module.path, manifest.module.sha256]]);
  if (manifest.ui) listed.set(manifest.ui.path, manifest.ui.sha256);
  for (const a of manifest.assets) {
    if (listed.has(a.path)) refuse('manifest', `est.json lists ${a.path} twice`, 'EST-B012', a.path);
    listed.set(a.path, a.sha256);
  }
  for (const name of files.keys()) {
    if (name !== 'est.json' && !listed.has(name)) refuse('manifest', `${name} is in the bundle but not in est.json (every file must be listed and hashed)`, 'EST-B011', name);
  }
  for (const [path, want] of listed) {
    const data = files.get(path);
    if (!data) refuse('manifest', `est.json lists ${path}, which is not in the bundle`, 'EST-B012', path);
    if (await sha256Hex(data!) !== want) refuse('hash', `${path} does not match its SHA-256 in est.json`, 'EST-B013', path);
  }
  const module = files.get(manifest.module.path)!;
  if (module.length !== manifest.module.bytes) refuse('hash', `module.wasm is ${module.length} bytes, not the ${manifest.module.bytes} est.json says`, 'EST-B013', manifest.module.path);
  const wasm = inspectWasm(module);
  const why = moduleRefusalOf(wasm, manifest.limits.memoryPagesMax);
  if (why) refuse('module', why.message, why.rule, manifest.module.path);
  if (manifest.presets && !listed.has(manifest.presets)) refuse('manifest', `est.json names ${manifest.presets} as its presets but does not list it`, 'EST-B012', manifest.presets);
  const presets = parsePresets(manifest, files);
  const info = manifestInfo(manifest);
  info.presets = presets.length;
  return { hash: await sha256Hex(bytes), bytes: bytes.length, manifest, info, files, module, wasm, presets };
}
