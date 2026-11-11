/**
 * EST Phase 5a, stream 5-C (docs/est/EST_Phase5a_Work_Order.md §3): what Cyber's **Follow `est dev`**
 * reads from the dev host, on the bundle files' origin (`http://localhost:4431` by default):
 *
 * - `GET /est/dev/current.json`: the last good build, `{ hash, id, version, builtAt, n }` (404 before one);
 * - `GET /est/dev/events`: a stream of events, `current` (the same shape, sent at once and on each good
 *   build) and `failed` (`{ n, at, message }`: a build that did not pack; `current` stays the last good);
 * - `GET /est/dev/<hash>.est`: a build's bundle, for the last few builds only.
 *
 * Cyber is another site (`https://cyber-audio.fly.dev`, or a local Cyber), so these answer CORS for
 * the Cyber origins `est dev --cyber [origin]` names, and nothing else; without `--cyber` none (the
 * routes answer, but no other site may read them). A browser's Private Network Access preflight gets
 * its `Access-Control-Allow-Private-Network`. Cyber installs each bundle through its own pipeline
 * (checked against `hash`, metered, validated), so nothing here is trusted beyond being bytes.
 *
 * DEV-E (1.325): `onAttach(origin, via)` is called when a Cyber origin in the list first reads the
 * stream or `current.json` (once per stream; a poll once per origin until it stops for 10 s), so
 * `est dev --cyber` (and `--json`'s `{ type: 'cyber', event: 'attached' }`) says when Cyber attached.
 * Only a listed origin counts: another site's request gets no CORS and says nothing.
 */

/** Cyber's live site: what `--cyber` alone allows. */
export const CYBER_LIVE_ORIGIN = 'https://cyber-audio.fly.dev';
/** Builds whose bundles stay fetchable (the newest first). */
const KEEP_BUILDS = 4;
const PATH_BUNDLE = /^\/est\/dev\/([0-9a-f]{64})\.est$/;

/**
 * An app origin `--cyber` may name: `scheme://host[:port]` only; null otherwise.
 * @param {string} raw
 */
export function cyberOriginOf(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
  return u.origin;
}

/**
 * @param {{ cyber?: readonly string[], onAttach?: (origin: string, via: 'events' | 'poll') => void, now?: () => number }} o
 *   the Cyber origins allowed to read (already `cyberOriginOf`'s); `onAttach`, told when one attaches
 */
export function createDevFollow(o = {}) {
  const allowed = new Set((o.cyber ?? []).map((c) => cyberOriginOf(c)).filter(Boolean));
  const now = o.now ?? Date.now;
  /** The last poll per origin (a poll after 10 s quiet is a new attach). */
  const polled = new Map();
  /** @param {import('node:http').IncomingMessage} req @param {'events' | 'poll'} via */
  const attach = (req, via) => {
    const origin = String(req.headers.origin ?? '');
    if (!allowed.has(origin) || req.method !== 'GET') return;
    if (via === 'poll') {
      const last = polled.get(origin);
      polled.set(origin, now());
      if (last !== undefined && now() - last < 10_000) return;
    }
    try { o.onAttach?.(origin, via); } catch { /* the listener's problem */ }
  };
  /** @type {null | { hash: string, id: string, version: string, builtAt: string, n: number }} */
  let current = null;
  /** @type {Map<string, Uint8Array>} newest last */
  const bundles = new Map();
  /** @type {Set<import('node:http').ServerResponse>} */
  const streams = new Set();
  const beat = setInterval(() => { for (const res of streams) res.write(': keep-alive\n\n'); }, 15_000);
  beat.unref?.();

  /** @param {import('node:http').IncomingMessage} req */
  const cors = (req) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    return allowed.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };
  };
  const base = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin', 'referrer-policy': 'no-referrer' };
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const send = (event, data) => { const f = frame(event, data); for (const res of streams) res.write(f); };

  return {
    /** The Cyber origins allowed (for the start message). */
    origins: () => [...allowed],
    /** A good build: its bundle and its record. @param {{ hash: string, id: string, version: string, builtAt: string, n: number, bytes: Uint8Array }} b */
    publish(b) {
      bundles.delete(b.hash);
      bundles.set(b.hash, b.bytes);
      while (bundles.size > KEEP_BUILDS) bundles.delete(bundles.keys().next().value);
      current = { hash: b.hash, id: b.id, version: b.version, builtAt: b.builtAt, n: b.n };
      send('current', current);
    },
    /** A build that did not pack (Cyber says so; `current` stays the last good one). @param {{ n: number, at: string, message: string }} f */
    failed(f) { send('failed', { n: f.n, at: f.at, message: String(f.message).slice(0, 2000) }); },
    /**
     * Answer `/est/dev/…` on the files origin; false for any other path.
     * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
     */
    handle(req, res) {
      const path = new URL(req.url ?? '/', 'http://dev.invalid').pathname;
      if (!path.startsWith('/est/dev/')) return false;
      req.resume();
      if (req.method === 'OPTIONS') {
        const pna = req.headers['access-control-request-private-network'] === 'true' && allowed.has(String(req.headers.origin ?? ''));
        res.writeHead(204, { ...base, ...cors(req), 'access-control-allow-methods': 'GET', ...(pna ? { 'access-control-allow-private-network': 'true' } : {}), 'access-control-max-age': '600' });
        res.end();
        return true;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...base, ...cors(req) }); res.end(); return true; }
      if (path === '/est/dev/current.json') {
        attach(req, 'poll');
        res.writeHead(current ? 200 : 404, { ...base, ...cors(req), 'content-type': 'application/json' });
        res.end(JSON.stringify(current ?? { error: 'no build yet' }));
        return true;
      }
      if (path === '/est/dev/events') {
        attach(req, 'events');
        res.writeHead(200, { ...base, ...cors(req), 'content-type': 'text/event-stream', connection: 'keep-alive' });
        res.write(current ? frame('current', current) : ': no build yet\n\n');
        streams.add(res);
        res.on('close', () => streams.delete(res));
        return true;
      }
      const m = PATH_BUNDLE.exec(path);
      const bytes = m ? bundles.get(m[1]) : undefined;
      if (!bytes) { res.writeHead(404, { ...base, ...cors(req), 'content-type': 'text/plain' }); res.end('Not found'); return true; }
      res.writeHead(200, { ...base, ...cors(req), 'content-type': 'application/octet-stream', 'content-length': bytes.byteLength, 'x-est-hash': /** @type {RegExpExecArray} */ (m)[1] });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(bytes));
      return true;
    },
    close() {
      clearInterval(beat);
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
