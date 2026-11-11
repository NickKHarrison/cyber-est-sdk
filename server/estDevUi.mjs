// server/estDevUi.mjs — EST Phase 5a, stream 5-B (docs/est/EST_Phase5a_Work_Order.md §2, route 1;
// decision D-45): a developer-mode bundle's own UI in Cyber. Its files are only in the admin's
// browser (IndexedDB), so for the frame to load them from the **plugin origin** (the one place a
// plugin page may run: a sandboxed, opaque-origin document on another site, the Phase 1 probe's
// shape), the browser uploads the bundle there for the session:
//
// 1. The app (`createEstDevTickets`, POST /account/est-dev-ui): a signed-in admin, same-origin, names
//    a bundle hash; the app answers a **ticket**: `v1.<payload>.<signature>`, the payload
//    `{ h: <sha256>, exp: <ms>, n: <nonce> }` signed with Ed25519 (`EST_DEV_UI_KEY`, the app's private
//    key). Never the app's cookie: the plugin origin reads no cookie and sets none.
// 2. The plugin origin (`createEstDevStore`, in server/estOrigin.mjs): POST /est/dev/<sha256> with
//    the ticket in `X-Est-Dev-Ticket` and the whole `.est` as the body. It checks the signature with
//    the public key only (`EST_DEV_UI_PUBLIC_KEY`, or derived from the private key when the app and
//    the plugin origin are one server, as in tests), the expiry, that the ticket names this hash and
//    was never used, then that the body's SHA-256 **is** the hash (so the files are the bundle the
//    admin's device installed), reads the stored ZIP and keeps only the files under the UI page's
//    folder, **in memory**, for `DEV_UI_KEEP_MS` after their last use (a restart forgets them: the
//    client uploads again), within a per-bundle and a total size cap (the oldest go first).
// 3. GET/HEAD /est/dev/<sha256>/<path> serves them with exactly the `/est/b/` headers (the strict CSP
//    with `sandbox allow-scripts`, `frame-ancestors` the app, nosniff, no cookies), `no-store`.
//
// Without the keys configured nothing here is on: the app's route answers 404 `unavailable` and the
// plugin origin refuses POST (405), as before Phase 5a. The page's CSP gains nothing (its
// `connect-src` and `frame-src` already name the plugin origin, Phase 2).
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto';
import { json, readBody, readBytes, sameOrigin } from './http.mjs';

/** A ticket lives this long (one upload, right after it is asked for). */
export const DEV_UI_TICKET_MS = 2 * 60 * 1000;
/** The largest bundle the plugin origin takes for a developer UI. */
export const DEV_UI_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
/** The UI files of one bundle it keeps, at most. */
export const DEV_UI_MAX_UI_BYTES = 8 * 1024 * 1024;
/** Every developer UI it holds together, at most (the least recently used go first). */
export const DEV_UI_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** A bundle's UI is forgotten this long after it was last uploaded or served. */
export const DEV_UI_KEEP_MS = 12 * 60 * 60 * 1000;
/** The most entries a bundle may have (as the client's reader: BUNDLE_MAX_ENTRIES). */
const MAX_ENTRIES = 512;
const HASH_RE = /^[0-9a-f]{64}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A key from base64 DER (PKCS8 private, SPKI public) or PEM; null when unset; throws when malformed. */
function keyOf(raw, kind) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  /** @type {any} */
  const opts = v.startsWith('-----') ? { key: v, format: 'pem' } : { key: Buffer.from(v, 'base64'), format: 'der', type: kind === 'private' ? 'pkcs8' : 'spki' };
  const k = kind === 'private' ? createPrivateKey(opts) : createPublicKey(opts);
  if (k.asymmetricKeyType !== 'ed25519') throw new Error(`EST dev UI ${kind} key is not Ed25519`);
  return k;
}

/**
 * The developer-UI keys from the environment: `EST_DEV_UI_KEY` (the app's private key) and
 * `EST_DEV_UI_PUBLIC_KEY` (the plugin origin's; derived from the private one when only that is
 * set). A malformed key is warned about and treated as unset.
 * @param {{ EST_DEV_UI_KEY?: string, EST_DEV_UI_PUBLIC_KEY?: string }} env
 */
export function devUiKeysOf(env) {
  let signKey = null, verifyKey = null;
  try { signKey = keyOf(env.EST_DEV_UI_KEY, 'private'); } catch (err) { console.warn('[cyber] EST_DEV_UI_KEY ignored:', err?.message); }
  try { verifyKey = keyOf(env.EST_DEV_UI_PUBLIC_KEY, 'public'); } catch (err) { console.warn('[cyber] EST_DEV_UI_PUBLIC_KEY ignored:', err?.message); }
  if (!verifyKey && signKey) verifyKey = createPublicKey(signKey);
  return { signKey, verifyKey };
}

/** A ticket for one upload of bundle `hash`. */
export function signTicket(key, hash, now = Date.now(), kind = 'dev') {
  // 1.320 (DEV-B): a Plugin Studio ticket says so (`k: 'studio'`), and is good only on /est/studio/.
  const payload = b64url(JSON.stringify({ h: hash, exp: now + DEV_UI_TICKET_MS, n: randomBytes(16).toString('hex'), ...(kind === 'studio' ? { k: 'studio' } : {}) }));
  return `v1.${payload}.${b64url(edSign(null, Buffer.from(`v1.${payload}`), key))}`;
}

/**
 * A ticket checked: its signature, its shape, the hash it names and its expiry. `{ ok: true, nonce, exp }`
 * or `{ ok: false, why }`. (Whether it was used is the store's.)
 */
export function checkTicket(key, token, hash, now = Date.now(), kind = 'dev') {
  if (typeof token !== 'string' || token.length > 512) return { ok: false, why: 'no ticket' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, why: 'not a ticket' };
  let good;
  try { good = edVerify(null, Buffer.from(`v1.${parts[1]}`), key, Buffer.from(parts[2], 'base64url')); } catch { good = false; }
  if (!good) return { ok: false, why: 'a bad signature' };
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, why: 'not a ticket' }; }
  if (!p || typeof p !== 'object' || typeof p.h !== 'string' || typeof p.n !== 'string' || !Number.isFinite(p.exp)) return { ok: false, why: 'not a ticket' };
  if (p.h !== hash) return { ok: false, why: 'a ticket for another bundle' };
  // 1.320 (DEV-B): a developer ticket never opens the Studio's store, nor a Studio ticket the developer's.
  if ((p.k === 'studio' ? 'studio' : 'dev') !== kind) return { ok: false, why: 'a ticket for another kind of upload' };
  if (p.exp <= now) return { ok: false, why: 'an expired ticket' };
  if (p.exp > now + DEV_UI_TICKET_MS + 60_000) return { ok: false, why: 'not a ticket' };
  return { ok: true, nonce: p.n, exp: p.exp };
}

/** A path inside a bundle as the client's reader takes it (`pathRefusal` in src/audio/est/install/bundle.ts). */
function safePath(name) {
  if (!name || name.length > 255 || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.endsWith('/')) return false;
  return name.split('/').every((p) => p && p !== '.' && p !== '..');
}

/**
 * The entries of a `.est` (a ZIP of stored entries: spec §2), by its central directory. Throws on
 * anything else (a compressed entry, a bad offset, an unsafe name). Pure.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function readStoredEntries(buf) {
  const fail = (why) => { throw new Error(`not a stored .est: ${why}`); };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) fail('too many entries');
  if (cdOff + cdSize > eocd) fail('a bad central directory');
  const out = new Map();
  let at = cdOff;
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) fail('a bad central directory entry');
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
    if (method !== 0 || csize !== usize) fail(`${name} is not stored`);
    if (!safePath(name)) fail(`an unsafe name ${JSON.stringify(name)}`);
    if (out.has(name)) fail(`${name} twice`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) fail(`${name}'s local header`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > cdOff) fail(`${name} runs past its end`);
    out.set(name, buf.subarray(start, start + csize));
  }
  return out;
}

/**
 * The plugin origin's store of developer UIs (in memory).
 * 1.320 (DEV-B): `kind` `'studio'` is the Plugin Studio's store (/est/studio/), taking Studio tickets only.
 * @param {{ verifyKey: import('node:crypto').KeyObject, kind?: 'dev' | 'studio', now?: () => number, maxUiBytes?: number, maxTotalBytes?: number, keepMs?: number }} o
 */
export function createDevUiStore({ verifyKey, kind = 'dev', now = () => Date.now(), maxUiBytes = DEV_UI_MAX_UI_BYTES, maxTotalBytes = DEV_UI_MAX_TOTAL_BYTES, keepMs = DEV_UI_KEEP_MS }) {
  /** @type {Map<string, { files: Map<string, Buffer>, bytes: number, used: number, page: string }>} by hash, oldest use first */
  const bundles = new Map();
  /** Tickets used, by nonce, until they expire. */
  const used = new Map();
  let total = 0;

  const forget = (hash) => { const b = bundles.get(hash); if (b) { total -= b.bytes; bundles.delete(hash); } };
  const sweep = () => {
    const t = now();
    for (const [n, exp] of used) if (exp <= t) used.delete(n);
    for (const [h, b] of bundles) if (t - b.used > keepMs) forget(h);
  };
  const touch = (hash, b) => { b.used = now(); bundles.delete(hash); bundles.set(hash, b); };

  /** The ticket's check, before and after the body (1.314, EST-07: the route asks before reading). */
  const ticketOf = (hash, ticket) => {
    if (!HASH_RE.test(hash)) return { ok: false, status: 404, why: 'not found' };
    const t = checkTicket(verifyKey, ticket, hash, now(), kind);
    if (!t.ok) return { ok: false, status: 403, why: t.why };
    if (used.has(t.nonce)) return { ok: false, status: 403, why: 'a ticket already used' };
    return { ok: true, nonce: t.nonce, exp: t.exp };
  };

  return {
    /**
     * 1.314 (EST-07): the ticket alone, before the body is read: `{ ok: true }` or `{ ok: false, status, why }`.
     * Consumes nothing (the nonce is spent by `accept`).
     * @param {string} hash @param {unknown} ticket
     */
    checkTicketOnly(hash, ticket) {
      sweep();
      const t = ticketOf(hash, ticket);
      return t.ok ? { ok: true } : t;
    },
    /**
     * An upload: `{ ok: true, files }` (the UI files kept) or `{ ok: false, status, why }`.
     * @param {string} hash @param {unknown} ticket @param {Buffer} body
     */
    accept(hash, ticket, body) {
      sweep();
      const t = ticketOf(hash, ticket);
      if (!t.ok) return t;
      used.set(t.nonce, t.exp);
      if (createHash('sha256').update(body).digest('hex') !== hash) return { ok: false, status: 400, why: 'the bundle is not the one its hash names' };
      let entries;
      try { entries = readStoredEntries(body); } catch (err) { return { ok: false, status: 400, why: String(err?.message ?? err) }; }
      let manifest;
      try { manifest = JSON.parse(entries.get('est.json')?.toString('utf8') ?? ''); } catch { return { ok: false, status: 400, why: 'no readable est.json' }; }
      const page = manifest?.ui?.path;
      if (typeof page !== 'string' || !safePath(page) || !page.endsWith('.html') || !entries.has(page)) return { ok: false, status: 400, why: 'the bundle has no UI page' };
      const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
      const modulePath = typeof manifest?.module?.path === 'string' ? manifest.module.path : 'module.wasm';
      const files = new Map();
      let bytes = 0;
      for (const [name, data] of entries) {
        if (!name.startsWith(dir) || name === 'est.json' || name === modulePath) continue;
        bytes += data.length;
        files.set(name, Buffer.from(data)); // a copy: the upload's buffer is let go
      }
      if (bytes > maxUiBytes) return { ok: false, status: 413, why: `the UI is ${bytes} bytes, over ${maxUiBytes}` };
      forget(hash);
      while (total + bytes > maxTotalBytes && bundles.size) forget(bundles.keys().next().value);
      const b = { files, bytes, used: now(), page };
      bundles.set(hash, b);
      total += bytes;
      return { ok: true, files: [...files.keys()] };
    },
    /** 1.314 (EST-04): the bundle's own UI page (the manifest's `ui.path`), or null when it is not held. */
    page(hash) {
      const b = bundles.get(hash);
      return b ? b.page : null;
    },
    /** A kept file, or null. */
    file(hash, name) {
      sweep();
      const b = bundles.get(hash);
      const data = b?.files.get(name);
      if (!b || !data) return null;
      touch(hash, b);
      return data;
    },
    /** What it holds (tests). */
    stats: () => ({ bundles: bundles.size, bytes: total, tickets: used.size }),
  };
}

/**
 * The app's side: POST /account/est-dev-ui `{ hash }` → `{ ticket, url, expiresAt }` (a signed-in
 * admin, same-origin; D-41). 404 `unavailable` without a key or a plugin origin.
 * 1.325 (DEV-E §1): a verified developer's too (`devTools`, server/estDevTools.mjs), so Follow's build
 * shows its own UI and the frame reloads in place on a rebuild.
 * 1.422 (H2): any signed-in account's while the developers surface is open to it (`devTools.ownRefusal`),
 * so a plugin added from Home shows its own UI too.
 * @param {{ auth: ReturnType<typeof import('./auth.mjs').createAuth>, signKey: import('node:crypto').KeyObject | null, origin: string | null, now?: () => number, devTools?: { refusal(user: any): { status: number, error: string, code: string } | null, ownRefusal?(user: any): { status: number, error: string, code: string } | null }, holdsOwn?: ((sub: string, hash: string) => Promise<boolean> | boolean) | null }} o
 * `holdsOwn` (the security review of 1.412–1.435, S1): the library's own-bundle check, asked for an account Add a plugin lets in without developer tools.
 */
export function createEstDevTickets({ auth, signKey, origin, now = () => Date.now(), devTools = adminOnly(auth), holdsOwn = null }) {
  return {
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {URL} url */
    handle(req, res, url) {
      if (url.pathname !== '/account/est-dev-ui') return false;
      if (req.method !== 'POST') { req.resume(); res.writeHead(405).end(); return true; }
      if (!signKey || !origin) { req.resume(); json(res, 404, { error: 'A developer bundle\'s own UI is not set up on this server.', code: 'unavailable' }); return true; }
      if (!auth.enabled) { req.resume(); json(res, 404, { error: 'sign-in is not configured' }); return true; }
      const user = auth.userFromRequest(req);
      if (!user) { req.resume(); json(res, 401, { error: 'sign in first' }); return true; }
      const refused = devTools.ownRefusal ? devTools.ownRefusal(user) : devTools.refusal(user);
      if (refused) { req.resume(); json(res, refused.status, { error: refused.error, code: refused.code }); return true; }
      if (!sameOrigin(req)) { req.resume(); json(res, 403, { error: 'cross-origin request refused' }); return true; }
      readBody(req, 1024).then((text) => {
        let body = null;
        try { body = JSON.parse(text); } catch { /* bad JSON */ }
        const hash = body && typeof body === 'object' ? body.hash : null;
        if (typeof hash !== 'string' || !HASH_RE.test(hash)) { json(res, 400, { error: 'send { hash }' }); return; }
        // The security review of 1.412–1.435 (S1): an account let in only as Add a plugin's (no
        // developer tools: `refusal` still refuses it) gets a ticket only for a bundle it claimed or
        // holds as its own, so a ticket costs a claim within EST_ACCOUNT_LIMITS (its count, bytes and
        // hour) and the plugin origin's shared store holds only bundles their accounts installed.
        // Without it any signed-in account could mint unlimited tickets and fill that store.
        const ownOnly = !!devTools.ownRefusal && !!devTools.refusal(user);
        const go = () => {
          const t = now();
          json(res, 200, { ticket: signTicket(signKey, hash, t), url: `${origin}/est/dev/${hash}`, expiresAt: t + DEV_UI_TICKET_MS });
        };
        if (!ownOnly) { go(); return; }
        Promise.resolve(holdsOwn ? holdsOwn(String(user.sub), hash) : false).then((held) => {
          if (held) go();
          else json(res, 403, { error: 'Add the plugin first: its own page opens only for a plugin you added.', code: 'not-own' });
        }, (err) => {
          console.error('[est-dev-ui] could not read the library:', err?.message);
          if (!res.headersSent) json(res, 500, { error: 'check failed' });
        });
      }, () => { if (!res.headersSent) json(res, 413, { error: 'too large' }); });
      return true;
    },
  };
}

/**
 * Without `devTools`: admins only, as before DEV-E. Inline, so the plugin origin's image (Dockerfile.est,
 * which copies this file) needs no developer-store module.
 * @param {any} auth
 */
function adminOnly(auth) {
  return { refusal: (user) => (auth.isAdmin(user) ? null : { status: 403, error: 'Plugins are for admins for now.', code: 'admin' }) };
}

/** Read an upload's body (at most the cap: a larger one rejects). */
export const readUpload = (req) => readBytes(req, DEV_UI_MAX_BUNDLE_BYTES);
