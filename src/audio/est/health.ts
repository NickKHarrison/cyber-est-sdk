/**
 * 1.338 (R-G, `Cyber_EST_Robustness_Work_Order.md`): **load and health visibility**. The processor
 * posts `stats` at 2 Hz (`estProcessor.ts` `postStats`: the blocks of the window, their mean and
 * worst cost in µs on a 1 ms clock, the output samples the host limited); `EstNode.ts` hands every
 * one here (`noteEstStats`), and this file keeps a light per-instance table: the mean and worst
 * block cost, the faults summed, the watchdog's last reason, the memory pages the instance claimed.
 *
 * Rows are keyed by the instance's worklet node (what a live handle's `outputNode()` returns, so
 * `status.ts`' `estHealthFor(stripId, slotId)` finds a slot's row without the insert naming it);
 * an offline render's node is never a row. A row an instance let go of is dropped
 * (`forgetEstHealth`), unless the watchdog stopped it: that row stays as a **ghost** (at most
 * `GHOSTS_KEPT`), so the card can say why it stopped after its node is gone.
 *
 * What hears the table (`onEstHealth`) is told at most every `EMIT_MS` (48 instances at 2 Hz would
 * be 96 calls a second): the card's readout and the master strip's meter write the DOM through refs
 * from it. A stall (`noteEstStall`, from `watchdog.ts`) is told at once, and so (1.405) is an overrun
 * (`noteEstOverrun`): each row counts the plugin time it has spent over budget in windows in a row
 * (`overMs`), which the watchdog reads to stop an instance that runs slowly without stopping the clock.
 *
 * The **project meter** (`estProjectLoad`) reads `budget.ts`' live pool: instances of 48, memory
 * pages of the pool, the three costliest plugins by name. Past `WARN_INSTANCES` (40) or
 * `WARN_PAGES_SHARE` (80 %) of the pool a notice says so **once** (`estLoadWarning`: the words of
 * `claimEst`'s refusal before the refusal comes), and is armed again once the project is back
 * under both.
 *
 * `EST_LIGHT`: in the App chunk (the DSP chip's tooltip and the master strip read it); it imports
 * only `budget.ts` and `library.ts` (for a plugin's name), both light.
 */
import { EST_LIVE_BUDGET, EST_LIVE_MEMORY_PAGES, estHeld, estHeldPages } from './budget';
import { estLibrary } from './library';
import { showAppNotice } from '@/lib/appMessage';

/** The processor's `stats` message, as this file reads it (`EstNode.ts`' `EstStats`, without importing it). */
export interface EstHealthStats { blocks: number; meanUs: number; maxUs: number; faults?: number }

/** What this file needs to know of the node a `stats` came from (an `AudioWorkletNode`; a test's stand-in). */
export interface EstHealthNode { context: { sampleRate: number } }

/** One running (or ghost) instance. */
export interface EstHealthRow {
  /** The instance's worklet node (the row's key). */
  node: EstHealthNode;
  /** Its `AudioContext` (the watchdog names a stall by context). */
  ctx: object;
  /** The plugin's id (`EstNodeOptions.pluginId`), '' for a fixture of the lab. */
  pluginId: string;
  /** The memory pages the instance may grow to (`maxMemoryPages`, what `claimEst` counted). */
  pages: number;
  /** The last window's mean block cost (µs), and its worst. */
  meanUs: number;
  maxUs: number;
  /** The worst block since the instance started (µs). */
  worstUs: number;
  /** Blocks counted since the start. */
  blocks: number;
  /** Output samples the host limited since the start (NaN, ±∞, beyond ±4). */
  faults: number;
  /** The sample rate its context runs at (the budget a block has). */
  sampleRate: number;
  /** Why the watchdog stopped it, or null while it has not. */
  stoppedWhy: string | null;
  /** `performance.now()` of the last stats (ms). */
  at: number;
  /** Creation order (the watchdog's "newest" is the highest on its context). */
  seq: number;
  /** The instance let go of (a ghost kept for its `stoppedWhy`). */
  gone: boolean;
  /**
   * 1.405 (MEDIUM-1): the time (ms of its own blocks) the instance has spent over budget in the
   * stats windows in a row up to the last (a window whose mean block is at least `OVERRUN_SHARE` of
   * the budget adds its blocks' time; any other window sets it back to 0). The watchdog stops the
   * instance past `OVERRUN_MS` (`watchdog.ts` `watchdogTick`).
   */
  overMs: number;
}

/** How often listeners hear the table at most (ms); a stall is told at once. */
export const EMIT_MS = 250;
/** Ghost rows (stopped by the watchdog, their instance gone) kept at most. */
export const GHOSTS_KEPT = 8;
/** The project warning: past this many live instances (of `EST_LIVE_BUDGET`). */
export const WARN_INSTANCES = 40;
/** The project warning: past this share of the live pool's memory pages. */
export const WARN_PAGES_SHARE = 0.8;
/** The card's bar turns red past this share of a block's budget. */
export const HOT_SHARE = 0.8;
/**
 * 1.405 (MEDIUM-1): a stats window whose mean block costs at least this share of the block's budget
 * is over budget: the instance alone takes all the time the audio has, so the tab's sound breaks up.
 */
export const OVERRUN_SHARE = 1;
/**
 * 1.405: the plugin time over budget, in windows in a row, after which the watchdog stops the
 * instance (ms): a second of broken-up audio. A metered plugin can run slowly without its audio clock
 * stopping (a load that misses the cache every time, a denormal multiply: the meter charges a few
 * points for what takes tens or hundreds of nanoseconds), so the stall watchdog alone never sees it.
 */
export const OVERRUN_MS = 1000;
/** The render quantum: a block is 128 frames. */
export const BLOCK_FRAMES = 128;

/** The time a block has at `sampleRate` (µs): 2 667 at 48 kHz. */
export const blockBudgetUs = (sampleRate: number): number => (sampleRate > 0 ? (BLOCK_FRAMES / sampleRate) * 1e6 : (BLOCK_FRAMES / 48000) * 1e6);

/** A cost's share of the block's budget (0 … above 1), rounded to a hundredth. */
export const budgetShare = (meanUs: number, sampleRate: number): number => Math.round((Math.max(0, meanUs) / blockBudgetUs(sampleRate)) * 100) / 100;

/** The readout's level: hot past `HOT_SHARE` (said in words and shown in colour, never colour alone). */
export const healthLevel = (share: number): 'ok' | 'hot' => (share >= HOT_SHARE ? 'hot' : 'ok');

/** The readout's words: "312 µs a block · 12 %" (the clock is 1 ms, so a cost under it reads as 0). */
export function healthWords(row: Pick<EstHealthRow, 'meanUs' | 'sampleRate'>): string {
  const share = budgetShare(row.meanUs, row.sampleRate);
  return `${Math.round(row.meanUs)} µs a block · ${Math.round(share * 100)} %`;
}

/** The meter's text alternative ("312 µs a block, 12 % of the budget; heavy" past `HOT_SHARE`). */
export function healthValueText(row: Pick<EstHealthRow, 'meanUs' | 'sampleRate'>): string {
  const share = budgetShare(row.meanUs, row.sampleRate);
  return `${Math.round(row.meanUs)} µs a block, ${Math.round(share * 100)} % of the budget${healthLevel(share) === 'hot' ? '; heavy' : ''}`;
}

const rows = new Map<EstHealthNode, EstHealthRow>();
const listeners = new Set<() => void>();
let seq = 0;
let version = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
let timeNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const emitNow = () => {
  if (pending) { clearTimeout(pending); pending = null; }
  version++;
  for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } }
};
const emitSoon = () => {
  if (pending) return;
  pending = setTimeout(emitNow, EMIT_MS);
};

/** Hear the table change (at most every `EMIT_MS`; a stall at once). Returns the unsubscribe. */
export function onEstHealth(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A counter that moves with every emission (`useSyncExternalStore`'s snapshot). */
export const estHealthVersion = (): number => version;

/**
 * A `stats` message from `node` (`EstNode.ts`, every instance). `info` names the plugin and its
 * pages (the node's options); `offline` (an offline render's node) is never a row.
 */
export function noteEstStats(node: EstHealthNode, s: EstHealthStats, info: { pluginId?: string; pages?: number; offline?: boolean } = {}): void {
  if (info.offline || !node || !(s.blocks > 0)) return;
  let r = rows.get(node);
  if (!r) {
    let sampleRate = 48000;
    try { sampleRate = Number(node.context?.sampleRate) || 48000; } catch { /* a stand-in */ }
    r = {
      node, ctx: (node.context as object) ?? node, pluginId: info.pluginId ?? '', pages: Math.max(0, (info.pages ?? 0) | 0),
      meanUs: 0, maxUs: 0, worstUs: 0, blocks: 0, faults: 0, sampleRate, stoppedWhy: null, at: 0, seq: ++seq, gone: false, overMs: 0,
    };
    rows.set(node, r);
  }
  const mean = Number.isFinite(s.meanUs) ? Math.max(0, s.meanUs) : 0;
  const max = Number.isFinite(s.maxUs) ? Math.max(0, s.maxUs) : 0;
  r.meanUs = mean;
  r.maxUs = max;
  if (max > r.worstUs) r.worstUs = max;
  r.blocks += s.blocks;
  r.faults += Math.max(0, s.faults ?? 0) | 0;
  // 1.405 (MEDIUM-1): the run of windows over budget (the processor's clock is 1 ms, so a mean is
  // right over a window's many blocks, and a block of a slow plugin is a window of its own).
  r.overMs = mean >= blockBudgetUs(r.sampleRate) * OVERRUN_SHARE ? r.overMs + (s.blocks * mean) / 1000 : 0;
  r.at = timeNow();
  checkWarning();
  emitSoon();
}

/** The instance of `node` was disposed: its row goes, unless the watchdog stopped it (a ghost). */
export function forgetEstHealth(node: EstHealthNode): void {
  const r = rows.get(node);
  if (!r) return;
  if (!r.stoppedWhy) { rows.delete(node); emitSoon(); return; }
  r.gone = true;
  // Ghosts are few: the oldest goes past the cap.
  const ghosts = [...rows.values()].filter(x => x.gone).sort((a, b) => a.seq - b.seq);
  for (let i = 0; i + GHOSTS_KEPT < ghosts.length; i++) rows.delete(ghosts[i]!.node);
  emitSoon();
}

/**
 * The watchdog stopped the newest instance on `ctx` (`watchdog.ts`: it knows the context, not the
 * node; here the newest running row on that context is the same instance, both registered at its
 * attach). Told at once.
 */
export function noteEstStall(ctx: object, why: string): void {
  const newest = [...rows.values()].filter(r => r.ctx === ctx && !r.gone && !r.stoppedWhy).sort((a, b) => b.seq - a.seq)[0];
  if (newest) newest.stoppedWhy = why;
  emitNow();
}

/**
 * 1.405 (MEDIUM-1): the watchdog stopped the instance of `node` for running over budget (it knows the
 * node: `registerEstLive`'s). Told at once.
 */
export function noteEstOverrun(node: EstHealthNode, why: string): void {
  const r = rows.get(node);
  if (r && !r.stoppedWhy) { r.stoppedWhy = why; r.overMs = 0; }
  emitNow();
}

/** A node's row (running, or a ghost), or null. */
export const estHealthOf = (node: EstHealthNode | null | undefined): EstHealthRow | null => (node ? rows.get(node) ?? null : null);

/** Every running row (ghosts left out), newest last: Diagnostics' Plugins table, the meter's top three. */
export const estHealthRows = (): EstHealthRow[] => [...rows.values()].filter(r => !r.gone).sort((a, b) => a.seq - b.seq);

/** A plugin's name from the library, else its id, else "plugin" (a fixture of the lab). */
export function estHealthName(row: Pick<EstHealthRow, 'pluginId'>): string {
  if (!row.pluginId) return 'plugin';
  try {
    const hit = estLibrary().installed().find(i => i.ref.id === row.pluginId);
    return hit?.manifest.name || row.pluginId;
  } catch { return row.pluginId; }
}

export interface EstProjectLoad {
  /** Live instances claimed of the budget (`budget.ts`). */
  instances: number;
  of: number;
  /** Memory pages the live pool's instances declare, of the pool. */
  pages: number;
  pagesOf: number;
  /** The three costliest running plugins, by name and mean cost. */
  top: { name: string; meanUs: number; share: number }[];
  /** Every running instance's mean cost summed (µs a block). */
  totalUs: number;
}

/** The project meter's numbers (the master strip, the DSP chip's tooltip). */
export function estProjectLoad(): EstProjectLoad {
  const running = estHealthRows();
  const top = running.slice().sort((a, b) => b.meanUs - a.meanUs).slice(0, 3)
    .map(r => ({ name: estHealthName(r), meanUs: Math.round(r.meanUs), share: budgetShare(r.meanUs, r.sampleRate) }));
  return {
    instances: estHeld('live'), of: EST_LIVE_BUDGET, pages: estHeldPages('live'), pagesOf: EST_LIVE_MEMORY_PAGES,
    top, totalUs: Math.round(running.reduce((s, r) => s + r.meanUs, 0)),
  };
}

/** The project meter in words: "Plugins 3 of 48 · memory 2 %". */
export function projectLoadWords(p: Pick<EstProjectLoad, 'instances' | 'of' | 'pages' | 'pagesOf'>): string {
  return `Plugins ${p.instances} of ${p.of} · memory ${Math.round((p.pages / Math.max(1, p.pagesOf)) * 100)} %`;
}

/** The DSP chip's tooltip lines (none while no plugin runs and none is claimed). */
export function estLoadLines(p: EstProjectLoad = estProjectLoad()): string[] {
  if (p.instances === 0 && p.top.length === 0) return [];
  const lines = [`${projectLoadWords(p)} of the pool`];
  if (p.top.length) lines.push(`Costliest: ${p.top.map(t => `${t.name} ${t.meanUs} µs`).join(' · ')}`);
  return lines;
}

/**
 * The warning's words, with `claimEst`'s refusal as the card says it (`placeholderWords` 'budget':
 * "didn't start: too many plugins in this tab. The sound passes through."), or null while the
 * project is under both lines.
 */
export function estLoadWarning(instances: number, pages: number, of = EST_LIVE_BUDGET, pagesOf = EST_LIVE_MEMORY_PAGES): string | null {
  const many = instances > WARN_INSTANCES;
  const heavy = pages > pagesOf * WARN_PAGES_SHARE;
  if (!many && !heavy) return null;
  const what = many && heavy
    ? `${instances} plugins are running in this tab (of ${of}) and they claim ${Math.round((pages / pagesOf) * 100)} % of the plugin memory`
    : many ? `${instances} plugins are running in this tab (of ${of})`
      : `The plugins running in this tab claim ${Math.round((pages / pagesOf) * 100)} % of the plugin memory`;
  return `${what}. Past the limit the next one won't start: too many plugins in this tab, and the sound passes through it.`;
}

let warned = false;
let notice: (text: string) => void = showAppNotice;
/** Checked on every stats (2 Hz an instance): the notice once, armed again once the project is back under both lines. */
function checkWarning() {
  const text = estLoadWarning(estHeld('live'), estHeldPages('live'));
  if (!text) { warned = false; return; }
  if (warned) return;
  warned = true;
  try { notice(text); } catch { /* the page's problem */ }
}

/** Tests only: a slot's row as given (the UI's tests, where no plugin runs), by `strip|slot`; null takes it away. */
const overrides = new Map<string, EstHealthRow>();
export function setEstHealthOverrideForTests(stripId: string, slotId: string, row: Partial<EstHealthRow> | null): void {
  const k = `${stripId}|${slotId}`;
  if (!row) overrides.delete(k);
  else {
    const node: EstHealthNode = { context: { sampleRate: row.sampleRate ?? 48000 } };
    overrides.set(k, {
      node, ctx: node, pluginId: '', pages: 0, meanUs: 0, maxUs: 0, worstUs: 0, blocks: 0, faults: 0, sampleRate: 48000,
      stoppedWhy: null, at: 0, seq: 0, gone: false, overMs: 0, ...row,
    });
  }
  emitNow();
}
/** The test override of a slot, if one is set (`status.ts`' getter asks first). */
export const estHealthOverrideOf = (stripId: string, slotId: string): EstHealthRow | null => overrides.get(`${stripId}|${slotId}`) ?? null;

/** Tests only: forget every row, the warning's latch, and take the notice and the clock. */
export function resetEstHealthForTests(opts: { notice?: (text: string) => void; now?: () => number } = {}): void {
  if (pending) { clearTimeout(pending); pending = null; }
  rows.clear();
  overrides.clear();
  seq = 0;
  warned = false;
  notice = opts.notice ?? showAppNotice;
  timeNow = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
}
/** Tests only: tell the listeners now (what `EMIT_MS` would). */
export function flushEstHealthForTests(): void { if (pending) emitNow(); }
