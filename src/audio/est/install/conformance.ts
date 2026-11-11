/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §4; EST_SECURITY_ARCHITECTURE.md §5.3): the
 * install-time conformance run. A Worker has no AudioWorklet and no `OfflineAudioContext`, so this
 * runs **the Phase 1 processor's own code** (`estProcessorMain`, the `est-plugin` processor the
 * worklet runs) on a stand-in audio thread: the globals an `AudioWorkletGlobalScope` gives it
 * (`AudioWorkletProcessor` with a port, `registerProcessor`, `sampleRate`, `currentFrame`) and the
 * two the runtime injects (`EST_ABI`, `EST_BUILD_SHIM`), then `process()` called block by block, as
 * `scripts/check-worklets.mjs` and the runtime's tests do. So the plugin meets exactly the host it
 * will run in: the same lifecycle, import allowlist, memory cap, event delivery and trap handling,
 * on the metered module with the runtime's own fuel.
 *
 * What it checks (a refusal names the first that fails): the instance boots (`ready`, not
 * `error`), it is metered (D-30), its ports and latency fit the manifest, its parameters are sane
 * and match the manifest's mirror when there is one, its state saves, loads and saves the same
 * bytes, and `seconds` of test signal (tones, noise bursts, silence, clicks, every parameter
 * swept by events) come out finite, below +18 dBFS and without a trap. It also records whether two
 * runs are bit-identical and the mean cost of a block (not refusals: a noise plugin may use
 * `random_get`, and this machine is not the user's).
 *
 * An instrument (EST Phase 3, docs/est/EST_Phase3_Work_Order.md §3) is checked the same way with
 * notes for its signal (`instrumentEvents`): it must declare a note input; bursts of notes with
 * ids (more at once than most synths have voices, so stealing runs), chokes by id and by key,
 * note expressions, every parameter swept under the notes, then everything choked; then one
 * sustained note, which must sound, released, after which the output must fall below −60 dBFS
 * within the tail it reports (`phase` 'notes' and 'tail'). Each bundle preset must load
 * ('presets'); whether it then saves the same bytes is recorded, not refused.
 *
 * Runs wherever the processor can: the compiling Worker and Node (the tests). Never in the page.
 */

import { compactAbi } from '../abi/layout';
import type { EstParam } from '../EstNode';
import { estProcessorMain } from '../runtime/estProcessor';
import { buildEstShim } from '../runtime/shim';
import { logParamsOf, modulatableOf, type EstManifest } from './bundle';

const FRAMES = 128;
/**
 * The loudest a sample may be: +18 dBFS (a level explosion beyond it is refused). 1.314 (LCH-21 a):
 * the host clamps every output sample to ±4 and zeroes NaN and ±∞ on its way to the graph, so the
 * run reads the processor's own record of what the plugin wrote (`statPeak`, before the clamp;
 * `statNonFinite`) rather than the samples, which never show anything past the clamp.
 */
export const CONFORMANCE_PEAK_MAX = 8;
/** The largest state a plugin may save (spec §6: 4 MiB; `EST_STATE_BLOB_MAX`). */
const STATE_MAX = 4 * 1024 * 1024;

interface Msg { type: string; [k: string]: unknown }
interface StandInPort { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: Msg, t?: unknown): void; close(): void }
interface Proc { port: StandInPort; process(i: Float32Array[][], o: Float32Array[][]): boolean }
type Ctor = new (o?: unknown) => Proc;

let ctor: Ctor | null = null;
let outbox: Msg[] = [];
/** The request id of the state check's first save (any id: the probe asks nothing else at once). */
const STATE_REQ = 1_000_001;
const scope = globalThis as unknown as Record<string, unknown>;

/** The processor class, registered once on this thread's stand-in scope. */
function processorClass(): Ctor {
  if (ctor) return ctor;
  class StandIn {
    port: StandInPort;
    constructor() {
      this.port = { onmessage: null, postMessage: (m: Msg) => { outbox.push(m); }, close() {} };
    }
  }
  scope.AudioWorkletProcessor = StandIn;
  scope.registerProcessor = (name: string, c: Ctor) => { if (name === 'est-plugin') ctor = c; };
  scope.EST_ABI = compactAbi();
  scope.EST_BUILD_SHIM = buildEstShim;
  if (typeof scope.sampleRate !== 'number') scope.sampleRate = 48000;
  if (typeof scope.currentFrame !== 'number') scope.currentFrame = 0;
  estProcessorMain();
  if (!ctor) throw new Error('the EST processor did not register');
  return ctor;
}

/** Below this, after the tail, an instrument is silent (−60 dBFS). */
export const CONFORMANCE_TAIL_FLOOR = 0.001;
/** A held note must reach at least this (−80 dBFS) to count as sounding. */
export const CONFORMANCE_SOUND_FLOOR = 0.0001;

export interface ConformanceInput {
  module: WebAssembly.Module;
  shim: WebAssembly.Module;
  manifest: Pick<EstManifest, 'id' | 'kind' | 'audio' | 'limits' | 'parameters'> & { notes?: EstManifest['notes']; edition?: EstManifest['edition']; sidechain?: number };
  /** EST Phase 3: the bundle's presets (state streams), each loaded and saved again. */
  presets?: { path: string; bytes: Uint8Array }[];
  sampleRate?: number;
  /** Seconds of test signal (default 10, the security document's §5.3). */
  seconds?: number;
  /** Tests of unmetered fixtures only: do not refuse a module without the fuel exports. */
  allowUnmetered?: boolean;
  /** The runtime's fuel (tests; the default is the runtime's own). */
  fuel?: { block?: number; call?: number };
}

export interface ConformanceReport {
  ok: boolean;
  /** Why it was refused (plain words), when it was. */
  problem: string | null;
  /** The phase that failed: 'boot', 'metering', 'ports', 'params', 'state', 'presets', 'process', 'notes', 'tail'. */
  phase: string | null;
  /** EST Phase 4: the validator's rule for the failure (`rules.ts`, `EST-C0xx`), when it failed. */
  rule: string | null;
  blocks: number;
  params: EstParam[];
  latency: number;
  tail: number;
  metered: boolean;
  peak: number;
  stateBytes: number | null;
  deterministic: boolean | null;
  /** Mean wall time of one `process()` call, µs (this machine, the metered module, the stand-in host's own work included). */
  blockUs: number;
  /** EST Phase 3: the note input ports the instance reports. */
  notePorts: number;
  /** An instrument's run: note-ons sent, NOTE_ENDs it reported (null for an effect). */
  notesSent: number | null;
  noteEnds: number | null;
  /** The held note's peak, and whether the tail was checked (it fit in the run) and kept. */
  heldPeak: number | null;
  tailChecked: boolean | null;
  /** The presets loaded, and whether each saved back exactly its own bytes (null: none). */
  presets: number;
  presetsExact: boolean | null;
}

/**
 * One instance on the stand-in thread: its boot messages, `send` (a port message, returning what
 * it posted), `ask` (a request and its reply) and `block` (one block of audio at a frame). Also
 * what the tests drive a plugin with.
 */
export function standInInstance(input: Pick<ConformanceInput, 'module' | 'shim' | 'manifest' | 'fuel'>, sr = 48000, opts: { queueSize?: number } = {}) {
  const C = processorClass();
  outbox = [];
  scope.sampleRate = sr;
  scope.currentFrame = 0;
  const logParams = logParamsOf(input.manifest);
  // EST 1.1 (1.327): a 1.1 bundle's ports as the host will run them (its channels, the sidechain, the note output).
  const m = input.manifest;
  const v11 = m.edition === '1.1' ? {
    maxChannels: Math.min(8, Math.max(2, m.audio.inputs, m.audio.outputs)),
    ...(m.sidechain ? { sidechain: m.sidechain } : {}),
    ...(m.notes?.outputs ? { notesOut: true } : {}),
  } : {};
  const proc = new C({ processorOptions: { module: input.module, shim: input.shim, pluginId: input.manifest.id, maxMemoryPages: input.manifest.limits.memoryPagesMax, statsIntervalMs: 1e12, fuel: input.fuel, ...(logParams.length ? { logParams } : {}), ...(opts.queueSize ? { queueSize: opts.queueSize } : {}), ...v11 } });
  const boot = outbox.splice(0);
  let req = 1;
  const send = (m: Record<string, unknown>): Msg[] => {
    outbox = [];
    proc.port.onmessage?.({ data: m });
    return outbox.splice(0);
  };
  const ask = (m: Record<string, unknown>): Msg | null => {
    const id = req++;
    return send({ ...m, req: id }).find(x => x.type === 'reply' && x.req === id) ?? null;
  };
  const block = (inL: Float32Array, inR: Float32Array, frame: number): { out: [Float32Array, Float32Array]; posted: Msg[] } => {
    const out: [Float32Array, Float32Array] = [new Float32Array(inL.length), new Float32Array(inR.length)];
    scope.currentFrame = frame;
    outbox = [];
    proc.process([[inL, inR]], [out]);
    return { out, posted: outbox.splice(0) };
  };
  return { proc, boot, send, ask, block };
}

/** The test signal for block `b` of channel `c`: tones, noise bursts, silence and clicks. */
function fillInput(buf: Float32Array, b: number, c: number, sr: number, rng: () => number) {
  const t0 = b * FRAMES;
  const second = Math.floor(t0 / sr);
  const phase = second % 4;
  for (let i = 0; i < FRAMES; i++) {
    const t = (t0 + i) / sr;
    let v = 0;
    if (phase === 0) v = 0.25 * Math.sin(2 * Math.PI * (c ? 330 : 220) * t);
    else if (phase === 1) v = 0.25 * (rng() * 2 - 1);
    else if (phase === 3) v = 0.5 * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 7040 * t);
    if ((t0 + i) % sr === 0) v = c ? -1 : 1; // a full-scale click each second
    buf[i] = v;
  }
}

/** Parameter events for the run: each parameter to its min, max, a middle value and back to its default. */
/** The most parameters the sweep touches (the first ones): four stops each. */
const SWEEP_PARAMS = 64;

function sweepEvents(params: EstParam[], seconds: number, span = 0.9) {
  const out: { type: 'param'; time: number; id: number; value: number }[] = [];
  const stops = (p: EstParam) => [p.min, p.max, (p.min + p.max) / 2, p.def];
  params.slice(0, SWEEP_PARAMS).forEach((p, k) => {
    stops(p).forEach((value, j) => {
      const time = ((k * 4 + j + 1) / (params.slice(0, SWEEP_PARAMS).length * 4 + 2)) * seconds * span;
      out.push({ type: 'param', time, id: p.id, value });
    });
  });
  return out.sort((a, b) => a.time - b.time).slice(0, 900);
}

/** One note event as the processor takes it (`noteId` -1, `key`, `channel` or `port` -1: any). */
type NoteEvent = { type: 'noteOn' | 'noteOff' | 'choke'; time: number; key: number; channel: number; port: number; noteId: number; velocity?: number };
/**
 * A note expression (CLAP `NOTE_EXPRESSION`). Phase 3's processor shape (3-A delivers it): until
 * the processor knows the type it drops it, so the run is the same either way.
 */
type ExpressionEvent = { type: 'expression'; time: number; expression: number; noteId: number; key: number; channel: number; port: number; value: number };

/** Where the instrument run's parts fall, as fractions of the run. */
const SWEEP_END = 0.55, HOLD_ON = 0.6, HOLD_OFF = 0.72;

/**
 * The instrument run's notes (seconds `S`): bursts every 0.2 s up to `SWEEP_END` (1 to 12 notes
 * at once with fresh ids, 50 to 300 ms long, varied keys and velocities), a choke by id and one by
 * key every fifth burst, a tuning, volume and brightness expression on each burst's first note,
 * then everything choked; then one held note from `HOLD_ON` to `HOLD_OFF`.
 */
export function instrumentEvents(S: number): { events: (NoteEvent | ExpressionEvent)[]; notes: number; hold: { on: number; off: number } } {
  const events: (NoteEvent | ExpressionEvent)[] = [];
  let id = 1, notes = 0;
  const on = (time: number, key: number, velocity: number) => {
    const noteId = id++;
    notes++;
    events.push({ type: 'noteOn', time, key, channel: 0, port: 0, noteId, velocity });
    return noteId;
  };
  for (let k = 0; 0.2 * k < SWEEP_END * S - 0.35; k++) {
    const t = 0.2 * k + 0.01;
    const count = 1 + (k % 12);
    const ids: number[] = [];
    for (let j = 0; j < count; j++) {
      const key = 36 + ((k * 7 + j * 5) % 61);
      const noteId = on(t + j * 0.001, key, 0.3 + ((k + j) % 7) / 10);
      ids.push(noteId);
      events.push({ type: 'noteOff', time: t + 0.05 + ((k * 3 + j) % 6) * 0.05, key, channel: 0, port: 0, noteId });
    }
    events.push({ type: 'expression', time: t + 0.02, expression: 2, noteId: ids[0]!, key: -1, channel: -1, port: -1, value: ((k % 5) - 2) * 0.5 });
    events.push({ type: 'expression', time: t + 0.025, expression: 0, noteId: ids[0]!, key: -1, channel: -1, port: -1, value: 0.5 + (k % 4) * 0.5 });
    events.push({ type: 'expression', time: t + 0.03, expression: 5, noteId: ids[0]!, key: -1, channel: -1, port: -1, value: (k % 3) / 2 });
    if (k % 5 === 4) {
      events.push({ type: 'choke', time: t + 0.04, key: -1, channel: -1, port: -1, noteId: ids[0]! });
      const last = events.filter((e): e is NoteEvent => e.type === 'noteOn' && e.noteId === ids[ids.length - 1]).pop()!;
      events.push({ type: 'choke', time: t + 0.045, key: last.key, channel: 0, port: 0, noteId: -1 });
    }
  }
  events.push({ type: 'choke', time: SWEEP_END * S, key: -1, channel: -1, port: -1, noteId: -1 });
  const hold = { on: HOLD_ON * S, off: HOLD_OFF * S };
  const held = on(hold.on, 60, 0.8);
  events.push({ type: 'noteOff', time: hold.off, key: 60, channel: 0, port: 0, noteId: held });
  return { events: events.sort((a, b) => a.time - b.time), notes, hold };
}

function render(input: ConformanceInput, sr: number, blocks: number, params: EstParam[] | null) {
  const S = (blocks * FRAMES) / sr;
  const instrument = input.manifest.kind === 'instrument';
  // An instrument: its notes; the held note's window, and where its tail must have ended.
  const plan = instrument ? instrumentEvents(S) : null;
  // 1.331: every event is queued before the first block, so the queue holds them all: the sweep (at
  // most 64 parameters × 4 stops), the notes (about 43 events a second of the run: past 20 s they
  // overflowed the processor's 1024 and the held note at the end, queued last, was dropped) and a margin.
  const inst = standInInstance(input, sr, { queueSize: SWEEP_PARAMS * 4 + (plan?.events.length ?? 0) + 256 });
  const ready = inst.boot.find(m => m.type === 'ready');
  const error = inst.boot.find(m => m.type === 'error');
  const none = { held: 0, after: 0, afterFrom: -1, notes: 0, tail: 0 };
  if (!ready) return { inst, ready: null, error: error ? `${String(error.phase)}: ${String(error.message)}` : 'the processor did not answer', hash: 0, peak: 0, ms: 0, trap: null as string | null, trapRule: 'EST-C013', finite: true, ...none };
  const ps = (params ?? (ready.params as EstParam[])) || [];
  if (ps.length) inst.send({ type: 'events', events: sweepEvents(ps, S, instrument ? SWEEP_END * 0.95 : 0.9) });
  const tail = Number(ready.tail) || 0;
  const heldFrom = plan ? Math.round((plan.hold.on + 0.05) * sr) : -1;
  const heldTo = plan ? Math.round(plan.hold.off * sr) : -1;
  const afterFrom = plan && tail !== 0xffffffff ? heldTo + tail + FRAMES : -1;
  if (plan) inst.send({ type: 'events', events: plan.events });
  inst.send({ type: 'events', events: [{ type: 'transport', tempo: 120, beat: 0, playing: true, num: 4, den: 4 }] });
  let seed = 0x9e3779b9;
  const rng = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const inL = new Float32Array(FRAMES), inR = new Float32Array(FRAMES);
  const outL = new Float32Array(FRAMES), outR = new Float32Array(FRAMES);
  const inputs = [[inL, inR]], outputs = [[outL, outR]];
  let hash = 0x811c9dc5, peak = 0, finite = true, held = 0, after = 0;
  const limited = inst.proc as unknown as { statNonFinite?: number; statPeak?: number };
  let trap: string | null = null;
  const bits = new Uint32Array(outL.buffer);
  const bitsR = new Uint32Array(outR.buffer);
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let ms = 0;
  for (let b = 0; b < blocks; b++) {
    scope.currentFrame = b * FRAMES;
    if (!instrument) {
      fillInput(inL, b, 0, sr, rng);
      fillInput(inR, b, 1, sr, rng);
    }
    outbox = [];
    const t0 = clock();
    inst.proc.process(inputs, outputs);
    ms += clock() - t0;
    const err = outbox.find(m => m.type === 'error');
    if (err) { trap = `block ${b}: ${String(err.phase)}: ${String(err.message)}`; break; }
    // 1.314: the host's own record (its clamp runs before the samples reach here).
    if ((limited.statNonFinite ?? 0) > 0) finite = false;
    if ((limited.statPeak ?? 0) > peak) peak = limited.statPeak!;
    for (let i = 0; i < FRAMES; i++) {
      const l = outL[i]!, r = outR[i]!;
      if (!Number.isFinite(l) || !Number.isFinite(r)) { finite = false; break; }
      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > peak) peak = a;
      if (plan) {
        const f = b * FRAMES + i;
        if (f >= heldFrom && f < heldTo && a > held) held = a;
        if (afterFrom >= 0 && f >= afterFrom && a > after) after = a;
      }
      hash = Math.imul(hash ^ bits[i]!, 0x01000193) >>> 0;
      hash = Math.imul(hash ^ bitsR[i]!, 0x01000193) >>> 0;
    }
    if (!finite) { trap = `block ${b}: the output is not finite (NaN or infinity)`; break; }
  }
  const ended = afterFrom >= 0 && afterFrom + FRAMES < blocks * FRAMES;
  return { inst, ready, error: null as string | null, hash, peak, ms, trap, trapRule: finite ? 'EST-C013' : 'EST-C014', finite, held, after, afterFrom: ended ? afterFrom : -1, notes: plan?.notes ?? 0, tail };
}

/**
 * 1.400 (P3): what an `EST-C013` trap during the run most likely is, after the processor's own
 * words: an `unreachable` or an out-of-bounds access is, in a first plugin, nearly always memory
 * allocated in `render()` (the SDK's heap never gives a block back, so it runs out) or a loop that
 * spent the block's fuel; a division by zero says so already.
 */
export function trapHint(trap: string): string {
  if (/divide by zero|division by zero/i.test(trap)) return '. Guard the division (a parameter at 0, an empty buffer)';
  if (/unreachable|out of bounds|memory|stack/i.test(trap)) {
    return '. Probably allocating in render(): every new, array or string after activate takes heap memory that is never given back, until it runs out (allocate in the constructor or activate), or a loop that does not end within the block';
  }
  return '';
}

/** Run the checks. Never throws for the plugin's faults: they come back as `ok: false`. */
export function runConformance(input: ConformanceInput): ConformanceReport {
  const sr = input.sampleRate ?? 48000;
  const blocks = Math.max(1, Math.ceil(((input.seconds ?? 10) * sr) / FRAMES));
  const report: ConformanceReport = {
    ok: false, problem: null, phase: null, rule: null, blocks: 0, params: [], latency: 0, tail: 0, metered: false, peak: 0, stateBytes: null, deterministic: null, blockUs: 0,
    notePorts: 0, notesSent: null, noteEnds: null, heldPeak: null, tailChecked: null, presets: 0, presetsExact: null,
  };
  const fail = (phase: string, problem: string, rule: string) => { report.phase = phase; report.problem = problem; report.rule = rule; report.ok = false; return report; };
  const disposeAll: Proc[] = [];
  try {
    // 1. Boot, and the static facts the instance reports.
    const probe = standInInstance(input, sr);
    disposeAll.push(probe.proc);
    const ready = probe.boot.find(m => m.type === 'ready');
    if (!ready) {
      const err = probe.boot.find(m => m.type === 'error');
      // EST tidy (1.286, D-43): a trap or running out of fuel in the optional `_initialize()` is its own rule.
      if (err && err.phase === 'initialize') return fail('boot', `its _initialize stopped (${String(err.message)})`, 'EST-W016');
      return fail('boot', err ? `it did not start (${String(err.phase)}: ${String(err.message)})` : 'it did not start', 'EST-C001');
    }
    report.params = (ready.params as EstParam[]) ?? [];
    report.latency = Number(ready.latency) || 0;
    report.tail = Number(ready.tail) || 0;
    report.metered = ready.metered === true;
    if (!report.metered && !input.allowUnmetered) return fail('metering', 'the module is not metered', 'EST-C002');
    const m = input.manifest;
    const audioIn = Number(ready.audioIn) || 0, audioOut = Number(ready.audioOut) || 0;
    if (m.kind === 'effect' && (audioIn < 1 || audioOut < 1)) return fail('ports', 'an effect without an audio input and output', 'EST-C003');
    report.notePorts = Number(ready.notePorts) || 0;
    if (m.kind === 'instrument') {
      if (report.notePorts < 1) return fail('ports', 'an instrument without a note input port (clap.note-ports)', 'EST-C004');
      if (m.notes && m.notes.inputs && report.notePorts !== m.notes.inputs) return fail('ports', `the module has ${report.notePorts} note inputs, est.json says ${m.notes.inputs}`, 'EST-C004');
      if (audioOut < 1) return fail('ports', 'an instrument without an audio output', 'EST-C003');
    }
    // DEV-F (1.321): a note effect's ports, both ways, as est.json says (an older plugin declares none).
    const noteOut = Number(ready.noteOutPorts) || 0;
    if (m.kind === 'effect' && m.notes && report.notePorts !== m.notes.inputs) return fail('ports', `the module has ${report.notePorts} note inputs, est.json says ${m.notes.inputs}`, 'EST-C004');
    // A 1.1 bundle's note output is EST-C023 (1.327: DEV-H's rule, one check with DEV-F's), a 1.0 one's EST-C004.
    if (m.notes && noteOut !== m.notes.outputs) return fail('ports', `the module has ${noteOut} note outputs, est.json says ${m.notes.outputs}`, m.edition === '1.1' ? 'EST-C023' : 'EST-C004');
    if (m.audio.inputs && audioIn !== m.audio.inputs) return fail('ports', `the module has ${audioIn} input channels, est.json says ${m.audio.inputs}`, 'EST-C003');
    if (m.audio.outputs && audioOut !== m.audio.outputs) return fail('ports', `the module has ${audioOut} output channels, est.json says ${m.audio.outputs}`, 'EST-C003');
    // EST 1.1 (1.327): the sidechain est.json declares is the plugin's input port 1 (its note output: above).
    if (m.edition === '1.1') {
      if (m.sidechain && (Number(ready.sidechainIn) || 0) !== m.sidechain) return fail('ports', `the module's sidechain (input port 1) has ${Number(ready.sidechainIn) || 0} channels, est.json says ${m.sidechain}`, 'EST-C003');
    }
    if (report.latency > m.limits.maxLatencyFrames) return fail('ports', `a latency of ${report.latency} frames, over est.json's ${m.limits.maxLatencyFrames}`, 'EST-C005');
    const tailMax = m.limits.tailSeconds * sr;
    if (report.tail !== 0xffffffff && report.tail > tailMax + sr) return fail('ports', `a tail of ${(report.tail / sr).toFixed(1)} s, over est.json's ${m.limits.tailSeconds} s`, 'EST-C006');
    // 2. Parameters: sane, unique, and the manifest's mirror when it has one (spec §5).
    if (report.params.length > 512) return fail('params', `${report.params.length} parameters (at most 512)`, 'EST-C007');
    const ids = new Set<number>();
    for (const p of report.params) {
      if (ids.has(p.id)) return fail('params', `parameter id ${p.id} twice`, 'EST-C007');
      ids.add(p.id);
      if (![p.min, p.max, p.def].every(Number.isFinite) || p.min > p.max || p.def < p.min || p.def > p.max) return fail('params', `parameter ${p.id} (${p.name}) has a bad range`, 'EST-C007');
    }
    if (m.parameters.length) {
      const listed = new Set(m.parameters.map(p => p.id));
      if (listed.size !== ids.size || [...ids].some(id => !listed.has(id))) return fail('params', 'the parameters differ from est.json\'s list', 'EST-C008');
    }
    // EST tidy (1.286, D-44): a parameter est.json marks "log" moves geometrically, so its range is above 0 and not stepped.
    for (const id of logParamsOf(m)) {
      const p = report.params.find(x => x.id === id);
      if (p && p.scale !== 'log') return fail('params', `parameter ${p.id} (${p.name}) is marked "scale": "log" but its range (${p.min} to ${p.max}${p.flags & 1 ? ', stepped' : ''}) does not stay above 0`, 'EST-C021');
    }
    // EST 1.1 (1.327): a parameter est.json marks modulatable is flagged CLAP_PARAM_IS_MODULATABLE (1 << 10) in the DSP.
    for (const id of modulatableOf(m)) {
      const p = report.params.find(x => x.id === id);
      if (p && !(p.flags & 1024)) return fail('params', `parameter ${p.id} (${p.name}) is marked "modulatable" but the DSP does not flag it CLAP_PARAM_IS_MODULATABLE`, 'EST-C022');
    }
    // 3. State: save, load, save again; the same bytes.
    // What the save posted, read from `send`'s own messages (it empties the outbox): a trap posts an
    // error, a refused save (clap.state's save returned false, or wrote past the runtime's 4 MiB) a
    // reply without bytes.
    const saved = probe.send({ type: 'state:get', req: STATE_REQ });
    const s1 = saved.find(x => x.type === 'reply' && x.req === STATE_REQ) ?? null;
    const trapped = saved.find(x => x.type === 'error');
    if (trapped) return fail('state', `it stopped while saving its state (${String(trapped.phase)}: ${String(trapped.message)})`, 'EST-C011');
    // EST tidy (1.286): the runtime refuses a save past the cap as it is written and says so (EST-C009).
    if (s1 && typeof s1.error === 'string' && /larger than 4 MiB/.test(s1.error)) return fail('state', `its state is larger than ${STATE_MAX} bytes (4 MiB): the runtime refused the save as it was written`, 'EST-C009');
    if (!s1 || !(s1.bytes instanceof ArrayBuffer)) return fail('state', `it did not save its state (${s1 ? String(s1.error ?? 'no bytes') : 'no answer'}: clap.state's save returned false, wrote more than 4 MiB, or the plugin has no clap.state)`, 'EST-C020');
    const a = new Uint8Array(s1.bytes);
    if (a.length > STATE_MAX) return fail('state', `a state of ${a.length} bytes (at most ${STATE_MAX})`, 'EST-C009');
    const back = probe.ask({ type: 'state:set', bytes: a.slice().buffer });
    if (!back || back.ok !== true) return fail('state', `it refused its own state (${back ? String(back.error) : 'no answer'})`, 'EST-C010');
    const s2 = probe.ask({ type: 'state:get' });
    const b = s2 && s2.bytes instanceof ArrayBuffer ? new Uint8Array(s2.bytes) : null;
    if (!b || b.length !== a.length || b.some((x, i) => x !== a[i])) return fail('state', 'its state changed on a save, load and save', 'EST-C010');
    report.stateBytes = a.length;
    // 3b. The bundle's presets (EST Phase 3, spec §6): each loads; whether it saves back the same bytes is noted.
    for (const p of input.presets ?? []) {
      const back = probe.ask({ type: 'state:set', bytes: p.bytes.slice().buffer });
      if (!back || back.ok !== true) return fail('presets', `it refused its preset ${p.path} (${back ? String(back.error) : 'no answer'})`, 'EST-C012');
      const again = probe.ask({ type: 'state:get' });
      const b = again && again.bytes instanceof ArrayBuffer ? new Uint8Array(again.bytes) : null;
      const same = !!b && b.length === p.bytes.length && b.every((x, i) => x === p.bytes[i]);
      report.presetsExact = (report.presetsExact ?? true) && same;
      report.presets++;
    }
    probe.send({ type: 'dispose' });
    // 4. The run, twice: finite, bounded, no trap; bit-identical or not.
    const one = render(input, sr, blocks, report.params);
    disposeAll.push(one.inst.proc);
    if (one.error) return fail('boot', `it did not start again (${one.error})`, 'EST-C001');
    if (one.trap) return fail('process', `it stopped while processing (${one.trap})${one.trapRule === 'EST-C013' ? trapHint(one.trap) : ''}`, one.trapRule);
    report.blocks = blocks;
    report.peak = one.peak;
    report.blockUs = (one.ms * 1000) / blocks;
    if (one.peak > CONFORMANCE_PEAK_MAX) return fail('process', `its output reached ${(20 * Math.log10(one.peak)).toFixed(1)} dBFS (at most +18)`, 'EST-C015');
    if (m.kind === 'instrument') {
      report.notesSent = one.notes;
      report.noteEnds = (one.inst.proc as unknown as { noteEnds?: number }).noteEnds ?? null;
      report.heldPeak = one.held;
      if (one.held < CONFORMANCE_SOUND_FLOOR) return fail('notes', 'it made no sound for a held note', 'EST-C016');
      report.tailChecked = one.afterFrom >= 0;
      if (report.tailChecked && one.after > CONFORMANCE_TAIL_FLOOR) {
        return fail('tail', `it still sounded at ${(20 * Math.log10(one.after)).toFixed(1)} dBFS after the ${(one.tail / sr).toFixed(2)} s tail it reports`, 'EST-C017');
      }
    }
    one.inst.send({ type: 'dispose' });
    const two = render(input, sr, blocks, report.params);
    disposeAll.push(two.inst.proc);
    report.deterministic = !two.error && !two.trap && two.hash === one.hash;
    two.inst.send({ type: 'dispose' });
    report.ok = true;
    return report;
  } catch (err) {
    return fail(report.phase ?? 'boot', err instanceof Error ? err.message : String(err), report.rule ?? 'EST-C001');
  } finally {
    for (const p of disposeAll) { try { p.port.onmessage?.({ data: { type: 'dispose' } }); } catch { /* gone */ } }
    outbox = [];
  }
}
