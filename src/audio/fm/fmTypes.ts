import { clampParam, getPath, setPath, type SynthParam } from '../synth/synthTypes';

/**
 * FM's patch (1.27, Cyber_FM_Plan.md): sine-family operators in one of forty algorithms (1.27's
 * eight for four operators, and since 1.28 the DX7's thirty-two for six), after Ableton's
 * Operator and the DX/TX family. Each operator is an oscillator at a ratio of the
 * note (or a fixed frequency) with its own envelope and level; a modulator's output bends the
 * phase of the operators it feeds (phase modulation, as every "FM" synth does), a carrier's is
 * heard. One operator feeds back (the algorithm says which). After the operators: a filter with its own envelope,
 * an LFO for vibrato and tremolo, and mono or poly voices. It lives on a synth track (`engine:
 * 'fm'`), like the other engines' patches, and goes to the `cyber-fm` processor as it is.
 *
 * Pure: no DOM, Web Audio or store imports.
 */

export type FmWave = 'sine' | 'half' | 'abs' | 'tri';
export const FM_WAVES: readonly FmWave[] = ['sine', 'half', 'abs', 'tri'];
export const FM_WAVE_LABELS: Record<FmWave, string> = { sine: 'Sine', half: 'Half sine', abs: 'Abs sine', tri: 'Triangle' };
export type FmFilterType = 'off' | 'lowpass' | 'highpass' | 'bandpass';
export const FM_FILTER_TYPES: readonly FmFilterType[] = ['off', 'lowpass', 'highpass', 'bandpass'];

export interface FmAdsr { attack: number; decay: number; sustain: number; release: number }

export interface FmOperator {
  /** Off: silent, and feeds nothing. */
  on: boolean;
  wave: FmWave;
  /**
   * The ratio to the note: `coarse` 0 is ½, then 1 … 32; since 1.28 `ratioFine` multiplies it by
   * 1 + 0.00 … 0.99 (as a DX's frequency fine, so 1.5 or 3.14 can be had); `fine` adds cents (detune).
   */
  coarse: number;
  ratioFine: number;
  fine: number;
  /** Fixed: plays `freq` Hz whatever the key (bells, drums). */
  fixed: boolean;
  freq: number;
  /** A carrier's loudness, a modulator's depth (0…1; 1 is a modulation index of 4π). */
  level: number;
  /** How much velocity scales the level (0: none, 1: fully). */
  velocity: number;
  /**
   * 1.28, key scaling: the level's change across the keyboard from middle C, up to ±6 dB an
   * octave (positive: louder up the keys), as a DX's level scaling.
   */
  keyLevel: number;
  /** 1.28, rate scaling: how much faster the envelope runs up the keys (1: twice as fast an octave up). */
  keyRate: number;
  env: FmAdsr;
}

/** The number of operators a patch holds (1.28: six, as the DX7; the 4-OP algorithms use the first four). */
export const FM_OPS = 6;

export interface FmPatch {
  /** 2 since 1.28 (six operators, the DX7 algorithms, key scaling, the pitch envelope); 1.27's patches read as 2. */
  version: 2;
  /** Index into FM_ALGORITHMS. */
  algorithm: number;
  /** The feedback of the algorithm's feedback operator (0…1). */
  feedback: number;
  ops: [FmOperator, FmOperator, FmOperator, FmOperator, FmOperator, FmOperator];
  filter: { type: FmFilterType; cutoff: number; resonance: number; envAmount: number };
  filterEnv: FmAdsr;
  /**
   * One LFO for the voices: vibrato (cents), tremolo (0…1) and, since 1.28, `depth`: it sweeps
   * the modulators' depth (FM's wah). The mod wheel adds vibrato.
   */
  lfo: { rate: number; pitch: number; amp: number; depth: number };
  /** 1.28: a pitch envelope on every operator: it starts `amount` semitones off and returns in `time` seconds. */
  pitchEnv: { amount: number; time: number };
  /** 1.28: semitones added to every note (a DX voice's transpose). */
  transpose: number;
  /** Pitch bend range, semitones. */
  bendRange: number;
  /** Output level, dB. */
  gain: number;
  voice: { mode: 'mono' | 'poly'; voices: number; glide: number };
}

/**
 * An algorithm (operators numbered 1–6, as on the panel): for each operator, which operators
 * modulate it; which are carriers (heard); which operator's output feeds back into which (`fb`,
 * usually an operator into itself); and whether it is one of the eight 4-OP algorithms (1.27,
 * operators 1–4; 5 and 6 are not played) or one of the DX7's thirty-two. Every modulator has a
 * higher number than what it feeds, so the processor runs 6 → 1 in one pass (a feedback into a
 * higher operator takes the previous sample, as on the DX7).
 */
export interface FmAlgorithm {
  name: string;
  family: '4op' | 'dx7';
  mods: [number[], number[], number[], number[], number[], number[]];
  carriers: number[];
  fb: { from: number; to: number };
}

type Mods = FmAlgorithm['mods'];
const m = (o: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number[]>>): Mods => [o[1] ?? [], o[2] ?? [], o[3] ?? [], o[4] ?? [], o[5] ?? [], o[6] ?? []];
const four = (name: string, mods: Partial<Record<1 | 2 | 3 | 4, number[]>>, carriers: number[]): FmAlgorithm => ({ name, family: '4op', mods: m(mods), carriers, fb: { from: 4, to: 4 } });
const dx = (n: number, mods: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number[]>>, carriers: number[], from: number, to = from): FmAlgorithm => ({ name: `DX7 ${n}`, family: 'dx7', mods: m(mods), carriers, fb: { from, to } });

export const FM_ALGORITHMS: readonly FmAlgorithm[] = Object.freeze([
  four('4→3→2→1', { 1: [2], 2: [3], 3: [4] }, [1]),
  four('(3+4)→2→1', { 1: [2], 2: [3, 4] }, [1]),
  four('(4→3)+2→1', { 1: [2, 3], 3: [4] }, [1]),
  four('4→(2,3)→1', { 1: [2, 3], 2: [4], 3: [4] }, [1]),
  four('4→3, 2→1', { 1: [2], 3: [4] }, [1, 3]),
  four('4→(1,2,3)', { 1: [4], 2: [4], 3: [4] }, [1, 2, 3]),
  four('4→3, 2, 1', { 3: [4] }, [1, 2, 3]),
  four('1+2+3+4', {}, [1, 2, 3, 4]),
  // The DX7's thirty-two, after its chart.
  dx(1, { 1: [2], 3: [4], 4: [5], 5: [6] }, [1, 3], 6),
  dx(2, { 1: [2], 3: [4], 4: [5], 5: [6] }, [1, 3], 2),
  dx(3, { 1: [2], 2: [3], 4: [5], 5: [6] }, [1, 4], 6),
  dx(4, { 1: [2], 2: [3], 4: [5], 5: [6] }, [1, 4], 4, 6),
  dx(5, { 1: [2], 3: [4], 5: [6] }, [1, 3, 5], 6),
  dx(6, { 1: [2], 3: [4], 5: [6] }, [1, 3, 5], 5, 6),
  dx(7, { 1: [2], 3: [4, 5], 5: [6] }, [1, 3], 6),
  dx(8, { 1: [2], 3: [4, 5], 5: [6] }, [1, 3], 4),
  dx(9, { 1: [2], 3: [4, 5], 5: [6] }, [1, 3], 2),
  dx(10, { 1: [2], 2: [3], 4: [5, 6] }, [1, 4], 3),
  dx(11, { 1: [2], 2: [3], 4: [5, 6] }, [1, 4], 6),
  dx(12, { 1: [2], 3: [4, 5, 6] }, [1, 3], 2),
  dx(13, { 1: [2], 3: [4, 5, 6] }, [1, 3], 6),
  dx(14, { 1: [2], 3: [4], 4: [5, 6] }, [1, 3], 6),
  dx(15, { 1: [2], 3: [4], 4: [5, 6] }, [1, 3], 2),
  dx(16, { 1: [2, 3, 5], 3: [4], 5: [6] }, [1], 6),
  dx(17, { 1: [2, 3, 5], 3: [4], 5: [6] }, [1], 2),
  dx(18, { 1: [2, 3, 4], 4: [5], 5: [6] }, [1], 3),
  dx(19, { 1: [2], 2: [3], 4: [6], 5: [6] }, [1, 4, 5], 6),
  dx(20, { 1: [3], 2: [3], 4: [5, 6] }, [1, 2, 4], 3),
  dx(21, { 1: [3], 2: [3], 4: [6], 5: [6] }, [1, 2, 4, 5], 3),
  dx(22, { 1: [2], 3: [6], 4: [6], 5: [6] }, [1, 3, 4, 5], 6),
  dx(23, { 2: [3], 4: [6], 5: [6] }, [1, 2, 4, 5], 6),
  dx(24, { 3: [6], 4: [6], 5: [6] }, [1, 2, 3, 4, 5], 6),
  dx(25, { 4: [6], 5: [6] }, [1, 2, 3, 4, 5], 6),
  dx(26, { 2: [3], 4: [5, 6] }, [1, 2, 4], 6),
  dx(27, { 2: [3], 4: [5, 6] }, [1, 2, 4], 3),
  dx(28, { 1: [2], 3: [4], 4: [5] }, [1, 3, 6], 5),
  dx(29, { 3: [4], 5: [6] }, [1, 2, 3, 5], 6),
  dx(30, { 3: [4], 4: [5] }, [1, 2, 3, 6], 5),
  dx(31, { 5: [6] }, [1, 2, 3, 4, 5], 6),
  dx(32, {}, [1, 2, 3, 4, 5, 6], 6),
]);

/** The first DX7 algorithm's index (the 4-OP ones come first). */
export const DX7_ALGORITHM_BASE = 8;

/** How many operators an algorithm plays: four (4-OP) or six (DX7). */
export function algorithmOps(a: FmAlgorithm): number { return a.family === '4op' ? 4 : 6; }

/** An algorithm's short label: "4-OP 3", "DX7 12". */
export function algorithmLabel(index: number): string {
  const a = FM_ALGORITHMS[index];
  if (!a) return '';
  return a.family === '4op' ? `4-OP ${index + 1}` : a.name;
}

/** A ratio from coarse and fine: coarse 0 is ½. */
export function opRatio(op: Pick<FmOperator, 'coarse' | 'fine'> & { ratioFine?: number }): number {
  return (op.coarse === 0 ? 0.5 : op.coarse) * (1 + (op.ratioFine ?? 0)) * Math.pow(2, op.fine / 1200);
}

/** An operator's frequency for a note (Hz). */
export function opFrequency(op: Pick<FmOperator, 'coarse' | 'fine' | 'fixed' | 'freq'> & { ratioFine?: number }, note: number): number {
  if (op.fixed) return op.freq;
  return 440 * Math.pow(2, (note - 69) / 12) * opRatio(op);
}

const adsr = (prefix: string, d: FmAdsr): SynthParam[] => [
  { path: `${prefix}.attack`, min: 0.001, max: 10, default: d.attack, label: 'Attack', unit: 's', log: true },
  { path: `${prefix}.decay`, min: 0.001, max: 10, default: d.decay, label: 'Decay', unit: 's', log: true },
  { path: `${prefix}.sustain`, min: 0, max: 1, default: d.sustain, label: 'Sustain' },
  { path: `${prefix}.release`, min: 0.001, max: 10, default: d.release, label: 'Release', unit: 's', log: true },
];

const OP_ENV: FmAdsr = { attack: 0.002, decay: 0.6, sustain: 0.7, release: 0.3 };
const FENV: FmAdsr = { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 };

const opParams = (i: number): SynthParam[] => [
  { path: `ops.${i}.coarse`, min: 0, max: 32, default: 1, label: 'Coarse', int: true },
  { path: `ops.${i}.ratioFine`, min: 0, max: 0.99, default: 0, label: 'Ratio fine' },
  { path: `ops.${i}.fine`, min: -100, max: 100, default: 0, label: 'Detune', unit: 'ct', bipolar: true },
  { path: `ops.${i}.freq`, min: 1, max: 12000, default: 440, label: 'Fixed', unit: 'Hz', log: true },
  { path: `ops.${i}.level`, min: 0, max: 1, default: i === 0 ? 0.8 : 0.4, label: 'Level' },
  { path: `ops.${i}.velocity`, min: 0, max: 1, default: 0.5, label: 'Velocity' },
  { path: `ops.${i}.keyLevel`, min: -1, max: 1, default: 0, label: 'Key level', bipolar: true },
  { path: `ops.${i}.keyRate`, min: 0, max: 1, default: 0, label: 'Key rate' },
  ...adsr(`ops.${i}.env`, OP_ENV),
];

/** Every numeric FM parameter: its path, range and default (knobs and automation read these). */
export const FM_PARAMS: readonly SynthParam[] = Object.freeze([
  { path: 'algorithm', min: 0, max: FM_ALGORITHMS.length - 1, default: 0, label: 'Algorithm', int: true },
  { path: 'feedback', min: 0, max: 1, default: 0, label: 'Feedback' },
  ...opParams(0), ...opParams(1), ...opParams(2), ...opParams(3), ...opParams(4), ...opParams(5),
  { path: 'filter.cutoff', min: 20, max: 20000, default: 20000, label: 'Cutoff', unit: 'Hz', log: true },
  { path: 'filter.resonance', min: 0, max: 1, default: 0.1, label: 'Resonance' },
  { path: 'filter.envAmount', min: -1, max: 1, default: 0, label: 'Env amount', bipolar: true },
  ...adsr('filterEnv', FENV),
  { path: 'lfo.rate', min: 0.05, max: 20, default: 5, label: 'Rate', unit: 'Hz', log: true },
  { path: 'lfo.pitch', min: 0, max: 100, default: 0, label: 'Vibrato', unit: 'ct' },
  { path: 'lfo.amp', min: 0, max: 1, default: 0, label: 'Tremolo' },
  { path: 'lfo.depth', min: 0, max: 1, default: 0, label: 'Mod depth' },
  { path: 'pitchEnv.amount', min: -48, max: 48, default: 0, label: 'Pitch env', unit: 'st', bipolar: true },
  { path: 'pitchEnv.time', min: 0.001, max: 10, default: 0.1, label: 'Env time', unit: 's', log: true },
  { path: 'transpose', min: -24, max: 24, default: 0, label: 'Transpose', unit: 'st', int: true, bipolar: true },
  { path: 'bendRange', min: 0, max: 24, default: 2, label: 'Bend', unit: 'st', int: true },
  { path: 'gain', min: -36, max: 12, default: 0, label: 'Gain', unit: 'dB' },
  { path: 'voice.voices', min: 1, max: 16, default: 8, label: 'Voices', int: true },
  { path: 'voice.glide', min: 0, max: 2, default: 0, label: 'Glide', unit: 's' },
]);
const BY_PATH = new Map(FM_PARAMS.map(p => [p.path, p]));

export function fmParam(path: string): SynthParam | undefined { return BY_PATH.get(path); }

/**
 * What an automation lane can drive (the processor applies it on its sample, to sounding
 * voices too): the operators' levels and fine tune, the feedback, the filter, the LFO and the
 * gain. The algorithm, the coarse ratios and the envelopes are the sound's shape: fixed.
 */
export const FM_AUTOMATABLE: readonly string[] = Object.freeze([
  'feedback',
  ...[0, 1, 2, 3, 4, 5].map(i => `ops.${i}.level`),
  ...[0, 1, 2, 3, 4, 5].map(i => `ops.${i}.fine`),
  'filter.cutoff', 'filter.resonance', 'filter.envAmount', 'lfo.rate', 'lfo.pitch', 'lfo.amp', 'lfo.depth', 'gain',
]);

function defaultOp(i: number): FmOperator {
  return { on: true, wave: 'sine', coarse: 1, ratioFine: 0, fine: 0, fixed: false, freq: 440, level: i === 0 ? 0.8 : 0.4, velocity: 0.5, keyLevel: 0, keyRate: 0, env: { ...OP_ENV } };
}

/** Init: an electric-piano-ish start, operator 2 modulating 1 (4-OP algorithm 1 reaches 1 from 2). */
export function defaultFmPatch(): FmPatch {
  const ops = [0, 1, 2, 3, 4, 5].map(defaultOp) as FmPatch['ops'];
  ops[1] = { ...ops[1], coarse: 1, level: 0.35, env: { attack: 0.001, decay: 0.8, sustain: 0.2, release: 0.3 } };
  for (const i of [2, 3, 4, 5]) ops[i] = { ...ops[i]!, on: false, level: 0 };
  return {
    version: 2,
    algorithm: 0,
    feedback: 0,
    ops,
    filter: { type: 'off', cutoff: 20000, resonance: 0.1, envAmount: 0 },
    filterEnv: { ...FENV },
    lfo: { rate: 5, pitch: 0, amp: 0, depth: 0 },
    pitchEnv: { amount: 0, time: 0.1 },
    transpose: 0,
    bendRange: 2,
    gain: 0,
    voice: { mode: 'poly', voices: 8, glide: 0 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A patch from anything (projects, live sessions, presets): every field present and in range.
 * A 1.27 patch (four operators) reads with operators 5 and 6 off and its algorithm unchanged.
 */
export function sanitiseFmPatch(raw: unknown): FmPatch {
  const r = isObj(raw) ? raw : {};
  let out = defaultFmPatch();
  // Absent operators take the defaults' on/level, so a partial preset still plays as written.
  for (const p of FM_PARAMS) {
    const v = getPath(r, p.path);
    if (v !== undefined) out = setPath(out, p.path, clampParam(p, v));
  }
  const ops = Array.isArray(r.ops) ? r.ops : [];
  out.ops = out.ops.map((o, i) => {
    const ro = isObj(ops[i]) ? ops[i] as Record<string, unknown> : {};
    return {
      ...o,
      on: typeof ro.on === 'boolean' ? ro.on : o.on,
      wave: (FM_WAVES as readonly unknown[]).includes(ro.wave) ? ro.wave as FmWave : 'sine',
      fixed: ro.fixed === true,
    };
  }) as FmPatch['ops'];
  const filter = isObj(r.filter) ? r.filter : {};
  out.filter = { ...out.filter, type: (FM_FILTER_TYPES as readonly unknown[]).includes(filter.type) ? filter.type as FmFilterType : 'off' };
  const voice = isObj(r.voice) ? r.voice : {};
  out.voice = { ...out.voice, mode: voice.mode === 'mono' ? 'mono' : 'poly' };
  return out;
}

/** A patch with one value changed (a knob, a switch), sanitised. */
export function setFmValue(patch: FmPatch, path: string, value: unknown): FmPatch {
  return sanitiseFmPatch(setPath(patch, path, value));
}

/** The operators heard (carriers) and the modulators of each, for the algorithm (0-based). */
export function algorithmOf(p: Pick<FmPatch, 'algorithm'>): FmAlgorithm {
  return FM_ALGORITHMS[p.algorithm] ?? FM_ALGORITHMS[0]!;
}
