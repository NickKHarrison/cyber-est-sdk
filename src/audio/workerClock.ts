/**
 * The look-ahead schedulers' clock (1.38, review idea I-11). The transport's 25 ms tick and the
 * arpeggiator's come from `setInterval` in a tiny Worker built from a Blob, which posts a message
 * per tick: browsers throttle a hidden tab's own timers (to once a second, or once a minute after
 * a while), but not a dedicated worker's, so a song keeps playing in a background tab. Only the
 * timer moves: what each tick schedules is still computed on the main thread, against the audio
 * clock.
 *
 * One worker serves every ticker (by id). Where a Worker cannot be made (jsdom, a CSP without
 * `worker-src blob:`, a browser that refuses) or it fails, or its first tick does not come within
 * `FIRST_TICK_MS`, the tickers fall back to `setInterval` on the main thread, as before 1.38.
 *
 * Keep this file light: the transport and the synth's clock import it.
 */

/** The worker's whole source: a map of intervals by id; `start` and `stop` messages. */
export const CLOCK_WORKER_SOURCE = `var timers = {};
onmessage = function (e) {
  var d = e.data || {};
  if (d.op === 'start') {
    if (timers[d.id] !== undefined) clearInterval(timers[d.id]);
    timers[d.id] = setInterval(function () { postMessage(d.id); }, d.ms);
  } else if (d.op === 'stop') {
    if (timers[d.id] !== undefined) clearInterval(timers[d.id]);
    delete timers[d.id];
  }
};`;

/** No tick from the worker this long after a start: it is not running, and the main thread takes over. */
export const FIRST_TICK_MS = 1000;

export type TickerKind = 'worker' | 'main';

export interface Ticker {
  /** Where its ticks come from now (it can move to 'main' if the worker fails). */
  readonly kind: TickerKind;
  stop(): void;
}

interface Entry {
  id: number;
  ms: number;
  cb: () => void;
  kind: TickerKind;
  interval: ReturnType<typeof setInterval> | null;
  ticked: boolean;
  watchdog: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

/** undefined: not tried yet; null: unavailable (the main thread ticks). */
let worker: Worker | null | undefined;
let enabled = true;
let nextId = 1;
const entries = new Map<number, Entry>();

function onWorkerMessage(e: MessageEvent) {
  const entry = entries.get(e.data as number);
  if (!entry || entry.stopped || entry.kind !== 'worker') return;
  entry.ticked = true;
  entry.cb();
}

/** The worker failed (or never started): every ticker it drove moves to the main thread. */
function abandonWorker() {
  const w = worker;
  worker = null;
  try { w?.terminate(); } catch { /* gone */ }
  for (const entry of entries.values()) if (entry.kind === 'worker') toMain(entry);
}

function getWorker(): Worker | null {
  if (!enabled) return null;
  if (worker !== undefined) return worker;
  worker = null;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    // The Blob URL is kept (a few hundred bytes): revoking it at once can race the worker's fetch.
    const url = URL.createObjectURL(new Blob([CLOCK_WORKER_SOURCE], { type: 'text/javascript' }));
    const w = new Worker(url, { name: 'cyber-clock' });
    w.onmessage = onWorkerMessage;
    w.onerror = () => abandonWorker();
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function toMain(entry: Entry) {
  if (entry.watchdog !== null) clearTimeout(entry.watchdog);
  entry.watchdog = null;
  if (entry.stopped) return;
  entry.kind = 'main';
  if (entry.interval === null) entry.interval = setInterval(entry.cb, entry.ms);
}

/**
 * Call `cb` every `ms` milliseconds (from the worker when there is one) until `stop()`. The first
 * call is after `ms`, as `setInterval`'s; a caller that wants one now calls `cb` itself.
 */
export function startTicker(ms: number, cb: () => void): Ticker {
  const entry: Entry = { id: nextId++, ms, cb, kind: 'main', interval: null, ticked: false, watchdog: null, stopped: false };
  entries.set(entry.id, entry);
  const w = getWorker();
  if (w) {
    entry.kind = 'worker';
    try {
      w.postMessage({ op: 'start', id: entry.id, ms });
      entry.watchdog = setTimeout(() => {
        entry.watchdog = null;
        if (!entry.stopped && entry.kind === 'worker' && !entry.ticked) abandonWorker();
      }, Math.max(FIRST_TICK_MS, ms * 4));
    } catch {
      abandonWorker();
    }
  } else {
    toMain(entry);
  }
  return {
    get kind() { return entry.kind; },
    stop() {
      if (entry.stopped) return;
      entry.stopped = true;
      entries.delete(entry.id);
      if (entry.interval !== null) clearInterval(entry.interval);
      if (entry.watchdog !== null) clearTimeout(entry.watchdog);
      entry.interval = null;
      entry.watchdog = null;
      if (entry.kind === 'worker') {
        try { worker?.postMessage({ op: 'stop', id: entry.id }); } catch { /* gone */ }
      }
    },
  };
}

/** Whether new tickers use the worker (the e2e compares the two; a test turns it off). */
export function setWorkerClockEnabled(on: boolean): void {
  enabled = on;
}

/** Where a ticker started now would tick from. */
export function workerClockKind(): TickerKind {
  return getWorker() ? 'worker' : 'main';
}

/** For tests: forget the worker (a stubbed `Worker` is made again on the next start). */
export function __resetWorkerClock(): void {
  for (const entry of [...entries.values()]) {
    entry.stopped = true;
    if (entry.interval !== null) clearInterval(entry.interval);
    if (entry.watchdog !== null) clearTimeout(entry.watchdog);
  }
  entries.clear();
  try { worker?.terminate(); } catch { /* gone */ }
  worker = undefined;
  enabled = true;
}
