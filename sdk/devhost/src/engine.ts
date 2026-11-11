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
import { startTicker, type Ticker } from '@/audio/workerClock';
import { compileMeter } from '@/sequencer/meterMap';
import { estTransportAt } from '@/sequencer/estTransport';

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
  log: (e: DevLog) => void;
}

/** One running instance and the graph around it. */
export class DevEngine {
  readonly ctx: AudioContext;
  est: EstNode | null = null;
  private readonly opts: EngineOptions;
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

  /** Make the instance from the Worker's modules (`state`: carried over a rebuild). */
  async start(module: WebAssembly.Module, shim: WebAssembly.Module, state?: Uint8Array): Promise<EstNode> {
    this.stopInstance();
    const compiled: EstCompiled = {
      bytes: new ArrayBuffer(0), module, shim, compiledIn: 'main', mainRefusal: null, compileMs: 0,
      limits: { importsMemory: false, minPages: null, maxPages: null },
    };
    const est = await createEstNode(this.ctx, compiled, {
      pluginId: this.opts.pluginId,
      maxMemoryPages: this.opts.memoryPagesMax > 0 ? this.opts.memoryPagesMax : undefined,
      statsIntervalMs: 500,
      logParams: this.opts.logParams,
      initialState: state ? (state.slice().buffer as ArrayBuffer) : undefined,
    });
    this.est = est;
    this.notes = new EstNoteMap(() => this.ctx.currentTime, this.ctx.sampleRate);
    this.inputGain.connect(est.node);
    est.node.connect(this.outGain);
    this.offs.push(
      est.on('error', e => this.opts.log({ type: 'error', phase: e.phase, message: e.message })),
      est.on('param', changes => this.opts.log({ type: 'plugin-param', changes })),
      // DEV-F (1.321): a note effect's notes (Cyber routes them nowhere yet; here they are logged).
      est.on('notes', ({ notes, dropped }) => this.opts.log({ type: 'plugin-notes', notes, dropped })),
      est.on('stats', (s: EstStats) => this.opts.log({ type: 'stats', blocks: s.blocks, meanUs: round(s.meanUs), maxUs: round(s.maxUs) })),
    );
    this.opts.log({ type: 'ready', params: est.params.length, latency: est.ready.latency, tail: est.ready.tail, metered: !!est.ready.metered, audioIn: est.ready.audioIn, audioOut: est.ready.audioOut, notePorts: est.ready.notePorts });
    if (this.transport.playing) this.post([this.transportEvent(this.ctx.currentTime, 0)]);
    return est;
  }

  private stopInstance() {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.est) {
      try { this.inputGain.disconnect(this.est.node); } catch { /* not connected */ }
      this.est.dispose();
      this.est = null;
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
    this.post(events);
    this.opts.log({ type: 'note-on', key, velocity, src });
  }
  noteOff(key: number, src: 'keys' | 'screen' | 'midi' = 'screen') {
    this.post(this.notes.noteOff(key, undefined, src));
    this.opts.log({ type: 'note-off', key, src });
  }
  /** Stop every note (each rings out its release). */
  allNotesOff() {
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
    this.stopInstance();
    await this.ctx.close().catch(() => {});
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
