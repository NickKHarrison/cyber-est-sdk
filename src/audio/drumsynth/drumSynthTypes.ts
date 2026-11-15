import type { SynthParam } from '../synth/synthTypes';

/**
 * DRUM SYNTH (1.577, Live 13's Drum Synth): a Drum Rack pad's synthesised voice (`source: 'drum'`
 * on a pad, beside FM, ANALOG and 8-BIT; never an eleventh `engine`). A patch is one of
 * `DRUM_SYNTH_ENGINES`, each a small purpose-built model in the `cyber-drumsynth` worklet
 * (`drumSynthWorklet.ts`) with four to six named macros (`m`, each 0…1, named by its engine), and
 * the shared Tune, Decay, Tone, Drive, Level and velocity sensitivity.
 *
 * The engine ids here and the worklet's `setupVoice` switch are one list (`drumSynthWorklet.test.ts`
 * renders every id). Pure: no DOM, Web Audio or store imports.
 */

export const DRUM_SYNTH_MACROS = 6;

export type DrumSynthEngine =
  | 'kickSine' | 'kick808' | 'kick909'
  | 'snare' | 'snareRim' | 'clap' | 'rimshot'
  | 'hatClosed' | 'hatOpen' | 'hatPedal' | 'ride' | 'crash'
  | 'cowbell' | 'clave' | 'tomLow' | 'tomMid' | 'tomHigh' | 'conga' | 'bongo'
  | 'shaker' | 'tambourine' | 'zap' | 'laser' | 'noise' | 'woodBlock' | 'metal';

export interface DrumSynthEngineDef {
  id: DrumSynthEngine;
  label: string;
  /** The picker's group. */
  group: 'Kicks' | 'Snares and claps' | 'Hats and cymbals' | 'Percussion' | 'Effects';
  /** The engine's macros: their names and defaults (0…1), four to six. */
  macros: readonly { label: string; default: number }[];
  /** How long a hit at the default Decay may ring, seconds (to −60 dB; the tests hold every engine to it). */
  maxSeconds: number;
}

const M = (...list: [string, number][]) => list.map(([label, d]) => ({ label, default: d }));

/** Every engine, in the picker's order. */
export const DRUM_SYNTH_ENGINES: readonly DrumSynthEngineDef[] = Object.freeze([
  { id: 'kickSine', label: 'Kick (sine sweep)', group: 'Kicks', macros: M(['Pitch', 0.3], ['Sweep', 0.5], ['Sweep time', 0.3], ['Click', 0.3]), maxSeconds: 1.5 },
  { id: 'kick808', label: 'Kick 808', group: 'Kicks', macros: M(['Pitch', 0.4], ['Bend', 0.3], ['Punch', 0.3], ['Boom', 0.4]), maxSeconds: 3.5 },
  { id: 'kick909', label: 'Kick 909', group: 'Kicks', macros: M(['Pitch', 0.4], ['Sweep', 0.5], ['Click', 0.5], ['Noise', 0.3], ['Body', 0.4]), maxSeconds: 1.5 },
  { id: 'snare', label: 'Snare', group: 'Snares and claps', macros: M(['Tune', 0.4], ['Modes', 0.4], ['Snappy', 0.6], ['Noise tone', 0.5], ['Body', 0.4]), maxSeconds: 1.2 },
  { id: 'snareRim', label: 'Snare (rim)', group: 'Snares and claps', macros: M(['Rim pitch', 0.5], ['Rim', 0.7], ['Snappy', 0.5], ['Noise tone', 0.6]), maxSeconds: 1.2 },
  { id: 'clap', label: 'Clap', group: 'Snares and claps', macros: M(['Bursts', 0.5], ['Spread', 0.4], ['Tail', 0.4], ['Filter', 0.4], ['Q', 0.3]), maxSeconds: 1.5 },
  { id: 'rimshot', label: 'Rimshot', group: 'Snares and claps', macros: M(['Pitch', 0.4], ['Ring', 0.3], ['Click', 0.5], ['Body', 0.3]), maxSeconds: 0.8 },
  { id: 'hatClosed', label: 'Closed hat', group: 'Hats and cymbals', macros: M(['Pitch', 0.5], ['Colour', 0.5], ['Ring', 0.3], ['Noise', 0.3]), maxSeconds: 0.8 },
  { id: 'hatOpen', label: 'Open hat', group: 'Hats and cymbals', macros: M(['Pitch', 0.5], ['Colour', 0.5], ['Ring', 0.3], ['Noise', 0.3]), maxSeconds: 3 },
  { id: 'hatPedal', label: 'Pedal hat', group: 'Hats and cymbals', macros: M(['Pitch', 0.5], ['Colour', 0.4], ['Ring', 0.3], ['Noise', 0.2], ['Chick', 0.5]), maxSeconds: 0.8 },
  { id: 'ride', label: 'Ride', group: 'Hats and cymbals', macros: M(['Pitch', 0.5], ['Bell', 0.4], ['Spread', 0.5], ['Filter', 0.5]), maxSeconds: 8 },
  { id: 'crash', label: 'Crash', group: 'Hats and cymbals', macros: M(['Pitch', 0.5], ['Spread', 0.5], ['Filter', 0.4], ['Noise', 0.5]), maxSeconds: 9 },
  { id: 'cowbell', label: 'Cowbell', group: 'Percussion', macros: M(['Pitch', 0.5], ['Detune', 0.5], ['Filter', 0.5], ['Attack', 0.5]), maxSeconds: 2 },
  { id: 'clave', label: 'Clave', group: 'Percussion', macros: M(['Pitch', 0.4], ['Ring', 0.3], ['Click', 0.3], ['Hollow', 0.2]), maxSeconds: 1 },
  { id: 'tomLow', label: 'Tom (low)', group: 'Percussion', macros: M(['Pitch', 0.5], ['Bend', 0.4], ['Noise', 0.2], ['Head', 0.3]), maxSeconds: 2.5 },
  { id: 'tomMid', label: 'Tom (mid)', group: 'Percussion', macros: M(['Pitch', 0.5], ['Bend', 0.4], ['Noise', 0.2], ['Head', 0.3]), maxSeconds: 2.2 },
  { id: 'tomHigh', label: 'Tom (high)', group: 'Percussion', macros: M(['Pitch', 0.5], ['Bend', 0.4], ['Noise', 0.2], ['Head', 0.3]), maxSeconds: 2 },
  { id: 'conga', label: 'Conga', group: 'Percussion', macros: M(['Pitch', 0.4], ['Slap', 0.3], ['Bend', 0.3], ['Ring', 0.3]), maxSeconds: 2.5 },
  { id: 'bongo', label: 'Bongo', group: 'Percussion', macros: M(['Pitch', 0.5], ['Slap', 0.3], ['Bend', 0.3], ['Ring', 0.2]), maxSeconds: 2 },
  { id: 'shaker', label: 'Shaker', group: 'Percussion', macros: M(['Grain', 0.5], ['Filter', 0.5], ['Shake', 0.4], ['Width', 0.4]), maxSeconds: 1.5 },
  { id: 'tambourine', label: 'Tambourine', group: 'Percussion', macros: M(['Jingle', 0.5], ['Shake', 0.5], ['Noise', 0.3], ['Filter', 0.5]), maxSeconds: 2.5 },
  { id: 'woodBlock', label: 'Wood block', group: 'Percussion', macros: M(['Pitch', 0.4], ['Ring', 0.3], ['Click', 0.3], ['Hollow', 0.4]), maxSeconds: 1.2 },
  { id: 'metal', label: 'Metallic hit', group: 'Percussion', macros: M(['Pitch', 0.4], ['Ratio', 0.5], ['Ring', 0.4], ['Bright', 0.4], ['Clang', 0.3]), maxSeconds: 9 },
  { id: 'zap', label: 'Zap', group: 'Effects', macros: M(['Start', 0.6], ['End', 0.3], ['Speed', 0.3], ['Wave', 0.2]), maxSeconds: 2 },
  { id: 'laser', label: 'Laser', group: 'Effects', macros: M(['Start', 0.7], ['End', 0.4], ['Speed', 0.5], ['FM', 0.4]), maxSeconds: 3 },
  { id: 'noise', label: 'Noise burst', group: 'Effects', macros: M(['Filter', 0.6], ['Q', 0.3], ['Type', 0.5], ['Attack', 0]), maxSeconds: 2 },
] satisfies DrumSynthEngineDef[]);

export const DRUM_SYNTH_ENGINE_IDS: readonly DrumSynthEngine[] = Object.freeze(DRUM_SYNTH_ENGINES.map(e => e.id));
const BY_ID = new Map(DRUM_SYNTH_ENGINES.map(e => [e.id, e]));
export const drumSynthEngine = (id: string): DrumSynthEngineDef | undefined => BY_ID.get(id as DrumSynthEngine);

export interface DrumSynthPatch {
  engine: DrumSynthEngine;
  /** The engine's macros, 0…1 (always `DRUM_SYNTH_MACROS`; an engine reads its first few). */
  m: number[];
  /** Semitones. */
  tune: number;
  /** 0…1: 0.5 is the engine's own length, 0 a quarter of it, 1 four times. */
  decay: number;
  /** 0…1: a low-pass after the voice, 1 open. */
  tone: number;
  /** 0…1: soft saturation. */
  drive: number;
  /** dB. */
  level: number;
  /** How much velocity changes the hit's level (0: every hit full). */
  velocity: number;
}

/** The shared parameters, by their path in the patch. */
export const DRUM_SYNTH_SHARED: readonly SynthParam[] = Object.freeze([
  { path: 'tune', min: -24, max: 24, default: 0, label: 'Tune', unit: 'st', int: true, bipolar: true },
  { path: 'decay', min: 0, max: 1, default: 0.5, label: 'Decay' },
  { path: 'tone', min: 0, max: 1, default: 1, label: 'Tone' },
  { path: 'drive', min: 0, max: 1, default: 0, label: 'Drive' },
  { path: 'level', min: -36, max: 0, default: -3, label: 'Level', unit: 'dB' },
  { path: 'velocity', min: 0, max: 1, default: 0.6, label: 'Vel sens' },
]);
const SHARED_BY_PATH = new Map(DRUM_SYNTH_SHARED.map(p => [p.path, p]));

/** The paths a lane can drive (the worklet takes them as `param`): the shared ones but velocity, and every macro. */
export const DRUM_SYNTH_AUTOMATABLE: readonly string[] = Object.freeze([
  'tune', 'decay', 'tone', 'drive', 'level', ...Array.from({ length: DRUM_SYNTH_MACROS }, (_, k) => `m.${k}`),
]);

/** A patch path's parameter (`tune` … `velocity`, `m.<k>` labelled by `engine` when given, else "Macro k"). */
export function drumSynthParam(path: string, engine?: string): SynthParam | undefined {
  const shared = SHARED_BY_PATH.get(path);
  if (shared) return shared;
  const m = /^m\.(\d)$/.exec(path);
  if (!m) return undefined;
  const k = Number(m[1]);
  if (k >= DRUM_SYNTH_MACROS) return undefined;
  const def = engine ? drumSynthEngine(engine)?.macros[k] : undefined;
  return { path, min: 0, max: 1, default: def?.default ?? 0.5, label: def?.label ?? `Macro ${k + 1}` };
}

/** A patch of `engine` at its defaults. */
export function defaultDrumSynthPatch(engine: DrumSynthEngine = 'kick808'): DrumSynthPatch {
  const def = BY_ID.get(engine) ?? DRUM_SYNTH_ENGINES[0]!;
  return {
    engine: def.id,
    m: Array.from({ length: DRUM_SYNTH_MACROS }, (_, k) => def.macros[k]?.default ?? 0),
    tune: 0, decay: 0.5, tone: 1, drive: 0, level: -3, velocity: 0.6,
  };
}

const num = (v: unknown, p: SynthParam): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
  const c = Math.max(p.min, Math.min(p.max, n));
  return p.int ? Math.round(c) : c;
};

/** A patch from anything: a known engine (else the 808 kick), every value present and in range. */
export function sanitiseDrumSynthPatch(raw: unknown): DrumSynthPatch {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const engine: DrumSynthEngine = typeof r.engine === 'string' && BY_ID.has(r.engine as DrumSynthEngine) ? r.engine as DrumSynthEngine : 'kick808';
  const d = defaultDrumSynthPatch(engine);
  const ms = Array.isArray(r.m) ? r.m : r.m && typeof r.m === 'object' ? Array.from({ length: DRUM_SYNTH_MACROS }, (_, k) => (r.m as Record<string, unknown>)[k]) : [];
  const out: DrumSynthPatch = {
    engine,
    m: d.m.map((dv, k) => { const v = ms[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : dv; }),
    tune: 0, decay: 0, tone: 0, drive: 0, level: 0, velocity: 0,
  };
  for (const p of DRUM_SYNTH_SHARED) (out as unknown as Record<string, number>)[p.path] = num(r[p.path], p);
  return out;
}

/** A patch switched to another engine: its macros at that engine's defaults, the shared values kept. */
export function withDrumSynthEngine(p: DrumSynthPatch, engine: DrumSynthEngine): DrumSynthPatch {
  if (!BY_ID.has(engine) || engine === p.engine) return p;
  return { ...p, engine, m: defaultDrumSynthPatch(engine).m };
}

/** The engine `by` steps (−1, +1) from `id` in the picker's order, wrapping (the ‹ › buttons). */
export function stepDrumSynthEngine(id: DrumSynthEngine, by: number): DrumSynthEngine {
  const n = DRUM_SYNTH_ENGINE_IDS.length;
  const i = DRUM_SYNTH_ENGINE_IDS.indexOf(id);
  return DRUM_SYNTH_ENGINE_IDS[(((i < 0 ? 0 : i) + by) % n + n) % n]!;
}

/**
 * The engines whose label or group holds every word of `query` (the picker's search): those whose
 * label holds them first (Enter takes the first), then those found by their group, each in order.
 */
export function searchDrumSynthEngines(query: string): DrumSynthEngineDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...DRUM_SYNTH_ENGINES];
  const has = (hay: string) => words.every(w => hay.toLowerCase().includes(w));
  const byLabel = DRUM_SYNTH_ENGINES.filter(e => has(e.label));
  return [...byLabel, ...DRUM_SYNTH_ENGINES.filter(e => !byLabel.includes(e) && has(`${e.label} ${e.group}`))];
}
