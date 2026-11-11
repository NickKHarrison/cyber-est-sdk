/**
 * EST Phase 2 foundation (docs/est/EST_Phase2_Work_Order.md §0.1, decision D-28): how many EST
 * instances a tab may hold. Phase 1 measured that a Chromium renderer holds about 123 live Wasm
 * memories (V8 reserves address space for each, shared by the page and every worklet), so live
 * playback may hold at most 48 and an offline render (export, bounce, freeze) another 48 of its
 * own, which together stay well under the limit. Every `createEstNode` goes through `claimEst`
 * first; a refusal is a placeholder that passes audio and says why, never a crash.
 */

/** D-28: live instances per tab. */
export const EST_LIVE_BUDGET = 48;
/** D-28: instances one offline render may hold at once, besides the live ones. */
export const EST_OFFLINE_BUDGET = 48;

/**
 * D-34 (EST Phase 3, instruments): within each pool an instrument may hold at most this many of
 * its claims, so plugin effects always keep room (48 − 32 = 16 at least).
 */
export const EST_INSTRUMENT_BUDGET = 32;

/**
 * 1.314 (LR-8b stream A, EST-13): the memory a pool's instances may declare between them, in
 * 64 KiB pages: 16 384 (1 GiB) live and as many for an offline render. 48 instances at the hard
 * cap of 2 048 pages each would commit 6 GiB and crash the tab; each claim adds the manifest's
 * `limits.memoryPagesMax` (what the module may grow to, which the runtime enforces) and is refused
 * as `budget` past the pool's sum.
 */
export const EST_LIVE_MEMORY_PAGES = 16384;
export const EST_OFFLINE_MEMORY_PAGES = 16384;

export type EstPool = 'live' | 'offline';
/** What a claim is for: an insert (the default) or an instrument on a track. */
export type EstClaimKind = 'effect' | 'instrument';

const held: Record<EstPool, number> = { live: 0, offline: 0 };
const heldInstruments: Record<EstPool, number> = { live: 0, offline: 0 };
const heldPages: Record<EstPool, number> = { live: 0, offline: 0 };
const limitOf = (pool: EstPool) => (pool === 'live' ? EST_LIVE_BUDGET : EST_OFFLINE_BUDGET);
const pagesLimitOf = (pool: EstPool) => (pool === 'live' ? EST_LIVE_MEMORY_PAGES : EST_OFFLINE_MEMORY_PAGES);

/**
 * Claims one instance in a pool: a release function (idempotent) or null when the pool is full.
 * `pages` (1.314, EST-13): the memory the instance may grow to (the manifest's
 * `limits.memoryPagesMax`), refused when the pool's sum would pass its memory budget. Release when
 * the instance is disposed, its context closed or the claim not used.
 */
export function claimEst(pool: EstPool, kind: EstClaimKind = 'effect', pages = 0): (() => void) | null {
  if (held[pool] >= limitOf(pool)) return null;
  if (kind === 'instrument' && heldInstruments[pool] >= EST_INSTRUMENT_BUDGET) return null;
  const p = Math.max(0, pages | 0);
  if (heldPages[pool] + p > pagesLimitOf(pool)) return null;
  held[pool]++;
  heldPages[pool] += p;
  if (kind === 'instrument') heldInstruments[pool]++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held[pool]--;
    heldPages[pool] -= p;
    if (kind === 'instrument') heldInstruments[pool]--;
  };
}

/** The memory pages a pool's instances declare between them now (1.314). */
export const estHeldPages = (pool: EstPool) => heldPages[pool];

/** How many instances a pool holds now (the card's chip, Diagnostics, tests). */
export const estHeld = (pool: EstPool, kind?: EstClaimKind) =>
  kind === 'instrument' ? heldInstruments[pool] : kind === 'effect' ? held[pool] - heldInstruments[pool] : held[pool];

/** Tests only: forget every claim. */
export function resetEstBudgetForTests() {
  held.live = 0;
  held.offline = 0;
  heldInstruments.live = 0;
  heldInstruments.offline = 0;
  heldPages.live = 0;
  heldPages.offline = 0;
}
