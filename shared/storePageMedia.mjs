// shared/storePageMedia.mjs — 1.521 (EST Store Phase C, stream 7: store pages that sell): what a
// store page's own media are, read from their bytes. Pure: no DOM, no Node API. The server checks
// every upload with it (server/storePageLook.mjs, through shared/estPluginMeta.mjs' refusals) and the
// Store page tab checks a file with it before sending, so the words are the same on both sides.
//
// - `imageSize(bytes)`: a PNG's, JPEG's or WebP's width and height from its header (the banner must be
//   exactly 1600 × 500), or null.
// - `sniffTrailer(bytes)`: a trailer's kind and type, from its bytes only (never its name or the
//   browser's type): audio (WAV, MP3, M4A, WebM audio) or video (MP4, WebM). Anything else is null.
// - `mediaSeconds(bytes, type)`: how long it is, read from its own header (WAV's data and byte rate,
//   MP4's `mvhd`, WebM's Segment Info, MP3's Xing or Info frame count or its constant bit rate), or null
//   when the bytes do not say: such a trailer is refused, never guessed.

const ascii = (b, i, s) => {
  if (b.length < i + s.length) return false;
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * An image's width and height from its header (PNG, JPEG, WebP), or null.
 * @param {Uint8Array} b
 * @returns {{ width: number, height: number } | null}
 */
export function imageSize(b) {
  if (!(b instanceof Uint8Array)) return null;
  // PNG: the IHDR chunk is first.
  if (ascii(b, 0, '\x89PNG\r\n\x1a\n') && ascii(b, 12, 'IHDR') && b.length >= 24) return ok(u32be(b, 16), u32be(b, 20));
  // JPEG: the first start-of-frame marker (SOF0..SOF15, not DHT C4, JPG C8 or DAC CC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(b, i + 7), u16be(b, i + 5));
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: lossy (VP8 ), lossless (VP8L) or extended (VP8X).
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    if (ascii(b, 12, 'VP8 ') && b.length >= 30) return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
      const bits = u32le(b, 21);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(b, 12, 'VP8X') && b.length >= 30) return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}
const ok = (width, height) => (width > 0 && height > 0 ? { width, height } : null);

/** The trailer types, each with its file extension and kind. */
export const TRAILER_TYPES = Object.freeze({
  'audio/wav': { ext: 'wav', kind: 'audio' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio' },
  'audio/mp4': { ext: 'm4a', kind: 'audio' },
  'audio/webm': { ext: 'weba', kind: 'audio' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
});

/** Whether `needle` occurs in `b` (from `from`, at most `upTo` bytes in). */
function has(b, needle, from = 0, upTo = b.length) {
  const end = Math.min(b.length, upTo) - needle.length;
  outer: for (let i = from; i <= end; i++) {
    for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle.charCodeAt(k)) continue outer;
    return true;
  }
  return false;
}

/** The MP4 boxes under `start`..`end`, depth first, calling `fn(type, dataStart, end)`; containers are walked. */
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);
function walkMp4(b, start, end, fn, depth = 0) {
  let i = start;
  while (i + 8 <= end) {
    let size = u32be(b, i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    let head = 8;
    if (size === 1) {
      if (i + 16 > end) return;
      const hi = u32be(b, i + 8), lo = u32be(b, i + 12);
      size = hi * 2 ** 32 + lo;
      head = 16;
    } else if (size === 0) size = end - i;
    if (size < head) return;
    const boxEnd = Math.min(end, i + size);
    if (fn(type, i + head, boxEnd) === false) return;
    if (depth < 8 && MP4_CONTAINERS.has(type)) walkMp4(b, i + head, boxEnd, fn, depth + 1);
    i += size;
  }
}

/**
 * A trailer's kind and type from its bytes, or null when it is none Cyber takes.
 * @param {Uint8Array} b
 * @returns {{ kind: 'audio' | 'video', type: keyof typeof TRAILER_TYPES } | null}
 */
export function sniffTrailer(b) {
  if (!(b instanceof Uint8Array) || b.length < 12) return null;
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { kind: 'audio', type: 'audio/wav' };
  if (ascii(b, 4, 'ftyp')) {
    let video = false, sound = false;
    walkMp4(b, 0, b.length, (type, at, end) => {
      if (type === 'hdlr' && at + 12 <= end) {
        if (ascii(b, at + 8, 'vide')) video = true;
        if (ascii(b, at + 8, 'soun')) sound = true;
      }
      return true;
    });
    if (video) return { kind: 'video', type: 'video/mp4' };
    if (sound) return { kind: 'audio', type: 'audio/mp4' };
    return null;
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    if (!has(b, 'webm', 4, 64)) return null;
    // The codec ids name the tracks (in the first part of the file).
    const head = Math.min(b.length, 64 * 1024);
    if (has(b, 'V_VP8', 0, head) || has(b, 'V_VP9', 0, head) || has(b, 'V_AV1', 0, head)) return { kind: 'video', type: 'video/webm' };
    if (has(b, 'A_OPUS', 0, head) || has(b, 'A_VORBIS', 0, head)) return { kind: 'audio', type: 'audio/webm' };
    return null;
  }
  if (mp3Start(b) >= 0) return { kind: 'audio', type: 'audio/mpeg' };
  return null;
}

// --- How long -------------------------------------------------------------------------------------

function wavSeconds(b) {
  let i = 12;
  let byteRate = 0;
  while (i + 8 <= b.length) {
    const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = u32le(b, i + 4);
    if (id === 'fmt ' && i + 16 <= b.length) byteRate = u32le(b, i + 16);
    if (id === 'data') {
      if (!byteRate) return null;
      // A data chunk written with an unknown size (0 or past the file) is measured by the bytes there.
      const n = size > 0 && i + 8 + size <= b.length ? size : b.length - i - 8;
      return n / byteRate;
    }
    i += 8 + size + (size & 1);
  }
  return null;
}

function mp4Seconds(b) {
  /** @type {number | null} */
  let out = null;
  walkMp4(b, 0, b.length, (type, at, end) => {
    if (type !== 'mvhd' || at + 20 > end) return true;
    const v = b[at];
    if (v === 1 && at + 32 <= end) {
      const scale = u32be(b, at + 20);
      const dur = u32be(b, at + 24) * 2 ** 32 + u32be(b, at + 28);
      out = scale ? dur / scale : null;
    } else if (v === 0) {
      const scale = u32be(b, at + 12);
      const dur = u32be(b, at + 16);
      out = scale ? dur / scale : null;
    }
    return false;
  });
  return out;
}

/** An EBML size (a variable-length integer) at `i`: its length and value, or null. */
function vint(b, i) {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let v = first & (0xff >> len);
  for (let k = 1; k < len; k++) v = v * 256 + b[i + k];
  return { len, v };
}

function webmSeconds(b) {
  const head = Math.min(b.length, 256 * 1024);
  let scale = 1_000_000;
  /** @type {number | null} */
  let duration = null;
  for (let i = 0; i + 4 < head; i++) {
    // TimecodeScale (0x2AD7B1): an unsigned integer of nanoseconds per tick.
    if (b[i] === 0x2a && b[i + 1] === 0xd7 && b[i + 2] === 0xb1) {
      const s = vint(b, i + 3);
      if (s && s.v >= 1 && s.v <= 8) {
        let v = 0;
        for (let k = 0; k < s.v; k++) v = v * 256 + b[i + 3 + s.len + k];
        if (v > 0) scale = v;
      }
    }
    // Duration (0x4489): a 4- or 8-byte float of ticks.
    if (duration === null && b[i] === 0x44 && b[i + 1] === 0x89) {
      const s = vint(b, i + 2);
      if (s && (s.v === 4 || s.v === 8) && i + 2 + s.len + s.v <= b.length) {
        const view = new DataView(b.buffer, b.byteOffset + i + 2 + s.len, s.v);
        const d = s.v === 4 ? view.getFloat32(0) : view.getFloat64(0);
        if (Number.isFinite(d) && d > 0) duration = d;
      }
    }
  }
  return duration === null ? null : (duration * scale) / 1e9;
}

const MP3_BITRATES = {
  // [version 1, version 2 and 2.5] for layer III, kbit/s by index.
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** An MP3 frame header at `i`, or null (layer III only). */
function mp3Frame(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (b[i + 1] >> 1) & 3; // 1: layer III
  if (ver === 1 || layer !== 1) return null;
  const br = (b[i + 2] >> 4) & 15, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (br === 0 || br === 15 || sr === 3) return null;
  const kbps = MP3_BITRATES[ver === 3 ? 1 : 2][br];
  const rate = MP3_RATES[/** @type {0 | 2 | 3} */ (ver)][sr];
  const samples = ver === 3 ? 1152 : 576;
  const size = Math.floor((samples / 8) * (kbps * 1000) / rate) + pad;
  const mono = ((b[i + 3] >> 6) & 3) === 3;
  return { ver, kbps, rate, samples, size, mono };
}

/** Where the first MP3 frame starts (past an ID3v2 tag), or -1. Two frames in a row are required. */
function mp3Start(b) {
  let i = 0;
  if (ascii(b, 0, 'ID3') && b.length >= 10) i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  const end = Math.min(b.length - 4, i + 4096);
  for (; i <= end; i++) {
    const f = mp3Frame(b, i);
    if (!f) continue;
    if (i + f.size === b.length || mp3Frame(b, i + f.size)) return i;
  }
  return -1;
}

function mp3Seconds(b) {
  const at = mp3Start(b);
  if (at < 0) return null;
  const f = /** @type {NonNullable<ReturnType<typeof mp3Frame>>} */ (mp3Frame(b, at));
  // A Xing or Info frame (after the side information) gives the frame count of a VBR file.
  const side = f.ver === 3 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
  const x = at + 4 + side;
  if ((ascii(b, x, 'Xing') || ascii(b, x, 'Info')) && x + 12 <= b.length && (u32be(b, x + 4) & 1)) {
    const frames = u32be(b, x + 8);
    if (frames > 0) return (frames * f.samples) / f.rate;
  }
  // VBRI (Fraunhofer) sits 32 bytes after the header.
  if (ascii(b, at + 36, 'VBRI') && at + 54 <= b.length) {
    const frames = u32be(b, at + 50);
    if (frames > 0) return (frames * f.samples) / f.rate;
  }
  // A constant bit rate: the bytes from the first frame.
  return ((b.length - at) * 8) / (f.kbps * 1000);
}

/**
 * How long a trailer is (seconds), read from its own header, or null when the bytes do not say.
 * @param {Uint8Array} b @param {keyof typeof TRAILER_TYPES} type
 */
export function mediaSeconds(b, type) {
  if (!(b instanceof Uint8Array)) return null;
  let s = null;
  if (type === 'audio/wav') s = wavSeconds(b);
  else if (type === 'audio/mp4' || type === 'video/mp4') s = mp4Seconds(b);
  else if (type === 'audio/webm' || type === 'video/webm') s = webmSeconds(b);
  else if (type === 'audio/mpeg') s = mp3Seconds(b);
  return s !== null && Number.isFinite(s) && s > 0 ? s : null;
}
