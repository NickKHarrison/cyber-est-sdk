/**
 * 1.604: `est quality`, the factory presets' measurement harness. Every preset of an instrument's
 * bundle is played (its state's values sent as parameter events, the bundle read and run exactly as
 * `render` does: Cyber's own `est-plugin` processor on the conformance host, block by block, so the
 * numbers are the same on every run and every machine) with a standard phrase for its kind, and
 * measured (`qualityMeasures.ts`):
 *
 * - **loudness** (integrated LUFS, BS.1770-4) and **true peak** (dBTP) over the phrase and a second
 *   of its release, with the preset-gain change that meets the target (`TARGETS`: −16 LUFS for leads,
 *   keys and pads, −14 for basses and drums, the true peak under −1 dBTP);
 * - **DC offset** (either channel's mean over the phrase run, dBFS);
 * - **clicks** (`clickAt`'s ratio) at every note-on and note-off of the phrase, at each voice stolen
 *   when more notes are held than the instrument has voices, and at a preset change under a held chord;
 * - **denormals**: every subnormal f32/f64 the module stores in the 10 s after the last note-off, and in
 *   the last 10 s of the 40 s after it, where a state gliding slowly to 0 shows (1.437's counter,
 *   `src/audio/est/review/denormals.ts`);
 * - **aliasing**: a held C7 at 48 and at 96 kHz; the power between its harmonics below 18 kHz at each
 *   rate (noise, detuning and reverb are there at both rates, aliases only at the lower), and the power
 *   above 18 kHz against the fundamental;
 * - **fuel** at full polyphony: the heaviest block of the stealing run, a share of `BLOCK_FUEL`;
 * - **stuck notes**: the level 40 s after the last note-off (and, when not yet silent there, at the
 *   manifest's `tailSeconds`), and 10 s after it reported;
 * - **stereo correlation** over the phrase (−1 is one channel inverted).
 *
 * A preset's kind comes from its tags (`kindOf`) unless a profile names it; a profile (`QualityProfile`,
 * optional, JSON) also gives a kit's keys, the voice count and what an instrument does by design.
 */
import { readBundle, type EstBundle } from '../../../../src/audio/est/install/bundle';
import { standInInstance } from '../../../../src/audio/est/install/conformance';
import { isMetered } from '../../../../src/audio/est/install/fuel';
import { countDenormals, DENORMAL_COUNTER } from '../../../../src/audio/est/review/denormals';
import { hostShim, loadMeter } from './host';
import { bandDb, clickAt, correlation, dcDb, inharmonicDb, integratedLufs, rmsDb, spectrum, truePeakDb } from './qualityMeasures';

const F = 128;
export const QUALITY_RATE = 48000;
/** Seconds rendered after the last note-off: a state that glides slowly into subnormals shows only late. */
export const AFTER_S = 40;
/** The first window after the last note-off (denormals and the stuck-note check); the last 10 s of `AFTER_S` is the second. */
export const WINDOW_S = 10;

export type QualityKind = 'chord' | 'melody' | 'bass' | 'drums';
/** The loudness each kind is matched to (LUFS), and the true-peak ceiling (dBTP). */
export const TARGETS: Record<QualityKind, number> = { chord: -16, melody: -16, bass: -14, drums: -14 };
export const TRUE_PEAK_CEILING = -1;

/** The flags' bounds. */
export const BOUNDS = {
  /** A loudness within this of its target needs no change (LU). */
  loudnessLu: 1,
  /** A channel mean past this (dBFS) is a DC offset. */
  dcDb: -50,
  /** A click reading past this ratio (18 dB over the sound's own high band), with a burst past `clickJump` (-40 dBFS), is a click. */
  clickRatio: 8,
  clickJump: 0.01,
  /** A stolen voice's reading past this many times the run's ordinary note-ons' largest is a steal click. */
  stealFactor: 2.5,
  /** Any subnormal store in the window is a finding. */
  denormals: 0,
  /** Aliasing: the inharmonic power at 48 kHz this far over 96 kHz's (dB), and over `aliasFloorDb`. */
  aliasDeltaDb: 10,
  aliasFloorDb: -40,
  /** A heaviest block past this share of `BLOCK_FUEL` (every shipped bundle stays under 75 %). */
  fuel: 0.75,
  /** Still above this (dBFS RMS) 10 s after the last note-off, and at the declared tail: a stuck note. */
  stuckDb: -80,
  /** A correlation under this is a channel inverted somewhere. */
  correlation: -0.2,
} as const;

export interface KitKeys { kick: number; snare: number; hat: number; open: number }

export interface QualityProfile {
  /** The drum kind's keys (default General MIDI's 36, 38, 42, 46). */
  kitKeys?: KitKeys;
  /** A preset's kind by name, over its tags. */
  kinds?: Record<string, QualityKind>;
  /** A kind for a tag of this instrument's own (`{ "ostinato": "chord" }`), read before the shared words. */
  tags?: Record<string, QualityKind>;
  /** Voices before one is stolen (default 8). */
  polyphony?: number;
  /** The preset-gain parameter (default: the one named "Level" with unit dB). */
  levelParam?: number;
  /** Aliasing or a reduced rate is the instrument's sound (a chip's DAC): reported, not flagged. */
  aliasByDesign?: boolean;
  /** Free words for the report. */
  note?: string;
}

/** An instrument's note: start (s), key, length (s), velocity. */
export type QNote = [number, number, number, number];

const has = (tags: string[], words: string[]) => tags.some(t => words.includes(t.toLowerCase()));

/** A preset's kind from its tags (a profile's `kinds` first). */
export function kindOf(name: string, tags: string[], profile: QualityProfile = {}): QualityKind {
  const own = profile.kinds?.[name];
  if (own) return own;
  for (const t of tags) { const k = profile.tags?.[t.toLowerCase()]; if (k) return k; }
  if (has(tags, ['drums', 'kit', 'percussion', 'groove', 'hats', 'roll', 'kick', 'snare', 'clap', 'hits', 'toms', 'dembow'])) return 'drums';
  if (has(tags, ['bass', 'sub', '808', 'fretless', 'slap'])) return 'bass';
  if (has(tags, ['pad', 'choir', 'drone', 'ambient', 'strings', 'organ', 'texture', 'chords', 'keys', 'piano', 'electric piano', 'tine', 'reed', 'orchestra', 'monks', 'hum', 'harpsichord', 'swell'])) return 'chord';
  return 'melody';
}

/** The phrase for a kind: notes, and the time the last one ends. */
export function phraseFor(kind: QualityKind, kit: KitKeys = { kick: 36, snare: 38, hat: 42, open: 46 }): { notes: QNote[]; end: number } {
  const notes: QNote[] = [];
  if (kind === 'chord') {
    [[48, 55, 64, 67], [45, 52, 60, 64], [41, 53, 57, 60, 65]].forEach((chord, i) => {
      const t = [0.05, 1.65, 3.25][i]!, len = [1.5, 1.5, 0.75][i]!;
      for (const k of chord) notes.push([t, k, len, 0.8]);
    });
  } else if (kind === 'melody') {
    const keys = [72, 74, 76, 79, 77, 76, 74, 72, 67, 72];
    const vel = [0.9, 0.7, 0.8, 1, 0.75, 0.8, 0.7, 0.9, 0.7, 0.85];
    keys.forEach((k, i) => notes.push([0.05 + i * 0.25, k, i === keys.length - 1 ? 0.8 : 0.22, vel[i]!]));
  } else if (kind === 'bass') {
    const keys = [36, 36, 43, 41, 38, 36, 31, 34, 36];
    keys.forEach((k, i) => notes.push([0.05 + i * 0.25, k, i === keys.length - 1 ? 0.6 : 0.2, i % 2 ? 0.75 : 0.95]));
  } else {
    // Two bars of sixteenths at 120 BPM: kick, snare on 2 and 4, hats on the eighths, an open hat at the end.
    const step = 0.125;
    for (let bar = 0; bar < 2; bar++) {
      for (let s = 0; s < 16; s++) {
        const t = 0.05 + (bar * 16 + s) * step;
        if ([0, 6, 8, 11].includes(s)) notes.push([t, kit.kick, 0.1, s === 0 ? 1 : 0.85]);
        if (s === 4 || s === 12) notes.push([t, kit.snare, 0.1, 0.95]);
        if (s % 2 === 0 && !(bar === 1 && s === 14)) notes.push([t, kit.hat, 0.06, s % 4 === 0 ? 0.8 : 0.6]);
        if (bar === 1 && s === 14) notes.push([t, kit.open, 0.2, 0.8]);
      }
    }
  }
  const end = Math.max(...notes.map(n => n[0] + n[2]));
  return { notes, end };
}

type Ev = { type: string; time: number; [k: string]: unknown };

const noteEvents = (notes: QNote[], firstId = 1): Ev[] => notes.flatMap(([t, key, len, velocity], i) => [
  { type: 'noteOn', time: t, key, velocity, noteId: firstId + i, channel: 0, port: 0 },
  { type: 'noteOff', time: t + len, key, velocity: 0, noteId: firstId + i, channel: 0, port: 0 },
]);

const paramEvents = (values: [number, number][], time = 0): Ev[] => values.map(([id, value]) => ({ type: 'param', time, id, value }));

/** A preset state in the SDK's format (assembly glue's `state_save`): magic, version, count, then (u32 id, f64 value) each. */
export function stateValues(bytes: Uint8Array): [number, number][] | null {
  if (bytes.length < 12) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(8, true);
  if (bytes.length !== 12 + n * 12) return null;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([v.getUint32(12 + i * 12, true), v.getFloat64(16 + i * 12, true)]);
  return out;
}

interface Played { left: Float32Array; right: Float32Array; fuelPeak: number; denormals: number[]; error: string | null; blockUs: number[] }

interface Modules { counted: WebAssembly.Module; metered: WebAssembly.Module; shim: WebAssembly.Module; bundle: EstBundle }

async function modulesOf(bytes: Uint8Array): Promise<Modules> {
  const bundle = await readBundle(bytes);
  const meter = await loadMeter();
  const metered = await WebAssembly.compile(meter(bundle.module, { mode: 'local' }).bytes as Uint8Array<ArrayBuffer>);
  if (!isMetered(metered)) throw new Error('the metered module lost its fuel exports');
  const counted = new WebAssembly.Module(countDenormals(bundle.module) as BufferSource);
  return { counted, metered, shim: await hostShim(), bundle };
}

/**
 * One run: the events sent at once (times in seconds), the transport playing from the start and stopped
 * at `transportOff` (an instrument with a groove of its own plays while it runs), `seconds` rendered.
 * With `counted`, the subnormal stores in each second are read from 1.437's counter.
 */
function play(mods: Modules, which: 'counted' | 'metered', sr: number, events: Ev[], seconds: number, transportOff: number, timed = false): Played {
  const module = which === 'counted' ? mods.counted : mods.metered;
  const Real = WebAssembly.Instance;
  let instance: WebAssembly.Instance | null = null;
  const Catching = function (m: WebAssembly.Module, imports?: WebAssembly.Imports) {
    const made = new Real(m, imports);
    if (m === module) instance = made;
    return made;
  } as unknown as typeof WebAssembly.Instance;
  WebAssembly.Instance = Catching;
  let inst: ReturnType<typeof standInInstance>;
  try {
    inst = standInInstance({ module, shim: mods.shim, manifest: mods.bundle.manifest }, sr, { queueSize: 8192 });
  } finally {
    WebAssembly.Instance = Real;
  }
  const frames = Math.round(seconds * sr);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const err = inst.boot.find(m => m.type === 'error');
  if (!inst.boot.some(m => m.type === 'ready') || !instance) return { left, right, fuelPeak: 0, denormals: [], blockUs: [], error: err ? `${String(err.phase)}: ${String(err.message)}` : 'it did not start' };
  const counter = which === 'counted' ? (instance as WebAssembly.Instance).exports[DENORMAL_COUNTER] as WebAssembly.Global : null;
  const proc = inst.proc as unknown as { blockFuel?: number; fuelLeft?: (() => number) | null; dead?: boolean };
  // The transport goes inside the `events` message (the n572 integration, 1.605's open item): the `est-plugin`
  // processor reads no top-level `transport` message, so before this every run was measured with the transport stopped.
  const sorted = [...events].sort((a, b) => a.time - b.time);
  inst.send({ type: 'events', events: [{ type: 'transport', time: 0, playing: true, tempo: 120, beat: 0, num: 4, den: 4 }, ...sorted] });
  const zero = new Float32Array(F);
  const perSecond = Math.round(sr / F);
  const denormals: number[] = [];
  let last = 0, fuelPeak = 0, stopped = false, error: string | null = null;
  const blockUs: number[] = [];
  for (let b = 0, at = 0; at < frames; b++, at += F) {
    if (!stopped && at >= transportOff * sr) {
      inst.send({ type: 'events', events: [{ type: 'transport', playing: false, tempo: 120, beat: (at / sr) * 2, num: 4, den: 4 }] });
      stopped = true;
    }
    const t0 = timed ? performance.now() : 0;
    const { out, posted } = inst.block(zero, zero, at);
    if (timed) blockUs.push((performance.now() - t0) * 1000);
    const e = posted.find(m => m.type === 'error');
    if (e || proc.dead) { error = `frame ${at}: ${e ? `${String(e.phase)}: ${String(e.message)}` : 'stopped'}`; break; }
    if (proc.fuelLeft && proc.blockFuel) fuelPeak = Math.max(fuelPeak, (proc.blockFuel - proc.fuelLeft()) / proc.blockFuel);
    const n = Math.min(F, frames - at);
    left.set(out[0].subarray(0, n), at);
    right.set(out[1].subarray(0, n), at);
    if (counter && (b + 1) % perSecond === 0) { const now = counter.value as number; denormals.push(now - last); last = now; }
  }
  inst.send({ type: 'dispose' });
  return { left, right, fuelPeak, denormals, error, blockUs };
}

export interface PresetQuality {
  name: string;
  kind: QualityKind;
  target: number;
  lufs: number;
  truePeak: number;
  /** The larger channel mean, dBFS. */
  dc: number;
  correlation: number;
  clicks: { noteOn: number; noteOff: number; steal: number; stealOrdinary: number; change: number };
  /** Subnormal stores in the 10 s after the last note-off, and in the last 10 s of the 40 s after it. */
  denormals: number;
  denormalsLate: number;
  alias: { hfDb: number; inh48: number; inh96: number; delta: number } | null;
  fuel: number;
  /** RMS (dBFS) over the half second before 10 s and before 40 s after the last note-off; and at the declared tail when that was looked at. */
  stuck: { after10: number; after40: number; atTail: number | null };
  /** The preset-gain change (dB) that meets the target without passing the ceiling, 0 when within `loudnessLu`. */
  gain: number;
  /** The preset's Level (dB) as played, when the instrument has one. */
  level: number | null;
  flags: string[];
  error: string | null;
  /**
   * 1.665: the time this machine took a block in the stealing run (the same run as `fuel`), µs: mean,
   * 95th percentile and largest, against `budgetUs` (a 128-frame block at 48 kHz, 2667 µs). Wall time in
   * Node on the stand-in host, so it moves with the machine; reported, never a flag here.
   */
  cpu?: { meanUs: number; p95Us: number; maxUs: number; budgetUs: number };
  /**
   * 1.665: the tail after the last note-off. `decayS`: the first time from which every 50 ms stays under
   * `TAIL_FLOOR_DB` (null: never within `AFTER_S`); `energyDb`: the energy after the last note-off against
   * the phrase's; `atDeclared`: the level (dBFS RMS, the half second before) at the manifest's
   * `tailSeconds` (from the long run past `AFTER_S`, null when not looked at). Reported, never a flag here.
   */
  tail?: { decayS: number | null; energyDb: number; atDeclared: number | null };
}

/** 1.665: the level a tail is over once it falls under it (dBFS RMS): 60 dB down, the RT60's convention. */
export const TAIL_FLOOR_DB = -60;

export interface QualityReport {
  id: string;
  version: string;
  name: string;
  levelParam: number | null;
  /** 1.665: the manifest's `limits.tailSeconds` (0 when it names none). */
  tailSeconds?: number;
  presets: PresetQuality[];
}

/** The level parameter: a profile's, else the one called "Level" in dB. */
export function levelParamOf(bundle: EstBundle, profile: QualityProfile = {}): number | null {
  if (profile.levelParam !== undefined) return profile.levelParam;
  const p = bundle.manifest.parameters.find(q => /^level$/i.test(q.name) && /db/i.test(q.unit ?? ''));
  return p ? p.id : null;
}

const chordFor = (kind: QualityKind): number[] => (kind === 'bass' ? [36, 43] : [48, 55, 60, 64]);

/** Measure every preset of an instrument bundle (or those whose names `only` holds). */
export async function qualityOf(bytes: Uint8Array, profile: QualityProfile = {}, opts: { only?: string[]; progress?: (s: string) => void; levels?: Record<string, number>; values?: Record<string, Record<number, number>> } = {}): Promise<QualityReport> {
  const mods = await modulesOf(bytes);
  const { bundle } = mods;
  if (bundle.manifest.kind !== 'instrument') throw new Error(`${bundle.manifest.id} is an effect: est quality measures instruments' presets`);
  const levelId = levelParamOf(bundle, profile);
  // A trial Level (dB) by preset name over its state's, to try a level change before writing it (`--levels`).
  // Trial values (by preset name, then parameter id) over its state's, to try a preset change before
  // writing it (1.664); a trial Level wins over a trial value of the level parameter.
  const withLevel = (name: string, v: [number, number][] | null) => {
    const lv = opts.levels?.[name];
    const tv = opts.values?.[name];
    const tried = v && tv ? v.map(([id, x]) => [id, tv[id] ?? x] as [number, number]) : v;
    return tried && lv !== undefined && levelId !== null ? tried.map(([id, x]) => [id, id === levelId ? lv : x] as [number, number]) : tried;
  };
  const all = bundle.presets.map(p => ({ name: p.name, tags: p.tags, values: withLevel(p.name, stateValues(p.bytes)) }));
  const presets = all.filter(p => !opts.only || opts.only.includes(p.name));
  const sr = QUALITY_RATE;
  const poly = profile.polyphony ?? 8;
  const tail = bundle.manifest.limits.tailSeconds ?? 0;
  const out: PresetQuality[] = [];
  presets.forEach(p => {
    const i = all.indexOf(p);
    opts.progress?.(`${bundle.manifest.name}: ${p.name}`);
    const values = p.values ?? [];
    const kind = kindOf(p.name, p.tags, profile);
    const flags: string[] = [];
    if (!p.values) flags.push('state not in the SDK format: played at its defaults');
    const { notes, end } = phraseFor(kind, profile.kitKeys);

    // The phrase: loudness, peak, DC, correlation, note clicks, denormals after, stuck notes.
    const run = play(mods, 'counted', sr, [...paramEvents(values), ...noteEvents(notes)], end + AFTER_S, end);
    const sig = Math.round((end + 1) * sr);
    const L = run.left.subarray(0, sig), R = run.right.subarray(0, sig);
    const lufs = integratedLufs(L, R, sr);
    const truePeak = truePeakDb(run.left, run.right);
    const dc = Math.max(dcDb(run.left, 0, sig), dcDb(run.right, 0, sig));
    const corr = correlation(L, R);
    let noteOn = 0, noteOff = 0;
    // A reading counts only with a burst loud enough to hear (`clickJump`).
    const heard = (c: { jump: number; ratio: number }) => (c.jump > BOUNDS.clickJump ? c.ratio : 0);
    for (const [t, , len] of notes) {
      noteOn = Math.max(noteOn, heard(clickAt(run.left, run.right, Math.round(t * sr), sr)));
      noteOff = Math.max(noteOff, heard(clickAt(run.left, run.right, Math.round((t + len) * sr), sr)));
    }
    const startAfter = Math.round(end * sr);
    const first = Math.ceil(end);
    const denormals = run.denormals.slice(first, first + WINDOW_S).reduce((a, b) => a + b, 0);
    const denormalsLate = run.denormals.slice(-WINDOW_S).reduce((a, b) => a + b, 0);
    if (process.env.EST_QUALITY_TRACE) opts.progress?.(`denormals per second: ${run.denormals.join(' ')}`);
    const at10 = Math.round((end + WINDOW_S) * sr);
    const after10 = rmsDb(run.left, run.right, at10 - sr / 2, at10);
    const afterAll = rmsDb(run.left, run.right, run.left.length - sr / 2, run.left.length);
    let atTail: number | null = null;
    if (afterAll > BOUNDS.stuckDb && tail > AFTER_S) {
      const long = play(mods, 'metered', sr, [...paramEvents(values), ...noteEvents(notes)], end + tail + 0.5, end);
      atTail = rmsDb(long.left, long.right, long.left.length - sr / 2, long.left.length);
    }
    void startAfter;
    // 1.665: the tail against the phrase's energy, its decay under TAIL_FLOOR_DB, and the level at the declared tail.
    const energy = (a: number, b: number) => { let e = 0; for (let j = a; j < b; j++) e += run.left[j]! ** 2 + run.right[j]! ** 2; return e; };
    const offAt = Math.min(run.left.length, Math.round(end * sr));
    const energyDb = 10 * Math.log10((energy(offAt, run.left.length) + 1e-30) / (energy(0, offAt) + 1e-30));
    const hop = Math.round(sr / 20);
    let lastLoud = offAt;
    for (let j = offAt; j + hop <= run.left.length; j += hop) if (rmsDb(run.left, run.right, j, j + hop) > TAIL_FLOOR_DB) lastLoud = j + hop;
    const decayS = lastLoud + hop > run.left.length ? null : Math.round(((lastLoud - offAt) / sr) * 100) / 100;
    const declaredAt = Math.round((end + tail) * sr);
    const atDeclared = tail > 0 && tail <= AFTER_S && declaredAt <= run.left.length ? rmsDb(run.left, run.right, Math.max(0, declaredAt - sr / 2), declaredAt) : atTail;

    // Stealing: more notes held than voices (a drum kit: one key struck again and again); fuel at full polyphony.
    const stealNotes: QNote[] = [];
    if (kind === 'drums') {
      const k = profile.kitKeys?.kick ?? 36;
      for (let j = 0; j < poly + 4; j++) stealNotes.push([0.05 + j * 0.09, j % 2 ? (profile.kitKeys?.snare ?? 38) : k, 0.06, 0.9]);
    } else {
      const base = kind === 'bass' ? 36 : 48;
      const steps = [0, 4, 7, 11, 14, 17, 21, 24, 26, 28, 31, 33, 35, 36, 38, 40];
      for (let j = 0; j < poly + 4; j++) stealNotes.push([0.05 + j * 0.15, base + steps[j % steps.length]! + 12 * Math.floor(j / steps.length), 2.6 - j * 0.15, 0.85]);
    }
    const stealEnd = Math.max(...stealNotes.map(n => n[0] + n[2]));
    const st = play(mods, 'metered', sr, [...paramEvents(values), ...noteEvents(stealNotes, 1000)], stealEnd + 0.5, stealEnd, true);
    let ordinary = 0, steal = 0;
    stealNotes.forEach(([t], j) => {
      const r = heard(clickAt(st.left, st.right, Math.round(t * sr), sr));
      if (j >= poly) steal = Math.max(steal, r);
      else if (j > 0) ordinary = Math.max(ordinary, r);
    });

    // A preset change under a held chord: the previous preset (the last for the first), then this one at 1 s.
    let change = 0;
    if (kind !== 'drums' && all.length > 1) {
      const prev = all[(i + all.length - 1) % all.length]!.values ?? [];
      const held: QNote[] = chordFor(kind).map(k => [0.05, k, 1.9, 0.8]);
      const ch = play(mods, 'metered', sr, [...paramEvents(prev), ...noteEvents(held, 2000), ...paramEvents(values, 1)], 2.2, 2.2);
      change = heard(clickAt(ch.left, ch.right, sr, sr, 5));
    }

    // Aliasing: a held C7 at 48 and 96 kHz.
    let alias: PresetQuality['alias'] = null;
    if (kind !== 'drums') {
      const f0 = 440 * Math.pow(2, (96 - 69) / 12);
      const at = (rate: number) => {
        const r = play(mods, 'metered', rate, [...paramEvents(values), ...noteEvents([[0.02, 96, 1.0, 0.9]], 3000)], 1.0, 1.0);
        const n = rate >= 96000 ? 32768 : 16384;
        return { p: spectrum(r.left, r.right, Math.round(0.3 * rate), n), rate };
      };
      const a48 = at(48000), a96 = at(96000);
      const inh48 = inharmonicDb(a48.p, 48000, f0), inh96 = inharmonicDb(a96.p, 96000, f0);
      alias = { hfDb: bandDb(a48.p, 48000, f0), inh48, inh96, delta: inh48 - inh96 };
    }

    // The gain that meets the target and stays under the ceiling.
    const target = TARGETS[kind];
    let gain = 0;
    if (Number.isFinite(lufs)) {
      const want = target - lufs;
      const cap = TRUE_PEAK_CEILING - truePeak;
      gain = Math.min(want, cap);
      if (Math.abs(gain) < BOUNDS.loudnessLu && truePeak <= TRUE_PEAK_CEILING) gain = 0;
      gain = Math.round(gain * 10) / 10;
    }
    if (gain !== 0) flags.push(`level ${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`);
    if (truePeak > TRUE_PEAK_CEILING) flags.push('true peak');
    if (dc > BOUNDS.dcDb) flags.push('DC');
    if (corr < BOUNDS.correlation) flags.push('phase');
    if (kind !== 'drums' && noteOn > BOUNDS.clickRatio) flags.push('click: note-on');
    if (noteOff > BOUNDS.clickRatio) flags.push('click: note-off');
    if (steal > BOUNDS.clickRatio && steal > BOUNDS.stealFactor * Math.max(1, ordinary)) flags.push('click: steal');
    if (change > BOUNDS.clickRatio) flags.push('click: preset change');
    if (denormals > BOUNDS.denormals) flags.push('denormals');
    if (denormalsLate > BOUNDS.denormals) flags.push('denormals: late');
    if (alias && alias.delta > BOUNDS.aliasDeltaDb && alias.inh48 > BOUNDS.aliasFloorDb && !profile.aliasByDesign) flags.push('aliasing');
    if (st.fuelPeak > BOUNDS.fuel) flags.push('fuel');
    if (afterAll > BOUNDS.stuckDb && (atTail === null || atTail > BOUNDS.stuckDb)) flags.push('stuck');
    out.push({
      name: p.name, kind, target, lufs, truePeak, dc, correlation: corr,
      clicks: { noteOn, noteOff, steal, stealOrdinary: ordinary, change },
      denormals, denormalsLate, alias, fuel: st.fuelPeak, stuck: { after10, after40: afterAll, atTail }, gain, flags,
      level: levelId === null ? null : (values.find(([id]) => id === levelId)?.[1] ?? null),
      error: run.error ?? st.error,
      cpu: cpuOf(st.blockUs, sr),
      tail: { decayS, energyDb, atDeclared },
    });
  });
  return { id: bundle.manifest.id, version: bundle.manifest.version, name: bundle.manifest.name, levelParam: levelId, tailSeconds: tail, presets: out };
}

/** 1.665: a run's block times (µs) as mean, 95th percentile and largest, against a 128-frame block's real time. */
export function cpuOf(us: number[], sr: number): NonNullable<PresetQuality['cpu']> {
  const budgetUs = Math.round((128 / sr) * 1e6);
  if (!us.length) return { meanUs: 0, p95Us: 0, maxUs: 0, budgetUs };
  const s = [...us].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { meanUs: r(us.reduce((a, b) => a + b, 0) / us.length), p95Us: r(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!), maxUs: r(s[s.length - 1]!), budgetUs };
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '−∞');

/** A report as a Markdown table (one row a preset). */
export function qualityTable(r: QualityReport): string {
  const head = '| Preset | Kind | LUFS | dBTP | DC | Corr | Click on/off/steal/change | Denormals 10 s/late | Alias Δ (inh48) | HF | Fuel | After 10/40 s | Gain | Flags |';
  const rows = r.presets.map(p => `| ${p.name} | ${p.kind} | ${f1(p.lufs)} | ${f1(p.truePeak)} | ${f1(p.dc)} | ${p.correlation.toFixed(2)} | ${f1(p.clicks.noteOn)}/${f1(p.clicks.noteOff)}/${f1(p.clicks.steal)}/${f1(p.clicks.change)} | ${p.denormals}/${p.denormalsLate} | ${p.alias ? `${f1(p.alias.delta)} (${f1(p.alias.inh48)})` : '–'} | ${p.alias ? f1(p.alias.hfDb) : '–'} | ${(p.fuel * 100).toFixed(1)} % | ${f1(p.stuck.after10)}/${f1(p.stuck.after40)}${p.stuck.atTail !== null ? ` (${f1(p.stuck.atTail)})` : ''} | ${p.gain ? p.gain.toFixed(1) : '0'} | ${p.flags.join(', ') || 'ok'}${p.error ? ` ERROR ${p.error}` : ''} |`);
  return [`### ${r.name} ${r.version} (\`${r.id}\`)`, '', head, `|${'---|'.repeat(14)}`, ...rows, ''].join('\n');
}
