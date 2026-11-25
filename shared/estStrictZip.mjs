/**
 * The one strict reader of an EST bundle's archive (spec §2: a ZIP of stored entries), shared by the
 * install pipeline (src/audio/est/install/bundle.ts, in the compiling Worker) and the server's stored
 * bundles (1.792, Cyber_EST_Shared_Plugins_Work_Order.md §3.3: server/workspace.mjs registers an
 * `application/x-est-bundle` upload only when its bytes pass this). The sandbox attack report's B2: the
 * server's lax `readStoredEntries` (server/estDevUi.mjs) is never used to accept a stored bundle.
 *
 * The rules: the end record exactly at the end (no comment, no trailing bytes), one disk, no ZIP64,
 * the central directory right before it, every entry stored (never compressed, encrypted or with a
 * data descriptor), its local header equal to its central entry and exactly where the previous entry
 * ended, its CRC-32 matching, no symbolic link, every path a plain relative path of allowed
 * characters, no path twice (case aside), `est.json` the first entry. Pure: no DOM, no Node.
 */

/** @typedef {'zip' | 'path' | 'symlink' | 'size' | 'manifest' | 'hash'} StrictZipRefusal */
/** @typedef {{ name: string, data: Uint8Array }} StrictZipEntry */
/**
 * @typedef {object} StrictZipOptions
 * @property {number} maxBytes the largest archive
 * @property {number} maxEntries the most entries
 * @property {(code: StrictZipRefusal, message: string, rule: string, where?: string | null) => never} [refuse] throws (default: an Error with `code`, `rule`, `where`)
 * @property {(b: Uint8Array) => number} [crc32] a faster CRC-32 (the server passes zlib's)
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 of `b` (the ZIP polynomial). @param {Uint8Array} b @returns {number} */
export function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = /** @type {number} */ (CRC_TABLE[(c ^ /** @type {number} */ (b[i])) & 0xff]) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Why a path inside a bundle is not allowed, or null. @param {string} name @returns {string | null} */
export function pathRefusal(name) {
  if (!name || name.length > 255) return 'an empty or over-long path';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return `an absolute path (${name})`;
  if (name.includes('\\')) return `a backslash in a path (${name})`;
  for (const s of name.split('/')) {
    if (s === '..' || s === '.') return `a relative step in a path (${name})`;
    if (!SEGMENT.test(s)) return `a path with characters EST does not allow (${JSON.stringify(name)})`;
  }
  return null;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** @type {NonNullable<StrictZipOptions['refuse']>} */
const defaultRefuse = (code, message, rule, where = null) => {
  const err = /** @type {Error & { code: string, rule: string, where: string | null }} */ (new Error(message));
  err.code = code;
  err.rule = rule;
  err.where = where;
  throw err;
};

/**
 * The entries of a stored ZIP under the strict rules above (directories left out). Throws through
 * `o.refuse` (default: an Error carrying `code`, `rule` and `where`).
 * @param {Uint8Array} bytes @param {StrictZipOptions} o @returns {StrictZipEntry[]}
 */
export function readStrictZip(bytes, o) {
  const refuse = o.refuse ?? defaultRefuse;
  const crc = o.crc32 ?? crc32;
  if (bytes.length > o.maxBytes) refuse('size', `the bundle is ${bytes.length} bytes, over the limit of ${o.maxBytes}`, 'EST-B004');
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
  if (total > o.maxEntries) refuse('size', `${total} entries, over the limit of ${o.maxEntries}`, 'EST-B004');
  if (cdOffset + cdSize !== eocd) refuse('zip', 'bytes between the central directory and its end record', 'EST-B001');
  const dec = new TextDecoder('utf-8', { fatal: true });
  /** @type {StrictZipEntry[]} */
  const out = [];
  const seen = new Set();
  let at = cdOffset;
  let expect = 0;
  for (let i = 0; i < total; i++) {
    if (at + 46 > eocd || dv.getUint32(at, true) !== 0x02014b50) refuse('zip', 'a damaged central directory', 'EST-B003');
    const madeBy = dv.getUint16(at + 4, true);
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const crcWant = dv.getUint32(at + 16, true);
    const csize = dv.getUint32(at + 20, true);
    const usize = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen2 = dv.getUint16(at + 32, true);
    const external = dv.getUint32(at + 38, true);
    const offset = dv.getUint32(at + 42, true);
    if (at + 46 + nameLen + extraLen + commentLen2 > eocd) refuse('zip', 'a damaged central directory', 'EST-B003');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLen);
    /** @type {string} */
    let name = '';
    try { name = dec.decode(nameBytes); } catch { refuse('path', 'a path that is not UTF-8', 'EST-B005'); }
    at += 46 + nameLen + extraLen + commentLen2;
    // 1.902 (the sandbox review, Z-1): no extra field and no comment on an entry. Up to 65 535 bytes each
    // (and as many again in the local header) rode in an archive that passed every rule, unlisted and
    // unhashed (EST-B011 asks that every file be listed and hashed; "nothing hides in it"), and let one
    // set of files have any number of archives, each a new content hash. The kit's packer writes none.
    if (extraLen !== 0 || commentLen2 !== 0) refuse('zip', `${name} carries bytes outside its file (an extra field or a comment)`, 'EST-B002', name);
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
    if (lExtraLen !== 0) refuse('zip', `${name} carries bytes outside its file (an extra field in its local header)`, 'EST-B002', name);
    const lName = bytes.subarray(offset + 30, offset + 30 + lNameLen);
    if (lFlags !== flags || lMethod !== method || lCrc !== crcWant || lCsize !== csize || lUsize !== usize
      || lNameLen !== nameLen || !sameBytes(lName, nameBytes)) {
      refuse('zip', `${name}'s local header disagrees with the central directory`, 'EST-B003', name);
    }
    const start = offset + 30 + lNameLen + lExtraLen;
    const end = start + csize;
    if (end > cdOffset) refuse('zip', `${name} runs past the archive's data`, 'EST-B003', name);
    expect = end;
    const data = bytes.subarray(start, end);
    if (crc(data) !== crcWant) refuse('hash', `${name} does not match its CRC-32 (a damaged or altered bundle)`, 'EST-B009', name);
    if (name.endsWith('/')) {
      if (csize !== 0) refuse('zip', `the directory ${name} has data`, 'EST-B002', name);
      if (i === 0) refuse('manifest', 'est.json is not the first entry', 'EST-B008', name);
      const why = pathRefusal(name.slice(0, -1));
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
