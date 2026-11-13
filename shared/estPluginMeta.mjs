// shared/estPluginMeta.mjs — DEV-D (1.323; Cyber_EST_Developers_Work_Order.md DEV-D §4): what a
// Community version's `meta.json` may carry beside its bundle: screenshots, links and the changelog.
// Shared by the SDK's publisher (`est publish --screenshots a.png b.png`, which also takes the changelog
// from CHANGELOG.md's top section), the app server's `POST /registry/meta` (server/estPublish.mjs) and
// the public plugin pages (server/pluginPages.mjs). Pure: no DOM, no Node API.
//
// - **Screenshots:** PNG or WebP only (sniffed from the bytes, `shared/imageUploads.mjs`' rule; never
//   SVG), at most `SCREENSHOT_MAX_BYTES` each and `SCREENSHOTS_MAX` a version, served from the registry.
// - **Links:** `homepage`, `source`, `support`: https URLs only (no credentials, at most 300 characters).
// - **Changelog:** plain text, at most `CHANGELOG_MAX_CHARS`; no bidirectional or zero-width characters
//   (refused, never cleaned, as every display text: shared/estCommunity.mjs `displayRefusal`).
// Display only: nothing here is trusted for an install, and the pages escape every character of it.
import { sniffImage } from './imageUploads.mjs';
import { imageSize, mediaSeconds, sniffTrailer, TRAILER_TYPES } from './storePageMedia.mjs'; // 1.521

/** The most screenshots a version may carry. */
export const SCREENSHOTS_MAX = 6;
/** The largest screenshot (bytes). */
export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
/** The screenshot types, each with its file extension. */
export const SCREENSHOT_TYPES = Object.freeze({ 'image/png': 'png', 'image/webp': 'webp' });
/** The longest changelog section kept (characters). */
export const CHANGELOG_MAX_CHARS = 4000;
/** The links a meta.json may name. */
export const META_LINKS = Object.freeze(['homepage', 'source', 'support']);
/** The largest `POST /registry/meta` body: six screenshots in base64, and the text. */
export const META_BODY_MAX_BYTES = Math.ceil(SCREENSHOTS_MAX * SCREENSHOT_MAX_BYTES * 4 / 3) + 64 * 1024;

const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/;
/** C0 and C1 controls (tab, newline and carriage return are taken out first: `controlIn`). */
const CONTROL = /\p{Cc}/u;
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Whether text has a control character other than a tab or a line break. @param {string} s */
const controlIn = (s) => CONTROL.test(s.replace(/[\t\n\r]/g, ''));

/**
 * The top section of a CHANGELOG.md: the text under its first `## ` heading up to the next one
 * (the heading's own words kept as the first line), trimmed; '' when it has none.
 * @param {string} md
 */
export function changelogTopSection(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^##\s+\S/.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##?\s+\S/.test(lines[i])) { end = i; break; }
  const head = lines[start].replace(/^##\s+/, '').trim();
  const body = lines.slice(start + 1, end).join('\n').trim();
  return (body ? `${head}\n${body}` : head).slice(0, CHANGELOG_MAX_CHARS);
}

/** An https URL kept as given (at most 300 characters, no user or password), else null. @param {unknown} raw */
export function linkValue(raw) {
  if (typeof raw !== 'string' || raw.length > 300 || INVISIBLE.test(raw) || controlIn(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  return u.href;
}

/**
 * Why a meta body cannot be kept, or null. `{ changelog?, links? }`: the text parts (the screenshots
 * are checked one by one with `screenshotRefusal`).
 * @param {{ changelog?: unknown, links?: unknown }} m
 */
export function metaTextRefusal(m) {
  if (m.changelog !== undefined) {
    if (typeof m.changelog !== 'string') return 'the changelog is not text';
    if (m.changelog.length > CHANGELOG_MAX_CHARS) return `the changelog is longer than ${CHANGELOG_MAX_CHARS} characters (only CHANGELOG.md's top section is sent)`;
    if (INVISIBLE.test(m.changelog)) return 'the changelog has an invisible or right-to-left control character (zero-width or bidirectional), which Cyber refuses';
    if (controlIn(m.changelog)) return 'the changelog has a control character';
  }
  if (m.links !== undefined) {
    if (!isObj(m.links)) return 'links is not an object';
    for (const [k, v] of Object.entries(m.links)) {
      if (!META_LINKS.includes(k)) return `links.${k} is not one of ${META_LINKS.join(', ')}`;
      if (!linkValue(v)) return `links.${k} is not an https address`;
    }
  }
  return null;
}

/**
 * Why `bytes` cannot be a screenshot, or null; `type` the sniffed type when it can.
 * @param {Uint8Array} bytes
 * @returns {{ why: string | null, type: keyof typeof SCREENSHOT_TYPES | null }}
 */
export function screenshotRefusal(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { why: 'a screenshot is empty', type: null };
  if (bytes.length > SCREENSHOT_MAX_BYTES) return { why: `a screenshot is larger than ${SCREENSHOT_MAX_BYTES / 1024 / 1024} MB`, type: null };
  const t = sniffImage(bytes);
  if (t !== 'image/png' && t !== 'image/webp') return { why: 'a screenshot must be a PNG or WebP image (its bytes say otherwise)', type: null };
  return { why: null, type: t };
}

/**
 * A stored meta.json read back for display: the fields kept, anything else dropped.
 * @param {unknown} raw
 * @returns {{ changelog: string, links: Record<string, string>, screenshots: string[] }}
 */
export function sanitisePluginMeta(raw) {
  /** @type {any} */
  const m = isObj(raw) ? raw : {};
  const changelog = typeof m.changelog === 'string' && !metaTextRefusal({ changelog: m.changelog }) ? m.changelog : '';
  /** @type {Record<string, string>} */
  const links = {};
  if (isObj(m.links)) for (const k of META_LINKS) { const v = linkValue(m.links[k]); if (v) links[k] = v; }
  const screenshots = Array.isArray(m.screenshots) ? m.screenshots.filter((s) => typeof s === 'string' && /^[1-6]\.(png|webp)$/.test(s)).slice(0, SCREENSHOTS_MAX) : [];
  return { changelog, links, screenshots };
}

// --- 1.521 (EST Store Phase C, stream 7): a store page's own look ------------------------------------
// The developer's banner, accent colour and layout, a trailer, and the page's own summary and
// screenshot (what an A/B test's variant A is). Phase B stream 1's page editor writes the same fields;
// until it lands they are kept by server/storePageLook.mjs and edited in the Store page tab. Display
// only, like everything here: the pages escape it and nothing in it is trusted for an install.

/** The banner's exact size (pixels), its largest file and its types. */
export const PAGE_BANNER_WIDTH = 1600;
export const PAGE_BANNER_HEIGHT = 500;
export const PAGE_BANNER_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_BANNER_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
/** A trailer, at most (seconds and bytes). */
export const PAGE_TRAILER_MAX_SECONDS = 60;
export const PAGE_TRAILER_MAX_BYTES = 20 * 1024 * 1024;
/** The page's own summary, at most (characters). */
export const PAGE_SUMMARY_MAX = 280;
/**
 * The twelve accents a page may take: the store's own colour tokens (styles.css, the dark scope the
 * store draws on), so a page stays within its design. `textOn` (src/lib/colourText.ts) picks the
 * text on a band of it; a test holds every one to 4.5:1 with that text and 3:1 against the card.
 */
export const PAGE_ACCENTS = Object.freeze([
  { id: 'plugin', label: 'Plugin pink', token: '--kind-plugin', hsl: '328 80% 68%' },
  { id: 'daw', label: 'DAW cyan', token: '--kind-daw', hsl: '188 85% 55%' },
  { id: 'editor', label: 'Editor amber', token: '--kind-editor', hsl: '38 95% 58%' },
  { id: 'game', label: 'Game violet', token: '--kind-game', hsl: '268 85% 74%' },
  { id: 'learning', label: 'Sound Lab green', token: '--kind-learning', hsl: '152 60% 52%' },
  { id: 'slides', label: 'Slides orange', token: '--kind-slides', hsl: '22 90% 60%' },
  { id: 'ok', label: 'Blue', token: '--status-ok', hsl: '205 90% 62%' },
  { id: 'warn', label: 'Yellow', token: '--status-warn', hsl: '48 100% 58%' },
  { id: 'alert', label: 'Red', token: '--status-alert', hsl: '18 100% 60%' },
  { id: 'accent', label: 'Cyber orange', token: '--cyber-accent', hsl: '36 100% 64%' },
  { id: 'teal', label: 'Teal', token: '--cyber-accent-2', hsl: '172 66% 50%' },
  { id: 'silver', label: 'Silver', token: '--muted-foreground', hsl: '220 12% 72%' },
]);
export const PAGE_ACCENT_IDS = Object.freeze(PAGE_ACCENTS.map((a) => a.id));
/** The three layouts, each within the store's design. */
export const PAGE_TEMPLATES = Object.freeze([
  { id: 'standard', label: 'Standard', note: 'The banner across the top, the trailer beside the screenshot.' },
  { id: 'showcase', label: 'Showcase', note: 'A tall banner, then the trailer full width.' },
  { id: 'compact', label: 'Compact', note: 'A slim banner strip; the trailer and screenshot side by side.' },
]);
export const PAGE_TEMPLATE_IDS = Object.freeze(PAGE_TEMPLATES.map((t) => t.id));

/**
 * Why `bytes` cannot be a banner, or null; with its sniffed type when it can.
 * @param {Uint8Array} bytes
 * @returns {{ why: string | null, type: keyof typeof PAGE_BANNER_TYPES | null }}
 */
export function bannerRefusal(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { why: 'The banner is empty.', type: null };
  if (bytes.length > PAGE_BANNER_MAX_BYTES) return { why: 'The banner is larger than 2 MB.', type: null };
  const t = sniffImage(bytes);
  if (t !== 'image/png' && t !== 'image/jpeg' && t !== 'image/webp') return { why: 'The banner must be a PNG, JPEG or WebP image (its bytes say otherwise).', type: null };
  const size = imageSize(bytes);
  if (!size) return { why: 'Cyber could not read the banner\'s size.', type: null };
  if (size.width !== PAGE_BANNER_WIDTH || size.height !== PAGE_BANNER_HEIGHT) return { why: `The banner must be exactly ${PAGE_BANNER_WIDTH} × ${PAGE_BANNER_HEIGHT} pixels; this one is ${size.width} × ${size.height}.`, type: null };
  return { why: null, type: t };
}

/**
 * Why `bytes` cannot be a trailer, or null; with its kind, type and length when it can.
 * @param {Uint8Array} bytes
 * @returns {{ why: string | null, kind: 'audio' | 'video' | null, type: keyof typeof TRAILER_TYPES | null, seconds: number }}
 */
export function trailerRefusal(bytes) {
  const no = (why) => ({ why, kind: null, type: null, seconds: 0 });
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return no('The trailer is empty.');
  if (bytes.length > PAGE_TRAILER_MAX_BYTES) return no('The trailer is larger than 20 MB.');
  const s = sniffTrailer(bytes);
  if (!s) return no('The trailer must be audio (WAV, MP3, M4A or WebM) or a video (MP4 or WebM); its bytes are neither.');
  const seconds = mediaSeconds(bytes, s.type);
  if (seconds === null) return no('Cyber could not read how long the trailer is. Save it again with its length in the file.');
  if (seconds > PAGE_TRAILER_MAX_SECONDS + 0.05) return no(`The trailer is ${Math.round(seconds)} s long; it may be at most ${PAGE_TRAILER_MAX_SECONDS} s.`);
  return { why: null, kind: s.kind, type: s.type, seconds: Math.round(seconds * 10) / 10 };
}

/** Why a page summary cannot be kept, or null. @param {unknown} s */
export function pageSummaryRefusal(s) {
  if (typeof s !== 'string') return 'The summary is not text.';
  if ([...s].length > PAGE_SUMMARY_MAX) return `The summary is longer than ${PAGE_SUMMARY_MAX} characters.`;
  if (INVISIBLE.test(s)) return 'The summary has an invisible or right-to-left control character, which Cyber refuses.';
  if (CONTROL.test(s)) return 'The summary has a control character.';
  return null;
}

const FILE_RE = /^[0-9a-f]{64}\.(png|jpg|webp|wav|mp3|m4a|weba|mp4|webm)$/;
const fileOf = (v) => (typeof v === 'string' && FILE_RE.test(v) ? v : null);

/**
 * A stored page look read back: the fields kept, anything else dropped (absent: the store's own look).
 * @param {unknown} raw
 * @returns {{ accent: string | null, template: string, summary: string, banner: string | null, screenshot: string | null,
 *   trailer: { file: string, kind: 'audio' | 'video', type: string, seconds: number } | null }}
 */
export function sanitisePageLook(raw) {
  /** @type {any} */
  const m = isObj(raw) ? raw : {};
  const t = isObj(m.trailer) ? m.trailer : null;
  const tt = t && Object.prototype.hasOwnProperty.call(TRAILER_TYPES, t.type) ? TRAILER_TYPES[/** @type {keyof typeof TRAILER_TYPES} */ (t.type)] : null;
  return {
    accent: PAGE_ACCENT_IDS.includes(m.accent) ? m.accent : null,
    template: PAGE_TEMPLATE_IDS.includes(m.template) ? m.template : 'standard',
    summary: typeof m.summary === 'string' && !pageSummaryRefusal(m.summary) ? m.summary : '',
    banner: fileOf(m.banner),
    screenshot: fileOf(m.screenshot),
    trailer: t && tt && fileOf(t.file) && t.file.endsWith(`.${tt.ext}`) && Number.isFinite(t.seconds) && t.seconds > 0 && t.seconds <= PAGE_TRAILER_MAX_SECONDS + 0.05
      ? { file: t.file, kind: tt.kind === 'video' ? 'video' : 'audio', type: t.type, seconds: t.seconds } : null,
  };
}
