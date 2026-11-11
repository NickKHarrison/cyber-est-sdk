import { defaultFmPatch, sanitiseFmPatch, setFmValue, type FmPatch } from '../fm/fmTypes';
import { defaultSynthPatch, sanitiseSynthPatch, setPath, type SynthPatch } from '../synth/synthTypes';
import { DRUM_PADS, emptyDrumKit, sanitiseDrumKit, type DrumKit, type DrumPad } from './drumTypes';
import { CHIP_KIT_PADS } from './chipKit';
import { defaultChipPatch, type ChipPatch } from '../chip/chipTypes';

/**
 * The Drum Rack's factory kits (1.29, Cyber_Drum_Rack_Plan.md §5): drums synthesised from FM
 * and ANALOG voices, so a new rack sounds before any sample is loaded, laid out on the General
 * MIDI map (kick on C1, snare on D1, the hats choking each other in group 1). Ids are
 * `drums:<id>`. Every voice is written as changes from a blank patch.
 */

export interface DrumFactoryKit { id: string; name: string; blurb: string; kit: DrumKit }

type Env = [number, number, number, number];

/** An FM voice: every operator off but the ones named, polyphonic, four voices. */
function fm(changes: Record<string, unknown>, ops: Record<number, { level: number; env: Env; coarse?: number; freq?: number; wave?: string }>): FmPatch {
  let p = defaultFmPatch();
  for (let i = 0; i < 6; i++) p = setFmValue(p, `ops.${i}.on`, false);
  p = setFmValue(p, 'voice.voices', 4);
  for (const [k, o] of Object.entries(ops)) {
    const i = Number(k);
    const [a, d, s, r] = o.env;
    const set: Record<string, unknown> = {
      on: true, level: o.level, velocity: 0.3, coarse: o.coarse ?? 1, fixed: o.freq !== undefined, freq: o.freq ?? 440, wave: o.wave ?? 'sine',
      'env.attack': a, 'env.decay': d, 'env.sustain': s, 'env.release': r,
    };
    for (const [path, v] of Object.entries(set)) p = setFmValue(p, `ops.${i}.${path}`, v);
  }
  for (const [path, v] of Object.entries(changes)) p = setFmValue(p, path, v);
  return sanitiseFmPatch(p);
}

/** An ANALOG voice: oscillators off unless named, no drift or spread, polyphonic. */
function analog(changes: Record<string, unknown>): SynthPatch {
  let p = defaultSynthPatch();
  const base: Record<string, unknown> = {
    'osc.0.on': false, 'osc.1.on': false, 'osc.2.on': false, 'osc.0.fine': 0, 'osc.1.fine': 0, 'osc.2.fine': 0,
    'voice.mode': 'poly', 'voice.voices': 4, 'voice.drift': 0, stereoSpread: 0, drive: 0, 'filter.keyTrack': 0,
    velToAmp: 0.5, velToFilter: 0.2, volume: 0.8, 'filterEnv.sustain': 0, 'ampEnv.sustain': 0, 'ampEnv.attack': 0.001, 'filterEnv.attack': 0.001,
  };
  for (const [path, v] of Object.entries({ ...base, ...changes })) p = setPath(p, path, v);
  return sanitiseSynthPatch(p);
}

const env = (decay: number, release = Math.min(0.3, decay * 0.6)): Env => [0.001, decay, 0, release];

// --- The voices ------------------------------------------------------------------------------

const fmKick = (pitch = 24, decay = 0.5) => fm({ 'pitchEnv.amount': pitch, 'pitchEnv.time': 0.07, gain: 3 }, { 0: { level: 1, env: env(decay) }, 1: { level: 0.12, env: env(0.03) } });
const fmTom = (decay = 0.45) => fm({ 'pitchEnv.amount': 9, 'pitchEnv.time': 0.12 }, { 0: { level: 0.95, env: env(decay) }, 1: { level: 0.1, env: env(0.05) } });
/** 4-OP algorithm 8 (all four heard): a body on operator 1, the feedback operator 4 as noise. */
const fmSnare = (body: number, noise: number, decay = 0.16) => fm({ algorithm: 7, feedback: 1, 'pitchEnv.amount': 5, 'pitchEnv.time': 0.03 }, {
  0: { level: 0.8, env: env(decay * 0.75), freq: body }, 3: { level: 0.7, env: env(decay), freq: noise },
});
/** 4-OP algorithm 6 (4 into 1, 2 and 3): three inharmonic partials struck by a noisy operator 4. */
const fmMetal = (decay: number, level = 0.5, fb = 0.6) => fm({ algorithm: 5, feedback: fb }, {
  0: { level, env: env(decay), freq: 3150 }, 1: { level, env: env(decay), freq: 4530 }, 2: { level, env: env(decay), freq: 6270 }, 3: { level: 0.8, env: env(decay), freq: 8190 },
});
const fmStick = () => fm({ gain: -4 }, { 0: { level: 0.9, env: env(0.04), freq: 1750 }, 1: { level: 0.5, env: env(0.02), freq: 2650 } });
const fmClap = () => fm({ algorithm: 7, feedback: 1, gain: -2 }, { 3: { level: 0.9, env: env(0.22), freq: 1500 } });
/** 4-OP algorithm 5 (2 into 1, 4 into 3): two bell pairs. */
const fmRide = () => fm({ algorithm: 4, gain: -4 }, {
  0: { level: 0.6, env: env(1.3, 0.6), freq: 3800 }, 1: { level: 0.3, env: env(0.9), freq: 5310 }, 2: { level: 0.35, env: env(1.1, 0.6), freq: 7420 }, 3: { level: 0.4, env: env(0.8), freq: 9510 },
});

const anKick = () => analog({ 'osc.0.on': true, 'osc.0.wave': 'triangle', 'osc.0.level': 1, 'filter.cutoff': 260, 'filter.resonance': 0.1, 'filter.envAmount': 0.6, 'filterEnv.decay': 0.05, 'ampEnv.decay': 0.45, 'ampEnv.release': 0.1 });
const anSnare = () => analog({ 'osc.0.on': true, 'osc.0.wave': 'triangle', 'osc.0.level': 0.55, 'noise.level': 0.85, 'filter.cutoff': 5200, 'filter.resonance': 0.1, 'filter.envAmount': 0.3, 'filterEnv.decay': 0.12, 'ampEnv.decay': 0.18, 'ampEnv.release': 0.14 });
const anClap = () => analog({ 'noise.level': 1, 'filter.cutoff': 1900, 'filter.resonance': 0.35, 'filter.envAmount': 0.2, 'filterEnv.decay': 0.1, 'ampEnv.decay': 0.24, 'ampEnv.release': 0.16 });
const anHat = (decay: number) => analog({ 'noise.level': 1, 'filter.cutoff': 14000, 'filter.resonance': 0.05, 'ampEnv.decay': decay, 'ampEnv.release': Math.min(0.3, decay * 0.6), velToFilter: 0 });
const anTom = () => analog({ 'osc.0.on': true, 'osc.0.wave': 'triangle', 'osc.0.level': 0.9, 'osc.1.on': true, 'osc.1.wave': 'triangle', 'osc.1.level': 0.4, 'osc.1.fine': 9, 'filter.cutoff': 700, 'filter.envAmount': 0.45, 'filterEnv.decay': 0.08, 'ampEnv.decay': 0.4, 'ampEnv.release': 0.15 });
const anBlip = () => analog({ 'osc.0.on': true, 'osc.0.wave': 'square', 'osc.0.level': 0.7, 'filter.cutoff': 2600, 'filter.envAmount': 0.3, 'filterEnv.decay': 0.03, 'ampEnv.decay': 0.05, 'ampEnv.release': 0.04 });

// --- Kits ------------------------------------------------------------------------------------

/** A pad as a kit writes it (1.450: exported for `starterKits.ts`). */
export type PadSpec = Partial<Omit<DrumPad, 'fx'>> & { fx?: { filter?: Partial<DrumPad['fx']['filter']>; drive?: number; crush?: number } };

/** A kit of these pads over an empty one, sanitised (1.450: exported for `starterKits.ts`). */
export function kit(specs: Record<number, PadSpec>, gain = 0): DrumKit {
  const k = emptyDrumKit();
  for (let i = 0; i < DRUM_PADS; i++) {
    const s = specs[i];
    if (!s) continue;
    const pad = k.pads[i]!;
    k.pads[i] = { ...pad, ...s, fx: { ...pad.fx, ...s.fx, filter: { ...pad.fx.filter, ...s.fx?.filter } } } as DrumPad;
  }
  return sanitiseDrumKit({ ...k, gain });
}

const F = (voice: FmPatch, note: number, extra: PadSpec = {}): PadSpec => ({ source: 'fm', fm: voice, note, ...extra });
const A = (voice: SynthPatch, note: number, extra: PadSpec = {}): PadSpec => ({ source: 'analog', analog: voice, note, ...extra });
const hp = (cutoff: number, resonance = 0.1) => ({ filter: { type: 'highpass' as const, cutoff, resonance } });
const bp = (cutoff: number, resonance = 0.3) => ({ filter: { type: 'bandpass' as const, cutoff, resonance } });

/** The hats and cymbals of both synthesised kits (FM metal, high-passed, the hats in choke group 1). */
const FM_METAL: Record<number, PadSpec> = {
  6: F(fmMetal(0.05), 60, { choke: 1, fx: hp(7000) }),
  8: F(fmMetal(0.09), 60, { choke: 1, fx: hp(6000), level: -3 }),
  10: F(fmMetal(0.5), 60, { choke: 1, fx: hp(6500), level: -2 }),
  13: F(fmMetal(1.8, 0.4, 0.9), 60, { fx: hp(4500), sends: [0.25, 0, 0, 0], level: -4 }),
  15: F(fmRide(), 60, { fx: hp(3000), level: -3 }),
};

const TOM_NOTES: Record<number, number> = { 5: 43, 7: 40, 9: 47, 11: 50, 12: 52, 14: 55 };

/** 1.200 (T2): a pad of the 8-bit Kit: a stock 8-bit drum by hash (`chipKit.ts`), played out (no gate). */
const S = (p: (typeof CHIP_KIT_PADS)[number]): PadSpec => ({
  source: 'sample', sample: { hash: p.hash, name: `${p.name}.wav` }, name: p.label, start: 0, gate: false,
  ...(p.tune ? { tune: p.tune } : {}), ...(p.level ? { level: p.level } : {}), ...(p.choke ? { choke: p.choke } : {}),
});

export const DRUM_FACTORY: readonly DrumFactoryKit[] = Object.freeze([
  {
    id: 'hybrid', name: 'Hybrid Kit', blurb: 'An FM kick, toms and metal with an ANALOG snare and clap',
    kit: kit({
      0: F(fmKick(), 33, { level: 0 }),
      1: F(fmStick(), 60),
      2: A(anSnare(), 50, { fx: hp(160) }),
      3: A(anClap(), 60, { fx: bp(1400), sends: [0.2, 0, 0, 0] }),
      4: F(fmSnare(190, 4000), 60, { fx: hp(120) }),
      ...Object.fromEntries(Object.entries(TOM_NOTES).map(([i, n]) => [i, F(fmTom(), n)])),
      ...FM_METAL,
    }),
  },
  {
    id: 'fm', name: 'FM Kit', blurb: 'Every pad FM: a pitched kick, noisy snares from feedback, metallic hats',
    kit: kit({
      0: F(fmKick(30, 0.6), 31, { fx: { drive: 0.2 } }),
      1: F(fmStick(), 60),
      2: F(fmSnare(210, 3500, 0.2), 60, { fx: hp(150) }),
      3: F(fmClap(), 60, { fx: bp(1300), sends: [0.2, 0, 0, 0] }),
      4: F(fmSnare(240, 5200, 0.12), 60, { fx: hp(200) }),
      ...Object.fromEntries(Object.entries(TOM_NOTES).map(([i, n]) => [i, F(fmTom(0.55), n)])),
      ...FM_METAL,
    }),
  },
  {
    id: 'analog', name: 'Analog Kit', blurb: 'Every pad ANALOG: a filtered thump, noise snares and hats, two-oscillator toms',
    kit: kit({
      0: A(anKick(), 36, { fx: { drive: 0.25 } }),
      1: A(anBlip(), 72),
      2: A(anSnare(), 50, { fx: hp(160) }),
      3: A(anClap(), 60, { fx: bp(1400), sends: [0.2, 0, 0, 0] }),
      4: A(anSnare(), 55, { fx: hp(220), tune: 3 }),
      ...Object.fromEntries(Object.entries(TOM_NOTES).map(([i, n]) => [i, A(anTom(), n)])),
      6: A(anHat(0.05), 60, { choke: 1, fx: hp(8000) }),
      8: A(anHat(0.09), 60, { choke: 1, fx: hp(7000), level: -3 }),
      10: A(anHat(0.45), 60, { choke: 1, fx: hp(7500), level: -2 }),
      13: A(anHat(1.6), 60, { fx: hp(5000), sends: [0.25, 0, 0, 0], level: -5 }),
      15: A(anHat(1.1), 60, { fx: bp(6000, 0.5), level: -5 }),
    }),
  },
  {
    id: 'chip', name: '8-bit Kit', blurb: "Every pad a stock 8-bit drum, rendered by 8-BIT's own chip: noise kicks, snares and hats, toms, a crash, a blip and a zap",
    kit: kit(Object.fromEntries(CHIP_KIT_PADS.map(p => [p.pad, S(p)]))),
  },
  { id: 'empty', name: 'Empty Kit', blurb: 'Sixteen empty pads, for your own samples', kit: emptyDrumKit() },
]);

export function drumFactoryKit(id: string): DrumFactoryKit | undefined {
  const bare = id.startsWith('drums:') ? id.slice(6) : id;
  return DRUM_FACTORY.find(k => k.id === bare);
}

/** A new rack's kit: the Hybrid kit. */
export function defaultDrumKit(): DrumKit {
  return DRUM_FACTORY[0]!.kit;
}

/** A fresh voice for a pad switched to FM or ANALOG: the kit's snare-ish starting point; 1.372, 8-BIT's own default. */
export function defaultPadVoice(source: 'fm' | 'analog' | 'chip'): FmPatch | SynthPatch | ChipPatch {
  return source === 'fm' ? fmTom() : source === 'chip' ? defaultChipPatch() : anSnare();
}
