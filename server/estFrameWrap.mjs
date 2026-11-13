// server/estFrameWrap.mjs — 1.413 (the second EST pre-review's self-navigation finding;
// EST_SECURITY_ARCHITECTURE.md §4): the plugin origin's **frame wrapper**, a fixed page Cyber wrote
// that holds every plugin UI frame.
//
// Why. A frame's own navigation (`location = …` in the plugin's script) is checked against the
// `frame-src` of the document that embeds the frame, not against the plugin page's own CSP, and the
// sandbox without `allow-top-navigation` stops only the top. When the app embedded the plugin page
// directly, a plugin could navigate its frame to any host in the app's `frame-src` (Google sign-in,
// YouTube, the plugin origin) with whatever it knew in the URL (measured in 1.411's probe). Now the
// app embeds this wrapper (`/est/frame/<b|dev|studio>/<sha256>/<ui.path>`) and the wrapper embeds the
// plugin page, so the plugin frame's navigations are checked against the wrapper's `frame-src`,
// which names exactly the one UI page (`wrapCsp`; its query may change, so the page may reload itself).
//
// What it is. No plugin bytes: one inline script (allowed by its SHA-256 alone), no network
// (`default-src 'none'`, `connect-src 'none'`), `frame-ancestors` the app only. Its script creates
// the inner `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer">` for the same
// path under `/est/<b|dev|studio>/`, passes on its own fragment with one change (the host origin `p`
// becomes this origin, where the inner page's messages now come from), and relays messages without
// reading them: from its parent (origin checked against the `p` the app wrote) only to the inner
// frame, from the inner frame only to its parent (targetOrigin that `p`). The inner page is served
// exactly as before (`estOrigin.mjs`: the frame guard first, only as the bundle's `ui.path`, only to
// a frame) and stays opaque (its own `sandbox allow-scripts`).
//
// Why the wrapper itself is not opaque (`sandbox allow-scripts allow-same-origin`, and the app's
// iframe the same): Chromium (153, measured) refuses any `frame-ancestors` list, `*` included, for a
// frame whose ancestor is an opaque document, so under an opaque wrapper the plugin page could keep
// no `frame-ancestors` at all and any site could frame it (EST-04). As this origin the wrapper
// matches the page's `frame-ancestors 'self'`. It is cross-origin to the app and to the opaque plugin
// page (neither can reach its realm), it runs only its hashed script, and no other document of this
// origin is ever non-opaque (every other response carries `sandbox allow-scripts`).

import { createHash } from 'node:crypto';

/** `/est/frame/<kind>/<sha256>/<path>`: the wrapper of the UI page at `/est/<kind>/<sha256>/<path>`. */
/** 1.513 (stream 9): and `community`, an allowed community version's UI (server/estUiAllow.mjs). */
export const FRAME_WRAP_RE = /^\/est\/frame\/(b|dev|studio|community)\/([0-9a-f]{64})\/(.+)$/;
/** A UI page path the wrapper takes: plain segments only, so its URL and its CSP path are the same text. */
export const WRAP_REL_RE = /^(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)*[A-Za-z0-9_~-][A-Za-z0-9._~-]*\.html$/;
/** A Host header the wrapper's CSP may name (a DNS name or IPv4, an optional port; nothing else). */
export const WRAP_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/;

/** The wrapper's one script (plain ES5; reads only its own address and fragment). */
export const FRAME_WRAP_JS = `(function () {
  'use strict';
  var hash = String(location.hash).replace(/^#/, '');
  var pm = /(?:^|&)p=([^&]*)/.exec(hash);
  var host = '';
  try { host = pm ? decodeURIComponent(pm[1]) : ''; } catch (e) { host = ''; }
  if (!/^https?:\\/\\/[^\\/?#]+$/.test(host)) host = '';
  var inner = document.createElement('iframe');
  inner.setAttribute('sandbox', 'allow-scripts');
  inner.setAttribute('allow', '');
  inner.setAttribute('referrerpolicy', 'no-referrer');
  inner.title = 'Plugin UI';
  var s = inner.style;
  s.border = '0'; s.display = 'block'; s.width = '100%'; s.height = '100%';
  var ds = document.documentElement.style, bs = document.body.style;
  ds.height = '100%'; ds.overflow = 'hidden'; bs.margin = '0'; bs.height = '100%'; bs.overflow = 'hidden';
  window.addEventListener('message', function (e) {
    var w = inner.contentWindow;
    if (!w || !host) return;
    if (e.source === w) { try { parent.postMessage(e.data, host); } catch (err) { /* not cloneable: dropped */ } return; }
    if (e.source === parent && e.origin === host) { try { w.postMessage(e.data, '*'); } catch (err) { /* dropped */ } }
  });
  if (host) {
    var frag = hash.replace(/(^|&)p=[^&]*/, '$1p=' + encodeURIComponent(location.origin));
    inner.src = location.pathname.replace(/^\\/est\\/frame\\//, '/est/') + '#' + frag;
  }
  document.body.appendChild(inner);
})();
`;

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
/** The CSP source of the wrapper's inline script. */
export const FRAME_WRAP_SCRIPT_HASH = `'sha256-${sha(FRAME_WRAP_JS)}'`;

/** The wrapper page (the same bytes for every plugin). */
export const FRAME_WRAP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Plugin UI</title></head><body><script>${FRAME_WRAP_JS}</script></body></html>`;

/**
 * The wrapper's CSP: nothing but its own script, and a frame of exactly `frameSrc` (a scheme-less
 * host-source with the UI page's path, so only that page, whatever its query, can load in it).
 * @param {string} ancestors the app's sources (`frame-ancestors`) @param {string} frameSrc `<host>/est/<kind>/<sha256>/<path>`
 */
export function wrapCsp(ancestors, frameSrc) {
  return [
    "default-src 'none'",
    `script-src ${FRAME_WRAP_SCRIPT_HASH}`,
    "style-src 'none'",
    "img-src 'none'",
    "connect-src 'none'",
    `frame-src ${frameSrc}`,
    "child-src 'none'",
    "worker-src 'none'",
    `frame-ancestors ${ancestors}`,
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts allow-same-origin',
  ].join('; ');
}
