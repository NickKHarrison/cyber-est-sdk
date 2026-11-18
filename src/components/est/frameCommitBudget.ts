/**
 * The sandbox attack order (stream E, findings E-1 and E-2): how often a plugin's own window may
 * **write the song**. A frame's `est:param` / `est:gesture` messages are posted by the plugin's page,
 * with or without a person: at `COMMIT_MS` alone (4 writes a second for ever) a window left open
 * pushed every undo step of the person's out of the history in 45 s and grew a live room's doc until
 * the server closed the room for everyone (22 minutes with 58 parameters).
 *
 * Two buckets, one a frame. **Attended**: the write has a real input behind it, the page's transient
 * user activation (which an input inside a child frame gives its ancestors, and no script can make),
 * now or when its gesture began: `ATTENDED.burst` writes at once, then one every `ATTENDED.everyMs`.
 * **Unattended** (no input in the last seconds: the wheel over a knob, or nobody): `UNATTENDED.burst`,
 * then one every `UNATTENDED.everyMs`. A write that must wait loses nothing: the values stay previewed
 * (heard and shown) and go in the next write. Pure; time is passed in.
 *
 * The arithmetic: a person's drag is one write (its gesture's end), so 20 at once and 6 a minute never
 * holds a person back for more than seconds; a hostile window with nobody there gets 4 writes and then
 * 60 an hour (the undo history's 100 steps last 96 minutes, not 45 s; a room's 300 000 items at 58
 * parameters last 86 hours, not 22 minutes), and with a person working elsewhere in the app at most 6 a minute.
 *
 * **A write is charged by what it holds** (the integration's second look at E-1): the slower the writes,
 * the more a hostile page puts in each (240 messages a second for 10 s reach every one of a plugin's 511
 * writable parameters, each its own item in a room's doc), so a budget that counted writes alone still
 * let an hour of the attended allowance take a room to 194 397 of its 300 000 items (measured), closing it
 * in an hour and a half. A write of n parameters costs `writeCost(n)`: one for up to `PARAMS_PER_WRITE`
 * (64), one more for each 64 after. A write larger than a bucket's burst goes when the bucket is full and
 * leaves it in debt, so the sustained rate is never above 64 parameters a refill: attended 20 × 64 at once
 * and 6 × 64 = 384 parameters a minute (an hour: 1 280 + 23 040 = 24 320 items, under a tenth of the
 * room's limit; the limit after 13 hours), unattended 4 × 64 and then 64 a minute (78 hours). A person's
 * drag moves one or two parameters (cost 1); a plugin's own preset list moving all 511 costs 8 of the 20.
 */
export const ATTENDED = { burst: 20, everyMs: 10_000 } as const;
export const UNATTENDED = { burst: 4, everyMs: 60_000 } as const;
/** The parameters one write's worth of budget holds. */
export const PARAMS_PER_WRITE = 64;
/** What a write of `n` parameters costs of a bucket: 1 for up to `PARAMS_PER_WRITE`, one more for each further 64. */
export const writeCost = (n: number): number => Math.max(1, Math.ceil(n / PARAMS_PER_WRITE));

export interface FrameCommitBudget {
  /** 0 when a write of this cost may go now (call `take`), else the milliseconds until one may. */
  wait(attended: boolean, now: number, cost?: number): number;
  /** Spend one write of this cost (default 1). A cost above the burst leaves the bucket in debt. */
  take(attended: boolean, now: number, cost?: number): void;
}

export function frameCommitBudget(): FrameCommitBudget {
  const bucket = (rule: { burst: number; everyMs: number }) => {
    let tokens: number = rule.burst;
    let at: number | null = null;
    const fill = (now: number) => {
      if (at !== null && now > at) tokens = Math.min(rule.burst, tokens + (now - at) / rule.everyMs);
      if (at === null || now > at) at = now;
    };
    return {
      // A write larger than the burst goes when the bucket is full, and its debt is paid before the next.
      wait: (now: number, cost: number) => { fill(now); const need = Math.min(cost, rule.burst); return tokens >= need ? 0 : Math.ceil((need - tokens) * rule.everyMs); },
      take: (now: number, cost: number) => { fill(now); tokens -= cost; },
    };
  };
  const attended = bucket(ATTENDED), unattended = bucket(UNATTENDED);
  return {
    wait: (a, now, cost = 1) => (a ? attended : unattended).wait(now, Math.max(1, cost)),
    take: (a, now, cost = 1) => (a ? attended : unattended).take(now, Math.max(1, cost)),
  };
}

/**
 * Whether a real input is behind what the frame posts now: the transient user activation of the
 * window the frame is drawn in. A browser without the API answers true (the attended budget still holds).
 */
export function frameAttended(view: Window | null | undefined): boolean {
  const ua = (view?.navigator as (Navigator & { userActivation?: { isActive: boolean } }) | undefined)?.userActivation;
  return ua ? ua.isActive : true;
}
