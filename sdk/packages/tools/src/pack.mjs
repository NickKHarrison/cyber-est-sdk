/**
 * @cyber-est/tools: packing (EST Phase 4, docs/est/EST_Phase4_Work_Order.md §1; moved here from
 * scripts/est-pack.mjs, which is now a thin wrapper writing the same bytes). Plain JavaScript (Node
 * 20, no build) so the repository's scripts and the TypeScript tools share one packer.
 *
 * The canonical archive the host's reader (`src/audio/est/install/bundle.ts`) accepts (spec §1,
 * §2): a ZIP of **stored** entries only, `est.json` first, then the module, then the UI page, then
 * every other file in name order; no directories, no extra fields, no comment, every time stamp
 * 1980-01-01 00:00, so the same files always give the same bytes and so the same content hash (the
 * SHA-256 of the archive, which names the bundle everywhere: `EstRef.hash`, `/est/b/<hash>/…`).
 *
 * `est.json` is completed from the files: `module.sha256` and `module.bytes`, `ui.sha256`, and
 * `assets` (every other file, each hashed), so a plugin's source manifest leaves them out.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EST_UI_FILE, referencesEstUi, withEstUi } from '../../ui/copyRule.mjs';

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Uint8Array} b */
export function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The DOS date of 1980-01-01 (day 1, month 1, year 0) and time 00:00:00. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

/**
 * A stored ZIP of `entries` in the order given (no sorting here: the order is the caller's).
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Uint8Array}
 */
export function storedZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 10, true); // version needed: 1.0 (stored)
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 10, true); // made by: MS-DOS (no Unix mode bits), version 1.0
    c.setUint16(6, 10, true);
    c.setUint16(8, 0, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, e.data.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); // extra
    c.setUint16(32, 0, true); // comment
    c.setUint16(34, 0, true); // disk
    c.setUint16(36, 0, true); // internal attributes
    c.setUint32(38, 0, true); // external attributes
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * @typedef {{ bytes: Uint8Array, hash: string, manifest: Record<string, any>, files: Record<string, Uint8Array> }} Packed
 */

/**
 * A canonical bundle from a source manifest and its files (every path relative, `/`-separated;
 * `module.wasm` required). Fills the manifest's hashes and asset list, then packs.
 * @param {Record<string, unknown>} manifest
 * @param {Record<string, Uint8Array>} files
 * @returns {Packed}
 */
export function packBundle(manifest, files) {
  const m = JSON.parse(JSON.stringify(manifest));
  const modulePath = m.module?.path ?? 'module.wasm';
  const mod = files[modulePath];
  if (!mod) throw new Error(`no ${modulePath}`);
  m.module = { path: modulePath, sha256: sha256(mod), bytes: mod.length };
  const uiPath = m.ui?.path;
  if (uiPath) {
    if (!files[uiPath]) throw new Error(`no ${uiPath}`);
    m.ui = { ...m.ui, sha256: sha256(files[uiPath]) };
  }
  const others = Object.keys(files).filter(f => f !== modulePath && f !== uiPath && f !== 'est.json').sort();
  m.assets = others.map(path => ({ path, sha256: sha256(files[path]) }));
  const json = new TextEncoder().encode(`${JSON.stringify(m, null, 2)}\n`);
  const order = [modulePath, ...(uiPath ? [uiPath] : []), ...others];
  const entries = [{ name: 'est.json', data: json }, ...order.map(name => ({ name, data: files[name] }))];
  const bytes = storedZip(entries);
  return { bytes, hash: sha256(bytes), manifest: m, files: { 'est.json': json, ...Object.fromEntries(order.map(n => [n, files[n]])) } };
}

/**
 * Every file under `dir`, as paths relative to `base` (`/`-separated, in name order).
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
export function walk(dir, base) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** The @cyber-est/ui script's name in a bundle (4-C's contract: one file, `ui/est-ui.js`, copied when a `ui/` page names it). */
export const EST_UI_SCRIPT = 'est-ui.js';
/** Where @cyber-est/ui's build writes its compiled script, from this repository (`sdk/packages/ui/copyRule.mjs`, the one copy rule). */
export const EST_UI_DIST = EST_UI_FILE;

/**
 * The files of a plugin folder as `pack` takes them, and its source manifest:
 * - `est.json` (the source manifest);
 * - the module, from `opts.module` (a path on disk), else the manifest's `module.path` in `dir`;
 * - `ui/**` when the manifest has a `ui` (and, when a page directly in `ui/` loads `est-ui.js`,
 *   @cyber-est/ui's compiled script from `opts.estUi` or `EST_UI_DIST` as `ui/est-ui.js`, replacing any
 *   copy the sources had: `withEstUi`, 4-C's copy rule in `sdk/packages/ui/copyRule.mjs`);
 * - `presets/**` when it has `presets` (spec §6);
 * - `LICENSE` from `dir`, else `opts.license` (a path) when it exists.
 * @param {string} dir
 * @param {{ module?: string, license?: string, estUi?: string }} [opts]
 * @returns {{ manifest: Record<string, any>, files: Record<string, Uint8Array> }}
 */
export function readPluginDir(dir, opts = {}) {
  const manifestPath = join(dir, 'est.json');
  if (!existsSync(manifestPath)) throw new Error(`no est.json in ${dir}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (err) { throw new Error(`${manifestPath} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, { cause: err }); }
  const modulePath = (manifest && typeof manifest === 'object' && manifest.module && typeof manifest.module.path === 'string') ? manifest.module.path : 'module.wasm';
  const wasm = opts.module ?? join(dir, modulePath);
  if (!existsSync(wasm)) throw new Error(`no module at ${wasm}: build the plugin first (est pack builds and packs)`);
  /** @type {Record<string, Uint8Array>} */
  const files = { [modulePath]: new Uint8Array(readFileSync(wasm)) };
  if (manifest.ui) {
    const uiDir = join(dir, 'ui');
    if (existsSync(uiDir)) for (const f of walk(uiDir, dir)) files[f] = new Uint8Array(readFileSync(join(dir, f)));
    const src = opts.estUi ?? EST_UI_DIST;
    if (referencesEstUi(files)) {
      if (!existsSync(src)) throw new Error(`the UI uses ${EST_UI_SCRIPT}, but @cyber-est/ui's script is not at ${src}: build @cyber-est/ui (node sdk/packages/ui/build.mjs)`);
      Object.assign(files, withEstUi(files, { library: new Uint8Array(readFileSync(src)) }).files);
    }
  }
  if (manifest.presets) {
    const presetsDir = join(dir, 'presets');
    if (existsSync(presetsDir)) for (const f of walk(presetsDir, dir)) files[f] = new Uint8Array(readFileSync(join(dir, f)));
  }
  const license = [join(dir, 'LICENSE'), opts.license].find(f => f && existsSync(f));
  if (license) files.LICENSE = new Uint8Array(readFileSync(license));
  return { manifest, files };
}

/**
 * Pack a plugin folder (`readPluginDir`, then `packBundle`).
 * @param {string} dir
 * @param {{ module?: string, license?: string, estUi?: string }} [opts]
 * @returns {Packed}
 */
export function packDir(dir, opts = {}) {
  const { manifest, files } = readPluginDir(dir, opts);
  return packBundle(manifest, files);
}
