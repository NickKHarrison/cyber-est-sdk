/**
 * The dev host's audio side, on **Cyber's own runtime** (D-37: imported from src/audio/est/, never
 * copied): the bundle goes through the compiling Worker exactly as an install does (Cyber's reader,
 * the meter, the compile and the conformance run, `installSession`), and the metered module runs
 * in Cyber's `est-plugin` processor (`createEstNode`, `ensureEstRuntime`, the shim). Notes go
 * through Cyber's `EstNoteMap` and the transport through `estTransportAt`, as the DAW's do.
 */
import { createEstNode, type EstCompiled, type EstEvent, type EstNode, type EstParam, type EstStats } from '@/audio/est/EstNode';
import { EstNoteMap } from '@/audio/est/estNotes';
import { installSession, EstWorkerError } from '@/audio/est/install/workerClient';
import type { ConformanceReport } from '@/audio/est/install/conformance';
import type { InstallTimings } from '@/audio/est/install/workerProtocol';
import { fillLoop, loopSeconds } from '@/audio/est/testLoop';
import { startTicker, type Ticker } from '@/audio/workerClock';
import { compileMeter } from '@/sequencer/meterMap';
import { estTransportAt } from '@/sequencer/estTransport';
import { HANDOVER_FADE_S, HeldKeys, carriedParams, refusedState, type Kept } from './handover';

/** What the page logs (and `--json` prints). */
export type DevLog = { type: string; [k: string]: unknown };

/** The install check's outcome: Cyber's pipeline, as an install sees it. */
export interface InstallCheck {
  ok: boolean;
  code?: string;
  /** The validator's rule id (`rules.ts`), as Cyber's install refusal carries it. */
  rule?: string | null;
  message?: string;
  points?: number;
  timings?: InstallTimings;
  report?: Pick<ConformanceReport, 'ok' | 'phase' | 'deterministic' | 'blockUs'> & Record<string, unknown>;
}

export interface Meters { peak: [number, number]; rms: [number, number] }

const FOUR_FOUR = compileMeter({ num: 4, den: 4 }, []);
/** The transport's look-ahead, as Cyber's (25 ms ticks, windows a little ahead). */
const TICK_MS = 25;
const AHEAD_S = 0.1;
const WINDOW_S = 0.05;

const dbfs = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Install a bundle's bytes in a compiling Worker of its own: the modules, or why it was refused. */
export async function installCheck(bytes: ArrayBuffer, hash: string): Promise<{ check: InstallCheck; module?: WebAssembly.Module; shim?: WebAssembly.Module }> {
  const session = installSession();
  try {
    const r = await session.install(bytes, { expectHash: hash });
    const rep = r.report as ConformanceReport & Record<string, unknown>;
    return { check: { ok: true, points: r.points, timings: r.timings, report: { ...rep } }, module: r.module, shim: r.shim };
  } catch (err) {
    const code = err instanceof EstWorkerError ? err.code : 'worker';
    const rule = err instanceof EstWorkerError ? err.rule : null;
    return { check: { ok: false, code, rule, message: err instanceof Error ? err.message : String(err) } };
  } finally {
    session.close();
  }
}

export interface EngineOptions {
  kind: 'effect' | 'instrument';
  pluginId: string;
  memoryPagesMax: number;
  /** EST tidy (1.286): the ids est.json marks `"scale": "log"` (the processor maps a lane's 0…1 through them). */
  logParams?: number[];
  /**
   * EST 1.1: the sidechain's channels (est.json's `{ "role": "sidechain" }` input; 0 or absent:
   * none) and the most channels a main port has. As Cyber's `est11Options` asks of a 1.1 bundle's
   * node; a 1.0 bundle gives neither, so its node is made exactly as before.
   */
  sidechain?: number;
  maxChannels?: number;
  log: (e: DevLog) => void;
}

/** 1.803: what feeds an effect's sidechain in the dev host: nothing, the test loop's drums, or a steady tone. */
export type KeyKind = 'off' | 'kick' | 'sine';
export const KEY_KINDS: readonly { kind: KeyKind; label: string }[] = [
  { kind: 'off', label: 'Off (silence)' },
  { kind: 'kick', label: "The test loop's drums" },
  { kind: 'sine', label: 'Sine, 110 Hz' },
];
export const isKeyKind = (v: unknown): v is KeyKind => v === 'off' || v === 'kick' || v === 'sine';

/** One running instance and the graph around it. */
export class DevEngine {
  readonly ctx: AudioContext;
  est: EstNode | null = null;
  private opts: EngineOptions;
  /** The running instance's own output gain (1; a hand-over ramps it). */
  private estGain: GainNode | null = null;
  private readonly held = new HeldKeys();
  /** 1.803: the sidechain's source (into the instance's second input, when it has one). */
  private readonly keyGain: GainNode;
  private keySource: AudioScheduledSourceNode | null = null;
  keyKind: KeyKind = 'off';
  private readonly inputGain: GainNode;
  private readonly outGain: GainNode;
  private readonly analysers: [AnalyserNode, AnalyserNode];
  private readonly buf = new Float32Array(2048);
  private source: AudioScheduledSourceNode | null = null;
  private notes: EstNoteMap;
  private ticker: Ticker | null = null;
  private transport = { playing: false, tempo: 120, beat: 0, nextWhen: 0 };
  private offs: (() => void)[] = [];

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.inputGain = new GainNode(this.ctx, { gain: 1 });
    this.keyGain = new GainNode(this.ctx, { gain: 1 });
    this.outGain = new GainNode(this.ctx, { gain: 1 });
    const split = new ChannelSplitterNode(this.ctx, { numberOfOutputs: 2 });
    this.analysers = [new AnalyserNode(this.ctx, { fftSize: 2048 }), new AnalyserNode(this.ctx, { fftSize: 2048 })];
    this.outGain.connect(this.ctx.destination);
    this.outGain.connect(split);
    split.connect(this.analysers[0], 0);
    split.connect(this.analysers[1], 1);
    this.notes = new EstNoteMap(() => this.ctx.currentTime, this.ctx.sampleRate);
  }

  get tempo() { return this.transport.tempo; }
  get playing() { return this.transport.playing; }

  /** This build's settings (a rebuild may change est.json's memory, log parameters or ports). */
  configure(o: Partial<Omit<EngineOptions, 'log'>>) { this.opts = { ...this.opts, ...o }; }

  /** Whether the running instance has a sidechain input. */
  get hasSidechain() { return !!this.est && (this.opts.sidechain ?? 0) > 0; }

  /** A node for this build (not yet connected). */
  private make(module: WebAssembly.Module, shim: WebAssembly.Module, state?: Uint8Array): Promise<EstNode> {
    const compiled: EstCompiled = {
      bytes: new ArrayBuffer(0), module, shim, compiledIn: 'main', mainRefusal: null, compileMs: 0,
      limits: { importsMemory: false, minPages: null, maxPages: null },
    };
    return createEstNode(this.ctx, compiled, {
      pluginId: this.opts.pluginId,
      maxMemoryPages: this.opts.memoryPagesMax > 0 ? this.opts.memoryPagesMax : undefined,
      statsIntervalMs: 500,
      logParams: this.opts.logParams,
      initialState: state ? (state.slice().buffer as ArrayBuffer) : undefined,
      ...(this.opts.maxChannels ? { maxChannels: this.opts.maxChannels } : {}),
      ...(this.opts.sidechain ? { sidechain: this.opts.sidechain } : {}),
    });
  }

  /** Wire a node in as the running instance, through a gain of its own starting at `level`. */
  private adopt(est: EstNode, level: number): GainNode {
    const gain = new GainNode(this.ctx, { gain: level });
    this.inputGain.connect(est.node);
    // EST 1.1: the key feeds the node's second input (silence while the key is Off, as in Cyber with no key chosen).
    if (this.opts.sidechain) this.keyGain.connect(est.node, 0, 1);
    est.node.connect(gain).connect(this.outGain);
    this.est = est;
    this.estGain = gain;
    this.notes = new EstNoteMap(() => this.ctx.currentTime, this.ctx.sampleRate);
    this.offs.push(
      est.on('error', e => this.opts.log({ type: 'error', phase: e.phase, message: e.message })),
      est.on('param', changes => this.opts.log({ type: 'plugin-param', changes })),
      // DEV-F (1.321): a note effect's notes (Cyber routes them nowhere yet; here they are logged).
      est.on('notes', ({ notes, dropped }) => this.opts.log({ type: 'plugin-notes', notes, dropped })),
      est.on('stats', (s: EstStats) => this.opts.log({ type: 'stats', blocks: s.blocks, meanUs: round(s.meanUs), maxUs: round(s.maxUs) })),
    );
    this.opts.log({ type: 'ready', params: est.params.length, latency: est.ready.latency, tail: est.ready.tail, metered: !!est.ready.metered, audioIn: est.ready.audioIn, audioOut: est.ready.audioOut, notePorts: est.ready.notePorts, ...(this.opts.sidechain ? { sidechainIn: est.ready.sidechainIn ?? 0 } : {}) });
    return gain;
  }

  /** Make the instance from the Worker's modules (`state`: carried over a restart). */
  async start(module: WebAssembly.Module, shim: WebAssembly.Module, state?: Uint8Array): Promise<EstNode> {
    this.stopInstance();
    this.held.clear();
    const est = await this.make(module, shim, state);
    this.adopt(est, 1);
    if (this.transport.playing) this.post([this.transportEvent(this.ctx.currentTime, 0)]);
    return est;
  }

  /**
   * 1.803: **hand over to a new build** (handover.ts). The running instance keeps playing while the
   * new one is made from its state; then the two cross over in one ramp each way (`HANDOVER_FADE_S`,
   * the gains summing to one), the new instance is sent the keys still held and the values the old
   * one had, and the transport goes on from its beat. If the new one cannot be made, this throws
   * and the old instance is untouched: it is still the one playing.
   */
  async handOver(module: WebAssembly.Module, shim: WebAssembly.Module): Promise<{ est: EstNode; kept: Kept }> {
    const old = this.est, oldGain = this.estGain;
    if (!old || !oldGain) return { est: await this.start(module, shim), kept: { notes: 0, params: 0, state: false } };
    const before = await old.getParams().catch(() => old.params.map(p => ({ id: p.id, value: p.value })));
    const state = await old.getState().catch(() => null);
    let next: EstNode;
    let stateKept = !!state;
    try {
      next = await this.make(module, shim, state ?? undefined);
    } catch (err) {
      // The new build no longer takes the old state (its layout changed): start it fresh; the values follow below.
      if (!state || !refusedState(err)) throw err;
      stateKept = false;
      next = await this.make(module, shim);
    }
    // From here nothing waits: the swap is one go, so no block is silent and no key is missed.
    const oldOffs = this.offs;
    this.offs = [];
    const oldNotes = this.notes;
    const keys = this.held.list();
    const gain = this.adopt(next, 0);
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + HANDOVER_FADE_S);
    oldGain.gain.setValueAtTime(1, now);
    oldGain.gain.linearRampToValueAtTime(0, now + HANDOVER_FADE_S);
    // The values the old instance had (the state carries them where it loaded; a changed range clamps).
    const values = carriedParams(before, next.params);
    for (const v of values) next.setParam(v.id, v.value);
    // The keys still held: released on the old instance (it is fading), pressed on the new.
    old.scheduleEvents(oldNotes.allNotesOff());
    for (const k of keys) this.post(this.notes.noteOn(k.key, k.velocity, undefined, k.src));
    // The transport goes on from where it is: the new instance gets the window from now to the next one the ticker posts.
    if (this.transport.playing) {
      const t = this.transport;
      const ahead = Math.max(0, t.nextWhen - now);
      this.post([estTransportAt(t.tempo, FOUR_FOUR, { beat: t.beat - (ahead * t.tempo) / 60, toBeat: t.beat, when: now, duration: ahead, playing: true, loop: null })]);
    }
    // The old instance is let go only once the audio clock has passed the fade (never by a timer alone).
    const letGo = () => {
      if (this.ctx.state === 'running' && this.ctx.currentTime < now + HANDOVER_FADE_S + 0.01) { setTimeout(letGo, 10); return; }
      for (const off of oldOffs) off();
      try { this.inputGain.disconnect(old.node); } catch { /* not connected */ }
      try { this.keyGain.disconnect(old.node); } catch { /* it had no sidechain */ }
      try { old.node.disconnect(); oldGain.disconnect(); } catch { /* gone */ }
      old.dispose();
    };
    setTimeout(letGo, HANDOVER_FADE_S * 1000 + 10);
    return { est: next, kept: { notes: keys.length, params: values.length, state: stateKept } };
  }

  private stopInstance() {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.est) {
      try { this.inputGain.disconnect(this.est.node); } catch { /* not connected */ }
      try { this.keyGain.disconnect(this.est.node); } catch { /* it had no sidechain */ }
      try { this.est.node.disconnect(); this.estGain?.disconnect(); } catch { /* gone */ }
      this.est.dispose();
      this.est = null;
      this.estGain = null;
    }
  }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  private post(events: EstEvent[]) { if (events.length) this.est?.scheduleEvents(events); }

  setParam(id: number, value: number) {
    this.est?.setParam(id, value);
  }

  // --- Notes (an instrument's) ------------------------------------------------------------

  noteOn(key: number, velocity = 100, src: 'keys' | 'screen' | 'midi' = 'screen') {
    const events = this.notes.noteOn(key, velocity, undefined, src);
    this.held.on(key, velocity, src);
    this.post(events);
    this.opts.log({ type: 'note-on', key, velocity, src });
  }
  noteOff(key: number, src: 'keys' | 'screen' | 'midi' = 'screen') {
    this.held.off(key);
    this.post(this.notes.noteOff(key, undefined, src));
    this.opts.log({ type: 'note-off', key, src });
  }
  /** Stop every note (each rings out its release). */
  allNotesOff() {
    this.held.clear();
    this.est?.clearNotes();
    this.post(this.notes.allNotesOff());
  }
  /** A MIDI controller message (bend, the wheel, sustain, any CC) as Cyber posts it. */
  control(m: Parameters<EstNoteMap['control']>[0]) { this.post(this.notes.control(m)); }

  // --- The transport --------------------------------------------------------------------

  private transportEvent(when: number, duration: number) {
    const t = this.transport;
    const toBeat = t.beat + (duration * t.tempo) / 60;
    return estTransportAt(t.tempo, FOUR_FOUR, { beat: t.beat, toBeat, when, duration, playing: t.playing, loop: null });
  }

  private tick = () => {
    const t = this.transport;
    if (!t.playing) return;
    const horizon = this.ctx.currentTime + AHEAD_S;
    const events: EstEvent[] = [];
    while (t.nextWhen < horizon) {
      events.push(this.transportEvent(t.nextWhen, WINDOW_S));
      t.beat += (WINDOW_S * t.tempo) / 60;
      t.nextWhen += WINDOW_S;
    }
    this.post(events);
  };

  play() {
    const t = this.transport;
    if (t.playing) return;
    t.playing = true;
    t.nextWhen = this.ctx.currentTime + 0.02;
    this.ticker = startTicker(TICK_MS, this.tick);
    this.tick();
    this.opts.log({ type: 'transport', playing: true, tempo: t.tempo, beat: round(t.beat) });
  }
  stop() {
    const t = this.transport;
    if (!t.playing) return;
    t.playing = false;
    this.ticker?.stop();
    this.ticker = null;
    this.est?.clearNotes();
    this.held.clear();
    this.post([this.transportEvent(this.ctx.currentTime, 0), ...this.notes.allNotesOff()]);
    this.opts.log({ type: 'transport', playing: false, tempo: t.tempo, beat: round(t.beat) });
  }
  /** Back to the first beat (stopped). */
  rewind() { this.stop(); this.transport.beat = 0; }
  setTempo(bpm: number) {
    this.transport.tempo = Math.min(240, Math.max(40, bpm));
    this.opts.log({ type: 'tempo', tempo: this.transport.tempo });
  }

  // --- An effect's input ----------------------------------------------------------------

  /** A test signal into the effect ('off' for none). */
  signal(kind: 'off' | 'sine' | 'noise' | 'pulse') {
    this.stopSource();
    if (kind === 'off') return;
    if (kind === 'sine') {
      const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: 220 });
      const g = new GainNode(this.ctx, { gain: 0.25 });
      o.connect(g).connect(this.inputGain);
      o.start();
      this.source = o;
    } else {
      const sr = this.ctx.sampleRate;
      const b = new AudioBuffer({ length: sr, numberOfChannels: 2, sampleRate: sr });
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 31 - 1; };
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = kind === 'noise' ? rnd() * 0.25 : i % (sr / 2) < sr / 50 ? Math.sin((i / sr) * 2 * Math.PI * 440) * 0.5 : 0;
      }
      const s = new AudioBufferSourceNode(this.ctx, { buffer: b, loop: true });
      s.connect(this.inputGain);
      s.start();
      this.source = s;
    }
    this.opts.log({ type: 'input', signal: kind });
  }

  /** A file into the effect, looped. */
  async playFile(file: Blob, name: string) {
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this.stopSource();
    const s = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    s.connect(this.inputGain);
    s.start();
    this.source = s;
    this.opts.log({ type: 'input', file: name, seconds: round(buffer.duration), channels: buffer.numberOfChannels });
  }

  /**
   * 1.803: what feeds the sidechain (an effect with EST 1.1's `{ "role": "sidechain" }` input):
   * nothing, the test loop's drums (its kick and hats, the loop every test rig plays), or a tone.
   * Without a sidechain it is remembered and feeds nothing.
   */
  key(kind: KeyKind) {
    if (this.keySource) {
      try { this.keySource.stop(); } catch { /* not started */ }
      this.keySource.disconnect();
      this.keySource = null;
    }
    this.keyKind = kind;
    if (kind === 'sine') {
      const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: 110 });
      const g = new GainNode(this.ctx, { gain: 0.5 });
      o.connect(g).connect(this.keyGain);
      o.start();
      this.keySource = o;
    } else if (kind === 'kick') {
      const sr = this.ctx.sampleRate;
      const b = new AudioBuffer({ length: Math.round(loopSeconds() * sr), numberOfChannels: 2, sampleRate: sr });
      fillLoop(b.getChannelData(0), b.getChannelData(1), sr, undefined, 'drums');
      const src = new AudioBufferSourceNode(this.ctx, { buffer: b, loop: true });
      src.connect(this.keyGain);
      src.start();
      this.keySource = src;
    }
    this.opts.log({ type: 'key', kind, sidechain: this.opts.sidechain ?? 0, ...(this.opts.sidechain ? {} : { note: 'this plugin has no sidechain input: the key feeds nothing' }) });
  }

  /** The transport's place, in beats (it goes on through a hand-over). */
  get beat() { return this.transport.beat; }

  private stopSource() {
    if (!this.source) return;
    try { this.source.stop(); } catch { /* not started */ }
    this.source.disconnect();
    this.source = null;
  }

  // --- Meters and state -----------------------------------------------------------------

  /** Peak and RMS of the output's last 2048 samples, per channel, in dBFS. */
  meters(): Meters {
    const peak: [number, number] = [-Infinity, -Infinity];
    const rms: [number, number] = [-Infinity, -Infinity];
    for (let c = 0; c < 2; c++) {
      this.analysers[c]!.getFloatTimeDomainData(this.buf);
      let p = 0, s = 0;
      for (let i = 0; i < this.buf.length; i++) { const x = this.buf[i]!; const a = Math.abs(x); if (a > p) p = a; s += x * x; }
      peak[c] = dbfs(p);
      rms[c] = dbfs(Math.sqrt(s / this.buf.length));
    }
    return { peak, rms };
  }

  /**
   * Wait until every event posted so far is applied. A parameter change is queued in the processor
   * and reaches the plugin in its next block, while a request (`params:get`, `state:get`) is
   * answered at once: without this a state saved right after a change could miss it. A request
   * first (the port is in order, so the change is queued by its reply), then a few render quanta.
   */
  async settle(): Promise<void> {
    const est = this.est;
    if (!est) return;
    await est.getParams();
    const until = this.ctx.currentTime + (4 * 128) / this.ctx.sampleRate;
    const deadline = performance.now() + 1000;
    while (this.ctx.currentTime < until && this.ctx.state === 'running' && performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 5));
    }
  }

  /** Save the state, load it back, and compare the parameters and the bytes. */
  async roundTrip(): Promise<{ bytes: number; paramsEqual: boolean; bytesEqual: boolean; differing: number[] }> {
    const est = this.est;
    if (!est) throw new Error('no instance');
    const before = await est.getParams();
    const saved = await est.getState();
    await est.setState(saved);
    const after = await est.getParams();
    const again = await est.getState();
    const differing = before.filter(b => { const a = after.find(x => x.id === b.id); return !a || Math.abs(a.value - b.value) > 1e-6 * Math.max(1, Math.abs(b.value)); }).map(b => b.id);
    const bytesEqual = saved.length === again.length && saved.every((x, i) => x === again[i]);
    const r = { bytes: saved.length, paramsEqual: differing.length === 0, bytesEqual, differing };
    this.opts.log({ type: 'state', ...r });
    return r;
  }

  async getState(): Promise<Uint8Array | null> { return this.est ? this.est.getState() : null; }
  async setState(bytes: Uint8Array) { await this.est?.setState(bytes); }

  /** The instance's parameters with their current values. */
  params(): EstParam[] { return this.est ? this.est.params.map(p => ({ ...p })) : []; }

  async close() {
    this.stop();
    this.stopSource();
    this.key('off');
    this.stopInstance();
    await this.ctx.close().catch(() => {});
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
