// @est/tools: publishing to Cyber as a developer (DEV-C, 1.322; Cyber_EST_Developers_Work_Order.md
// DEV-C §1–§2, §5; sdk/docs/publishing.md). Node only. `est login`, `est sign --developer`, `est
// publish <file.est>` and `est yank` (sdk/packages/cli) are command lines over it.
//
// - **The key is yours.** `est keygen --out ~/.est/developer-key.pem` makes it; you register only its
//   public half in Cyber (Settings → Plugins → Developer, or the key `est login` shows). The private
//   key never leaves your machine: nothing here sends it, and nothing reads it but `developerSignature`.
// - **The token is short-lived.** `est login` asks Cyber for a one-time code, you approve it in the
//   browser where you are signed in, and Cyber gives a token that publishes as you for one hour.
//   It is kept in `~/.est/session.json` (mode 600) until it expires; `est logout` deletes it.
// - **What you sign** is `{ id, version, contentHash, publishedAt }` (shared/estCommunity.mjs
//   `developerSignedBytes`): Cyber checks it when you publish, and every Cyber checks it again at
//   install against the key the registry lists for you, so nobody can publish bytes as you.
import { createHash, sign as edSign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { developerSigningInput } from '../../../../shared/estCommunity.mjs';
import { metaTextRefusal, screenshotRefusal, SCREENSHOTS_MAX } from '../../../../shared/estPluginMeta.mjs';
import { keyFacts, signingKeyOf } from './registry.mjs';

/** Where `est login` keeps the token (mode 600). */
export const SESSION_FILE = join(homedir(), '.est', 'session.json');
/** Cyber's address, unless `--to` or `EST_CYBER_URL` names another (a test server, a staging copy). */
export const DEFAULT_CYBER_URL = 'https://cyber-audio.fly.dev';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Your signature over a bundle (`est sign --developer`): `{ alg, keyId, payload: { id, version,
 * contentHash, publishedAt }, sig }`. `privateKey` a KeyObject or PEM/base64 PKCS8.
 * @param {Uint8Array} bytes @param {{ id: string, version: string }} manifest @param {any} privateKey @param {{ publishedAt?: string }} [o]
 */
export function developerSignature(bytes, manifest, privateKey, { publishedAt = new Date().toISOString() } = {}) {
  const key = typeof privateKey === 'string' ? signingKeyOf(privateKey) : privateKey;
  // 1.506: the one signing input, shared with the browser's publish (src/components/est/store/publish/sign.ts).
  const input = developerSigningInput(manifest, sha256(bytes), publishedAt);
  return { alg: 'ed25519', keyId: keyFacts(key).keyId, payload: input.payload, sig: edSign(null, Buffer.from(input.bytes), key).toString('base64') };
}

/** A URL without a trailing slash; only http(s). @param {string} raw */
export function cyberUrl(raw) {
  const u = new URL(String(raw || process.env.EST_CYBER_URL || DEFAULT_CYBER_URL));
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname))) throw new Error(`${u.href}: Cyber is reached over https (http only on this machine)`);
  return u.origin;
}

/**
 * 1.400 (P3): a closed service's words. Cyber answers 404 on every developer route while developer
 * accounts are closed (`EST_DEVELOPERS_OPEN` off), so a 404 there means closed, not a wrong address.
 */
export const CLOSED_WORDS = (base) => `${base} does not take developer logins or publishing yet: developer accounts are not open there. You can still make, validate, test and play plugins (est new, est validate, est test, est dev), and load your own .est in Cyber where developer mode is open to you.`;

/**
 * Whether a 404 is the closed service's (every developer route answers `{ error: 'not found' }` while
 * closed) rather than an answer about the request. 1.440 (rc-est 16): an unknown version answers 404
 * with `code: 'no-version'` and its own words, which are shown as they are.
 * @param {number} status @param {any} b
 */
export const closedAnswer = (status, b) => status === 404 && b?.code !== 'no-version' && (!b || typeof b.error !== 'string' || b.error === 'not found');

/** Words from a refusal. */
async function refusal(r, base = '') {
  let b = null;
  try { b = await r.json(); } catch { /* not JSON */ }
  const why = b && typeof b.error === 'string' ? b.error : `Cyber answered ${r.status}`;
  return Object.assign(new Error(closedAnswer(r.status, b) ? (base ? CLOSED_WORDS(base) : `${why} (developer accounts may not be open on this server yet)`) : why), { status: r.status, code: b?.code });
}

/**
 * 1.400 (P3): the words for a request that never reached Cyber (Node's fetch says only "fetch
 * failed"; the reason is in its `cause`): no network, a name that does not resolve, a refused or
 * reset connection, a proxy, a certificate.
 * @param {string} base @param {unknown} err
 */
export function unreachableWords(base, err) {
  const cause = /** @type {any} */ (err)?.cause;
  const code = String(cause?.code ?? /** @type {any} */ (err)?.code ?? '');
  const detail = String(cause?.message ?? /** @type {any} */ (err)?.message ?? err);
  const why = code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'its name did not resolve: check the address and that this machine is online'
    : code === 'ECONNREFUSED' ? 'nothing answered there: check the address and the port (--to)'
      : code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' ? 'the connection was cut: try again, or check a proxy or firewall'
        : /timeout/i.test(code) || /timeout/i.test(detail) ? 'it did not answer in time: check this machine is online, then try again'
          : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) ? 'its certificate was not trusted (a proxy that inspects https needs NODE_EXTRA_CA_CERTS)'
            : 'check this machine is online and the address is right';
  return `could not reach ${base} (${detail}${code && !detail.includes(code) ? `, ${code}` : ''}): ${why}. The address is --to, else $EST_CYBER_URL, else ${DEFAULT_CYBER_URL}.`;
}

/** `fetchFn(url, init)`, its network failure in words. @param {typeof fetch} fetchFn @param {string} base @param {string} url @param {RequestInit} [init] */
async function reach(fetchFn, base, url, init) {
  try { return await fetchFn(url, init); } catch (err) {
    throw Object.assign(new Error(unreachableWords(base, err)), { code: 'unreachable', cause: err });
  }
}

/**
 * `est login`: a code to approve in the browser, then the token. `onCode` is told the URL and code to
 * show; `sleep` and `fetchFn` are for tests.
 * @param {{ url: string, onCode: (c: { verifyUrl: string, userCode: string }) => void, fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<void>, timeoutMs?: number }} o
 */
export async function login({ url, onCode, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 10 * 60 * 1000 }) {
  const base = cyberUrl(url);
  const r = await reach(fetchFn, base, `${base}/est-developer/login`, { method: 'POST' });
  if (!r.ok) throw await refusal(r, base);
  const start = /** @type {any} */ (await r.json());
  onCode({ verifyUrl: start.verifyUrl, userCode: start.userCode });
  const until = Date.now() + Math.min(timeoutMs, (start.expiresIn ?? 600) * 1000);
  while (Date.now() < until) {
    await sleep((start.interval ?? 3) * 1000);
    const p = await reach(fetchFn, base, `${base}/est-developer/login/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode }) });
    if (p.status === 428) continue;
    if (!p.ok) throw await refusal(p, base);
    const t = /** @type {any} */ (await p.json());
    return { url: base, token: String(t.token), expiresAt: String(t.expiresAt), developer: t.developer ?? null };
  }
  throw new Error('the login was not approved in time: run est login again');
}

/** Keep a session (mode 600). @param {{ url: string, token: string, expiresAt: string }} s @param {string} [file] */
export function saveSession(s, file = SESSION_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ url: s.url, token: s.token, expiresAt: s.expiresAt })}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not on every file system */ }
}
/** The kept session for `url`, unless it has expired. @param {string} url @param {string} [file] */
export function readSession(url, file = SESSION_FILE) {
  if (!existsSync(file)) return null;
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.url !== cyberUrl(url) || !(Date.parse(s.expiresAt) > Date.now() + 30_000)) return null;
    return s;
  } catch { return null; }
}
/** `est logout`. @param {string} [file] */
export const clearSession = (file = SESSION_FILE) => rmSync(file, { force: true });

/**
 * `est publish <file.est>`: upload the bundle and your signature with the session's token. Cyber
 * re-validates it (its own conformance run), countersigns it as Community and lists it as early.
 * @param {{ url: string, token: string, bytes: Uint8Array, signature: object, earlyOnly?: boolean, fetchFn?: typeof fetch }} o
 */
export async function publishBundle({ url, token, bytes, signature, earlyOnly = false, fetchFn = fetch }) {
  const base = cyberUrl(url);
  const r = await reach(fetchFn, base, `${base}/registry/publish`, {
    method: 'POST', body: bytes,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-est-signature': Buffer.from(JSON.stringify(signature)).toString('base64'), ...(earlyOnly ? { 'x-est-early-only': '1' } : {}) },
  });
  if (!r.ok) throw await refusal(r, base);
  return /** @type {any} */ (await r.json());
}

/**
 * 1.323 (DEV-D §4): `est publish --screenshots a.png b.png`: a published version's page material, its
 * screenshots (PNG or WebP, at most 6 of 2 MB, checked here and again by Cyber), the changelog (the top
 * section of CHANGELOG.md: `changelogTopSection`) and links (https). Replaces what the version had;
 * the bundle itself never changes.
 * @param {{ url: string, token: string, id: string, version: string, changelog?: string, links?: Record<string, string>, screenshots?: Uint8Array[], fetchFn?: typeof fetch }} o
 */
export async function publishMeta({ url, token, id, version, changelog, links, screenshots = [], fetchFn = fetch }) {
  if (screenshots.length > SCREENSHOTS_MAX) throw new Error(`at most ${SCREENSHOTS_MAX} screenshots`);
  for (const s of screenshots) { const r = screenshotRefusal(s); if (r.why) throw new Error(r.why); }
  const text = metaTextRefusal({ ...(changelog !== undefined ? { changelog } : {}), ...(links !== undefined ? { links } : {}) });
  if (text) throw new Error(text);
  const body = { id, version, ...(changelog !== undefined ? { changelog } : {}), ...(links !== undefined ? { links } : {}), screenshots: screenshots.map((b) => Buffer.from(b).toString('base64')) };
  const base = cyberUrl(url);
  const r = await reach(fetchFn, base, `${base}/registry/meta`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw await refusal(r, base);
  return /** @type {any} */ (await r.json());
}

/** `est yank <id>@<version>` (`undo` unhides it). @param {{ url: string, token: string, id: string, version: string, undo?: boolean, fetchFn?: typeof fetch }} o */
export async function yankVersion({ url, token, id, version, undo = false, fetchFn = fetch }) {
  const base = cyberUrl(url);
  const r = await reach(fetchFn, base, `${base}/registry/yank`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, version, undo }) });
  if (!r.ok) throw await refusal(r, base);
  return /** @type {any} */ (await r.json());
}
