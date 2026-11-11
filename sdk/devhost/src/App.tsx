/**
 * The EST dev host page: one plugin, played through Cyber's own runtime (engine.ts), its generated
 * UI (`@cyber-est/ui` knobs) and its custom UI (Cyber's own `EstPluginFrame`, from the plugin's origin)
 * side by side, with a transport, a keyboard or an input, the parameter list, meters, a state
 * round trip, the validation report and an event log.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EstPluginFrame, analyserTap, type EstAudioTap } from '@/components/est/EstPluginFrame';
import type { EstInstalled } from '@/audio/est/library';
import { decodeBase64 } from '@/audio/est/base64';
import { DevEngine, installCheck, type DevLog, type InstallCheck } from './engine';
import { ParamModel, type Origin } from './model';
import { emitter, getBundle, getPreset, getSession, onEvents, rebuild, type Build, type Session } from './session';
import { Generated } from './Generated';
import { Keyboard } from './Keyboard';
import { Meters } from './Meters';
import { ParamList } from './ParamList';
import { Validation } from './Validation';
import { EventLog, type LogLine } from './EventLog';
import { watchFrame } from './frameWatch';

const query = new URLSearchParams(location.search);
const JSON_MODE = query.get('json') === '1';
const AUTOSTART = query.get('autostart') === '1';
const MAX_LOG = 300;

declare global {
  interface Window {
    /** For tests and agents: read-only views of the page's state. */
    estDev?: { meters: () => ReturnType<DevEngine['meters']> | null; log: () => LogLine[]; model: ParamModel; check: () => InstallCheck | null; running: () => boolean };
  }
}

type Phase = 'loading' | 'checking' | 'checked' | 'starting' | 'running' | 'failed';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [check, setCheck] = useState<InstallCheck | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [tempo, setTempo] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [roundTrip, setRoundTrip] = useState<string>('');
  const model = useMemo(() => new ParamModel(), []);
  const engine = useRef<DevEngine | null>(null);
  const modules = useRef<{ module: WebAssembly.Module; shim: WebAssembly.Module; hash: string } | null>(null);
  const logRef = useRef<LogLine[]>([]);
  const checkRef = useRef<InstallCheck | null>(null);
  const emit = useMemo(() => emitter(JSON_MODE), []);
  const seq = useRef(0);

  const write = useCallback((e: DevLog) => {
    const line: LogLine = { n: ++seq.current, t: Math.round(performance.now()), ...e };
    logRef.current = [...logRef.current.slice(-(MAX_LOG - 1)), line];
    setLog(logRef.current);
    emit(line);
  }, [emit]);

  useEffect(() => {
    window.estDev = {
      meters: () => engine.current?.meters() ?? null,
      log: () => logRef.current,
      model,
      check: () => checkRef.current,
      running: () => !!engine.current?.est,
    };
  }, [model]);

  // Parameter changes: to the instance, and into the log (the frame's writes are logged by onWrite).
  useEffect(() => {
    model.sink = (id, value) => engine.current?.setParam(id, value);
    model.onChange = (id: number, value: number, origin: Origin) => {
      if (origin === 'generated' || origin === 'list' || origin === 'command' || origin === 'preset') write({ type: 'param', id, value, origin });
    };
  }, [model, write]);

  /** Fetch the bundle and run Cyber's install check on it (the Worker: reader, meter, conformance). */
  const checkBundle = useCallback(async (s: Session) => {
    if (!s.plugin || s.plugin.kind === 'preview') return null;
    setPhase('checking');
    const { bytes, hash } = await getBundle();
    const r = await installCheck(bytes, hash || s.plugin.hash);
    checkRef.current = r.check;
    setCheck(r.check);
    write({ type: 'install', ok: r.check.ok, code: r.check.code ?? null, rule: r.check.rule ?? null, message: r.check.message ?? null, points: r.check.points ?? null, blockUs: r.check.report?.blockUs ?? null, deterministic: r.check.report?.deterministic ?? null });
    if (r.module && r.shim) modules.current = { module: r.module, shim: r.shim, hash };
    else modules.current = null;
    setPhase(r.check.ok ? 'checked' : 'failed');
    return r;
  }, [write]);

  /** Start (or restart, keeping the state) the instance. */
  const startAudio = useCallback(async (given?: Session | null) => {
    const s = given ?? sessionRef.current;
    if (!s?.plugin || !modules.current || s.plugin.kind === 'preview') return;
    setPhase('starting');
    try {
      let state: Uint8Array | undefined;
      if (engine.current?.est) state = (await engine.current.getState().catch(() => null)) ?? undefined;
      engine.current ??= new DevEngine({
        kind: s.plugin.kind, pluginId: s.plugin.id, memoryPagesMax: s.plugin.manifest.limits.memoryPagesMax,
        logParams: s.plugin.manifest.parameters.filter(p => p.scale === 'log').map(p => p.id), log: write,
      });
      await engine.current.resume();
      const est = await engine.current.start(modules.current.module, modules.current.shim, state);
      model.reset(est.params);
      // A change the plugin makes itself (its own UI logic, a preset it loads) shows everywhere.
      est.on('param', changes => { for (const c of changes) model.apply(c.id, c.value, 'plugin', false); });
      if (s.plugin.kind === 'effect' && !state) engine.current.signal('sine');
      setPhase('running');
    } catch (err) {
      write({ type: 'error', phase: (err as { phase?: string }).phase ?? 'start', message: err instanceof Error ? err.message : String(err) });
      setPhase('failed');
    }
  }, [model, write]);

  const load = useCallback(async (restart: boolean) => {
    try {
      const s = await getSession();
      sessionRef.current = s;
      setSession(s);
      setBuild(s.build);
      setError('');
      if (s.uiPreview) { model.reset(s.uiPreview); setPhase('running'); write({ type: 'preview', params: s.uiPreview.length }); return; }
      const r = await checkBundle(s);
      if (r?.check.ok && (restart || AUTOSTART)) await startAudio(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  }, [checkBundle, model, startAudio, write]);

  useEffect(() => { void load(false); }, [load]);

  // The server's stream: a build's progress, a new bundle (re-check and restart), commands.
  const commandRef = useRef<(c: Record<string, unknown>) => void>(() => {});
  useEffect(() => onEvents({
    build: b => setBuild(b),
    bundle: d => { write({ type: 'rebuilt', hash: d.hash }); void load(!!engine.current?.est); },
    command: c => commandRef.current(c),
  }), [load, write]);

  // Meters for --json, four times a second.
  useEffect(() => {
    if (!JSON_MODE) return;
    const t = setInterval(() => {
      const m = engine.current?.est ? engine.current.meters() : null;
      if (!m) return;
      const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
      emit({ type: 'meter', t: Math.round(performance.now()), peak: m.peak.map(r1), rms: m.rms.map(r1) });
    }, 250);
    return () => clearInterval(t);
  }, [emit]);

  const doRoundTrip = useCallback(async () => {
    if (!engine.current?.est) return;
    try {
      // The parameter changes before it are applied first (they reach the plugin in its next block).
      await engine.current.settle();
      const r = await engine.current.roundTrip();
      model.reset(engine.current.params().map(p => ({ ...p, value: model.get(p.id) ?? p.value })));
      setRoundTrip(`${r.bytes} bytes; parameters ${r.paramsEqual ? 'identical' : `differ (${r.differing.join(', ')})`}; state ${r.bytesEqual ? 'identical' : 'differs'} after loading it back`);
    } catch (err) {
      setRoundTrip(`failed: ${err instanceof Error ? err.message : String(err)}`);
      write({ type: 'error', phase: 'state', message: err instanceof Error ? err.message : String(err) });
    }
  }, [model, write]);

  const loadPreset = useCallback(async (id: string) => {
    if (!engine.current?.est || !id) return;
    const p = await getPreset(id);
    await engine.current.setState(new Uint8Array(decodeBase64(p.state)));
    const values = await engine.current.est.getParams();
    for (const v of values) model.apply(v.id, v.value, 'preset', false);
    write({ type: 'preset', id, name: p.name });
  }, [model, write]);

  const togglePlay = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    if (e.playing) e.stop(); else e.play();
    setPlaying(e.playing);
  }, []);

  /** One command (`est dev --json`'s stdin, through the server): resolves when it has finished. */
  const runCommand = async (c: Record<string, unknown>) => {
    const e = engine.current;
    const n = (k: string, d = 0) => (typeof c[k] === 'number' ? (c[k] as number) : d);
    const shown = { ...c };
    delete shown.seq;
    write({ type: 'command', command: shown });
    switch (c.cmd) {
      case 'start': await startAudio(); break;
      case 'note': {
        // Not held for `ms`: notes sent together sound together (a chord); `wait` spaces them.
        const key = n('key', 60);
        e?.noteOn(key, n('velocity', 100), 'keys');
        setTimeout(() => engine.current?.noteOff(key, 'keys'), n('ms', 500));
        break;
      }
      case 'noteOn': e?.noteOn(n('key', 60), n('velocity', 100), 'keys'); break;
      case 'noteOff': e?.noteOff(n('key', 60), 'keys'); break;
      case 'param': model.apply(n('id'), n('value'), 'command'); break;
      case 'play': if (e && !e.playing) togglePlay(); break;
      case 'stop': if (e?.playing) togglePlay(); break;
      case 'tempo': e?.setTempo(n('bpm', 120)); setTempo(e?.tempo ?? 120); break;
      case 'signal': e?.signal((['off', 'sine', 'noise', 'pulse'].includes(String(c.kind)) ? c.kind : 'sine') as 'sine'); break;
      case 'state': await doRoundTrip(); break;
      case 'preset': await loadPreset(String(c.id ?? '')); break;
      case 'params': write({ type: 'params', params: model.list() }); break;
      case 'wait': await new Promise(r => setTimeout(r, Math.min(600_000, Math.max(0, n('ms'))))); break;
      default: write({ type: 'error', phase: 'command', message: `unknown command ${String(c.cmd)}` });
    }
  };
  /** Commands run one after another, in the order they came; each answers `done` (headless.mjs waits for it). */
  const commandChain = useRef<Promise<void>>(Promise.resolve());
  commandRef.current = (c) => {
    commandChain.current = commandChain.current.then(async () => {
      try { await runCommand(c); } catch (err) { write({ type: 'error', phase: 'command', message: err instanceof Error ? err.message : String(err) }); }
      write({ type: 'done', cmd: c.cmd, ...(typeof c.seq === 'number' ? { seq: c.seq } : {}) });
    });
  };

  const values = useSyncExternalStore(useCallback(fn => model.watch(fn), [model]), () => model.values());
  const plugin = session?.plugin ?? null;
  const manifest = plugin?.manifest ?? null;
  const running = phase === 'running';
  const preview = !!session?.uiPreview;
  const units = useMemo(() => Object.fromEntries((manifest?.parameters ?? []).map(p => [p.id, p.unit])), [manifest]);
  const params = useMemo(() => model.list(), [model, values]); // eslint-disable-line react-hooks/exhaustive-deps
  const installed = useMemo<EstInstalled | null>(() => (plugin && manifest?.ui ? {
    ref: { id: plugin.id, version: plugin.version, hash: plugin.hash },
    manifest: {
      id: plugin.id, version: plugin.version, name: plugin.name, vendor: manifest.vendor ?? '', description: manifest.description ?? '',
      kind: plugin.kind === 'instrument' ? 'instrument' : 'effect', features: [],
      ui: { path: manifest.ui.path, w: manifest.ui.size.w, h: manifest.ui.size.h, resizable: !!manifest.ui.resizable },
      audio: { inputs: 0, outputs: 2 }, limits: manifest.limits,
      // EST 1.1 (protocol v3): the custom UI may ask for the plugin's output, analysed here as in Cyber.
      ...((manifest.ui as { audio?: boolean }).audio === true ? { uiAudio: true as const } : {}),
    },
    source: 'developer', installedAt: '', metered: true,
  } : null), [plugin, manifest]);
  // The custom UI's frame, watched from outside: its load, est:ready and est:init, and every refusal.
  const frameHost = useRef<HTMLDivElement>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const frameShown = !!(installed && running && session);
  const frameKey = installed?.ref.hash ?? '';
  const resizable = !!installed?.manifest.ui?.resizable;
  const uiAudio = installed?.manifest.uiAudio === true;
  // EST 1.1 (protocol v3): the host's own analysers on the plugin's output (Cyber's `analyserTap`).
  const frameAudio = useCallback<EstAudioTap>(fftSize => (engine.current?.est ? analyserTap(engine.current.est.node, fftSize) : null), []);
  // EST Phase 5a (5-B): the protocol version the custom UI speaks (from its est:ready).
  const [uiProtocol, setUiProtocol] = useState<number | null>(null);
  useEffect(() => {
    if (!frameShown || !frameHost.current) return undefined;
    setUiProtocol(null);
    return watchFrame(frameHost.current, () => paramsRef.current, e => {
      write(e);
      if (e.event === 'ready' && typeof e.protocol === 'number') setUiProtocol(e.protocol);
    }, resizable, uiAudio);
  }, [frameShown, frameKey, write, resizable, uiAudio]);
  // 5-B: the meters the custom UI is sent (est:meter, protocol 2): the output's peaks, linear.
  const frameMeters = useCallback((out: Float32Array): boolean => {
    const m = engine.current?.est ? engine.current.meters() : null;
    if (!m) return false;
    out[0] = Number.isFinite(m.peak[0]) ? 10 ** (m.peak[0] / 20) : 0;
    out[1] = Number.isFinite(m.peak[1]) ? 10 ** (m.peak[1] / 20) : 0;
    return true;
  }, []);
  const frameEdit = useMemo(() => model.frameEdit(patch => write({ type: 'param', origin: 'frame', patch })), [model, write, values]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <a className="skip" href="#main">Skip to the page</a>
      <header className="bar">
        <h1>EST dev host</h1>
        <p className="who" data-testid="plugin-name">
          {plugin ? <>{plugin.name} <span className="dim">{plugin.id} {plugin.version} · {plugin.kind} · {plugin.hash.slice(0, 12)}</span></> : 'No plugin'}
        </p>
        <p className={`chip ${build?.ok ? 'ok' : build?.message === 'building' ? '' : 'alert'}`} data-testid="build-status" role="status">
          {build ? (build.message === 'building' ? 'Building…' : build.ok ? `Build ${build.n}: ready (${build.via})` : `Build ${build.n} failed`) : 'Connecting…'}
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        {error && <p className="alert-text" role="alert">{error}</p>}
        {build && !build.ok && build.message !== 'building' && (
          <section aria-labelledby="h-build" className="card wide">
            <h2 id="h-build">Build</h2>
            <p className="alert-text">{build.message}</p>
            {build.log && <pre className="pre">{build.log}</pre>}
          </section>
        )}
        <section aria-labelledby="h-plugin" className="card">
          <h2 id="h-plugin">Plugin</h2>
          {preview ? (
            <p data-testid="phase" data-phase="running">UI preview: the custom UI against {session?.uiPreview?.length} parameters from a file; no DSP runs.</p>
          ) : (
            <>
              <p data-testid="phase" data-phase={phase}>
                {phase === 'loading' && 'Loading…'}
                {phase === 'checking' && 'Checking the bundle as Cyber installs it (reader, meter, conformance)…'}
                {phase === 'checked' && 'The install check passed. Start the audio to play it.'}
                {phase === 'starting' && 'Starting…'}
                {phase === 'running' && `Running in Cyber's runtime (${engine.current?.est?.ready.metered ? 'metered' : 'not metered'}, latency ${engine.current?.est?.ready.latency ?? 0} frames).`}
                {phase === 'failed' && 'Stopped: see the install check and the event log.'}
              </p>
              <div className="row">
                <button type="button" data-testid="start" disabled={!modules.current || phase === 'starting'} onClick={() => void startAudio()}>{engine.current?.est ? 'Restart' : 'Start audio'}</button>
                {session?.target.kind === 'folder' && <button type="button" onClick={() => void rebuild()}>Rebuild</button>}
              </div>
            </>
          )}
        </section>

        {!preview && (
          <section aria-labelledby="h-transport" className="card">
            <h2 id="h-transport">Transport</h2>
            <div className="row">
              <button type="button" data-testid="play" aria-pressed={playing} disabled={!running} onClick={togglePlay}>{playing ? 'Stop' : 'Play'}</button>
              <label className="field">Tempo
                <input type="number" min={40} max={240} step={1} value={tempo} disabled={!running}
                  onChange={e => { const v = Number(e.target.value); setTempo(v); if (Number.isFinite(v)) engine.current?.setTempo(v); }} /> BPM
              </label>
            </div>
          </section>
        )}

        {!preview && (plugin?.kind === 'instrument' || (plugin?.manifest.notes?.inputs ?? 0) > 0) && <Keyboard engine={engine} disabled={!running} log={write} />}
        {!preview && plugin?.kind === 'effect' && <InputPlayer engine={engine} disabled={!running} />}

        <section aria-labelledby="h-ui" className="card wide">
          <h2 id="h-ui">Generated UI and custom UI</h2>
          <div className="uis">
            <div>
              <h3>Generated</h3>
              {running ? <Generated model={model} params={params} units={units} /> : <p className="dim">Start the audio to see the parameters.</p>}
            </div>
            <div>
              <h3>Custom</h3>
              {installed && running && session ? (
                <div ref={frameHost} className="frame-host">
                  <EstPluginFrame installed={installed} params={params} edit={frameEdit} origin={session.filesOrigin}
                    rate={engine.current?.ctx.sampleRate ?? null} meters={frameMeters} audio={frameAudio} title={`${installed.manifest.name}: the plugin's own interface`} />
                  <FrameMeters read={frameMeters} protocol={uiProtocol} rate={engine.current?.ctx.sampleRate ?? null} />
                </div>
              ) : (
                <p className="dim">{manifest?.ui ? 'Start the audio to open it.' : 'This plugin has no custom UI (no "ui" in est.json).'}</p>
              )}
            </div>
          </div>
        </section>

        <ParamList model={model} params={params} units={units} disabled={!running} />

        {!preview && <Meters engine={engine} running={running} />}

        {!preview && (
          <section aria-labelledby="h-state" className="card">
            <h2 id="h-state">State</h2>
            <div className="row">
              <button type="button" data-testid="round-trip" disabled={!running} onClick={() => void doRoundTrip()}>Save and load the state</button>
              {!!plugin?.presets.length && (
                <label className="field">Preset
                  <select defaultValue="" disabled={!running} onChange={e => void loadPreset(e.target.value)}>
                    <option value="">Choose…</option>
                    {plugin.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <p data-testid="round-trip-result" role="status">{roundTrip}</p>
          </section>
        )}

        <Validation check={check} validation={session?.validation ?? null} note={session?.validationNote ?? ''} preview={preview} />
        <EventLog lines={log} />
      </main>
    </>
  );
}

/** An effect's input: a test signal or a file, looped. */
/**
 * 5-B: what the custom UI is told besides its parameters: the protocol it speaks, the sample rate,
 * and the output meters it receives (protocol 2's est:meter), written twice a second through refs.
 */
function FrameMeters({ read, protocol, rate }: { read: (out: Float32Array) => boolean; protocol: number | null; rate: number | null }) {
  const out = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const buf = new Float32Array(2);
    const db = (x: number) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '−∞');
    const t = setInterval(() => {
      if (!out.current) return;
      out.current.textContent = protocol === 2 && read(buf) ? `L ${db(buf[0]!)}, R ${db(buf[1]!)}` : 'none';
    }, 500);
    return () => clearInterval(t);
  }, [read, protocol]);
  return (
    <p className="dim" data-testid="ui-protocol" data-protocol={protocol ?? ''}>
      {protocol === null ? 'The UI has not said est:ready yet.' : `Protocol ${protocol}`}
      {protocol === 2 && <> · rate {rate ?? '?'} Hz · meters sent: <span ref={out} data-testid="ui-meters">none</span></>}
      {protocol === 1 && ' (an older @cyber-est/ui: no rate, theme or meters)'}
    </p>
  );
}

function InputPlayer({ engine, disabled }: { engine: React.RefObject<DevEngine | null>; disabled: boolean }) {
  const [signal, setSignal] = useState('sine');
  return (
    <section aria-labelledby="h-input" className="card">
      <h2 id="h-input">Input</h2>
      <div className="row">
        <label className="field">Signal
          <select value={signal} disabled={disabled} data-testid="signal"
            onChange={e => { setSignal(e.target.value); engine.current?.signal(e.target.value as 'sine'); }}>
            <option value="sine">Sine, 220 Hz</option>
            <option value="noise">Noise</option>
            <option value="pulse">Tone bursts</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="field">Audio file
          <input type="file" accept="audio/*" disabled={disabled}
            onChange={e => { const f = e.target.files?.[0]; if (f) { setSignal('off'); void engine.current?.playFile(f, f.name); } }} />
        </label>
      </div>
    </section>
  );
}
