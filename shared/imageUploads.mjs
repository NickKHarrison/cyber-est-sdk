// shared/imageUploads.mjs — image uploads (SC, Cyber_Slides_Canvas_Work_Order.md §3): the one rule for
// which images an upload may be, read by the server's registration and file GET (server/workspace.mjs)
// and by the client's upload and the SLIDES image block (src/workspace/uploads.ts, src/slides/blocks/image/).
// PNG, JPEG, WebP and GIF only: never SVG (it can carry scripts).

/** The image types an upload may be, each with its format word (the record's `format`). */
export const IMAGE_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif' });
/** The `accept` of an image file input. */
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(',');
/** The largest image upload (bytes), on the client and the server. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** An image's width or height is a whole number from 1 to this (pixels), or unknown. */
export const MAX_IMAGE_SIDE = 16384;

const EXT_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' });

/**
 * An image type from a file's first bytes (16 are enough), or null when they are none of the four.
 * @param {Uint8Array} b
 * @returns {keyof typeof IMAGE_TYPES | null}
 */
export function sniffImage(b) {
  const at = (i, s) => {
    if (b.length < i + s.length) return false;
    for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
    return true;
  };
  if (at(0, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  return null;
}

/**
 * The image type a file says it is (its type, or by its name's extension when the browser gives
 * no type), or null when it is not one of the four (an SVG, audio, anything else).
 * @param {{ name: string, type: string }} f
 * @returns {keyof typeof IMAGE_TYPES | null}
 */
export function imageTypeOf(f) {
  const t = String(f.type ?? '').toLowerCase();
  if (t) return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, t) ? /** @type {keyof typeof IMAGE_TYPES} */ (t) : null;
  const ext = /\.([a-z0-9]+)$/i.exec(String(f.name ?? ''))?.[1]?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(EXT_TYPES, ext) ? EXT_TYPES[/** @type {keyof typeof EXT_TYPES} */ (ext)] : null;
}

/**
 * A width or height as it is kept: a whole number from 1 to MAX_IMAGE_SIDE, else null.
 * @param {unknown} v
 * @returns {number | null}
 */
export function imageSide(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_IMAGE_SIDE ? v : null;
}
