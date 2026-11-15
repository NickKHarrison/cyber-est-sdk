/**
 * 1.630 (docs/launch/network-filters.md): **whether this browser can reach the plugin origin**.
 *
 * A school or company network's security filter (Cisco Umbrella / Secure Access, and others) may
 * block the plugin origin's host (`EST_ORIGIN_URL`) while it lets the app through. Then a plugin's own
 * window shows the filter's refused page, and every fetch there fails. This module keeps what this
 * page has learnt, per origin, for this visit:
 *
 * - `'ok'`: a frame's wrapper answered (EstPluginFrame's handshake), or a probe read the origin.
 * - `'blocked'`: a frame never answered and the probe could not read the origin (`probeEstOrigin`), or a
 *   fetch there failed while the app's own copy worked (`noteEstOriginFailed`). Every plugin window then
 *   shows its standard controls at once, with a notice (`EstControls`), until **Try again** (`retryEstOrigin`).
 * - `'unknown'`: not asked yet.
 *
 * The probe reads, with CORS, a file the plugin origin answers with this app in
 * `access-control-allow-origin` (a bundle's `est.json`, the signed index), redirects not followed. A
 * readable OK answer is the real origin (a filter's page carries no such header, and a readable 403 or
 * 5xx is not the site working); a redirect is a filter's
 * (it sends the page to its block page: `filter-redirect`); a failure with nothing read is a DNS block,
 * an intercepted certificate or a refused connection (`unreachable`); no answer in `PROBE_MS`, `timeout`.
 * The browser never tells a page where a redirect went or why a connection failed, so the words say
 * what is likely, never more.
 *
 * Light (`EST_LIGHT`): no imports but the launch count's fetch; nothing per frame.
 */

export type EstReach = 'unknown' | 'ok' | 'blocked';
/** What a probe saw (also the feedback's short code: `cleanFeedbackDetails`). */
export type EstProbeCode = 'ok' | 'filter-redirect' | 'unreachable' | 'timeout' | 'no-origin';
export interface EstProbe { code: EstProbeCode; status?: number }

/** How long a probe waits. */
export const PROBE_MS = 5000;

const reach = new Map<string, EstReach>();
const why = new Map<string, EstProbeCode>();
const probes = new Map<string, Promise<EstProbe>>();
/** Origins whose cached probe is the OK a handshake (or a probe) proved. */
const okProbes = new Set<string>();
const counted = new Set<string>();
const preferApp = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* one listener never stops the others */ } } };

export type ProbeFn = (url: string, signal: AbortSignal) => Promise<{ type: string; status: number }>;
const realProbe: ProbeFn = async (url, signal) => {
  const r = await fetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'manual', referrerPolicy: 'no-referrer', signal });
  return { type: r.type, status: r.status };
};
let probeFn: ProbeFn = realProbe;
const realCount = (what: string): void => {
  try {
    void fetch('/est-net/count', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ what }) }).catch(() => {});
  } catch { /* no network: nothing counted */ }
};
let countFn: (what: string) => void = realCount;

/** What this page knows of an origin. */
export const estOriginReach = (origin: string | null): EstReach => (origin ? reach.get(origin) ?? 'unknown' : 'unknown');
/** Whether the plugin origin is known blocked for this visit. */
export const estOriginBlocked = (origin: string | null): boolean => estOriginReach(origin) === 'blocked';
/** The last probe's code for an origin, or null. */
export const estOriginWhy = (origin: string | null): EstProbeCode | null => (origin ? why.get(origin) ?? null : null);

/** A frame's wrapper answered, or a fetch there worked. */
export function noteEstOriginOk(origin: string | null): void {
  if (!origin) return;
  // review2 C-2: proof the origin reads is an OK probe: a probe still running (or one that timed out
  // on a slow HEAD) must not later fail a window this visit already saw answer.
  if (!okProbes.has(origin)) { const p = Promise.resolve<EstProbe>({ code: 'ok' }); probes.set(origin, p); okProbes.add(origin); }
  if (reach.get(origin) === 'ok') return;
  reach.set(origin, 'ok');
  why.set(origin, 'ok');
  notify();
}

/**
 * The origin is blocked for this visit (a frame that never answered and a failed probe). `ui`: a plugin
 * window fell back, so the launch count `est.uiFallback` is sent, once a visit per origin.
 */
export function noteEstOriginBlocked(origin: string | null, code: EstProbeCode, ui = false): void {
  if (!origin) return;
  why.set(origin, code);
  if (ui && !counted.has(origin)) { counted.add(origin); countFn('ui-fallback'); }
  if (reach.get(origin) === 'blocked') return;
  reach.set(origin, 'blocked');
  notify();
}

/**
 * A fetch to the origin failed on the network (not an HTTP answer) while the app's own copy answered
 * (install/registry.ts, install/index.ts): later fetches this visit ask the app first. Never marks a
 * frame: its own handshake decides (a passing blip must not take every plugin's window away).
 */
export function noteEstOriginFailed(origin: string | null): void {
  if (origin) preferApp.add(origin);
}
/** Whether this visit's fetches of signed files and bundles ask the app's copy first. */
export const estPreferAppCopy = (origin: string | null): boolean => !!origin && (preferApp.has(origin) || reach.get(origin) === 'blocked');

/** Try again: forget what was learnt (the next window probes afresh). */
export function retryEstOrigin(origin: string | null): void {
  if (!origin) return;
  reach.delete(origin);
  why.delete(origin);
  probes.delete(origin);
  okProbes.delete(origin);
  preferApp.delete(origin);
  notify();
}

/** Follow the changes. Returns the unsubscribe. */
export function onEstOriginReach(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The files a probe reads: a bundle's `est.json` when there is one (always on the origin), then the signed index. */
export function probeUrls(origin: string, hash: string | null = null): string[] {
  const o = origin.replace(/\/+$/, '');
  return [...(hash && /^[0-9a-f]{64}$/.test(hash) ? [`${o}/est/b/${hash}/est.json`] : []), `${o}/est/v1/index.json`];
}

/** One look at a URL: what it saw (also the connection check's, `connectionCheck.ts`). */
export async function lookAt(url: string): Promise<EstProbe> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    const r = await probeFn(url, ctl.signal);
    // A redirect from the plugin origin is never Cyber's: a filter sending the page to its block page.
    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { code: 'filter-redirect' };
    // Readable and OK (or a 404: the origin's own answer for an index not yet published): the real
    // origin answered (its CORS header names this app). Any other status (a 403 block page that
    // happens to allow this origin, a gateway error) is not the plugin site working.
    if ((r.status >= 200 && r.status < 300) || r.status === 404) return { code: 'ok', status: r.status };
    return { code: 'unreachable', status: r.status };
  } catch (err) {
    return { code: (err as { name?: string } | null)?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe the plugin origin (once a visit per origin unless `retryEstOrigin`): `ok` when any of its files
 * read (a 404 with the origin's CORS header is still the origin), else the first failure's code. Marks
 * `ok` on success; a failure marks nothing (the caller decides).
 */
export function probeEstOrigin(origin: string | null, hash: string | null = null): Promise<EstProbe> {
  if (!origin) return Promise.resolve({ code: 'no-origin' });
  let p = probes.get(origin);
  if (!p) {
    p = (async () => {
      let first: EstProbe | null = null;
      for (const url of probeUrls(origin, hash)) {
        const r = await lookAt(url);
        if (r.code === 'ok') { noteEstOriginOk(origin); return r; }
        first ??= r;
        // A redirect or a timeout says enough: the next file is behind the same filter.
        if (r.code !== 'unreachable') break;
      }
      const f = first ?? { code: 'unreachable' as const };
      // A probe overtaken by a proof (review2 C-2) leaves the reason as that proof's.
      if (!okProbes.has(origin)) why.set(origin, f.code);
      return f;
    })();
    probes.set(origin, p);
  }
  return p;
}

/** Tests: the probe and the count (null: the real ones), and a clean slate. */
export function setEstOriginDepsForTests(next: { probe?: ProbeFn | null; count?: ((what: string) => void) | null } | null): void {
  if (next?.probe !== undefined) probeFn = next.probe ?? realProbe;
  if (next?.count !== undefined) countFn = next.count ?? realCount;
  if (next === null) { probeFn = realProbe; countFn = realCount; }
  reach.clear();
  why.clear();
  probes.clear();
  okProbes.clear();
  counted.clear();
  preferApp.clear();
}
