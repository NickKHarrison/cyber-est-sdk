// EST's plugin origin (docs/est/EST_Phase1_Work_Order.md §2.2; decisions D-04, D-24;
// EST_SECURITY_ARCHITECTURE.md §4). Off unless EST_ORIGIN_HOST is set, so production is
// unchanged (Phase 1 sets it only in tests; Phase 2 adds the production hostname).
//
// When set, a request whose Host is that host is answered here and never reaches the app:
// only GET/HEAD of `/est/b/<sha256>/<path>`, a file under `<EST_ORIGIN_DIR>/<sha256>/`, with the
// plugin-origin headers (a strict CSP whose `sandbox allow-scripts` gives every document an opaque
// origin, `frame-ancestors` the app only, no cookies set or read, nosniff, CORP cross-origin for the
// bundle files the page fetches during install). Everything else on that host is a 404, the app's
// routes and its WebSocket rooms included. Files are addressed by content, so they are immutable.
//
// EST_ORIGIN_HOST: a host with a port (`127.0.0.1:4447`, matched exactly) or without one
// (`est.example.dev`, matched on any port). EST_ORIGIN_DIR: the folder of bundles by hash.
// EST_APP_ORIGIN: the CSP source list allowed to frame these pages (default APP_ORIGIN, else
// https://cyber-audio.fly.dev), e.g. `http://localhost:*` in tests.
//
// EST Phase 5a (5-B, D-45): with a developer-UI key (EST_DEV_UI_PUBLIC_KEY, or EST_DEV_UI_KEY when the
// app and this host are one server), also `/est/dev/<sha256>`: an admin's device POSTs a developer
// bundle with a ticket the app signed, and `/est/dev/<sha256>/<path>` serves its UI files from
// memory with the same headers (server/estDevUi.mjs). Without a key, POST stays a 405.
//
// EST Phase 5b (1.305, D-26, D-48; docs/est/EST_REGISTRY_ARCHITECTURE.md §1): with EST_REGISTRY_DIR (the
// `v1/` folder `est publish` writes, est-plugins/registry-dist/v1 on cyber-est), also GET/HEAD of
// `/est/v1/<path>`: the signed registry's static files, with the same headers and CORS for the app's
// page (it fetches them all). A version's files (`plugins/<id>/<version>/…`) never change, so they are
// immutable; the index, the blocklist, their signatures and a plugin's meta.json are cached briefly
// (`REGISTRY_SHORT_CACHE`), so a blocklist entry reaches hosts within minutes of a deploy.
//
// 1.314 (LR-8b stream B; EST-03, EST-04, EST-07): every `.html` served under `/est/b/` and `/est/dev/`
// carries the **frame guard** as its first script (`estFrameGuard.mjs`, served at
// `/est/frame-guard.js`: it removes WebRTC, which CSP cannot), and is served **only as the bundle's
// own UI page** (the manifest's `ui.path`, read once per hash from `<hash>/est.json`) and **only to
// a frame**: a request whose `Sec-Fetch-Dest` says it is not an `iframe`, or whose `Sec-Fetch-Site`
// is `same-origin` or `none` (a top-level navigation), is a 404, so a bundle's page cannot be opened
// as a Cyber-branded page of its own. A request without the `Sec-Fetch-*` headers (an older browser,
// a proxy that stripped them: whether Fly's does is unverified) falls back to the `ui.path` rule
// alone. A developer upload's ticket is checked **before** its body is read (at most two uploads in
// flight; a refusal closes the connection), so an unauthenticated POST never buffers 32 MB.
import fs from 'node:fs';
import path from 'node:path';
import { createDevUiStore, devUiKeysOf, readUpload } from './estDevUi.mjs';
import { FRAME_GUARD_JS, FRAME_GUARD_PATH, guardScript, injectFrameGuard } from './estFrameGuard.mjs';
import { FRAME_WRAP_HTML, FRAME_WRAP_RE, WRAP_HOST_RE, WRAP_REL_RE, wrapCsp } from './estFrameWrap.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  // Phase 2 (2-D's install): the bundle archive itself, fetched by the page and hash-checked.
  '.est': 'application/octet-stream',
  // Phase 5b: the registry's detached signatures (`index.sig`, `blocklist.sig`: JSON).
  '.sig': 'application/json',
};

/** Phase 5b: how long the registry's index, blocklist and meta.json may be cached (a version's files are immutable). */
export const REGISTRY_SHORT_CACHE = 'public, max-age=300';
const REGISTRY_RE = /^\/est\/v1\/(.+)$/;
/** A version's own files: content addressed by the index, so cached forever. */
const REGISTRY_VERSION_RE = /^plugins\/[a-z0-9][a-z0-9.-]{1,118}[a-z0-9]\/\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?\/(?:bundle\.est|est\.json|signature\.json)$/;
const REGISTRY_EXT = new Set(['.json', '.sig', '.est']);

/** Phase 2: the files the app's page reads with fetch() during an install (frames need no CORS). */
const FETCHED = new Set(['.est', '.json', '.wasm']);

/**
 * Whether `origin` (a request's Origin) is one of `ancestors`' sources: an exact origin, or a
 * `scheme://host:*` pattern matching any port of that host.
 * @param {string} ancestors @param {string | undefined} origin
 */
export function allowedOrigin(ancestors, origin) {
  if (!origin || origin === 'null') return false;
  return ancestors.split(/\s+/).filter(Boolean).some(src => {
    if (src.endsWith(':*')) {
      const base = src.slice(0, -2);
      return origin === base || (origin.startsWith(base + ':') && /^\d{1,5}$/.test(origin.slice(base.length + 1)));
    }
    return origin === src.replace(/\/+$/, '');
  });
}

const PATH_RE = /^\/est\/b\/([0-9a-f]{64})\/(.+)$/;
/** 1.314 (EST-07): developer uploads in flight at most; more are 503. */
export const DEV_UPLOADS_IN_FLIGHT = 2;
/** 1.314: how long a served page may be cached (it changes only with the guard). */
const PAGE_CACHE = 'public, max-age=3600';
/** The review of #449: the scripts served with the guard at their head (`guardScript`). */
const SCRIPT_EXT = new Set(['.js', '.mjs']);

/**
 * 1.314 (EST-04): whether a request for a `.html` may be answered. The page is the bundle's
 * `ui.path` (`page`, null when the bundle names none: nothing), and the fetch metadata, when the
 * browser sends it, says it is for a frame from another origin.
 * @param {import('node:http').IncomingMessage} req @param {string} rel @param {string | null} page
 */
export function htmlAllowed(req, rel, page) {
  if (!page || rel !== page) return false;
  const dest = req.headers['sec-fetch-dest'];
  if (typeof dest === 'string' && dest !== 'iframe' && dest !== 'frame') return false;
  const site = req.headers['sec-fetch-site'];
  // 1.413: `same-origin` from the frame wrapper (server/estFrameWrap.mjs), the one document of this
  // origin that is not opaque; a request with this metadata is a frame's, never a top-level page.
  if (typeof site === 'string' && site !== 'cross-site' && site !== 'same-site' && site !== 'same-origin') return false;
  return true;
}

/**
 * The review of #449: an `.svg` is a picture, never a page: refused to a navigation or an embedding
 * (`Sec-Fetch-Dest` document, iframe, frame, embed, object), where a script it named could run and a
 * Cyber-looking page could be drawn; served to an `<img>`, CSS and a fetch-metadata-less request.
 * @param {import('node:http').IncomingMessage} req
 */
export function svgAllowed(req) {
  const dest = req.headers['sec-fetch-dest'];
  return !(typeof dest === 'string' && ['document', 'iframe', 'frame', 'embed', 'object'].includes(dest));
}

/** The manifest's `ui.path`, or null (no manifest, or no UI). @param {unknown} manifest */
export function uiPageOf(manifest) {
  const ui = manifest && typeof manifest === 'object' ? /** @type {{ ui?: { path?: unknown } }} */ (manifest).ui : null;
  const page = ui && typeof ui === 'object' && typeof ui.path === 'string' ? ui.path : null;
  return page && page.endsWith('.html') && !page.includes('..') && !page.startsWith('/') ? page : null;
}
/** 5-B: a developer bundle's upload (`/est/dev/<sha256>`) and its UI files (`/est/dev/<sha256>/<path>`). */
const DEV_UPLOAD_RE = /^\/est\/dev\/([0-9a-f]{64})$/;
const DEV_FILE_RE = /^\/est\/dev\/([0-9a-f]{64})\/(.+)$/;
/**
 * 1.320 (DEV-B §2, EST-17 §3, gate 2): the Plugin Studio's generated UI, on this origin only:
 * `/est/studio/<sha256>` takes an upload with a Studio ticket (`k: 'studio'`, POST /studio/ui-ticket
 * on the app), `/est/studio/<sha256>/<path>` serves its files exactly as `/est/dev/`'s: `pluginCsp`
 * with `sandbox allow-scripts`, the EST-03 frame guard first in every page and script, a page only
 * as the bundle's `ui.path` and only to a frame. The app never serves `/est/studio/`.
 */
const STUDIO_UPLOAD_RE = /^\/est\/studio\/([0-9a-f]{64})$/;
const STUDIO_FILE_RE = /^\/est\/studio\/([0-9a-f]{64})\/(.+)$/;
const DEFAULT_APP_ORIGIN = 'https://cyber-audio.fly.dev';

/** The plugin origin's CSP (security document §4), framed only by `ancestors`. */
export function pluginCsp(ancestors) {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'none'",
    // The review of #449 (EST-03): no nested frame or worker of a plugin page (no plugin UI uses one).
    // `default-src 'none'` already refused a frame by URL; a srcdoc or about:blank child is not
    // refused by any of these (the guard at the head of every script covers that realm), and a
    // worker is a realm the guard does not need to reach once it cannot exist.
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    // Not `webrtc 'block'` (webrtc-pc's directive): Chromium 153 does not recognise it ("Unrecognized
    // Content-Security-Policy directive 'webrtc'" in every plugin page's console, the review of #449)
    // nor enforce it (STUN packets still sent under it), so the guard is the defence.
    // 1.413: and 'self', the frame wrapper (server/estFrameWrap.mjs): Chromium checks an opaque
    // ancestor by the origin it came from, so the wrapper is this origin. No other page of this
    // origin can frame one (every other page has `frame-src 'none'`).
    `frame-ancestors 'self' ${ancestors}`,
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts',
  ].join('; ');
}

/** @param {string | undefined} raw */
function hostRule(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  return v.includes(':') ? { exact: v } : { name: v };
}

/** @param {string | undefined} hostHeader */
function hostOf(hostHeader) {
  const v = String(hostHeader ?? '').trim().toLowerCase();
  const i = v.lastIndexOf(':');
  return { full: v, name: i > 0 && !v.endsWith(']') ? v.slice(0, i) : v };
}

/**
 * @param {{ EST_ORIGIN_HOST?: string, EST_ORIGIN_DIR?: string, EST_REGISTRY_DIR?: string, EST_APP_ORIGIN?: string, APP_ORIGIN?: string, EST_DEV_UI_KEY?: string, EST_DEV_UI_PUBLIC_KEY?: string }} env
 * @param {{ anyHost?: boolean }} [o] Phase 2 (2-B, D-29): `anyHost`, every request is the plugin
 *   origin's whatever its Host (server/estOriginServer.mjs, the `cyber-est` app, which is nothing else).
 * @returns {null | { handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean, refuseUpgrade(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex): boolean }}
 */
export function createEstOrigin(env, o = {}) {
  const rule = o.anyHost ? { any: true } : hostRule(env.EST_ORIGIN_HOST);
  if (!rule) return null;
  const dir = env.EST_ORIGIN_DIR ? path.resolve(env.EST_ORIGIN_DIR) : null;
  const registryDir = env.EST_REGISTRY_DIR ? path.resolve(env.EST_REGISTRY_DIR) : null;
  const ancestors = String(env.EST_APP_ORIGIN || String(env.APP_ORIGIN ?? '').replace(/\/+$/, '') || DEFAULT_APP_ORIGIN).trim();
  const csp = pluginCsp(ancestors);
  const { verifyKey } = devUiKeysOf(env);
  const devUi = verifyKey ? createDevUiStore({ verifyKey }) : null;
  const studioUi = verifyKey ? createDevUiStore({ verifyKey, kind: 'studio' }) : null;
  /** 1.314 (EST-04): each hash's UI page from its est.json, read once (null: none). @type {Map<string, string | null>} */
  const pages = new Map();
  const pageOf = (hash) => {
    if (pages.has(hash)) return pages.get(hash) ?? null;
    let page;
    try { page = dir ? uiPageOf(JSON.parse(fs.readFileSync(path.join(dir, hash, 'est.json'), 'utf8'))) : null; } catch { page = null; }
    pages.set(hash, page);
    return page;
  };
  let uploadsInFlight = 0;

  /** @param {import('node:http').IncomingMessage} req */
  const matches = (req) => {
    if ('any' in rule) return true;
    const h = hostOf(req.headers.host);
    return 'exact' in rule ? h.full === rule.exact : h.name === rule.name;
  };

  const baseHeaders = () => ({
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'cross-origin',
    'permissions-policy': 'camera=(), microphone=(), display-capture=(), geolocation=(), payment=(), usb=(), midi=()',
  });

  /** @param {import('node:http').ServerResponse} res @param {number} status */
  const refuse = (res, status) => {
    res.writeHead(status, { ...baseHeaders(), 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(status === 405 ? 'Method not allowed' : 'Not found');
  };

  /** CORS for the app's page (the upload, and the HEAD that asks whether a UI is here). */
  const corsOf = (req) => {
    const origin = req.headers.origin;
    return allowedOrigin(ancestors, typeof origin === 'string' ? origin : undefined) ? { 'access-control-allow-origin': /** @type {string} */ (origin), vary: 'Origin' } : { vary: 'Origin' };
  };

  /** 5-B: `/est/dev/…` (only with a key): OPTIONS and POST of an upload, GET and HEAD of its files. */
  const devRoute = (req, res, pathname, which = /** @type {NonNullable<typeof devUi>} */ (devUi), upRe = DEV_UPLOAD_RE, fileRe = DEV_FILE_RE) => {
    const up = upRe.exec(pathname);
    const cors = corsOf(req);
    if (up && req.method === 'OPTIONS') {
      req.resume();
      if (!cors['access-control-allow-origin']) { refuse(res, 403); return; }
      res.writeHead(204, {
        ...baseHeaders(), ...cors,
        'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, x-est-dev-ticket', 'access-control-max-age': '600',
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    if (up && req.method === 'POST') {
      const store = which;
      const json = (status, body, extra = {}) => {
        res.writeHead(status, { ...baseHeaders(), ...cors, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
        res.end(JSON.stringify(body));
      };
      // 1.314 (EST-07): a refusal before the body: answered, then the connection closed and the
      // request destroyed, so nothing of the body is read or kept.
      const early = (status, why) => {
        json(status, { error: why }, { connection: 'close' });
        res.once('finish', () => req.destroy());
      };
      if (!cors['access-control-allow-origin']) { early(403, 'origin refused'); return; }
      const ticket = req.headers['x-est-dev-ticket'];
      const t = store.checkTicketOnly(up[1], ticket);
      if (!t.ok) { early(t.status, t.why); return; }
      if (uploadsInFlight >= DEV_UPLOADS_IN_FLIGHT) { early(503, 'too many uploads at once: try again in a moment'); return; }
      uploadsInFlight++;
      readUpload(req).then((body) => {
        const r = store.accept(up[1], ticket, body);
        json(r.ok ? 200 : r.status, r.ok ? { files: r.files } : { error: r.why });
      }, () => {
        if (res.headersSent) return;
        json(413, { error: 'the bundle is too large' }, { connection: 'close' });
      }).finally(() => { uploadsInFlight--; });
      return;
    }
    req.resume();
    const m = fileRe.exec(pathname);
    if (!m) { refuse(res, 405); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(res, 405); return; }
    const ext = path.extname(m[2]).toLowerCase();
    const store = which;
    let data = ext in MIME ? store.file(m[1], m[2]) : null;
    // 1.314 (EST-04, EST-03): a page only as the bundle's own, to a frame, with the guard first.
    if (data && ext === '.html') data = htmlAllowed(req, m[2], store.page(m[1])) ? injectFrameGuard(data) : null;
    if (data && ext === '.svg' && !svgAllowed(req)) data = null;
    // The review of #449 (EST-03): every script with the guard at its head.
    if (data && SCRIPT_EXT.has(ext)) data = guardScript(data);
    if (!data) { res.writeHead(404, { ...baseHeaders(), ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end('Not found'); return; }
    res.writeHead(200, { ...baseHeaders(), ...cors, 'content-type': MIME[ext], 'content-length': data.length, 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  };

  /** Phase 5b: `/est/v1/<rel>`, a file of the signed registry (GET or HEAD, checked by the caller). */
  const registryRoute = (req, res, rel) => {
    const ext = path.extname(rel).toLowerCase();
    if (!registryDir || !REGISTRY_EXT.has(ext) || rel.includes('\0') || rel.split('/').some(p => p === '' || p === '.' || p === '..')) { refuse(res, 404); return; }
    const file = path.resolve(registryDir, rel);
    if (!file.startsWith(registryDir + path.sep)) { refuse(res, 404); return; }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) { refuse(res, 404); return; }
      res.writeHead(200, {
        ...baseHeaders(), ...corsOf(req),
        'content-type': MIME[ext], 'content-length': stat.size,
        'cache-control': REGISTRY_VERSION_RE.test(rel) ? 'public, max-age=31536000, immutable' : REGISTRY_SHORT_CACHE,
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const rs = fs.createReadStream(file);
      rs.on('error', () => res.destroy());
      res.on('close', () => rs.destroy());
      rs.pipe(res);
    });
  };

  /**
   * 1.413: `/est/frame/<b|dev|studio>/<sha256>/<ui.path>`, the frame wrapper (server/estFrameWrap.mjs):
   * only for a UI page this origin would serve (the bundle's `ui.path`, to a frame, as `htmlAllowed`),
   * its CSP's `frame-src` exactly that page on the host the request named.
   */
  const wrapRoute = (req, res, m) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(res, 405); return; }
    const [, kind, hash, rel] = m;
    const page = kind === 'b' ? pageOf(hash) : kind === 'dev' ? devUi?.page(hash) ?? null : studioUi?.page(hash) ?? null;
    const host = hostOf(req.headers.host).full;
    if (!WRAP_REL_RE.test(rel) || !WRAP_HOST_RE.test(host) || !htmlAllowed(req, rel, page)) { refuse(res, 404); return; }
    const body = Buffer.from(FRAME_WRAP_HTML, 'utf8');
    res.writeHead(200, {
      ...baseHeaders(),
      'content-security-policy': wrapCsp(ancestors, `${host}/est/${kind}/${hash}/${rel}`),
      'content-type': MIME['.html'], 'content-length': body.length, 'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  return {
    handle(req, res) {
      if (!matches(req)) return false;
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://plugin.invalid').pathname); } catch { req.resume(); refuse(res, 404); return true; }
      const wrap = FRAME_WRAP_RE.exec(pathname);
      if (wrap) { req.resume(); wrapRoute(req, res, wrap); return true; }
      if (devUi && (DEV_UPLOAD_RE.test(pathname) || DEV_FILE_RE.test(pathname))) { devRoute(req, res, pathname); return true; }
      if (studioUi && (STUDIO_UPLOAD_RE.test(pathname) || STUDIO_FILE_RE.test(pathname))) { devRoute(req, res, pathname, studioUi, STUDIO_UPLOAD_RE, STUDIO_FILE_RE); return true; }
      req.resume();
      if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(res, 405); return true; }
      // 1.314 (EST-03): the host's own guard, the first script of every page served here.
      if (pathname === FRAME_GUARD_PATH) {
        res.writeHead(200, { ...baseHeaders(), 'content-type': MIME['.js'], 'content-length': Buffer.byteLength(FRAME_GUARD_JS), 'cache-control': PAGE_CACHE });
        res.end(req.method === 'HEAD' ? undefined : FRAME_GUARD_JS);
        return true;
      }
      const reg = REGISTRY_RE.exec(pathname);
      if (reg) { registryRoute(req, res, reg[1]); return true; }
      const m = PATH_RE.exec(pathname);
      const ext = m ? path.extname(m[2]).toLowerCase() : '';
      if (!dir || !m || !(ext in MIME) || m[2].includes('\0')) { refuse(res, 404); return true; }
      const root = path.join(dir, m[1]);
      const file = path.resolve(root, m[2]);
      if (!file.startsWith(root + path.sep)) { refuse(res, 404); return true; }
      // 1.314 (EST-04): a page only as the bundle's own (est.json's ui.path) and only to a frame.
      if (ext === '.html' && !htmlAllowed(req, m[2], pageOf(m[1]))) { refuse(res, 404); return true; }
      if (ext === '.svg' && !svgAllowed(req)) { refuse(res, 404); return true; }
      fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { refuse(res, 404); return; }
        const origin = req.headers.origin;
        const cors = FETCHED.has(ext) && allowedOrigin(ancestors, typeof origin === 'string' ? origin : undefined)
          ? { 'access-control-allow-origin': /** @type {string} */ (origin), vary: 'Origin' }
          : FETCHED.has(ext) ? { vary: 'Origin' } : {};
        if (ext === '.html' || SCRIPT_EXT.has(ext)) {
          // 1.314 (EST-03): the page with the guard first, and (the review of #449) every script with
          // the guard at its head (the file under the hash is unchanged).
          fs.readFile(file, (e2, raw) => {
            if (e2) { refuse(res, 404); return; }
            const page = ext === '.html' ? injectFrameGuard(raw) : guardScript(raw);
            res.writeHead(200, { ...baseHeaders(), ...cors, 'content-type': MIME[ext], 'content-length': page.length, 'cache-control': PAGE_CACHE });
            res.end(req.method === 'HEAD' ? undefined : page);
          });
          return;
        }
        res.writeHead(200, {
          ...baseHeaders(),
          ...cors,
          'content-type': MIME[ext],
          'content-length': stat.size,
          'cache-control': 'public, max-age=31536000, immutable',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        const rs = fs.createReadStream(file);
        rs.on('error', () => res.destroy());
        res.on('close', () => rs.destroy());
        rs.pipe(res);
      });
      return true;
    },
    refuseUpgrade(req, socket) {
      if (!matches(req)) return false;
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    },
  };
}
