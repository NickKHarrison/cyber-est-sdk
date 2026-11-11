import { clampParam, getPath, sanitiseSynthPatch, setPath, type SynthParam, type SynthPatch } from '../synth/synthTypes';
import { sanitiseFmPatch, type FmPatch } from '../fm/fmTypes';
import { sanitiseChipPatch, type ChipPatch } from '../chip/chipTypes';
import { defaultFx, sanitiseFx, takesKey, type FxSlot } from '../mixer/fxDefs';

/**
 * The Drum Rack's kit (1.29, Cyber_Drum_Rack_Plan.md): sixteen pads on a synth track (`engine:
 * 'drums'`), each holding a sample (an upload, by hash), an FM voice or an ANALOG voice, with
 * its own effects (a filter, drive and a bit crusher), level, pan, choke group and sends into
 * the song's returns. Pad `i` plays on MIDI note `DRUM_BASE_NOTE + i` (C1 up, the General MIDI
 * drum map's first sixteen), and every other note on the pad it lands on, counting up in
 * sixteens, so any keyboard reaches all of them.
 *
 * Pure: no DOM, Web Audio or store imports.
 */

export const DRUM_PADS = 16;
/** The note of pad 1 (C1, the General MIDI kick). */
export const DRUM_BASE_NOTE = 36;
/** Choke groups 1…8 (0 is none). */
export const DRUM_CHOKE_GROUPS = 8;
/** Sends per pad: one for each return the song can have (A to D). */
export const DRUM_SENDS = 4;
/** The longest sample a pad plays, seconds (a longer upload is refused when it is loaded). */
export const MAX_DRUM_SAMPLE_SECONDS = 30;
/** 1.111: a sample pad's velocity layers, at most (the first is the pad's own `sample`). */
export const MAX_PAD_LAYERS = 4;

/** 1.372 (part 3, stream 5): `'chip'`, an 8-BIT voice on a pad, as an FM or ANALOG voice. */
export type DrumSource = 'empty' | 'sample' | 'fm' | 'analog' | 'chip';
export const DRUM_SOURCES: readonly DrumSource[] = ['empty', 'sample', 'fm', 'analog', 'chip'];
export const DRUM_SOURCE_LABELS: Record<DrumSource, string> = { empty: 'Empty', sample: 'Sample', fm: 'FM', analog: 'Analog', chip: '8-BIT' };
/** The voice sources (a synth patch on the pad, played by its own worklet). */
export type DrumVoiceSource = 'fm' | 'analog' | 'chip';
export const isDrumVoice = (s: DrumSource): s is DrumVoiceSource => s === 'fm' || s === 'analog' || s === 'chip';
/** 1.372: a pad's own inserts, at most (a short chain, after its Pad FX). */
export const DRUM_PAD_MAX_INSERTS = 3;
/** 1.372: the rack's own return chains (Live's in-rack returns), each pad sending to them. */
export const DRUM_RACK_RETURNS = 2;
/** 1.372: a rack return's inserts, at most. */
export const DRUM_RETURN_MAX_FX = 3;

/**
 * 1.372: a return chain inside the rack: its inserts and level (dB), into the rack's output (so the
 * track's strip, its sends and fader hear it), fed by each pad's `rackSends`. A kit without
 * `returns` plays the defaults, a reverb and a delay (`kitReturns`).
 */
export interface DrumRackReturn { name: string; fx: FxSlot[]; level: number }
export type DrumFilterType = 'off' | 'lowpass' | 'highpass' | 'bandpass';
export const DRUM_FILTER_TYPES: readonly DrumFilterType[] = ['off', 'lowpass', 'highpass', 'bandpass'];

/**
 * 1.111: a velocity layer of a sample pad: its sample (an upload, by hash) plays the hits whose
 * velocity is in `from`…`to` (1…127, inclusive). A pad's layers cover 1…127 without a gap or an
 * overlap, in order; the first layer's sample is the pad's own `sample` (what an older reader plays).
 */
export interface DrumPadLayer {
  sample: { hash: string; name: string };
  from: number;
  to: number;
}

export interface DrumPadFx {
  filter: { type: DrumFilterType; cutoff: number; resonance: number };
  /** Soft clipping, 0 (off) … 1. */
  drive: number;
  /** The bit crusher: 0 (off) … 1 (two bits). */
  crush: number;
}

export interface DrumPad {
  name: string;
  /** HSL triplet, as the tracks' and the SAMPLE pads' colours. */
  color: string;
  source: DrumSource;
  /** The sample (its upload's SHA-256 and name), for `source: 'sample'`. */
  sample: { hash: string; name: string } | null;
  /** Where the sample starts, a share of its length. */
  start: number;
  reverse: boolean;
  /** Gate: the sample stops (over its decay) when the note ends; otherwise it plays out, a one-shot. */
  gate: boolean;
  /** Semitones (every source) and cents (the sample). */
  tune: number;
  fine: number;
  /** The sample's envelope: its attack, and how long it takes to die away (seconds). */
  attack: number;
  decay: number;
  /** The voice, for `source: 'fm'` or `'analog'` (null otherwise). */
  fm: FmPatch | null;
  analog: SynthPatch | null;
  /** 1.372: the 8-BIT voice, for `source: 'chip'` (absent otherwise, so an older kit reads as it was). */
  chip?: ChipPatch;
  /**
   * 1.372: what note a voice plays: absent (`'fixed'`), its `note` and `tune` whatever note hit the
   * pad (a drum voice); `'played'`, the note that hit it, moved by `tune` (a melodic voice).
   */
  pitch?: 'played';
  /** 1.372: the pad's own inserts (built-in types, no key), after its Pad FX and before its pan; absent: none. */
  inserts?: FxSlot[];
  /** 1.372: into the rack's own returns (`kitReturns`), 0…1 each, after the pad's level; absent: none. */
  rackSends?: number[];
  /** The note the voice plays (before `tune`). */
  note: number;
  /** dB. */
  level: number;
  pan: number;
  /** How much velocity changes the hit (0: every hit full, 1: fully). */
  velocity: number;
  mute: boolean;
  solo: boolean;
  /** 0: none; a hit cuts every other pad in its group that is still sounding. */
  choke: number;
  /** Into the song's returns A to D, 0…1, after the pad's level and pan. */
  sends: number[];
  fx: DrumPadFx;
  /**
   * 1.111: velocity layers (2 to `MAX_PAD_LAYERS`) on a sample pad, contiguous over 1…127; layer 1
   * is `sample`. Absent: one sample at every velocity (as before, and as an older client plays it).
   */
  layers?: DrumPadLayer[];
}

export interface DrumKit {
  version: 1;
  pads: DrumPad[];
  /** The rack's output, dB. */
  gain: number;
  /** 1.372: the rack's own return chains, as edited (absent: the defaults, `defaultDrumReturns`). */
  returns?: DrumRackReturn[];
}

/** 1.372: the rack's returns by default: a reverb and a delay at their defaults but fully wet (a return carries only the effect, as Live's). */
export function defaultDrumReturns(): DrumRackReturn[] {
  const wet = (f: FxSlot): FxSlot => ({ ...f, params: { ...f.params, mix: 1 } });
  return [
    { name: 'Reverb', fx: [wet(defaultFx('reverb', 'rackrev'))], level: 0 },
    { name: 'Delay', fx: [wet(defaultFx('delay', 'rackdly'))], level: 0 },
  ];
}
/** 1.372: the returns a kit plays: its own, else the defaults. */
export const kitReturns = (kit: Pick<DrumKit, 'returns'>): DrumRackReturn[] => kit.returns ?? defaultDrumReturns();

/** 1.372: a list of inserts: built-in types, no sidechain key, at most `max`, unique ids. */
export function sanitiseShortChain(raw: unknown, max: number): FxSlot[] {
  const out: FxSlot[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    const f = sanitiseFx(r);
    if (!f || f.type === 'est' || seen.has(f.id)) continue;
    seen.add(f.id);
    if (takesKey(f.type)) { const { keyTrackId: _k, ...rest } = f; out.push(f.type === 'cyberComp' ? rest : { ...rest, keyTrackId: null }); } else out.push(f);
  }
  return out;
}

/** 1.372: the rack's returns from anything: exactly `DRUM_RACK_RETURNS`, each named, its inserts and level in range. */
export function sanitiseDrumReturns(raw: unknown): DrumRackReturn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const d = defaultDrumReturns();
  return d.map((def, k) => {
    const r = raw[k] && typeof raw[k] === 'object' ? raw[k] as Record<string, unknown> : {};
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().replace(/\s+/g, ' ').slice(0, 16) : def.name;
    const level = typeof r.level === 'number' && Number.isFinite(r.level) ? Math.max(-48, Math.min(6, r.level)) : 0;
    return { name, fx: Array.isArray(r.fx) ? sanitiseShortChain(r.fx, DRUM_RETURN_MAX_FX) : def.fx, level };
  });
}

/** The General MIDI names of notes 36 to 51, the pads' default names. */
export const GM_DRUM_NAMES: readonly string[] = Object.freeze([
  'Kick', 'Side stick', 'Snare', 'Clap', 'Snare 2', 'Low tom', 'Closed hat', 'Floor tom',
  'Pedal hat', 'Mid tom', 'Open hat', 'Mid tom 2', 'High tom', 'Crash', 'High tom 2', 'Ride',
]);

/** The pads' colours, by row of the 4×4 grid (bottom row first, as the pads are laid out). */
export const DRUM_PAD_COLORS: readonly string[] = Object.freeze([
  '14 88% 58%', '28 90% 56%', '43 92% 54%', '330 80% 62%',
  '200 85% 56%', '160 70% 46%', '186 80% 52%', '172 66% 44%',
  '265 72% 66%', '160 60% 50%', '196 80% 60%', '150 58% 48%',
  '140 56% 50%', '50 90% 58%', '130 50% 52%', '48 80% 62%',
]);

/** The pad a note plays: notes 36–51 are pads 1–16; every other note wraps round, in sixteens. */
export function padOfNote(note: number): number {
  return (((Math.round(note) - DRUM_BASE_NOTE) % DRUM_PADS) + DRUM_PADS) % DRUM_PADS;
}

/** The note that plays pad `i` (36 + i). */
export const noteOfPad = (i: number): number => DRUM_BASE_NOTE + i;

// --- Parameters ------------------------------------------------------------------------------

/** A pad's numeric parameters, by their path inside the pad (knobs and automation read these). */
export const DRUM_PAD_PARAMS: readonly SynthParam[] = Object.freeze([
  { path: 'level', min: -48, max: 6, default: 0, label: 'Level', unit: 'dB' },
  { path: 'pan', min: -1, max: 1, default: 0, label: 'Pan', bipolar: true },
  { path: 'tune', min: -24, max: 24, default: 0, label: 'Tune', unit: 'st', int: true, bipolar: true },
  { path: 'fine', min: -100, max: 100, default: 0, label: 'Fine', unit: 'ct', bipolar: true },
  { path: 'start', min: 0, max: 0.99, default: 0, label: 'Start' },
  { path: 'attack', min: 0, max: 2, default: 0, label: 'Attack', unit: 's' },
  { path: 'decay', min: 0.01, max: 10, default: 10, label: 'Decay', unit: 's', log: true },
  { path: 'note', min: 0, max: 127, default: 48, label: 'Note', int: true },
  { path: 'velocity', min: 0, max: 1, default: 0.7, label: 'Velocity' },
  { path: 'choke', min: 0, max: DRUM_CHOKE_GROUPS, default: 0, label: 'Choke', int: true },
  { path: 'fx.filter.cutoff', min: 20, max: 20000, default: 20000, label: 'Cutoff', unit: 'Hz', log: true },
  { path: 'fx.filter.resonance', min: 0, max: 1, default: 0.1, label: 'Resonance' },
  { path: 'fx.drive', min: 0, max: 1, default: 0, label: 'Drive' },
  { path: 'fx.crush', min: 0, max: 1, default: 0, label: 'Crush' },
  ...Array.from({ length: DRUM_SENDS }, (_, i): SynthParam => ({ path: `sends.${i}`, min: 0, max: 1, default: 0, label: `Send ${'ABCD'[i]}` })),
]);
const PAD_BY_PATH = new Map(DRUM_PAD_PARAMS.map(p => [p.path, p]));
export const DRUM_KIT_PARAMS: readonly SynthParam[] = Object.freeze([
  { path: 'gain', min: -36, max: 12, default: 0, label: 'Kit gain', unit: 'dB' },
]);

/**
 * A kit path's parameter: `gain`, or `pads.<i>.<path>` (labelled with the pad's number), or
 * undefined.
 */
export function drumParam(path: string): SynthParam | undefined {
  if (path === 'gain') return DRUM_KIT_PARAMS[0];
  const m = /^pads\.(\d+)\.(.+)$/.exec(path);
  if (!m) return undefined;
  const i = Number(m[1]);
  const p = PAD_BY_PATH.get(m[2]!);
  if (!p || i >= DRUM_PADS) return undefined;
  return { ...p, path };
}

/** A pad's paths an automation lane can drive (on its sample): its mix, its filter and drive; the tune and decay reach the next hits. */
export const DRUM_PAD_AUTOMATABLE: readonly string[] = Object.freeze([
  'level', 'pan', 'tune', 'decay', 'fx.filter.cutoff', 'fx.filter.resonance', 'fx.drive', 'sends.0', 'sends.1', 'sends.2', 'sends.3',
]);

/** Every automatable kit path. */
export const DRUM_AUTOMATABLE: readonly string[] = Object.freeze([
  'gain',
  ...Array.from({ length: DRUM_PADS }, (_, i) => DRUM_PAD_AUTOMATABLE.map(p => `pads.${i}.${p}`)).flat(),
]);

/** The pad index and its own path from a kit path (`pads.3.level` → [3, 'level']), or null. */
export function splitPadPath(path: string): [number, string] | null {
  const m = /^pads\.(\d+)\.(.+)$/.exec(path);
  if (!m) return null;
  const i = Number(m[1]);
  return i < DRUM_PADS ? [i, m[2]!] : null;
}

// --- Defaults and sanitising -----------------------------------------------------------------

export function defaultPadFx(): DrumPadFx {
  return { filter: { type: 'off', cutoff: 20000, resonance: 0.1 }, drive: 0, crush: 0 };
}

/** An empty pad, named after its General MIDI note. */
export function emptyPad(i: number): DrumPad {
  return {
    name: GM_DRUM_NAMES[i] ?? `Pad ${i + 1}`,
    color: DRUM_PAD_COLORS[i] ?? '0 0% 60%',
    source: 'empty',
    sample: null, start: 0, reverse: false, gate: false,
    tune: 0, fine: 0, attack: 0, decay: 10,
    fm: null, analog: null, note: 48,
    level: 0, pan: 0, velocity: 0.7, mute: false, solo: false, choke: 0,
    sends: Array.from({ length: DRUM_SENDS }, () => 0),
    fx: defaultPadFx(),
  };
}

/** A kit of sixteen empty pads. */
export function emptyDrumKit(): DrumKit {
  return { version: 1, pads: Array.from({ length: DRUM_PADS }, (_, i) => emptyPad(i)), gain: 0 };
}

/** A sample for `kitOfSamples`: an upload by hash, with what the pad it goes on plays it with. */
export interface KitSample {
  hash: string;
  /** The file's name (the pad's sample). */
  fileName: string;
  /** The pad's name. */
  name: string;
  /** dB (clamped to the pad's range). */
  level?: number;
  reverse?: boolean;
  /** Choke group (0: none). */
  choke?: number;
  /** Semitones, fractional (the whole ones go on `tune`, the rest on `fine`). */
  pitch?: number;
}

/**
 * A kit of up to sixteen samples, one per pad from pad 1, each starting at its beginning; the rest
 * of the pads empty (1.81: the Slicer's Send to DAW as a Drum Rack). Sanitised.
 */
export function kitOfSamples(samples: readonly KitSample[]): DrumKit {
  const kit = emptyDrumKit();
  samples.slice(0, DRUM_PADS).forEach((s, i) => {
    const pitch = Number.isFinite(s.pitch) ? s.pitch! : 0;
    const tune = Math.round(pitch);
    kit.pads[i] = {
      ...kit.pads[i]!, source: 'sample', sample: { hash: s.hash, name: s.fileName }, name: s.name, start: 0,
      level: s.level ?? 0, reverse: !!s.reverse, choke: s.choke ?? 0, tune, fine: Math.round((pitch - tune) * 100),
    };
  });
  return sanitiseDrumKit(kit);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HASH_RE = /^[a-f0-9]{64}$/;
const COLOR_RE = /^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;

/** A pad from anything: every field present and in range; only its source's voice kept. */
export function sanitiseDrumPad(raw: unknown, i: number): DrumPad {
  const r = isObj(raw) ? raw : {};
  const d = emptyPad(i);
  let out: DrumPad = { ...d };
  for (const p of DRUM_PAD_PARAMS) out = setPath(out, p.path, clampParam(p, getPath(r, p.path)));
  out.name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().replace(/\s+/g, ' ').slice(0, 24) : d.name;
  out.color = typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color : d.color;
  out.source = (DRUM_SOURCES as readonly unknown[]).includes(r.source) ? r.source as DrumSource : 'empty';
  const s = isObj(r.sample) ? r.sample : null;
  out.sample = s && typeof s.hash === 'string' && HASH_RE.test(s.hash)
    ? { hash: s.hash, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : 'Sample' }
    : null;
  out.reverse = r.reverse === true;
  out.gate = r.gate === true;
  out.mute = r.mute === true;
  out.solo = r.solo === true;
  const fx = isObj(r.fx) ? r.fx : {};
  const filter = isObj(fx.filter) ? fx.filter : {};
  out.fx = { ...out.fx, filter: { ...out.fx.filter, type: (DRUM_FILTER_TYPES as readonly unknown[]).includes(filter.type) ? filter.type as DrumFilterType : 'off' } };
  // Only the source's own voice is kept (a kit carries sixteen; the others would be dead weight).
  out.fm = out.source === 'fm' ? sanitiseFmPatch(r.fm) : null;
  out.analog = out.source === 'analog' ? sanitiseSynthPatch(r.analog) : null;
  // 1.372: the 8-BIT voice, the pitch mode, the pad's inserts and rack sends, each written only when there is one.
  if (out.source === 'chip') out.chip = sanitiseChipPatch(r.chip);
  if (r.pitch === 'played' && isDrumVoice(out.source)) out.pitch = 'played';
  const inserts = sanitiseShortChain(r.inserts, DRUM_PAD_MAX_INSERTS);
  if (inserts.length) out.inserts = inserts;
  const rs = Array.isArray(r.rackSends) ? r.rackSends : isObj(r.rackSends) ? Array.from({ length: DRUM_RACK_RETURNS }, (_, k) => (r.rackSends as Record<string, unknown>)[k]) : [];
  const rackSends = Array.from({ length: DRUM_RACK_RETURNS }, (_, k) => { const v = rs[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; });
  if (rackSends.some(v => v > 0)) out.rackSends = rackSends;
  // 1.111: layers only on a sample pad with its sample; clamped, contiguous, layer 1 its sample.
  const layers = out.source === 'sample' && out.sample ? sanitisePadLayers(r.layers, out.sample) : null;
  if (layers) out.layers = layers;
  return out;
}

const sampleOf = (v: unknown): { hash: string; name: string } | null => {
  if (!isObj(v) || typeof v.hash !== 'string' || !HASH_RE.test(v.hash)) return null;
  return { hash: v.hash, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : 'Sample' };
};
const vel = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(127, Math.round(v))) : d);

/**
 * 1.111: a sample pad's layers from anything: at most `MAX_PAD_LAYERS` with a sample, in order of
 * their `from`, made contiguous over 1…127 (the first from 1, the last to 127, each to the next's
 * `from` − 1, each at least one velocity wide); layer 1's sample is the pad's (`first`). Null when
 * fewer than two remain (one layer is the pad's sample alone).
 */
export function sanitisePadLayers(raw: unknown, first: { hash: string; name: string }): DrumPadLayer[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.flatMap(l => {
    if (!isObj(l)) return [];
    const sample = sampleOf(l.sample);
    return sample ? [{ sample, from: vel(l.from, 1), to: vel(l.to, 127) }] : [];
  }).slice(0, MAX_PAD_LAYERS);
  if (list.length < 2) return null;
  // Layer 1 stays first (it is the pad's sample); the others in order of where they start.
  const [head, ...rest] = list;
  rest.sort((a, b) => a.from - b.from);
  const out = [head!, ...rest];
  const n = out.length;
  // Each layer starts after the one before (at least one velocity each) and leaves room for those after it.
  const starts: number[] = [];
  for (let k = 0; k < n; k++) {
    if (k === 0) { starts.push(1); continue; }
    const lo = starts[k - 1]! + 1;
    const hi = 127 - (n - 1 - k);
    starts.push(Math.max(lo, Math.min(hi, out[k]!.from)));
  }
  return out.map((l, k) => ({
    sample: k === 0 ? { ...first } : l.sample,
    from: starts[k]!,
    to: k + 1 < n ? starts[k + 1]! - 1 : 127,
  }));
}

/** 1.111: the sample a hit of `velocity` plays on a pad: the layer whose range holds it, else the pad's sample. */
export function layerSample(p: Pick<DrumPad, 'sample' | 'layers'>, velocity: number): { hash: string; name: string } | null {
  if (!p.layers?.length) return p.sample;
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  return p.layers.find(l => v >= l.from && v <= l.to)?.sample ?? p.sample;
}

/** A kit from anything (projects, live sessions, presets): sixteen pads, every field in range. */
export function sanitiseDrumKit(raw: unknown): DrumKit {
  const r = isObj(raw) ? raw : {};
  const pads = Array.isArray(r.pads) ? r.pads : [];
  const gain = clampParam(DRUM_KIT_PARAMS[0]!, r.gain);
  const kit: DrumKit = { version: 1, pads: Array.from({ length: DRUM_PADS }, (_, i) => sanitiseDrumPad(pads[i], i)), gain };
  // 1.372: the rack's returns, kept only when edited (absent: the defaults).
  const returns = sanitiseDrumReturns(r.returns);
  if (returns) kit.returns = returns;
  return kit;
}

/** A kit with one value changed (`gain`, or `pads.<i>.<path>`), sanitised. */
export function setDrumValue(kit: DrumKit, path: string, value: unknown): DrumKit {
  const split = splitPadPath(path);
  if (!split) return path === 'gain' ? { ...kit, gain: clampParam(DRUM_KIT_PARAMS[0]!, value) } : kit;
  const [i, rel] = split;
  const pads = kit.pads.slice();
  pads[i] = sanitiseDrumPad(setPath(kit.pads[i], rel, value), i);
  return { ...kit, pads };
}

/** A kit with pad `i` replaced (sanitised). */
export function setDrumPad(kit: DrumKit, i: number, pad: unknown): DrumKit {
  if (i < 0 || i >= DRUM_PADS) return kit;
  const pads = kit.pads.slice();
  pads[i] = sanitiseDrumPad(pad, i);
  return { ...kit, pads };
}

/** The uploads a kit plays (its sample pads' hashes). */
export function kitHashes(kit: DrumKit): string[] {
  return kit.pads.flatMap(p => (p.source === 'sample' && p.sample ? [p.sample.hash, ...(p.layers ?? []).slice(1).map(l => l.sample.hash)] : []));
}

/** Whether a pad makes a sound at all (it has a source, and a sample when that is its source). */
export function padHasSound(p: DrumPad): boolean {
  return isDrumVoice(p.source) || (p.source === 'sample' && !!p.sample);
}

/** 1.372: a pad's voice patch (FM, ANALOG or 8-BIT), or null for a sample or an empty pad. */
export function padVoice(p: DrumPad): FmPatch | SynthPatch | ChipPatch | null {
  return p.source === 'fm' ? p.fm : p.source === 'analog' ? p.analog : p.source === 'chip' ? p.chip ?? null : null;
}

/**
 * 1.372: a pad holding an instrument (a Browser instrument or sound dropped on it, `deviceDropPlan`'s
 * `padInstrument`): its source and voice; a melodic patch plays the note that hit the pad (`pitch:
 * 'played'`) from C3 (60) as the pad's note; the pad's mix, effects, choke and name stay.
 */
export function padWithInstrument(p: DrumPad, i: number, source: DrumVoiceSource, patch: unknown, name?: string): DrumPad {
  const { fm: _f, analog: _a, chip: _c, ...rest } = p;
  return sanitiseDrumPad({ ...rest, source, [source]: patch, pitch: 'played', note: 60, ...(name ? { name } : {}) }, i);
}

/** Whether a pad is heard now (not muted, and soloed when any pad is). */
export function padAudibleIn(kit: DrumKit, i: number): boolean {
  const p = kit.pads[i];
  if (!p || p.mute) return false;
  return !kit.pads.some(x => x.solo) || p.solo;
}

// --- What a hit plays (pure: the rack node and the tests use these) ----------------------------

/** A sample hit's playback rate: its tune and fine. */
export function padRate(p: Pick<DrumPad, 'tune' | 'fine'>): number {
  return Math.pow(2, (p.tune + p.fine / 100) / 12);
}

/** A hit's level (linear) from its velocity and the pad's velocity amount (not the pad's level). */
export function hitLevel(p: Pick<DrumPad, 'velocity'>, velocity: number): number {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  return 1 - p.velocity + p.velocity * v * v;
}

/** The velocity a voice pad's FM or ANALOG patch is given: at amount 0 every hit is full. */
export function voiceVelocity(p: Pick<DrumPad, 'velocity'>, velocity: number): number {
  const v = Math.max(1, Math.min(127, velocity));
  return Math.max(1, Math.min(127, Math.round(127 - p.velocity * (127 - v))));
}

/** The note a voice pad plays for a hit: its note and tune; 1.372, with `pitch: 'played'`, the note that hit it and tune. */
export function voiceNote(p: Pick<DrumPad, 'note' | 'tune'> & Pick<Partial<DrumPad>, 'pitch'>, played?: number): number {
  const base = p.pitch === 'played' && typeof played === 'number' ? played : p.note;
  return Math.max(0, Math.min(127, Math.round(base + p.tune)));
}

/**
 * The bit crusher's step count for an amount: 0 is off (no crusher), 1 is two bits. Between, the
 * bits fall from 12 evenly.
 */
export function crushSteps(amount: number): number {
  if (amount <= 0) return 0;
  const bits = 12 - Math.min(1, amount) * 10;
  return Math.pow(2, bits);
}

// --- Pad moves (1.111: copy, paste, cut and swap are whole-pad writes) ---------------------------

/** A kit with pads `a` and `b` swapped, whole (sound, name, colour, mix, effects, layers); the same kit when they are one pad or out of range. */
export function swapDrumPads(kit: DrumKit, a: number, b: number): DrumKit {
  if (a === b || a < 0 || b < 0 || a >= DRUM_PADS || b >= DRUM_PADS) return kit;
  const pads = kit.pads.slice();
  pads[a] = sanitiseDrumPad(kit.pads[b], a);
  pads[b] = sanitiseDrumPad(kit.pads[a], b);
  return { ...kit, pads };
}

/** A kit with pad `from` copied onto pad `to` (the copy is whole); the same kit when they are one pad or out of range. */
export function copyDrumPad(kit: DrumKit, from: number, to: number): DrumKit {
  if (from === to || from < 0 || from >= DRUM_PADS) return kit;
  return setDrumPad(kit, to, kit.pads[from]);
}

/**
 * 1.364 (stream 17): a kit with `pad` pasted onto every pad of `onto` (each a whole copy, named and
 * placed as that pad's own: `sanitiseDrumPad` gives each its index); the same kit when nothing is in range.
 */
export function pasteDrumPadOnto(kit: DrumKit, pad: unknown, onto: readonly number[]): DrumKit {
  const at = [...new Set(onto)].filter(i => Number.isInteger(i) && i >= 0 && i < DRUM_PADS);
  if (!at.length) return kit;
  const pads = kit.pads.slice();
  for (const i of at) pads[i] = sanitiseDrumPad(JSON.parse(JSON.stringify(pad)) as unknown, i);
  return { ...kit, pads };
}

/**
 * 1.364: where Duplicate puts pad `from`: the next pad after it with no sound (wrapping round the
 * sixteen), or null when every other pad sounds (Live's Duplicate fills the next free pad).
 */
export function duplicateTarget(kit: DrumKit, from: number): number | null {
  for (let k = 1; k < DRUM_PADS; k++) {
    const i = (from + k) % DRUM_PADS;
    const p = kit.pads[i];
    if (p && !padHasSound(p)) return i;
  }
  return null;
}

// --- Velocity layers (1.111) -------------------------------------------------------------------

/** A pad's layers as the editor shows them: its own when it has some, else its sample alone over 1…127. */
export function padLayers(p: Pick<DrumPad, 'sample' | 'layers'>): DrumPadLayer[] {
  if (p.layers?.length) return p.layers;
  return p.sample ? [{ sample: p.sample, from: 1, to: 127 }] : [];
}

/** A pad with `layers` written back (sanitised): layer 1 is the pad's sample; one layer is none. */
function withLayers(p: DrumPad, layers: DrumPadLayer[], i: number): DrumPad {
  const first = layers[0];
  if (!first) return p;
  const { layers: _old, ...rest } = p;
  void _old;
  return sanitiseDrumPad({ ...rest, sample: first.sample, ...(layers.length > 1 ? { layers } : {}) }, i);
}

/**
 * A sample pad with one more layer, `sample`, at the top: it takes the upper half of the top
 * layer's range. The same pad when it has no sample, already has `MAX_PAD_LAYERS`, or its top
 * layer is a single velocity.
 */
export function addPadLayer(p: DrumPad, i: number, sample: { hash: string; name: string }): DrumPad {
  const list = padLayers(p);
  const top = list[list.length - 1];
  if (p.source !== 'sample' || !top || list.length >= MAX_PAD_LAYERS || top.to - top.from < 1) return p;
  const mid = Math.ceil((top.from + top.to) / 2);
  return withLayers(p, [...list.slice(0, -1), { ...top, to: mid - 1 }, { sample, from: mid, to: 127 }], i);
}

/** A pad with layer `k`'s sample replaced (layer 1's is the pad's own). */
export function setLayerSample(p: DrumPad, i: number, k: number, sample: { hash: string; name: string }): DrumPad {
  const list = padLayers(p);
  if (!list[k]) return p;
  return withLayers(p, list.map((l, j) => (j === k ? { ...l, sample } : l)), i);
}

/** A pad without layer `k`: its range goes to the layer below it (layer 1's to the next, whose sample becomes the pad's). */
export function removePadLayer(p: DrumPad, i: number, k: number): DrumPad {
  const list = padLayers(p);
  if (list.length < 2 || !list[k]) return p;
  const rest = list.filter((_, j) => j !== k);
  if (k === 0) rest[0] = { ...rest[0]!, from: 1 };
  else rest[k - 1] = { ...rest[k - 1]!, to: list[k]!.to };
  return withLayers(p, rest, i);
}

/**
 * A pad with the split below layer `k` (k ≥ 1) at velocity `from`: layer `k` starts there and
 * the one below ends just before; each keeps at least one velocity.
 */
export function movePadSplit(p: DrumPad, i: number, k: number, from: number): DrumPad {
  const list = padLayers(p);
  const lo = list[k - 1], hi = list[k];
  if (k < 1 || !lo || !hi) return p;
  const v = Math.max(lo.from + 1, Math.min(hi.to, Math.round(from)));
  if (v === hi.from) return p;
  return withLayers(p, list.map((l, j) => (j === k - 1 ? { ...l, to: v - 1 } : j === k ? { ...l, from: v } : l)), i);
}
