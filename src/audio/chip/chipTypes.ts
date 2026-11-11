import { clampParam, getPath, setPath, type SynthParam } from '../synth/synthTypes';

/**
 * 8-BIT's patch (1.198, Cyber_8bit_Synth_Plan.md §2): an emulation of the NES's 2A03 sound chip,
 * the sound of the old 8-bit games. Per voice: two pulse channels (duty 12.5, 25, 50 or 75 %), a
 * 4-bit stepped triangle and an LFSR noise channel, each at a level in the chip's sixteen steps;
 * a volume envelope stepped at the 60 Hz frame clock; per-frame arpeggio, sweep (the 2A03's sweep
 * unit), vibrato and duty sequence; optional pitch on the chip's 11-bit timer periods; the chip's
 * non-linear mix and its output filters. It lives on a synth track (`engine: 'chip'`) and in SOUND
 * DESIGN's Instrument tab, and goes to the `cyber-chip` processor as it is.
 *
 * Pure: no DOM, Web Audio or store imports.
 */

/** The 2A03's CPU clock (NTSC), Hz: every timer runs from it. */
export const CHIP_CLOCK = 1789773;
/** The frame clock (the games' 60 Hz vertical blank), Hz. */
export const CHIP_FRAME_HZ = 60;
/** The pulses' duties (the chip's four), as fractions of a cycle. */
export const CHIP_DUTIES = [0.125, 0.25, 0.5, 0.75] as const;
export const CHIP_DUTY_LABELS = ['12.5%', '25%', '50%', '75%'] as const;
/** The noise channel's sixteen periods (NTSC, CPU cycles a step of the LFSR). */
export const CHIP_NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068] as const;

export type ChipNoiseMode = 'long' | 'short';
export type ChipOutput = 'clean' | 'nes' | 'tv';
export const CHIP_OUTPUTS: readonly ChipOutput[] = ['clean', 'nes', 'tv'];
export type ChipVoiceMode = 'chip' | 'poly';
export type ChipSweepDirection = 'up' | 'down';

export interface ChipPatch {
  version: 1;
  /** Levels 0–15 (the chip's 4-bit volume; 0 is off). Duty: index into CHIP_DUTIES. */
  pulse1: { level: number; duty: number };
  /** Pulse 2 can be detuned (cents) and transposed (semitones) against Pulse 1, for a fatter lead or an octave. */
  pulse2: { level: number; duty: number; detune: number; transpose: number };
  /** The triangle has no volume on the chip: `level` scales it in the mix; the envelope only gates it. */
  triangle: { level: number; transpose: number };
  /** Period: index into CHIP_NOISE_PERIODS (0 brightest). `track`: the period follows the key (C4 plays `period`). */
  noise: { level: number; period: number; mode: ChipNoiseMode; track: boolean };
  /** Attack, decay and release in frames (1/60 s); sustain in the chip's levels (0–15). */
  env: { attack: number; decay: number; sustain: number; release: number };
  /** Up to four semitone offsets, one a step, `speed` frames a step; without `loop` it stops on the last. */
  arp: { on: boolean; steps: number; offsets: [number, number, number, number]; speed: number; loop: boolean };
  /** The 2A03 sweep unit: every `period` frames the timer period changes by period ≫ `shift` (up: the pitch rises). */
  sweep: { on: boolean; direction: ChipSweepDirection; shift: number; period: number };
  /** A frame-rate LFO on the pitch: depth in cents, rate in Hz, starting `delay` frames into the note. */
  vibrato: { depth: number; rate: number; delay: number };
  /** The pulses' duty from a sequence (indices into CHIP_DUTIES), `speed` frames a step, looping. */
  dutySeq: { on: boolean; steps: number; values: [number, number, number, number]; speed: number };
  /** Pitch quantised to the chip's 11-bit timer periods (its slightly out-of-tune high notes). */
  chipTuning: boolean;
  /** After the mix: a DC blocker (clean), the NES's filters, or the NES's with a TV speaker's low-pass. */
  output: ChipOutput;
  /** How much velocity scales the envelope's peak (0: the chip's fixed loudness). */
  velocity: number;
  /** Semitones added to every note. */
  transpose: number;
  /** Pitch bend range, semitones. */
  bendRange: number;
  /** Output level, dB. */
  gain: number;
  /** Chip: one voice, last-note priority (as one channel of the chip); Poly: up to `voices`. */
  voice: { mode: ChipVoiceMode; voices: number };
}

const frames = (path: string, label: string, def: number, max = 240): SynthParam => ({ path, min: 0, max, default: def, label, unit: 'fr', int: true });

/** Every numeric 8-BIT parameter: its path, range and default (knobs, automation and the sanitiser read these). */
export const CHIP_PARAMS: readonly SynthParam[] = Object.freeze([
  { path: 'pulse1.level', min: 0, max: 15, default: 15, label: 'Level', int: true },
  { path: 'pulse1.duty', min: 0, max: 3, default: 2, label: 'Duty', int: true },
  { path: 'pulse2.level', min: 0, max: 15, default: 0, label: 'Level', int: true },
  { path: 'pulse2.duty', min: 0, max: 3, default: 1, label: 'Duty', int: true },
  { path: 'pulse2.detune', min: -50, max: 50, default: 0, label: 'Detune', unit: 'ct', bipolar: true },
  { path: 'pulse2.transpose', min: -24, max: 24, default: 0, label: 'Transpose', unit: 'st', int: true, bipolar: true },
  { path: 'triangle.level', min: 0, max: 15, default: 0, label: 'Level', int: true },
  { path: 'triangle.transpose', min: -24, max: 24, default: 0, label: 'Transpose', unit: 'st', int: true, bipolar: true },
  { path: 'noise.level', min: 0, max: 15, default: 0, label: 'Level', int: true },
  { path: 'noise.period', min: 0, max: 15, default: 4, label: 'Period', int: true },
  frames('env.attack', 'Attack', 0),
  frames('env.decay', 'Decay', 0),
  { path: 'env.sustain', min: 0, max: 15, default: 15, label: 'Sustain', int: true },
  frames('env.release', 'Release', 4),
  { path: 'arp.steps', min: 1, max: 4, default: 3, label: 'Steps', int: true },
  { path: 'arp.offsets.0', min: -24, max: 24, default: 0, label: 'Step 1', unit: 'st', int: true, bipolar: true },
  { path: 'arp.offsets.1', min: -24, max: 24, default: 4, label: 'Step 2', unit: 'st', int: true, bipolar: true },
  { path: 'arp.offsets.2', min: -24, max: 24, default: 7, label: 'Step 3', unit: 'st', int: true, bipolar: true },
  { path: 'arp.offsets.3', min: -24, max: 24, default: 12, label: 'Step 4', unit: 'st', int: true, bipolar: true },
  frames('arp.speed', 'Speed', 1, 16),
  { path: 'sweep.shift', min: 1, max: 7, default: 3, label: 'Shift', int: true },
  { path: 'sweep.period', min: 1, max: 8, default: 1, label: 'Period', unit: 'fr', int: true },
  { path: 'vibrato.depth', min: 0, max: 100, default: 0, label: 'Depth', unit: 'ct' },
  { path: 'vibrato.rate', min: 0.5, max: 15, default: 6, label: 'Rate', unit: 'Hz' },
  frames('vibrato.delay', 'Delay', 0, 120),
  { path: 'dutySeq.steps', min: 1, max: 4, default: 4, label: 'Steps', int: true },
  { path: 'dutySeq.values.0', min: 0, max: 3, default: 0, label: 'Duty 1', int: true },
  { path: 'dutySeq.values.1', min: 0, max: 3, default: 1, label: 'Duty 2', int: true },
  { path: 'dutySeq.values.2', min: 0, max: 3, default: 2, label: 'Duty 3', int: true },
  { path: 'dutySeq.values.3', min: 0, max: 3, default: 1, label: 'Duty 4', int: true },
  frames('dutySeq.speed', 'Speed', 2, 16),
  { path: 'velocity', min: 0, max: 1, default: 0, label: 'Velocity' },
  { path: 'transpose', min: -24, max: 24, default: 0, label: 'Transpose', unit: 'st', int: true, bipolar: true },
  { path: 'bendRange', min: 0, max: 24, default: 2, label: 'Bend', unit: 'st', int: true },
  { path: 'gain', min: -36, max: 12, default: 0, label: 'Gain', unit: 'dB' },
  { path: 'voice.voices', min: 1, max: 8, default: 4, label: 'Voices', int: true },
]);
const BY_PATH = new Map(CHIP_PARAMS.map(p => [p.path, p]));

export function chipParam(path: string): SynthParam | undefined { return BY_PATH.get(path); }

/**
 * What an automation lane can drive (the processor applies it on its sample, to sounding voices
 * too): the four channels' levels, Pulse 2's detune, the noise period, the vibrato and the gain.
 * The envelope, the sequences and the switches are the sound's shape: fixed.
 */
export const CHIP_AUTOMATABLE: readonly string[] = Object.freeze([
  'pulse1.level', 'pulse2.level', 'triangle.level', 'noise.level', 'pulse2.detune', 'noise.period', 'vibrato.depth', 'vibrato.rate', 'gain',
]);

/** Init: one 50 % pulse at full level, an organ-like envelope, Chip tuning, the NES's output, four voices. */
export function defaultChipPatch(): ChipPatch {
  return {
    version: 1,
    pulse1: { level: 15, duty: 2 },
    pulse2: { level: 0, duty: 1, detune: 0, transpose: 0 },
    triangle: { level: 0, transpose: 0 },
    noise: { level: 0, period: 4, mode: 'long', track: false },
    env: { attack: 0, decay: 0, sustain: 15, release: 4 },
    arp: { on: false, steps: 3, offsets: [0, 4, 7, 12], speed: 1, loop: true },
    sweep: { on: false, direction: 'up', shift: 3, period: 1 },
    vibrato: { depth: 0, rate: 6, delay: 0 },
    dutySeq: { on: false, steps: 4, values: [0, 1, 2, 1], speed: 2 },
    chipTuning: true,
    output: 'nes',
    velocity: 0,
    transpose: 0,
    bendRange: 2,
    gain: 0,
    voice: { mode: 'poly', voices: 4 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** A patch from anything (projects, live sessions, presets, the Game bank): every field present and in range. */
export function sanitiseChipPatch(raw: unknown): ChipPatch {
  const r = isObj(raw) ? raw : {};
  let out = defaultChipPatch();
  for (const p of CHIP_PARAMS) {
    const v = getPath(r, p.path);
    if (v !== undefined) out = setPath(out, p.path, clampParam(p, v));
  }
  const g = (k: string): Record<string, unknown> => (isObj(r[k]) ? r[k] as Record<string, unknown> : {});
  const noise = g('noise'), arp = g('arp'), sweep = g('sweep'), duty = g('dutySeq'), voice = g('voice');
  out.noise = { ...out.noise, mode: noise.mode === 'short' ? 'short' : 'long', track: bool(noise.track, false) };
  out.arp = { ...out.arp, on: bool(arp.on, false), loop: bool(arp.loop, true) };
  out.sweep = { ...out.sweep, on: bool(sweep.on, false), direction: sweep.direction === 'down' ? 'down' : 'up' };
  out.dutySeq = { ...out.dutySeq, on: bool(duty.on, false) };
  out.chipTuning = bool(r.chipTuning, true);
  out.output = (CHIP_OUTPUTS as readonly unknown[]).includes(r.output) ? r.output as ChipOutput : 'nes';
  out.voice = { ...out.voice, mode: voice.mode === 'chip' ? 'chip' : 'poly' };
  return out;
}

/** A patch with one value changed (a knob, a switch), sanitised. */
export function setChipValue(patch: ChipPatch, path: string, value: unknown): ChipPatch {
  return sanitiseChipPatch(setPath(patch, path, value));
}

/** A note's frequency (Hz) in equal temperament. */
export const noteHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/**
 * The 2A03's timer period for a frequency (its 11-bit register): a pulse's frequency is
 * CLOCK ÷ (16 × (t + 1)), the triangle's CLOCK ÷ (32 × (t + 1)). Rounded and held to 0…2047.
 */
export function chipPeriod(hz: number, channel: 'pulse' | 'triangle'): number {
  const div = channel === 'pulse' ? 16 : 32;
  const t = Math.round(CHIP_CLOCK / (div * Math.max(1e-6, hz)) - 1);
  return Math.max(0, Math.min(2047, t));
}

/** The frequency a timer period plays (Hz). */
export function chipFrequency(period: number, channel: 'pulse' | 'triangle'): number {
  return CHIP_CLOCK / ((channel === 'pulse' ? 16 : 32) * (period + 1));
}
