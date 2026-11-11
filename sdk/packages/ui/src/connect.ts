/**
 * `connect()`: a plugin page's link to its host. It reads the nonce and the host's origin from the
 * fragment, sends `est:ready`, takes `est:init` (sent on the frame's load and again on `est:ready`)
 * and every later `est:param`, and checks each message as the host checks the frame's
 * (`protocol.ts`). Outbound parameter changes are coalesced to the animation frame and kept under
 * the host's rate limit; a gesture's `begin` and `end` are never dropped and keep their order.
 *
 * Protocol version 2 (EST Phase 5a): `rate` (the host's sample rate, Hz, or null), `theme` (the
 * host's colours, also set on the page as the CSS variables `--est-bg`, `--est-fg` and
 * `--est-accent`), `meters` (whether `est:meter` comes) and `onMeter`, `onTheme`, `resize()`. The
 * page speaks the version of the last `est:init` it took (`version`), so it works with a host
 * from before version 2 too (no rate, theme or meters there; `resize()` does nothing).
 *
 * EST 1.1 (Cyber 1.327), version 3: `audio(opts, fn)` asks the host for an analysis of the plugin's
 * output (`est:audio`) and calls `fn` with each `est:spectrum`; its return stops it. `audioAvailable`
 * says whether the host answers (est.json's `ui.audio: true`, a version-3 host).
 */
import {
  AUDIO_FFT_SIZES, AUDIO_PER_SECOND, audioMessage, checkHostMessage, clampSize, clampValue, EST_UI_PROTOCOL, gestureMessage, paramMessage, readFragment, readyMessage, resizeMessage, sendGate,
  type EstUiMeter, type EstUiParam, type EstUiSpectrum, type EstUiTheme, type EstUiVersion, type FrameMessage,
} from './protocol';

/** Who changed a value: the host (a knob, automation, a collaborator) or this page. */
export type ChangeSource = 'host' | 'ui';
/** `id` is null when every parameter may have changed (`est:init`). */
export type ParamListener = (id: number | null, source: ChangeSource) => void;

/** What a control reads and writes: a `Connection`, or anything shaped like one (the dev host's own). */
export interface ParamSource {
  param(id: number): EstUiParam | undefined;
  params(): EstUiParam[];
  get(id: number): number | undefined;
  set(id: number, value: number): void;
  begin(id: number): void;
  end(id: number): void;
  subscribe(fn: ParamListener): () => void;
}

/** How messages travel (the window's `postMessage` by default; a test passes its own). */
export interface Transport {
  post(m: FrameMessage): void;
  /** `ok` is false for a message from anything but the host's window and origin. */
  listen(fn: (data: unknown, ok: boolean) => void): () => void;
}

export interface ConnectOptions {
  /** Defaults to the fragment's `n`. */
  nonce?: string;
  /** Defaults to the fragment's `p`: only messages from this origin are taken (when it is known). */
  hostOrigin?: string;
  transport?: Transport;
  /** Called on each `est:init` (after the values are in). */
  onInit?: (params: EstUiParam[]) => void;
  /** Schedules a flush (the animation frame by default). */
  schedule?: (fn: () => void) => void;
  /** The send budget's clock (tests). */
  now?: () => number;
  /** Where the theme's CSS variables go (default the page's `<html>` for the page's own connection; null: nowhere). */
  themeTarget?: HTMLElement | null;
}

export interface Connection extends ParamSource {
  readonly nonce: string;
  /** Resolves on the first `est:init`. */
  readonly ready: Promise<EstUiParam[]>;
  /** Messages refused (a wrong sender, nonce, shape, value). */
  readonly rejected: number;
  /** Whether an `est:init` has arrived. */
  readonly initialised: boolean;
  /** The protocol version this page speaks now (that of the last `est:init`; 2 before any). */
  readonly version: EstUiVersion;
  /** Version 2: the host's sample rate (Hz), or null (not said, or no audio running). */
  readonly rate: number | null;
  /** Version 2: the host's colours, or null (not said). */
  readonly theme: EstUiTheme | null;
  /** Version 2: whether the host sends `est:meter`. */
  readonly meters: boolean;
  /** Version 2: each `est:meter` (at most 30 a second). Returns the unsubscribe. */
  onMeter(fn: (m: EstUiMeter) => void): () => void;
  /** Version 2: each theme the host gives (in `est:init` and `est:theme`). Returns the unsubscribe. */
  onTheme(fn: (t: EstUiTheme) => void): () => void;
  /** Version 3 (EST 1.1): whether the host answers `audio()` (est.json's `ui.audio`, a version-3 host). */
  readonly audioAvailable: boolean;
  /**
   * Version 3 (EST 1.1): the plugin's output, analysed by the host: `fn` gets each spectrum (bins in
   * whole dB, `fftSize / 2` of them; the RMS) at most `rate` a second (1…30; `fftSize` 64…2048, a
   * power of two, else the nearest). Returns the stop. Nothing comes where `audioAvailable` is false.
   */
  audio(opts: { fftSize?: number; rate?: number }, fn: (s: EstUiSpectrum) => void): () => void;
  /**
   * Version 2: ask the host to size the frame (CSS pixels, clamped to the manifest's bounds); the
   * host takes it only when est.json's `ui.resizable` is true. False when not sent (a version-1 host).
   */
  resize(w: number, h: number): boolean;
  /** Send what is queued now (normally done on the next animation frame). */
  flush(): void;
  close(): void;
}

function windowTransport(hostOrigin: string): Transport {
  return {
    // The frame's origin is opaque and the host's differs: '*' is the only target that arrives
    // (the host checks the sender's window and the nonce; nothing secret is sent).
    post: m => window.parent.postMessage(m, '*'),
    listen(fn) {
      const on = (e: MessageEvent) => fn(e.data, e.source === window.parent && (!hostOrigin || e.origin === hostOrigin));
      window.addEventListener('message', on);
      return () => window.removeEventListener('message', on);
    },
  };
}

const defaultSchedule = (fn: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
};

let current: Connection | null = null;
const waiting = new Set<(c: Connection) => void>();

/** The page's connection once `connect()` has made it (controls attach to it by default). */
export const currentConnection = (): Connection | null => current;

/** Called with the page's connection once there is one (at once if there already is). */
export function whenConnected(fn: (c: Connection) => void): () => void {
  if (current) { fn(current); return () => {}; }
  waiting.add(fn);
  return () => { waiting.delete(fn); };
}

/**
 * Connect to the host. Without a `transport`, the first call makes the page's connection (the one
 * controls use) and later calls return it.
 */
export function connect(opts: ConnectOptions = {}): Connection {
  const own = !opts.transport;
  if (own && current) return current;
  const frag = typeof location !== 'undefined' ? readFragment(location.hash) : { nonce: '', hostOrigin: '' };
  const nonce = opts.nonce ?? frag.nonce;
  const transport = opts.transport ?? windowTransport(opts.hostOrigin ?? frag.hostOrigin);
  const schedule = opts.schedule ?? defaultSchedule;
  const gate = sendGate(undefined, opts.now);

  const known = new Map<number, EstUiParam>();
  const listeners = new Set<ParamListener>();
  const meterListeners = new Set<(m: EstUiMeter) => void>();
  const themeListeners = new Set<(t: EstUiTheme) => void>();
  let rejected = 0;
  let initialised = false;
  let version: EstUiVersion = EST_UI_PROTOCOL;
  let rate: number | null = null;
  let theme: EstUiTheme | null = null;
  let meters = false;
  let audioOk = false;
  const spectrumListeners = new Set<(s: EstUiSpectrum) => void>();
  let audioAsk: { fftSize: number; rate: number } | null = null;
  /** Version 3: (re)send the current ask (after an `est:init`, which may come again on `est:ready`). */
  const sendAudio = () => {
    if (closed || !nonce || version !== 3 || !audioOk) return;
    drainPending();
    queue.push(audioMessage(nonce, audioAsk?.fftSize ?? 1024, audioAsk && spectrumListeners.size ? audioAsk.rate : 0));
    send();
  };
  const themeTarget = opts.themeTarget !== undefined ? opts.themeTarget : own && typeof document !== 'undefined' ? document.documentElement : null;
  const applyTheme = (t: EstUiTheme) => {
    theme = t;
    if (themeTarget) {
      themeTarget.style.setProperty('--est-bg', t.bg);
      themeTarget.style.setProperty('--est-fg', t.fg);
      themeTarget.style.setProperty('--est-accent', t.accent);
    }
    for (const fn of [...themeListeners]) {
      try { fn({ ...t }); } catch (err) { console.error('[est-ui] a theme listener threw', err); }
    }
  };
  let closed = false;
  let resolveReady!: (p: EstUiParam[]) => void;
  const ready = new Promise<EstUiParam[]>(r => { resolveReady = r; });

  /** Parameter values waiting for the next flush, newest per id, in first-changed order. */
  let pending = new Map<number, number>();
  /** Messages in the order they must go. */
  const queue: FrameMessage[] = [];
  let scheduled = false;

  const emit = (id: number | null, source: ChangeSource) => {
    for (const fn of [...listeners]) {
      try { fn(id, source); } catch (err) { console.error('[est-ui] a listener threw', err); }
    }
  };

  const drainPending = () => {
    for (const [id, value] of pending) queue.push(paramMessage(nonce, id, value, version));
    pending = new Map();
  };
  const send = () => {
    while (queue.length && gate.ok()) {
      gate.take();
      transport.post(queue.shift()!);
    }
    if (queue.length) later();
  };
  const flush = () => {
    scheduled = false;
    if (closed || !nonce) return;
    drainPending();
    send();
  };
  function later() {
    if (scheduled) return;
    scheduled = true;
    schedule(flush);
  }

  const stop = transport.listen((data, ok) => {
    if (closed) return;
    if (!ok) { rejected++; return; }
    const m = checkHostMessage(data, nonce, known);
    if (!m) { rejected++; return; }
    if (m.type === 'est:meter') {
      const v: EstUiMeter = { in: m.in ? [m.in[0], m.in[1]] : null, out: [m.out[0], m.out[1]] };
      for (const fn of [...meterListeners]) {
        try { fn(v); } catch (err) { console.error('[est-ui] a meter listener threw', err); }
      }
      return;
    }
    if (m.type === 'est:theme') { applyTheme(m.theme); return; }
    if (m.type === 'est:spectrum') {
      const v: EstUiSpectrum = { bins: m.bins, rms: [m.rms[0], m.rms[1]] };
      for (const fn of [...spectrumListeners]) {
        try { fn(v); } catch (err) { console.error('[est-ui] a spectrum listener threw', err); }
      }
      return;
    }
    if (m.type === 'est:init') {
      version = m.v;
      if (m.v >= 2) {
        rate = m.rate;
        meters = m.meters;
        if (m.theme) applyTheme(m.theme);
      }
      audioOk = m.v === 3 && m.audio;
      known.clear();
      for (const p of m.params) known.set(p.id, { ...p });
      initialised = true;
      opts.onInit?.(m.params.map(p => ({ ...p })));
      emit(null, 'host');
      resolveReady(m.params.map(p => ({ ...p })));
      if (audioAsk && spectrumListeners.size) sendAudio();
      return;
    }
    const p = known.get(m.id)!;
    if (p.value === m.value) return;
    p.value = m.value;
    emit(m.id, 'host');
  });

  const conn: Connection = {
    nonce,
    ready,
    get rejected() { return rejected; },
    get initialised() { return initialised; },
    get version() { return version; },
    get rate() { return rate; },
    get theme() { return theme ? { ...theme } : null; },
    get meters() { return meters; },
    get audioAvailable() { return audioOk; },
    audio(o, fn) {
      const want = typeof o.fftSize === 'number' && Number.isFinite(o.fftSize) ? o.fftSize : 1024;
      const fftSize = AUDIO_FFT_SIZES.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best), 1024 as number);
      const r = typeof o.rate === 'number' && Number.isFinite(o.rate) ? Math.round(o.rate) : AUDIO_PER_SECOND;
      audioAsk = { fftSize, rate: Math.max(1, Math.min(AUDIO_PER_SECOND, r)) };
      spectrumListeners.add(fn);
      sendAudio();
      return () => {
        spectrumListeners.delete(fn);
        if (!spectrumListeners.size) sendAudio();
      };
    },
    onMeter(fn) {
      meterListeners.add(fn);
      return () => { meterListeners.delete(fn); };
    },
    onTheme(fn) {
      themeListeners.add(fn);
      return () => { themeListeners.delete(fn); };
    },
    resize(w, h) {
      if (closed || !nonce || version < 2) return false;
      const s = clampSize(w, h);
      drainPending();
      queue.push(resizeMessage(nonce, s.w, s.h, version as 2 | 3));
      send();
      return true;
    },
    param: id => known.get(id),
    params: () => [...known.values()],
    get: id => known.get(id)?.value,
    set(id, value) {
      const p = known.get(id);
      if (!p || closed) return;
      const v = clampValue(p, value);
      if (v === p.value && !pending.has(id)) return;
      p.value = v;
      pending.set(id, v);
      emit(id, 'ui');
      later();
    },
    begin(id) {
      if (!known.has(id) || closed || !nonce) return;
      drainPending();
      queue.push(gestureMessage(nonce, id, 'begin', version));
      send();
    },
    end(id) {
      if (!known.has(id) || closed || !nonce) return;
      drainPending();
      queue.push(gestureMessage(nonce, id, 'end', version));
      send();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    flush,
    close() {
      if (closed) return;
      flush();
      closed = true;
      stop();
      listeners.clear();
      meterListeners.clear();
      themeListeners.clear();
      spectrumListeners.clear();
      if (current === conn) current = null;
    },
  };

  if (own) {
    current = conn;
    for (const fn of [...waiting]) fn(conn);
    waiting.clear();
  }
  if (nonce) transport.post(readyMessage(nonce));
  return conn;
}
