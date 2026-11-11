/**
 * `est dev --json`'s command queue (headless.mjs): stdin's commands run **one at a time, in the
 * order read, and no sooner than they arrived**. Each waits for the one before it to finish (the
 * page answers `done` when it has: a `state` only after the parameter changes before it are
 * applied), and two commands that arrived a second apart run a second apart even when they waited
 * for the instance together. `{"cmd":"wait","ms":n}` holds the queue for n ms; `quit` ends the run
 * when its turn comes.
 *
 * Pure apart from its clock: `now` and `sleep` are given, so the tests run it on a fake one.
 */

/** The longest `wait` (ms): ten minutes. */
export const MAX_WAIT_MS = 600_000;

/**
 * @typedef {{ cmd?: unknown, [k: string]: unknown }} Command
 * @param {{
 *   dispatch: (c: Command) => Promise<void>,
 *   quit: () => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} o
 */
export function commandQueue(o) {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  /** @type {{ c: Command, at: number }[]} */
  const queue = [];
  let started = false;
  let running = false;
  let stopped = false;
  /** When the last command was read, and when it was run. */
  let lastAt = /** @type {number | null} */ (null);
  let lastRun = 0;
  /** @type {(() => void)[]} */
  let idleWaiters = [];

  const settleIdle = () => {
    if (running || queue.length) return;
    const w = idleWaiters;
    idleWaiters = [];
    for (const fn of w) fn();
  };

  async function pump() {
    if (running || !started || stopped) return;
    running = true;
    try {
      while (queue.length && !stopped) {
        const { c, at } = /** @type {{ c: Command, at: number }} */ (queue.shift());
        // As they arrived: never sooner after the last command than it arrived after it.
        if (lastAt !== null) {
          const due = lastRun + Math.max(0, at - lastAt);
          const t = now();
          if (due > t) await sleep(due - t);
        }
        lastAt = at;
        lastRun = now();
        if (c.cmd === 'quit') { stopped = true; queue.length = 0; o.quit(); break; }
        if (c.cmd === 'wait') {
          const ms = typeof c.ms === 'number' && Number.isFinite(c.ms) ? Math.min(MAX_WAIT_MS, Math.max(0, c.ms)) : 0;
          await sleep(ms);
          continue;
        }
        await o.dispatch(c);
      }
    } finally {
      running = false;
      settleIdle();
    }
  }

  return {
    /** A command read now. */
    push(/** @type {Command} */ c) {
      if (stopped) return;
      queue.push({ c, at: now() });
      void pump();
    },
    /** The instance runs (or never will): start running the commands. */
    start() { started = true; void pump(); },
    /** Resolves when every command read so far has finished. */
    idle() {
      return new Promise((r) => { idleWaiters.push(() => r(undefined)); settleIdle(); });
    },
    /** Commands not yet run. */
    get pending() { return queue.length + (running ? 1 : 0); },
  };
}
