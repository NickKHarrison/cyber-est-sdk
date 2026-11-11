// server/http.mjs — small helpers shared by the account-backed endpoints (library, classes).
import { promisify } from 'node:util';
import zlib from 'node:zlib';

/** Send a JSON answer (never cached). */
export function json(res, status, body, extra = {}) {
  // 1.309 (SRV-19): nosniff on every JSON answer.
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
}

/** Whether a request's Origin is this host (refuses cross-site writes). */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/** Read a request body as bytes, refusing more than `limit` bytes. @returns {Promise<Buffer>} */
export function readBytes(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Read a request body as text, refusing more than `limit` bytes. */
export async function readBody(req, limit) {
  return (await readBytes(req, limit)).toString('utf8');
}

// --- 1.307 (LR-1, SRV-01): what the server holds of JSON bodies -------------------------------
//
// Two bounds, both process-wide, on every JSON body (`readJson`, `readJsonMaybeGzip`):
//
// - **The in-flight budget** (`BODY_BUDGET_BYTES`, 96 MB; the env for tests) counts the bytes being
//   received. Each body reserves its route's limit before a byte is read (an identity body with a
//   smaller `content-length` reserves that). Past the budget the request is refused unread: 503
//   `busy` with `Retry-After: 2`. Reserving the limit rather than the real size (unknown until read)
//   is conservative and simple.
// - **The parse gate** (`PARSE_BUDGET_BYTES`, 8 MB of decoded JSON; the env for tests) counts the
//   JSON being inflated, parsed and held. A parsed body costs up to about 20 times its text on the
//   heap (8 MB of `{}` is about 170 MB), so the byte budget alone would still let a dozen 8 MB decks
//   be parsed at once. A body enters the gate once its raw bytes are in (so a slow sender holds no
//   place in it), weighing its route's limit while it inflates and then its decoded length; one
//   larger than the gate enters alone. The rest wait their turn in order (at most
//   `PARSE_QUEUE_MAX`; past that, 503 `busy`), holding only their raw bytes.
//
// The parse gate's place is given back as soon as the body is parsed (or fails), so a body that
// waits afterwards (a deck save on its owner's lock) never holds up another account's body (review
// of #442: holding the gate too made one waiting deck save queue every other account's large body).
// The in-flight budget is given back when the read is done (`finally`) or, when the caller passes
// `{ res }`, once that response has closed, so a parsed body waiting for an account's lock still
// counts against it.
//
// - **An account's turn** (`o.key`, the account whose lock the body will wait on; with `o.res`): a
//   parsed body that waits on its account's lock is still on the heap, so that account's next body
//   is parsed only once the one before has been answered (its response closed). Eight 8 MB decks of
//   one account are then parsed and held one at a time, never all at once, while every other
//   account's bodies go on. At most KEY_QUEUE_MAX of one account's bodies wait (past that, 503 `busy`).

const envBytes = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};
/** The in-flight budget's cap, bytes received. */
export const BODY_BUDGET_BYTES = envBytes('BODY_BUDGET_BYTES', 96 * 1024 * 1024);
/** The parse gate's cap, bytes of decoded JSON parsed or held at once. */
export const PARSE_BUDGET_BYTES = envBytes('PARSE_BUDGET_BYTES', 8 * 1024 * 1024);
/** The most bodies waiting for the parse gate; the next is 503. */
export const PARSE_QUEUE_MAX = 64;
/** The most bodies of one account (`o.key`) waiting for its turn; the next is 503. */
export const KEY_QUEUE_MAX = 16;
/** Seconds a refused body is told to wait (`Retry-After`). */
export const BODY_BUSY_RETRY_S = 2;
let inFlightBytes = 0;
let parsingBytes = 0;
/** @type {{ weight: number, go: () => void }[]} */
const parseQueue = [];
/** What is held now and the caps (for /healthz). */
export const bodyBudget = () => ({ inFlightBytes, capBytes: BODY_BUDGET_BYTES, parsingBytes, parseCapBytes: PARSE_BUDGET_BYTES, parseQueued: parseQueue.length });

const busy = () => Object.assign(new Error('busy'), { status: 503, retryAfter: BODY_BUSY_RETRY_S });

/**
 * Reserve `bytes` of the in-flight budget, or throw a 503 (`busy`, `retryAfter`) after draining the request.
 * @returns {() => void} the release (once only)
 */
export function reserveBody(req, bytes) {
  const n = Math.max(0, Math.floor(bytes));
  if (inFlightBytes + n > BODY_BUDGET_BYTES) {
    req.resume();
    throw busy();
  }
  inFlightBytes += n;
  let done = false;
  return () => { if (done) return; done = true; inFlightBytes -= n; };
}

const fitsGate = (weight) => parsingBytes === 0 || parsingBytes + weight <= PARSE_BUDGET_BYTES;
function pumpGate() {
  while (parseQueue.length && fitsGate(/** @type {any} */ (parseQueue[0]).weight)) /** @type {any} */ (parseQueue.shift()).go();
}
/**
 * A place in the parse gate weighing `weight`: at once when it fits, else in turn (503 when the queue is full).
 * @returns {Promise<{ shrink: (to: number) => void, release: () => void }>}
 */
function enterGate(weight) {
  const w = Math.max(0, Math.floor(weight));
  return new Promise((resolve, reject) => {
    const go = () => {
      parsingBytes += w;
      let held = w;
      resolve({
        shrink: (to) => { const n = Math.max(0, Math.min(held, Math.floor(to))); parsingBytes -= held - n; held = n; pumpGate(); },
        release: () => { parsingBytes -= held; held = 0; pumpGate(); },
      });
    };
    if (!parseQueue.length && fitsGate(w)) go();
    else if (parseQueue.length >= PARSE_QUEUE_MAX) reject(busy());
    else parseQueue.push({ weight: w, go });
  });
}

/** @type {Map<string, { tail: Promise<void>, waiting: number }>} each account's turn (`o.key`) */
const keyTurns = new Map();
/**
 * `key`'s turn: resolves once the account's bodies before it have been released (503 when too many
 * wait). @param {string} key @returns {Promise<() => void>} the release (once only)
 */
function enterKeyTurn(key) {
  const t = keyTurns.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
  if (t.waiting >= KEY_QUEUE_MAX) return Promise.reject(busy());
  /** @type {() => void} */
  let passOn = () => {};
  const mine = new Promise((r) => { passOn = () => r(undefined); });
  const before = t.tail;
  const tail = before.then(() => mine);
  t.tail = tail;
  t.waiting++;
  keyTurns.set(key, t);
  return before.then(() => {
    t.waiting--;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      passOn();
      void tail.then(() => { if (keyTurns.get(key) === t && t.tail === tail) keyTurns.delete(key); });
    };
  });
}

/** The bytes a body of at most `limit` reserves: its declared length when that is smaller and not compressed. */
function reservationOf(req, limit) {
  const enc = String(req.headers?.['content-encoding'] ?? '').trim().toLowerCase();
  const declared = Number(req.headers?.['content-length']);
  if ((enc === '' || enc === 'identity') && Number.isFinite(declared) && declared >= 0) return Math.min(limit, declared);
  return limit;
}

/**
 * Read a body of at most `limit` under both bounds: `decode(raw, gate)` turns its raw bytes into the
 * value inside the parse gate. The gate is released once it is parsed; the in-flight budget when it
 * settles, or (with `o.res`) when that response closes.
 * @template T
 * @param {any} req @param {number} limit @param {{ res?: import('node:http').ServerResponse, key?: string }} o
 * @param {number | null} weight the gate weight while decoding (null: the raw length)
 * @param {(raw: Buffer, gate: { shrink: (to: number) => void }) => Promise<T> | T} decode
 * @returns {Promise<T>}
 */
async function readBounded(req, limit, o, weight, decode) {
  // A body that says it is over the limit is refused before it is read, with words (413), not a reset.
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > limit) { req.resume(); throw Object.assign(new Error('too large'), { status: 413 }); }
  const unreserve = reserveBody(req, reservationOf(req, limit));
  /** @type {null | { shrink: (to: number) => void, release: () => void }} */
  let gate = null;
  /** @type {null | (() => void)} */
  let turn = null;
  let released = false;
  const release = () => { released = true; unreserve(); gate?.release(); turn?.(); };
  const res = o.res;
  const hold = !!res && !res.writableFinished && !res.destroyed;
  if (hold) res.once('close', release);
  try {
    const raw = await readBytes(req, limit);
    // One account's bodies are parsed (and then held) one at a time: see "An account's turn".
    if (hold && o.key) {
      turn = await enterKeyTurn(o.key);
      if (released) turn();
    }
    gate = await enterGate(weight ?? raw.length);
    // The response may have closed while it waited (the client gave up): nothing to hold for.
    if (hold && (res.destroyed || res.writableFinished)) { release(); throw Object.assign(new Error('gone'), { status: 499 }); }
    const value = await decode(raw, gate);
    gate.release();
    return value;
  } catch (err) {
    release();
    throw err;
  } finally {
    if (!hold) release();
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
}

/**
 * Read a JSON body; rejects with `status` 400 (bad JSON), 413 (too large) or 503 (the server is
 * holding as much as it may: `retryAfter`). @param {{ res?: import('node:http').ServerResponse, key?: string }} [o]
 */
export async function readJson(req, limit, o = {}) {
  return readBounded(req, limit, o, null, (raw) => parseJson(raw.toString('utf8')));
}

const gunzip = promisify(zlib.gunzip);

/**
 * Read a JSON body that may be gzipped (`Content-Encoding: gzip`, 1.38, review I-5: the
 * autosave). `limit` caps the bytes received and, separately, the bytes it inflates to, so a
 * small "zip bomb" is refused (413) without inflating past it. Rejects with 400 for gzip that
 * does not inflate or JSON that does not parse, 413 over the cap, 415 for any other encoding, and
 * 503 when the server is holding as much as it may (1.307). `o.res`: hold its share until it closes.
 * @param {{ res?: import('node:http').ServerResponse, key?: string }} [o]
 */
export async function readJsonMaybeGzip(req, limit, o = {}) {
  const enc = String(req.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (enc === '' || enc === 'identity') return readJson(req, limit, o);
  if (enc !== 'gzip') { req.resume(); throw Object.assign(new Error('unsupported encoding'), { status: 415 }); }
  // Inflating may reach the limit: it weighs that until the decoded length is known.
  return readBounded(req, limit, o, limit, async (raw, gate) => {
    let text;
    try {
      text = (await gunzip(raw, { maxOutputLength: limit })).toString('utf8');
    } catch (err) {
      const tooLarge = err instanceof RangeError || /** @type {any} */ (err)?.code === 'ERR_BUFFER_TOO_LARGE';
      throw Object.assign(new Error(tooLarge ? 'too large' : 'bad gzip'), { status: tooLarge ? 413 : 400 });
    }
    gate.shrink(text.length);
    return parseJson(text);
  });
}

/** Answer a failed readJson (or any error carrying `status`). */
export function failBody(res, err) {
  if (res.headersSent) return;
  const status = Number(err?.status) || 500;
  // 1.307: the in-flight budget spent (reserveBody): try again shortly.
  if (status === 503) { json(res, 503, { error: 'The server is busy. Try again in a moment.', code: 'busy' }, { 'retry-after': String(err?.retryAfter ?? BODY_BUSY_RETRY_S) }); return; }
  json(res, status, { error: status === 413 ? 'too large' : status === 400 ? 'bad request' : status === 415 ? 'unsupported content encoding' : 'server error' });
}
