/**
 * The MIXER's insert effects, described (Cyber_Wavetable_Mixer_Work_Order.md §2, §4): the nine
 * types and their parameters, defaults and the sanitiser. Data only, so the model and the UI can
 * use it without loading the builders (effects.ts, loaded with the first sound). Every parameter
 * is a number, described once in FX_DEFS; a choice is an index into its `choices`.
 */

import { CYBER_NAMES, CYBER_PARAMS, CYBER_TYPES, type CyberType } from './cyberDefs';
import { sanitiseEstBlock, type EstSlotBlock } from '../est/slot';

/**
 * 1.374 (Cyber_Instruments_MIDI_Work_Order_3.md stream 7): Live 12's modulators as inserts. An
 * `'lfo'` or `'shaper'` slot passes its strip's sound through untouched and moves up to
 * `MAX_MOD_TARGETS` parameters of its track (`FxSlot.mod`) on the audio clock, as automation does
 * (`src/sequencer/modulators.ts`, pure; played by `automationPlayback.ts`, never the store).
 */
export const MODULATOR_TYPES = ['lfo', 'shaper'] as const;
export type ModulatorType = (typeof MODULATOR_TYPES)[number];
export const isModulatorType = (t: string): t is ModulatorType => (MODULATOR_TYPES as readonly string[]).includes(t);
export const MAX_MOD_TARGETS = 8;
/** A modulator's synced cycle lengths, in beats, with their labels. */
export const MOD_DIVISIONS: readonly { label: string; beats: number }[] = [
  { label: '4 bars', beats: 16 }, { label: '2 bars', beats: 8 }, { label: '1 bar', beats: 4 }, { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 }, { label: '1/8', beats: 0.5 }, { label: '1/16', beats: 0.25 }, { label: '1/32', beats: 0.125 },
];
export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Random'] as const;
/** The Shaper's drawn steps (`s0` … `s15`, each −1…1). */
export const SHAPER_STEPS = 16;
/**
 * A modulator's target on its own track, as a key: `track:volume`, `track:pan`, `track:send:<i>`,
 * `fx:<fxId>:<param>` (an insert's, an EST insert's CLAP id too) or `synth:<param>` (the
 * instrument's, an EST instrument's CLAP id too); `depth` −1…1, a share of the parameter's range.
 */
export interface ModTarget { key: string; depth: number }
const MOD_KEY_RE = /^(?:track:(?:volume|pan|send:[0-7])|fx:[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_.]{1,64}|synth:[A-Za-z0-9_.]{1,64})$/;

/** A modulator's targets from anything: valid keys, once each, depths in range, at most MAX_MOD_TARGETS. */
export function sanitiseModTargets(raw: unknown): ModTarget[] {
  const out: ModTarget[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_MOD_TARGETS) break;
    if (!r || typeof r !== 'object') continue;
    const { key, depth } = r as Record<string, unknown>;
    if (typeof key !== 'string' || !MOD_KEY_RE.test(key) || out.some(t => t.key === key)) continue;
    out.push({ key, depth: typeof depth === 'number' && Number.isFinite(depth) ? Math.max(-1, Math.min(1, depth)) : 0.5 });
  }
  return out;
}

/**
 * 1.33: the five Cyber inserts (cyberDefs.ts) come last: the MASTER chain's EQ, Compressor,
 * Saturation and Limiter, and the Vectorscope, each opening in a floating window.
 */
export const FX_TYPES = ['eq', 'filter', 'compressor', 'distortion', 'chorus', 'phaser', 'delay', 'reverb', 'utility', 'ducker', 'limiter', 'bitcrusher', ...CYBER_TYPES, ...MODULATOR_TYPES, 'est'] as const;
export type FxType = (typeof FX_TYPES)[number];
/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §1): `'est'`, last, is an installed EST plugin
 * (`FxSlot.est` names it). It has no fixed parameters and no `defaultFx`: a slot is made only by
 * `estSlotFor` (src/audio/est/insertSlot.ts), from an installed plugin, by an admin. Every list
 * offered to a person (the add menus, the Browser, presets, the every-type tests) is this one:
 * the built-in types, `'est'` left out on purpose.
 */
export const BUILT_IN_FX_TYPES = FX_TYPES.filter((t): t is Exclude<FxType, 'est'> => t !== 'est');
export type BuiltInFxType = Exclude<FxType, 'est'>;

export interface FxParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  log?: boolean;
  /** `%` is a 0…1 value shown as a percentage; `pct` (1.33, the Cyber Saturator) is already 0…100. */
  unit?: 'dB' | 'Hz' | 's' | 'ms' | '%' | 'pct' | 'x' | 'bit' | '';
  /** A choice: the value is an index into these labels. */
  choices?: readonly string[];
  /** False where the builder does not bind the value to an AudioParam (a curve, an impulse), so it cannot be automated (1.7). */
  automatable?: boolean;
}

/** Whether an automation lane may drive this parameter: a number bound to an AudioParam (Cyber_Arrangement_Work_Order.md §2.2). */
export function isAutomatable(p: FxParamDef): boolean {
  return !p.choices && p.automatable !== false;
}

export interface FxDef {
  type: FxType;
  name: string;
  blurb: string;
  params: readonly FxParamDef[];
  /** 1.33: the maker shown with the name (the Cyber inserts'; the add menu groups by it). None: the mixer's own effects. */
  vendor?: string;
  /** 1.374: the add menu's and the Browser's group without a maker (the modulators'); `vendor` otherwise. */
  group?: string;
}

/** A Cyber insert's FX_DEFS entry, from cyberDefs.ts (names and makers in one place). */
const cyberDef = (type: CyberType): FxDef => ({ type, ...CYBER_NAMES[type], params: CYBER_PARAMS[type] });

/** The Delay's note divisions (1.14), in beats; `label` as Ableton writes them. */
export const DELAY_DIVISIONS: readonly { label: string; beats: number }[] = [
  { label: '1/32', beats: 0.125 }, { label: '1/16T', beats: 1 / 6 }, { label: '1/16', beats: 0.25 }, { label: '1/16.', beats: 0.375 },
  { label: '1/8T', beats: 1 / 3 }, { label: '1/8', beats: 0.5 }, { label: '1/8.', beats: 0.75 }, { label: '1/4T', beats: 2 / 3 },
  { label: '1/4', beats: 1 }, { label: '1/4.', beats: 1.5 }, { label: '1/2T', beats: 4 / 3 }, { label: '1/2', beats: 2 },
  { label: '1/2.', beats: 3 }, { label: '1 bar', beats: 4 },
];
export const DELAY_DIV_QUARTER = 8;
/** Sync offset, ± a third of the note (Ableton's ±33.3%). */
export const DELAY_MAX_OFFSET = 1 / 3;
/** The filter's width in octaves (from the high-pass to the low-pass). */
export const DELAY_MIN_WIDTH = 0.5;
export const DELAY_MAX_WIDTH = 10;
/** The LFO's reach into the delay time, ms. */
export const DELAY_MAX_MOD_MS = 20;
/** The longest delay a line holds, s (a synced bar at a slow tempo is cut to it). */
export const DELAY_MAX_S = 5;

/** The EQ's passes' ranges (1.19). */
export const EQ_HP_MIN = 20;
export const EQ_HP_MAX = 2000;
export const EQ_LP_MIN = 1000;
export const EQ_LP_MAX = 20000;
/** The Compressor's lookahead (ms) and its key filter's high-pass (Hz; the lowest is off). */
export const COMP_MAX_LOOKAHEAD_MS = 10;
export const COMP_KEY_HP_MIN = 20;
export const COMP_KEY_HP_MAX = 2000;
/** The Compressor's ratio choices (1.19); `Infinity` is the ∞ position (`ratioInf`). */
export const COMP_RATIOS: readonly number[] = [1.5, 2, 3, 4, 6, 8, 10, 20, Infinity];
/** The Reverb's cuts at their ends are off (1.19). */
export const REVERB_LOW_CUT_MIN = 20;
export const REVERB_HIGH_CUT_MAX = 20000;

const mix = (d: number): FxParamDef => ({ key: 'mix', label: 'Mix', min: 0, max: 1, default: d, unit: '%' });

export const FX_DEFS: Readonly<Record<FxType, FxDef>> = Object.freeze({
  // 1.19: four bands and two passes, the display's pucks drag them. The 1.16 keys (low*, mid*,
  // high*) keep their names, ranges and meaning as bands 1, 2 and 4, so old lanes play as they
  // did; band 3, the passes and the bands' on switches are new keys whose defaults leave a 1.16
  // slot's response exactly as it was (a band off is a gain of 0 dB, a pass off is a biquad at
  // 0 Hz or Nyquist, which Web Audio passes untouched).
  eq: { type: 'eq', name: 'EQ', blurb: 'Four bands (low shelf, two bells, high shelf) and a high- and low-pass at the ends: drag the pucks.', params: [
    { key: 'lowGain', label: 'Low', min: -18, max: 18, default: 0, unit: 'dB' },
    { key: 'lowFreq', label: 'Low Hz', min: 30, max: 800, default: 120, log: true, unit: 'Hz' },
    { key: 'midGain', label: 'Mid', min: -18, max: 18, default: 0, unit: 'dB' },
    { key: 'midFreq', label: 'Mid Hz', min: 150, max: 8000, default: 1000, log: true, unit: 'Hz' },
    { key: 'midQ', label: 'Q', min: 0.3, max: 8, default: 1, log: true, unit: 'x' },
    { key: 'highGain', label: 'High', min: -18, max: 18, default: 0, unit: 'dB' },
    { key: 'highFreq', label: 'High Hz', min: 1500, max: 16000, default: 6000, log: true, unit: 'Hz' },
    { key: 'mid2Gain', label: 'Mid 2', min: -18, max: 18, default: 0, unit: 'dB' },
    { key: 'mid2Freq', label: 'Mid 2 Hz', min: 150, max: 16000, default: 3000, log: true, unit: 'Hz' },
    { key: 'mid2Q', label: 'Q 2', min: 0.3, max: 8, default: 1, log: true, unit: 'x' },
    { key: 'hpFreq', label: 'HP Hz', min: EQ_HP_MIN, max: EQ_HP_MAX, default: 60, log: true, unit: 'Hz' },
    { key: 'lpFreq', label: 'LP Hz', min: EQ_LP_MIN, max: EQ_LP_MAX, default: 14000, log: true, unit: 'Hz' },
    { key: 'lowOn', label: 'Band 1', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'midOn', label: 'Band 2', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'mid2On', label: 'Band 3', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
    { key: 'highOn', label: 'Band 4', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'hpOn', label: 'High-pass', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
    { key: 'hpSlope', label: 'HP slope', min: 0, max: 1, default: 0, choices: ['12 dB', '24 dB'] },
    { key: 'lpOn', label: 'Low-pass', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
    { key: 'lpSlope', label: 'LP slope', min: 0, max: 1, default: 0, choices: ['12 dB', '24 dB'] },
  ] },
  filter: { type: 'filter', name: 'Filter', blurb: 'A resonant low-, high-, band-pass or notch filter.', params: [
    { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0, choices: ['LP', 'HP', 'BP', 'Notch'] },
    { key: 'cutoff', label: 'Cutoff', min: 20, max: 20000, default: 2000, log: true, unit: 'Hz' },
    { key: 'q', label: 'Reso', min: 0.5, max: 18, default: 0.8, log: true, unit: 'x' },
  ] },
  // 1.19: after Ableton's Compressor (compressor.ts). The 1.18 keys keep their ranges and meaning,
  // so old lanes play; ∞ is `ratioInf` beside the ratio (which a lane can still drive), and an old
  // slot is moved over by migrateCompressorParams (the browser's own makeup gain and its 6 ms).
  compressor: { type: 'compressor', name: 'Compressor', blurb: 'Evens out the level, from its own sound or a sidechain key; makeup brings it back up.', params: [
    { key: 'threshold', label: 'Thresh', min: -60, max: 0, default: -18, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, log: true, unit: 'x' },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.3, default: 0.01, log: true, unit: 's' },
    { key: 'release', label: 'Release', min: 0.02, max: 1.5, default: 0.2, log: true, unit: 's' },
    { key: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 24, default: 0, unit: 'dB' },
    mix(1),
    { key: 'ratioInf', label: 'Ratio ∞', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
    { key: 'detect', label: 'Detect', min: 0, max: 1, default: 0, choices: ['Peak', 'RMS'] },
    { key: 'lookahead', label: 'Look', min: 0, max: COMP_MAX_LOOKAHEAD_MS, default: 0, unit: 'ms', automatable: false },
    { key: 'keyHp', label: 'Key HP', min: COMP_KEY_HP_MIN, max: COMP_KEY_HP_MAX, default: COMP_KEY_HP_MIN, log: true, unit: 'Hz' },
    // The browser's own makeup gain (0.6 of the reduction at full scale): old slots keep it.
    { key: 'autoMakeup', label: 'Auto makeup', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
  ] },
  distortion: { type: 'distortion', name: 'Distortion', blurb: 'Soft or hard clipping, wavefolding, or a bitcrusher.', params: [
    { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0, choices: ['Soft', 'Hard', 'Fold', 'Crush'] },
    { key: 'drive', label: 'Drive', min: 0, max: 1, default: 0.4, unit: '%', automatable: false },
    { key: 'tone', label: 'Tone', min: 300, max: 20000, default: 9000, log: true, unit: 'Hz' },
    { key: 'output', label: 'Out', min: -24, max: 6, default: 0, unit: 'dB' },
    mix(1),
  ] },
  chorus: { type: 'chorus', name: 'Chorus', blurb: 'Two modulated delays, one each side: width and shimmer.', params: [
    { key: 'rate', label: 'Rate', min: 0.05, max: 5, default: 0.8, log: true, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.5, unit: '%' },
    { key: 'delay', label: 'Delay', min: 5, max: 30, default: 12, unit: 'ms' },
    { key: 'feedback', label: 'Fdbk', min: 0, max: 0.9, default: 0.1, unit: '%' },
    mix(0.5),
  ] },
  phaser: { type: 'phaser', name: 'Phaser', blurb: 'All-pass stages swept by an LFO: moving notches.', params: [
    { key: 'rate', label: 'Rate', min: 0.05, max: 5, default: 0.4, log: true, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.7, unit: '%' },
    { key: 'center', label: 'Center', min: 200, max: 4000, default: 900, log: true, unit: 'Hz' },
    { key: 'feedback', label: 'Fdbk', min: 0, max: 0.9, default: 0.4, unit: '%' },
    { key: 'stages', label: 'Stages', min: 0, max: 2, default: 1, choices: ['4', '6', '8'] },
    mix(0.5),
  ] },
  // 1.14: Ableton-style Delay (delay.ts). The old keys (time, feedback, pingpong, mix) keep their
  // meaning and range, so old lanes still play them; old slots are moved over by migrateDelayParams.
  delay: { type: 'delay', name: 'Delay', blurb: 'Two delay lines, L and R: synced to the tempo or in ms, ping-pong, a filter and an LFO in the feedback, Freeze.', params: [
    { key: 'time', label: 'Time L', min: 0.01, max: 2, default: 0.375, log: true, unit: 's' },
    // 1.62: R's time and the offsets automate too. Each side's taps follow one key at a time
    // (delay.ts, laneTimeKey): its time in ms mode, its offset when synced; R's are L's while linked.
    { key: 'timeR', label: 'Time R', min: 0.01, max: 2, default: 0.375, log: true, unit: 's' },
    { key: 'syncL', label: 'Sync L', min: 0, max: 1, default: 1, choices: ['ms', 'Sync'] },
    { key: 'syncR', label: 'Sync R', min: 0, max: 1, default: 1, choices: ['ms', 'Sync'] },
    { key: 'divL', label: 'Note L', min: 0, max: DELAY_DIVISIONS.length - 1, default: DELAY_DIV_QUARTER, choices: DELAY_DIVISIONS.map(d => d.label) },
    { key: 'divR', label: 'Note R', min: 0, max: DELAY_DIVISIONS.length - 1, default: DELAY_DIV_QUARTER, choices: DELAY_DIVISIONS.map(d => d.label) },
    { key: 'offsetL', label: 'Offset L', min: -DELAY_MAX_OFFSET, max: DELAY_MAX_OFFSET, default: 0, unit: '%' },
    { key: 'offsetR', label: 'Offset R', min: -DELAY_MAX_OFFSET, max: DELAY_MAX_OFFSET, default: 0, unit: '%' },
    { key: 'link', label: 'Link', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'pingpong', label: 'Ping Pong', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.35, unit: '%' },
    { key: 'freeze', label: 'Freeze', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
    { key: 'filterOn', label: 'Filter', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
    { key: 'filterFreq', label: 'Freq', min: 20, max: 20000, default: 1000, log: true, unit: 'Hz' },
    { key: 'filterWidth', label: 'Width', min: DELAY_MIN_WIDTH, max: DELAY_MAX_WIDTH, default: 6, unit: '' },
    { key: 'modRate', label: 'Rate', min: 0.01, max: 20, default: 0.5, log: true, unit: 'Hz' },
    { key: 'modTime', label: 'Mod time', min: 0, max: DELAY_MAX_MOD_MS, default: 0, unit: 'ms' },
    { key: 'modFilter', label: 'Mod filter', min: 0, max: 1, default: 0, unit: '%' },
    { key: 'transition', label: 'Transition', min: 0, max: 2, default: 0, choices: ['Repitch', 'Fade', 'Jump'] },
    { key: 'mix', label: 'Dry/Wet', min: 0, max: 1, default: 0.3, unit: '%' },
    // How Dry/Wet mixes: equal power (new delays) or linear, the 1.13 delay's, kept for its slots.
    { key: 'mixLaw', label: 'Mix law', min: 0, max: 1, default: 1, choices: ['Linear', 'Equal power'] },
  ] },
  // 1.19: after Ableton's Reverb. Decay, pre-delay, damping and mix keep their keys; size and
  // diffusion shape the impulse (deterministic per slot), the cuts and width are on the wet path.
  // `early` (the early reflections) is off for old slots (migrateReverbParams), so they sound as they did.
  reverb: { type: 'reverb', name: 'Reverb', blurb: 'A diffuse room to a long hall: early reflections, a tail, and cuts and width on the wet sound.', params: [
    { key: 'decay', label: 'Decay', min: 0.2, max: 10, default: 2.5, log: true, unit: 's', automatable: false },
    { key: 'predelay', label: 'Pre', min: 0, max: 0.2, default: 0.02, unit: 's' },
    { key: 'damping', label: 'Damp', min: 1000, max: 18000, default: 6000, log: true, unit: 'Hz', automatable: false },
    mix(0.3),
    { key: 'size', label: 'Size', min: 0.5, max: 3, default: 1, log: true, unit: 'x', automatable: false },
    { key: 'diffusion', label: 'Diffuse', min: 0, max: 1, default: 1, unit: '%', automatable: false },
    { key: 'width', label: 'Width', min: 0, max: 1, default: 1, unit: '%' },
    { key: 'lowCut', label: 'Low cut', min: REVERB_LOW_CUT_MIN, max: 2000, default: REVERB_LOW_CUT_MIN, log: true, unit: 'Hz' },
    { key: 'highCut', label: 'High cut', min: 1000, max: REVERB_HIGH_CUT_MAX, default: REVERB_HIGH_CUT_MAX, log: true, unit: 'Hz' },
    { key: 'early', label: 'Early', min: 0, max: 1, default: 1, choices: ['Off', 'On'] },
  ] },
  // 1.8: the Ducker's attack and release shape a curve (not automatable); the rest are AudioParams.
  ducker: { type: 'ducker', name: 'Ducker', blurb: 'Turns this track down while another track (the key) plays: sidechain pumping.', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, default: 0.6, unit: '%' },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.2, default: 0.005, log: true, unit: 's', automatable: false },
    { key: 'hold', label: 'Hold', min: 0, max: 0.5, default: 0.02, unit: 's' },
    { key: 'release', label: 'Release', min: 0.02, max: 1, default: 0.15, log: true, unit: 's', automatable: false },
  ] },
  limiter: { type: 'limiter', name: 'Limiter', blurb: 'A fast compressor followed by a hard clip at the ceiling: peaks never pass it.', params: [
    { key: 'gain', label: 'Gain', min: 0, max: 24, default: 0, unit: 'dB' },
    { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, default: -0.3, unit: 'dB' },
    { key: 'release', label: 'Release', min: 0.01, max: 1, default: 0.1, log: true, unit: 's' },
  ] },
  // 1.201: sample-rate and bit-depth reduction (the `cyber-bitcrusher` worklet, bitcrusherWorklet.ts;
  // before the processors are registered, a quantising WaveShaper for the bits only). Bits and
  // Rate are k-rate AudioParams on the worklet, so lanes drive them.
  bitcrusher: { type: 'bitcrusher', name: 'Bitcrusher', blurb: 'Fewer bits and a lower sample rate: the crunchy 8-bit and lo-fi sound.', params: [
    { key: 'bits', label: 'Bits', min: 1, max: 16, default: 8, unit: 'bit' },
    { key: 'rate', label: 'Rate', min: 200, max: 48000, default: 11025, log: true, unit: 'Hz' },
    mix(1),
  ] },
  utility: { type: 'utility', name: 'Utility', blurb: 'Gain, stereo width, mono.', params: [
    { key: 'gain', label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB' },
    { key: 'width', label: 'Width', min: 0, max: 2, default: 1, unit: '%' },
    { key: 'mono', label: 'Mono', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
  ] },
  cyberEq: cyberDef('cyberEq'),
  cyberComp: cyberDef('cyberComp'),
  cyberSat: cyberDef('cyberSat'),
  cyberLimit: cyberDef('cyberLimit'),
  scope: cyberDef('scope'),
  spectro3d: cyberDef('spectro3d'),
  // 1.374: the modulators. Nothing of theirs is automatable (no AudioParam: they move others').
  lfo: { type: 'lfo', name: 'LFO', group: 'Modulators', blurb: 'Moves up to eight parameters of its track up and down in a repeating shape, free or in time with the song.', params: [
    { key: 'shape', label: 'Shape', min: 0, max: LFO_SHAPES.length - 1, default: 0, choices: LFO_SHAPES },
    { key: 'sync', label: 'Sync', min: 0, max: 1, default: 1, choices: ['Free', 'Sync'] },
    { key: 'rate', label: 'Rate', min: 0.01, max: 40, default: 1, log: true, unit: 'Hz', automatable: false },
    { key: 'division', label: 'Time', min: 0, max: MOD_DIVISIONS.length - 1, default: 4, choices: MOD_DIVISIONS.map(d => d.label) },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 1, unit: '%', automatable: false },
    { key: 'phase', label: 'Phase', min: 0, max: 1, default: 0, unit: '%', automatable: false },
    { key: 'offset', label: 'Offset', min: -1, max: 1, default: 0, unit: '%', automatable: false },
  ] },
  shaper: { type: 'shaper', name: 'Shaper', group: 'Modulators', blurb: 'Moves up to eight parameters of its track along a shape you draw, in time with the song.', params: [
    { key: 'division', label: 'Time', min: 0, max: MOD_DIVISIONS.length - 1, default: 2, choices: MOD_DIVISIONS.map(d => d.label) },
    { key: 'smooth', label: 'Steps', min: 0, max: 1, default: 1, choices: ['Steps', 'Ramps'] },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 1, unit: '%', automatable: false },
    { key: 'phase', label: 'Phase', min: 0, max: 1, default: 0, unit: '%', automatable: false },
    ...Array.from({ length: SHAPER_STEPS }, (_, i): FxParamDef => ({ key: `s${i}`, label: `Step ${i + 1}`, min: -1, max: 1, default: Math.round(Math.sin((2 * Math.PI * i) / SHAPER_STEPS) * 100) / 100, automatable: false })),
  ] },
  // EST Phase 2: an installed plugin's parameters are its own (CLAP ids, `FxSlot.est.params`), none here.
  est: { type: 'est', name: 'EST plugin', blurb: 'An installed EST plugin.', params: [] },
});

// --- The EQ's bands (1.19), for the builder (eq.ts), the display and the card ----------------------

/** Web Audio's pass Q (dB) for a Butterworth section of Q `q`. */
const qDb = (q: number) => 20 * Math.log10(q);
export const PASS_Q_12 = qDb(Math.SQRT1_2);
export const PASS_Q_24: readonly [number, number] = [qDb(0.5412), qDb(1.3066)];

export const EQ_BANDS = [
  { n: 1, on: 'lowOn', gain: 'lowGain', freq: 'lowFreq', q: null, type: 'lowshelf' },
  { n: 2, on: 'midOn', gain: 'midGain', freq: 'midFreq', q: 'midQ', type: 'peaking' },
  { n: 3, on: 'mid2On', gain: 'mid2Gain', freq: 'mid2Freq', q: 'mid2Q', type: 'peaking' },
  { n: 4, on: 'highOn', gain: 'highGain', freq: 'highFreq', q: null, type: 'highshelf' },
] as const;
export type EqBand = (typeof EQ_BANDS)[number];

const EQ_ON_DEFAULTS: Record<string, number> = { lowOn: 1, midOn: 1, mid2On: 0, highOn: 1, hpOn: 0, lpOn: 0 };
/** Whether an EQ band or pass is on (a missing key reads as its default: bands 1, 2 and 4 on). */
export const bandOn = (s: Pick<FxSlot, 'params'>, key: string) => (s.params[key] ?? EQ_ON_DEFAULTS[key] ?? 0) === 1;

export interface FxSlot {
  id: string;
  type: FxType;
  on: boolean;
  params: Record<string, number>;
  /**
   * A Ducker's key (1.8), or a Compressor's sidechain (1.19; 1.55 the Cyber Comp's): the track or
   * (1.55) return whose post-fader sound turns this one down; null: none (a Compressor then listens
   * to its own input). A Cyber Comp with no key has no field (absent, as before 1.55).
   */
  keyTrackId?: string | null;
  /** 1.374: a modulator's (`'lfo'`, `'shaper'`) targets (absent: none mapped yet; on no other type). */
  mod?: ModTarget[];
  /**
   * EST Phase 2: an `'est'` slot's plugin (its reference, cached parameter values and state), kept
   * through `sanitiseEstBlock`; absent on every other type. Written only by the store's
   * `addEstInsert`, `setEstParams` and `setEstState`.
   */
  est?: EstSlotBlock;
}
export const MAX_FX = 6;

/** The effect types keyed from another track or (1.55) a return: 1.8 the Ducker, 1.19 the Compressor's sidechain, 1.55 the Cyber Comp's. */
export const takesKey = (type: FxType) => type === 'ducker' || type === 'compressor' || type === 'cyberComp';
/**
 * EST 1.1 (1.327, DEV-H): a slot that takes a key: a keyed type, or an `'est'` slot whose plugin has a
 * sidechain input and was given one (`keyTrackId`, written through `setStripFx` by the card's
 * Key menu, which `EstCard` shows only for such a plugin). Every routing reader asks this, so an EST
 * key goes through the same loop rule (`routing.ts`'s `addKeyEdges`) as the Compressor's.
 */
export const slotTakesKey = (f: Pick<FxSlot, 'type' | 'keyTrackId'>) => takesKey(f.type) || (f.type === 'est' && typeof f.keyTrackId === 'string');

let fxCounter = 0;
export function newFxId(): string {
  fxCounter = (fxCounter + 1) % 1e6;
  return `fx${Date.now().toString(36).slice(-4)}${fxCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** The slot's parameters at its type's defaults (an `'est'` slot has none here: see `estSlotFor`). */
export function defaultFx(type: FxType, id = newFxId()): FxSlot {
  return { id, type, on: true, params: Object.fromEntries(FX_DEFS[type].params.map(p => [p.key, p.default])) };
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/**
 * One effect from anything (projects, live sessions): known type, every parameter in range. An
 * unknown type is dropped, which is how old data's removed `wam` inserts (1.8–1.30) go (1.31).
 */
export function sanitiseFx(raw: unknown): FxSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (typeof r.type !== 'string' || !(FX_TYPES as readonly string[]).includes(r.type)) return null;
  // EST Phase 2: an EST slot is kept, its plugin unknown here or not (a missing-plugin placeholder,
  // D-10), while its block is usable; one whose block is not is dropped. No fixed parameters.
  if (r.type === 'est') {
    const est = sanitiseEstBlock(r.est);
    if (!est) return null;
    const slot: FxSlot = { id: r.id, type: 'est', on: r.on !== false, params: {}, est };
    // EST 1.1 (1.327): a sidechain key, kept only when it names one (absent as before 1.327).
    if (typeof r.keyTrackId === 'string' && ID_RE.test(r.keyTrackId)) slot.keyTrackId = r.keyTrackId;
    return slot;
  }
  const def = FX_DEFS[r.type as FxType];
  let ps = r.params && typeof r.params === 'object' ? r.params as Record<string, unknown> : {};
  if (def.type === 'delay') ps = migrateDelayParams(ps);
  else if (def.type === 'compressor') ps = migrateCompressorParams(ps);
  else if (def.type === 'reverb') ps = migrateReverbParams(ps);
  const params: Record<string, number> = {};
  for (const p of def.params) {
    const v = ps[p.key];
    let n = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
    if (p.choices) n = Math.round(n);
    params[p.key] = n;
  }
  const slot: FxSlot = { id: r.id, type: def.type, on: r.on !== false, params };
  // 1.374: a modulator's targets, kept only when it has some.
  if (isModulatorType(def.type)) { const mod = sanitiseModTargets(r.mod); if (mod.length) slot.mod = mod; }
  const key = typeof r.keyTrackId === 'string' && ID_RE.test(r.keyTrackId) ? r.keyTrackId : null;
  // 1.55: the Cyber Comp's key is written only when it has one, so its slots from before stay as they were.
  if (def.type === 'cyberComp') { if (key) slot.keyTrackId = key; }
  else if (takesKey(def.type)) slot.keyTrackId = key;
  return slot;
}

/** A strip's effects: valid, unique ids, at most MAX_FX. */
export function sanitiseFxList(raw: unknown): FxSlot[] {
  const out: FxSlot[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_FX) break;
    const f = sanitiseFx(r);
    if (f && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  }
  return out;
}

/** The 1.13 delay's synced divisions, in beats (index 0 is Free): its `sync` key. */
export const DELAY_SYNC_BEATS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];

/**
 * A 1.13 delay's parameters as the 1.14 delay's (it had `sync`, `tone` and no `syncL`): the same
 * time on both sides, linked; its synced division; its loop low-pass `tone` as the filter, the
 * low-pass at `tone` and the high-pass ten octaves (or the width's most) below it, out of hearing;
 * its linear dry/wet; Repitch. Anything else passes through.
 */
export function migrateDelayParams(ps: Record<string, unknown>): Record<string, unknown> {
  if ('syncL' in ps || !('sync' in ps || 'tone' in ps)) return ps;
  const num = (k: string, d: number) => (typeof ps[k] === 'number' && Number.isFinite(ps[k]) ? ps[k] as number : d);
  const sync = Math.round(num('sync', 4));
  const beats = DELAY_SYNC_BEATS[sync] ?? 0;
  const div = DELAY_DIVISIONS.findIndex(d => Math.abs(d.beats - beats) < 1e-9);
  const tone = Math.min(16000, Math.max(500, num('tone', 6000)));
  const freq = Math.max(20, tone / Math.pow(2, DELAY_MAX_WIDTH / 2));
  const width = Math.min(DELAY_MAX_WIDTH, 2 * Math.log2(tone / freq));
  const time = num('time', 0.375);
  const out: Record<string, unknown> = {
    ...ps,
    syncL: beats > 0 ? 1 : 0, syncR: beats > 0 ? 1 : 0,
    divL: div >= 0 ? div : DELAY_DIV_QUARTER, divR: div >= 0 ? div : DELAY_DIV_QUARTER,
    offsetL: 0, offsetR: 0, time, timeR: time, link: 1,
    freeze: 0, filterOn: 1, filterFreq: freq, filterWidth: width,
    modRate: 0.5, modTime: 0, modFilter: 0, transition: 0, mixLaw: 0,
  };
  delete out.sync; delete out.tone;
  return out;
}

/** The 1.13 delay's `tone` range (Hz, log), for its old lanes. */
export const DELAY_OLD_TONE: readonly [number, number] = [500, 16000];

/**
 * 1.62: an old `tone` lane's value (0…1 over the 1.13 tone's log range) as a lane value on the
 * filter's `filterFreq` (0…1 over 20 Hz…20 kHz, log), for a delay whose filter is `width` octaves
 * wide: the centre a half width below the tone, so the low-pass sits on the tone, as the slot's own
 * tone was moved over (migrateDelayParams). Both ranges are logarithmic, so the map is a straight
 * line and a lane's shape between points is kept; only a tone below the lowest centre (20 Hz) is
 * held there (its low-pass then a little above the old tone).
 */
export function delayToneLaneValue(u: number, width: number): number {
  const [tMin, tMax] = DELAY_OLD_TONE;
  const f = FX_DEFS.delay.params.find(p => p.key === 'filterFreq')!;
  const tone = tMin * Math.pow(tMax / tMin, Math.min(1, Math.max(0, u)));
  const freq = tone / Math.pow(2, Math.min(DELAY_MAX_WIDTH, Math.max(DELAY_MIN_WIDTH, width)) / 2);
  const n = Math.log(freq / f.min) / Math.log(f.max / f.min);
  return Math.min(1, Math.max(0, n));
}

/**
 * A 1.18 compressor's parameters as the 1.19 compressor's (it had no `detect`): it keeps the
 * browser's own makeup gain (Auto makeup on) and the 6 ms the browser's compressor delayed its
 * sound by (lookahead 6 ms), so it sounds as it did, now without comb filtering at a part mix.
 * Peak detection, no key filter, its ratio as it was. A key it has (a hand-written slot) is kept.
 */
export function migrateCompressorParams(ps: Record<string, unknown>): Record<string, unknown> {
  if ('detect' in ps) return ps;
  return { detect: 0, autoMakeup: 1, lookahead: COMP_LEGACY_LOOKAHEAD_MS, ratioInf: 0, keyHp: COMP_KEY_HP_MIN, ...ps };
}
/** The pre-delay the browser's compressor puts on its own sound (Chromium and Firefox: 6 ms). */
export const COMP_LEGACY_LOOKAHEAD_MS = 6;

/**
 * A 1.18 reverb's parameters as the 1.19 reverb's (it had no `size`): no early reflections, so its
 * impulse is the one it had (the same tail from the same seed); size 1, full diffusion and width,
 * the cuts open. A key it has (a hand-written slot) is kept.
 */
export function migrateReverbParams(ps: Record<string, unknown>): Record<string, unknown> {
  if ('size' in ps) return ps;
  return { size: 1, diffusion: 1, width: 1, lowCut: REVERB_LOW_CUT_MIN, highCut: REVERB_HIGH_CUT_MAX, early: 0, ...ps };
}
