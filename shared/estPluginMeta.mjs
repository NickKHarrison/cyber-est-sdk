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
