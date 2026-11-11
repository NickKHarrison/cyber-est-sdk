import { DIVISIONS, divisionBeats, type Division } from '../synth/synthTypes';

/**
 * WAVE, the wavetable engine's patch (Cyber_Wavetable_Mixer_Work_Order.md §2, §5): two
 * wavetable oscillators with unison and warp, a sub, noise, one multimode filter, three
 * envelopes (the first is the amp), four LFOs, four macros and a modulation matrix. Every
 * numeric range lives once, in WAVE_PARAMS: the knobs, the sanitiser, the matrix and the
 * worklet (through `compileWavePatch`) all read it.
 */

export const WAVE_TABLES = [
  { id: 'basic', name: 'Basic Shapes' },
  { id: 'harmonic', name: 'Harmonic Sweep' },
  { id: 'pwm', name: 'PWM' },
  { id: 'sync', name: 'Hard Sync' },
  { id: 'formant', name: 'Formants' },
  { id: 'fm', name: 'FM' },
  { id: 'pd', name: 'Phase Distortion' },
  { id: 'organ', name: 'Organ' },
  { id: 'digital', name: 'Digital' },
  { id: 'squash', name: 'Squash' },
  { id: 'noise', name: 'Spectral Noise' },
  { id: 'sub', name: 'Sub Bass' },
] as const;
export type WaveTableId = (typeof WAVE_TABLES)[number]['id'];
export const TABLE_IDS = WAVE_TABLES.map(t => t.id) as WaveTableId[];
/** An oscillator's table: a built-in one, or its own (1.8: `custom`, a harmonic spectrum in the patch). */
export type OscTable = WaveTableId | 'custom';
export const OSC_TABLES: readonly OscTable[] = [...TABLE_IDS, 'custom'];
/** A custom table: 32 frames × 64 harmonics, amplitude and phase as Int16, base64 (customTables.ts). */
export const CUSTOM_HARMONICS = 64;
/** The base64 length of a custom table's data: 32 × 64 × 2 values × 2 bytes. */
export const CUSTOM_DATA_LENGTH = Math.ceil((32 * 64 * 2 * 2) / 3) * 4;
export const CUSTOM_NAME_MAX = 40;
export interface CustomTable { name: string; data: string }
/** Frames in each table, and samples in each frame. */
export const TABLE_FRAMES = 32;
export const FRAME_SIZE = 2048;

export const WARP_MODES = ['none', 'sync', 'bend', 'squeeze', 'mirror', 'quantize', 'fm'] as const;
export type WarpMode = (typeof WARP_MODES)[number];
export const WARP_LABELS: Record<WarpMode, string> = {
  none: 'None', sync: 'Sync', bend: 'Bend', squeeze: 'Squeeze', mirror: 'Mirror', quantize: 'Quantize', fm: 'FM',
};

export const FILTER_TYPES = ['lp12', 'lp24', 'hp12', 'hp24', 'bp12', 'notch'] as const;
export type WaveFilterType = (typeof FILTER_TYPES)[number];
export const FILTER_LABELS: Record<WaveFilterType, string> = {
  lp12: 'LP 12', lp24: 'LP 24', hp12: 'HP 12', hp24: 'HP 24', bp12: 'BP 12', notch: 'Notch',
};

/** Which filter a source runs through (1.8, replacing 1.6's on/off). */
export const FILTER_ROUTES = ['none', 'f1', 'f2', 'both'] as const;
export type FilterRoute = (typeof FILTER_ROUTES)[number];
export const FILTER_ROUTE_LABELS: Record<FilterRoute, string> = { none: 'Off', f1: '1', f2: '2', both: '1+2' };
/** Filter 2 after filter 1 (serial), or beside it (parallel). */
export const FILTER_ROUTINGS = ['serial', 'parallel'] as const;
export type FilterRouting = (typeof FILTER_ROUTINGS)[number];

export const SUB_SHAPES = ['sine', 'triangle', 'saw', 'square'] as const;
export type SubShape = (typeof SUB_SHAPES)[number];

export const LFO_SHAPES = ['sine', 'triangle', 'saw', 'ramp', 'square', 'sh', 'steps'] as const;
export type WaveLfoShape = (typeof LFO_SHAPES)[number];
export const LFO_SHAPE_LABELS: Record<WaveLfoShape, string> = {
  sine: 'Sine', triangle: 'Tri', saw: 'Saw', ramp: 'Ramp', square: 'Square', sh: 'S&H', steps: 'Steps',
};
export const LFO_MODES = ['free', 'retrig', 'env'] as const;
export type LfoMode = (typeof LFO_MODES)[number];
export const LFO_MODE_LABELS: Record<LfoMode, string> = { free: 'Free', retrig: 'Retrig', env: 'Env' };
export const LFO_STEPS = 16;

export const MOD_SOURCES = [
  'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'macro1', 'macro2', 'macro3', 'macro4', 'velocity', 'note', 'wheel', 'random',
  // 1.8: per note from an MPE controller: pressure 0…1 (also from aftertouch); slide −1…1, 0 at CC 74's centre.
  'pressure', 'slide',
] as const;
export type ModSource = (typeof MOD_SOURCES)[number];
export const MOD_SOURCE_LABELS: Record<ModSource, string> = {
  env2: 'Env 2', env3: 'Env 3', lfo1: 'LFO 1', lfo2: 'LFO 2', lfo3: 'LFO 3', lfo4: 'LFO 4',
  macro1: 'Macro 1', macro2: 'Macro 2', macro3: 'Macro 3', macro4: 'Macro 4',
  velocity: 'Velocity', note: 'Note', wheel: 'Mod wheel', random: 'Random',
  pressure: 'Pressure', slide: 'Slide',
};
/** Sources that swing both ways (−1…1); the rest are 0…1. */
export const BIPOLAR_SOURCES: ReadonlySet<ModSource> = new Set(['lfo1', 'lfo2', 'lfo3', 'lfo4', 'note', 'random', 'slide']);
export const MAX_MOD_SLOTS = 16;

export interface WaveOsc {
  on: boolean;
  table: OscTable;
  /** The oscillator's own table (kept when a built-in one is picked, so it can be picked again). */
  custom: CustomTable | null;
  /** Where in the table, 0…1. */
  position: number;
  level: number;
  /** −1…1. */
  pan: number;
  octave: number;
  semi: number;
  /** Cents. */
  fine: number;
  /** Voices, 1–8. */
  unison: number;
  /** Spread of the unison voices, 0…1 (1 = ±50 cents). */
  detune: number;
  /** The level of the side voices against the centre, 0…1. */
  blend: number;
  /** Stereo width of the unison, 0…1. */
  width: number;
  warp: WarpMode;
  warpAmount: number;
  /** Each note starts each unison voice at a random phase (off: all at 0). */
  randomPhase: boolean;
  /** Spectral warps (1.8): table-level, re-rendered off the audio thread, not modulated. 0…1 (oddEven −1…1). */
  stretch: number;
  lowpass: number;
  oddEven: number;
  comb: number;
  route: FilterRoute;
}

export interface WaveFilter { on: boolean; type: WaveFilterType; cutoff: number; resonance: number; drive: number; keyTrack: number }

export interface WaveEnv { attack: number; decay: number; sustain: number; release: number }

export interface WaveLfo {
  shape: WaveLfoShape;
  rate: number;
  sync: boolean;
  division: Division;
  mode: LfoMode;
  /** The Steps shape's 16 values, 0…1. */
  steps: number[];
}

export interface ModSlot { source: ModSource; dest: string; amount: number }

export interface WavePatch {
  version: 1;
  osc: [WaveOsc, WaveOsc];
  sub: { on: boolean; shape: SubShape; octave: number; level: number; route: FilterRoute };
  noise: { on: boolean; level: number; tone: number; route: FilterRoute };
  filter: WaveFilter;
  /** 1.8: the second filter, and how the two are joined. */
  filter2: WaveFilter;
  filterRouting: FilterRouting;
  env: [WaveEnv, WaveEnv, WaveEnv];
  lfo: [WaveLfo, WaveLfo, WaveLfo, WaveLfo];
  macros: [number, number, number, number];
  mod: ModSlot[];
  voice: { mode: 'mono' | 'poly'; voices: number; glide: number; bendRange: number };
  velToAmp: number;
  volume: number;
}

// --- The parameter table --------------------------------------------------------------------

export interface WaveParam {
  label: string;
  min: number;
  max: number;
  default: number;
  /** A log knob (frequencies, times). */
  log?: boolean;
  bipolar?: boolean;
  unit?: 'Hz' | 's' | 'st' | 'ct' | '%' | 'oct';
  int?: boolean;
  /** Can be a modulation destination. */
  mod?: boolean;
}

const oscParams = (i: number, on: boolean): Record<string, WaveParam> => ({
  [`osc.${i}.position`]: { label: 'Position', min: 0, max: 1, default: i === 0 ? 0.35 : 0, mod: true, unit: '%' },
  [`osc.${i}.level`]: { label: 'Level', min: 0, max: 1, default: on ? 0.75 : 0.6, mod: true, unit: '%' },
  [`osc.${i}.pan`]: { label: 'Pan', min: -1, max: 1, default: 0, bipolar: true, mod: true },
  [`osc.${i}.octave`]: { label: 'Octave', min: -3, max: 3, default: 0, int: true, bipolar: true, unit: 'oct' },
  [`osc.${i}.semi`]: { label: 'Semi', min: -24, max: 24, default: 0, int: true, bipolar: true, unit: 'st', mod: true },
  [`osc.${i}.fine`]: { label: 'Fine', min: -100, max: 100, default: i === 1 ? 7 : 0, bipolar: true, unit: 'ct', mod: true },
  [`osc.${i}.unison`]: { label: 'Unison', min: 1, max: 8, default: 1, int: true },
  [`osc.${i}.detune`]: { label: 'Detune', min: 0, max: 1, default: 0.25, mod: true, unit: '%' },
  [`osc.${i}.blend`]: { label: 'Blend', min: 0, max: 1, default: 0.75, unit: '%' },
  [`osc.${i}.width`]: { label: 'Width', min: 0, max: 1, default: 0.8, unit: '%' },
  [`osc.${i}.warpAmount`]: { label: 'Warp', min: 0, max: 1, default: 0, mod: true, unit: '%' },
  [`osc.${i}.stretch`]: { label: 'Stretch', min: 0, max: 1, default: 0, unit: '%' },
  [`osc.${i}.lowpass`]: { label: 'Smooth', min: 0, max: 1, default: 0, unit: '%' },
  [`osc.${i}.oddEven`]: { label: 'Odd/even', min: -1, max: 1, default: 0, bipolar: true },
  [`osc.${i}.comb`]: { label: 'Comb', min: 0, max: 1, default: 0, unit: '%' },
});
const filterParams = (head: string, cutoff: number): Record<string, WaveParam> => ({
  [`${head}.cutoff`]: { label: 'Cutoff', min: 20, max: 20000, default: cutoff, log: true, unit: 'Hz', mod: true },
  [`${head}.resonance`]: { label: 'Reso', min: 0, max: 1, default: 0.15, mod: true, unit: '%' },
  [`${head}.drive`]: { label: 'Drive', min: 0, max: 1, default: 0, mod: true, unit: '%' },
  [`${head}.keyTrack`]: { label: 'Key', min: 0, max: 1, default: 0, unit: '%' },
});
const envParams = (i: number, d: [number, number, number, number]): Record<string, WaveParam> => ({
  [`env.${i}.attack`]: { label: 'Attack', min: 0.001, max: 10, default: d[0], log: true, unit: 's' },
  [`env.${i}.decay`]: { label: 'Decay', min: 0.001, max: 10, default: d[1], log: true, unit: 's' },
  [`env.${i}.sustain`]: { label: 'Sustain', min: 0, max: 1, default: d[2], unit: '%' },
  [`env.${i}.release`]: { label: 'Release', min: 0.001, max: 10, default: d[3], log: true, unit: 's' },
});
const lfoParams = (i: number): Record<string, WaveParam> => ({
  [`lfo.${i}.rate`]: { label: 'Rate', min: 0.02, max: 30, default: [2, 0.5, 4, 0.25][i]!, log: true, unit: 'Hz', mod: true },
});

export const WAVE_PARAMS: Readonly<Record<string, WaveParam>> = Object.freeze({
  ...oscParams(0, true),
  ...oscParams(1, false),
  'sub.octave': { label: 'Octave', min: -2, max: 0, default: -1, int: true, unit: 'oct' },
  'sub.level': { label: 'Sub', min: 0, max: 1, default: 0.5, mod: true, unit: '%' },
  'noise.level': { label: 'Noise', min: 0, max: 1, default: 0.3, mod: true, unit: '%' },
  'noise.tone': { label: 'Tone', min: 0, max: 1, default: 0.7, unit: '%' },
  ...filterParams('filter', 8000),
  ...filterParams('filter2', 2000),
  ...envParams(0, [0.003, 0.3, 0.8, 0.25]),
  ...envParams(1, [0.003, 0.4, 0.2, 0.3]),
  ...envParams(2, [0.2, 0.8, 0.5, 0.5]),
  ...lfoParams(0), ...lfoParams(1), ...lfoParams(2), ...lfoParams(3),
  'macros.0': { label: 'Macro 1', min: 0, max: 1, default: 0, unit: '%' },
  'macros.1': { label: 'Macro 2', min: 0, max: 1, default: 0, unit: '%' },
  'macros.2': { label: 'Macro 3', min: 0, max: 1, default: 0, unit: '%' },
  'macros.3': { label: 'Macro 4', min: 0, max: 1, default: 0, unit: '%' },
  'voice.voices': { label: 'Voices', min: 1, max: 8, default: 8, int: true },
  'voice.glide': { label: 'Glide', min: 0, max: 2, default: 0, unit: 's' },
  'voice.bendRange': { label: 'Bend', min: 0, max: 24, default: 2, int: true, unit: 'st' },
  velToAmp: { label: 'Vel → Amp', min: 0, max: 1, default: 0.5, unit: '%' },
  volume: { label: 'Volume', min: 0, max: 1, default: 0.7, mod: true, unit: '%' },
});

export function waveParam(path: string): WaveParam {
  const p = WAVE_PARAMS[path];
  if (!p) throw new Error(`Unknown WAVE parameter: ${path}`);
  return p;
}

/** The modulation destinations, in a fixed order (the worklet indexes them). */
export const MOD_DESTS: readonly string[] = Object.freeze(Object.keys(WAVE_PARAMS).filter(k => WAVE_PARAMS[k]!.mod));

/** A parameter's value as 0…1 along its knob (log for log knobs). */
export function toNorm(p: WaveParam, v: number): number {
  if (p.log) return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}
export function fromNorm(p: WaveParam, n: number): number {
  const c = n < 0 ? 0 : n > 1 ? 1 : n;
  if (p.log) return p.min * Math.exp(c * Math.log(p.max / p.min));
  return p.min + c * (p.max - p.min);
}

// --- Defaults ---------------------------------------------------------------------------------

function defaultOsc(i: number): WaveOsc {
  const v = (k: string) => WAVE_PARAMS[`osc.${i}.${k}`]!.default;
  return {
    on: i === 0, table: i === 0 ? 'basic' : 'harmonic', position: v('position'), level: v('level'), pan: v('pan'),
    octave: v('octave'), semi: v('semi'), fine: v('fine'), unison: v('unison'), detune: v('detune'), blend: v('blend'),
    width: v('width'), warp: 'none', warpAmount: v('warpAmount'), randomPhase: true,
    stretch: 0, lowpass: 0, oddEven: 0, comb: 0, route: 'f1', custom: null,
  };
}
const env = (i: number): WaveEnv => ({
  attack: WAVE_PARAMS[`env.${i}.attack`]!.default, decay: WAVE_PARAMS[`env.${i}.decay`]!.default,
  sustain: WAVE_PARAMS[`env.${i}.sustain`]!.default, release: WAVE_PARAMS[`env.${i}.release`]!.default,
});
const defaultSteps = () => [1, 0.25, 0.75, 0.25, 0.5, 0, 1, 0.5, 1, 0.25, 0.75, 0.25, 0.5, 0, 0.75, 0.25];
const lfo = (i: number): WaveLfo => ({
  shape: (['sine', 'triangle', 'steps', 'sh'] as const)[i]!, rate: WAVE_PARAMS[`lfo.${i}.rate`]!.default, sync: false,
  division: '1/8', mode: 'free', steps: defaultSteps(),
});

export function defaultWavePatch(): WavePatch {
  return {
    version: 1,
    osc: [defaultOsc(0), defaultOsc(1)],
    sub: { on: false, shape: 'sine', octave: -1, level: 0.5, route: 'none' },
    noise: { on: false, level: 0.3, tone: 0.7, route: 'f1' },
    filter: { on: true, type: 'lp24', cutoff: 8000, resonance: 0.15, drive: 0, keyTrack: 0 },
    filter2: { on: false, type: 'hp12', cutoff: 2000, resonance: 0.15, drive: 0, keyTrack: 0 },
    filterRouting: 'serial',
    env: [env(0), env(1), env(2)],
    lfo: [lfo(0), lfo(1), lfo(2), lfo(3)],
    macros: [0, 0, 0, 0],
    mod: [],
    voice: { mode: 'poly', voices: 8, glide: 0, bendRange: 2 },
    velToAmp: 0.5,
    volume: 0.7,
  };
}

// --- Paths and sanitising -----------------------------------------------------------------------

export function getWavePath(p: WavePatch, path: string): unknown {
  let o: unknown = p;
  for (const k of path.split('.')) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  return o;
}

/** A copy of the patch with one value at `path` changed (arrays stay arrays). */
export function setWavePath(p: WavePatch, path: string, value: unknown): WavePatch {
  const keys = path.split('.');
  const put = (o: unknown, i: number): unknown => {
    const k = keys[i]!;
    const cur = (o ?? {}) as Record<string, unknown>;
    const next: unknown = i === keys.length - 1 ? value : put(cur[k], i + 1);
    if (Array.isArray(cur)) { const a = [...cur]; a[Number(k)] = next; return a; }
    return { ...cur, [k]: next };
  };
  return put(p, 0) as WavePatch;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
/** A source's filter route; a 1.6/1.7 patch's `toFilter` migrates (on → filter 1, off → none). */
function route(o: Record<string, unknown>, d: FilterRoute): FilterRoute {
  if (typeof o.route === 'string') return pick(o.route, FILTER_ROUTES, d);
  if (typeof o.toFilter === 'boolean') return o.toFilter ? 'f1' : 'none';
  return d;
}
/**
 * A table's data is exactly 8,192 bytes as base64: 10,923 characters and one '=' (8,192 is 2
 * more than a multiple of 3), the last character's two spare bits zero, so it decodes to exactly
 * 32 × 64 × 2 × 2 bytes and nothing else.
 */
const TABLE_DATA = new RegExp(`^[A-Za-z0-9+/]{${CUSTOM_DATA_LENGTH - 2}}[AEIMQUYcgkosw048]=$`);
/** A custom table, or null when it is not one (wrong length or padding, not base64): never trusted further. */
export function sanitiseCustomTable(v: unknown): CustomTable | null {
  if (!isObj(v) || typeof v.data !== 'string' || v.data.length !== CUSTOM_DATA_LENGTH || !TABLE_DATA.test(v.data)) return null;
  const name = typeof v.name === 'string'
    ? Array.from(v.name.slice(0, CUSTOM_NAME_MAX * 4)).filter(c => c.charCodeAt(0) >= 32).join('').trim().slice(0, CUSTOM_NAME_MAX)
    : '';
  return { name: name || 'Custom', data: v.data };
}

/** One numeric parameter from a raw value, clamped (and rounded when it is a whole number). */
export function clampWave(path: string, raw: unknown): number {
  const p = waveParam(path);
  const v = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(p.max, Math.max(p.min, raw)) : p.default;
  return p.int ? Math.round(v) : v;
}

/** A patch from anything (projects, presets, live sessions): every field present and in range. */
export function sanitiseWavePatch(raw: unknown): WavePatch {
  const d = defaultWavePatch();
  const r = isObj(raw) ? raw : {};
  const num = (path: string) => clampWave(path, getWavePath(r as unknown as WavePatch, path));
  const ro = Array.isArray(r.osc) ? r.osc : [];
  const osc = [0, 1].map((i): WaveOsc => {
    const o = isObj(ro[i]) ? ro[i] as Record<string, unknown> : {};
    const n = (k: string) => clampWave(`osc.${i}.${k}`, o[k]);
    const custom = sanitiseCustomTable(o.custom);
    const table = pick(o.table, OSC_TABLES, d.osc[i as 0 | 1].table);
    return {
      on: bool(o.on, d.osc[i as 0 | 1].on), table: table === 'custom' && !custom ? 'basic' : table, custom,
      position: n('position'), level: n('level'), pan: n('pan'), octave: n('octave'), semi: n('semi'), fine: n('fine'),
      unison: n('unison'), detune: n('detune'), blend: n('blend'), width: n('width'),
      warp: pick(o.warp, WARP_MODES, 'none'), warpAmount: n('warpAmount'), randomPhase: bool(o.randomPhase, true),
      stretch: n('stretch'), lowpass: n('lowpass'), oddEven: n('oddEven'), comb: n('comb'), route: route(o, 'f1'),
    };
  }) as [WaveOsc, WaveOsc];
  const sub = isObj(r.sub) ? r.sub : {};
  const noise = isObj(r.noise) ? r.noise : {};
  const filterOf = (head: 'filter' | 'filter2'): WaveFilter => {
    const f = isObj(r[head]) ? r[head] as Record<string, unknown> : {};
    const df = d[head];
    return {
      on: bool(f.on, df.on), type: pick(f.type, FILTER_TYPES, df.type),
      cutoff: num(`${head}.cutoff`), resonance: num(`${head}.resonance`), drive: num(`${head}.drive`), keyTrack: num(`${head}.keyTrack`),
    };
  };
  const re = Array.isArray(r.env) ? r.env : [];
  const envs = [0, 1, 2].map((i): WaveEnv => {
    const e = isObj(re[i]) ? re[i] as Record<string, unknown> : {};
    return {
      attack: clampWave(`env.${i}.attack`, e.attack), decay: clampWave(`env.${i}.decay`, e.decay),
      sustain: clampWave(`env.${i}.sustain`, e.sustain), release: clampWave(`env.${i}.release`, e.release),
    };
  }) as [WaveEnv, WaveEnv, WaveEnv];
  const rl = Array.isArray(r.lfo) ? r.lfo : [];
  const lfos = [0, 1, 2, 3].map((i): WaveLfo => {
    const l = isObj(rl[i]) ? rl[i] as Record<string, unknown> : {};
    const steps = Array.from({ length: LFO_STEPS }, (_, k) => {
      const s = Array.isArray(l.steps) ? l.steps[k] : undefined;
      return typeof s === 'number' && Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : d.lfo[i as 0]!.steps[k]!;
    });
    return {
      shape: pick(l.shape, LFO_SHAPES, d.lfo[i as 0]!.shape), rate: clampWave(`lfo.${i}.rate`, l.rate), sync: bool(l.sync, false),
      division: pick(l.division, DIVISIONS, '1/8'), mode: pick(l.mode, LFO_MODES, 'free'), steps,
    };
  }) as WavePatch['lfo'];
  const rm = Array.isArray(r.macros) ? r.macros : [];
  const macros = [0, 1, 2, 3].map(i => clampWave(`macros.${i}`, rm[i])) as WavePatch['macros'];
  const mod: ModSlot[] = [];
  for (const s of Array.isArray(r.mod) ? r.mod : []) {
    if (mod.length >= MAX_MOD_SLOTS || !isObj(s)) continue;
    const source = pick(s.source, MOD_SOURCES, null as unknown as ModSource);
    const dest = typeof s.dest === 'string' && MOD_DESTS.includes(s.dest) ? s.dest : null;
    const amount = typeof s.amount === 'number' && Number.isFinite(s.amount) ? Math.min(1, Math.max(-1, s.amount)) : 0;
    if (!source || !dest) continue;
    // One slot per source and destination: a duplicate replaces nothing, it is dropped.
    if (mod.some(m => m.source === source && m.dest === dest)) continue;
    mod.push({ source, dest, amount });
  }
  const voice = isObj(r.voice) ? r.voice : {};
  return {
    version: 1,
    osc,
    sub: { on: bool(sub.on, false), shape: pick(sub.shape, SUB_SHAPES, 'sine'), octave: num('sub.octave'), level: num('sub.level'), route: route(sub, 'none') },
    noise: { on: bool(noise.on, false), level: num('noise.level'), tone: num('noise.tone'), route: route(noise, 'f1') },
    filter: filterOf('filter'),
    filter2: filterOf('filter2'),
    filterRouting: pick(r.filterRouting, FILTER_ROUTINGS, 'serial'),
    env: envs,
    lfo: lfos,
    macros,
    mod,
    voice: { mode: voice.mode === 'mono' ? 'mono' : 'poly', voices: num('voice.voices'), glide: num('voice.glide'), bendRange: num('voice.bendRange') },
    velToAmp: num('velToAmp'),
    volume: num('volume'),
  };
}

// --- What the worklet reads -----------------------------------------------------------------------

/**
 * A table's identity in the worklet's cache: two independent 32-bit hashes of the whole data
 * (FNV-1a, and a multiply-rotate hash with other constants) and its length, so two different
 * tables sharing a key would need both to collide at once.
 */
function tableHash(s: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b = (b << 13) | (b >>> 19);
  }
  b = Math.imul(b ^ (b >>> 15), 0x27d4eb2d);
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
  return `${hex(a)}${hex(b)}.${s.length}`;
}

/** A warp amount as the key and the builder both see it: to 1/10,000. */
const roundWarp = (w: number) => Math.round(w * 1e4) / 1e4;

/**
 * What an oscillator's table is made from: a built-in id or a spectrum, and the four spectral
 * warps (stretch, low-pass, odd/even, comb). `key` names the result: a plain built-in table is
 * its id (as in 1.6); anything else carries a hash of what it is made from.
 */
export function oscTableSource(o: Pick<WaveOsc, 'table' | 'custom' | 'stretch' | 'lowpass' | 'oddEven' | 'comb'>) {
  const spectrum = o.table === 'custom' && o.custom ? o.custom.data : null;
  const table = spectrum ? 'custom' : o.table === 'custom' ? 'basic' : o.table;
  // The builder gets the rounded amounts, so an equal key is always an equal table.
  const warps = [o.stretch, o.lowpass, o.oddEven, o.comb].map(roundWarp);
  const plain = !spectrum && warps.every(w => w === 0);
  const key = plain ? table : `${table}:${spectrum ? tableHash(spectrum) : ''}:${warps.join(',')}`;
  return { table, spectrum, warps, key, plain };
}

/**
 * The patch as the `cyber-wave` processor reads it: enums as indices, and every modulatable value
 * as a 0…1 base with its range (`dests`, in MOD_DESTS order), so the matrix adds in knob space.
 */
export function compileWavePatch(p: WavePatch) {
  const ix = <T extends string>(list: readonly T[], v: T) => Math.max(0, list.indexOf(v));
  return {
    osc: p.osc.map(o => {
      const src = oscTableSource(o);
      return {
        on: o.on, table: src.table, spectrum: src.spectrum, warps: src.warps, key: src.key,
        octave: o.octave, unison: o.unison, blend: o.blend, width: o.width,
        warp: ix(WARP_MODES, o.warp), randomPhase: o.randomPhase, route: ix(FILTER_ROUTES, o.route),
      };
    }),
    sub: { on: p.sub.on, shape: ix(SUB_SHAPES, p.sub.shape), octave: p.sub.octave, route: ix(FILTER_ROUTES, p.sub.route) },
    noise: { on: p.noise.on, tone: p.noise.tone, route: ix(FILTER_ROUTES, p.noise.route) },
    filter: { on: p.filter.on, type: ix(FILTER_TYPES, p.filter.type), keyTrack: p.filter.keyTrack },
    filter2: { on: p.filter2.on, type: ix(FILTER_TYPES, p.filter2.type), keyTrack: p.filter2.keyTrack },
    parallel: p.filterRouting === 'parallel',
    env: p.env.map(e => ({ a: e.attack, d: e.decay, s: e.sustain, r: e.release })),
    lfo: p.lfo.map(l => ({
      shape: ix(LFO_SHAPES, l.shape), sync: l.sync, beats: divisionBeats(l.division), mode: ix(LFO_MODES, l.mode), steps: l.steps.slice(),
    })),
    macros: p.macros.slice(),
    dests: MOD_DESTS.map(path => {
      const prm = WAVE_PARAMS[path]!;
      return { base: toNorm(prm, getWavePath(p, path) as number), min: prm.min, max: prm.max, log: !!prm.log };
    }),
    mods: p.mod.map(m => ({ src: MOD_SOURCES.indexOf(m.source), dst: MOD_DESTS.indexOf(m.dest), amount: m.amount })).filter(m => m.src >= 0 && m.dst >= 0),
    voice: { mono: p.voice.mode === 'mono', voices: p.voice.voices, glide: p.voice.glide, bendRange: p.voice.bendRange },
    velToAmp: p.velToAmp,
  };
}
export type CompiledWavePatch = ReturnType<typeof compileWavePatch>;
