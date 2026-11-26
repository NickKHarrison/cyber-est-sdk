/**
 * 1.909: a zip written as a chat assistant's Python sandbox writes one (`zipfile.ZipFile(…,
 * ZIP_DEFLATED)` + `writestr`): each entry deflated, version 20, no extra field, no data descriptor;
 * or stored, as `ZIP_STORED` writes. `folder` puts every entry under one wrapping folder (with its
 * directory entry), as zipping a folder does. For the source `.est` tests only (Node: zlib).
 */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../shared/estStrictZip.mjs';

export interface PyZipOptions { deflate?: boolean; folder?: string }

export function pyZip(files: Record<string, string | Uint8Array>, o: PyZipOptions = {}): Uint8Array {
  const enc = new TextEncoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  if (o.folder) entries.push({ name: `${o.folder}/`, data: new Uint8Array(0) });
  for (const [p, v] of Object.entries(files)) entries.push({ name: o.folder ? `${o.folder}/${p}` : p, data: typeof v === 'string' ? enc.encode(v) : v });
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const method = o.deflate && e.data.length ? 8 : 0;
    const packed = method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true); lv.setUint32(22, e.data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30); local.set(packed, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 0x0314, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(38, (e.name.endsWith('/') ? 0o40775 : 0o100664) << 16 >>> 0, true); cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local); centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const b of [...locals, ...centrals, end]) { out.set(b, at); at += b.length; }
  return out;
}
