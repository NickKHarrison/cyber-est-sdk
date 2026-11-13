/**
 * EST Phase 1 (docs/est/EST_Phase1_Work_Order.md §1.3): the `est-plugin` processor, the host-written
 * worklet that runs one WebAssembly module on the EST ABI (CLAP 1.2's model, WCLAP's module shape)
 * inside Cyber's graph.
 *
 * Serialised like Cyber's processors (CLAUDE.md, "Worklets are serialised to a Blob": no class
 * fields, no imports, nothing from outside `estProcessorMain`), but as **a second Blob module**,
 * registered by `ensureEstRuntime(ctx)` (`ensureEstRuntime.ts`), never concatenated into
 * `worklets.ts`'s combined module. Its two outside names are injected as source text ahead of it:
 * `EST_ABI` (the offsets of `est-abi-1.0.json`, `compactAbi()`) and `EST_BUILD_SHIM` (`shim.ts`).
 *
 * The life of an instance (spec §3.3, the single-thread model D-07: every CLAP "main-thread" call
 * runs here, outside `process()`, in the constructor or on a port message):
 *   the module (compiled on the main thread and passed in `processorOptions.module`, or compiled
 *   here from `processorOptions.bytes` when the page may not compile) → its imports checked
 *   against the allowlist (spec §3.1) → instantiated → the shim instantiated and its functions
 *   added to the plugin's table → the host structs written into the plugin's memory through its
 *   `malloc` → `clap_entry.init("/")` → the factory → `create_plugin` → `init` → the extensions →
 *   `activate(sampleRate, 128, 128)` → `start_processing` → `ready`.
 * Per block: the inputs are copied into the plugin's memory, the due events written as CLAP events,
 * `plugin.process` called, the outputs copied back. `process()` allocates nothing (est.test.ts).
 *
 * A trap in `process()` is caught: the instance is dead from then on, fades its last block out,
 * outputs silence, posts one `error`, and returns false a few blocks later. A non-returning
 * `process()` cannot be stopped from here (the Spin fixture; the security document §6), unless
 * the module is metered.
 *
 * EST Phase 2 (2-D, D-30): a **metered** module (one the install pipeline rewrote with
 * `install/estMeter.ts`, exporting `refuel` and `fuel_left`) is refuelled before every call into it:
 * `fuel.block` points before each `process()`, `fuel.call` before every other call (the lifecycle,
 * `malloc`, parameters, state). A loop that never ends then traps within its fuel, and the trap is
 * contained like any other. A module without the exports runs as before (the Phase 1 fixtures).
 *
 * EST tidy (1.286, D-43; spec §3.1): a module may export `_initialize()` (the WASI reactor
 * convention). It is called once, right after instantiation and before `clap_entry` is read, with
 * a block's fuel (`fuel.block`) on a metered module: a trap or running out of fuel there fails the
 * boot in phase `initialize` (the install refuses it, EST-W016). A start function stays refused
 * (EST-W015): it runs before the host can give any fuel.
 *
 * EST tidy (1.286, D-44): `processorOptions.logParams` lists the parameters est.json marks
 * `"scale": "log"`. Each such parameter with a range above 0 reports `scale: 'log'` in `ready`, and
 * a lane's 0…1 (`norm`) maps onto its range geometrically (`min · (max / min)^u`), so a lane's
 * midpoint is the geometric middle. Any other parameter is linear, as before.
 *
 * EST 1.1 (1.327, DEV-H, D-56; spec §3.4–§3.6), each off unless `processorOptions` asks, so a 1.0
 * bundle boots, allocates and processes exactly as before:
 * - `maxChannels` (2 by default; at most `MAX_CH`, 8): the main ports' channels the host reads. When
 *   the node has fewer output channels than the plugin writes (an effect on a stereo strip), the
 *   extra channels are summed into the node's (channel c into c mod the node's count), clamped as
 *   ever, and `ready.downmixed` says so (the card's warning).
 * - `sidechain` (1 or 2): the plugin's second input port, fed from the node's second input (`inputs[1]`,
 *   the strip's key), as a second `clap_audio_buffer` in `audio_inputs`.
 * - `notesOut`: the host routes the plugin's note output (`NOTE_ON`, `NOTE_OFF`, `NOTE_CHOKE`, `MIDI`
 *   pushed to `out_events`), so it is kept in a fixed buffer during `process()` whoever listens and
 *   posted soon after as one `notes` message, frames absolute (it allocates only when there were
 *   some, as `postParams`). Without it, DEV-F's rule (1.321) holds: kept only while the page listens
 *   (`notes:on`), at most 30 posts a second. One path for both (NOTE_OUT's comment).
 * - A `mod` event (any edition: a 1.0 host never sent one) becomes `CLAP_EVENT_PARAM_MOD` at its sample,
 *   its `amount` in the parameter's units (`norm`: a fraction of the range); `cancelMods` drops a
 *   parameter's queued ones.
 *
 * A state save past 4 MiB (spec §6) is refused as it is written and answered with its own error
 * ('the state is larger than 4 MiB'), so the install names it EST-C009 rather than EST-C020.
 *
 * 1.314 (LR-8b stream A; EST-01, EST-02, LCH-21 a): **the host's side of the sandbox.**
 * - `BLOCK_FUEL` is a real-time budget now that the meter charges by work (`estMeter.ts`): its
 *   comment has the calibration.
 * - Every host import a plugin can call (the WASI eight, and every `clap_host*` and stream callback
 *   the shim reaches, from `process()` or anywhere) **bounds its pointers and lengths** to the
 *   plugin's memory (`inMem`; a WASI call outside it answers EFAULT, 21) and **is charged** through
 *   `charge(cost)`; past the budget the host throws, which unwinds the plugin like a trap. So the
 *   host's own loops are bounded by the block's fuel whatever the plugin asks for
 *   (`random_get(ptr, 2^31)` was a seconds-long loop in host JavaScript outside the meter).
 *   Allocation-free. 1.405 (LOW-1): **every** callback is charged (the flag setters and the
 *   callbacks that answer 0 too), and on a metered module the charge comes out of the plugin's own
 *   fuel (the global, which every call in the plugin syncs), so the plugin and the host share one
 *   budget a block; before, the host kept a second budget of its own (`hostUsed`), which doubled the
 *   worst case. An unmetered module keeps that count.
 * - **The output is checked** on its way to the graph: a non-finite sample becomes 0 and every sample
 *   is clamped to ±4 (+12 dBFS, so the master limiter can still act), both counted in `faults`, posted
 *   with the stats (the card says "Output limited").
 * - The stats carry `points`, the fuel the plugin's own code used per block on average (the calibration
 *   reads it; 1.405: the host's charges, which come out of the same fuel, are left out).
 *
 * 1.410: **the processor stops a slow instance itself** (`SLOW_SHARE`, `SLOW_QUANTA`): a run of blocks
 * each using at least 90 % of its fuel, counted in the block times they took, reaching 32 stops it in
 * phase `slow` (bypassed: an effect passes its input, an instrument fades out); and an offline render's
 * instance stops once its own time passes `OFFLINE_GRACE_MS` + `OFFLINE_FACTOR` × the audio it rendered.
 */

import type { CompactAbi } from '../abi/layout';
import type { buildEstShim } from './shim';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
declare const EST_ABI: CompactAbi;
declare const EST_BUILD_SHIM: typeof buildEstShim;

/** The frames per block the runtime activates plugins with (Web Audio's render quantum). */
export const EST_BLOCK = 128;

export function estProcessorMain() {
  const A = EST_ABI.s;
  const C = EST_ABI.c;
  const STR = EST_ABI.str;
  const FRAMES = 128;
  /**
   * Queued events, each `EV` numbers: [frame, kind, CLAP type, payload…]; Phase 2: `queueSize` makes
   * it longer (an offline render's every lane event). EST Phase 3 (1.283): note expressions, MIDI and
   * timestamped transport events too, so a row is 18 numbers (a transport's is the longest: its
   * 14 numbers are `tr`'s layout, its anchor's place unused).
   *   K_NOTE  [3] note id, [4] port, [5] channel, [6] key, [7] velocity
   *   K_PARAM [3] param id, [4] value
   *   K_MOD   [3] param id, [4] amount (EST 1.1: CLAP_EVENT_PARAM_MOD)
   *   K_EXPR  [3] note id, [4] port, [5] channel, [6] key, [7] expression id, [8] value
   *   K_MIDI  [3] port, [4] status, [5] data 1, [6] data 2
   *   K_TR    [3…16] as `tr`: tempo, tempo_inc (per sample), beats, seconds, (anchor), flags (1
   *           playing, 2 loop), num, den, loop start, loop end (beats), bar start (beats), bar
   *           number, loop start, loop end (seconds)
   */
  const QUEUE = 1024;
  const QUEUE_MAX = 131072;
  const EV = 18;
  /** Events delivered in one block at most (the rest wait for the next). */
  const SLOTS = 256;
  /** Bytes per event slot: the largest pinned event (transport, 104) rounded up to 8. */
  const SLOT = 112;
  const OUT_PARAMS = 64;
  /** EST 1.1: the most channels on a main port (1.0 kept to 2 by `maxChannels`'s default). */
  const MAX_CH = 8;
  /**
   * The plugin's note output (DEV-F 1.321, EST 1.1 1.327: one path). The notes wait in between posts
   * (`NOTE_OUT` rows of `NOTE_OUT_W` numbers: frame, CLAP type, key or MIDI status, channel or data 1,
   * velocity or data 2, note id); a full buffer counts the rest as `dropped`. They are kept only while
   * the host routes them (`notesOut`) or the page listens (`notes:on`), and posted by purpose: every
   * `NOTE_POST_BLOCKS` blocks while routed (about 94 a second at 48 kHz: the next insert hears them
   * soon), else at most `NOTES_PER_SECOND` (a log: `est dev`, the golden renders); sooner when the
   * buffer is three quarters full.
   */
  const NOTE_OUT = 256;
  const NOTE_OUT_W = 6;
  const NOTE_POST_BLOCKS = 4;
  const NOTES_PER_SECOND = 30;
  const PAGE = 65536;
  const HARD_MAX_PAGES = 2048;
  const FADE_BLOCKS = 8;
  /** Output channels whose last sample a fault's fade starts from (a node has at most MAX_CH; the rest are spare). */
  const LAST_OUT_CHANNELS = 8;
  const WASI = ['clock_time_get', 'random_get', 'fd_write', 'proc_exit', 'args_get', 'args_sizes_get', 'environ_get', 'environ_sizes_get'];
  const K_NOTE = 1, K_PARAM = 2, K_EXPR = 3, K_MIDI = 4, K_TR = 5, K_MOD = 6;
  /** CLAP's note expression ids the page names (`clap/events.h`). */
  const EXPR_IDS: Record<string, number> = {
    volume: C.CLAP_NOTE_EXPRESSION_VOLUME, pan: C.CLAP_NOTE_EXPRESSION_PAN, tuning: C.CLAP_NOTE_EXPRESSION_TUNING,
    vibrato: C.CLAP_NOTE_EXPRESSION_VIBRATO, expression: C.CLAP_NOTE_EXPRESSION_EXPRESSION,
    brightness: C.CLAP_NOTE_EXPRESSION_BRIGHTNESS, pressure: C.CLAP_NOTE_EXPRESSION_PRESSURE,
  };
  /**
   * A metered module's default fuel: points per block, and per call outside `process()`.
   * 1.314 (EST-01): now that the meter charges by work (`estMeter.ts`: a loop header or a function
   * entry costs its body's weighted expression count, a bulk memory op a point a byte), `BLOCK_FUEL`
   * is a real-time budget: about 4× a 128-frame block at 48 kHz (2 667 µs) at the rate of the
   * reference plugin that spends points slowest per µs of its block. Measured on 2026-11-05 (stream
   * A's calibration: Node 22's V8, the `est-plugin` processor on a stand-in thread, 4 000 blocks each,
   * the fuel counted in the `global` placement so callees count): EST Gain 9 719 points a block in
   * 2.4 µs (about 4 000 a µs, the slowest: its block is mostly the host's copies), EST Delay 56 014 in
   * 3.0 µs (19 000 a µs), EST Synth 718 305 in 12.3 µs (58 000 a µs), EST Synth (AS) 1 024 062 in
   * 12.1 µs (85 000 a µs), EST EQ 1 023 402 in 5.7 µs (180 000 a µs: a per-band function entry
   * charges every branch of its body); a 16 MiB `memory.fill` 16 777 217 points in 0.7 ms (23 000
   * a µs). So 4 × 2 667 × 4 000 ≈ 42.7 M: `BLOCK_FUEL` is 41 943 040 (40 × 2^20), under which a
   * plugin can hold the audio thread for about 10 ms a block at EST Gain's rate, a fill loop for
   * about 1.8 ms, and EST EQ-like code for about 0.25 ms; the heaviest reference plugin uses a
   * fortieth of it. Re-measured on Chromium's audio rendering thread the same day
   * (`e2e/est-meter-cost.spec.ts`'s `pointsPerBlock` and `pointsPerUsPlugin`, Chromium 153, the real
   * `est-plugin` processor on an OfflineAudioContext, the plugin's own part of each block less the
   * host's copies): EST Gain 9 719 points in 1.9 µs (5 130 a µs, still the slowest), EST Delay 11 900,
   * EST Synth 47 100, EST Synth (AS) 54 800, EST EQ 120 000 a µs. At 5 130 a µs `BLOCK_FUEL` is about
   * 8.2 ms of plugin code, about 3× a block, under the 4× aimed at; the value stands. Since the review of #449 the `local` placement syncs the fuel around every call
   * (`estMeter.ts` `synced`), so a block's fuel bounds the whole call chain's work, exactly. `CALL_FUEL` is 16× (a lifecycle call may
   * do a block's set-up many times over).
   *
   * 1.405 (MEDIUM-1, the pre-review of 2026-11-09): the value stands; the meter's weights moved
   * instead (`estMeter.ts` `WEIGHT`, with every figure). The rule: no loop a plugin can write may
   * spend fewer than about 5 points a ns, so 41 943 040 points is at most about 41.9 M / 5 000 a µs
   * ≈ 8.4 ms ≈ 3.1 blocks; measured, the slowest priced pattern (an unaligned load across a page,
   * 3.8 points a ns) runs 11.0 ms = 4.1 blocks, a `sqrt(div)` vector chain 3.2, `memory.grow` 1.8
   * (it was 46). Two patterns no weight can price, a load that misses the cache and a multiply on a
   * denormal number, still run 5 to 325 blocks on one block's fuel; the watchdog stops an instance
   * whose blocks stay over budget for `OVERRUN_MS` (a second: `health.ts`, `watchdog.ts`). And the
   * host's own work comes out of this fuel too (`charge`, LOW-1). The shipped plugins under the new
   * weights (`estMeter.fuel.test.ts`: the seven reference plugins and the 27 catalogue bundles, an
   * instrument playing chords up to sixteen notes and the test phrase, an effect on the test loop,
   * at 48 kHz, with and without every parameter swept): the heaviest block is BREAKLAYER's 25 279 316
   * points with its parameters swept (60.3 % of `BLOCK_FUEL`; 25 080 798 before), then AMEN 25.2 M
   * (60.1 %), VOX CHOP 24.4 M (58.1 %), STRETCHER 21.4 M (51.1 %); the reference plugins at most
   * 1.46 M (EST Synth (AS), 3.5 %). The test holds every one under 75 %.
   */
  const BLOCK_FUEL = 41943040;
  const CALL_FUEL = 671088640;
  /**
   * 1.410: **the processor's own overrun stop** (1.405's open item: sooner than the watchdog's second).
   * The worklet scope has no `performance`, only `Date.now()` (whole ms, and it moves with preemption:
   * a 2.667 ms block reads 2 or 3 ms, a preempted one anything), so time alone cannot decide; the fuel
   * can, the same on every machine. A **heavy** block is one that used at least `SLOW_SHARE` (90 %) of
   * its fuel (the plugin's code and the host's charges, one budget since 1.405). A run of heavy blocks
   * in a row adds, for each, the block times it took by `Date.now()` (at least 1), and when the run
   * reaches `SLOW_QUANTA` (32) the instance is stopped: bypassed (an effect passes its input from the
   * next block, crossfaded from the last sample sent; an instrument fades out from it, as a fault does),
   * one `error` in phase `slow`, and `slow` (heavy blocks) in the stats. A block under 90 % ends the run.
   * - **No shipped plugin trips it:** `estMeter.fuel.test.ts` holds the 34 shipped bundles' heaviest
   *   block under 75 % of `BLOCK_FUEL`; measured, the heaviest is BREAKLAYER's swept 25 279 316 points,
   *   60.3 %. 90 % is 37 748 736 points: 1.49× that block, 12.5 M points over it, 6.3 M over the test's
   *   bound. Preemption alone cannot start a run: only a block already at 90 % of its fuel counts.
   * - **A hostile plugin is stopped in under a second of audio:** spending its fuel fast (a scalar loop,
   *   0.3 blocks of time a `BLOCK_FUEL`), 32 blocks = 32 × 128 / 48 000 = 85 ms (93 ms at 44.1 kHz); at
   *   the slowest priced pattern (4.1 blocks a `BLOCK_FUEL`, so 0.9 × 4.1 ≈ 3.7 a heavy block), about
   *   32 / 3.7 ≈ 9 blocks, 85 ms of wall time; cold cache misses (up to 325 blocks a `BLOCK_FUEL`, so
   *   a heavy block of about 290 block times, 780 ms) at the end of its first heavy block, where the
   *   watchdog needed two of its 500 ms looks.
   */
  const SLOW_SHARE = 0.9;
  const SLOW_QUANTA = 32;
  /**
   * 1.410: **an offline render's time budget** (an offline node has no watchdog: it is never a health
   * row). Per instance, the wall time of its own `process()` calls (summed by `Date.now()`: whole ms a
   * block, unbiased over many) may reach `OFFLINE_GRACE_MS` (2 s: the module's first compilation tiers,
   * a collection, the machine's other work) plus `OFFLINE_FACTOR` (4) × the audio it has rendered; past
   * that it is stopped as above (phase `slow`) and the render goes on without it. A plugin that plays
   * live keeps its mean block under one block of time (the watchdog stops it past that for a second),
   * so 4× is 4× its live ceiling; the shipped plugins' heaviest mean, HOOVER LAB's 7.28 M points
   * (17.4 % of `BLOCK_FUEL`), would be 0.174 × 4.1 ≈ 0.71 block times even if all its code ran at the
   * slowest priced rate, 5.6× under. A plugin at a cold cache's 866 ms a block is stopped after
   * 3 blocks (3 × 866 > 2 000 + 4 × 3 × 2.667), about 2.6 s into the render. So a render's EST
   * instance costs at most about 4× the song's length plus 2 s (the heavy run stops one sooner);
   * Cancel stays the bound on the rest.
   */
  const OFFLINE_FACTOR = 4;
  const OFFLINE_GRACE_MS = 2000;
  /**
   * A block whose two `Date.now()` reads are further apart than this did not spend that time in the
   * plugin: the machine slept, or the clock was stepped, inside it (`Date.now()` is the wall clock).
   * One block's fuel bounds the plugin's own work: the slowest pattern measured, a cold-cache chase,
   * is 325 blocks of time = 866 ms (BLOCK_FUEL's comment), so 10 s is 11.5 times the longest block a
   * plugin can make. Such a block's time is left out of the stats (the watchdog's `overMs` would
   * stop an innocent instance for a closed lid; a live plugin that truly holds the audio thread for
   * 10 s stops the audio clock, which the stall watchdog sees), counts one block time in a heavy run,
   * and counts as `SUSPEND_MS`, not more, in an offline render's budget (so a plugin that slow in
   * every block is still stopped by its first).
   */
  const SUSPEND_MS = 10000;
  /**
   * EST-02: the host's cost of a call. A call is `HOST_CALL`; a byte the host copies `HOST_BYTE`
   * (a typed-array loop, about a ns a byte, at the reference plugins' 6 000 points a µs), a byte of
   * `random_get` `HOST_RANDOM_BYTE` (`Math.random()` a byte: about ten times slower).
   */
  const HOST_CALL = 64;
  const HOST_BYTE = 8;
  const HOST_RANDOM_BYTE = 64;
  const EFAULT = 21;

  type Fn = (...args: number[]) => number;
  interface ParamInfo { id: number; name: string; module: string; min: number; max: number; def: number; flags: number; value: number; scale?: string }
  interface Options {
    module?: WebAssembly.Module;
    bytes?: ArrayBuffer;
    shim?: WebAssembly.Module;
    pluginId?: string;
    maxMemoryPages?: number;
    /** Measurement only: copy the block in and out of the plugin's memory without calling it. */
    copyOnly?: boolean;
    statsIntervalMs?: number;
    /** A metered module's fuel per `process()` (`block`) and per other call (`call`). */
    fuel?: { block?: number; call?: number };
    /** EST Phase 2: 'offline' sets `clap.render` OFFLINE before `activate`, where the plugin has the extension. */
    renderMode?: string;
    /** EST Phase 2: a state stream loaded right after boot, before `ready` (an offline render cannot wait for a reply). */
    state?: ArrayBuffer;
    /** EST Phase 2: events queued right after the state, in time order (an offline render's whole list). */
    events?: InEvent[];
    /** EST Phase 2: the event queue's length (default 1024, at most QUEUE_MAX). */
    queueSize?: number;
    /** EST tidy (1.286): the ids est.json marks `"scale": "log"` (a range above 0 maps a lane geometrically). */
    logParams?: number[];
    /** EST 1.1: the main ports' channels read at most (default 2, at most MAX_CH). */
    maxChannels?: number;
    /** EST 1.1: the sidechain input's channels (the plugin's input port 1), fed from the node's input 1; 0 or absent: none. */
    sidechain?: number;
    /** EST 1.1: post the plugin's note output (`notes` messages). */
    notesOut?: boolean;
  }
  /** `norm` (EST Phase 2): a `param` event's value is 0…1 over the parameter's range, mapped here (a stepped one rounded). */
  type InEvent = {
    type?: string; time?: number; key?: number; channel?: number; port?: number; noteId?: number; velocity?: number; id?: number; value?: number; norm?: boolean;
    tempo?: number; beat?: number; playing?: boolean; num?: number; den?: number;
    /** EST Phase 3: a note expression's name (`EXPR_IDS`); a MIDI event's three bytes. */
    expression?: string | number; data?: number[];
    /** EST 1.1: a `mod` event's amount (plain units; with `norm`, a fraction of the parameter's range). */
    amount?: number;
    /** EST Phase 3: a transport's tempo at the end of its window (`until` s later: a ramp), song seconds, loop, bar. */
    tempoEnd?: number; until?: number; seconds?: number; loopStart?: number; loopEnd?: number; loopStartSeconds?: number; loopEndSeconds?: number; barStart?: number; barNumber?: number;
  };

  class EstProcessor extends AudioWorkletProcessor {
    declare dead: boolean;
    declare disposed: boolean;
    declare keep: number;
    declare errorPosted: boolean;
    declare phase: string;
    declare compiledIn: string;
    declare copyOnly: boolean;
    declare maxPages: number;
    declare mem: WebAssembly.Memory;
    declare buf: ArrayBuffer;
    declare dv: DataView;
    declare u8: Uint8Array;
    declare table: WebAssembly.Table;
    declare malloc: Fn;
    declare refuel: Fn | null;
    declare fuelLeft: Fn | null;
    declare blockFuel: number;
    declare callFuel: number;
    /** 1.314 (EST-02): the host's own spend since the last fuel-up, and the budget it may reach (1.405: an unmetered module's only). */
    declare hostUsed: number;
    declare hostMax: number;
    /** 1.405 (LOW-1): every point the host has taken from a metered plugin's fuel, summed (the stats' `points` leave it out). */
    declare hostSpent: number;
    /** 1.314: fuel used over the stats window (a metered module); output samples the host limited (LCH-21 a): not finite, and beyond ±4. */
    declare statPoints: number;
    declare statNonFinite: number;
    declare statClipped: number;
    /** 1.314: the loudest sample the plugin wrote over the stats window, before the clamp (the conformance run's +18 dBFS check). */
    declare statPeak: number;
    declare shimBase: number;
    declare shimNames: string[];
    declare entry: number;
    declare plugin: number;
    declare host: number;
    declare procPtr: number;
    declare inEvPtr: number;
    declare outEvPtr: number;
    declare slotsPtr: number;
    declare scratch: number;
    declare transportPtr: number;
    declare audioIn: number;
    declare audioOut: number;
    declare inChPtr: number[];
    declare outChPtr: number[];
    declare inCh: Float32Array[];
    declare outCh: Float32Array[];
    /** The last sample each output channel sent (a trap's fade starts there: no step, no click). */
    declare lastOut: Float32Array;
    declare nIn: number;
    declare nOut: number;
    declare notePorts: number;
    declare fnProcess: Fn;
    declare fnMainThread: Fn;
    declare ext: Record<string, number>;
    declare hostExt: number[][];
    declare params: ParamInfo[];
    declare q: Float64Array;
    declare qLen: number;
    declare evCount: number;
    declare outParams: Float64Array;
    declare outParamLen: number;
    declare noteEnds: number;
    declare noteOutPorts: number;
    declare notesOn: boolean;
    declare notesPostedAt: number;
    declare blockFrames: number;
    declare tr: Float64Array;
    declare trSet: boolean;
    declare trDirty: boolean;
    declare steady: number;
    declare restart: boolean;
    declare callback: boolean;
    declare statSum: number;
    declare statMax: number;
    declare statBlocks: number;
    /** DEV-I (1.324): how many blocks `process()` has been called for, so a fault names its block (the crash record). */
    declare blockNo: number;
    declare statLast: number;
    declare statEvery: number;
    declare logLines: number;
    declare streamIn: Uint8Array | null;
    declare streamPos: number;
    declare streamOut: number[];
    declare idBytes: Uint8Array[];
    declare idNames: string[];
    declare qMax: number;
    declare logIds: number[];
    declare stateOver: boolean;
    /** EST 1.1: the channel cap, the sidechain's buffer and channels, the note output kept this block. */
    declare chCap: number;
    declare scWant: number;
    declare nSc: number;
    declare scIn: number;
    declare scChPtr: number[];
    declare scCh: Float32Array[];
    declare notesOut: boolean;
    declare noteOut: Float64Array;
    declare noteOutLen: number;
    /** Notes past a full buffer since the last post (sent as `dropped`). */
    declare noteOutDrop: number;
    declare noteBlocks: number;
    declare downmixed: boolean;
    /** 1.410: the fuel a heavy block reaches (`SLOW_SHARE` of `blockFuel`), the run of heavy blocks in block times, heavy blocks over the stats window. */
    declare slowAt: number;
    declare slowRun: number;
    declare statSlow: number;
    /** 1.410: stopped for being too slow (`slow` phase): bypassed from the next block on, crossfaded once (`slowFade`). */
    declare slowStop: boolean;
    declare slowFade: boolean;
    /** 1.410: an offline render's instance: its own `process()` time (ms) and the frames it rendered. */
    declare offline: boolean;
    declare offSpentMs: number;
    declare offFrames: number;

    constructor(options?: unknown) {
      super(options);
      const o = ((options as { processorOptions?: Options } | undefined)?.processorOptions ?? {}) as Options;
      this.dead = true;
      this.disposed = false;
      this.keep = 0;
      this.errorPosted = false;
      this.phase = 'load';
      this.compiledIn = 'none';
      this.copyOnly = !!o.copyOnly;
      this.maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, o.maxMemoryPages ?? 256));
      this.refuel = null;
      this.fuelLeft = null;
      const fuelOf = (v: number | undefined, d: number) => (typeof v === 'number' && v >= 1 ? Math.min(2147483647, Math.floor(v)) : d);
      this.blockFuel = fuelOf(o.fuel?.block, BLOCK_FUEL);
      this.callFuel = fuelOf(o.fuel?.call, CALL_FUEL);
      this.hostUsed = 0;
      this.hostMax = this.callFuel;
      this.hostSpent = 0;
      this.slowAt = this.blockFuel * SLOW_SHARE;
      this.slowRun = 0;
      this.statSlow = 0;
      this.slowStop = false;
      this.slowFade = false;
      this.offline = o.renderMode === 'offline';
      this.offSpentMs = 0;
      this.offFrames = 0;
      this.statPoints = 0;
      this.statNonFinite = 0;
      this.statClipped = 0;
      this.statPeak = 0;
      this.logIds = Array.isArray(o.logParams) ? o.logParams.filter(x => typeof x === 'number') : [];
      this.stateOver = false;
      this.chCap = Math.max(1, Math.min(MAX_CH, Math.floor(o.maxChannels ?? 2)));
      this.scWant = o.sidechain === 1 || o.sidechain === 2 ? o.sidechain : 0;
      this.nSc = 0;
      this.scIn = 0;
      this.scChPtr = [];
      this.scCh = [];
      this.notesOut = o.notesOut === true;
      this.noteOut = new Float64Array(NOTE_OUT * NOTE_OUT_W);
      this.noteOutLen = 0;
      this.noteOutDrop = 0;
      this.noteBlocks = 0;
      this.downmixed = false;
      this.qMax = Math.max(QUEUE, Math.min(QUEUE_MAX, Math.floor(o.queueSize ?? QUEUE)));
      this.q = new Float64Array(this.qMax * EV);
      this.qLen = 0;
      this.evCount = 0;
      this.outParams = new Float64Array(OUT_PARAMS * 2);
      this.outParamLen = 0;
      this.noteEnds = 0;
      this.noteOutPorts = 0;
      this.notesOn = false;
      this.notesPostedAt = 0;
      this.blockFrames = 0;
      // Transport (EST Phase 3): [tempo, tempo_inc, beats, seconds, anchor frame, flags, num, den, loop start, loop end, bar start, bar number, loop start s, loop end s]
      this.tr = new Float64Array(14);
      this.trSet = false;
      this.trDirty = false;
      this.steady = 0;
      this.restart = false;
      this.callback = false;
      this.statSum = 0;
      this.statMax = 0;
      this.statBlocks = 0;
      this.blockNo = 0;
      this.statLast = Date.now();
      this.statEvery = o.statsIntervalMs ?? 500;
      this.logLines = 0;
      this.streamIn = null;
      this.streamPos = 0;
      this.streamOut = [];
      this.ext = {};
      this.hostExt = [];
      this.params = [];
      this.inCh = [];
      this.outCh = [];
      this.lastOut = new Float32Array(LAST_OUT_CHANNELS);
      this.inChPtr = [];
      this.outChPtr = [];
      this.nIn = 0;
      this.nOut = 0;
      this.notePorts = 0;
      this.port.onmessage = (e: MessageEvent) => this.onMessage(e.data as { type?: string });
      const t0 = Date.now();
      try {
        this.boot(o);
        this.dead = false;
        // EST Phase 2: the saved state, then the events, before `ready` (outside process()).
        this.phase = 'state';
        if (o.state && o.state.byteLength && !this.loadState(new Uint8Array(o.state))) throw new Error('the plugin refused the state');
        for (const p of this.params) p.value = this.paramValue(p.id);
        this.phase = 'events';
        const initial = Array.isArray(o.events) ? o.events : [];
        for (let i = 0; i < initial.length; i++) this.queue(initial[i]!);
        this.phase = 'process';
        this.port.postMessage({
          type: 'ready', params: this.params, latency: this.latency(), tail: this.tail(), compiledIn: this.compiledIn,
          audioIn: this.nIn, audioOut: this.nOut, notePorts: this.notePorts, noteOutPorts: this.noteOutPorts,
          // EST 1.1: present only when asked for, so a 1.0 bundle's ready is as before.
          ...(this.scWant ? { sidechainIn: this.nSc } : {}),
          bootMs: Date.now() - t0, copyOnly: this.copyOnly, metered: !!this.refuel,
        });
      } catch (err) {
        this.fail(this.phase, err);
      }
    }

    // --- Boot -----------------------------------------------------------------------------

    boot(o: Options) {
      let module = o.module;
      this.phase = 'compile';
      if (module) this.compiledIn = 'main';
      else {
        if (!o.bytes) throw new Error('no module and no bytes in processorOptions');
        module = new WebAssembly.Module(o.bytes);
        this.compiledIn = 'worklet';
      }
      this.phase = 'validate';
      const imports = WebAssembly.Module.imports(module);
      for (let i = 0; i < imports.length; i++) {
        const im = imports[i]!;
        if (im.module !== 'wasi_snapshot_preview1' || im.kind !== 'function' || WASI.indexOf(im.name) < 0) {
          throw new Error(`the module imports ${im.module}.${im.name} (${im.kind}), which EST does not allow`);
        }
      }
      const exports = WebAssembly.Module.exports(module);
      const kinds: Record<string, string> = {};
      let tables = 0;
      for (let i = 0; i < exports.length; i++) {
        const ex = exports[i]!;
        kinds[ex.name] = ex.kind;
        if (ex.kind === 'table') tables++;
      }
      if (kinds.clap_entry !== 'global') throw new Error('the module does not export clap_entry as a global');
      if (kinds.malloc !== 'function' || kinds.free !== 'function') throw new Error('the module does not export malloc and free');
      if (kinds.memory !== 'memory') throw new Error('the module does not export its memory');
      if (tables !== 1) throw new Error(`the module exports ${tables} tables, not one`);
      this.phase = 'instantiate';
      const inst = new WebAssembly.Instance(module, { wasi_snapshot_preview1: this.wasi() });
      const ex = inst.exports as Record<string, unknown>;
      this.mem = ex.memory as WebAssembly.Memory;
      for (const k in ex) if (ex[k] instanceof WebAssembly.Table) this.table = ex[k] as WebAssembly.Table;
      if (this.mem.buffer.byteLength > this.maxPages * PAGE) throw new Error(`the module starts with ${this.mem.buffer.byteLength / PAGE} pages, over its limit of ${this.maxPages}`);
      this.malloc = ex.malloc as Fn;
      this.refuel = typeof ex.refuel === 'function' && typeof ex.fuel_left === 'function' ? ex.refuel as Fn : null;
      this.fuelLeft = this.refuel ? ex.fuel_left as Fn : null;
      this.refreshViews();
      // EST tidy (1.286, D-43): the optional `_initialize()` (WASI's reactor convention), once, under a block's fuel.
      if (kinds._initialize !== undefined) {
        if (kinds._initialize !== 'function') throw new Error('the module exports _initialize, but not as a function');
        this.phase = 'initialize';
        this.fuelUp(this.blockFuel);
        (ex._initialize as Fn)();
        this.refreshViews();
        if (this.mem.buffer.byteLength > this.maxPages * PAGE) throw new Error(`the module grew to ${this.mem.buffer.byteLength / PAGE} pages in _initialize, over its limit of ${this.maxPages}`);
      }
      this.entry = (ex.clap_entry as WebAssembly.Global).value as number;
      this.phase = 'shim';
      const shimModule = o.shim ?? new WebAssembly.Module(EST_BUILD_SHIM(EST_ABI.sig));
      const shim = new WebAssembly.Instance(shimModule, { h: this.hostImports() });
      this.shimNames = Object.keys(EST_ABI.sig).sort();
      this.shimBase = this.table.grow(this.shimNames.length);
      for (let i = 0; i < this.shimNames.length; i++) this.table.set(this.shimBase + i, shim.exports[this.shimNames[i]!] as unknown as Fn);
      this.idNames = [STR.CLAP_EXT_PARAMS, STR.CLAP_EXT_STATE, STR.CLAP_EXT_LATENCY, STR.CLAP_EXT_TAIL, STR.CLAP_EXT_LOG, STR.CLAP_EXT_THREAD_CHECK, STR.CLAP_EXT_AUDIO_PORTS, STR.CLAP_EXT_NOTE_PORTS];
      this.idBytes = this.idNames.map(s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; });
      this.phase = 'host';
      this.writeHost();
      this.phase = 'init';
      const entry = this.entry;
      if (this.dv.getUint32(entry + A.clap_plugin_entry.clap_version + A.clap_version.major, true) < 1) throw new Error('the module\'s clap_version is before 1.0');
      if (!this.call(entry + A.clap_plugin_entry.init, this.cstr('/'))) throw new Error('clap_entry.init returned false');
      const factory = this.call(entry + A.clap_plugin_entry.get_factory, this.cstr(STR.CLAP_PLUGIN_FACTORY_ID));
      if (!factory) throw new Error('the module has no clap.plugin-factory');
      const count = this.call(factory + A.clap_plugin_factory.get_plugin_count, factory);
      let descId = 0;
      for (let i = 0; i < count && !descId; i++) {
        const desc = this.call(factory + A.clap_plugin_factory.get_plugin_descriptor, factory, i);
        if (!desc) continue;
        const idPtr = this.dv.getUint32(desc + A.clap_plugin_descriptor.id, true);
        if (!o.pluginId || this.readCString(idPtr) === o.pluginId) descId = idPtr;
      }
      if (!descId) throw new Error(o.pluginId ? `the factory has no plugin ${o.pluginId}` : 'the factory has no plugin');
      this.plugin = this.call(factory + A.clap_plugin_factory.create_plugin, factory, this.host, descId);
      if (!this.plugin) throw new Error('create_plugin returned NULL');
      if (!this.pcall(A.clap_plugin.init)) throw new Error('plugin.init returned false');
      this.phase = 'extensions';
      for (let i = 0; i < this.idNames.length; i++) {
        const id = this.idNames[i]!;
        if (id === STR.CLAP_EXT_LOG || id === STR.CLAP_EXT_THREAD_CHECK) continue;
        this.ext[id] = this.pcall(A.clap_plugin.get_extension, this.cstr(id));
      }
      this.ext[STR.CLAP_EXT_RENDER] = this.pcall(A.clap_plugin.get_extension, this.cstr(STR.CLAP_EXT_RENDER));
      this.readPorts();
      // EST Phase 2: an offline render tells the plugin it need not keep to real time (clap.render).
      const render = this.ext[STR.CLAP_EXT_RENDER] ?? 0;
      if (o.renderMode === 'offline' && render) this.call(render + A.clap_plugin_render.set, this.plugin, C.CLAP_RENDER_OFFLINE);
      this.phase = 'activate';
      this.allocBlock();
      if (!this.pcallF(A.clap_plugin.activate, sampleRate, FRAMES, FRAMES)) throw new Error('plugin.activate returned false');
      if (!this.pcall(A.clap_plugin.start_processing)) throw new Error('plugin.start_processing returned false');
      this.fnProcess = this.fnAt(this.plugin + A.clap_plugin.process);
      this.fnMainThread = this.fnAt(this.plugin + A.clap_plugin.on_main_thread);
      this.phase = 'params';
      this.readParams();
      this.refreshViews();
      this.phase = 'process';
    }

    /**
     * 1.314 (EST-01, EST-02): fuel for the next call into the plugin, which (1.405) also pays for what
     * that call asks of the host (`charge`); an unmetered module's host budget is `n` apart. Every
     * refuel goes through here.
     */
    fuelUp(n: number) {
      this.hostUsed = 0;
      this.hostMax = n;
      if (this.refuel) this.refuel(n);
    }

    /**
     * 1.314 (EST-02): the host's cost of a call the plugin made. 1.405 (LOW-1): on a metered module
     * it comes out of **the plugin's own fuel**: since the review of #449 every call and
     * `call_indirect` in the plugin writes its fuel to the global before the call and reads it back
     * after (`estMeter.ts` `synced`), so while a host import runs the global holds what the plugin has
     * left; the host takes its cost from it (`fuel_left`, then `refuel` with the rest) and throws (a
     * trap, caught like any other) when it is not there. One budget a block for the plugin and the
     * host together, never two. An unmetered module (developer mode, the Phase 1 fixtures) keeps a
     * count of its own per fuel-up (`hostUsed` against `hostMax`). Allocation-free until the throw.
     */
    charge(cost: number) {
      if (this.fuelLeft) {
        const left = this.fuelLeft() - cost;
        if (left < 0) throw new Error('the plugin\'s host calls ran out of fuel');
        this.refuel!(left);
        this.hostSpent += cost;
        return;
      }
      this.hostUsed += cost;
      if (this.hostUsed > this.hostMax) throw new Error('the plugin\'s host calls ran out of fuel');
    }

    /** Whether `[ptr, ptr + n)` lies in the plugin's memory (unsigned; `n` at least 0). */
    inMem(ptr: number, n: number): boolean {
      return ptr >= 0 && n >= 0 && ptr + n <= this.u8.length;
    }

    /**
     * The allowlisted WASI subset (spec §3.1): no files, sockets or environment. 1.314 (EST-02): every
     * pointer and length is bounded to the memory (EFAULT otherwise) and the call is charged.
     */
    wasi(): Record<string, (...a: (number | bigint)[]) => number> {
      return {
        clock_time_get: (_id, _precision, out) => {
          this.refreshIfGrown();
          this.charge(HOST_CALL);
          const p = Number(out) >>> 0;
          if (!this.inMem(p, 8)) return EFAULT;
          this.dv.setBigUint64(p, BigInt(Date.now()) * 1000000n, true);
          return 0;
        },
        random_get: (ptr, len) => {
          this.refreshIfGrown();
          const p = Number(ptr) >>> 0, n = Number(len) >>> 0;
          this.charge(HOST_CALL + n * HOST_RANDOM_BYTE);
          if (!this.inMem(p, n)) return EFAULT;
          for (let i = 0; i < n; i++) this.u8[p + i] = (Math.random() * 256) | 0;
          return 0;
        },
        fd_write: (fd, iovs, n, written) => {
          this.refreshIfGrown();
          const v = Number(iovs) >>> 0, w = Number(written) >>> 0;
          let count = Number(n) >>> 0;
          // At most what the memory holds of the iovec list, and never past it.
          if (!this.inMem(v, 0) || !this.inMem(w, 4)) return EFAULT;
          const room = ((this.u8.length - v) / 8) | 0;
          if (count > room) count = room;
          this.charge(HOST_CALL + count * HOST_BYTE);
          let total = 0;
          for (let i = 0; i < count; i++) total += this.dv.getUint32(v + 8 * i + 4, true);
          this.dv.setUint32(w, total >>> 0, true);
          return fd === 1 || fd === 2 ? 0 : 8;
        },
        proc_exit: code => { throw new Error(`the plugin called proc_exit(${String(code)})`); },
        args_get: () => { this.charge(HOST_CALL); return 0; },
        args_sizes_get: (a, b) => this.twoZeroes(Number(a) >>> 0, Number(b) >>> 0),
        environ_get: () => { this.charge(HOST_CALL); return 0; },
        environ_sizes_get: (a, b) => this.twoZeroes(Number(a) >>> 0, Number(b) >>> 0),
      };
    }

    /** `args_sizes_get` and `environ_sizes_get`: two counts of 0, each pointer bounded. */
    twoZeroes(a: number, b: number): number {
      this.refreshIfGrown();
      this.charge(HOST_CALL);
      if (!this.inMem(a, 4) || !this.inMem(b, 4)) return EFAULT;
      this.dv.setUint32(a, 0, true);
      this.dv.setUint32(b, 0, true);
      return 0;
    }

    /**
     * What the shim's functions call: every host callback of the pinned structs. 1.405 (LOW-1): every
     * one is charged (`HOST_CALL` at least: a call from the plugin into the host costs its frame and
     * the shim's, about 8 ns), the ones that only set a flag and the ones that answer 0 included.
     */
    hostImports(): Record<string, (...a: (number | bigint)[]) => number | bigint | void> {
      const h: Record<string, (...a: (number | bigint)[]) => number | bigint | void> = {
        'clap_host.get_extension': (_host, id) => this.hostExtension(id as number),
        'clap_host.request_restart': () => { this.charge(HOST_CALL); this.restart = true; },
        'clap_host.request_process': () => { this.charge(HOST_CALL); },
        'clap_host.request_callback': () => { this.charge(HOST_CALL); this.callback = true; },
        'clap_input_events.size': () => { this.charge(HOST_CALL); return this.evCount; },
        'clap_input_events.get': (_list, i) => { this.charge(HOST_CALL); return ((i as number) >>> 0) < this.evCount ? this.slotsPtr + ((i as number) >>> 0) * SLOT : 0; },
        'clap_output_events.try_push': (_list, ev) => this.pushOut(ev as number),
        'clap_host_params.rescan': () => { this.charge(HOST_CALL); },
        'clap_host_params.clear': () => { this.charge(HOST_CALL); },
        'clap_host_params.request_flush': () => { this.charge(HOST_CALL); },
        'clap_host_state.mark_dirty': () => { this.charge(HOST_CALL); },
        'clap_host_latency.changed': () => { this.charge(HOST_CALL); },
        'clap_host_tail.changed': () => { this.charge(HOST_CALL); },
        'clap_host_log.log': (_host, severity, msg) => this.log(severity as number, msg as number),
        'clap_host_thread_check.is_main_thread': () => { this.charge(HOST_CALL); return 1; },
        'clap_host_thread_check.is_audio_thread': () => { this.charge(HOST_CALL); return 1; },
        'clap_host_audio_ports.is_rescan_flag_supported': () => { this.charge(HOST_CALL); return 0; },
        'clap_host_audio_ports.rescan': () => { this.charge(HOST_CALL); },
        'clap_host_note_ports.supported_dialects': () => { this.charge(HOST_CALL); return C.CLAP_NOTE_DIALECT_CLAP; },
        'clap_host_note_ports.rescan': () => { this.charge(HOST_CALL); },
        'clap_istream.read': (_s, ptr, size) => this.streamRead(ptr as number, size as bigint),
        'clap_ostream.write': (_s, ptr, size) => this.streamWrite(ptr as number, size as bigint),
      };
      // A callback the table names and this host does not implement answers 0, charged like the rest.
      const zero = () => { this.charge(HOST_CALL); return 0; };
      const zero64 = () => { this.charge(HOST_CALL); return 0n; };
      for (const k in EST_ABI.sig) if (!h[k]) h[k] = /->i64$/.test(EST_ABI.sig[k]!) ? zero64 : zero;
      return h;
    }

    /** `clap_host` and the host's extension structs, in the plugin's memory. */
    writeHost() {
      this.host = this.zalloc(A.clap_host.$size);
      const h = this.host, dv = this.dv;
      // malloc may have grown the memory: every write below goes through this.dv afresh.
      dv.setUint32(h + A.clap_host.clap_version + A.clap_version.major, C.CLAP_VERSION_MAJOR, true);
      this.dv.setUint32(h + A.clap_host.clap_version + A.clap_version.minor, C.CLAP_VERSION_MINOR, true);
      this.dv.setUint32(h + A.clap_host.clap_version + A.clap_version.revision, C.CLAP_VERSION_REVISION, true);
      const name = this.cstr('EST host'), vendor = this.cstr('Cyber'), url = this.cstr(''), version = this.cstr('1.0.0');
      this.dv.setUint32(h + A.clap_host.name, name, true);
      this.dv.setUint32(h + A.clap_host.vendor, vendor, true);
      this.dv.setUint32(h + A.clap_host.url, url, true);
      this.dv.setUint32(h + A.clap_host.version, version, true);
      this.fillFns(h, 'clap_host');
      const exts: [string, string][] = [
        [STR.CLAP_EXT_PARAMS, 'clap_host_params'], [STR.CLAP_EXT_STATE, 'clap_host_state'], [STR.CLAP_EXT_LATENCY, 'clap_host_latency'],
        [STR.CLAP_EXT_TAIL, 'clap_host_tail'], [STR.CLAP_EXT_LOG, 'clap_host_log'], [STR.CLAP_EXT_THREAD_CHECK, 'clap_host_thread_check'],
        [STR.CLAP_EXT_AUDIO_PORTS, 'clap_host_audio_ports'], [STR.CLAP_EXT_NOTE_PORTS, 'clap_host_note_ports'],
      ];
      this.hostExt = [];
      for (let k = 0; k < exts.length; k++) {
        const id = exts[k]![0], struct = exts[k]![1];
        const ptr = this.zalloc((A as unknown as Record<string, { $size: number }>)[struct]!.$size);
        this.fillFns(ptr, struct);
        this.hostExt.push([this.idNames.indexOf(id), ptr]);
      }
      this.inEvPtr = this.zalloc(A.clap_input_events.$size);
      this.fillFns(this.inEvPtr, 'clap_input_events');
      this.outEvPtr = this.zalloc(A.clap_output_events.$size);
      this.fillFns(this.outEvPtr, 'clap_output_events');
      this.scratch = this.zalloc(Math.max(A.clap_param_info.$size, A.clap_audio_port_info.$size, A.clap_note_port_info.$size, A.clap_istream.$size, A.clap_ostream.$size, 16));
    }

    /** Write the shim's table index of every `struct.field` callback into the struct at `ptr`. */
    fillFns(ptr: number, struct: string) {
      const row = (A as unknown as Record<string, Record<string, number>>)[struct]!;
      for (let i = 0; i < this.shimNames.length; i++) {
        const n = this.shimNames[i]!;
        if (n.slice(0, struct.length + 1) !== `${struct}.`) continue;
        this.dv.setUint32(ptr + row[n.slice(struct.length + 1)]!, this.shimBase + i, true);
      }
    }

    readPorts() {
      const ap = this.ext[STR.CLAP_EXT_AUDIO_PORTS] ?? 0;
      const info = this.scratch;
      const channels = (isInput: number, index = 0, cap = this.chCap) => {
        if (!ap) return 0;
        const n = this.call(ap + A.clap_plugin_audio_ports.count, this.plugin, isInput);
        if (n < index + 1) return 0;
        if (!this.call(ap + A.clap_plugin_audio_ports.get, this.plugin, index, isInput, info)) return 0;
        return Math.min(cap, this.dv.getUint32(info + A.clap_audio_port_info.channel_count, true));
      };
      this.nIn = channels(1);
      this.nOut = channels(0);
      // EST 1.1: the sidechain is the plugin's input port 1 (at most stereo), only when asked for.
      this.nSc = this.scWant && this.nIn ? channels(1, 1, this.scWant) : 0;
      if (this.nOut < 1) throw new Error('the plugin declares no audio output port');
      const np = this.ext[STR.CLAP_EXT_NOTE_PORTS] ?? 0;
      this.notePorts = np ? this.call(np + A.clap_plugin_note_ports.count, this.plugin, 1) : 0;
      this.noteOutPorts = np ? this.call(np + A.clap_plugin_note_ports.count, this.plugin, 0) : 0;
    }


    /** The process struct, its audio buffers, the event slots and the transport, preallocated. */
    allocBlock() {
      const CH = this.chCap;
      this.procPtr = this.zalloc(A.clap_process.$size);
      // EST 1.1: with a sidechain, `audio_inputs` is an array of two buffers (the main, then the key).
      this.audioIn = this.zalloc(A.clap_audio_buffer.$size * (this.nSc ? 2 : 1));
      this.audioOut = this.zalloc(A.clap_audio_buffer.$size);
      const inPtrs = this.zalloc(4 * CH), outPtrs = this.zalloc(4 * CH);
      this.inChPtr = [];
      this.outChPtr = [];
      for (let c = 0; c < CH; c++) {
        this.inChPtr.push(this.zalloc(4 * FRAMES));
        this.outChPtr.push(this.zalloc(4 * FRAMES));
      }
      if (this.nSc) {
        const scPtrs = this.zalloc(4 * 2);
        this.scChPtr = [];
        for (let c = 0; c < this.nSc; c++) {
          this.scChPtr.push(this.zalloc(4 * FRAMES));
          this.dv.setUint32(scPtrs + 4 * c, this.scChPtr[c]!, true);
        }
        this.scIn = this.audioIn + A.clap_audio_buffer.$size;
        this.dv.setUint32(this.scIn + A.clap_audio_buffer.data32, scPtrs, true);
        this.dv.setUint32(this.scIn + A.clap_audio_buffer.channel_count, this.nSc, true);
      }
      this.slotsPtr = this.zalloc(SLOTS * SLOT);
      this.transportPtr = this.zalloc(A.clap_event_transport.$size);
      const dv = () => this.dv;
      for (let c = 0; c < CH; c++) {
        dv().setUint32(inPtrs + 4 * c, this.inChPtr[c]!, true);
        dv().setUint32(outPtrs + 4 * c, this.outChPtr[c]!, true);
      }
      const B = A.clap_audio_buffer;
      dv().setUint32(this.audioIn + B.data32, inPtrs, true);
      dv().setUint32(this.audioIn + B.channel_count, this.nIn, true);
      dv().setUint32(this.audioOut + B.data32, outPtrs, true);
      dv().setUint32(this.audioOut + B.channel_count, this.nOut, true);
      const P = A.clap_process;
      const p = this.procPtr;
      dv().setUint32(p + P.frames_count, FRAMES, true);
      dv().setUint32(p + P.transport, 0, true);
      dv().setUint32(p + P.audio_inputs, this.nIn ? this.audioIn : 0, true);
      dv().setUint32(p + P.audio_inputs_count, this.nIn ? (this.nSc ? 2 : 1) : 0, true);
      dv().setUint32(p + P.audio_outputs, this.audioOut, true);
      dv().setUint32(p + P.audio_outputs_count, 1, true);
      dv().setUint32(p + P.in_events, this.inEvPtr, true);
      dv().setUint32(p + P.out_events, this.outEvPtr, true);
    }

    readParams() {
      const pe = this.ext[STR.CLAP_EXT_PARAMS] ?? 0;
      this.params = [];
      if (!pe) return;
      const n = this.call(pe + A.clap_plugin_params.count, this.plugin);
      const info = this.scratch, I = A.clap_param_info;
      for (let i = 0; i < n; i++) {
        if (!this.call(pe + A.clap_plugin_params.get_info, this.plugin, i, info)) continue;
        const id = this.dv.getUint32(info + I.id, true);
        const p: ParamInfo = {
          id,
          name: this.readCString(info + I.name, C.CLAP_NAME_SIZE),
          module: this.readCString(info + I.module, C.CLAP_PATH_SIZE),
          min: this.dv.getFloat64(info + I.min_value, true),
          max: this.dv.getFloat64(info + I.max_value, true),
          def: this.dv.getFloat64(info + I.default_value, true),
          flags: this.dv.getUint32(info + I.flags, true),
          value: 0,
        };
        // EST tidy (1.286): a log scale only over a range above 0 (and not stepped); otherwise linear.
        if (this.logIds.indexOf(id) >= 0 && p.min > 0 && p.max > p.min && !(p.flags & C.CLAP_PARAM_IS_STEPPED)) p.scale = 'log';
        this.params.push(p);
      }
      for (const p of this.params) p.value = this.paramValue(p.id);
    }

    paramValue(id: number): number {
      const pe = this.ext[STR.CLAP_EXT_PARAMS] ?? 0;
      if (!pe) return NaN;
      const out = this.scratch;
      if (!this.call(pe + A.clap_plugin_params.get_value, this.plugin, id, out)) return NaN;
      return this.dv.getFloat64(out, true);
    }

    latency(): number {
      const e = this.ext[STR.CLAP_EXT_LATENCY] ?? 0;
      return e ? this.call(e + A.clap_plugin_latency.get, this.plugin) >>> 0 : 0;
    }

    tail(): number {
      const e = this.ext[STR.CLAP_EXT_TAIL] ?? 0;
      return e ? this.call(e + A.clap_plugin_tail.get, this.plugin) >>> 0 : 0;
    }

    // --- Memory helpers (outside process(): these allocate) ---------------------------------

    refreshViews() {
      this.buf = this.mem.buffer;
      this.dv = new DataView(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.inCh = [];
      this.outCh = [];
      for (let c = 0; c < this.inChPtr.length; c++) {
        this.inCh.push(new Float32Array(this.buf, this.inChPtr[c]!, FRAMES));
        this.outCh.push(new Float32Array(this.buf, this.outChPtr[c]!, FRAMES));
      }
      this.scCh = [];
      for (let c = 0; c < this.scChPtr.length; c++) this.scCh.push(new Float32Array(this.buf, this.scChPtr[c]!, FRAMES));
    }

    /** After the plugin grew its memory: new views (it allocates, so only then), and its limit. */
    refreshIfGrown(): boolean {
      if (this.mem.buffer === this.buf) return true;
      this.refreshViews();
      return this.buf.byteLength <= this.maxPages * PAGE;
    }

    zalloc(n: number): number {
      this.fuelUp(this.callFuel);
      const p = this.malloc(n);
      if (!p) throw new Error(`the plugin's malloc(${n}) returned NULL`);
      this.refreshIfGrown();
      this.u8.fill(0, p, p + n);
      return p;
    }

    cstr(s: string): number {
      const p = this.zalloc(s.length + 1);
      for (let i = 0; i < s.length; i++) this.u8[p + i] = s.charCodeAt(i) & 0xff;
      return p;
    }

    readCString(ptr: number, max = 4096): string {
      let s = '';
      for (let i = 0; i < max && ptr + i < this.u8.length; i++) {
        const b = this.u8[ptr + i]!;
        if (!b) break;
        s += String.fromCharCode(b);
      }
      return s;
    }

    fnAt(ptr: number): Fn {
      const f = this.table.get(this.dv.getUint32(ptr, true)) as unknown as Fn | null;
      if (!f) throw new Error(`a NULL function pointer at ${ptr}`);
      return f;
    }

    /** Call the function pointer stored at `ptr`. */
    call(ptr: number, ...args: number[]): number {
      const f = this.fnAt(ptr);
      this.fuelUp(this.callFuel);
      const r = f(...args);
      this.refreshIfGrown();
      return r;
    }

    /** Call a `clap_plugin` method by its offset, the plugin first. */
    pcall(offset: number, ...args: number[]): number {
      return this.call(this.plugin + offset, this.plugin, ...args);
    }

    pcallF(offset: number, sr: number, min: number, max: number): number {
      return this.call(this.plugin + offset, this.plugin, sr, min, max);
    }

    // --- Host callbacks ---------------------------------------------------------------------

    hostExtension(idPtr: number): number {
      this.refreshIfGrown();
      this.charge(HOST_CALL);
      idPtr >>>= 0;
      if (!this.inMem(idPtr, 1)) return 0;
      for (let k = 0; k < this.hostExt.length; k++) {
        const row = this.hostExt[k]!;
        const want = this.idBytes[row[0]!]!;
        let same = true;
        for (let i = 0; i <= want.length && same; i++) same = this.u8[idPtr + i] === (i < want.length ? want[i] : 0);
        if (same) return row[1]!;
      }
      return 0;
    }

    /**
     * `clap_output_events.try_push`: parameter changes the plugin reports, note ends, and the plugin's
     * note output (NOTE_ON, NOTE_OFF, NOTE_CHOKE and MIDI from a plugin with a note output port, port 0),
     * kept while the host routes it (`notesOut`: EST 1.1, the next insert or the track's instrument
     * hears it, routes.ts) or the page listens (`notes:on`: `est dev`, the golden renders), with its
     * frame clamped into the block, and posted by `postNotes` (NOTE_OUT's comment).
     */
    pushOut(ev: number): number {
      this.charge(HOST_CALL);
      if (!this.refreshIfGrown()) return 0;
      ev >>>= 0;
      // The header, then the event's own size: both inside the memory (EST-02).
      if (!this.inMem(ev, A.clap_event_header.$size)) return 0;
      const dv = this.dv, H = A.clap_event_header;
      if (!this.inMem(ev, dv.getUint32(ev + H.size, true))) return 0;
      if (dv.getUint16(ev + H.space_id, true) !== C.CLAP_CORE_EVENT_SPACE_ID) return 1;
      const type = dv.getUint16(ev + H.type, true);
      if (type === C.CLAP_EVENT_PARAM_VALUE && this.outParamLen < OUT_PARAMS) {
        if (!this.inMem(ev, A.clap_event_param_value.$size)) return 0;
        this.outParams[2 * this.outParamLen] = dv.getUint32(ev + A.clap_event_param_value.param_id, true);
        this.outParams[2 * this.outParamLen + 1] = dv.getFloat64(ev + A.clap_event_param_value.value, true);
        this.outParamLen++;
      } else if (type === C.CLAP_EVENT_NOTE_END) {
        this.noteEnds++;
      } else if (type === C.CLAP_EVENT_NOTE_ON || type === C.CLAP_EVENT_NOTE_OFF || type === C.CLAP_EVENT_NOTE_CHOKE || type === C.CLAP_EVENT_MIDI) {
        // The plugin's note output (see NOTE_OUT), numbers only: nothing allocated. Key 0…127 (−1 a
        // wildcard), channel 0…15 (−1), velocity 0…1; the note id as the plugin sent it (the routing
        // never passes it on, so it cannot collide with the receiving plugin's own: routes.ts).
        if (this.noteOutPorts < 1 || !(this.notesOut || this.notesOn)) return 1;
        const midi = type === C.CLAP_EVENT_MIDI;
        if (!this.inMem(ev, midi ? A.clap_event_midi.$size : A.clap_event_note.$size)) return 0;
        if (!midi) {
          const port = dv.getInt16(ev + A.clap_event_note.port_index, true);
          if (port !== 0 && port !== -1) return 1; // one note output: port 0 (-1: unspecified)
        }
        if (this.noteOutLen >= NOTE_OUT) { this.noteOutDrop++; return 0; }
        const o = this.noteOut, b = this.noteOutLen * NOTE_OUT_W;
        const t = dv.getUint32(ev + H.time, true), last = this.blockFrames > 0 ? this.blockFrames - 1 : 0;
        o[b] = currentFrame + (t > last ? last : t);
        o[b + 1] = type;
        if (midi) {
          o[b + 2] = dv.getUint8(ev + A.clap_event_midi.data);
          o[b + 3] = dv.getUint8(ev + A.clap_event_midi.data + 1) & 0x7f;
          o[b + 4] = dv.getUint8(ev + A.clap_event_midi.data + 2) & 0x7f;
          o[b + 5] = -1;
        } else {
          const N = A.clap_event_note;
          const k = dv.getInt16(ev + N.key, true), ch = dv.getInt16(ev + N.channel, true);
          o[b + 2] = k < 0 ? -1 : k > 127 ? 127 : k;
          o[b + 3] = ch < 0 ? -1 : ch > 15 ? 15 : ch;
          const v = dv.getFloat64(ev + N.velocity, true);
          o[b + 4] = v === v ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
          o[b + 5] = dv.getInt32(ev + N.note_id, true);
        }
        this.noteOutLen++;
      }
      return 1;
    }

    log(severity: number, msg: number) {
      this.charge(HOST_CALL);
      if (this.logLines >= 50) return;
      this.logLines++;
      this.refreshIfGrown();
      console.log(`[EST plugin ${severity}] ${this.readCString(msg >>> 0, 512)}`);
    }

    streamRead(ptr: number, size: bigint): bigint {
      const src = this.streamIn;
      if (!src) { this.charge(HOST_CALL); return -1n; }
      this.refreshIfGrown();
      ptr >>>= 0;
      // At most what is left of the stream, and never past the plugin's memory (EST-02).
      let n = Math.min(Number(size), src.length - this.streamPos);
      if (n < 0 || !this.inMem(ptr, 0)) return -1n;
      if (n > this.u8.length - ptr) n = this.u8.length - ptr;
      this.charge(HOST_CALL + n * HOST_BYTE);
      for (let i = 0; i < n; i++) this.u8[ptr + i] = src[this.streamPos + i]!;
      this.streamPos += n;
      return BigInt(n);
    }

    streamWrite(ptr: number, size: bigint): bigint {
      this.refreshIfGrown();
      ptr >>>= 0;
      const n = Number(size);
      if (n < 0 || !this.inMem(ptr, n)) return -1n;
      this.charge(HOST_CALL + n * HOST_BYTE);
      if (this.streamOut.length + n > 4 * 1024 * 1024) { this.stateOver = true; return -1n; }
      for (let i = 0; i < n; i++) this.streamOut.push(this.u8[ptr + i]!);
      return size;
    }

    // --- Messages ---------------------------------------------------------------------------

    onMessage(m: { type?: string; req?: number; events?: InEvent[]; bytes?: ArrayBuffer; id?: number; from?: number }) {
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'dispose') { this.dispose(); return; }
      if (this.dead) {
        if (m.req !== undefined) this.port.postMessage({ type: 'reply', req: m.req, error: 'the instance is not running' });
        return;
      }
      try {
        if (m.type === 'events') {
          const list = Array.isArray(m.events) ? m.events : [];
          for (let i = 0; i < list.length; i++) this.queue(list[i]!);
        } else if (m.type === 'params:get') {
          const values = this.params.map(p => ({ id: p.id, value: this.paramValue(p.id) }));
          this.port.postMessage({ type: 'reply', req: m.req, values });
        } else if (m.type === 'state:get') {
          this.streamOut = [];
          this.stateOver = false;
          const se = this.ext[STR.CLAP_EXT_STATE] ?? 0;
          const os = this.scratch;
          this.fillFns(os, 'clap_ostream');
          const ok = se ? this.call(se + A.clap_plugin_state.save, this.plugin, os) : 0;
          const bytes = new Uint8Array(this.streamOut).buffer;
          this.streamOut = [];
          // A save past the cap is refused as it is written; its reply says so (EST-C009), whatever the plugin then returned.
          const over = this.stateOver;
          this.stateOver = false;
          if (over) this.port.postMessage({ type: 'reply', req: m.req, error: 'the state is larger than 4 MiB' });
          else this.port.postMessage(ok ? { type: 'reply', req: m.req, bytes } : { type: 'reply', req: m.req, error: 'the plugin did not save its state' }, ok ? [bytes] : []);
        } else if (m.type === 'state:set') {
          const ok = this.loadState(new Uint8Array(m.bytes ?? new ArrayBuffer(0)));
          this.port.postMessage(ok ? { type: 'reply', req: m.req, ok: true } : { type: 'reply', req: m.req, error: 'the plugin refused the state' });
        } else if (m.type === 'cancelMods') {
          // EST 1.1: a modulator let go: its parameter's queued PARAM_MOD events dropped (every parameter's for none).
          this.cancelKind(K_MOD, typeof m.id === 'number' ? m.id : -1);
        } else if (m.type === 'cancel') {
          // EST Phase 2: queued parameter events dropped (one parameter's, or every one's): a lane let go, a jump.
          this.cancelParams(typeof m.id === 'number' ? m.id : -1);
        } else if (m.type === 'cancelNotes') {
          // EST Phase 3: queued note events and expressions at or after `from` (s) dropped (a Session launch re-planned).
          this.cancelNotes(typeof m.from === 'number' && m.from > 0 ? Math.round(m.from * sampleRate) : 0, false);
        } else if (m.type === 'clearNotes') {
          // EST Phase 3: every queued note event, expression and MIDI event dropped (Stop, Panic).
          this.cancelNotes(0, true);
        } else if (m.type === 'notes:on' || m.type === 'notes:off') {
          // DEV-F (1.321): a note effect's notes are kept and posted only while the page listens.
          this.notesOn = m.type === 'notes:on';
          // Routed notes (`notesOut`) are kept whoever listens; a log's go with its listener.
          if (!this.notesOn && !this.notesOut) { this.noteOutLen = 0; this.noteOutDrop = 0; }
        } else if (m.type === 'notes:flush') {
          // DEV-F: what waits, now (a render's end: the golden renders).
          if (this.noteOutLen || this.noteOutDrop) this.postNotes();
        }
      } catch (err) {
        this.fail(m.type, err);
      }
    }

    /** Load a CLAP state stream (outside process()); false when the plugin refused it or has no state. */
    loadState(bytes: Uint8Array): boolean {
      const se = this.ext[STR.CLAP_EXT_STATE] ?? 0;
      this.streamIn = bytes;
      this.streamPos = 0;
      const is = this.scratch;
      this.fillFns(is, 'clap_istream');
      const ok = se ? this.call(se + A.clap_plugin_state.load, this.plugin, is) : 0;
      this.streamIn = null;
      return !!ok;
    }

    /** Drop every queued transport event, keeping the rest in order (outside process()). */
    dropTransports() {
      const q = this.q;
      let w = 0;
      for (let r = 0; r < this.qLen; r++) {
        const b = r * EV;
        if (q[b + 1]! === K_TR) continue;
        if (w !== r) q.copyWithin(w * EV, b, b + EV);
        w++;
      }
      this.qLen = w;
    }

    /** Drop the queued parameter events of parameter `id` (every parameter's for -1), keeping the rest in order. */
    cancelParams(id: number) {
      this.cancelKind(K_PARAM, id);
    }

    /** Drop the queued events of one kind (`K_PARAM` or EST 1.1's `K_MOD`) for parameter `id` (every one's for -1). */
    cancelKind(kind: number, id: number) {
      const q = this.q;
      let w = 0;
      for (let r = 0; r < this.qLen; r++) {
        const b = r * EV;
        if (q[b + 1] === kind && (id < 0 || q[b + 3] === id)) continue;
        if (w !== r) q.copyWithin(w * EV, b, b + EV);
        w++;
      }
      this.qLen = w;
    }

    /**
     * Drop queued events (outside process()): EST Phase 3. Note events and expressions at or after
     * `from` (a frame), or with `all` every note event, expression and MIDI event; the rest kept in order.
     */
    cancelNotes(from: number, all: boolean) {
      const q = this.q;
      let w = 0;
      for (let r = 0; r < this.qLen; r++) {
        const b = r * EV, k = q[b + 1]!;
        if (all ? k === K_NOTE || k === K_EXPR || k === K_MIDI : (k === K_NOTE || k === K_EXPR) && q[b]! >= from) continue;
        if (w !== r) q.copyWithin(w * EV, b, b + EV);
        w++;
      }
      this.qLen = w;
    }

    /** A transport's fields into `to` at offset `o` (the queue's row, or `tr` itself): see `EV`. */
    transportRow(e: InEvent, to: Float64Array, o: number) {
      const tempo = typeof e.tempo === 'number' && e.tempo > 0 ? e.tempo : 120;
      const end = typeof e.tempoEnd === 'number' && e.tempoEnd > 0 ? e.tempoEnd : tempo;
      const until = typeof e.until === 'number' && e.until > 0 ? e.until * sampleRate : 0;
      const beat = typeof e.beat === 'number' ? e.beat : 0;
      to[o] = tempo;
      to[o + 1] = until > 0 ? (end - tempo) / until : 0;
      to[o + 2] = beat;
      to[o + 3] = typeof e.seconds === 'number' ? e.seconds : beat * 60 / tempo;
      to[o + 5] = (e.playing ? 1 : 0) | (typeof e.loopStart === 'number' && typeof e.loopEnd === 'number' && e.loopEnd > e.loopStart ? 2 : 0);
      to[o + 6] = typeof e.num === 'number' && e.num > 0 ? e.num : 4;
      to[o + 7] = typeof e.den === 'number' && e.den > 0 ? e.den : 4;
      to[o + 8] = e.loopStart ?? 0;
      to[o + 9] = e.loopEnd ?? 0;
      to[o + 10] = e.barStart ?? 0;
      to[o + 11] = e.barNumber ?? 0;
      to[o + 12] = e.loopStartSeconds ?? 0;
      to[o + 13] = e.loopEndSeconds ?? 0;
    }

    /** One event from the page into the queue, kept in time order (outside process()). */
    queue(e: InEvent) {
      const timed = typeof e.time === 'number' && e.time > 0;
      if (e.type === 'transport' && !timed) {
        // Phase 1's shape (and a stopped transport): in force from this block on. A stop also drops the
        // transport windows still queued (posted ahead by the look-ahead), else they would turn playing
        // back on after it and a plugin's own sequencer would run on (1.503).
        if (!e.playing) this.dropTransports();
        this.transportRow(e, this.tr, 0);
        this.tr[4] = currentFrame;
        this.trSet = true;
        this.trDirty = true;
        return;
      }
      let type = -1, kind = 0;
      if (e.type === 'noteOn') { type = C.CLAP_EVENT_NOTE_ON; kind = K_NOTE; }
      else if (e.type === 'noteOff') { type = C.CLAP_EVENT_NOTE_OFF; kind = K_NOTE; }
      else if (e.type === 'choke') { type = C.CLAP_EVENT_NOTE_CHOKE; kind = K_NOTE; }
      else if (e.type === 'param') { type = C.CLAP_EVENT_PARAM_VALUE; kind = K_PARAM; }
      else if (e.type === 'mod') { type = C.CLAP_EVENT_PARAM_MOD; kind = K_MOD; }
      // An expression by name (`EXPR_IDS`) or by its CLAP id (0…6, CLAP_NOTE_EXPRESSION_*: 3-C's conformance run).
      else if (e.type === 'expression' && ((typeof e.expression === 'string' && e.expression in EXPR_IDS) || (typeof e.expression === 'number' && e.expression >= 0 && e.expression <= 6 && (e.expression | 0) === e.expression))) { type = C.CLAP_EVENT_NOTE_EXPRESSION; kind = K_EXPR; }
      else if (e.type === 'midi' && Array.isArray(e.data)) { type = C.CLAP_EVENT_MIDI; kind = K_MIDI; }
      else if (e.type === 'transport') { type = C.CLAP_EVENT_TRANSPORT; kind = K_TR; }
      if (type < 0 || this.qLen >= this.qMax) return;
      const frame = timed ? Math.round(e.time! * sampleRate) : 0;
      let at = this.qLen;
      while (at > 0 && this.q[(at - 1) * EV]! > frame) at--;
      if (at < this.qLen) this.q.copyWithin((at + 1) * EV, at * EV, this.qLen * EV);
      const b = at * EV, q = this.q;
      q[b] = frame;
      q[b + 1] = kind;
      q[b + 2] = type;
      if (kind === K_NOTE) {
        q[b + 3] = typeof e.noteId === 'number' ? e.noteId : -1;
        q[b + 4] = typeof e.port === 'number' ? e.port : 0;
        q[b + 5] = typeof e.channel === 'number' ? e.channel : 0;
        q[b + 6] = typeof e.key === 'number' ? e.key : 60;
        q[b + 7] = typeof e.velocity === 'number' ? e.velocity : 0.8;
      } else if (kind === K_EXPR) {
        q[b + 3] = typeof e.noteId === 'number' ? e.noteId : -1;
        q[b + 4] = typeof e.port === 'number' ? e.port : 0;
        q[b + 5] = typeof e.channel === 'number' ? e.channel : -1;
        q[b + 6] = typeof e.key === 'number' ? e.key : -1;
        q[b + 7] = typeof e.expression === 'number' ? e.expression : EXPR_IDS[e.expression!]!;
        q[b + 8] = typeof e.value === 'number' && e.value === e.value ? e.value : 0;
      } else if (kind === K_MIDI) {
        q[b + 3] = typeof e.port === 'number' ? e.port : 0;
        q[b + 4] = (e.data![0] ?? 0) & 0xff;
        q[b + 5] = (e.data![1] ?? 0) & 0x7f;
        q[b + 6] = (e.data![2] ?? 0) & 0x7f;
      } else if (kind === K_TR) {
        this.transportRow(e, q, b + 3);
      } else if (kind === K_MOD) {
        // EST 1.1: an amount in the parameter's units (`norm`: a signed fraction of its range).
        const pid = e.id ?? 0;
        let a = typeof e.amount === 'number' && e.amount === e.amount ? e.amount : 0;
        if (e.norm) {
          for (let i = 0; i < this.params.length; i++) {
            const p = this.params[i]!;
            if (p.id !== pid) continue;
            const u = a < -1 ? -1 : a > 1 ? 1 : a;
            a = u * (p.max - p.min);
            break;
          }
        }
        q[b + 3] = pid;
        q[b + 4] = a;
      } else {
        const pid = e.id ?? 0;
        let v = e.value ?? 0;
        if (e.norm) {
          // EST Phase 2: a lane's 0…1 over the parameter's range (an unknown id keeps its 0…1).
          for (let i = 0; i < this.params.length; i++) {
            const p = this.params[i]!;
            if (p.id !== pid) continue;
            const u = v < 0 ? 0 : v > 1 ? 1 : v;
            v = p.scale === 'log' ? p.min * Math.pow(p.max / p.min, u) : p.min + u * (p.max - p.min);
            if (p.flags & C.CLAP_PARAM_IS_STEPPED) v = Math.round(v);
            break;
          }
        }
        q[b + 3] = pid;
        q[b + 4] = v;
      }
      this.qLen++;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (!this.dead && this.plugin) {
        try {
          this.pcall(A.clap_plugin.stop_processing);
          this.pcall(A.clap_plugin.deactivate);
          this.pcall(A.clap_plugin.destroy);
          this.call(this.entry + A.clap_plugin_entry.deinit);
        } catch { /* a plugin that traps on the way out is let go all the same */ }
      }
      this.dead = true;
      this.keep = 0;
      this.release();
      try { this.port.close(); } catch { /* closed */ }
    }

    /**
     * Drop every reference to the plugin's instance, memory and table, so the scope's GC can free
     * them: a renderer process holds only about 124 live Wasm memories at once (Chromium 141 on
     * Linux x64, page and worklets together, measured by e2e/est-runtime.spec.ts), and a processor
     * lives until its node is collected.
     */
    release() {
      const self = this as unknown as Record<string, unknown>;
      // 1.314: `fuelLeft` too (an export of the instance: kept, it holds the instance and its memory
      // alive, and a renderer's ~120 Wasm memories ran out after five offline renders of 24 metered ones).
      for (const k of ['mem', 'buf', 'dv', 'u8', 'table', 'malloc', 'refuel', 'fuelLeft', 'fnProcess', 'fnMainThread']) self[k] = null;
      this.inCh = [];
      this.outCh = [];
    }

    fail(phase: string, err: unknown) {
      this.dead = true;
      if (this.errorPosted) return;
      this.errorPosted = true;
      const message = err instanceof Error ? `${err.name === 'Error' ? '' : `${err.name}: `}${err.message}` : String(err);
      // DEV-I (1.324): a fault in a block names it (0 for the first), the crash record's block index.
      try { this.port.postMessage(phase === 'process' || phase === 'slow' ? { type: 'error', phase, message, block: this.blockNo - 1 } : { type: 'error', phase, message }); } catch { /* closed */ }
    }

    // --- The block --------------------------------------------------------------------------

    /** The block's due events into the slots; `evCount` is what `clap_input_events.size` answers. */
    fillEvents(frames: number) {
      const dv = this.dv, q = this.q, H = A.clap_event_header;
      const end = currentFrame + frames;
      let n = 0;
      if (this.trSet) {
        this.writeTransport(this.transportPtr, 0);
        if (this.trDirty) {
          this.writeTransport(this.slotsPtr, 0);
          this.trDirty = false;
          n = 1;
        }
      }
      let used = 0;
      while (used < this.qLen && n < SLOTS) {
        const b = used * EV;
        const frame = q[b]!;
        if (frame >= end) break;
        const at = this.slotsPtr + n * SLOT;
        const time = frame > currentFrame ? frame - currentFrame : 0;
        const kind = q[b + 1]!;
        used++;
        if (kind === K_TR) {
          // EST Phase 3: the transport from this sample on (its anchor), as an event at its offset;
          // at the block's start it is the block's transport too.
          // (Copied number by number: a subarray would allocate in process().)
          const tr = this.tr;
          for (let k = 0; k < 14; k++) tr[k] = q[b + 3 + k]!;
          tr[4] = currentFrame + time;
          this.trSet = true;
          if (time === 0) this.writeTransport(this.transportPtr, 0);
          this.writeTransport(at, time);
          n++;
          continue;
        }
        if (kind === K_NOTE) {
          const N = A.clap_event_note;
          dv.setUint32(at + H.size, N.$size, true);
          dv.setInt32(at + N.note_id, q[b + 3]!, true);
          dv.setInt16(at + N.port_index, q[b + 4]!, true);
          dv.setInt16(at + N.channel, q[b + 5]!, true);
          dv.setInt16(at + N.key, q[b + 6]!, true);
          dv.setFloat64(at + N.velocity, q[b + 7]!, true);
        } else if (kind === K_EXPR) {
          const X = A.clap_event_note_expression;
          dv.setUint32(at + H.size, X.$size, true);
          dv.setUint32(at + X.expression_id, q[b + 7]!, true);
          dv.setInt32(at + X.note_id, q[b + 3]!, true);
          dv.setInt16(at + X.port_index, q[b + 4]!, true);
          dv.setInt16(at + X.channel, q[b + 5]!, true);
          dv.setInt16(at + X.key, q[b + 6]!, true);
          dv.setFloat64(at + X.value, q[b + 8]!, true);
        } else if (kind === K_MOD) {
          const D = A.clap_event_param_mod;
          dv.setUint32(at + H.size, D.$size, true);
          dv.setUint32(at + D.param_id, q[b + 3]!, true);
          dv.setUint32(at + D.cookie, 0, true);
          dv.setInt32(at + D.note_id, -1, true);
          dv.setInt16(at + D.port_index, -1, true);
          dv.setInt16(at + D.channel, -1, true);
          dv.setInt16(at + D.key, -1, true);
          dv.setFloat64(at + D.amount, q[b + 4]!, true);
        } else if (kind === K_MIDI) {
          const M = A.clap_event_midi;
          dv.setUint32(at + H.size, M.$size, true);
          dv.setUint16(at + M.port_index, q[b + 3]!, true);
          dv.setUint8(at + M.data, q[b + 4]!);
          dv.setUint8(at + M.data + 1, q[b + 5]!);
          dv.setUint8(at + M.data + 2, q[b + 6]!);
        } else {
          const V = A.clap_event_param_value;
          dv.setUint32(at + H.size, V.$size, true);
          dv.setUint32(at + V.param_id, q[b + 3]!, true);
          dv.setUint32(at + V.cookie, 0, true);
          dv.setInt32(at + V.note_id, -1, true);
          dv.setInt16(at + V.port_index, -1, true);
          dv.setInt16(at + V.channel, -1, true);
          dv.setInt16(at + V.key, -1, true);
          dv.setFloat64(at + V.value, q[b + 4]!, true);
        }
        dv.setUint32(at + H.time, time, true);
        dv.setUint16(at + H.space_id, C.CLAP_CORE_EVENT_SPACE_ID, true);
        dv.setUint16(at + H.type, q[b + 2]!, true);
        dv.setUint32(at + H.flags, 0, true);
        n++;
      }
      if (used) {
        q.copyWithin(0, used * EV, this.qLen * EV);
        this.qLen -= used;
      }
      this.evCount = n;
    }

    /**
     * A CLAP transport event at `at`, for `time` samples into this block, from `tr` (EST Phase 3:
     * its anchor, its tempo ramp `tempo_inc`, the song's seconds, the loop and the bar).
     */
    writeTransport(at: number, time: number) {
      const dv = this.dv, T = A.clap_event_transport, H = A.clap_event_header, tr = this.tr;
      const playing = (tr[5]! & 1) !== 0, loop = (tr[5]! & 2) !== 0;
      const n = playing ? currentFrame + time - tr[4]! : 0;
      const inc = playing ? tr[1]! : 0;
      let tempo = tr[0]! + inc * n;
      if (!(tempo > 1)) tempo = 1;
      const beats = tr[2]! + (n > 0 ? (tr[0]! * n + inc * n * n * 0.5) / (60 * sampleRate) : 0);
      const seconds = tr[3]! + (n > 0 ? n / sampleRate : 0);
      dv.setUint32(at + H.size, T.$size, true);
      dv.setUint32(at + H.time, time, true);
      dv.setUint16(at + H.space_id, C.CLAP_CORE_EVENT_SPACE_ID, true);
      dv.setUint16(at + H.type, C.CLAP_EVENT_TRANSPORT, true);
      dv.setUint32(at + H.flags, 0, true);
      dv.setUint32(at + T.flags, C.CLAP_TRANSPORT_HAS_TEMPO | C.CLAP_TRANSPORT_HAS_BEATS_TIMELINE | C.CLAP_TRANSPORT_HAS_SECONDS_TIMELINE | C.CLAP_TRANSPORT_HAS_TIME_SIGNATURE | (playing ? C.CLAP_TRANSPORT_IS_PLAYING : 0) | (loop ? C.CLAP_TRANSPORT_IS_LOOP_ACTIVE : 0), true);
      this.setI64(at + T.song_pos_beats, Math.round(beats * C.CLAP_BEATTIME_FACTOR));
      this.setI64(at + T.song_pos_seconds, Math.round(seconds * C.CLAP_SECTIME_FACTOR));
      dv.setFloat64(at + T.tempo, tempo, true);
      dv.setFloat64(at + T.tempo_inc, inc, true);
      this.setI64(at + T.loop_start_beats, loop ? Math.round(tr[8]! * C.CLAP_BEATTIME_FACTOR) : 0);
      this.setI64(at + T.loop_end_beats, loop ? Math.round(tr[9]! * C.CLAP_BEATTIME_FACTOR) : 0);
      this.setI64(at + T.loop_start_seconds, loop ? Math.round(tr[12]! * C.CLAP_SECTIME_FACTOR) : 0);
      this.setI64(at + T.loop_end_seconds, loop ? Math.round(tr[13]! * C.CLAP_SECTIME_FACTOR) : 0);
      const barBeats = tr[6]! * 4 / tr[7]!;
      const bars = Math.floor((beats - tr[10]!) / barBeats + 1e-9);
      this.setI64(at + T.bar_start, Math.round((tr[10]! + bars * barBeats) * C.CLAP_BEATTIME_FACTOR));
      dv.setInt32(at + T.bar_number, tr[11]! + bars, true);
      dv.setUint16(at + T.tsig_num, tr[6]!, true);
      dv.setUint16(at + T.tsig_denom, tr[7]!, true);
      dv.setUint32(this.procPtr + A.clap_process.transport, this.transportPtr, true);
    }

    /** A 64-bit integer as two 32-bit halves (no BigInt, so nothing is allocated). */
    setI64(at: number, v: number) {
      const hi = Math.floor(v / 4294967296);
      this.dv.setUint32(at, v - hi * 4294967296, true);
      this.dv.setInt32(at + 4, hi, true);
    }

    /**
     * The block a trap (or any fault) happened in: a ramp to silence from the last sample each
     * channel sent. Never the plugin's buffers: after a trap they hold the previous block (or half
     * of this one), and starting from their first sample would be a step, a click (ET-B).
     */
    fadeOut(out: Float32Array[]) {
      for (let c = 0; c < out.length; c++) {
        const y = out[c]!, v = c < this.lastOut.length ? this.lastOut[c]! : 0;
        const from = v === v && v < 1 && v > -1 ? v : 0;
        for (let i = 0; i < y.length; i++) y[i] = from * (1 - i / y.length);
      }
      this.lastOut.fill(0);
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      this.blockNo++;
      if (this.dead) {
        // 1.410: stopped for being too slow, it is bypassed: an effect passes its input on (kept alive
        // while it may), an instrument fades out once and is silent.
        if (this.slowStop && !this.disposed && out) {
          this.slowOut(inputs[0], out);
          if (this.nIn > 0) return true;
        } else if (out) for (let c = 0; c < out.length; c++) out[c]!.fill(0);
        if (this.keep > 0) { this.keep--; return true; }
        return false;
      }
      if (!out || !out.length) return true;
      const t0 = Date.now();
      if (!this.refreshIfGrown()) { this.die('process', 'the plugin grew its memory over its limit', out); return true; }
      const dv = this.dv, frames = out[0]!.length;
      this.blockFrames = frames;
      const input = inputs[0];
      if (this.nIn > 0) {
        const have = input ? input.length : 0;
        for (let c = 0; c < this.nIn; c++) {
          if (have) this.inCh[c]!.set(input![c < have ? c : have - 1]!);
          else this.inCh[c]!.fill(0);
        }
        dv.setUint32(this.audioIn + A.clap_audio_buffer.constant_mask, have ? 0 : (1 << this.nIn) - 1, true);
      }
      if (this.nSc) {
        // EST 1.1: the key, from the node's second input (silence when nothing is connected).
        const key = inputs[1];
        const have = key ? key.length : 0;
        for (let c = 0; c < this.nSc; c++) {
          if (have) this.scCh[c]!.set(key![c < have ? c : have - 1]!);
          else this.scCh[c]!.fill(0);
        }
        dv.setUint32(this.scIn + A.clap_audio_buffer.constant_mask, have ? 0 : (1 << this.nSc) - 1, true);
      }
      if (this.copyOnly) {
        for (let c = 0; c < out.length; c++) {
          if (this.nIn > 0) out[c]!.set(this.inCh[c < this.nIn ? c : 0]!);
          else out[c]!.fill(0);
        }
        this.stat(t0);
        return true;
      }
      if (this.restart) {
        this.restart = false;
        try {
          this.pcall(A.clap_plugin.stop_processing);
          this.pcall(A.clap_plugin.deactivate);
          this.pcallF(A.clap_plugin.activate, sampleRate, FRAMES, FRAMES);
          this.pcall(A.clap_plugin.start_processing);
        } catch (err) { this.die('restart', err, out); return true; }
      }
      this.fillEvents(frames);
      this.setI64(this.procPtr + A.clap_process.steady_time, this.steady);
      let status: number;
      const host0 = this.hostSpent;
      try {
        this.fuelUp(this.blockFuel);
        status = this.fnProcess(this.plugin, this.procPtr);
      } catch (err) {
        this.die('process', err, out);
        return true;
      }
      // The plugin's own code's fuel (1.405: what the host took for its calls is left out, so the
      // profiler's counters, which see only the plugin's code, still sum to it).
      // 1.410: a heavy block is judged on the whole budget it used (its code and the host's charges).
      let heavy = false;
      if (this.fuelLeft) {
        const used = this.blockFuel - this.fuelLeft();
        this.statPoints += used - (this.hostSpent - host0);
        heavy = used >= this.slowAt;
      }
      this.evCount = 0;
      if (status === C.CLAP_PROCESS_ERROR) { this.die('process', 'the plugin returned CLAP_PROCESS_ERROR', out); return true; }
      if (!this.refreshIfGrown()) { this.die('process', 'the plugin grew its memory over its limit', out); return true; }
      // 1.314 (LCH-21 a): the output checked on its way out: NaN or ±∞ becomes 0, the rest clamped
      // to ±4 (+12 dBFS), each counted. `v - v` is 0 only for a finite v. Allocation-free.
      let nonFinite = 0, clipped = 0, peak = this.statPeak;
      // EST 1.1: a plugin channel past the node's count is summed into channel c mod the count (an
      // effect's surround on a stereo strip), before the check.
      const nOutCh = out.length;
      if (this.nOut > nOutCh) {
        this.downmixed = true;
        for (let c = nOutCh; c < this.nOut; c++) {
          const into = this.outCh[c % nOutCh]!, from = this.outCh[c]!;
          for (let i = 0; i < frames; i++) into[i] = into[i]! + from[i]!;
        }
      }
      for (let c = 0; c < out.length; c++) {
        const y = out[c]!, src = this.outCh[c < this.nOut ? c : 0]!;
        for (let i = 0; i < frames; i++) {
          let v = src[i]!;
          if (v - v !== 0) { v = 0; nonFinite++; }
          else if (v > 4) { if (v > peak) peak = v; v = 4; clipped++; }
          else if (v < -4) { if (-v > peak) peak = -v; v = -4; clipped++; }
          else if (v > peak) peak = v;
          else if (-v > peak) peak = -v;
          y[i] = v;
        }
      }
      this.statNonFinite += nonFinite;
      this.statClipped += clipped;
      this.statPeak = peak;
      this.steady += frames;
      if (this.callback) {
        this.callback = false;
        try {
          this.fuelUp(this.callFuel);
          this.fnMainThread(this.plugin);
        } catch (err) { this.die('on_main_thread', err, out); return true; }
      }
      if (this.outParamLen) this.postParams();
      if ((this.noteOutLen || this.noteOutDrop) && (this.noteOutLen >= NOTE_OUT * 0.75
        || (this.notesOut ? ++this.noteBlocks >= NOTE_POST_BLOCKS : currentFrame + frames - this.notesPostedAt >= sampleRate / NOTES_PER_SECOND))) this.postNotes();
      const last = frames - 1, lastOut = this.lastOut;
      for (let c = 0; c < out.length && c < lastOut.length; c++) lastOut[c] = out[c]![last]!;
      if (heavy) this.statSlow++;
      const raw = this.stat(t0);
      const dt = raw > SUSPEND_MS ? 0 : raw;
      // 1.410: the processor's overrun stop (SLOW_SHARE's comment): a run of heavy blocks, each
      // counted in the block times it took (at least one).
      if (heavy) {
        const took = (dt * sampleRate) / (1000 * frames);
        this.slowRun += took > 1 ? took : 1;
        if (this.slowRun >= SLOW_QUANTA) {
          this.stopSlow(`it used over ${Math.round(SLOW_SHARE * 100)} % of its fuel in every block for ${Math.round(this.slowRun)} blocks' time in a row`);
          return true;
        }
      } else this.slowRun = 0;
      // 1.410: an offline render's time budget (OFFLINE_FACTOR's comment).
      if (this.offline) {
        this.offSpentMs += raw > SUSPEND_MS ? SUSPEND_MS : raw;
        this.offFrames += frames;
        const audioMs = (this.offFrames * 1000) / sampleRate;
        if (this.offSpentMs > OFFLINE_GRACE_MS + OFFLINE_FACTOR * audioMs) {
          this.stopSlow(`it took ${(this.offSpentMs / 1000).toFixed(1)} s for ${(audioMs / 1000).toFixed(1)} s of audio in the render, over ${OFFLINE_FACTOR} times its length`);
          return true;
        }
      }
      return true;
    }

    /**
     * 1.410: stop the instance for being too slow (phase `slow`): from the next block it is bypassed
     * (`slowOut`), and the page hears one `error` (the host bypasses its slot and says why). This
     * block's output stands (it was written and checked). Allocates (the message): once.
     */
    stopSlow(why: string) {
      this.dead = true;
      this.slowStop = true;
      this.slowFade = true;
      this.keep = FADE_BLOCKS;
      this.fail('slow', why);
    }

    /**
     * 1.410: a slow-stopped instance's block: its input (an effect; upmixed as the plugin's input is)
     * or silence (an instrument), crossfaded the first time from the last sample each channel sent.
     */
    slowOut(input: Float32Array[] | undefined, out: Float32Array[]) {
      const fade = this.slowFade, lastOut = this.lastOut;
      this.slowFade = false;
      const have = this.nIn > 0 && input ? input.length : 0;
      for (let c = 0; c < out.length; c++) {
        const y = out[c]!, n = y.length;
        const src = have ? input![c < have ? c : have - 1]! : null;
        const v = fade && c < lastOut.length ? lastOut[c]! : 0;
        const from = v === v && v < 1 && v > -1 ? v : 0;
        if (!fade) {
          if (src) y.set(src); else y.fill(0);
          continue;
        }
        for (let i = 0; i < n; i++) {
          const u = i / n;
          y[i] = from * (1 - u) + (src ? src[i]! * u : 0);
        }
      }
      if (fade) lastOut.fill(0);
    }

    /**
     * The plugin's waiting notes, to the page as one `notes` message: `notes` (each a note
     * `{ type, frame, key, channel, velocity, noteId }` or `{ type: 'midi', frame, data }`) and
     * `dropped`. Allocates, so only when there were some, at the cadence in NOTE_OUT's comment.
     */
    postNotes() {
      const notes = [];
      const o = this.noteOut;
      for (let i = 0; i < this.noteOutLen; i++) {
        const k = i * NOTE_OUT_W, t = o[k + 1];
        if (t === C.CLAP_EVENT_MIDI) notes.push({ type: 'midi', frame: o[k], data: [o[k + 2], o[k + 3], o[k + 4]] });
        else notes.push({ type: t === C.CLAP_EVENT_NOTE_ON ? 'noteOn' : t === C.CLAP_EVENT_NOTE_OFF ? 'noteOff' : 'choke', frame: o[k], key: o[k + 2], channel: o[k + 3], velocity: o[k + 4], noteId: o[k + 5] });
      }
      this.notesPostedAt = currentFrame;
      this.noteBlocks = 0;
      const dropped = this.noteOutDrop;
      this.noteOutLen = 0;
      this.noteOutDrop = 0;
      this.port.postMessage({ type: 'notes', notes, dropped });
    }

    die(phase: string, err: unknown, out: Float32Array[]) {
      this.fadeOut(out);
      this.keep = FADE_BLOCKS;
      this.fail(phase, err);
    }

    /** The plugin's own parameter changes, to the page (allocates: only when it reported some). */
    postParams() {
      const changes = [];
      for (let i = 0; i < this.outParamLen; i++) changes.push({ id: this.outParams[2 * i], value: this.outParams[2 * i + 1] });
      this.outParamLen = 0;
      this.port.postMessage({ type: 'param', changes });
    }


    /**
     * The block's cost. The worklet scope has no `performance` (Chromium, 2026-10), only `Date.now()`:
     * whole milliseconds, so the mean over many blocks is right on average and the max is a
     * multiple of 1000 µs. Posted at most every `statEvery` ms (2 Hz by default). Answers the block's
     * time in ms as read (never negative: a clock stepped back reads 0).
     */
    stat(t0: number): number {
      const now = Date.now();
      const dt = now > t0 ? now - t0 : 0;
      // A block the machine slept through is not the plugin's time (SUSPEND_MS's comment).
      if (dt <= SUSPEND_MS) {
        this.statSum += dt;
        if (dt > this.statMax) this.statMax = dt;
      }
      this.statBlocks++;
      if (now - this.statLast >= this.statEvery) this.postStats(now);
      return dt;
    }

    postStats(now: number) {
      this.port.postMessage({
        type: 'stats', blocks: this.statBlocks, meanUs: (this.statSum * 1000) / this.statBlocks, maxUs: this.statMax * 1000, noteEnds: this.noteEnds,
        points: this.statPoints / this.statBlocks, faults: this.statNonFinite + this.statClipped, nonFinite: this.statNonFinite,
        ...(this.downmixed ? { downmixed: true } : {}),
        // 1.410: the heavy blocks (at least SLOW_SHARE of the fuel) over the window, when there were some.
        ...(this.statSlow ? { slow: this.statSlow } : {}),
      });
      this.statSlow = 0;
      this.statSum = 0;
      this.statMax = 0;
      this.statBlocks = 0;
      this.statPoints = 0;
      this.statNonFinite = 0;
      this.statClipped = 0;
      this.statPeak = 0;
      this.statLast = now;
    }
  }

  registerProcessor('est-plugin', EstProcessor);
}

/** The module text `ensureEstRuntime` hands `addModule`: the two injected names, then the processor. */
export function estProcessorSource(abi: CompactAbi, shim: typeof buildEstShim): string {
  return `const EST_ABI = ${JSON.stringify(abi)};\nconst EST_BUILD_SHIM = ${shim.toString()};\n(${estProcessorMain.toString()})();\n`;
}
