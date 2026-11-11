/**
 * The SYNTH page's data model (Cyber_Synth_Work_Order.md §6): a Model D-style subtractive
 * patch and the arpeggiator. Since 1.4 the patches live on the SEQUENCER's synth tracks and the
 * tempo on its transport (Cyber_Sequencer_Work_Order.md §5.1); `SynthState` is the arpeggiator. Every numeric
 * range lives once, in SYNTH_PARAMS: the knobs, the sanitiser and the tests all read it.
 */

export type OscWave = 'triangle' | 'sawtooth' | 'square' | 'pulse' | 'pwm';
export const OSC_WAVES: readonly OscWave[] = ['triangle', 'sawtooth', 'square', 'pulse', 'pwm'];
export type LfoWave = 'triangle' | 'square' | 'sawtooth' | 'sampleHold';
export const LFO_WAVES: readonly LfoWave[] = ['triangle', 'square', 'sawtooth', 'sampleHold'];
export type NoiseColor = 'white' | 'pink';
export type VoiceMode = 'mono' | 'poly';
/** Note divisions for the LFO, the arpeggiator and the SEQUENCER's grid. */
export type Division = '1/1' | '1/2' | '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T' | '1/32';
export const DIVISIONS: readonly Division[] = ['1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
export const ARP_RATES: readonly Division[] = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
export type ArpMode = 'up' | 'down' | 'upDown' | 'random' | 'asPlayed';
export const ARP_MODES: readonly ArpMode[] = ['up', 'down', 'upDown', 'random', 'asPlayed'];
/** Moog footages, as octaves from 8'. */
export const RANGES = [-2, -1, 0, 1, 2] as const;
export const RANGE_LABELS: Record<number, string> = { [-2]: "32'", [-1]: "16'", 0: "8'", 1: "4'", 2: "2'" };

export interface Osc {
  wave: OscWave;
  /** Octaves from 8' (−2 = 32', +2 = 2'). */
  range: number;
  semi: number;
  /** Cents. */
  fine: number;
  level: number;
  on: boolean;
  /** Pulse width for 'pulse' and 'pwm'. */
  pw: number;
  /** Oscillator 2 only: hard-sync to oscillator 1. */
  sync: boolean;
  /** Oscillator 3 only: follows the keyboard (off: a fixed pitch, for drones). */
  kbd: boolean;
}

export interface Adsr { attack: number; decay: number; sustain: number; release: number }

export interface SynthPatch {
  version: 1;
  osc: [Osc, Osc, Osc];
  noise: { level: number; color: NoiseColor };
  /** Into the filter, soft-clipped. */
  drive: number;
  filter: { cutoff: number; resonance: number; envAmount: number; keyTrack: number; lfoAmount: number };
  filterEnv: Adsr;
  ampEnv: Adsr;
  velToAmp: number;
  velToFilter: number;
  lfo: { wave: LfoWave; rate: number; sync: boolean; division: Division; toPitch: number; toPw: number; toAmp: number };
  voice: { mode: VoiceMode; glide: number; retrig: boolean; drift: number; voices: number };
  volume: number;
  stereoSpread: number;
  bendRange: number;
  /**
   * The four macros (1.19): each knob turns its targets together. A target's `min` and `max` are
   * offsets along the target knob's travel (−1…1 of its whole arc, so a log knob moves evenly):
   * at amount 0 the macro adds `min`, at 1 `max`. They are summed onto the knob's own value and
   * clamped to the parameter's range on the page (`compileAnalogPatch` in macros.ts), so the
   * processor only ever sees ordinary patch values.
   */
  macros: [Macro, Macro, Macro, Macro];
}

/** One parameter a macro moves: offsets along its knob's travel at macro 0 and at macro 1. */
export interface MacroTarget { param: string; min: number; max: number }
export interface Macro { name: string; amount: number; targets: MacroTarget[] }
export const MACRO_COUNT = 4;
/** Targets per macro. */
export const MAX_MACRO_TARGETS = 8;
export const MACRO_NAME_MAX = 16;

export interface ArpState { on: boolean; mode: ArpMode; rate: Division; gate: number; octaves: number; hold: boolean }

/**
 * The SYNTH page's state in snapshots from before 1.19: the arpeggiator, which now lives on each
 * synth track (`SynthTrack.arp`). Read only to migrate an older snapshot; new ones leave it out.
 */
export interface SynthState {
  arp: ArpState;
}

/**
 * The computer keyboard's octave shift and velocity: UI state, kept out of the session (so
 * pressing Z is not an undo step and is not shared in live sessions).
 */
export interface SynthKeys { octave: number; velocity: number }
export const VELOCITY_STEPS = [16, 32, 48, 64, 80, 100, 112, 127] as const;

export const MAX_VOICES = 8;

// --- The parameter table -----------------------------------------------------------------

export interface SynthParam {
  /** Dotted path into SynthPatch, e.g. 'filter.cutoff' or 'osc.1.fine'. */
  path: string;
  min: number;
  max: number;
  default: number;
  label: string;
  unit?: string;
  /** Logarithmic knob. */
  log?: boolean;
  /** Bipolar knob (centre is zero). */
  bipolar?: boolean;
  /** Whole numbers only. */
  int?: boolean;
}

const OSC_DEFAULTS = [
  { wave: 'sawtooth', level: 1, fine: 0, on: true },
  { wave: 'sawtooth', level: 0.8, fine: 7, on: true },
  { wave: 'square', level: 0, fine: -5, on: false },
] as const;

function oscParams(i: number): SynthParam[] {
  const d = OSC_DEFAULTS[i]!;
  return [
    { path: `osc.${i}.range`, min: -2, max: 2, default: 0, label: 'Range', int: true },
    { path: `osc.${i}.semi`, min: -12, max: 12, default: 0, label: 'Semi', unit: 'st', int: true, bipolar: true },
    { path: `osc.${i}.fine`, min: -100, max: 100, default: d.fine, label: 'Fine', unit: 'ct', bipolar: true },
    { path: `osc.${i}.level`, min: 0, max: 1, default: d.level, label: 'Level' },
    { path: `osc.${i}.pw`, min: 0.05, max: 0.95, default: 0.5, label: 'Width' },
  ];
}

function adsrParams(prefix: 'filterEnv' | 'ampEnv', d: Adsr): SynthParam[] {
  return [
    { path: `${prefix}.attack`, min: 0.001, max: 10, default: d.attack, label: 'Attack', unit: 's', log: true },
    { path: `${prefix}.decay`, min: 0.001, max: 10, default: d.decay, label: 'Decay', unit: 's', log: true },
    { path: `${prefix}.sustain`, min: 0, max: 1, default: d.sustain, label: 'Sustain' },
    { path: `${prefix}.release`, min: 0.001, max: 10, default: d.release, label: 'Release', unit: 's', log: true },
  ];
}

/** Every numeric patch parameter: its path, range and default. */
export const SYNTH_PARAMS: readonly SynthParam[] = Object.freeze([
  ...oscParams(0), ...oscParams(1), ...oscParams(2),
  { path: 'noise.level', min: 0, max: 1, default: 0, label: 'Noise' },
  { path: 'drive', min: 0, max: 1, default: 0.1, label: 'Drive' },
  { path: 'filter.cutoff', min: 20, max: 20000, default: 1200, label: 'Cutoff', unit: 'Hz', log: true },
  { path: 'filter.resonance', min: 0, max: 1, default: 0.2, label: 'Emphasis' },
  { path: 'filter.envAmount', min: -1, max: 1, default: 0.5, label: 'Env amount', bipolar: true },
  { path: 'filter.keyTrack', min: 0, max: 1, default: 0.5, label: 'Key track' },
  { path: 'filter.lfoAmount', min: 0, max: 1, default: 0, label: 'LFO' },
  ...adsrParams('filterEnv', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3 }),
  ...adsrParams('ampEnv', { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.25 }),
  { path: 'velToAmp', min: 0, max: 1, default: 0.5, label: 'Vel → amp' },
  { path: 'velToFilter', min: 0, max: 1, default: 0.3, label: 'Vel → filter' },
  { path: 'lfo.rate', min: 0.05, max: 30, default: 5, label: 'Rate', unit: 'Hz', log: true },
  { path: 'lfo.toPitch', min: 0, max: 1, default: 0, label: 'Pitch' },
  { path: 'lfo.toPw', min: 0, max: 1, default: 0, label: 'Width' },
  { path: 'lfo.toAmp', min: 0, max: 1, default: 0, label: 'Amp' },
  { path: 'voice.glide', min: 0, max: 2, default: 0, label: 'Glide', unit: 's' },
  { path: 'voice.drift', min: 0, max: 1, default: 0.2, label: 'Drift' },
  { path: 'voice.voices', min: 2, max: MAX_VOICES, default: MAX_VOICES, label: 'Voices', int: true },
  { path: 'volume', min: 0, max: 1, default: 0.7, label: 'Volume' },
  { path: 'stereoSpread', min: 0, max: 1, default: 0.3, label: 'Spread' },
  { path: 'bendRange', min: 0, max: 12, default: 2, label: 'Bend', unit: 'st', int: true },
]);

const PARAM_BY_PATH = new Map(SYNTH_PARAMS.map(p => [p.path, p]));

/**
 * The parameters a macro can move (1.19): every continuous one; not the whole-number ones
 * (ranges, semitones, voices, bend) or the key-tracking switch.
 */
export const MACRO_PARAMS: readonly string[] = Object.freeze(SYNTH_PARAMS.filter(p => !p.int && p.path !== 'filter.keyTrack').map(p => p.path));
const MACRO_PARAM_SET = new Set(MACRO_PARAMS);
export const isMacroParam = (path: string) => MACRO_PARAM_SET.has(path);
export function synthParam(path: string): SynthParam {
  const p = PARAM_BY_PATH.get(path);
  if (!p) throw new Error(`unknown synth parameter ${path}`);
  return p;
}

/** Read a dotted path from an object. */
export function getPath(obj: unknown, path: string): unknown {
  let o: unknown = obj;
  for (const k of path.split('.')) {
    if (o === null || typeof o !== 'object') return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

/** A copy of `obj` with `path` set to `value` (arrays stay arrays). */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = obj as unknown as Record<string, unknown>;
  const copy = (Array.isArray(obj) ? [...obj] : { ...src }) as Record<string, unknown>;
  copy[head!] = rest.length ? setPath(src[head!], rest.join('.'), value) : value;
  return copy as unknown as T;
}

/** A value clamped to a parameter's range (rounded when it is whole-number). */
export function clampParam(p: SynthParam, v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
  const c = Math.min(p.max, Math.max(p.min, n));
  return p.int ? Math.round(c) : c;
}

// --- Defaults ------------------------------------------------------------------------------

function defaultOsc(i: number): Osc {
  const d = OSC_DEFAULTS[i]!;
  return { wave: d.wave, range: 0, semi: 0, fine: d.fine, level: d.level, on: d.on, pw: 0.5, sync: false, kbd: true };
}

/** The Init patch. */
export function defaultSynthPatch(): SynthPatch {
  const patch: SynthPatch = {
    version: 1,
    osc: [defaultOsc(0), defaultOsc(1), defaultOsc(2)],
    noise: { level: 0, color: 'white' },
    drive: 0,
    filter: { cutoff: 0, resonance: 0, envAmount: 0, keyTrack: 0, lfoAmount: 0 },
    filterEnv: { attack: 0, decay: 0, sustain: 0, release: 0 },
    ampEnv: { attack: 0, decay: 0, sustain: 0, release: 0 },
    velToAmp: 0,
    velToFilter: 0,
    lfo: { wave: 'triangle', rate: 0, sync: false, division: '1/8', toPitch: 0, toPw: 0, toAmp: 0 },
    voice: { mode: 'mono', glide: 0, retrig: false, drift: 0, voices: MAX_VOICES },
    volume: 0,
    stereoSpread: 0,
    bendRange: 0,
    macros: defaultMacros(),
  };
  let out = patch;
  for (const p of SYNTH_PARAMS) out = setPath(out, p.path, p.default);
  return out;
}

/** An unmapped macro. */
export function emptyMacro(i: number): Macro {
  return { name: `Macro ${i + 1}`, amount: 0, targets: [] };
}

/**
 * Init's macros (and those of a patch from before 1.19): Cutoff, Resonance, Env amount and Drive,
 * each opening its knob by half its travel. At amount 0 they add nothing, so an older patch
 * sounds as it did.
 *
 * 1.63: where Init's knob sits past the middle, its macro opens it by the room left (rounded to
 * 0.01, the factory presets' rule in `macrosFor`), so the macro's top is the knob's top: Cutoff
 * from 1200 Hz by 0.41 of the log knob, Env amount from 0.5 by 0.25. Half the travel overshot
 * both, and the last part of the macro moved nothing. Resonance and Drive keep half.
 */
export const INIT_MACRO_MAX = { cutoff: 0.41, envAmount: 0.25, half: 0.5 } as const;
export function defaultMacros(): SynthPatch['macros'] {
  const m = (name: string, param: string, max: number): Macro => ({ name, amount: 0, targets: [{ param, min: 0, max }] });
  return [
    m('Cutoff', 'filter.cutoff', INIT_MACRO_MAX.cutoff),
    m('Resonance', 'filter.resonance', INIT_MACRO_MAX.half),
    m('Env amount', 'filter.envAmount', INIT_MACRO_MAX.envAmount),
    m('Drive', 'drive', INIT_MACRO_MAX.half),
  ];
}

export function defaultArpState(): ArpState {
  return { on: false, mode: 'up', rate: '1/16', gate: 0.6, octaves: 1, hold: false };
}

export function defaultSynthState(): SynthState {
  return { arp: defaultArpState() };
}

// --- Sanitising (projects, presets and live sessions are untrusted) --------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, min: number, max: number, d: number, int = false) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
  return int ? Math.round(n) : n;
};

/** A patch with every field present and in range; unknown fields dropped. */
export function sanitiseSynthPatch(raw: unknown): SynthPatch {
  const d = defaultSynthPatch();
  const r = isObj(raw) ? raw : {};
  let out: SynthPatch = d;
  for (const p of SYNTH_PARAMS) out = setPath(out, p.path, clampParam(p, getPath(r, p.path)));
  const rOsc = Array.isArray(r.osc) ? r.osc : [];
  out.osc = out.osc.map((o, i) => {
    const ro = isObj(rOsc[i]) ? rOsc[i] as Record<string, unknown> : {};
    return { ...o, wave: oneOf(ro.wave, OSC_WAVES, d.osc[i]!.wave), on: bool(ro.on, d.osc[i]!.on), sync: bool(ro.sync, false), kbd: bool(ro.kbd, true) };
  }) as SynthPatch['osc'];
  const noise = isObj(r.noise) ? r.noise : {};
  out.noise = { ...out.noise, color: oneOf(noise.color, ['white', 'pink'] as const, 'white') };
  const lfo = isObj(r.lfo) ? r.lfo : {};
  out.lfo = { ...out.lfo, wave: oneOf(lfo.wave, LFO_WAVES, 'triangle'), sync: bool(lfo.sync, false), division: oneOf(lfo.division, DIVISIONS, '1/8') };
  const voice = isObj(r.voice) ? r.voice : {};
  out.voice = { ...out.voice, mode: oneOf(voice.mode, ['mono', 'poly'] as const, 'mono'), retrig: bool(voice.retrig, false) };
  // Key tracking is a three-way switch.
  out.filter = { ...out.filter, keyTrack: [0, 0.5, 1].reduce((best, v) => (Math.abs(v - out.filter.keyTrack) < Math.abs(best - out.filter.keyTrack) ? v : best), 0.5) };
  out.macros = sanitiseMacros(r.macros);
  out.version = 1;
  return out;
}

const offset = (v: unknown, d: number) => Math.round(num(v, -1, 1, d) * 1000) / 1000;

/** The four macros; a patch from before 1.19 (no `macros`) gets Init's. */
export function sanitiseMacros(raw: unknown): SynthPatch['macros'] {
  if (!Array.isArray(raw)) return defaultMacros();
  return Array.from({ length: MACRO_COUNT }, (_, i) => {
    const m = isObj(raw[i]) ? raw[i] as Record<string, unknown> : {};
    const name = typeof m.name === 'string' ? [...m.name].filter(c => c >= ' ').join('').trim().slice(0, MACRO_NAME_MAX) : '';
    const seen = new Set<string>();
    const targets: MacroTarget[] = [];
    for (const t of Array.isArray(m.targets) ? m.targets : []) {
      if (!isObj(t) || typeof t.param !== 'string' || !isMacroParam(t.param) || seen.has(t.param)) continue;
      seen.add(t.param);
      targets.push({ param: t.param, min: offset(t.min, 0), max: offset(t.max, 0.5) });
      if (targets.length >= MAX_MACRO_TARGETS) break;
    }
    return { name: name || `Macro ${i + 1}`, amount: num(m.amount, 0, 1, 0), targets };
  }) as SynthPatch['macros'];
}

/** An arpeggiator with every field present and in range (a synth track's, 1.19). */
export function sanitiseArp(raw: unknown): ArpState {
  const arp = isObj(raw) ? raw : {};
  return {
    on: bool(arp.on, false),
    mode: oneOf(arp.mode, ARP_MODES, 'up'),
    rate: oneOf(arp.rate, ARP_RATES, '1/16'),
    gate: num(arp.gate, 0.1, 1, 0.6),
    octaves: num(arp.octaves, 1, 4, 1, true),
    hold: bool(arp.hold, false),
  };
}

/** A pre-1.19 snapshot's SYNTH state (the arpeggiator) with every field present and in range. */
export function sanitiseSynthState(raw: unknown): SynthState {
  const r = isObj(raw) ? raw : {};
  return { arp: sanitiseArp(r.arp) };
}

/** Beats (quarter notes) per division. */
export function divisionBeats(d: Division): number {
  switch (d) {
    case '1/1': return 4;
    case '1/2': return 2;
    case '1/4': return 1;
    case '1/8': return 0.5;
    case '1/8T': return 1 / 3;
    case '1/16': return 0.25;
    case '1/16T': return 1 / 6;
    case '1/32': return 0.125;
  }
}

/** A MIDI note's name, e.g. 60 → 'C4'. */
export function noteName(n: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
