import { DIVISIONS, divisionBeats, type Division } from '../audio/synth/synthTypes';
import { SCALE_INTERVALS, SCALE_MODES, type Scale, type ScaleMode } from './scales';
import { fxSongScale } from './fxSongScale';
import { automationValue } from './laneValue';
import type { AutomationPoint } from './sequencerTypes';

/**
 * MIDI effects (1.21, Cyber_MIDI_Effects_Plan.md): a chain of up to MAX_MIDI_FX devices on a
 * synth track, between its notes and its instrument. Every note the track plays goes through
 * it: the computer keys and MIDI (`src/audio/synth/input.ts`), clips in playback (the
 * transport), the export and a freeze (`exportSequence.ts`). The arpeggiator comes after it
 * and plays live input only, as before.
 *
 * Pure and deterministic: one note in gives the same notes out on every peer and in every
 * render. Random draws from a hash of the note's place (its clip, its start, its pitch) and the
 * device's seed, never from Math.random. No DOM, Web Audio or store imports.
 */

export type MidiFxType = 'chord' | 'scale' | 'echo' | 'random' | 'pitch' | 'velocity' | 'length' | 'steps';
/** 1.375: Pitch, Velocity and Note Length after the first four (Live's MIDI effects). */
/** 1.397: the Step Sequencer last. */
export const MIDI_FX_TYPES: readonly MidiFxType[] = ['chord', 'scale', 'echo', 'random', 'pitch', 'velocity', 'length', 'steps'];
export const MAX_MIDI_FX = 8;
export const CHORD_VOICES = 6;
export const MAX_CHORD_SHIFT = 36;
export const MAX_ECHO_REPEATS = 8;
export const ECHO_RATES: readonly Division[] = DIVISIONS;
export const MAX_RANDOM_CHOICES = 24;
export const MAX_RANDOM_INTERVAL = 12;
export const MAX_SEED = 9999;
/** At most this many notes come out of the chain for one note in. */
export const MAX_NOTES_OUT = 64;

export const MIDI_FX_LABELS: Readonly<Record<MidiFxType, string>> = { chord: 'Chord', scale: 'Scale', echo: 'Note Echo', random: 'Random', pitch: 'Pitch', velocity: 'Velocity', length: 'Note Length', steps: 'Step Sequencer' };
/** 1.375: the Chord's strum, at most this many beats between one voice and the next. */
export const MAX_STRUM = 0.25;
export const MAX_PITCH_SHIFT = 48;
/** 1.375: Note Length's fixed lengths, and its gate (a share of the played length). */
export const LENGTH_RATES: readonly Division[] = DIVISIONS;
export const MIN_GATE = 0.05;
export const MAX_GATE = 4;
export type LengthMode = 'gate' | 'time';
export const LENGTH_MODES: readonly LengthMode[] = ['gate', 'time'];
export const MIDI_FX_BLURBS: Readonly<Record<MidiFxType, string>> = {
  chord: 'Adds up to six notes at set intervals above or below each note',
  scale: 'Moves every note to the nearest note of a scale',
  echo: 'Repeats each note in time with the song, quieter each time, and can shift the pitch',
  random: 'Moves some notes by a random number of steps, the same way every time it plays',
  pitch: 'Moves every note up or down, and lets through only the notes in a range',
  velocity: 'Shapes each note\'s velocity: a curve, a range out and some randomness that repeats',
  length: 'Sets each note\'s length: a share of its own (gate) or a fixed time at the song tempo',
  steps: 'Plays a pattern of up to 64 steps in time with the song; a held note sets its root, or it runs free with the transport',
};

/** 1.397: the Step Sequencer's limits. */
export const MAX_STEPS = 64;
export const STEP_RATES: readonly Division[] = DIVISIONS;
export const MAX_STEP_DEGREE = 14;
export const MAX_STEP_OCTAVE = 3;
export const MAX_STEP_SWING = 0.5;
export const MIN_STEP_GATE = 0.05;
/** At most this many notes come out of the chain for one note through a Step Sequencer (a long held note). */
export const MAX_STEP_NOTES = 1024;

interface FxBase { id: string; on: boolean }
export interface ChordFx extends FxBase {
  type: 'chord';
  /** CHORD_VOICES shifts in semitones (±MAX_CHORD_SHIFT); 0 is an unused voice. */
  shifts: number[];
  /** The added notes' velocity, as a share of the played note's (0.1 to 1.5). */
  velocity: number;
  /**
   * 1.375: the strum, in beats between one voice and the next (0 to MAX_STRUM; absent: 0), in
   * the order the voices sound from the lowest up (Live's Strum).
   */
  strum?: number;
}
export interface ScaleFx extends FxBase {
  type: 'scale';
  /** Pitch class of the root, 0 = C … 11 = B. */
  root: number;
  mode: ScaleMode;
  /** 1.375: follow the song's scale (`fxSongScale`) where it has one; root and mode are the fallback. */
  follow?: boolean;
}
/** 1.375: Live's Pitch: a shift, then only notes within `lowest` … `lowest + range` pass (before the shift). */
export interface PitchFx extends FxBase {
  type: 'pitch';
  /** Semitones (±MAX_PITCH_SHIFT). */
  pitch: number;
  lowest: number;
  range: number;
}
/**
 * 1.375: Live's Velocity: a curve (`drive` −1 … 1: above 0 louder, below 0 softer, as a power
 * curve), mapped into `outLow` … `outHigh` (1–127), then up to `random` × 127 down at random
 * (seeded, as Random's).
 */
export interface VelocityFx extends FxBase {
  type: 'velocity';
  drive: number;
  outLow: number;
  outHigh: number;
  random: number;
  seed: number;
}
/** 1.375: Live's Note Length: `gate` a share of the played length, `time` a fixed division. */
export interface LengthFx extends FxBase {
  type: 'length';
  mode: LengthMode;
  gate: number;
  rate: Division;
}
export interface EchoFx extends FxBase {
  type: 'echo';
  /** The time between repeats, a note division at the song tempo. */
  rate: Division;
  repeats: number;
  /** Each repeat's velocity, as a share of the one before (0.1 to 1). */
  decay: number;
  /** Semitones added at each repeat (±12). */
  pitch: number;
}
export type RandomSign = 'up' | 'down' | 'both';
export const RANDOM_SIGNS: readonly RandomSign[] = ['up', 'down', 'both'];
export interface RandomFx extends FxBase {
  type: 'random';
  /** The share of notes that move (0 to 1). */
  chance: number;
  /** How many steps a moved note can go: 1 to MAX_RANDOM_CHOICES. */
  choices: number;
  /** A step, in semitones (1 to MAX_RANDOM_INTERVAL; 12 moves by octaves). */
  interval: number;
  sign: RandomSign;
  /** How much the velocity can drop, at random (0 to 1). */
  velocity: number;
  /** Another seed gives another, equally repeatable, pattern. */
  seed: number;
}
/** 1.397: one step of the Step Sequencer. */
export interface StepSeqStep {
  on: boolean;
  /** Scale degrees from the root (±MAX_STEP_DEGREE): 0 the root, 2 a third up in a major scale. */
  degree: number;
  /** Whole octaves added (±MAX_STEP_OCTAVE). */
  octave: number;
  velocity: number;
  /** The note's length, a share of the step (MIN_STEP_GATE … 1). */
  gate: number;
  /** How often it plays (0…1), drawn from the seed and the step's place in the song. */
  chance: number;
}
/**
 * 1.397 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 15): the **Step Sequencer**, a MIDI effect.
 * A pattern of `length` steps at `rate`, locked to the song's beats (step s is at s × the rate, the
 * pattern's step s mod length), each a scale degree, an octave, a velocity, a gate and a chance.
 * A played note of a set length (a clip's, a click's) plays the steps that fall inside it, with its
 * pitch as the root; a held key plays them while held (`stepRunner.ts` asks a window at a time).
 * With `free`, the pattern also plays with the transport at `root` where the track plays no clip
 * (`stepFreeRun.ts`). Pure, seeded: live and offline post the same notes.
 */
export interface StepsFx extends FxBase {
  type: 'steps';
  /** MAX_STEPS steps, kept whatever the length (shortening and lengthening again loses nothing). */
  steps: StepSeqStep[];
  length: number;
  rate: Division;
  /** The scale the degrees walk, built on the root (or, with `follow`, the song's: `key` its root). */
  mode: ScaleMode;
  key: number;
  follow?: boolean;
  /** Every second step late by this share of a step (0…MAX_STEP_SWING). */
  swing: number;
  /** A groove from the song's pool on the steps' times and velocities (absent: none). */
  groove?: string;
  /** Plays with the transport at `root` where the track plays no clip. */
  free: boolean;
  /** The pitch the pattern plays at when it runs free (0–127; 60 is C4). */
  root: number;
  seed: number;
}
export type MidiFx = ChordFx | ScaleFx | EchoFx | RandomFx | PitchFx | VelocityFx | LengthFx | StepsFx;

/** Chord shapes for the Chord card's picker: shifts above the played note. */
export const CHORD_SHAPES: readonly { id: string; label: string; shifts: readonly number[] }[] = [
  { id: 'octave', label: 'Octave', shifts: [12] },
  { id: 'fifth', label: 'Fifth', shifts: [7] },
  { id: 'power', label: 'Power', shifts: [7, 12] },
  { id: 'major', label: 'Major', shifts: [4, 7] },
  { id: 'minor', label: 'Minor', shifts: [3, 7] },
  { id: 'sus2', label: 'Sus2', shifts: [2, 7] },
  { id: 'sus4', label: 'Sus4', shifts: [5, 7] },
  { id: 'maj7', label: 'Major 7', shifts: [4, 7, 11] },
  { id: 'min7', label: 'Minor 7', shifts: [3, 7, 10] },
  { id: 'dom7', label: 'Dominant 7', shifts: [4, 7, 10] },
  { id: 'add9', label: 'Add 9', shifts: [4, 7, 14] },
  { id: 'min9', label: 'Minor 9', shifts: [3, 7, 10, 14] },
];

/** The shape a chord's shifts make, or null (custom). Order and unused voices don't matter. */
export function chordShapeOf(shifts: readonly number[]): string | null {
  const key = (xs: readonly number[]) => [...new Set(xs.filter(x => x !== 0))].sort((a, b) => a - b).join(',');
  const k = key(shifts);
  return CHORD_SHAPES.find(s => key(s.shifts) === k)?.id ?? null;
}

/** Six voices from a shape's shifts (the rest unused). */
export function shapeShifts(shifts: readonly number[]): number[] {
  return Array.from({ length: CHORD_VOICES }, (_, i) => shifts[i] ?? 0);
}

// --- Defaults and sanitising ---------------------------------------------------------------

let idSeq = 0;
function fxId(): string {
  idSeq = (idSeq + 1) % 1e6;
  return `mfx-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function defaultMidiFx(type: MidiFxType, id = fxId()): MidiFx {
  switch (type) {
    case 'chord': return { id, type, on: true, shifts: shapeShifts([4, 7]), velocity: 0.8 };
    case 'scale': return { id, type, on: true, root: 0, mode: 'major' };
    case 'echo': return { id, type, on: true, rate: '1/8', repeats: 3, decay: 0.6, pitch: 0 };
    case 'random': return { id, type, on: true, chance: 0.5, choices: 2, interval: 12, sign: 'up', velocity: 0, seed: 1 };
    case 'pitch': return { id, type, on: true, pitch: 12, lowest: 0, range: 127 };
    case 'velocity': return { id, type, on: true, drive: 0, outLow: 1, outHigh: 127, random: 0, seed: 1 };
    case 'length': return { id, type, on: true, mode: 'gate', gate: 0.5, rate: '1/16' };
    case 'steps': return { id, type, on: true, steps: stepPreset('up').steps, length: 16, rate: '1/16', mode: 'major', key: 0, swing: 0, free: false, root: 60, seed: 1 };
  }
}

/** 1.397: a step at its defaults (on, the root, velocity 100, gate a half, always). */
export const defaultStep = (over: Partial<StepSeqStep> = {}): StepSeqStep => ({ on: true, degree: 0, octave: 0, velocity: 100, gate: 0.5, chance: 1, ...over });

/** 1.397: the Step Sequencer's presets (the pattern; length and rate). */
export const STEP_PRESETS: readonly { id: string; label: string }[] = [
  { id: 'up', label: 'Up the scale' },
  { id: 'down', label: 'Down the scale' },
  { id: 'octaves', label: 'Octaves' },
  { id: 'arp', label: 'Triad arpeggio' },
  { id: 'pulse', label: 'Root pulse' },
  { id: 'offbeat', label: 'Off-beats' },
  { id: 'random', label: 'Sometimes' },
];
export function stepPreset(id: string): { steps: StepSeqStep[]; length: number; rate: Division } {
  const fill = (f: (i: number) => Partial<StepSeqStep>, length: number, rate: Division = '1/16') =>
    ({ steps: Array.from({ length: MAX_STEPS }, (_, i) => defaultStep(f(i))), length, rate });
  switch (id) {
    case 'down': return fill(i => ({ degree: 7 - (i % 8) }), 8);
    case 'octaves': return fill(i => ({ octave: i % 2 }), 8);
    case 'arp': return fill(i => ({ degree: [0, 2, 4, 7][i % 4]! }), 4, '1/8');
    case 'pulse': return fill(i => ({ velocity: i % 4 === 0 ? 120 : 80, gate: 0.25 }), 16);
    case 'offbeat': return fill(i => ({ on: i % 2 === 1, gate: 0.4 }), 8, '1/8');
    case 'random': return fill(i => ({ degree: [0, 4, 2, 5][i % 4]!, chance: i % 4 === 0 ? 1 : 0.5 }), 16);
    case 'up': default: return fill(i => ({ degree: i % 8 }), 8);
  }
}

function sanitiseStep(raw: unknown): StepSeqStep {
  const r = isObj(raw) ? raw : {};
  return {
    on: typeof r.on === 'boolean' ? r.on : true,
    degree: num(r.degree, -MAX_STEP_DEGREE, MAX_STEP_DEGREE, 0, true),
    octave: num(r.octave, -MAX_STEP_OCTAVE, MAX_STEP_OCTAVE, 0, true),
    velocity: num(r.velocity, 1, 127, 100, true),
    gate: num(r.gate, MIN_STEP_GATE, 1, 0.5),
    chance: num(r.chance, 0, 1, 1),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, d: number, int = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  const x = Math.min(max, Math.max(min, v));
  return int ? Math.round(x) : x;
};
const oneOf = <T extends string>(v: unknown, xs: readonly T[], d: T): T => (typeof v === 'string' && (xs as readonly string[]).includes(v) ? v as T : d);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** One device from anything (projects, live sessions), or null when it is not one. */
export function sanitiseMidiFx(raw: unknown): MidiFx | null {
  if (!isObj(raw) || !(MIDI_FX_TYPES as readonly unknown[]).includes(raw.type)) return null;
  const type = raw.type as MidiFxType;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : fxId();
  const on = typeof raw.on === 'boolean' ? raw.on : true;
  const d = defaultMidiFx(type, id);
  switch (type) {
    case 'chord': {
      const src = Array.isArray(raw.shifts) ? raw.shifts : (d as ChordFx).shifts;
      const strum = num(raw.strum, 0, MAX_STRUM, 0);
      return { id, type, on, shifts: Array.from({ length: CHORD_VOICES }, (_, i) => num(src[i], -MAX_CHORD_SHIFT, MAX_CHORD_SHIFT, 0, true)), velocity: num(raw.velocity, 0.1, 1.5, 0.8), ...(strum > 0 ? { strum } : {}) };
    }
    case 'scale':
      return { id, type, on, root: num(raw.root, 0, 11, 0, true), mode: oneOf(raw.mode, SCALE_MODES, 'major'), ...(raw.follow === true ? { follow: true } : {}) };
    case 'pitch':
      return { id, type, on, pitch: num(raw.pitch, -MAX_PITCH_SHIFT, MAX_PITCH_SHIFT, 12, true), lowest: num(raw.lowest, 0, 127, 0, true), range: num(raw.range, 0, 127, 127, true) };
    case 'velocity': {
      const lo = num(raw.outLow, 1, 127, 1, true), hi = num(raw.outHigh, 1, 127, 127, true);
      return { id, type, on, drive: num(raw.drive, -1, 1, 0), outLow: lo, outHigh: hi, random: num(raw.random, 0, 1, 0), seed: num(raw.seed, 0, MAX_SEED, 1, true) };
    }
    case 'length':
      return { id, type, on, mode: oneOf(raw.mode, LENGTH_MODES, 'gate'), gate: num(raw.gate, MIN_GATE, MAX_GATE, 0.5), rate: oneOf(raw.rate, LENGTH_RATES, '1/16') };
    case 'echo':
      return { id, type, on, rate: oneOf(raw.rate, ECHO_RATES, '1/8'), repeats: num(raw.repeats, 1, MAX_ECHO_REPEATS, 3, true), decay: num(raw.decay, 0.1, 1, 0.6), pitch: num(raw.pitch, -12, 12, 0, true) };
    case 'steps': {
      const src = Array.isArray(raw.steps) ? raw.steps : (d as StepsFx).steps;
      const groove = typeof raw.groove === 'string' && ID_RE.test(raw.groove) ? raw.groove : undefined;
      return {
        id, type, on,
        steps: Array.from({ length: MAX_STEPS }, (_, i) => sanitiseStep(src[i])),
        length: num(raw.length, 1, MAX_STEPS, 16, true),
        rate: oneOf(raw.rate, STEP_RATES, '1/16'),
        mode: oneOf(raw.mode, SCALE_MODES, 'major'),
        key: num(raw.key, 0, 11, 0, true),
        ...(raw.follow === true ? { follow: true } : {}),
        swing: num(raw.swing, 0, MAX_STEP_SWING, 0),
        ...(groove ? { groove } : {}),
        free: raw.free === true,
        root: num(raw.root, 0, 127, 60, true),
        seed: num(raw.seed, 0, MAX_SEED, 1, true),
      };
    }
    case 'random':
      return {
        id, type, on,
        chance: num(raw.chance, 0, 1, 0.5),
        choices: num(raw.choices, 1, MAX_RANDOM_CHOICES, 2, true),
        interval: num(raw.interval, 1, MAX_RANDOM_INTERVAL, 12, true),
        sign: oneOf(raw.sign, RANDOM_SIGNS, 'up'),
        velocity: num(raw.velocity, 0, 1, 0),
        seed: num(raw.seed, 0, MAX_SEED, 1, true),
      };
  }
}

/**
 * 1.64 (handoff item 27): the effects a pads track (the Slicer) takes. Its notes are pad numbers,
 * not pitches: Note Echo repeats a hit (its Pitch moves each repeat by pads), Random moves some hits
 * to nearby pads. Chord and Scale work in the semitones of a key, which pads do not have.
 */
export const PADS_MIDI_FX_TYPES: readonly MidiFxType[] = ['echo', 'random', 'velocity', 'length'];

/** The effects a track of this kind takes (a synth track: all; a pads track: `PADS_MIDI_FX_TYPES`; others: none). */
export function midiFxTypesFor(kind: string): readonly MidiFxType[] {
  return kind === 'synth' ? MIDI_FX_TYPES : kind === 'pads' ? PADS_MIDI_FX_TYPES : [];
}

/** Whether a track of this kind holds a MIDI effects chain (1.21: synth tracks; 1.64: the pads track too). */
export const hasMidiFx = (kind: string): boolean => kind === 'synth' || kind === 'pads';

/** A track's chain (none on a track that cannot hold one). */
export function trackMidiFx(t: { kind: string; midiFx?: readonly MidiFx[] } | null | undefined): readonly MidiFx[] | undefined {
  return t && hasMidiFx(t.kind) ? t.midiFx : undefined;
}

/** A new effect for a track of this kind: on a pads track, Random moves by one pad up or down. */
export function defaultMidiFxFor(kind: string, type: MidiFxType): MidiFx {
  const fx = defaultMidiFx(type);
  return kind === 'pads' && fx.type === 'random' ? { ...fx, interval: 1, choices: 3, sign: 'both' } : fx;
}

/** `sanitiseMidiFxList` for a track of this kind: the effects it cannot take are dropped. */
export function sanitiseMidiFxListFor(kind: string, raw: unknown): MidiFx[] {
  const types = midiFxTypesFor(kind);
  return sanitiseMidiFxList(raw).filter(f => types.includes(f.type));
}

/** A track's chain from anything: at most MAX_MIDI_FX devices, unique ids, junk dropped. */
export function sanitiseMidiFxList(raw: unknown): MidiFx[] {
  if (!Array.isArray(raw)) return [];
  const out: MidiFx[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= MAX_MIDI_FX) break;
    const fx = sanitiseMidiFx(r);
    if (!fx) continue;
    if (seen.has(fx.id)) fx.id = fxId();
    seen.add(fx.id);
    out.push(fx);
  }
  return out;
}

// --- The chain -----------------------------------------------------------------------------

/** A note inside the chain: its delay from the played note and its length, both in beats. */
export interface FxNote { pitch: number; velocity: number; delay: number; length: number }

/** 32-bit hash of numbers (deterministic, well mixed). */
export function hash32(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h ^= h >>> 16;
  return h >>> 0;
}
/** A string's hash (clip ids). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const unit = (h: number) => h / 4294967296;

/** The nearest pitch in the scale (a tie goes down). */
export function snapToScale(pitch: number, root: number, mode: ScaleMode): number {
  const ints = SCALE_INTERVALS[mode];
  const inScale = (p: number) => ints.includes((((p - root) % 12) + 12) % 12);
  for (let d = 0; d <= 6; d++) {
    if (inScale(pitch - d)) return pitch - d;
    if (inScale(pitch + d)) return pitch + d;
  }
  return pitch;
}

const vel = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** 1.375: the Chord's strum: the voices from the lowest up, each `strum` beats after the one below (its length kept to the note's end). */
function strumVoices(voices: FxNote[], strum: number): void {
  const order = voices.map((v, i) => ({ v, i })).sort((a, b) => a.v.pitch - b.v.pitch || a.i - b.i);
  order.forEach(({ i }, k) => {
    const v = voices[i]!;
    const shift = k * strum;
    voices[i] = { ...v, delay: v.delay + shift, length: Math.max(1 / 960, v.length - shift) };
  });
}

/**
 * 1.375: the Velocity effect on one velocity (1–127): the curve (`drive` > 0 bends it up, < 0
 * down: x^(2^-2·drive) over 0–1), into the out range, then down by at most `random` × 127 at the
 * drawn `r` (0–1). Never below 1: a note it shapes still sounds.
 */
export function velocityCurve(fx: Pick<VelocityFx, 'drive' | 'outLow' | 'outHigh' | 'random'>, velocity: number, r: number): number {
  const x = Math.max(0, Math.min(1, velocity / 127));
  const curved = Math.pow(x, Math.pow(2, -2 * fx.drive));
  const lo = Math.min(fx.outLow, fx.outHigh), hi = Math.max(fx.outLow, fx.outHigh);
  const out = lo + curved * (hi - lo) - fx.random * 127 * r;
  return Math.max(1, Math.min(127, Math.round(out)));
}

function applyOne(fx: MidiFx, notes: FxNote[], key: number, index: number): FxNote[] {
  switch (fx.type) {
    case 'chord': {
      const out: FxNote[] = [];
      const strum = fx.strum ?? 0;
      for (const n of notes) {
        const voices: FxNote[] = [n];
        for (const s of fx.shifts) if (s !== 0) voices.push({ ...n, pitch: n.pitch + s, velocity: vel(n.velocity * fx.velocity) });
        if (strum > 0) strumVoices(voices, strum);
        out.push(...voices);
      }
      return out;
    }
    case 'scale':
      return notes.map(n => ({ ...n, pitch: snapToScale(n.pitch, fx.root, fx.mode) }));
    case 'pitch':
      return notes.filter(n => n.pitch >= fx.lowest && n.pitch <= fx.lowest + fx.range).map(n => ({ ...n, pitch: n.pitch + fx.pitch }));
    case 'velocity':
      return notes.map((n, i) => ({ ...n, velocity: velocityCurve(fx, n.velocity, unit(hash32(key, fx.seed, index, i, n.pitch, Math.round(n.delay * 960), 5))) }));
    case 'length':
      return notes.map(n => ({ ...n, length: fx.mode === 'time' ? divisionBeats(fx.rate) : n.length * fx.gate }));
    case 'echo': {
      const d = divisionBeats(fx.rate);
      const out: FxNote[] = [];
      for (const n of notes) {
        out.push(n);
        let v = n.velocity;
        for (let k = 1; k <= fx.repeats; k++) {
          v *= fx.decay;
          if (v < 1) break;
          out.push({ pitch: n.pitch + k * fx.pitch, velocity: vel(v), delay: n.delay + k * d, length: Math.min(n.length, d) });
        }
      }
      return out;
    }
    case 'steps':
      // 1.397: handled by `runChain` (each step note runs the rest of the chain with its own key).
      return notes;
    case 'random':
      return notes.map((n, i) => {
        let { pitch, velocity } = n;
        const h = (salt: number) => unit(hash32(key, fx.seed, index, i, n.pitch, Math.round(n.delay * 960), salt));
        if (fx.chance > 0 && h(1) < fx.chance) {
          const steps = 1 + Math.floor(h(2) * fx.choices);
          const down = fx.sign === 'down' || (fx.sign === 'both' && h(3) < 0.5);
          pitch += (down ? -1 : 1) * steps * fx.interval;
        }
        if (fx.velocity > 0) velocity = vel(velocity * (1 - fx.velocity * h(4)));
        return { ...n, pitch, velocity };
      });
  }
}

/**
 * 1.397: what a Step Sequencer hears besides the note. `beat` is the song beat the played note
 * starts on (its steps are where the song's grid puts them; absent: 0, the note's own start).
 * `window` (beats from the played note's start, `[from, to)`) asks only the steps in it (a held key:
 * `stepRunner.ts`, a window at a time); without it a note of no set length plays no steps.
 * `stepGroove` moves a step by the song's groove (`stepFreeRun.ts`' `stepGrooveOf`).
 */
export type StepGroove = (grooveId: string, beat: number, step: number) => { dt: number; dv: number } | null;
export interface FxRunOpts { beat?: number; window?: readonly [number, number]; stepGroove?: StepGroove }

/** 1.397: a degree up (or down) the scale (`key`, `mode`) from `base` (snapped into it first). */
export function walkScale(base: number, degree: number, key: number, mode: ScaleMode): number {
  const ints = SCALE_INTERVALS[mode];
  const n = ints.length;
  const start = snapToScale(base, key, mode);
  const rel = (((start - key) % 12) + 12) % 12;
  const idx = Math.max(0, ints.indexOf(rel));
  const total = idx + degree;
  const o = Math.floor(total / n), k = ((total % n) + n) % n;
  return start - rel + o * 12 + ints[k]!;
}

/** 1.397: the beats a step lasts. */
export const stepBeats = (fx: Pick<StepsFx, 'rate'>): number => divisionBeats(fx.rate);

/**
 * 1.397: the steps a played note `n` sounds (at song beat `beat0` + its delay), each with its own key
 * for the devices after it (from the seed and the step's place in the song, so a window's split never
 * changes a draw). A step s sits on the song's grid at s × the rate; its chance is drawn from the seed
 * and s; its pitch walks the scale from the played pitch.
 */
export function stepNotes(fx: StepsFx, n: FxNote, opts: FxRunOpts): { note: FxNote; key: number }[] {
  const sb = stepBeats(fx);
  const beat0 = opts.beat ?? 0;
  const start = beat0 + n.delay;
  let from = start, to = start + n.length;
  if (opts.window) { from = Math.max(from, beat0 + opts.window[0]); to = Math.min(to, beat0 + opts.window[1]); }
  if (!(to > from) || !Number.isFinite(to)) return [];
  const out: { note: FxNote; key: number }[] = [];
  const EPS = 1e-9;
  const first = Math.ceil((from - EPS) / sb) || 0;
  const key = fx.follow ? fx.key : (((n.pitch % 12) + 12) % 12);
  for (let s = first; s * sb < to - EPS; s++) {
    if (out.length >= MAX_STEP_NOTES) break;
    const step = fx.steps[((s % fx.length) + fx.length) % fx.length];
    if (!step?.on) continue;
    if (step.chance < 1 && unit(hash32(0x57e9, fx.seed, s)) >= step.chance) continue;
    const g = s * sb;
    let at = g + (s % 2 !== 0 ? fx.swing * sb : 0);
    let velocity = step.velocity;
    if (fx.groove && opts.stepGroove) {
      const m = opts.stepGroove(fx.groove, g, s);
      if (m) { at += m.dt; velocity += m.dv; }
    }
    const pitch = walkScale(n.pitch, step.degree, key, fx.mode) + 12 * step.octave;
    out.push({ note: { pitch, velocity: vel(velocity), delay: Math.max(n.delay, at - beat0), length: Math.max(1 / 960, step.gate * sb) }, key: hash32(0x5e95, fx.seed, s, pitch) });
  }
  return out;
}

/** The chain from device `start` on, without the final tidy (`runMidiFx` does that once). */
function runChain(chain: readonly MidiFx[], start: number, played: FxNote[], key: number, opts: FxRunOpts): FxNote[] {
  let notes = played;
  for (let index = start; index < chain.length; index++) {
    const fx = chain[index]!;
    if (!fx.on || !notes.length) continue;
    if (fx.type === 'steps') {
      // Each step runs the rest of the chain as a note of its own, keyed by its place in the song.
      const out: FxNote[] = [];
      for (const n of notes) for (const s of stepNotes(fx, n, opts)) {
        for (const x of runChain(chain, index + 1, [s.note], s.key, opts)) { out.push(x); if (out.length >= MAX_STEP_NOTES) return out; }
      }
      return out;
    }
    notes = applyOne(fx, notes, key, index);
    if (notes.length > MAX_NOTES_OUT) notes = notes.slice(0, MAX_NOTES_OUT);
  }
  return notes;
}

/**
 * The notes one played note becomes: through each device that is on, in order; then pitches
 * outside 0–127 and silent notes dropped, the same pitch at the same time once (the loudest),
 * and a note cut where a later one of the same pitch starts (the instrument plays one voice per
 * pitch). `key` makes Random's draws differ from note to note (see `noteKey`). 1.397: `opts` for a
 * Step Sequencer (`FxRunOpts`).
 */
export function runMidiFx(chain: readonly MidiFx[], played: FxNote, key: number, opts: FxRunOpts = {}): FxNote[] {
  const notes = runChain(chain, 0, [played], key, opts);
  const best = new Map<string, FxNote>();
  for (const n of notes) {
    if (n.pitch < 0 || n.pitch > 127 || n.velocity < 1 || !(n.length > 0)) continue;
    const k = `${n.pitch}@${Math.round(n.delay * 960)}`;
    const prev = best.get(k);
    if (!prev || n.velocity > prev.velocity) best.set(k, prev ? { ...n, length: Math.max(n.length, prev.length) } : n);
  }
  const out = [...best.values()].sort((a, b) => a.pitch - b.pitch || a.delay - b.delay);
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!, b = out[i + 1]!;
    if (a.pitch === b.pitch && a.delay + a.length > b.delay) out[i] = { ...a, length: b.delay - a.delay };
  }
  return out.sort((a, b) => a.delay - b.delay || a.pitch - b.pitch);
}

/** 1.397: whether a chain holds a Step Sequencer that is on (a held key then plays through `stepRunner.ts`). */
export const hasSteps = (chain: readonly MidiFx[] | undefined): boolean => !!chain?.some(f => f.on && f.type === 'steps');

/**
 * 1.375: a chain with every Scale that follows the song (`follow`) set to the song's scale. With
 * no song scale, or no follower, the chain itself (the same object).
 */
export function withSongScale<C extends readonly MidiFx[] | undefined>(chain: C, scale: Scale | null | undefined): C {
  if (!chain || !scale || !chain.some(f => (f.type === 'scale' || f.type === 'steps') && f.follow)) return chain;
  return chain.map(f => (f.type === 'scale' && f.follow && (f.root !== scale.root || f.mode !== scale.mode) ? { ...f, root: scale.root, mode: scale.mode }
    // 1.397: a Step Sequencer that follows the song walks the song's scale.
    : f.type === 'steps' && f.follow && (f.key !== scale.root || f.mode !== scale.mode) ? { ...f, key: scale.root, mode: scale.mode } : f)) as unknown as C;
}

/** Whether a chain changes anything (a device that is on). */
export function chainActive(chain: readonly MidiFx[] | undefined): chain is readonly MidiFx[] {
  return !!chain && chain.some(f => f.on);
}

/**
 * 1.63: what a clicked note (the piano roll's audition) sounds as through a chain: each note's
 * pitch, velocity, delay and length in seconds at `spb` seconds per beat. With no active chain,
 * the note itself. Random draws from the pitch, so a click on a note sounds the same each time.
 */
export function auditionNotes(chain: readonly MidiFx[] | undefined, pitch: number, velocity: number, seconds: number, spb: number): { pitch: number; velocity: number; delay: number; seconds: number }[] {
  if (!chainActive(chain)) return [{ pitch, velocity, delay: 0, seconds }];
  const b = Math.max(1e-6, spb);
  return runMidiFx(chain, { pitch, velocity, delay: 0, length: seconds / b }, hash32(0xa0d1, pitch))
    .map(n => ({ pitch: n.pitch, velocity: n.velocity, delay: n.delay * b, seconds: Math.max(0.02, n.length * b) }));
}

/** The key Random draws from for a clip note: its clip, its start (ticks) and its pitch. */
export function noteKey(clipId: string, startBeat: number, pitch: number): number {
  return hash32(hashString(clipId), Math.round(startBeat * 960), pitch);
}

// --- Automation (1.63) -----------------------------------------------------------------------

/**
 * A MIDI effect's parameter a lane can drive (`{ kind: 'midiFx', trackId, fxId, param }`): its key
 * on the device (`shifts.0` … `shifts.5` for the Chord's voices), its label and range. Choices that
 * are not numbers (the scale, the echo time, the direction, the seed) are not automatable.
 */
export interface MidiFxParamDef { key: string; label: string; min: number; max: number; int?: boolean; unit: '%' | 'st' | 'beats' | '' }
export const MIDI_FX_PARAMS: Readonly<Record<MidiFxType, readonly MidiFxParamDef[]>> = {
  chord: [
    ...Array.from({ length: CHORD_VOICES }, (_, i): MidiFxParamDef => ({ key: `shifts.${i}`, label: `Shift ${i + 1}`, min: -MAX_CHORD_SHIFT, max: MAX_CHORD_SHIFT, int: true, unit: 'st' })),
    { key: 'velocity', label: 'Velocity', min: 0.1, max: 1.5, unit: '%' },
    { key: 'strum', label: 'Strum', min: 0, max: MAX_STRUM, unit: 'beats' },
  ],
  scale: [{ key: 'root', label: 'Root', min: 0, max: 11, int: true, unit: '' }],
  echo: [
    { key: 'repeats', label: 'Repeats', min: 1, max: MAX_ECHO_REPEATS, int: true, unit: '' },
    { key: 'decay', label: 'Decay', min: 0.1, max: 1, unit: '%' },
    { key: 'pitch', label: 'Pitch', min: -12, max: 12, int: true, unit: 'st' },
  ],
  random: [
    { key: 'chance', label: 'Chance', min: 0, max: 1, unit: '%' },
    { key: 'choices', label: 'Choices', min: 1, max: MAX_RANDOM_CHOICES, int: true, unit: '' },
    { key: 'interval', label: 'Step', min: 1, max: MAX_RANDOM_INTERVAL, int: true, unit: 'st' },
    { key: 'velocity', label: 'Velocity', min: 0, max: 1, unit: '%' },
  ],
  pitch: [
    { key: 'pitch', label: 'Pitch', min: -MAX_PITCH_SHIFT, max: MAX_PITCH_SHIFT, int: true, unit: 'st' },
    { key: 'lowest', label: 'Lowest', min: 0, max: 127, int: true, unit: '' },
    { key: 'range', label: 'Range', min: 0, max: 127, int: true, unit: 'st' },
  ],
  velocity: [
    { key: 'drive', label: 'Drive', min: -1, max: 1, unit: '' },
    { key: 'outLow', label: 'Out low', min: 1, max: 127, int: true, unit: '' },
    { key: 'outHigh', label: 'Out high', min: 1, max: 127, int: true, unit: '' },
    { key: 'random', label: 'Random', min: 0, max: 1, unit: '%' },
  ],
  length: [{ key: 'gate', label: 'Gate', min: MIN_GATE, max: MAX_GATE, unit: '%' }],
  steps: [
    { key: 'swing', label: 'Swing', min: 0, max: MAX_STEP_SWING, unit: '%' },
    { key: 'length', label: 'Steps', min: 1, max: MAX_STEPS, int: true, unit: '' },
    { key: 'root', label: 'Root', min: 0, max: 127, int: true, unit: '' },
  ],
};

export function midiFxParamDef(type: MidiFxType, key: string): MidiFxParamDef | null {
  return MIDI_FX_PARAMS[type].find(p => p.key === key) ?? null;
}

/** A device's parameter now (its own units), or null when it has none by that key. */
export function midiFxParamValue(fx: MidiFx, key: string): number | null {
  if (!midiFxParamDef(fx.type, key)) return null;
  if (fx.type === 'chord' && key.startsWith('shifts.')) return fx.shifts[Number(key.slice(7))] ?? 0;
  if (fx.type === 'chord' && key === 'strum') return fx.strum ?? 0;
  const v = (fx as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}

/** The device with a parameter set (its own units, clamped and rounded as the def says). */
export function withMidiFxParam(fx: MidiFx, key: string, value: number): MidiFx {
  const def = midiFxParamDef(fx.type, key);
  if (!def || !Number.isFinite(value)) return fx;
  const c = Math.min(def.max, Math.max(def.min, value));
  const v = def.int ? Math.round(c) : c;
  if (fx.type === 'chord' && key.startsWith('shifts.')) {
    const i = Number(key.slice(7));
    return { ...fx, shifts: fx.shifts.map((s, j) => (j === i ? v : s)) };
  }
  return { ...fx, [key]: v } as MidiFx;
}

/** A lane value (0…1) in a parameter's own units: linear over its range, rounded where it is whole. */
export function midiFxLaneValue(def: MidiFxParamDef, norm: number): number {
  const c = norm < 0 ? 0 : norm > 1 ? 1 : norm;
  const v = def.min + c * (def.max - def.min);
  return def.int ? Math.round(v) : v;
}

/** A lane on one of a track's MIDI effects, as the chain reads it. */
export interface MidiFxLane { fxId: string; param: string; points: readonly AutomationPoint[] }

/**
 * The chain as it is at `beat`: each automated parameter at its lane's value there. Every note is
 * processed with the chain at its own start, so the transport and the export (which both ask at
 * the note's beat) hear the same notes. A lane naming a device or a parameter that is not there
 * changes nothing.
 */
export function chainAt(chain: readonly MidiFx[], lanes: readonly MidiFxLane[], beat: number): readonly MidiFx[] {
  if (!lanes.length) return chain;
  let out: MidiFx[] | null = null;
  for (const l of lanes) {
    const i = chain.findIndex(f => f.id === l.fxId);
    if (i < 0 || !l.points.length) continue;
    const cur: MidiFx = (out ?? chain)[i]!;
    const def = midiFxParamDef(cur.type, l.param);
    if (!def) continue;
    out ??= [...chain];
    out[i] = withMidiFxParam(cur, l.param, midiFxLaneValue(def, automationValue(l.points, beat)));
  }
  return out ?? chain;
}

/** A note the chain adds to a clip, in the clip's content time (the piano roll's ghost notes). */
export interface GhostNote { pitch: number; start: number; length: number; velocity: number }
/** At most this many ghost notes are worked out for one clip. */
export const MAX_GHOSTS = 4096;

/**
 * 1.63: what the chain makes of a clip's notes that is not a note of the clip: chord voices,
 * echoes, notes moved by Scale or Random, in the clip's content time (`start` from its content's
 * beat 0). `origin` is where the content's beat 0 plays (an arrangement clip's first pass: its
 * start less its offset), so Random draws and the lanes are those of that pass. Muted notes add
 * nothing; a ghost past the content's end is left out. Read only: the piano roll draws them faint.
 */
export function ghostNotes(
  notes: readonly { pitch: number; start: number; length: number; velocity: number; muted?: boolean }[],
  chainAt: (beat: number) => readonly MidiFx[] | undefined, clipId: string, origin: number, contentLength: number,
): GhostNote[] {
  const out: GhostNote[] = [];
  const own = new Set(notes.filter(n => !n.muted).map(n => `${n.pitch}@${Math.round(n.start * 960)}`));
  for (const n of notes) {
    if (n.muted || n.start >= contentLength) continue;
    const beat = origin + n.start;
    const chain = chainAt(beat);
    if (!chainActive(chain)) continue;
    for (const f of runMidiFx(chain, { pitch: n.pitch, velocity: n.velocity, delay: 0, length: n.length }, noteKey(clipId, beat, n.pitch), { beat })) {
      const start = n.start + f.delay;
      if (start >= contentLength - 1e-9 || own.has(`${f.pitch}@${Math.round(start * 960)}`)) continue;
      out.push({ pitch: f.pitch, start, length: Math.min(f.length, contentLength - start), velocity: f.velocity });
      if (out.length >= MAX_GHOSTS) return out;
    }
  }
  return out;
}

interface Scheduled { trackId: string; clipId: string; pitch: number; velocity: number; startBeat: number; endBeat: number }

/** What `expandMidiFx` asks: a track's chain (at a beat, where its lanes move it). */
export type ChainOf = (trackId: string, beat: number) => readonly MidiFx[] | undefined;

/**
 * Scheduled notes (`notesInWindow`) through their tracks' chains: what the transport and the
 * export play. A note on a track with no active chain passes as it is. Echoes may start after
 * the window the played note was in; the caller schedules them ahead (the instrument queues them
 * and the transport's stop clears the queue). Sorted by start. 1.63: the chain is asked at each
 * note's start, so its lanes apply there.
 */
export function expandMidiFx<T extends Scheduled>(notes: readonly T[], chainOf: ChainOf, stepGroove?: StepGroove): T[] {
  const out: T[] = [];
  let changed = false;
  for (const n of notes) {
    const chain = chainOf(n.trackId, n.startBeat);
    if (!chainActive(chain)) { out.push(n); continue; }
    changed = true;
    const len = n.endBeat - n.startBeat;
    // 1.397: a Step Sequencer reads the note's song beat (its steps on the song's grid).
    for (const f of runMidiFx(chain, { pitch: n.pitch, velocity: n.velocity, delay: 0, length: len }, noteKey(n.clipId, n.startBeat, n.pitch), { beat: n.startBeat, stepGroove })) {
      const start = n.startBeat + f.delay;
      out.push({ ...n, pitch: f.pitch, velocity: f.velocity, startBeat: start, endBeat: start + f.length });
    }
  }
  return changed ? out.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch) : out;
}

/** The chain lookup `expandMidiFx` wants, from a sequencer's tracks (synth tracks; 1.64: the pads track too). */
type FxTracks = readonly { id: string; kind: string; midiFx?: readonly MidiFx[] }[];
/** The lanes the lookup reads (only those on MIDI effects matter). */
type FxLanes = readonly { on: boolean; points: readonly AutomationPoint[]; target: { kind: string } }[];
/** Review 1.37 S-17: one lookup per tracks array (the scheduler asks every window); 1.63: and lanes array. */
const fxMemo = new WeakMap<FxTracks, { scale?: Scale | null; plain?: ChainOf; lanes?: FxLanes; withLanes?: ChainOf }>();
/**
 * 1.63: with `automation`, a track's chain is the one at the asked beat (`chainAt`). Without it
 * (the Session view's clips, which play outside the arrangement's time), the chain as it is.
 */
export function midiFxOf(s: { tracks: FxTracks; automation?: FxLanes; lastScale?: Scale | null }): ChainOf {
  // 1.375: a Scale that follows the song reads its scale here (`fxSongScale`), once per lookup.
  const scale = fxSongScale(s);
  let memo = fxMemo.get(s.tracks) ?? {};
  if (memo.scale !== undefined && memo.scale !== scale) memo = {};
  memo.scale = scale;
  fxMemo.set(s.tracks, memo);
  if (!s.automation && memo.plain) return memo.plain;
  if (s.automation && memo.lanes === s.automation && memo.withLanes) return memo.withLanes;
  const byId = new Map<string, readonly MidiFx[]>();
  for (const t of s.tracks) if (hasMidiFx(t.kind) && t.midiFx?.length) byId.set(t.id, withSongScale(t.midiFx, scale));
  const lanes = new Map<string, MidiFxLane[]>();
  for (const l of s.automation ?? []) {
    const t = l.target as { kind: string; trackId?: string; fxId?: string; param?: string };
    if (t.kind !== 'midiFx' || !l.on || !l.points.length || !t.trackId || !t.fxId || !t.param || !byId.has(t.trackId)) continue;
    const list = lanes.get(t.trackId) ?? [];
    list.push({ fxId: t.fxId, param: t.param, points: l.points });
    lanes.set(t.trackId, list);
  }
  const fn: ChainOf = (id, beat) => {
    const chain = byId.get(id);
    const ls = chain && lanes.get(id);
    return ls ? chainAt(chain, ls, beat) : chain;
  };
  if (s.automation) { memo.lanes = s.automation; memo.withLanes = fn; } else memo.plain = fn;
  return fn;
}
