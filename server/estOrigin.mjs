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
// https://cyber-audio.fly.dev), e.g. `http://localhost:*` in tests. 1.473: its callers pass the
// public origin and the origins still accepted during a move (PUBLIC_ORIGIN, PUBLIC_ORIGIN_ALSO:
// server/collab.mjs, server/estOriginServer.mjs `estAppAncestors`), so this file reads neither.
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
// 1.515: a sound pack's version (`packs/<id>/<version>/{pack.json, signature.json, files/<sha256>.pack}`)
// is immutable too; its `.pack` files are served as bytes (octet-stream, nosniff), never as a page.
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
//
// 1.625 (launch capacity; docs/releases/1.625.md): the files under `/est/b/` and `/est/v1/` are read
// through `o.files`, server/staticFiles.mjs' in-memory file cache made by the caller (`ORIGIN_CACHE`:
// a file of at most 8 MB and 64 MB in all held after its first read, a larger one or one past the
// budget streamed from disk as before; not imported here, so the SDK's dev host, which serves with
// this file, reads the disk each time as before), and a guarded page or script is guarded once per
// body read (`guardedOf`). Every
// file answer carries an **ETag** (a strong one from the bytes sent, or a weak one from the size and
// time when streamed) and answers `If-None-Match` with a 304 with the same headers and no body, so a
// client revalidating the index or the blocklist (the app's fetch uses `cache: 'no-cache'`: never
// older than the server's copy) costs a few hundred bytes. The `cyber-est` app, whose files are baked
// into its image, keeps a content-addressed file for the process's life (`estOriginHashed`); the app's
// in-process origin (tests, local development) checks a file's size and time on every request, so a
// file changed on the disk is served changed. A paid version's bytes carry no ETag and never answer
// 304 (`no-store`, served once with a ticket).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createDevUiStore, createUiCacheBudget, devUiKeysOf, readUpload, uiCacheMaxBytesOf } from './estDevUi.mjs';
import { FRAME_GUARD_JS, FRAME_GUARD_PATH, guardScript, injectFrameGuard } from './estFrameGuard.mjs';
import { FRAME_WRAP_HTML, FRAME_WRAP_RE, WRAP_HOST_RE, WRAP_REL_RE, wrapCsp } from './estFrameWrap.mjs';

/**
 * 1.625: what the plugin origin keeps in memory (server/staticFiles.mjs' options, passed by its
 * callers: server/estOriginServer.mjs, server/collab.mjs). 8 MB a file holds the
 * largest catalogue bundle (6.7 MB at 1.625); 64 MB in all holds every latest catalogue bundle (35 MB
 * for 70 plugins) and the windows' files that are opened, on a 512 MB machine with room to spare
 * (the release file's arithmetic). `recheckMs` is for the files that are not content addressed (the
 * index, the blocklist, their signatures, a plugin's meta.json) in the immutable mode.
 */
export const ORIGIN_CACHE = Object.freeze({ maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, recheckMs: 1000 });
/** 1.625: the frame guard's own ETag (it changes only with the code). */
const GUARD_BODY = Buffer.from(FRAME_GUARD_JS, 'utf8');
const WRAP_BODY = Buffer.from(FRAME_WRAP_HTML, 'utf8');

/**
 * 1.688: where the plugin origin reads releases (server/estOriginRelease.mjs' `source`).
 * 1.696: `manifestDir`, the active release's signed manifest and its `.sig`, served at `/est/release/`.
 * @typedef {{ registryDir(): string | null, bundleFile(hash: string, rel: string): string | null, manifestDir?: () => string | null }} EstOriginReleaseSource
 */

/** @type {WeakMap<Buffer, string>} */
const etags = new WeakMap();
/** 1.625: a strong ETag from a body's bytes, computed once per body. @param {Buffer} body */
export function etagOfBody(body) {
  let t = etags.get(body);
  if (!t) { t = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`; etags.set(body, t); }
  return t;
}
const GUARD_ETAG = etagOfBody(GUARD_BODY);

/**
 * 1.625: whether `If-None-Match` names `etag` (the weak comparison of RFC 9110 §13.1.2, or `*`).
 * @param {import('node:http').IncomingMessage} req @param {string} etag
 */
export function notModified(req, etag) {
  const raw = req.headers['if-none-match'];
  if (typeof raw !== 'string' || !raw) return false;
  const bare = (/** @type {string} */ t) => t.trim().replace(/^W\//, '');
  const want = bare(etag);
  return raw.split(',').some((t) => t.trim() === '*' || bare(t) === want);
}

/**
 * 1.625: whether a file is content addressed (every file under a bundle's hash in EST_ORIGIN_DIR, a
 * registry version's in EST_REGISTRY_DIR), for the caller's `isImmutable`.
 * @param {{ EST_ORIGIN_DIR?: string, EST_REGISTRY_DIR?: string }} env
 * @returns {(file: string) => boolean}
 */
export function estOriginHashed(env) {
  const dir = env.EST_ORIGIN_DIR ? path.resolve(env.EST_ORIGIN_DIR) : null;
  const registryDir = env.EST_REGISTRY_DIR ? path.resolve(env.EST_REGISTRY_DIR) : null;
  return (file) => {
    if (dir && file.startsWith(dir + path.sep)) return true;
    if (registryDir && file.startsWith(registryDir + path.sep)) return REGISTRY_VERSION_RE.test(path.relative(registryDir, file).split(path.sep).join('/'));
    return false;
  };
}

/**
 * 1.625: without `o.files`, the disk every time (as before 1.625): a file's size and time, its body streamed.
 * @type {{ lookup(file: string): Promise<{ file: { path: string, size: number, mtimeMs: number, body: Buffer | null } } | null>, bodyOf(v: { body: Buffer | null }): Promise<Buffer | null> }}
 */
const DISK_FILES = {
  lookup: (file) => new Promise((resolve) => {
    fs.stat(file, (err, st) => resolve(err || !st.isFile() ? null : { file: { path: file, size: st.size, mtimeMs: st.mtimeMs, body: null } }));
  }),
  bodyOf: async () => null,
};

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
  // 1.515: a sound pack's file (`packs/<id>/<version>/files/<sha256>.pack`), fetched by the app's server and hash-checked.
  '.pack': 'application/octet-stream',
};

/** 1.688: a served file's type: the table above, else a store release's picture or clip (`STORE_ASSET_MIME`). @param {string} ext */
const typeOf = (ext) => MIME[ext] ?? STORE_ASSET_MIME[ext];

/** Phase 5b: how long the registry's index, blocklist and meta.json may be cached (a version's files are immutable). */
export const REGISTRY_SHORT_CACHE = 'public, max-age=300';
const REGISTRY_RE = /^\/est\/v1\/(.+)$/;
/** 1.696: the active store release's signed manifest (shared/storeReleaseWeb.mjs `RELEASE_MANIFEST_PATH`), only while releases are followed. */
const RELEASE_MANIFEST_RE = /^\/est\/release\/(manifest\.json(?:\.sig)?)$/;
/** 1.696: revalidated every time (an ETag makes that a 304), so a new release is seen at the next look. */
export const RELEASE_MANIFEST_CACHE = 'no-cache';
/** A version's own files: content addressed by the index, so cached forever. */
const REGISTRY_VERSION_RE = /^(?:plugins\/[a-z0-9][a-z0-9.-]{1,118}[a-z0-9]\/\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?\/(?:bundle\.est|est\.json|signature\.json)|packs\/[a-z0-9][a-z0-9.-]{1,118}[a-z0-9]\/\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?\/(?:pack\.json|signature\.json|files\/[0-9a-f]{64}\.pack))$/;
/** 1.515: `.pack`, a sound pack's file (audio or JSON, never run: served as bytes with nosniff). */
const REGISTRY_EXT = new Set(['.json', '.sig', '.est', '.pack']);
/**
 * 1.688: a store release's pictures and clips (shared/storeRelease.mjs `storeAssetPath`), named by their
 * hash, so immutable; only at exactly that path (any other picture or clip under `/est/v1/` is a 404,
 * as before), and with these types only (never a page: the bundles' own MIME table is unchanged).
 */
const STORE_ASSET_RE = /^store\/(?:art\/[0-9a-f]{64}\.(webp|png|jpg)|demo\/[0-9a-f]{64}\.(mp3))$/;
const STORE_ASSET_MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };

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

/**
 * The manifest's `ui.path`, or null (no manifest, or no UI).
 *
 * The 2026-11-18 EST sandbox attack (stream C), closing the frame-wrapper parser mismatch
 * (EST_PUBLIC_GATES.md row 10, place 10; docs/security/pre-launch-review-4 finding 13): the page is
 * served **only** when the frame wrapper (server/estFrameWrap.mjs `WRAP_REL_RE`) would frame it, so
 * the serving authority and the wrapper agree on exactly one set of paths. Before, `uiPageOf` accepted
 * a `ui.path` the wrapper refuses — a dot-leading segment (`ui/.panel.html`) or a space — so the plugin
 * origin served the page (200, guarded) while its wrapper answered 404; the page was unreachable as a
 * frame (the app frames only the wrapper), so it was never exploitable, but it left a guarded page
 * served that nothing could open. `WRAP_REL_RE` already requires a `.html` ending, plain path segments,
 * no leading slash and no `..`/dot-leading segment, so this is strictly fail-closed.
 * @param {unknown} manifest
 */
export function uiPageOf(manifest) {
  const ui = manifest && typeof manifest === 'object' ? /** @type {{ ui?: { path?: unknown } }} */ (manifest).ui : null;
  const page = ui && typeof ui === 'object' && typeof ui.path === 'string' ? ui.path : null;
  return page && WRAP_REL_RE.test(page) ? page : null;
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
/**
 * 1.513 (EST Store Phase B, stream 9; DEV-C §2b): an allowed **community** version's own UI, on this
 * origin only: `/est/community/<sha256>` takes an upload with a community ticket (`k: 'community'`,
 * POST /account/est-community-ui on the app, minted only for a Reviewed or admin-allowed version the
 * account installed: server/estUiAllow.mjs), `/est/community/<sha256>/<path>` serves its files exactly
 * as `/est/dev/`'s (`pluginCsp`, the frame guard first, a page only as `ui.path` and only to a frame),
 * and the app frames only its wrapper, `/est/frame/community/<sha256>/<ui.path>`. Its own store, so
 * neither the developers' nor the Studio's uploads push it out, nor it theirs.
 */
const COMMUNITY_UPLOAD_RE = /^\/est\/community\/([0-9a-f]{64})$/;
const COMMUNITY_FILE_RE = /^\/est\/community\/([0-9a-f]{64})\/(.+)$/;
/**
 * 1.795 (D-64, stream 5): a **shared** plugin's own UI (a bundle a project the viewer can read names),
 * on this origin only: `/est/shared/<sha256>` takes an upload with a shared ticket (`k: 'shared'`,
 * POST /account/est-shared-ui on the app, minted only for an account that can read a project naming
 * the hash, signed with the project owner's tag), `/est/shared/<sha256>/<path>` serves its files exactly
 * as `/est/dev/`'s, and the app frames only its wrapper, `/est/frame/shared/<sha256>/<ui.path>`. Its own
 * store (so a viewer's opens never push the developers' out), sized as theirs.
 */
const SHARED_UPLOAD_RE = /^\/est\/shared\/([0-9a-f]{64})$/;
const SHARED_FILE_RE = /^\/est\/shared\/([0-9a-f]{64})\/(.+)$/;
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
 * @param {{ EST_ORIGIN_HOST?: string, EST_ORIGIN_DIR?: string, EST_REGISTRY_DIR?: string, EST_APP_ORIGIN?: string, APP_ORIGIN?: string, EST_DEV_UI_KEY?: string, EST_DEV_UI_PUBLIC_KEY?: string, EST_UI_CACHE_DIR?: string, EST_UI_CACHE_MAX_BYTES?: string }} env
 * @param {{ anyHost?: boolean, files?: typeof DISK_FILES, paidGate?: ReturnType<typeof import('./storeDelivery.mjs').createPaidGate> | null, release?: EstOriginReleaseSource | null }} [o] Phase 2 (2-B, D-29): `anyHost`, every request is the plugin
 *   1.625: `files`, where `/est/b/` and `/est/v1/` are read (server/staticFiles.mjs' `createStaticFiles`
 *   with `ORIGIN_CACHE`); none, the disk each time.
 *   origin's whatever its Host (server/estOriginServer.mjs, the `cyber-est` app, which is nothing else).
 *   1.514: `paidGate` (server/storeDelivery.mjs), a paid version's bundle bytes only with a store ticket;
 *   none, nothing is gated (no version is paid).
 *   1.688: `release` (server/estOriginRelease.mjs, only with STORE_RELEASES_OPEN): `/est/v1/` from the
 *   active store release's directory, read again at each request, and `/est/b/<sha256>/` from every
 *   release mirrored, then EST_ORIGIN_DIR (the image's baseline); none, the two directories as before.
 * @returns {null | { handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean, refuseUpgrade(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex): boolean, remembered(): { pages: number, idents: number } }}
 */
export function createEstOrigin(env, o = {}) {
  const rule = o.anyHost ? { any: true } : hostRule(env.EST_ORIGIN_HOST);
  if (!rule) return null;
  const dir = env.EST_ORIGIN_DIR ? path.resolve(env.EST_ORIGIN_DIR) : null;
  const baseRegistryDir = env.EST_REGISTRY_DIR ? path.resolve(env.EST_REGISTRY_DIR) : null;
  const release = o.release ?? null;
  /** 1.688: a bundle's file, from a mirrored release first (by its hash, never changed), else the baseline. @param {string} hash @param {string} rel */
  const bundleFile = (hash, rel) => {
    const mirrored = release ? release.bundleFile(hash, rel) : null;
    if (mirrored) return mirrored;
    if (!dir) return null;
    const root = path.join(dir, hash);
    const file = path.resolve(root, rel);
    return file.startsWith(root + path.sep) ? file : null;
  };
  const ancestors = String(env.EST_APP_ORIGIN || String(env.APP_ORIGIN ?? '').replace(/\/+$/, '') || DEFAULT_APP_ORIGIN).trim();
  const csp = pluginCsp(ancestors);
  const { verifyKey } = devUiKeysOf(env);
  // 1.795 (D-64): with `EST_UI_CACHE_DIR` (server/estOriginServer.mjs sets it: the machine's temporary
  // space) every UI store keeps its files on disk under one total cap, `EST_UI_CACHE_MAX_BYTES` (default
  // 2 GB), least recently used first; without it, in memory as before (the app's own copy, tests).
  const cacheDir = typeof env.EST_UI_CACHE_DIR === 'string' && env.EST_UI_CACHE_DIR.trim() ? env.EST_UI_CACHE_DIR.trim() : null;
  const budget = verifyKey && cacheDir ? createUiCacheBudget(uiCacheMaxBytesOf(env.EST_UI_CACHE_MAX_BYTES)) : null;
  const store = (kind) => (verifyKey ? createDevUiStore({ verifyKey, kind, dir: cacheDir, budget }) : null);
  const devUi = store('dev');
  const studioUi = store('studio');
  const communityUi = store('community');
  const sharedUi = store('shared');
  /** 1.314 (EST-04): each hash's UI page from its est.json, read once (null: none). @type {Map<string, string | null>} */
  const pages = new Map();
  const pageOf = (hash) => {
    if (pages.has(hash)) return pages.get(hash) ?? null;
    let page;
    const manifest = bundleFile(hash, 'est.json');
    try { page = manifest ? uiPageOf(JSON.parse(fs.readFileSync(manifest, 'utf8'))) : null; } catch { page = null; }
    // 1.688: with releases a hash not yet mirrored may arrive with the next one, so only a page read is kept.
    // 1.902 (the sandbox review, O-1): and never a miss at all. This origin takes requests from anyone,
    // with no account and no limit, and every unknown hash asked for was remembered for the process's
    // life (about 170 bytes each, measured): a few million requests filled the machine.
    if (page !== null) pages.set(hash, page);
    return page;
  };
  /**
   * The sandbox attack order (stream D): each hash's own id and version from its est.json, read once, for
   * the paid gate. `/est/b/` names a bundle by its hash alone, and a hash the paid list did not hold yet (a
   * new version of a paid plugin that reached this origin before the list did) was served openly; with
   * the id, 1.534's rule holds here too (a version of a paid id the list does not hold is refused).
   * @type {Map<string, { id?: string, version?: string }>}
   */
  const idents = new Map();
  const identOf = (hash) => {
    const had = idents.get(hash);
    if (had) return had;
    /** @type {{ id?: string, version?: string }} */
    let ident = {};
    let read = false;
    const manifest = bundleFile(hash, 'est.json');
    try {
      const m = manifest ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null;
      if (m && typeof m.id === 'string' && typeof m.version === 'string') { ident = { id: m.id, version: m.version }; read = true; }
    } catch { /* no manifest: the hash alone */ }
    // As `pageOf`: with releases a hash may arrive with the next one, so only a manifest read is kept.
    // 1.902 (O-1): never a miss (see `pageOf`).
    if (read) idents.set(hash, ident);
    return ident;
  };
  let uploadsInFlight = 0;
  const files = o.files ?? DISK_FILES;
  /** 1.625: a page or script with the guard, made once per body read. @type {WeakMap<Buffer, Buffer>} */
  const guarded = new WeakMap();
  /** @param {Buffer} raw @param {string} ext */
  const guardedOf = (raw, ext) => {
    let g = guarded.get(raw);
    if (!g) { g = ext === '.html' ? injectFrameGuard(raw) : guardScript(raw); guarded.set(raw, g); }
    return g;
  };
  const gate = o.paidGate ?? null;
  /** Answers carrying a paid version's bytes. @type {WeakSet<import('node:http').ServerResponse>} */
  const paidAnswers = new WeakSet();
  /** 1.514: a paid version's bytes without a good ticket: refused, `no-store`. @returns {boolean} whether it was refused */
  const gated = (req, res, what) => {
    if (!gate) return false;
    let u;
    try { u = new URL(req.url ?? '/', 'http://plugin.invalid'); } catch { refuse(res, 404); return true; }
    const r = gate.allow(u, what, { take: req.method !== 'HEAD' }); // 1.656: a HEAD never takes the ticket
    if (r.ok) { if (r.paid) paidAnswers.add(res); return false; }
    res.writeHead(r.status, { ...baseHeaders(), ...corsOf(req), 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(r.status === 404 ? 'Not found' : `Refused: ${r.why}`);
    return true;
  };
  /** The cache header of a file answer: `no-store` for a paid version's bytes (served once, with a ticket). */
  const cacheOf = (res, normal) => (paidAnswers.has(res) ? 'no-store' : normal);

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
    // 1.902 (the sandbox review, O-2): no DNS prefetch from a plugin's page. A lookup is not a fetch, so no CSP
    // directive names it, and a host name can carry a few dozen bytes of what a page knows to whoever runs the zone.
    'x-dns-prefetch-control': 'off',
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

  /**
   * 1.625: one file of `/est/b/` or `/est/v1/` (the caller checked its path and its rules): from
   * memory when held, else streamed; an ETag on every answer but a paid version's, and a 304 for a
   * matching `If-None-Match`. `guard`: a page or script, sent with the frame guard (always whole).
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   * @param {string} file @param {{ ext: string, cors: import('node:http').OutgoingHttpHeaders, cache: string, guard?: boolean }} how
   */
  const serveFile = async (req, res, file, how) => {
    let entry;
    try { entry = await files.lookup(file); } catch { entry = null; }
    if (!entry) { refuse(res, 404); return; }
    let body = await files.bodyOf(entry.file);
    if (how.guard) {
      if (!body) {
        try { body = await fs.promises.readFile(file); } catch { refuse(res, 404); return; }
      }
      body = guardedOf(body, how.ext);
    }
    const paid = paidAnswers.has(res);
    const etag = paid ? null : body ? etagOfBody(body) : `W/"${entry.file.size.toString(36)}-${Math.floor(entry.file.mtimeMs).toString(36)}"`;
    const headers = { ...baseHeaders(), ...how.cors, 'cache-control': cacheOf(res, how.cache), ...(etag ? { etag } : {}) };
    if (etag && notModified(req, etag)) { res.writeHead(304, headers); res.end(); return; }
    if (body) {
      res.writeHead(200, { ...headers, 'content-type': typeOf(how.ext), 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'content-type': typeOf(how.ext), 'content-length': entry.file.size });
    if (req.method === 'HEAD') { res.end(); return; }
    const rs = fs.createReadStream(file);
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
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
    // 1.628: a HEAD of the bundle's own page from anywhere: it carries no body, so it can never run as a
    // page, and it is the client's "already uploaded?" probe (src/audio/est/uiUrl.ts), a fetch, never a
    // frame; refused, every open of a window uploaded its whole bundle again.
    if (data && ext === '.html') data = (req.method === 'HEAD' ? m[2] === store.page(m[1]) : htmlAllowed(req, m[2], store.page(m[1]))) ? injectFrameGuard(data) : null;
    if (data && ext === '.svg' && !svgAllowed(req)) data = null;
    // The review of #449 (EST-03): every script with the guard at its head.
    if (data && SCRIPT_EXT.has(ext)) data = guardScript(data);
    if (!data) { res.writeHead(404, { ...baseHeaders(), ...cors, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end('Not found'); return; }
    res.writeHead(200, { ...baseHeaders(), ...cors, 'content-type': MIME[ext], 'content-length': data.length, 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  };

  /** Phase 5b: `/est/v1/<rel>`, a file of the signed registry (GET or HEAD, checked by the caller). */
  const registryRoute = (req, res, rel) => {
    // 1.688: the active release's directory, taken once here, so a switch mid-request finishes on this one.
    const registryDir = release ? release.registryDir() : baseRegistryDir;
    const ext = path.extname(rel).toLowerCase();
    const asset = STORE_ASSET_RE.test(rel);
    // 1.658: the registry's own 404 carries the CORS header (to an allowed app), so a probe from the app
    // tells this origin's "nothing published here" from a network that blocks it (src/audio/est/originReach.ts).
    const notFound = () => { res.writeHead(404, { ...baseHeaders(), ...corsOf(req), 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end('Not found'); };
    if (!registryDir || !(REGISTRY_EXT.has(ext) || asset) || rel.includes('\0') || rel.split('/').some(p => p === '' || p === '.' || p === '..')) { notFound(); return; }
    const file = path.resolve(registryDir, rel);
    if (!file.startsWith(registryDir + path.sep)) { notFound(); return; }
    // 1.514: a paid version's bundle only with a store ticket.
    const pv = /^plugins\/([^/]+)\/([^/]+)\/bundle\.est$/.exec(rel);
    if (pv && gated(req, res, { id: pv[1], version: pv[2] })) return;
    void serveFile(req, res, file, { ext, cors: corsOf(req), cache: asset || REGISTRY_VERSION_RE.test(rel) ? 'public, max-age=31536000, immutable' : REGISTRY_SHORT_CACHE }).catch(() => res.destroy()); // serveFile answers its own failures; this only ends a socket on a throw
  };

  /**
   * 1.413: `/est/frame/<b|dev|studio|community|shared>/<sha256>/<ui.path>` (1.513: `community`; 1.795: `shared`), the frame wrapper (server/estFrameWrap.mjs):
   * only for a UI page this origin would serve (the bundle's `ui.path`, to a frame, as `htmlAllowed`),
   * its CSP's `frame-src` exactly that page on the host the request named.
   */
  const wrapRoute = (req, res, m) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(res, 405); return; }
    const [, kind, hash, rel] = m;
    const page = kind === 'b' ? pageOf(hash) : kind === 'dev' ? devUi?.page(hash) ?? null : kind === 'community' ? communityUi?.page(hash) ?? null : kind === 'shared' ? sharedUi?.page(hash) ?? null : studioUi?.page(hash) ?? null;
    const host = hostOf(req.headers.host).full;
    if (!WRAP_REL_RE.test(rel) || !WRAP_HOST_RE.test(host) || !htmlAllowed(req, rel, page)) { refuse(res, 404); return; }
    const body = WRAP_BODY;
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
      if (communityUi && (COMMUNITY_UPLOAD_RE.test(pathname) || COMMUNITY_FILE_RE.test(pathname))) { devRoute(req, res, pathname, communityUi, COMMUNITY_UPLOAD_RE, COMMUNITY_FILE_RE); return true; }
      if (sharedUi && (SHARED_UPLOAD_RE.test(pathname) || SHARED_FILE_RE.test(pathname))) { devRoute(req, res, pathname, sharedUi, SHARED_UPLOAD_RE, SHARED_FILE_RE); return true; }
      req.resume();
      if (req.method !== 'GET' && req.method !== 'HEAD') { refuse(res, 405); return true; }
      // 1.314 (EST-03): the host's own guard, the first script of every page served here.
      if (pathname === FRAME_GUARD_PATH) {
        const headers = { ...baseHeaders(), 'cache-control': PAGE_CACHE, etag: GUARD_ETAG };
        if (notModified(req, GUARD_ETAG)) { res.writeHead(304, headers); res.end(); return true; }
        res.writeHead(200, { ...headers, 'content-type': MIME['.js'], 'content-length': GUARD_BODY.length });
        res.end(req.method === 'HEAD' ? undefined : GUARD_BODY);
        return true;
      }
      const reg = REGISTRY_RE.exec(pathname);
      if (reg) { registryRoute(req, res, reg[1]); return true; }
      // 1.696: `/est/release/manifest.json` and its `.sig` from the active release; closed (no release), a 404 as before.
      const rel = RELEASE_MANIFEST_RE.exec(pathname);
      if (rel) {
        const dir = release?.manifestDir?.() ?? null;
        if (!dir) { refuse(res, 404); return true; }
        void serveFile(req, res, path.join(dir, rel[1]), { ext: path.extname(rel[1]), cors: corsOf(req), cache: RELEASE_MANIFEST_CACHE }).catch(() => res.destroy()); // serveFile answers its own failures
        return true;
      }
      const m = PATH_RE.exec(pathname);
      const ext = m ? path.extname(m[2]).toLowerCase() : '';
      if (!m || !(ext in MIME) || m[2].includes('\0')) { refuse(res, 404); return true; }
      const file = bundleFile(m[1], m[2]);
      if (!file) { refuse(res, 404); return true; }
      // 1.314 (EST-04): a page only as the bundle's own (est.json's ui.path) and only to a frame.
      if (ext === '.html' && !htmlAllowed(req, m[2], pageOf(m[1]))) { refuse(res, 404); return true; }
      if (ext === '.svg' && !svgAllowed(req)) { refuse(res, 404); return true; }
      // 1.514: a paid version's archive and DSP module only with a store ticket.
      if ((ext === '.est' || ext === '.wasm') && gated(req, res, { hash: m[1], ...identOf(m[1]) })) return true;
      const origin = req.headers.origin;
      const cors = FETCHED.has(ext) && allowedOrigin(ancestors, typeof origin === 'string' ? origin : undefined)
        ? { 'access-control-allow-origin': /** @type {string} */ (origin), vary: 'Origin' }
        : FETCHED.has(ext) ? { vary: 'Origin' } : {};
      // 1.314 (EST-03): a page with the guard first, and (the review of #449) every script with the
      // guard at its head (the file under the hash is unchanged); 1.625: both from memory, guarded once.
      const guard = ext === '.html' || SCRIPT_EXT.has(ext);
      void serveFile(req, res, file, { ext, cors, cache: guard ? PAGE_CACHE : 'public, max-age=31536000, immutable', guard }).catch(() => res.destroy()); // as registryRoute's
      return true;
    },
    /** 1.902 (O-1): how many hashes' manifests are remembered (tests: an unknown hash is never one). */
    remembered: () => ({ pages: pages.size, idents: idents.size }),
    refuseUpgrade(req, socket) {
      if (!matches(req)) return false;
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    },
  };
}
