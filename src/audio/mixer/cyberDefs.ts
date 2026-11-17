import type { DynamicsParams, EQBand, EQBandType, EQParams, MaximizerParams, SaturationParams } from '../types';
import { defaultDynamicsParams, defaultEqParams, defaultMaximizerParams, defaultSaturationParams } from '../defaults';
import type { FxParamDef } from './fxDefs';

/**
 * The Cyber inserts (1.33, Cyber_Pages_And_Inserts_Work_Order.md §2 "Insert versions of the MASTER
 * effects"), described: the MASTER chain's EQ, Compressor, Saturation and Limiter, and the
 * Vectorscope (and, 1.132, the 3D Spectrogram), as insert types on any track, group or return. Data only (the model, the store and
 * the UI read it; the builders are in cyberInserts.ts, loaded with the mixer).
 *
 * A slot's parameters are flat numbers like every insert's (`FxSlot.params`), so the sanitiser,
 * the live session and automation treat them as the others; the converters below turn them into
 * the MASTER modules' params (`EQParams`, `DynamicsParams`, …) and back, for the builders and the
 * windows. The ranges are the MASTER controls' and the worklets' own.
 *
 * **Names and makers live here only** (`CYBER_NAMES`): the owner will rename them later.
 */

export const CYBER_TYPES = ['cyberEq', 'cyberComp', 'cyberSat', 'cyberLimit', 'scope', 'spectro3d'] as const;
export type CyberType = (typeof CYBER_TYPES)[number];
export const isCyberType = (t: string): t is CyberType => (CYBER_TYPES as readonly string[]).includes(t);

/** The display name, the maker and the add menu's tooltip of each Cyber insert. */
export const CYBER_NAMES: Readonly<Record<CyberType, { name: string; vendor: string; blurb: string }>> = Object.freeze({
  cyberEq: { name: 'Cyber EQ', vendor: 'Cyber', blurb: 'MASTER\'s eight-band Equalizer as an insert, with its spectrum: opens in its own window.' },
  cyberComp: { name: 'Cyber Comp', vendor: 'Cyber', blurb: 'MASTER\'s Compressor as an insert, with its scope and gain reduction: opens in its own window.' },
  cyberSat: { name: 'Cyber Saturator', vendor: 'Cyber', blurb: 'MASTER\'s Saturation (odd and even harmonics, tone) as an insert: opens in its own window.' },
  cyberLimit: { name: 'Cyber Limiter', vendor: 'Cyber', blurb: 'MASTER\'s look-ahead Limiter as an insert, with its scope: opens in its own window.' },
  scope: { name: 'Cyber Scope', vendor: 'Cyber', blurb: 'A Vectorscope of the sound at this point: passes it through untouched; opens in its own window.' },
  spectro3d: { name: 'Cyber 3D Spectrogram', vendor: 'Cyber', blurb: 'A real-time 3D spectrogram of the sound at this point: passes it through untouched; opens in its own window.' },
});

// --- The Limiter's choices in words (1.715; `limiterStyles.ts` re-exports them for the window and the tests: kept here, already in the App chunk's closure, so it gains no file) ---

/** The styles, by their `style` value. 0 is the Limiter of every project saved before 1.715. */
export const LIMITER_STYLES = ['Legacy', 'Transparent', 'Punchy', 'Aggressive', 'Bus', 'Safe'] as const;

/** A new Limiter's style. */
export const NEW_LIMITER_STYLE = 1;
export const LEGACY_LIMITER_STYLE = 0;

/** One line each, for the picker's title and the manual. */
export const LIMITER_STYLE_BLURBS: readonly string[] = [
  'The Limiter from before 1.715: a 2 ms look-ahead and a sample-peak ceiling. Projects made with it keep it.',
  'Clean and open: the full attack, a hold that keeps bass steady and Auto release that follows the music.',
  'Lets the front of each hit through a little more, with a quicker release: drums keep their snap.',
  'Fast and dense: a short attack and release for the loudest masters. Some distortion is part of it.',
  'Gentle glue for groups and buses: a soft knee 4 dB below the ceiling and a slow release.',
  'Never over the ceiling: at least 4× true-peak detection, a small margin and a careful release.',
];

/** The true-peak oversampling choices, by their `oversample` value. */
export const LIMITER_OVERSAMPLE = ['Off', '2×', '4×', '8×'] as const;

/** A loudness target the meter shows: from the Export dialog's presets (`loudnessPresets.ts`). */
export interface LimiterTarget { id: string; label: string; lufs: number | null; truePeakDb: number | null }

/**
 * The targets, by their `target` value: none, then every Export preset with figures, in its order
 * (`loudnessPresets.ts`' `LOUDNESS_PRESETS`; written here so the App chunk's closure gains no file:
 * `limiterCore.test.ts` holds the two lists equal).
 */
export const LIMITER_TARGETS: readonly LimiterTarget[] = [
  { id: 'none', label: 'No target', lufs: null, truePeakDb: null },
  { id: 'spotify', label: 'Spotify / YouTube', lufs: -14, truePeakDb: -1 },
  { id: 'apple', label: 'Apple Music', lufs: -16, truePeakDb: -1 },
  { id: 'amazon', label: 'Amazon', lufs: -14, truePeakDb: -2 },
  { id: 'tidal', label: 'Tidal', lufs: -14, truePeakDb: -1 },
  { id: 'broadcast', label: 'Broadcast (EBU R128)', lufs: -23, truePeakDb: -1 },
  { id: 'podcast', label: 'Podcast', lufs: -16, truePeakDb: -1 },
  { id: 'club', label: 'Club / CD', lufs: -9, truePeakDb: -0.3 },
];

/** Whether a saved Limiter plays the Legacy processor (no `style`, or 0). */
export const isLegacyLimiter = (style: number | undefined): boolean => !(typeof style === 'number' && Math.round(style) >= 1);

// --- Cyber EQ: eight bands, as MASTER's -----------------------------------------------------------

/**
 * A band's type as a choice index (a slot holds numbers). 1.716: Band-pass and Tilt appended (Matched
 * only), so every older index is as it was.
 */
export const EQ_BAND_TYPES: readonly EQBandType[] = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass', 'notch', 'bandpass', 'tiltshelf'];
const EQ_TYPE_LABELS = ['High-pass', 'Low shelf', 'Bell', 'High shelf', 'Low-pass', 'Notch', 'Band-pass', 'Tilt'];
/** 1.716: the types a Classic EQ offers (Web Audio's biquads): the first six. */
export const EQ_CLASSIC_TYPE_COUNT = 6;
/** 1.716: a high- or low-pass band's slopes (Matched), as their choice labels. */
export const EQ_SLOPE_LABELS: readonly string[] = [6, 12, 18, 24, 36, 48].map(d => `${d} dB/oct`);
/** 1.716: where a Matched band works, as their choice labels. */
export const EQ_PLACE_LABELS: readonly string[] = ['Stereo', 'Mid', 'Side', 'Left', 'Right'];
/**
 * 1.716: the Saturator's styles, as their choice labels. These lists are kept here, not imported
 * from eqDesign.ts and saturatorStyles.ts, so the App chunk (which holds this file) gains no chunk;
 * cyberMigrate1716.test.ts holds each equal to the DSP's own.
 */
export const SAT_STYLE_LABELS: readonly string[] = ['Classic', 'Tape', 'Tube', 'Clip', 'Fold'];
export const CYBER_EQ_BANDS = 8;
/** The MASTER EQ's ranges (EqCanvas's FREQ_MIN/MAX and GAIN_RANGE, the Q slider's 0.1–18). */
export const CYBER_EQ_FREQ: readonly [number, number] = [20, 20000];
export const CYBER_EQ_GAIN = 18;
export const CYBER_EQ_Q: readonly [number, number] = [0.1, 18];

const bandKey = (n: number, k: 'Type' | 'Freq' | 'Gain' | 'Q' | 'On' | 'Slope' | 'Place') => `b${n}${k}`;
type BandField = 'type' | 'freq' | 'gain' | 'q' | 'enabled' | 'slope' | 'place';
/** A band's parameter key from its MASTER id ('b3') and field. */
export function eqBandKey(id: string, field: BandField): string | null {
  const m = /^b([1-8])$/.exec(id);
  if (!m) return null;
  const k = ({ type: 'Type', freq: 'Freq', gain: 'Gain', q: 'Q', enabled: 'On', slope: 'Slope', place: 'Place' } as const)[field];
  return bandKey(Number(m[1]), k);
}

/**
 * 1.716: the Cyber EQ's mode key. Matched (1) is a new slot's; a slot saved before 1.716 has no
 * `mode` and is given Classic (0) by `migrateCyberParams`, so it sounds as it did. Values without
 * the key at all (the Editor's chain, through `useMasterEdit`) are Classic too, and its window then
 * shows none of Matched's controls (`eqHasModes`).
 */
export const EQ_MODE_KEY = 'mode';
/** Whether a window's values are a Cyber EQ slot's, with Matched's controls (the Editor's chain has none). */
export const eqHasModes = (values: Readonly<Record<string, number>>): boolean => EQ_MODE_KEY in values;

function eqParamDefs(): FxParamDef[] {
  const base = defaultEqParams().bands;
  const out: FxParamDef[] = [
    // 1.716: Classic (Web Audio's biquads, every EQ before) or Matched (the analog shape to Nyquist). A new slot is Matched.
    { key: EQ_MODE_KEY, label: 'Mode', min: 0, max: 1, default: 1, choices: ['Classic', 'Matched'] },
  ];
  for (let n = 1; n <= CYBER_EQ_BANDS; n++) {
    const d = base[n - 1]!;
    out.push(
      { key: bandKey(n, 'Freq'), label: `Band ${n} Hz`, min: CYBER_EQ_FREQ[0], max: CYBER_EQ_FREQ[1], default: d.freq, log: true, unit: 'Hz' },
      { key: bandKey(n, 'Gain'), label: `Band ${n} gain`, min: -CYBER_EQ_GAIN, max: CYBER_EQ_GAIN, default: d.gain, unit: 'dB' },
      { key: bandKey(n, 'Q'), label: `Band ${n} Q`, min: CYBER_EQ_Q[0], max: CYBER_EQ_Q[1], default: d.q, log: true, unit: 'x' },
      { key: bandKey(n, 'Type'), label: `Band ${n} type`, min: 0, max: EQ_BAND_TYPES.length - 1, default: Math.max(0, EQ_BAND_TYPES.indexOf(d.type)), choices: EQ_TYPE_LABELS },
      { key: bandKey(n, 'On'), label: `Band ${n}`, min: 0, max: 1, default: d.enabled ? 1 : 0, choices: ['Off', 'On'] },
      // 1.716, Matched: a high- or low-pass's slope, and where the band works in the stereo image.
      { key: bandKey(n, 'Slope'), label: `Band ${n} slope`, min: 0, max: EQ_SLOPE_LABELS.length - 1, default: 1, choices: [...EQ_SLOPE_LABELS] },
      { key: bandKey(n, 'Place'), label: `Band ${n} place`, min: 0, max: EQ_PLACE_LABELS.length - 1, default: 0, choices: [...EQ_PLACE_LABELS] },
    );
  }
  return out;
}

/** A slot's values as MASTER's EQParams (a missing value is the default band's). */
export function eqFromSlot(p: Readonly<Record<string, number>>): EQParams {
  const base = defaultEqParams().bands;
  const matched = (p[EQ_MODE_KEY] ?? 0) >= 0.5;
  const out: EQParams = {
    bands: base.map((d, i) => {
      const n = i + 1;
      const t = p[bandKey(n, 'Type')];
      const band: EQBand = {
        id: d.id,
        type: (t !== undefined ? EQ_BAND_TYPES[Math.round(t)] : undefined) ?? d.type,
        freq: p[bandKey(n, 'Freq')] ?? d.freq,
        gain: p[bandKey(n, 'Gain')] ?? d.gain,
        q: p[bandKey(n, 'Q')] ?? d.q,
        enabled: (p[bandKey(n, 'On')] ?? (d.enabled ? 1 : 0)) >= 0.5,
      };
      // A band's slope and place are Matched's (Classic has neither).
      const slope = p[bandKey(n, 'Slope')], place = p[bandKey(n, 'Place')];
      if (matched && slope !== undefined) band.slope = Math.round(slope);
      if (matched && place !== undefined) band.place = Math.round(place);
      return band;
    }),
  };
  // 1.716: Matched only when the values say so (absent: Classic, every EQ before and the Editor's).
  if (matched) out.matched = true;
  return out;
}

/** One band's change (the EQ panel's `onBandChange`) as slot values. */
export function eqBandPatch(id: string, patch: Partial<EQBand>): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (field: BandField, v: number) => { const k = eqBandKey(id, field); if (k && Number.isFinite(v)) out[k] = v; };
  if (patch.type !== undefined) { const i = EQ_BAND_TYPES.indexOf(patch.type); if (i >= 0) put('type', i); }
  if (patch.freq !== undefined) put('freq', clamp(patch.freq, CYBER_EQ_FREQ[0], CYBER_EQ_FREQ[1]));
  if (patch.gain !== undefined) put('gain', clamp(patch.gain, -CYBER_EQ_GAIN, CYBER_EQ_GAIN));
  if (patch.q !== undefined) put('q', clamp(patch.q, CYBER_EQ_Q[0], CYBER_EQ_Q[1]));
  if (patch.enabled !== undefined) put('enabled', patch.enabled ? 1 : 0);
  if (patch.slope !== undefined) put('slope', clamp(Math.round(patch.slope), 0, EQ_SLOPE_LABELS.length - 1));
  if (patch.place !== undefined) put('place', clamp(Math.round(patch.place), 0, EQ_PLACE_LABELS.length - 1));
  return out;
}

/** MASTER's EQParams as slot values (the Reset button; tests). */
export function eqToSlot(eq: EQParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of eq.bands) Object.assign(out, eqBandPatch(b.id, b));
  // 1.716: the mode only when the params carry one (the Editor's chain never does: no `mode` key).
  if (eq.matched !== undefined) out[EQ_MODE_KEY] = eq.matched ? 1 : 0;
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- Cyber Comp, Saturator and Limiter: their MASTER params, key for key ------------------------

const dyn = defaultDynamicsParams();
const DYNAMICS_DEFS: FxParamDef[] = [
  { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: dyn.threshold, unit: 'dB' },
  { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: dyn.ratio, log: true, unit: 'x' },
  { key: 'knee', label: 'Knee', min: 0, max: 40, default: dyn.knee, unit: 'dB' },
  { key: 'attack', label: 'Attack', min: 0.1, max: 100, default: dyn.attack, log: true, unit: 'ms' },
  { key: 'release', label: 'Release', min: 10, max: 1000, default: dyn.release, log: true, unit: 'ms' },
  { key: 'makeup', label: 'Makeup', min: 0, max: 24, default: dyn.makeup, unit: 'dB' },
  // 1.716: each default is the compressor before 1.716, so an older slot (which has none of them)
  // sounds as it did with no migration. The lookahead is a latency: no lane.
  { key: 'style', label: 'Style', min: 0, max: 2, default: 0, choices: ['Classic', 'Smooth', 'Punch'] },
  { key: 'detect', label: 'Detector', min: 0, max: 1, default: 0, choices: ['Peak', 'RMS'] },
  { key: 'lookahead', label: 'Lookahead', min: 0, max: 10, default: 0, unit: 'ms', automatable: false },
  { key: 'keyHp', label: 'Key high-pass', min: 20, max: 1000, default: 20, log: true, unit: 'Hz' },
  { key: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: 'pct' },
  { key: 'autoGain', label: 'Auto gain', min: 0, max: 1, default: 0, choices: ['Off', 'On'] },
];

/** 1.716: whether a window's values are a Cyber Comp slot's, with 1.716's controls (the Editor's chain has none). */
export const compHasStyles = (values: Readonly<Record<string, number>>): boolean => 'style' in values;

const sat = defaultSaturationParams();
// Mix (two gains), Drive (the gain into the shapers and the trim after them) and Tone (two shelves'
// gains) automate (Drive and Tone since 1.62), and since 1.69 Odd and Even too: the shapers are the
// `cyber-saturator` worklet (saturatorWorklet.ts), which computes each curve per sample from a
// k-rate AudioParam, so a lane drives the curve itself, live and in the offline render. Until 1.68
// they were WaveShaper tables, which no AudioParam reached.
const SATURATION_DEFS: FxParamDef[] = [
  { key: 'drive', label: 'Drive', min: 0, max: 24, default: sat.drive, unit: 'dB' },
  { key: 'odd', label: 'Odd', min: 0, max: 100, default: sat.odd, unit: 'pct' },
  { key: 'even', label: 'Even', min: 0, max: 100, default: sat.even, unit: 'pct' },
  { key: 'mix', label: 'Mix', min: 0, max: 100, default: sat.mix, unit: 'pct' },
  { key: 'tone', label: 'Tone', min: -1, max: 1, default: sat.tone, unit: '' },
  // 1.716: a new slot is Tape at 8×; a slot from before is given Classic at 4× (`migrateCyberParams`).
  { key: 'style', label: 'Style', min: 0, max: SAT_STYLE_LABELS.length - 1, default: 1, choices: [...SAT_STYLE_LABELS] },
  { key: 'os', label: 'Oversampling', min: 0, max: 1, default: 1, choices: ['4×', '8×'] },
  { key: 'output', label: 'Output', min: -18, max: 12, default: 0, unit: 'dB' },
];

/** 1.716: whether a window's values are a Cyber Saturator slot's, with 1.716's controls (the Editor's chain has none). */
export const satHasStyles = (values: Readonly<Record<string, number>>): boolean => 'style' in values;

const max = defaultMaximizerParams();
const MAXIMIZER_DEFS: FxParamDef[] = [
  // The gain into the limiter is −threshold (MASTER's GAIN fader: 0 to 30 dB).
  { key: 'threshold', label: 'Threshold', min: -30, max: 0, default: max.threshold, unit: 'dB' },
  { key: 'ceiling', label: 'Ceiling', min: -3, max: 0, default: max.ceiling, unit: 'dB' },
  { key: 'release', label: 'Release', min: 1, max: 1000, default: max.release, log: true, unit: 'ms' },
  // 1.715 (the mastering Limiter). `style`'s default is Legacy (0), so a slot saved before 1.715, which
  // has none, keeps the Limiter it was made with; a new slot is Transparent (`NEW_SLOT_PARAMS`).
  { key: 'style', label: 'Style', min: 0, max: LIMITER_STYLES.length - 1, default: LEGACY_LIMITER_STYLE, choices: LIMITER_STYLES },
  { key: 'attack', label: 'Attack', min: 0, max: 5, default: max.attack!, unit: 'ms' },
  { key: 'autoRelease', label: 'Auto release', min: 0, max: 1, default: max.autoRelease!, choices: ['Off', 'On'] },
  { key: 'oversample', label: 'True peak', min: 0, max: LIMITER_OVERSAMPLE.length - 1, default: max.oversample!, choices: LIMITER_OVERSAMPLE },
  { key: 'linkTransients', label: 'Link transients', min: 0, max: 100, default: max.linkTransients!, unit: 'pct' },
  { key: 'linkRelease', label: 'Link release', min: 0, max: 100, default: max.linkRelease!, unit: 'pct' },
  { key: 'stereoMode', label: 'Channels', min: 0, max: 1, default: max.stereoMode!, choices: ['Stereo', 'Mid/Side'] },
  { key: 'audition', label: 'Audition', min: 0, max: 1, default: max.audition!, choices: ['Off', 'On'] },
  { key: 'target', label: 'Target', min: 0, max: LIMITER_TARGETS.length - 1, default: max.target!, choices: LIMITER_TARGETS.map(t => t.label) },
];

/**
 * 1.715: what a newly made slot of a type has over its parameters' defaults (`defaultFx`, a
 * window's Reset): the mastering Limiter's style, where a slot saved without one is Legacy.
 */
export const NEW_SLOT_PARAMS: Readonly<Partial<Record<string, Readonly<Record<string, number>>>>> = Object.freeze({
  cyberLimit: Object.freeze({ style: NEW_LIMITER_STYLE }),
  limiter: Object.freeze({ style: NEW_LIMITER_STYLE }),
});

/** Each Cyber type's parameters, for FX_DEFS. */
export const CYBER_PARAMS: Readonly<Record<CyberType, readonly FxParamDef[]>> = Object.freeze({
  cyberEq: eqParamDefs(),
  cyberComp: DYNAMICS_DEFS,
  cyberSat: SATURATION_DEFS,
  cyberLimit: MAXIMIZER_DEFS,
  scope: [],
  spectro3d: [],
});

/** Read named keys from a slot's values, each falling back to its default. */
function pick<T extends object>(defs: readonly FxParamDef[], p: Readonly<Record<string, number>>): T {
  const out: Record<string, number> = {};
  for (const d of defs) out[d.key] = p[d.key] ?? d.default;
  return out as T;
}
export const dynamicsFromSlot = (p: Readonly<Record<string, number>>): DynamicsParams => pick<DynamicsParams>(DYNAMICS_DEFS, p);
/** A slot's values as the Saturator's params; values without a style (the Editor's chain) are Classic at 4×, as before 1.716. */
export const saturationFromSlot = (p: Readonly<Record<string, number>>): SaturationParams =>
  pick<SaturationParams>(SATURATION_DEFS, 'style' in p ? p : { ...p, style: 0, os: 0 });
export const maximizerFromSlot = (p: Readonly<Record<string, number>>): MaximizerParams => pick<MaximizerParams>(MAXIMIZER_DEFS, p);

/** A MASTER panel's change (`onChange(partial)`) as slot values: known keys, finite, in range. */
export function cyberPatch(type: CyberType, patch: object): Record<string, number> {
  const out: Record<string, number> = {};
  const src = patch as Record<string, unknown>;
  for (const d of CYBER_PARAMS[type]) {
    const v = src[d.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = clamp(v, d.min, d.max);
  }
  return out;
}

/** Every value at its default (the windows' Reset; 1.715: a new slot's, so a Reset Limiter is Transparent). */
export const cyberDefaults = (type: CyberType): Record<string, number> => ({ ...Object.fromEntries(CYBER_PARAMS[type].map(d => [d.key, d.default])), ...NEW_SLOT_PARAMS[type] });

/**
 * 1.716: a Cyber insert's values saved before 1.716 as 1.716's: the EQ Classic, the Compressor and
 * the Saturator their Classic style, so each sounds exactly as it did (a new slot takes the new
 * defaults). Keyed on each type's marker (`mode`, `style`): a slot that has it is left alone. Run by
 * the slot sanitiser before it fills missing values from the defaults.
 */
export function migrateCyberParams(type: string, ps: Record<string, unknown>): Record<string, unknown> {
  const legacy = CYBER_LEGACY[type];
  if (!legacy || legacy.marker in ps) return ps;
  return { ...legacy.values, ...ps };
}

/** 1.716: the values that make a slot sound as a pre-1.716 one of `type` did (empty for a type with none). */
export const cyberLegacyValues = (type: string): Record<string, number> => ({ ...(CYBER_LEGACY[type]?.values ?? {}) });

/** Each type's marker key and the values that make a pre-1.716 slot sound as it did. */
const CYBER_LEGACY: Readonly<Record<string, { marker: string; values: Record<string, number> }>> = {
  cyberEq: { marker: EQ_MODE_KEY, values: { [EQ_MODE_KEY]: 0 } },
  cyberSat: { marker: 'style', values: { style: 0, os: 0 } },
};
