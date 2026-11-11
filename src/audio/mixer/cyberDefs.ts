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

// --- Cyber EQ: eight bands, as MASTER's -----------------------------------------------------------

/** A band's type as a choice index (a slot holds numbers). */
export const EQ_BAND_TYPES: readonly EQBandType[] = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass', 'notch'];
const EQ_TYPE_LABELS = ['High-pass', 'Low shelf', 'Bell', 'High shelf', 'Low-pass', 'Notch'];
export const CYBER_EQ_BANDS = 8;
/** The MASTER EQ's ranges (EqCanvas's FREQ_MIN/MAX and GAIN_RANGE, the Q slider's 0.1–18). */
export const CYBER_EQ_FREQ: readonly [number, number] = [20, 20000];
export const CYBER_EQ_GAIN = 18;
export const CYBER_EQ_Q: readonly [number, number] = [0.1, 18];

const bandKey = (n: number, k: 'Type' | 'Freq' | 'Gain' | 'Q' | 'On') => `b${n}${k}`;
/** A band's parameter key from its MASTER id ('b3') and field. */
export function eqBandKey(id: string, field: 'type' | 'freq' | 'gain' | 'q' | 'enabled'): string | null {
  const m = /^b([1-8])$/.exec(id);
  if (!m) return null;
  const k = ({ type: 'Type', freq: 'Freq', gain: 'Gain', q: 'Q', enabled: 'On' } as const)[field];
  return bandKey(Number(m[1]), k);
}

function eqParamDefs(): FxParamDef[] {
  const base = defaultEqParams().bands;
  const out: FxParamDef[] = [];
  for (let n = 1; n <= CYBER_EQ_BANDS; n++) {
    const d = base[n - 1]!;
    out.push(
      { key: bandKey(n, 'Freq'), label: `Band ${n} Hz`, min: CYBER_EQ_FREQ[0], max: CYBER_EQ_FREQ[1], default: d.freq, log: true, unit: 'Hz' },
      { key: bandKey(n, 'Gain'), label: `Band ${n} gain`, min: -CYBER_EQ_GAIN, max: CYBER_EQ_GAIN, default: d.gain, unit: 'dB' },
      { key: bandKey(n, 'Q'), label: `Band ${n} Q`, min: CYBER_EQ_Q[0], max: CYBER_EQ_Q[1], default: d.q, log: true, unit: 'x' },
      { key: bandKey(n, 'Type'), label: `Band ${n} type`, min: 0, max: EQ_BAND_TYPES.length - 1, default: Math.max(0, EQ_BAND_TYPES.indexOf(d.type)), choices: EQ_TYPE_LABELS },
      { key: bandKey(n, 'On'), label: `Band ${n}`, min: 0, max: 1, default: d.enabled ? 1 : 0, choices: ['Off', 'On'] },
    );
  }
  return out;
}

/** A slot's values as MASTER's EQParams (a missing value is the default band's). */
export function eqFromSlot(p: Readonly<Record<string, number>>): EQParams {
  const base = defaultEqParams().bands;
  return {
    bands: base.map((d, i) => {
      const n = i + 1;
      const t = p[bandKey(n, 'Type')];
      return {
        id: d.id,
        type: (t !== undefined ? EQ_BAND_TYPES[Math.round(t)] : undefined) ?? d.type,
        freq: p[bandKey(n, 'Freq')] ?? d.freq,
        gain: p[bandKey(n, 'Gain')] ?? d.gain,
        q: p[bandKey(n, 'Q')] ?? d.q,
        enabled: (p[bandKey(n, 'On')] ?? (d.enabled ? 1 : 0)) >= 0.5,
      };
    }),
  };
}

/** One band's change (the EQ panel's `onBandChange`) as slot values. */
export function eqBandPatch(id: string, patch: Partial<EQBand>): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (field: 'type' | 'freq' | 'gain' | 'q' | 'enabled', v: number) => { const k = eqBandKey(id, field); if (k && Number.isFinite(v)) out[k] = v; };
  if (patch.type !== undefined) { const i = EQ_BAND_TYPES.indexOf(patch.type); if (i >= 0) put('type', i); }
  if (patch.freq !== undefined) put('freq', clamp(patch.freq, CYBER_EQ_FREQ[0], CYBER_EQ_FREQ[1]));
  if (patch.gain !== undefined) put('gain', clamp(patch.gain, -CYBER_EQ_GAIN, CYBER_EQ_GAIN));
  if (patch.q !== undefined) put('q', clamp(patch.q, CYBER_EQ_Q[0], CYBER_EQ_Q[1]));
  if (patch.enabled !== undefined) put('enabled', patch.enabled ? 1 : 0);
  return out;
}

/** MASTER's EQParams as slot values (the Reset button; tests). */
export function eqToSlot(eq: EQParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of eq.bands) Object.assign(out, eqBandPatch(b.id, b));
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
];

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
];

const max = defaultMaximizerParams();
const MAXIMIZER_DEFS: FxParamDef[] = [
  // The gain into the limiter is −threshold (MASTER's GAIN fader: 0 to 30 dB).
  { key: 'threshold', label: 'Threshold', min: -30, max: 0, default: max.threshold, unit: 'dB' },
  { key: 'ceiling', label: 'Ceiling', min: -3, max: 0, default: max.ceiling, unit: 'dB' },
  { key: 'release', label: 'Release', min: 1, max: 1000, default: max.release, log: true, unit: 'ms' },
];

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
export const saturationFromSlot = (p: Readonly<Record<string, number>>): SaturationParams => pick<SaturationParams>(SATURATION_DEFS, p);
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

/** Every value at its default (the windows' Reset). */
export const cyberDefaults = (type: CyberType): Record<string, number> => Object.fromEntries(CYBER_PARAMS[type].map(d => [d.key, d.default]));
