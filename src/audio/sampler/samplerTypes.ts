import { clampParam, getPath, setPath, type SynthParam } from '../synth/synthTypes';
import { sanitiseZones, zoneHashes, type SamplerZone } from './samplerZones';

export type { SamplerZone } from './samplerZones';

/**
 * The SAMPLER's patch (1.22, Cyber_Sampler_Plan.md): one sample played across the keyboard,
 * pitched from its root note, with a play region, a loop, reverse, an amp envelope, a filter
 * with its own envelope, and mono or poly voices. It lives on a synth track (`engine:
 * 'sampler'`), like ANALOG's and WAVE's patches. The audio is an upload, by hash, so a live
 * session, autosave and the export find it as they find an audio clip's.
 *
 * Pure: no DOM, Web Audio or store imports.
 */

export type SamplerFilterType = 'off' | 'lowpass' | 'highpass' | 'bandpass';
export const SAMPLER_FILTER_TYPES: readonly SamplerFilterType[] = ['off', 'lowpass', 'highpass', 'bandpass'];
export type SamplerVoiceMode = 'mono' | 'poly';

export interface SamplerAdsr { attack: number; decay: number; sustain: number; release: number }

export interface SamplerPatch {
  version: 1;
  /** The upload played (its SHA-256) and its name; null until one is loaded. */
  sample: { hash: string; name: string } | null;
  /** The play region, as shares of the sample's length (0 to 1, start before end). */
  start: number;
  end: number;
  reverse: boolean;
  /** The loop, as shares of the sample's length; it plays inside the region while a key is held. */
  loop: { on: boolean; start: number; end: number };
  /** The key that plays the sample at its own pitch (MIDI note). */
  root: number;
  /** Semitones and cents added to every note. */
  transpose: number;
  fine: number;
  /** Output level, dB. */
  gain: number;
  /** How much velocity changes the level (0: none; 1: fully). */
  velocity: number;
  amp: SamplerAdsr;
  filter: { type: SamplerFilterType; cutoff: number; resonance: number; envAmount: number };
  filterEnv: SamplerAdsr;
  /**
   * `mono` plays one note at a time (gliding between them); `poly` up to `voices`. 1.63:
   * `bendRange`, the pitch bend wheel's reach in semitones (as ANALOG's, WAVE's and FM's).
   */
  voice: { mode: SamplerVoiceMode; voices: number; glide: number; bendRange: number };
  /** A key starts the sample and it plays to its end (or the region's), whatever the note-off. */
  oneShot: boolean;
  /**
   * 1.385: the zones (`samplerZones.ts`): samples across keys and velocities, played instead of
   * `sample` while there are any. Absent: the one sample, as before (and as an older client plays it).
   */
  zones?: SamplerZone[];
}

/** The longest sample a SAMPLER plays, seconds (longer uploads are refused when loaded). */
export const MAX_SAMPLER_SECONDS = 60;
/** The filter envelope's range at full amount, octaves. */
export const FILTER_ENV_OCTAVES = 6;

const adsr = (prefix: 'amp' | 'filterEnv', d: SamplerAdsr): SynthParam[] => [
  { path: `${prefix}.attack`, min: 0.001, max: 10, default: d.attack, label: 'Attack', unit: 's', log: true },
  { path: `${prefix}.decay`, min: 0.001, max: 10, default: d.decay, label: 'Decay', unit: 's', log: true },
  { path: `${prefix}.sustain`, min: 0, max: 1, default: d.sustain, label: 'Sustain' },
  { path: `${prefix}.release`, min: 0.001, max: 10, default: d.release, label: 'Release', unit: 's', log: true },
];

const AMP_DEFAULT: SamplerAdsr = { attack: 0.002, decay: 0.3, sustain: 1, release: 0.15 };
const FENV_DEFAULT: SamplerAdsr = { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 };

/** Every numeric SAMPLER parameter: its path, range and default (knobs and automation read these). */
export const SAMPLER_PARAMS: readonly SynthParam[] = Object.freeze([
  { path: 'start', min: 0, max: 1, default: 0, label: 'Start' },
  { path: 'end', min: 0, max: 1, default: 1, label: 'End' },
  { path: 'loop.start', min: 0, max: 1, default: 0, label: 'Loop start' },
  { path: 'loop.end', min: 0, max: 1, default: 1, label: 'Loop end' },
  { path: 'root', min: 0, max: 127, default: 60, label: 'Root', int: true },
  { path: 'transpose', min: -48, max: 48, default: 0, label: 'Transpose', unit: 'st', int: true, bipolar: true },
  { path: 'fine', min: -100, max: 100, default: 0, label: 'Fine', unit: 'ct', bipolar: true },
  { path: 'gain', min: -36, max: 12, default: 0, label: 'Gain', unit: 'dB' },
  { path: 'velocity', min: 0, max: 1, default: 0.6, label: 'Velocity' },
  ...adsr('amp', AMP_DEFAULT),
  { path: 'filter.cutoff', min: 20, max: 20000, default: 2000, label: 'Cutoff', unit: 'Hz', log: true },
  { path: 'filter.resonance', min: 0, max: 1, default: 0.2, label: 'Resonance' },
  { path: 'filter.envAmount', min: -1, max: 1, default: 0, label: 'Env amount', bipolar: true },
  ...adsr('filterEnv', FENV_DEFAULT),
  { path: 'voice.voices', min: 1, max: 16, default: 8, label: 'Voices', int: true },
  { path: 'voice.glide', min: 0, max: 2, default: 0, label: 'Glide', unit: 's' },
  { path: 'voice.bendRange', min: 0, max: 24, default: 2, label: 'Bend', unit: 'st', int: true },
]);
const BY_PATH = new Map(SAMPLER_PARAMS.map(p => [p.path, p]));

export function samplerParam(path: string): SynthParam | undefined { return BY_PATH.get(path); }

/**
 * The paths an automation lane can drive (the processor applies them on their sample): the
 * level, the tuning, the filter (on sounding voices too), and the start and envelope times (the
 * next notes). Root, the region's end, the loop points and the voice settings are fixed.
 */
export const SAMPLER_AUTOMATABLE: readonly string[] = Object.freeze([
  'gain', 'fine', 'filter.cutoff', 'filter.resonance', 'filter.envAmount', 'start', 'amp.attack', 'amp.release',
]);

export function defaultSamplerPatch(): SamplerPatch {
  return {
    version: 1,
    sample: null,
    start: 0, end: 1, reverse: false,
    loop: { on: false, start: 0, end: 1 },
    root: 60, transpose: 0, fine: 0, gain: 0, velocity: 0.6,
    amp: { ...AMP_DEFAULT },
    filter: { type: 'off', cutoff: 2000, resonance: 0.2, envAmount: 0 },
    filterEnv: { ...FENV_DEFAULT },
    voice: { mode: 'poly', voices: 8, glide: 0, bendRange: 2 },
    oneShot: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HASH_RE = /^[a-f0-9]{64}$/;

/** A patch from anything (projects, live sessions, presets): every field present and in range. */
export function sanitiseSamplerPatch(raw: unknown): SamplerPatch {
  const r = isObj(raw) ? raw : {};
  let out = defaultSamplerPatch();
  for (const p of SAMPLER_PARAMS) out = setPath(out, p.path, clampParam(p, getPath(r, p.path)));
  const s = isObj(r.sample) ? r.sample : null;
  out.sample = s && typeof s.hash === 'string' && HASH_RE.test(s.hash)
    ? { hash: s.hash, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : 'Sample' }
    : null;
  out.reverse = r.reverse === true;
  out.oneShot = r.oneShot === true;
  const loop = isObj(r.loop) ? r.loop : {};
  out.loop = { ...out.loop, on: loop.on === true };
  const filter = isObj(r.filter) ? r.filter : {};
  out.filter = { ...out.filter, type: (SAMPLER_FILTER_TYPES as readonly unknown[]).includes(filter.type) ? filter.type as SamplerFilterType : 'off' };
  const voice = isObj(r.voice) ? r.voice : {};
  out.voice = { ...out.voice, mode: voice.mode === 'mono' ? 'mono' : 'poly' };
  // The region and the loop each keep a sliver of length, start before end.
  const MIN = 0.001;
  const span = (a: number, b: number): [number, number] => {
    if (b - a >= MIN) return [a, b];
    const end = Math.min(1, a + MIN);
    return [Math.min(a, end - MIN), end];
  };
  [out.start, out.end] = span(out.start, out.end);
  const [ls, le] = span(out.loop.start, out.loop.end);
  out.loop = { ...out.loop, start: ls, end: le };
  const zones = sanitiseZones(r.zones);
  if (zones) out.zones = zones;
  return out;
}

/** 1.385: every upload a patch plays: its sample and its zones' (once each). */
export function samplerHashes(p: Pick<SamplerPatch, 'sample' | 'zones'>): string[] {
  const out = p.sample ? [p.sample.hash] : [];
  for (const h of zoneHashes(p.zones)) if (!out.includes(h)) out.push(h);
  return out;
}

/** A patch with one value changed (a knob, a switch), sanitised. */
export function setSamplerValue(patch: SamplerPatch, path: string, value: unknown): SamplerPatch {
  return sanitiseSamplerPatch(setPath(patch, path, value));
}

// --- What a note plays (pure: the processor and the tests use these) ---------------------------

/** The playback rate for a note: its distance from the root, the transpose and the fine tune. */
export function noteRate(p: Pick<SamplerPatch, 'root' | 'transpose' | 'fine'>, note: number): number {
  return Math.pow(2, (note - p.root + p.transpose + p.fine / 100) / 12);
}

/** 1.63: the mod wheel's vibrato at full wheel, cents (FM's depth; ANALOG's is half a semitone too). */
export const WHEEL_VIBRATO_CENTS = 50;
/** 1.63: the vibrato's rate, Hz. */
export const WHEEL_VIBRATO_HZ = 5.5;

/** 1.63: the pitch bend (−1…1, the wheel) in cents at the patch's bend range. */
export function bendCents(p: Pick<SamplerPatch, 'voice'>, bend: number): number {
  const b = Number.isFinite(bend) ? Math.max(-1, Math.min(1, bend)) : 0;
  return b * p.voice.bendRange * 100;
}

/** A note's level from its velocity (1..127) and the patch's velocity amount and gain. */
export function noteLevel(p: Pick<SamplerPatch, 'velocity' | 'gain'>, velocity: number): number {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  return (1 - p.velocity + p.velocity * v * v) * Math.pow(10, p.gain / 20);
}

/**
 * The region and loop in seconds of the buffer as it plays (reversed or not): where a voice
 * starts and stops, and the loop inside the region (null when off or too short).
 */
export function playRegion(p: Pick<SamplerPatch, 'start' | 'end' | 'loop' | 'reverse'>, duration: number): { start: number; end: number; loop: { start: number; end: number } | null } {
  const a = Math.min(p.start, p.end) * duration;
  const b = Math.max(p.start, p.end) * duration;
  // Reversed, the buffer runs backwards: a share s of the original is at (1 − s) of the reversed one.
  const flip = (x: number) => (p.reverse ? duration - x : x);
  const start = Math.min(flip(a), flip(b));
  const end = Math.max(flip(a), flip(b));
  let loop: { start: number; end: number } | null = null;
  if (p.loop.on) {
    const la = Math.min(flip(p.loop.start * duration), flip(p.loop.end * duration));
    const lb = Math.max(flip(p.loop.start * duration), flip(p.loop.end * duration));
    const ls = Math.max(start, la), le = Math.min(end, lb);
    if (le - ls > 0.002) loop = { start: ls, end: le };
  }
  return { start, end, loop };
}

/**
 * An ADSR's level at `t` seconds after the note-on (before any release), as the processor
 * draws it: a linear attack to 1, then an exponential approach to the sustain with a time
 * constant of a third of the decay (`setTargetAtTime`), so the decay is about 95 % done at its time.
 */
export function envLevel(e: SamplerAdsr, t: number): number {
  if (t <= 0) return 0;
  if (t < e.attack) return t / e.attack;
  const tau = Math.max(1e-4, e.decay / 3);
  return e.sustain + (1 - e.sustain) * Math.exp(-(t - e.attack) / tau);
}
