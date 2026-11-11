/**
 * EST Phase 1 (docs/est/EST_Phase1_Work_Order.md §1.3): the page's handle on one `est-plugin`
 * instance. `compileEst(bytes)` prepares a module, `createEstNode(ctx, compiled, opts)` makes the
 * AudioWorkletNode (after `ensureEstRuntime(ctx)`) and waits for the processor's `ready`.
 *
 * Where the module is compiled: on the main thread with `WebAssembly.compile` when the page may;
 * otherwise its bytes go to the processor, which compiles them itself. **Measured on Chromium
 * (2026-10-28): a document whose CSP lacks `'wasm-unsafe-eval'` refuses compilation everywhere
 * its policy reaches: the page, a Worker made from a blob: URL, and the AudioWorklet (a blob:
 * module inherits the document's policy). Instantiating a `WebAssembly.Module` compiled where it
 * was allowed is not refused**, in the page or in the worklet. So under Cyber's CSP today
 * (`server/collab.mjs`, unchanged in Phase 1) both paths fail and `createEstNode` reports
 * `phase: 'compile'`; the browser spec runs with the policy bypassed and records the refusals.
 */

import { importWithRetry } from '@/lib/lazyWithRetry';
import { forgetEstHealth, noteEstStats } from './health';
import { disposeWorkletNode } from '../workletDispose';
import { compactAbi } from './abi/layout';
import { buildEstShim } from './runtime/shim';

/**
 * One parameter as the processor reports it. `scale` (EST tidy, 1.286, D-44): `'log'` when est.json
 * marks it `"scale": "log"` and its range is above 0 (knobs, `@cyber-est/ui` and lanes then move
 * geometrically); absent, linear.
 */
export interface EstParam { id: number; name: string; module: string; min: number; max: number; def: number; flags: number; value: number; scale?: 'linear' | 'log' }

export type EstEvent =
  | { type: 'noteOn' | 'noteOff' | 'choke'; time?: number; key: number; channel?: number; port?: number; noteId?: number; velocity?: number }
  /** `norm` (Phase 2): `value` is 0…1 over the parameter's range, mapped by the processor. */
  | { type: 'param'; time?: number; id: number; value: number; norm?: boolean }
  /**
   * The transport. Without `time`, in force from the next block (Phase 1's shape). EST Phase 3: with
   * `time`, a timestamped CLAP `TRANSPORT` event at its sample: `tempoEnd` is the tempo `until`
   * seconds later (a ramp's `tempo_inc`), `seconds` the song's position, the loop in beats and
   * seconds, the bar the position falls in (`barStart`, `barNumber`).
   */
  | {
    type: 'transport'; time?: number; tempo: number; beat: number; playing: boolean; num?: number; den?: number;
    tempoEnd?: number; until?: number; seconds?: number; loopStart?: number; loopEnd?: number; loopStartSeconds?: number; loopEndSeconds?: number; barStart?: number; barNumber?: number;
  }
  /** EST Phase 3: a CLAP `NOTE_EXPRESSION` on one note (`noteId`; key and channel -1 for any). */
  /** (`expression` by name, or by its CLAP id 0…6.) */
  | { type: 'expression'; time?: number; expression: EstExpression | number; value: number; noteId?: number; key?: number; channel?: number; port?: number }
  /** EST Phase 3: a CLAP `MIDI` event (three bytes) on the note port. */
  | { type: 'midi'; time?: number; data: [number, number, number]; port?: number }
  /**
   * EST 1.1 (1.327): a CLAP `PARAM_MOD` on parameter `id`: `amount` added to its value by the
   * plugin while it holds (plain units; `norm`, a signed fraction of the range, mapped by the processor).
   */
  | { type: 'mod'; time?: number; id: number; amount: number; norm?: boolean };

/**
 * One note the plugin pushed out (`notes` messages; DEV-F 1.321, EST 1.1 1.327), `frame` the context's
 * frame it falls on (absolute: `frame / sampleRate` is its context time); `noteId` as the plugin sent it.
 */
export type EstNoteOut =
  | { type: 'noteOn' | 'noteOff' | 'choke'; frame: number; key: number; channel: number; velocity: number; noteId: number }
  | { type: 'midi'; frame: number; data: [number, number, number] };

/** CLAP's note expressions (`clap/events.h`): tuning in semitones, the rest 0…1 (volume 0…4, pan 0…1). */
export type EstExpression = 'volume' | 'pan' | 'tuning' | 'vibrato' | 'expression' | 'brightness' | 'pressure';

/** A fault; `block` (DEV-I, 1.324) is the block a `process` fault happened in, 0 for the first. */
/** 1.410: `phase` `'slow'` (watchdog.ts `EST_SLOW_PHASE`) is the processor's own overrun stop or an offline render's time budget: the instance is bypassed, not crashed. */
export interface EstError { phase: string; message: string; block?: number }
/** 1.314: `points`, the fuel a metered module used per block on average; `faults`, output samples the host limited (LCH-21 a). */
export interface EstStats {
  blocks: number; meanUs: number; maxUs: number; noteEnds: number; points?: number; faults?: number;
  /** EST 1.1: the plugin writes more channels than the node has, and they were summed into it. */
  downmixed?: boolean;
  /** 1.410: blocks over the window that used at least 90 % of their fuel (the processor's overrun stop counts their run). */
  slow?: number;
}

/** A module ready for `createEstNode`: compiled here, or its bytes for the processor to compile. */
export interface EstCompiled {
  bytes: ArrayBuffer;
  module: WebAssembly.Module | null;
  shim: WebAssembly.Module | null;
  /** Where the module will be compiled. */
  compiledIn: 'main' | 'worklet';
  /** Why the main thread could not compile (a CSP refusal), when it could not. */
  mainRefusal: string | null;
  compileMs: number;
  limits: WasmLimits;
}

export interface WasmLimits { importsMemory: boolean; minPages: number | null; maxPages: number | null }

/** The default and the hard cap of a module's memory, in 64 KiB pages (spec §3.1). */
export const EST_DEFAULT_PAGES = 256;
export const EST_HARD_MAX_PAGES = 2048;

/**
 * The memory limits a module declares (its memory section, or its imported memory), read from
 * the bytes: the host cannot cap an exported memory after instantiation, so it checks the
 * declared maximum before (spec §3.1). Pure; throws on a malformed module.
 */
export function wasmMemoryLimits(bytes: ArrayBuffer | Uint8Array): WasmLimits {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8 || b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) throw new Error('not a WebAssembly module');
  let i = 8;
  const leb = () => {
    let r = 0, shift = 0, byte: number;
    do {
      if (i >= b.length) throw new Error('a truncated module');
      byte = b[i++]!;
      r += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return r;
  };
  const limits = () => {
    const flags = b[i++]!;
    const min = leb();
    const max = flags & 1 ? leb() : null;
    return { min, max };
  };
  const skipName = () => { const n = leb(); i += n; };
  while (i < b.length) {
    const id = b[i++]!;
    const size = leb();
    const end = i + size;
    if (id === 2) {
      const n = leb();
      for (let k = 0; k < n; k++) {
        skipName(); skipName();
        const kind = b[i++]!;
        if (kind === 0) leb();
        else if (kind === 1) { i++; limits(); }
        else if (kind === 2) { const l = limits(); return { importsMemory: true, minPages: l.min, maxPages: l.max }; }
        else if (kind === 3) i += 2;
        else if (kind === 4) { i++; leb(); }
      }
    } else if (id === 5) {
      const n = leb();
      if (n > 0) { const l = limits(); return { importsMemory: false, minPages: l.min, maxPages: l.max }; }
    }
    i = end;
  }
  return { importsMemory: false, minPages: null, maxPages: null };
}

/** Why a module's memory does not fit the limit, or null. */
export function memoryRefusal(l: WasmLimits, maxPages = EST_DEFAULT_PAGES): string | null {
  const cap = Math.min(maxPages, EST_HARD_MAX_PAGES);
  if (l.importsMemory) return 'the module imports its memory; EST modules export theirs';
  if (l.minPages === null) return 'the module has no memory';
  if (l.minPages > cap) return `the module needs ${l.minPages} pages of memory, over the limit of ${cap}`;
  if (l.maxPages === null) return `the module declares no memory maximum (EST needs one, at most ${cap} pages)`;
  if (l.maxPages > cap) return `the module may grow to ${l.maxPages} pages, over the limit of ${cap}`;
  return null;
}

let shimBytes: Uint8Array<ArrayBuffer> | null = null;
/** The host-callback shim's bytes (shim.ts), from the ABI table's signatures. */
export function estShimBytes(): Uint8Array<ArrayBuffer> {
  return (shimBytes ??= buildEstShim(compactAbi().sig));
}

/** Whether an error is the page's policy refusing compilation (not a broken module). */
export function isCompileRefusal(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /unsafe-eval|Content Security Policy|CSP/i.test(m);
}

/**
 * Prepare a module: the memory checked, then compiled here when the page may (the module and the
 * shim), else left as bytes for the processor. A module that is not valid Wasm, or whose memory
 * does not fit, throws.
 */
export async function compileEst(bytes: ArrayBuffer, opts: { maxMemoryPages?: number; forceWorklet?: boolean } = {}): Promise<EstCompiled> {
  const limits = wasmMemoryLimits(bytes);
  const refusal = memoryRefusal(limits, opts.maxMemoryPages);
  if (refusal) throw Object.assign(new Error(refusal), { phase: 'validate' });
  const t0 = performance.now();
  if (!opts.forceWorklet) {
    try {
      const [module, shim] = await Promise.all([WebAssembly.compile(bytes), WebAssembly.compile(estShimBytes())]);
      return { bytes, module, shim, compiledIn: 'main', mainRefusal: null, compileMs: performance.now() - t0, limits };
    } catch (err) {
      if (!isCompileRefusal(err)) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { phase: 'compile' });
      return { bytes, module: null, shim: null, compiledIn: 'worklet', mainRefusal: err instanceof Error ? err.message : String(err), compileMs: 0, limits };
    }
  }
  return { bytes, module: null, shim: null, compiledIn: 'worklet', mainRefusal: null, compileMs: 0, limits };
}

export interface EstReady {
  params: EstParam[]; latency: number; tail: number; compiledIn: string; audioIn: number; audioOut: number; notePorts: number; noteOutPorts?: number; bootMs: number;
  /** Whether the module is metered (EST Phase 2, D-30: refuelled before every call). */
  metered?: boolean;
  /** EST 1.1: the sidechain's channels (only when asked for). `noteOutPorts` (above) is the plugin's note output ports. */
  sidechainIn?: number;
}

export interface EstNode {
  node: AudioWorkletNode;
  params: EstParam[];
  ready: EstReady;
  /** From `createEstNode` to the processor's `ready`, in ms (compilation on the main thread excluded). */
  instantiateMs: number;
  scheduleEvents(events: EstEvent[]): void;
  setParam(id: number, value: number, time?: number): void;
  /** Phase 2: drop the queued parameter events of `id` (every parameter's without one). */
  cancel(id?: number): void;
  /** EST 1.1: drop the queued `mod` events of `id` (every parameter's without one). */
  cancelMods(id?: number): void;
  /** Phase 3: drop the queued note events and expressions at or after context time `from` (s). */
  cancelNotes(from: number): void;
  /** Phase 3: drop every queued note event, expression and MIDI event (Stop, Panic). */
  clearNotes(): void;
  getParams(): Promise<{ id: number; value: number }[]>;
  getState(): Promise<Uint8Array>;
  setState(bytes: Uint8Array): Promise<void>;
  on(type: 'error', cb: (e: EstError) => void): () => void;
  on(type: 'param', cb: (changes: { id: number; value: number }[]) => void): () => void;
  on(type: 'stats', cb: (s: EstStats) => void): () => void;
  /** The plugin's note output (DEV-F 1.321, EST 1.1 1.327): `notes` and `dropped`, posted only while a listener is on or the host routes them (`notesOut`): soon when routed, else at most 30 posts a second. */
  on(type: 'notes', cb: (n: EstNotesOut) => void): () => void;
  /** The error that stopped the instance, if one did. */
  error(): EstError | null;
  dispose(): void;
}

/** The plugin's notes since the last post (DEV-F, 1.321; EST 1.1), and how many past the processor's 256 between posts were dropped. */
export interface EstNotesOut { notes: EstNoteOut[]; dropped: number }

export interface EstNodeOptions {
  pluginId?: string;
  maxMemoryPages?: number;
  copyOnly?: boolean;
  statsIntervalMs?: number;
  /** Do not wait for `ready` (an OfflineAudioContext constructs its processors when it renders). */
  noWait?: boolean;
  /** How long to wait for `ready`, ms (default 10 s). */
  timeoutMs?: number;
  /** Phase 2: `clap.render` OFFLINE before activation (an export, a bounce, a freeze). */
  renderMode?: 'offline';
  /** Phase 2: a state stream loaded before `ready` (transferred). */
  initialState?: ArrayBuffer;
  /** Phase 2: events queued before `ready`, in time order (an offline render's whole list). */
  initialEvents?: EstEvent[];
  /** Phase 2: the processor's event queue length (default 1024). */
  queueSize?: number;
  /** EST tidy (1.286): the parameter ids est.json marks `"scale": "log"` (`EstManifestInfo.logParams`). */
  logParams?: readonly number[];
  /** EST 1.1 (1.327): the main ports' channels read at most (a 1.1 bundle: its est.json's; absent: 2). */
  maxChannels?: number;
  /** EST 1.1: the node's output channels (absent: 2); a plugin writing more has them summed into these. */
  outputChannels?: number;
  /** EST 1.1: the sidechain's channels (the node gets a second input); absent: none. */
  sidechain?: number;
  /** EST 1.1: post the plugin's note output (`on('notes')`). */
  notesOut?: boolean;
}

/** The message port of the node, as the tests stand it in. */
export interface PortLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close?(): void;
}

/** Wire an `EstNode` around a node's port (exported for the tests' fake port). */
export function wrapEstNode(node: AudioWorkletNode, port: PortLike, started: number, opts: EstNodeOptions = {}): Promise<EstNode> {
  const listeners = {
    error: new Set<(e: EstError) => void>(), param: new Set<(c: { id: number; value: number }[]) => void>(), stats: new Set<(s: EstStats) => void>(),
    notes: new Set<(n: EstNotesOut) => void>(),
  };
  const pending = new Map<number, { resolve: (m: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  let nextReq = 1;
  let failed: EstError | null = null;
  let disposed = false;
  let ready: EstReady | null = null;
  let settle: { resolve: (r: EstReady) => void; reject: (e: Error) => void } | null = null;

  port.onmessage = (e: MessageEvent) => {
    const m = e.data as Record<string, unknown> & { type?: string };
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'ready') {
      ready = m as unknown as EstReady;
      settle?.resolve(ready);
    } else if (m.type === 'error') {
      failed = { phase: String(m.phase), message: String(m.message), ...(Number.isSafeInteger(m.block) ? { block: Number(m.block) } : {}) };
      settle?.reject(Object.assign(new Error(failed.message), failed));
      for (const [, p] of pending) p.reject(new Error(failed.message));
      pending.clear();
      for (const cb of listeners.error) cb(failed);
    } else if (m.type === 'reply') {
      const p = pending.get(Number(m.req));
      if (!p) return;
      pending.delete(Number(m.req));
      if (typeof m.error === 'string') p.reject(new Error(m.error));
      else p.resolve(m);
    } else if (m.type === 'param') {
      for (const cb of listeners.param) cb(m.changes as { id: number; value: number }[]);
    } else if (m.type === 'stats') {
      // 1.338 (R-G): the per-instance health table (an offline render's node is never a row).
      noteEstStats(node, m as unknown as EstStats, { pluginId: opts.pluginId, pages: opts.maxMemoryPages ?? EST_DEFAULT_PAGES, offline: opts.renderMode === 'offline' });
      for (const cb of listeners.stats) cb(m as unknown as EstStats);
    } else if (m.type === 'notes') {
      for (const cb of listeners.notes) cb(m as unknown as EstNotesOut);
    }
  };

  const request = (msg: Record<string, unknown>, transfer: Transferable[] = []) => new Promise<Record<string, unknown>>((resolve, reject) => {
    if (disposed) { reject(new Error('the instance was disposed')); return; }
    if (failed) { reject(new Error(failed.message)); return; }
    const req = nextReq++;
    pending.set(req, { resolve, reject });
    port.postMessage({ ...msg, req }, transfer);
  });

  const make = (r: EstReady): EstNode => {
    const params = r.params.map(p => ({ ...p }));
    const est: EstNode = {
      node, params, ready: r,
      instantiateMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
      scheduleEvents(events) { if (!disposed && events.length) port.postMessage({ type: 'events', events }); },
      setParam(id, value, time) {
        const p = params.find(x => x.id === id);
        if (p) p.value = value;
        est.scheduleEvents([{ type: 'param', id, value, time }]);
      },
      cancel(id) { if (!disposed) port.postMessage({ type: 'cancel', id }); },
      cancelMods(id) { if (!disposed) port.postMessage({ type: 'cancelMods', id }); },
      cancelNotes(from) { if (!disposed) port.postMessage({ type: 'cancelNotes', from }); },
      clearNotes() { if (!disposed) port.postMessage({ type: 'clearNotes' }); },
      async getParams() {
        const m = await request({ type: 'params:get' });
        const values = m.values as { id: number; value: number }[];
        for (const v of values) { const p = params.find(x => x.id === v.id); if (p) p.value = v.value; }
        return values;
      },
      async getState() { return new Uint8Array((await request({ type: 'state:get' })).bytes as ArrayBuffer); },
      async setState(bytes) {
        const copy = bytes.slice().buffer;
        await request({ type: 'state:set', bytes: copy }, [copy]);
      },
      on(type: 'error' | 'param' | 'stats' | 'notes', cb: (x: never) => void) {
        const set = listeners[type] as Set<(x: never) => void>;
        // DEV-F (1.321): the processor keeps and posts a note effect's notes only while someone listens.
        if (type === 'notes' && set.size === 0 && !disposed) port.postMessage({ type: 'notes:on' });
        set.add(cb);
        return () => {
          if (!set.delete(cb)) return;
          if (type === 'notes' && set.size === 0 && !disposed) port.postMessage({ type: 'notes:off' });
        };
      },
      error: () => failed,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const [, p] of pending) p.reject(new Error('the instance was disposed'));
        pending.clear();
        try { node.disconnect(); } catch { /* not connected */ }
        forgetEstHealth(node);
        disposeWorkletNode({ port });
      },
    };
    return est;
  };

  if (opts.noWait) {
    return Promise.resolve(make({ params: [], latency: 0, tail: 0, compiledIn: 'unknown', audioIn: 0, audioOut: 0, notePorts: 0, bootMs: 0 }));
  }
  return new Promise<EstNode>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('the processor did not answer'), { phase: 'timeout' })), opts.timeoutMs ?? 10_000);
    settle = {
      resolve: r => { clearTimeout(timer); resolve(make(r)); },
      reject: e => { clearTimeout(timer); reject(e); },
    };
    if (failed) settle.reject(Object.assign(new Error((failed as EstError).message), failed));
    else if (ready) settle.resolve(ready);
  });
}

/** Make an instance on `ctx` (registering the runtime first) and wait for it to be ready. */
export async function createEstNode(ctx: BaseAudioContext, compiled: EstCompiled, opts: EstNodeOptions = {}): Promise<EstNode> {
  // The processor's source is its own chunk (scripts/check-worklets.mjs finds and checks it there).
  const { ensureEstRuntime } = await importWithRetry(() => import('./runtime/ensureEstRuntime'));
  await ensureEstRuntime(ctx);
  const started = performance.now();
  const node = new AudioWorkletNode(ctx, 'est-plugin', {
    // EST 1.1: a second input for the sidechain; the output's channels as asked (a multi-out instrument's 8).
    numberOfInputs: opts.sidechain ? 2 : 1,
    numberOfOutputs: 1,
    outputChannelCount: [Math.max(1, Math.min(8, opts.outputChannels ?? 2))],
    processorOptions: {
      module: compiled.module ?? undefined,
      shim: compiled.shim ?? undefined,
      bytes: compiled.module ? undefined : compiled.bytes,
      pluginId: opts.pluginId,
      maxMemoryPages: opts.maxMemoryPages ?? EST_DEFAULT_PAGES,
      copyOnly: opts.copyOnly,
      statsIntervalMs: opts.statsIntervalMs,
      renderMode: opts.renderMode,
      state: opts.initialState,
      events: opts.initialEvents,
      queueSize: opts.queueSize,
      logParams: opts.logParams?.length ? opts.logParams.slice() : undefined,
      maxChannels: opts.maxChannels,
      sidechain: opts.sidechain,
      notesOut: opts.notesOut,
    },
  });
  return wrapEstNode(node, node.port as unknown as PortLike, started, opts);
}
