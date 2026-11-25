/**
 * 1.311 (LR-5, DAW-01): the one bounded zip reader, shared by the PowerPoint importer
 * (`src/slides/import/pptx/unzip.ts`, which wraps it with its own limits and words) and
 * `src/game/sounds/zipRead.ts` (Import Live Set packages, PAD programs and the game bank).
 * Pure: no DOM, no store, no imports; deflate goes through the platform's
 * `DecompressionStream('deflate-raw')` (in every browser, in a worker and in Node).
 *
 * It reads the central directory first and refuses the zip when its entries say they unpack to
 * more than `maxTotalUnpacked`, when there are more than `maxEntries`, or when one says it unpacks
 * to more than `maxRatio` times its packed size (past `ratioFloor`), or when the readable entries
 * together say more than `maxRatio` times the archive's own size: a zip bomb. An entry is then
 * unpacked only when asked for (`read`), as a stream that stops as soon as it passes the smaller of
 * what the entry said and the cap asked for, and the unpacked total is counted against
 * `maxTotalUnpacked` again as it goes (a directory that lied is caught there). No ZIP64, no
 * encryption (refused with words), stored and deflated entries only.
 *
 * Every refusal is a `BoundedZipError` with a `code` and a plain sentence that names no product;
 * a wrapper maps the code to its own words.
 */

export type BoundedZipCode = 'not-zip' | 'zip64' | 'encrypted' | 'bomb' | 'too-large' | 'damaged' | 'unsupported';

export class BoundedZipError extends Error {
  constructor(
    public readonly code: BoundedZipCode,
    message: string,
    /** The entry concerned, when one is (`encrypted`, `too-large`, a `damaged` entry, an `unsupported` method). */
    public readonly entry?: string,
    /** For `damaged`: what is wrong, as a phrase ("its directory is cut short"). */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'BoundedZipError';
  }
}

export interface BoundedZipLimits {
  /** The most entries the directory may name. */
  maxEntries: number;
  /** What every entry together may unpack to. */
  maxTotalUnpacked: number;
  /** An entry past `ratioFloor` bytes that says it unpacks to more than this times its packed size is a bomb. */
  maxRatio: number;
  ratioFloor: number;
  /** The default cap of `read` (absent: `maxTotalUnpacked`). */
  maxEntry?: number;
}

export interface ZipEntryInfo {
  name: string;
  method: number;
  packed: number;
  unpacked: number;
  /** Where its local header starts. */
  local: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const damaged = (detail: string, entry?: string) => new BoundedZipError('damaged', `The zip is damaged (${detail}).`, entry, detail);
const bomb = () => new BoundedZipError('bomb', 'This zip unpacks to far more than its size says it should, so it was not opened.');
const mb = (n: number) => `${Math.max(1, Math.round(n / 1024 / 1024))} MB`;

export class BoundedZip {
  readonly entries = new Map<string, ZipEntryInfo>();
  private unpackedSoFar = 0;

  constructor(private readonly bytes: Uint8Array, private readonly limits: BoundedZipLimits) {
    const b = bytes;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // The end of the central directory: the last 22 bytes, or earlier by a comment of up to 64 KiB.
    let eocd = -1;
    for (let o = b.length - 22; o >= Math.max(0, b.length - 22 - 0xffff); o--) {
      if (v.getUint32(o, true) === EOCD) { eocd = o; break; }
    }
    if (eocd < 0) throw new BoundedZipError('not-zip', 'This is not a zip file.');
    const count = v.getUint16(eocd + 10, true);
    const cdOffset = v.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new BoundedZipError('zip64', 'ZIP64 archives are not supported.');
    if (count > limits.maxEntries) throw new BoundedZipError('bomb', `The zip holds too many files (${count}; at most ${limits.maxEntries}).`);
    const dec = new TextDecoder();
    let total = 0;
    /** What the entries that can be read (their packed bytes inside the file) say they unpack to. */
    let readable = 0;
    let o = cdOffset;
    for (let i = 0; i < count; i++) {
      if (o + 46 > b.length || v.getUint32(o, true) !== CENTRAL) throw damaged('its directory is cut short');
      const flags = v.getUint16(o + 8, true);
      const method = v.getUint16(o + 10, true);
      const packed = v.getUint32(o + 20, true);
      const unpacked = v.getUint32(o + 24, true);
      const nameLen = v.getUint16(o + 28, true);
      const extraLen = v.getUint16(o + 30, true);
      const commentLen = v.getUint16(o + 32, true);
      const local = v.getUint32(o + 42, true);
      const name = dec.decode(b.subarray(o + 46, o + 46 + nameLen));
      o += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue; // a folder
      if (flags & 1) throw new BoundedZipError('encrypted', `"${name}" is encrypted.`, name);
      if (unpacked > limits.ratioFloor && unpacked > limits.maxRatio * Math.max(1, packed)) throw bomb();
      total += unpacked;
      if (total > limits.maxTotalUnpacked) throw bomb();
      if (packed <= b.length) readable += unpacked;
      // A name is a path as written; a lower-case alias serves readers whose names are case-insensitive (OOXML).
      const info: ZipEntryInfo = { name, method, packed, unpacked, local };
      this.entries.set(name, info);
      const lower = name.toLowerCase();
      if (!this.entries.has(lower)) this.entries.set(lower, info);
    }
    // The integrator's review of #446: the same ratio over the whole archive, so many entries each
    // just under `ratioFloor` cannot add up to a bomb. (An entry whose packed size runs past the
    // file can never be read, `read` says it is damaged, so it is not counted here.)
    if (readable > limits.ratioFloor && readable > limits.maxRatio * Math.max(1, b.length)) throw bomb();
  }

  /** The names the directory holds, as written (no folders, no lower-case aliases). */
  names(): string[] {
    const out: string[] = [];
    for (const [k, e] of this.entries) if (k === e.name) out.push(k);
    return out;
  }

  has(name: string): boolean {
    return this.entries.has(name) || this.entries.has(name.toLowerCase());
  }

  info(name: string): ZipEntryInfo | null {
    return this.entries.get(name) ?? this.entries.get(name.toLowerCase()) ?? null;
  }

  /**
   * Entry `name` unpacked, or null when the zip has none. Refused (`BoundedZipError`) past `cap`
   * bytes (`limits.maxEntry` by default) or the zip's total, or when it is damaged.
   */
  async read(name: string, cap = this.limits.maxEntry ?? this.limits.maxTotalUnpacked): Promise<Uint8Array | null> {
    const e = this.info(name);
    if (!e) return null;
    const b = this.bytes;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (e.local + 30 > b.length || v.getUint32(e.local, true) !== LOCAL) throw damaged(`"${e.name}" is not where its directory says`, e.name);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    if (start + e.packed > b.length) throw damaged(`"${e.name}" is cut short`, e.name);
    const raw = b.subarray(start, start + e.packed);
    if (e.unpacked > cap) throw new BoundedZipError('too-large', `"${e.name}" is too large to read (${mb(e.unpacked)}; at most ${mb(cap)}).`, e.name);
    const limit = Math.min(cap, e.unpacked);
    let out: Uint8Array;
    if (e.method === 0) out = raw.slice();
    else if (e.method === 8) out = await inflateBounded(raw, limit, e.name);
    else throw new BoundedZipError('unsupported', `"${e.name}" is compressed in a way this reader does not know (method ${e.method}).`, e.name);
    if (out.length > limit) throw bomb();
    this.unpackedSoFar += out.length;
    if (this.unpackedSoFar > this.limits.maxTotalUnpacked) throw bomb();
    return out;
  }

  /** Entry `name` as UTF-8 text (a BOM dropped), or null. */
  async text(name: string, cap?: number): Promise<string | null> {
    const bytes = await this.read(name, cap);
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  }
}

/** Raw deflate unpacked, stopping (and refusing as a zip bomb) as soon as it passes `limit` bytes. */
export async function inflateBounded(raw: Uint8Array, limit: number, entry?: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new BoundedZipError('unsupported', 'This browser cannot read a compressed zip: save it uncompressed (stored) and try again.');
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        throw bomb();
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof BoundedZipError) throw err;
    throw damaged(entry ? `"${entry}" does not unpack` : 'an entry does not unpack', entry);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
