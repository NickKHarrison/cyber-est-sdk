import { defaultSynthPatch, getPath, sanitiseSynthPatch, setPath, type SynthPatch } from '../synth/synthTypes';
import { defaultFmPatch, sanitiseFmPatch, type FmPatch } from '../fm/fmTypes';
import { defaultChipPatch, sanitiseChipPatch, type ChipPatch } from '../chip/chipTypes';
import { defaultWavePatch, sanitiseWavePatch, type WavePatch } from '../wave/waveTypes';
import { defaultSamplerPatch, samplerHashes, sanitiseSamplerPatch, type SamplerPatch } from '../sampler/samplerTypes';
import { hash32, hashString, sanitiseMidiFxList, type MidiFx } from '../../sequencer/midiFx';
import { sanitiseFx, takesKey, type FxSlot } from '../mixer/fxDefs';
import { FULL_SEL, RACK_SEL_MAX, distributedZones, isFullSel, sanitiseZone, zoneGain, type RackZone } from './zones';
import { MACROS_DEFAULT, MACROS_MAX, MACRO_INDEX_RE, macroListLength, sanitiseMacroCount, stepMacroCount } from './macroCount';

export { FULL_SEL, RACK_SEL_MAX, sanitiseZone, zoneGain, type RackZone };

/**
 * 1.356 (Cyber_Instruments_MIDI_Work_Order.md, stream 9; Cyber_Instrument_Rack_Design.md): the
 * **Instrument Rack**, Live's: up to eight chains on one synth track (`engine: 'rack'`), each a
 * Cyber engine with its own patch, a key zone and a velocity zone (with fades), a volume, pan,
 * mute and solo; eight macros, each mapped to any chains' parameters with a range. Pure: the model,
 * its sanitiser, the routing of a note to the chains and the macros applied to the chains' patches,
 * so the live node (`rackNode.ts`) and the offline render ask the same thing.
 */

/**
 * The engines a chain plays: 1.356's worklet engines (ANALOG, FM, 8-BIT) and, since 1.371 (part 3,
 * stream 4), WAVE (its tables asked for through the chain's own port) and the SAMPLER (a native
 * node on an upload). An EST instrument chain is a later release (Cyber_Instrument_Rack_Design.md §7).
 */
export type RackChainEngine = 'analog' | 'fm' | 'chip' | 'wave' | 'sampler';
export const RACK_CHAIN_ENGINES: readonly RackChainEngine[] = ['analog', 'wave', 'sampler', 'fm', 'chip'];
export const RACK_ENGINE_NAMES: Readonly<Record<RackChainEngine, string>> = { analog: 'ANALOG', wave: 'WAVE', sampler: 'SAMPLER', fm: 'FM', chip: '8-BIT' };
export const isRackChainEngine = (e: unknown): e is RackChainEngine => e === 'analog' || e === 'fm' || e === 'chip' || e === 'wave' || e === 'sampler';
/** 1.371: a chain's own audio inserts, at most (a short chain: the track's strip has its six). */
export const RACK_MAX_CHAIN_FX = 4;

export const RACK_MAX_CHAINS = 8;
/** The macros a rack shows by default (every rack before 1.600) and its macro list's least length. */
export const RACK_MACROS = MACROS_DEFAULT;
/** 1.600: the most macros a rack holds (Live 13's 32). */
export const RACK_MAX_MACROS = MACROS_MAX;
export const RACK_MAX_MAPS = 8;
export const RACK_MIN_DB = -60;
export const RACK_MAX_DB = 6;


export type RackChainPatch = SynthPatch | FmPatch | ChipPatch | WavePatch | SamplerPatch;

export interface RackChain {
  id: string;
  name: string;
  engine: RackChainEngine;
  patch: RackChainPatch;
  key: RackZone;
  vel: RackZone;
  /** dB, RACK_MIN_DB (silent) … RACK_MAX_DB. */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /**
   * 1.371: the chain's own MIDI effects (computed only by `midiFx.ts`' `runMidiFx`, in `rackNode.ts`
   * for live and offline alike), after the track's; absent: none (as 1.356 saved).
   */
  midiFx?: MidiFx[];
  /** 1.371: the chain's own audio inserts (built-in types, no sidechain key), before its volume and pan; absent: none. */
  fx?: FxSlot[];
  /**
   * 1.386: the chain's **select zone** (Live's Chain Select): the chain selector's values 0–127
   * that reach it, with fades. Absent: the whole range (every chain hears every selector value, as
   * before 1.386).
   */
  sel?: RackZone;
}

/** A macro's mapping: a chain's numeric parameter, set to `min + value · (max − min)`. */
export interface RackMap { chain: string; param: string; min: number; max: number }
export interface RackMacro {
  name: string; value: number; maps: RackMap[];
  /** 1.386: left alone by Randomize (Live's "exclude from randomization"); absent: false. */
  exclude?: boolean;
}

/** 1.386: a macro variation, Live's: the macros' values kept under a name, recalled in one click (1.600: as many values as the rack's macros when stored). */
export interface RackVariation { name: string; values: number[] }
export const RACK_MAX_VARIATIONS = 16;

export interface RackPatch {
  v: 1;
  chains: RackChain[];
  macros: RackMacro[];
  /** The chain the view shows (an index into `chains`). */
  selected: number;
  /** 1.386: the chain selector, 0–RACK_SEL_MAX (absent: 0). Read through `rackSelector`. */
  selector?: number;
  /** 1.386: the macro (0–7; 1.600: 0–31) that sets the chain selector (its value × 127), so its lane and MIDI learn sweep the chains; absent: none. */
  selectorMacro?: number;
  /** 1.600: the macros shown (Show macros: 1, 2, 4, 8, 16 or 32; `macroCount.ts`); absent: 8. Read through `rackMacroCount`. */
  macroCount?: number;
  /** 1.386: the macro variations (at most RACK_MAX_VARIATIONS); absent: none. */
  variations?: RackVariation[];
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(clamp(v, lo, hi, d));
const text = (v: unknown, d: string, max = 24) => {
  if (typeof v !== 'string') return d;
  // Control characters out, as every name the app keeps.
  let out = '';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  return out.trim().slice(0, max) || d;
};
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
let idN = 0;
/** A new chain id. */
export const newChainId = (): string => `ch${Date.now().toString(36).slice(-4)}${(++idN % 1e6).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A chain's patch for its engine, through that engine's own sanitiser. */
export function sanitiseChainPatch(engine: RackChainEngine, raw: unknown): RackChainPatch {
  switch (engine) {
    case 'fm': return sanitiseFmPatch(raw);
    case 'chip': return sanitiseChipPatch(raw);
    case 'wave': return sanitiseWavePatch(raw);
    case 'sampler': return sanitiseSamplerPatch(raw);
    case 'analog': return sanitiseSynthPatch(raw);
  }
}
/** An engine's default patch. */
export function defaultChainPatch(engine: RackChainEngine): RackChainPatch {
  switch (engine) {
    case 'fm': return defaultFmPatch();
    case 'chip': return defaultChipPatch();
    case 'wave': return defaultWavePatch();
    case 'sampler': return defaultSamplerPatch();
    case 'analog': return defaultSynthPatch();
  }
}

/** 1.371: a chain's inserts: built-in types only (an EST insert is the track's), no key (it names a track), at most RACK_MAX_CHAIN_FX, unique ids. */
export function sanitiseChainFx(raw: unknown): FxSlot[] {
  const out: FxSlot[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= RACK_MAX_CHAIN_FX) break;
    const f = sanitiseFx(r);
    if (!f || f.type === 'est' || f.type === 'fxRack' || seen.has(f.id)) continue; // 1.543: no Audio Effect Rack in a short chain
    seen.add(f.id);
    if (takesKey(f.type)) { const { keyTrackId: _k, ...rest } = f; out.push(f.type === 'cyberComp' ? rest : { ...rest, keyTrackId: null }); } else out.push(f);
  }
  return out;
}

/** A new chain of `engine` (its patch the engine's default unless given), the whole keyboard and every velocity. */
export function makeChain(engine: RackChainEngine, patch?: unknown, name?: string, id = newChainId()): RackChain {
  return {
    id, name: name ?? RACK_ENGINE_NAMES[engine], engine,
    patch: patch === undefined ? defaultChainPatch(engine) : sanitiseChainPatch(engine, patch),
    key: { lo: 0, hi: 127, fadeLo: 0, fadeHi: 0 }, vel: { lo: 1, hi: 127, fadeLo: 0, fadeHi: 0 },
    volume: 0, pan: 0, mute: false, solo: false,
  };
}

function sanitiseChain(raw: unknown, seen: Set<string>): RackChain | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isRackChainEngine(r.engine)) return null;
  let id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : newChainId();
  while (seen.has(id)) id = newChainId();
  seen.add(id);
  const chain: RackChain = {
    id, name: text(r.name, RACK_ENGINE_NAMES[r.engine]), engine: r.engine, patch: sanitiseChainPatch(r.engine, r.patch),
    key: sanitiseZone(r.key, 0, 127), vel: sanitiseZone(r.vel, 1, 127),
    volume: clamp(r.volume, RACK_MIN_DB, RACK_MAX_DB, 0), pan: clamp(r.pan, -1, 1, 0), mute: r.mute === true, solo: r.solo === true,
  };
  // 1.371: written only when there are some, so a 1.356 rack is read back as it was saved.
  // 1.397: a chain's MIDI effects take no Step Sequencer (a chain hears held notes only: `rackNode.ts` runs no step runner).
  const midiFx = sanitiseMidiFxList(r.midiFx).filter(f => f.type !== 'steps');
  if (midiFx.length) chain.midiFx = midiFx;
  const fx = sanitiseChainFx(r.fx);
  if (fx.length) chain.fx = fx;
  // 1.386: written only when it is not the whole range, so a rack without select zones reads back as saved.
  if (r.sel !== undefined) { const sel = sanitiseZone(r.sel, 0, RACK_SEL_MAX); if (!isFullSel(sel)) chain.sel = sel; }
  return chain;
}

/** Whether `param` is a numeric parameter of `patch` (a path to a finite number). */
export const isNumericParam = (patch: unknown, param: string): boolean => /^[A-Za-z0-9_.]{1,80}$/.test(param) && typeof getPath(patch, param) === 'number' && Number.isFinite(getPath(patch, param) as number);

function sanitiseMacro(raw: unknown, i: number, chains: readonly RackChain[]): RackMacro {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const maps: RackMap[] = [];
  for (const m of Array.isArray(r.maps) ? r.maps : []) {
    if (maps.length >= RACK_MAX_MAPS || !m || typeof m !== 'object') continue;
    const x = m as Record<string, unknown>;
    const chain = chains.find(c => c.id === x.chain);
    if (!chain || typeof x.param !== 'string' || !isNumericParam(chain.patch, x.param)) continue;
    const min = clamp(x.min, -1e6, 1e6, 0), max = clamp(x.max, -1e6, 1e6, 1);
    maps.push({ chain: chain.id, param: x.param, min, max });
  }
  return { name: text(r.name, `Macro ${i + 1}`, 16), value: clamp(r.value, 0, 1, 0), maps, ...(r.exclude === true ? { exclude: true } : {}) };
}

/** 1.386: a variation from anything: a name and its values 0…1 (a missing one 0): eight at least (1.386's), 32 at most (1.600). */
function sanitiseVariation(raw: unknown, i: number): RackVariation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const vals = Array.isArray(r.values) ? r.values : [];
  const n = Math.max(RACK_MACROS, Math.min(RACK_MAX_MACROS, vals.length));
  return { name: text(r.name, `Variation ${i + 1}`, 24), values: Array.from({ length: n }, (_, k) => Math.round(clamp(vals[k], 0, 1, 0) * 1000) / 1000) };
}

/** 1.600: whether a macro holds nothing (its default name, at 0, no maps, not excluded): a hidden one past the eighth is then let go. */
const isDefaultMacro = (m: RackMacro, i: number): boolean => m.name === `Macro ${i + 1}` && m.value === 0 && !m.maps.length && !m.exclude;

/** A rack's patch from anything (a song, a peer, a preset): its limits applied; never fewer than one chain. */
export function sanitiseRackPatch(raw: unknown): RackPatch {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const seen = new Set<string>();
  const chains: RackChain[] = [];
  for (const c of Array.isArray(r.chains) ? r.chains : []) {
    if (chains.length >= RACK_MAX_CHAINS) break;
    const s = sanitiseChain(c, seen);
    if (s) chains.push(s);
  }
  if (!chains.length) chains.push(makeChain('analog'));
  const macrosRaw = Array.isArray(r.macros) ? r.macros : [];
  // 1.600: up to 32 macros, the list as long as `macroListLength` says (8 for every rack before 1.600).
  const count = sanitiseMacroCount(r.macroCount);
  const all = Array.from({ length: RACK_MAX_MACROS }, (_, i) => sanitiseMacro(macrosRaw[i], i, chains));
  const selMacro = typeof r.selectorMacro === 'number' && Number.isInteger(r.selectorMacro) && r.selectorMacro >= 0 && r.selectorMacro < RACK_MAX_MACROS ? r.selectorMacro : undefined;
  const macros = all.slice(0, macroListLength(count, i => i === selMacro || !isDefaultMacro(all[i]!, i)));
  const out: RackPatch = { v: 1, chains, macros, selected: int(r.selected, 0, chains.length - 1, 0) };
  // 1.386: the chain selector, its macro and the variations, each written only when set.
  const selector = int(r.selector, 0, RACK_SEL_MAX, 0);
  if (selector > 0) out.selector = selector;
  if (selMacro !== undefined) out.selectorMacro = selMacro;
  // 1.600: written only when it is not 8, so a rack from before reads back as saved.
  if (count !== RACK_MACROS) out.macroCount = count;
  const variations: RackVariation[] = [];
  for (const v of Array.isArray(r.variations) ? r.variations : []) {
    if (variations.length >= RACK_MAX_VARIATIONS) break;
    const x = sanitiseVariation(v, variations.length);
    if (x) variations.push(x);
  }
  if (variations.length) out.variations = variations;
  return out;
}

/** A rack of one chain (the default: one ANALOG chain at its default patch). */
export function defaultRackPatch(first: RackChain = makeChain('analog')): RackPatch {
  return sanitiseRackPatch({ v: 1, chains: [first], macros: [], selected: 0 });
}

// --- Routing --------------------------------------------------------------------------------------

/** A routed note: the chain (its index and id) and the gain of its zones (0…1]. */
export interface RackHit { index: number; id: string; gain: number }

/** 1.386: a chain's select zone (the whole range when it has none). */
export const chainSel = (c: Pick<RackChain, 'sel'>): RackZone => c.sel ?? FULL_SEL;

/** 1.386: a macro's value (0…1) as a selector value (0–127). */
export const selectorOfMacro = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * RACK_SEL_MAX);
/** 1.386: the chain selector now: its macro's value while one sets it, else its own (0 when absent). */
export function rackSelector(patch: Pick<RackPatch, 'selector' | 'selectorMacro' | 'macros'>): number {
  const m = patch.selectorMacro === undefined ? undefined : patch.macros[patch.selectorMacro];
  return m ? selectorOfMacro(m.value) : patch.selector ?? 0;
}

/**
 * The chains a note reaches: each whose key zone holds `pitch`, velocity zone `velocity` and
 * (1.386) select zone the chain selector `sel`, with the product of the three zones' gains (a
 * fade scales the chain's velocity); muted chains never, and while any chain is soloed only the
 * soloed ones. `sel` defaults to the patch's selector (`rackSelector`).
 */
export function rackRoute(patch: Pick<RackPatch, 'chains'> & Partial<Pick<RackPatch, 'selector' | 'selectorMacro' | 'macros'>>, pitch: number, velocity: number, sel?: number): RackHit[] {
  const s = sel ?? rackSelector({ macros: patch.macros ?? [], selector: patch.selector, selectorMacro: patch.selectorMacro });
  const soloed = patch.chains.some(c => c.solo);
  const out: RackHit[] = [];
  patch.chains.forEach((c, index) => {
    if (c.mute || (soloed && !c.solo)) return;
    const gain = zoneGain(c.key, pitch) * zoneGain(c.vel, velocity) * zoneGain(chainSel(c), s);
    if (gain > 0) out.push({ index, id: c.id, gain });
  });
  return out;
}

/**
 * 1.386: the select zones spread over 0–127 in chain order, one equal slice each (Live's
 * "Distribute ranges equally"), with `fade` steps of crossfade into each neighbour.
 */
export function distributeSelect(patch: RackPatch, fade = 0): RackPatch {
  const zones = distributedZones(patch.chains.length, fade);
  return sanitiseRackPatch({ ...patch, chains: patch.chains.map((c, i) => ({ ...c, sel: zones[i] })) });
}

/** 1.386: the selector set (0–127); while a macro sets it, that macro's value is set instead (one write either way). */
export function setRackSelector(patch: RackPatch, value: number): RackPatch {
  const v = Math.max(0, Math.min(RACK_SEL_MAX, Math.round(value)));
  if (patch.selectorMacro !== undefined) return setMacroValue(patch, patch.selectorMacro, v / RACK_SEL_MAX);
  const { selector: _s, ...rest } = patch;
  return v > 0 ? { ...rest, selector: v } : rest;
}

/** 1.386: the selector given to macro `i` (null: none). Mapping it keeps the selector where it is (the macro is set to it). */
export function mapSelectorToMacro(patch: RackPatch, i: number | null): RackPatch {
  const now = rackSelector(patch);
  const { selectorMacro: _m, selector: _s, ...rest } = patch;
  if (i === null || i < 0 || i >= patch.macros.length) return now > 0 ? { ...rest, selector: now } : rest;
  return setMacroValue({ ...rest, selectorMacro: i }, i, now / RACK_SEL_MAX);
}

// --- 1.386: macro variations and Randomize ------------------------------------------------------

/** The macros' values now, as a variation's (rounded to 0.001). */
export const macroValues = (patch: Pick<RackPatch, 'macros'>): number[] => patch.macros.map(m => Math.round(m.value * 1000) / 1000);

/** A new variation holding the macros' values (refused, the same patch, past RACK_MAX_VARIATIONS). */
export function storeVariation(patch: RackPatch, name?: string): RackPatch {
  const list = patch.variations ?? [];
  if (list.length >= RACK_MAX_VARIATIONS) return patch;
  return { ...patch, variations: [...list, { name: text(name, `Variation ${list.length + 1}`, 24), values: macroValues(patch) }] };
}

/** Variation `i`'s values back on the macros (one patch: one write, one undo step); the same patch when there is none. 1.600: a macro past the values it was stored with keeps its own. */
export function recallVariation(patch: RackPatch, i: number): RackPatch {
  const v = patch.variations?.[i];
  if (!v) return patch;
  return { ...patch, macros: patch.macros.map((m, k) => (k < v.values.length ? { ...m, value: Math.max(0, Math.min(1, v.values[k] ?? 0)) } : m)) };
}

/** Variation `i` overwritten with the macros' values now. */
export function overwriteVariation(patch: RackPatch, i: number): RackPatch {
  if (!patch.variations?.[i]) return patch;
  return { ...patch, variations: patch.variations.map((v, k) => (k === i ? { ...v, values: macroValues(patch) } : v)) };
}

export function removeVariation(patch: RackPatch, i: number): RackPatch {
  if (!patch.variations?.[i]) return patch;
  const variations = patch.variations.filter((_, k) => k !== i);
  const { variations: _v, ...rest } = patch;
  return variations.length ? { ...rest, variations } : rest;
}

export function renameVariation(patch: RackPatch, i: number, name: string): RackPatch {
  if (!patch.variations?.[i]) return patch;
  return { ...patch, variations: patch.variations.map((v, k) => (k === i ? { ...v, name: text(name, v.name, 24) } : v)) };
}

/** Macro `i` marked (or not) as left alone by Randomize. */
export function setMacroExclude(patch: RackPatch, i: number, exclude: boolean): RackPatch {
  if (i < 0 || i >= patch.macros.length) return patch;
  return { ...patch, macros: patch.macros.map((m, k) => {
    if (k !== i) return m;
    const { exclude: _e, ...rest } = m;
    return exclude ? { ...rest, exclude: true } : rest;
  }) };
}

/**
 * Randomize (Live's): every shown macro (1.600: `rackMacroCount`) not excluded gets a value drawn
 * from `seed` (one per press, so the same seed draws the same values: a test, a peer replaying a
 * write), rounded to 0.001. The excluded and the hidden keep theirs.
 */
export function randomizeMacros(patch: RackPatch, seed: number): RackPatch {
  const shown = rackMacroCount(patch);
  return { ...patch, macros: patch.macros.map((m, k) => (m.exclude || k >= shown ? m : { ...m, value: Math.round((hash32(0x7a2d, seed | 0, k) / 4294967296) * 1000) / 1000 })) };
}

// --- 1.600: Show macros (1–32) ------------------------------------------------------------------

/** The macros a rack shows (1, 2, 4, 8, 16 or 32; 8 when absent). */
export const rackMacroCount = (patch: Pick<RackPatch, 'macroCount'>): number => sanitiseMacroCount(patch.macroCount);

/** The rack showing `count` macros (snapped to an allowed count): the list grown to hold them, a hidden default one let go. */
export function setRackMacroCount(patch: RackPatch, count: number): RackPatch {
  const n = sanitiseMacroCount(count);
  const { macroCount: _c, ...rest } = patch;
  return sanitiseRackPatch(n === RACK_MACROS ? rest : { ...rest, macroCount: n });
}

/** Show macros + (`dir` 1) or − (−1), Live 13's. */
export const stepRackMacroCount = (patch: RackPatch, dir: 1 | -1): RackPatch => setRackMacroCount(patch, stepMacroCount(rackMacroCount(patch), dir));

/** The velocity a chain hears: the note's scaled by its zones' gain (at least 1). */
export const routedVelocity = (velocity: number, gain: number): number => Math.max(1, Math.min(127, Math.round(velocity * gain)));

// --- Macros ---------------------------------------------------------------------------------------

/** A macro's value at a mapping: `min + value · (max − min)`. */
export const macroValue = (m: Pick<RackMap, 'min' | 'max'>, value: number): number => m.min + Math.max(0, Math.min(1, value)) * (m.max - m.min);

/** Each chain's patch as it plays: every macro's maps applied (in macro order, a later map of one path winning), then the engine's sanitiser. */
export function rackChainPatches(patch: RackPatch): RackChainPatch[] {
  return patch.chains.map(c => {
    let p: RackChainPatch = c.patch;
    let touched = false;
    for (const m of patch.macros) for (const map of m.maps) {
      if (map.chain !== c.id || !isNumericParam(p, map.param)) continue;
      p = setPath(p, map.param, macroValue(map, m.value));
      touched = true;
    }
    return touched ? sanitiseChainPatch(c.engine, p) : c.patch;
  });
}

// --- Edits (each a new patch) ----------------------------------------------------------------------

export function addChain(patch: RackPatch, chain: RackChain): RackPatch | null {
  if (patch.chains.length >= RACK_MAX_CHAINS) return null;
  return { ...patch, chains: [...patch.chains, chain], selected: patch.chains.length };
}

export function removeChain(patch: RackPatch, id: string): RackPatch {
  if (patch.chains.length <= 1) return patch;
  const chains = patch.chains.filter(c => c.id !== id);
  // A macro's maps to the chain go with it.
  const macros = patch.macros.map(m => ({ ...m, maps: m.maps.filter(x => x.chain !== id) }));
  return { ...patch, chains, macros, selected: Math.min(patch.selected, chains.length - 1) };
}

export function updateChain(patch: RackPatch, id: string, change: Partial<Omit<RackChain, 'id' | 'engine'>>): RackPatch {
  return sanitiseRackPatch({ ...patch, chains: patch.chains.map(c => (c.id === id ? { ...c, ...change } : c)) });
}

export function setMacroValue(patch: RackPatch, i: number, value: number): RackPatch {
  if (i < 0 || i >= patch.macros.length) return patch;
  return { ...patch, macros: patch.macros.map((m, k) => (k === i ? { ...m, value: Math.max(0, Math.min(1, value)) } : m)) };
}

/** A mapping added to macro `i` (refused, the same patch, past RACK_MAX_MAPS or for a path that is not a number of that chain). */
export function addMacroMap(patch: RackPatch, i: number, map: RackMap): RackPatch {
  const m = patch.macros[i];
  const chain = patch.chains.find(c => c.id === map.chain);
  if (!m || !chain || m.maps.length >= RACK_MAX_MAPS || !isNumericParam(chain.patch, map.param)) return patch;
  return { ...patch, macros: patch.macros.map((x, k) => (k === i ? { ...x, maps: [...x.maps.filter(y => !(y.chain === map.chain && y.param === map.param)), map] } : x)) };
}

export function removeMacroMap(patch: RackPatch, i: number, at: number): RackPatch {
  return { ...patch, macros: patch.macros.map((x, k) => (k === i ? { ...x, maps: x.maps.filter((_, n) => n !== at) } : x)) };
}

/** "Group into Rack": a track's own instrument as a rack of one chain (null for an engine a chain cannot play). */
export function groupIntoRack(engine: string, patch: unknown, name?: string): RackPatch | null {
  if (!isRackChainEngine(engine)) return null;
  return defaultRackPatch(makeChain(engine, patch, name));
}

/** A split at `pitch`: the first chain below it, the second from it up (Live's "split at C4"). */
export function splitAt(patch: RackPatch, pitch: number): RackPatch {
  if (patch.chains.length < 2) return patch;
  const [a, b] = patch.chains;
  const p = Math.max(1, Math.min(127, Math.round(pitch)));
  return sanitiseRackPatch({ ...patch, chains: patch.chains.map(c => (c === a ? { ...c, key: { lo: 0, hi: p - 1, fadeLo: 0, fadeHi: 0 } } : c === b ? { ...c, key: { lo: p, hi: 127, fadeLo: 0, fadeHi: 0 } } : c)) });
}

/** The patch's upload hashes: 1.371, each SAMPLER chain's sample (pinned, saved and counted as a SAMPLER track's). */
export const rackHashes = (patch: RackPatch): string[] => patch.chains.flatMap(c => (c.engine === 'sampler' ? samplerHashes(c.patch as SamplerPatch) : []));

// --- 1.371: reorder, macros as lanes, chain MIDI effects, presets ---------------------------------

/** The chains with the one at `from` moved to `to` (the selection follows its chain); the same patch when nothing moves. */
export function moveChain(patch: RackPatch, from: number, to: number): RackPatch {
  const n = patch.chains.length;
  if (from < 0 || from >= n) return patch;
  const t = Math.max(0, Math.min(n - 1, Math.round(to)));
  if (t === from) return patch;
  const chains = [...patch.chains];
  const [c] = chains.splice(from, 1);
  chains.splice(t, 0, c!);
  const sel = patch.chains[patch.selected];
  return { ...patch, chains, selected: Math.max(0, chains.findIndex(x => x === sel)) };
}

/**
 * A macro's lane (and controller) target: the track's synth target `{ kind: 'synth', param:
 * 'macros.N.value' }`, N 0–7 (1.600: 0–31; decided 1.371: the existing target shape, so lanes, MIDI
 * learn, the lane picker and the live room need no new kind). Its value is 0…1.
 */
export const rackMacroPath = (i: number): string => `macros.${i}.value`;
const MACRO_PATH_RE = new RegExp(`^macros\\.${MACRO_INDEX_RE}\\.value$`);
/** The macro a lane's path names, or -1. */
export function rackMacroIndex(path: string): number {
  const m = MACRO_PATH_RE.exec(path);
  return m ? Number(m[1]) : -1;
}

/** What a macro at `value` sets on the chains: each map's chain and path with its value (an automation lane's `param` messages, routed). */
export function macroParamMessages(patch: Pick<RackPatch, 'chains' | 'macros'>, i: number, value: number): { chain: string; path: string; value: number }[] {
  const m = patch.macros[i];
  if (!m) return [];
  return m.maps.filter(x => patch.chains.some(c => c.id === x.chain)).map(x => ({ chain: x.chain, path: x.param, value: macroValue(x, value) }));
}

/**
 * The key a chain's Random MIDI effect draws from for a note: the chain, the pitch and the time in
 * ms. The node is handed the same messages live and offline, so a render draws as playback did.
 */
export const chainFxKey = (chainId: string, pitch: number, when: number): number => hash32(hashString(chainId), pitch, Math.round(Math.max(0, when) * 1000));

/** A rack preset (1.371: Sounds → My racks): the rack's patch, sanitised as a song's. */
export interface RackPresetBody { v: 1; rack: RackPatch }
export function sanitiseRackPresetBody(raw: unknown): RackPresetBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const rack = (raw as { rack?: unknown }).rack;
  if (!rack || typeof rack !== 'object' || !Array.isArray((rack as { chains?: unknown }).chains)) return null;
  return { v: 1, rack: sanitiseRackPatch(rack) };
}
/** A rack preset from a rack (deep-copied). */
export const rackPresetOf = (rack: RackPatch): RackPresetBody => ({ v: 1, rack: sanitiseRackPatch(JSON.parse(JSON.stringify(rack))) });
