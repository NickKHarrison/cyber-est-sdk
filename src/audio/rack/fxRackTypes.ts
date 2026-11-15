import type { FxSlot } from '../mixer/fxDefs';
import { FULL_SEL, RACK_SEL_MAX, distributedZones, isFullSel, sanitiseZone, zoneGain, type RackZone } from './zones';
import { MACROS_DEFAULT, MACROS_MAX, MACRO_INDEX_RE, macroListLength, sanitiseMacroCount, stepMacroCount } from './macroCount';

/**
 * 1.543: Live's **Audio Effect Rack**, an insert of type `'fxRack'` (the last item of 1.486's
 * Live-parity audit, ⌘G). Up to eight parallel chains, each its own list of built-in inserts with a
 * volume, pan, mute, solo and a chain select zone (0–127, as the Instrument Rack's, 1.386); eight
 * macros, each mapped to chain inserts' automatable parameters with a range. Pure: the model, its
 * sanitiser, the macros applied to the chains' slots, the chains' gains, latency compensation and
 * the edits (Group and Ungroup among them), so the live strip and every offline render (export,
 * freeze, bounce: all `renderArrangement`, which builds the same `Strip`) build the rack from one
 * model through `src/audio/mixer/fxRack.ts`.
 *
 * Where the values live: the macros' values (`m0`…`m7`, 0…1) and the chain selector (`sel`, 0–127)
 * are the slot's own `params` (`FX_DEFS.fxRack`), so lanes, MIDI learn, modulators and Type a value
 * reach them as any insert parameter, played on the chains' AudioParams (never through the store);
 * the chains, macro names and maps are the slot's `rack`.
 *
 * What a chain holds (decided 1.543): any built-in insert but another rack (no nesting), a modulator
 * (its targets are the track's parameters) and an EST plugin (its block, state uploads, pool claim
 * and status are keyed by strip and slot, which a chain does not have: an EST chain is a later
 * release, as for the Instrument Rack); a keyed type keeps no sidechain key (a key names a track's
 * strip; a Compressor then listens to its own input).
 */

export const FX_RACK_MAX_CHAINS = 8;
/** The macros a rack shows by default (every rack before 1.600) and its macro list's least length. */
export const FX_RACK_MACROS = MACROS_DEFAULT;
/** 1.600: the most macros a rack holds (Live 13's 32): the slot's `m0`…`m31`. */
export const FX_RACK_MAX_MACROS = MACROS_MAX;
export const FX_RACK_MAX_MAPS = 8;
/** A chain's inserts, at most (a strip's MAX_FX). */
export const FX_RACK_MAX_CHAIN_FX = 6;
export const FX_RACK_MIN_DB = -60;
export const FX_RACK_MAX_DB = 6;
export { RACK_SEL_MAX as FX_RACK_SEL_MAX };

export interface FxRackChain {
  id: string;
  name: string;
  /** The chain's inserts, in series (built-in types, no key, no rack, no modulator). */
  fx: FxSlot[];
  /** dB, FX_RACK_MIN_DB (silent) … FX_RACK_MAX_DB. */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** The chain's select zone (absent: the whole range). */
  sel?: RackZone;
}

/** A macro's mapping: an insert of a chain and one of its automatable parameters, set to `min + value · (max − min)` (display units). */
export interface FxRackMap { chain: string; fx: string; param: string; min: number; max: number }
export interface FxRackMacro { name: string; maps: FxRackMap[] }

/**
 * 1.576: Live 13's Multiband and Mid-Side Racks as split modes of the one rack. Absent: the chains
 * play side by side on the whole input (1.543's rack, every older song). `'bands'`: the input is cut
 * into 2–4 bands (one a chain, chain n band n) at the crossovers `x0`…`x2` (the slot's params, so lanes
 * and macros reach them; Linkwitz-Riley 4th order, crossover.ts, so the bands sum flat). `'midside'`:
 * chain 1 hears the mid, chain 2 the side, decoded back to left and right after them.
 */
export type FxRackSplit = 'bands' | 'midside';
export const FX_RACK_SPLITS: readonly FxRackSplit[] = ['bands', 'midside'];

export interface FxRackModel {
  v: 1;
  /** 1.576: the split mode (absent: parallel chains). */
  split?: FxRackSplit;
  chains: FxRackChain[];
  macros: FxRackMacro[];
  /** The chain the card shows open (an index into `chains`). */
  selected: number;
  /** The macro (0–7; 1.600: 0–31) that sets the chain selector (its value × 127); absent: the selector is `sel`. */
  selectorMacro?: number;
  /** 1.600: the macros shown (Show macros: 1, 2, 4, 8, 16 or 32; `macroCount.ts`); absent: 8. Read through `fxRackMacroCount`. */
  macroCount?: number;
}

/** The slot keys of the macros' values and the selector. */
export const fxRackMacroKey = (i: number): string => `m${i}`;
export const FX_RACK_SEL_KEY = 'sel';
const MACRO_KEY_RE = new RegExp(`^m${MACRO_INDEX_RE}$`);
/** The macro a slot key names, or -1. */
export function fxRackMacroIndex(key: string): number {
  const m = MACRO_KEY_RE.exec(key);
  return m ? Number(m[1]) : -1;
}

// --- 1.576: split modes -----------------------------------------------------------------------------

export const FX_RACK_MIN_BANDS = 2;
export const FX_RACK_MAX_BANDS = 4;
/** The crossovers' range (Hz) and their least spacing: a third of an octave apart at least (ratio 1.25 ≈ 2^(1/3)). */
export const FX_RACK_XOVER_MIN = 30;
export const FX_RACK_XOVER_MAX = 16000;
export const FX_RACK_XOVER_RATIO = 1.25;
/** A macro map's `chain` and `fx` when it turns a crossover (never an id: ids take no `@`). */
export const FX_RACK_SPLIT_TARGET = '@split';
export const fxRackXoverKey = (k: number): string => `x${k}`;
/** The crossover a slot key names, or -1. */
export function fxRackXoverIndex(key: string): number {
  const m = /^x([0-2])$/.exec(key);
  return m ? Number(m[1]) : -1;
}
/** Each split mode's chain names for chains still called "Chain n". */
const BAND_NAMES: Record<number, string[]> = { 2: ['Low', 'High'], 3: ['Low', 'Mid', 'High'], 4: ['Low', 'Low mid', 'High mid', 'High'] };
const MS_NAMES = ['Mid', 'Side'];
/** Whether a chain's name is one Cyber gave it ("Chain n", or a split mode's band or side name), so a new mode may rename it. */
const givenName = (name: string): boolean => /^Chain \d+$/.test(name) || MS_NAMES.includes(name) || Object.values(BAND_NAMES).some(l => l.includes(name));
/** The crossovers a new split of `bands` starts with (Hz). */
export function defaultCrossovers(bands: number): number[] {
  return bands <= 2 ? [800] : bands === 3 ? [250, 2500] : [150, 1000, 6000];
}
/** How many bands a model splits into (0: not split into bands). */
export const fxRackBands = (m: Pick<FxRackModel, 'split' | 'chains'>): number => (m.split === 'bands' ? m.chains.length : 0);
const xclamp = (v: number) => Math.max(FX_RACK_XOVER_MIN, Math.min(FX_RACK_XOVER_MAX, Number.isFinite(v) ? v : FX_RACK_XOVER_MIN));
/** Crossovers in order and spaced: sorted, then each at least FX_RACK_XOVER_RATIO above the last, within the range. */
export function spaceCrossovers(values: readonly number[]): number[] {
  const xs = values.map(xclamp).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i]!, xs[i - 1]! * FX_RACK_XOVER_RATIO);
  if (xs.length) xs[xs.length - 1] = Math.min(xs[xs.length - 1]!, FX_RACK_XOVER_MAX);
  for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i]!, xs[i + 1]! / FX_RACK_XOVER_RATIO);
  return xs.map(v => Math.round(v * 100) / 100);
}
/** Crossover `k` moved to `v`, kept between its neighbours (and spaced from them): a drag, a key, a lane's value. */
export function clampCrossover(xs: readonly number[], k: number, v: number): number {
  const lo = k > 0 ? xs[k - 1]! * FX_RACK_XOVER_RATIO : FX_RACK_XOVER_MIN;
  const hi = k < xs.length - 1 ? xs[k + 1]! / FX_RACK_XOVER_RATIO : FX_RACK_XOVER_MAX;
  return Math.max(lo, Math.min(hi, xclamp(v)));
}
/** The crossovers' slot values (`x0`… for a model of `bands` bands), spaced. */
export const slotCrossovers = (params: Readonly<Record<string, number>>, bands: number): number[] =>
  spaceCrossovers(Array.from({ length: Math.max(0, bands - 1) }, (_, k) => params[fxRackXoverKey(k)] ?? defaultCrossovers(bands)[k] ?? FX_RACK_XOVER_MIN));
/** The crossovers as they play: the slot's values with every macro that maps one applied, spaced. */
export function fxRackCrossovers(slot: Pick<FxSlot, 'params'> & { rack: Pick<FxRackModel, 'split' | 'chains' | 'macros'> }): number[] {
  const n = fxRackBands(slot.rack);
  if (!n) return [];
  // Review n572: each macro's value kept between its crossover's neighbours (`clampCrossover`), as a lane
  // on that macro plays it (fxRack.ts), never re-sorted past a neighbour (which moved the other band edge).
  const xs = slotCrossovers(slot.params, n);
  slot.rack.macros.forEach((m, i) => {
    for (const map of m.maps) {
      const k = map.fx === FX_RACK_SPLIT_TARGET ? fxRackXoverIndex(map.param) : -1;
      if (k >= 0 && k < xs.length) xs[k] = clampCrossover(xs, k, fxMacroValue(map, slot.params[fxRackMacroKey(i)] ?? 0));
    }
  });
  return xs;
}
/** Whether a slot key is one a lane, a picker or a learn may reach: the crossovers only while they cut bands. */
export function fxRackKeyLive(m: Pick<FxRackModel, 'split' | 'chains'>, key: string): boolean {
  const k = fxRackXoverIndex(key);
  return k < 0 || k < fxRackBands(m) - 1;
}

/**
 * A rack slot's split set (null: back to parallel chains): the chains padded to the mode's count, the
 * ones with a name Cyber gave ("Chain n", another mode's) named for their band or side, new crossovers at the defaults, maps of
 * crossovers that are gone dropped. The words why when it cannot be (more chains than the mode has).
 */
export function setFxRackSplit(slot: FxSlot, split: FxRackSplit | null, bands = 3): FxSlot | { refusal: string } {
  const m = slot.rack;
  if (!m) return { refusal: 'Choose an Audio Effect Rack.' };
  if (split === null) {
    const { split: _s, ...rest } = m;
    return { ...slot, rack: { ...rest, macros: m.macros.map(x => ({ ...x, maps: x.maps.filter(y => y.fx !== FX_RACK_SPLIT_TARGET) })) } };
  }
  const want = split === 'midside' ? 2 : Math.max(FX_RACK_MIN_BANDS, Math.min(FX_RACK_MAX_BANDS, Math.round(bands)));
  const max = split === 'midside' ? 2 : FX_RACK_MAX_BANDS;
  if (m.chains.length > max) return { refusal: split === 'midside' ? 'A Mid-Side rack has two chains, mid and side: remove chains down to two first.' : `A Multiband rack has at most ${FX_RACK_MAX_BANDS} bands: remove chains down to ${FX_RACK_MAX_BANDS} first.` };
  const n = Math.max(want, m.chains.length);
  const chains = [...m.chains];
  while (chains.length < n) chains.push(makeFxChain([], `Chain ${chains.length + 1}`));
  const names = split === 'midside' ? MS_NAMES : BAND_NAMES[n]!;
  const named = chains.map((c, i) => (givenName(c.name) && names[i] ? { ...c, name: names[i]! } : c));
  const params = { ...slot.params };
  if (split === 'bands' && m.split !== 'bands') defaultCrossovers(n).forEach((v, k) => { params[fxRackXoverKey(k)] = v; });
  const macros = split === 'bands' ? m.macros : m.macros.map(x => ({ ...x, maps: x.maps.filter(y => y.fx !== FX_RACK_SPLIT_TARGET) }));
  return { ...slot, params, rack: { ...m, split, chains: named, macros, selected: Math.min(m.selected, named.length - 1) } };
}

/** 1.576: a band added to a Multiband rack (its new crossover halfway, in octaves, from the top one to the range's top); the words why when it cannot be. */
export function addFxBand(slot: FxSlot): FxSlot | { refusal: string } {
  const m = slot.rack;
  if (!m || m.split !== 'bands') return { refusal: 'Only a Multiband rack has bands.' };
  const n = m.chains.length;
  if (n >= FX_RACK_MAX_BANDS) return { refusal: `A Multiband rack has at most ${FX_RACK_MAX_BANDS} bands.` };
  const xs = slotCrossovers(slot.params, n);
  const top = xs[xs.length - 1] ?? FX_RACK_XOVER_MIN;
  const next = Math.sqrt(top * FX_RACK_XOVER_MAX);
  const names = BAND_NAMES[n + 1]!;
  const chains = [...m.chains, makeFxChain([], `Chain ${n + 1}`)].map((c, i) => (givenName(c.name) ? { ...c, name: names[i]! } : c));
  return { ...slot, params: { ...slot.params, [fxRackXoverKey(n - 1)]: next }, rack: { ...m, chains, selected: n } };
}

/** 1.576: band `id` removed from a Multiband rack (its crossover with the band above goes; the top band's, its lower one); the words why when it cannot be. */
export function removeFxBand(slot: FxSlot, id: string): FxSlot | { refusal: string } {
  const m = slot.rack;
  if (!m || m.split !== 'bands') return { refusal: 'Only a Multiband rack has bands.' };
  const at = m.chains.findIndex(c => c.id === id);
  if (at < 0) return { refusal: 'That band is gone.' };
  if (m.chains.length <= FX_RACK_MIN_BANDS) return { refusal: `A Multiband rack keeps ${FX_RACK_MIN_BANDS} bands at least: set it back to parallel chains instead.` };
  const xs = slotCrossovers(slot.params, m.chains.length);
  const cut = Math.min(at, xs.length - 1);
  const kept = xs.filter((_, k) => k !== cut);
  const params = { ...slot.params };
  kept.forEach((v, k) => { params[fxRackXoverKey(k)] = v; });
  const removed = removeFxChain(m, id);
  // Maps on crossovers follow their crossover's index down past the one removed; the removed one's go.
  const macros = removed.macros.map(x => ({ ...x, maps: x.maps.flatMap(y => {
    if (y.fx !== FX_RACK_SPLIT_TARGET) return [y];
    const k = fxRackXoverIndex(y.param);
    if (k === cut) return [];
    return [k > cut ? { ...y, param: fxRackXoverKey(k - 1) } : y];
  }) }));
  return { ...slot, params, rack: { ...removed, macros } };
}

/** 1.600: the macros a rack shows (1, 2, 4, 8, 16 or 32; 8 when absent). */
export const fxRackMacroCount = (m: Pick<FxRackModel, 'macroCount'>): number => sanitiseMacroCount(m.macroCount);
/** 1.600: whether a slot key is offered to a lane picker, a learn or the auto-map: a macro's only while it is shown. */
export const fxRackKeyShown = (m: Pick<FxRackModel, 'macroCount'>, key: string): boolean => { const i = fxRackMacroIndex(key); return i < 0 || i < fxRackMacroCount(m); };
/** 1.600: the rack showing `count` macros (snapped to an allowed count); `sanitise` (the slot's rules) then grows or trims the list. */
export function setFxRackMacroCount(m: FxRackModel, count: number, rules: FxRackRules): FxRackModel {
  const n = sanitiseMacroCount(count);
  const { macroCount: _c, ...rest } = m;
  return sanitiseFxRackModel(n === FX_RACK_MACROS ? rest : { ...rest, macroCount: n }, rules);
}
/** 1.600: Show macros + (`dir` 1) or − (−1), Live 13's. */
export const stepFxRackMacroCount = (m: FxRackModel, dir: 1 | -1, rules: FxRackRules): FxRackModel => setFxRackMacroCount(m, stepMacroCount(fxRackMacroCount(m), dir), rules);

/** 1.621 (P4-02): the most entries of a chain's inserts, or of a macro's maps, the sanitiser reads. */
export const FX_RACK_SCAN_MAX = 64;
/** Whether a chain may hold an insert of `type`. */
export const fxRackTakes = (type: string): boolean => type !== 'fxRack' && type !== 'est' && type !== 'lfo' && type !== 'shaper';

/** Why a chain cannot hold `slot` (words), or null. */
export function fxRackRefusal(slot: Pick<FxSlot, 'type' | 'keyTrackId'>): string | null {
  if (slot.type === 'fxRack') return 'A rack cannot go inside another rack.';
  if (slot.type === 'est') return 'An EST plugin cannot go in a rack’s chain yet: keep it on the track.';
  if (slot.type === 'lfo' || slot.type === 'shaper') return 'A modulator moves its track’s parameters: keep it on the track, not in a rack.';
  if (typeof slot.keyTrackId === 'string') return 'An effect with a sidechain key cannot go in a rack: a chain takes no key.';
  return null;
}

/** What the sanitiser needs of the insert rules (passed in, so this file imports no values from fxDefs.ts). */
export interface FxRackRules {
  /** One insert from anything, or null. */
  slot(raw: unknown): FxSlot | null;
  /** An automatable parameter's range on a slot, or null. */
  range(slot: FxSlot, key: string): { min: number; max: number } | null;
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const text = (v: unknown, d: string, max = 24) => {
  if (typeof v !== 'string') return d;
  let out = '';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  return out.trim().slice(0, max) || d;
};
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
let idN = 0;
export const newFxChainId = (): string => `fc${Date.now().toString(36).slice(-4)}${(++idN % 1e6).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A chain's inserts: allowed types only, keys dropped, unique ids across the rack (`seen`), at most FX_RACK_MAX_CHAIN_FX. */
function sanitiseChainSlots(raw: unknown, rules: FxRackRules, seen: Set<string>): FxSlot[] {
  const out: FxSlot[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, FX_RACK_SCAN_MAX) : []) {
    if (out.length >= FX_RACK_MAX_CHAIN_FX) break;
    // 1.621 (pre-launch review 4, P4-02): a type a chain never takes is dropped before it is sanitised,
    // so a rack nested thousands deep in a project or from a peer is never walked (a stack overflow
    // that kept the song from loading), and a chain's list is read at most FX_RACK_SCAN_MAX entries.
    const type = r && typeof r === 'object' ? (r as { type?: unknown }).type : undefined;
    if (typeof type !== 'string' || !fxRackTakes(type)) continue;
    const f = rules.slot(r);
    if (!f || !fxRackTakes(f.type) || seen.has(f.id)) continue;
    seen.add(f.id);
    if ('keyTrackId' in f) { const { keyTrackId: _k, ...rest } = f; out.push(f.type === 'cyberComp' ? rest : { ...rest, keyTrackId: null }); } else out.push(f);
  }
  return out;
}

export function makeFxChain(fx: FxSlot[] = [], name = 'Chain', id = newFxChainId()): FxRackChain {
  return { id, name, fx, volume: 0, pan: 0, mute: false, solo: false };
}

/** A rack's model from anything (a song, a peer, a preset): its limits applied; never fewer than one chain. */
export function sanitiseFxRackModel(raw: unknown, rules: FxRackRules): FxRackModel {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const seenChains = new Set<string>();
  const seenFx = new Set<string>();
  const chains: FxRackChain[] = [];
  for (const c of Array.isArray(r.chains) ? r.chains : []) {
    if (chains.length >= FX_RACK_MAX_CHAINS) break;
    if (!c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    let id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : newFxChainId();
    while (seenChains.has(id)) id = newFxChainId();
    seenChains.add(id);
    const chain: FxRackChain = {
      id, name: text(x.name, `Chain ${chains.length + 1}`), fx: sanitiseChainSlots(x.fx, rules, seenFx),
      volume: clamp(x.volume, FX_RACK_MIN_DB, FX_RACK_MAX_DB, 0), pan: clamp(x.pan, -1, 1, 0), mute: x.mute === true, solo: x.solo === true,
    };
    if (x.sel !== undefined) { const sel = sanitiseZone(x.sel, 0, RACK_SEL_MAX); if (!isFullSel(sel)) chain.sel = sel; }
    chains.push(chain);
  }
  if (!chains.length) chains.push(makeFxChain([], 'Chain 1'));
  // 1.576: a split keeps its mode's count of chains (padded); one with more chains than its mode has is parallel again (nothing dropped).
  let split: FxRackSplit | undefined = r.split === 'bands' || r.split === 'midside' ? r.split : undefined;
  if (split && chains.length > (split === 'midside' ? 2 : FX_RACK_MAX_BANDS)) split = undefined;
  if (split) while (chains.length < FX_RACK_MIN_BANDS) chains.push(makeFxChain([], `Chain ${chains.length + 1}`));
  const bands = split === 'bands' ? chains.length : 0;
  // Maps: an existing chain's insert and one of its automatable parameters, each parameter on one macro only (Live's rule).
  const taken = new Set<string>();
  const macrosRaw = Array.isArray(r.macros) ? r.macros : [];
  const all: FxRackMacro[] = Array.from({ length: FX_RACK_MAX_MACROS }, (_, i) => {
    const m = macrosRaw[i] && typeof macrosRaw[i] === 'object' ? macrosRaw[i] as Record<string, unknown> : {};
    const maps: FxRackMap[] = [];
    for (const raw of Array.isArray(m.maps) ? m.maps.slice(0, FX_RACK_SCAN_MAX) : []) {
      if (maps.length >= FX_RACK_MAX_MAPS || !raw || typeof raw !== 'object') continue;
      const x = raw as Record<string, unknown>;
      // 1.576: a crossover's map (only while the rack cuts bands, and only an existing crossover).
      if (x.fx === FX_RACK_SPLIT_TARGET && x.chain === FX_RACK_SPLIT_TARGET) {
        const k = typeof x.param === 'string' ? fxRackXoverIndex(x.param) : -1;
        if (k < 0 || k >= bands - 1) continue;
        const key = `${FX_RACK_SPLIT_TARGET}:${x.param as string}`;
        if (taken.has(key)) continue;
        taken.add(key);
        maps.push({ chain: FX_RACK_SPLIT_TARGET, fx: FX_RACK_SPLIT_TARGET, param: x.param as string, min: clamp(x.min, FX_RACK_XOVER_MIN, FX_RACK_XOVER_MAX, FX_RACK_XOVER_MIN), max: clamp(x.max, FX_RACK_XOVER_MIN, FX_RACK_XOVER_MAX, FX_RACK_XOVER_MAX) });
        continue;
      }
      const chain = chains.find(c => c.id === x.chain);
      const slot = chain?.fx.find(f => f.id === x.fx);
      const range = slot && typeof x.param === 'string' ? rules.range(slot, x.param) : null;
      if (!chain || !slot || !range) continue;
      const k = `${slot.id}:${x.param as string}`;
      if (taken.has(k)) continue;
      taken.add(k);
      maps.push({ chain: chain.id, fx: slot.id, param: x.param as string, min: clamp(x.min, range.min, range.max, range.min), max: clamp(x.max, range.min, range.max, range.max) });
    }
    return { name: text(m.name, `Macro ${i + 1}`, 16), maps };
  });
  // 1.600: up to 32 macros, the list as long as `macroListLength` says (8 for every rack before 1.600;
  // a hidden macro's value is the slot's `m<i>`, so a named or mapped one is what keeps it).
  const count = sanitiseMacroCount(r.macroCount);
  const selMacro = typeof r.selectorMacro === 'number' && Number.isInteger(r.selectorMacro) && r.selectorMacro >= 0 && r.selectorMacro < FX_RACK_MAX_MACROS ? r.selectorMacro : undefined;
  const macros = all.slice(0, macroListLength(count, i => i === selMacro || all[i]!.name !== `Macro ${i + 1}` || all[i]!.maps.length > 0));
  const out: FxRackModel = { v: 1, chains, macros, selected: Math.round(clamp(r.selected, 0, chains.length - 1, 0)) };
  if (split) out.split = split;
  if (selMacro !== undefined) out.selectorMacro = selMacro;
  if (count !== FX_RACK_MACROS) out.macroCount = count;
  return out;
}

// --- Playing ------------------------------------------------------------------------------------

/** A chain's select zone (the whole range when it has none). */
export const fxChainSel = (c: Pick<FxRackChain, 'sel'>): RackZone => c.sel ?? FULL_SEL;
/** A macro's value (0…1) as a selector value (0–127). */
export const fxSelectorOfMacro = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * RACK_SEL_MAX);
/** The chain selector now: its macro's value while one sets it, else the slot's `sel`. */
export function fxRackSelector(slot: Pick<FxSlot, 'params'> & { rack?: Pick<FxRackModel, 'selectorMacro'> }): number {
  const m = slot.rack?.selectorMacro;
  if (m !== undefined) return fxSelectorOfMacro(slot.params[fxRackMacroKey(m)] ?? 0);
  return Math.round(Math.max(0, Math.min(RACK_SEL_MAX, slot.params[FX_RACK_SEL_KEY] ?? 0)));
}
/** A chain's select gain at a selector value. */
export const fxChainSelGain = (c: Pick<FxRackChain, 'sel'>, selector: number): number => zoneGain(fxChainSel(c), Math.round(selector));
/** Whether chain `i` sounds by its switches: not muted, and soloed while any chain is. */
export function fxChainAudible(model: Pick<FxRackModel, 'chains'>, i: number): boolean {
  const c = model.chains[i];
  if (!c || c.mute) return false;
  return !model.chains.some(x => x.solo) || c.solo;
}
/** A chain's level by its volume and switches (its select gain apart: the selector has its own gain, so its lane never fights the volume). */
export function fxChainLevel(model: Pick<FxRackModel, 'chains'>, i: number): number {
  const c = model.chains[i];
  if (!c || !fxChainAudible(model, i) || c.volume <= FX_RACK_MIN_DB) return 0;
  return Math.pow(10, c.volume / 20);
}

/** A macro's value at a mapping: `min + value · (max − min)`. */
export const fxMacroValue = (m: Pick<FxRackMap, 'min' | 'max'>, value: number): number => m.min + Math.max(0, Math.min(1, value)) * (m.max - m.min);

/** Each chain's inserts as they play: every macro's maps applied at the slot's macro values. */
export function fxRackChainSlots(slot: Pick<FxSlot, 'params'> & { rack: FxRackModel }): FxSlot[][] {
  const { rack } = slot;
  return rack.chains.map(c => c.fx.map(f => {
    let params: Record<string, number> | null = null;
    rack.macros.forEach((m, i) => {
      for (const map of m.maps) {
        if (map.fx !== f.id) continue;
        params ??= { ...f.params };
        params[map.param] = fxMacroValue(map, slot.params[fxRackMacroKey(i)] ?? 0);
      }
    });
    return params ? { ...f, params } : f;
  }));
}

/** Latency compensation: each chain's delay so every chain comes out as late as the latest (seconds). */
export function fxRackPads(latencies: readonly number[]): { max: number; pads: number[] } {
  const max = latencies.reduce((a, b) => Math.max(a, b), 0);
  return { max, pads: latencies.map(l => Math.max(0, max - l)) };
}

// --- Finding --------------------------------------------------------------------------------------

/** Every insert inside a rack slot's chains. */
export const fxRackInner = (slot: Pick<FxSlot, 'type'> & { rack?: FxRackModel }): FxSlot[] => (slot.type === 'fxRack' && slot.rack ? slot.rack.chains.flatMap(c => c.fx) : []);
/** A slot by id on a strip, or inside one of its racks (a lane or modulator on a grouped device keeps playing). */
export function findFxDeep(fx: readonly (FxSlot & { rack?: FxRackModel })[], id: string): FxSlot | null {
  for (const f of fx) {
    if (f.id === id) return f;
    const inner = fxRackInner(f).find(x => x.id === id);
    if (inner) return inner;
  }
  return null;
}
/** The rack slot on a strip whose chains hold insert `id`, or null. */
export const rackHolding = (fx: readonly FxSlot[], id: string): FxSlot | null => fx.find(f => fxRackInner(f).some(x => x.id === id)) ?? null;

// --- Edits (each a new model) -------------------------------------------------------------------

export function addFxChain(model: FxRackModel, chain: FxRackChain = makeFxChain([], `Chain ${model.chains.length + 1}`)): FxRackModel | null {
  if (model.chains.length >= FX_RACK_MAX_CHAINS || model.split) return null;
  return { ...model, chains: [...model.chains, chain], selected: model.chains.length };
}

export function removeFxChain(model: FxRackModel, id: string): FxRackModel {
  if (model.chains.length <= (model.split === 'midside' ? 2 : model.split === 'bands' ? FX_RACK_MIN_BANDS - 1 : 1)) return model;
  const chains = model.chains.filter(c => c.id !== id);
  const macros = model.macros.map(m => ({ ...m, maps: m.maps.filter(x => x.chain !== id) }));
  return { ...model, chains, macros, selected: Math.min(model.selected, chains.length - 1) };
}

export function updateFxChain(model: FxRackModel, id: string, change: Partial<Omit<FxRackChain, 'id' | 'fx'>>): FxRackModel {
  return { ...model, chains: model.chains.map(c => {
    if (c.id !== id) return c;
    const next = { ...c, ...change };
    if (next.sel && isFullSel(next.sel)) delete next.sel;
    return next;
  }) };
}

/** A chain's inserts replaced (the macros' maps to inserts that went are dropped); null past the limit or with an insert a chain cannot hold. */
export function setChainFx(model: FxRackModel, id: string, fx: FxSlot[]): FxRackModel | null {
  if (fx.length > FX_RACK_MAX_CHAIN_FX || fx.some(f => fxRackRefusal(f))) return null;
  const chains = model.chains.map(c => (c.id === id ? { ...c, fx } : c));
  const ids = new Set(chains.flatMap(c => c.fx.map(f => f.id)));
  return { ...model, chains, macros: model.macros.map(m => ({ ...m, maps: m.maps.filter(x => x.fx === FX_RACK_SPLIT_TARGET || ids.has(x.fx)) })) };
}

/** An insert placed in a chain at `at` (the end when absent); null with the words why when it cannot be. */
export function insertIntoChain(model: FxRackModel, chainId: string, slot: FxSlot, at?: number): FxRackModel | { refusal: string } {
  const chain = model.chains.find(c => c.id === chainId);
  if (!chain) return { refusal: 'That chain is gone.' };
  const why = fxRackRefusal(slot);
  if (why) return { refusal: why };
  if (chain.fx.length >= FX_RACK_MAX_CHAIN_FX) return { refusal: `A chain holds at most ${FX_RACK_MAX_CHAIN_FX} effects.` };
  const fx = [...chain.fx];
  fx.splice(at === undefined ? fx.length : Math.max(0, Math.min(fx.length, at)), 0, slot);
  return setChainFx(model, chainId, fx) ?? { refusal: `A chain holds at most ${FX_RACK_MAX_CHAIN_FX} effects.` };
}

export function moveFxChain(model: FxRackModel, from: number, to: number): FxRackModel {
  const n = model.chains.length;
  if (from < 0 || from >= n) return model;
  const t = Math.max(0, Math.min(n - 1, Math.round(to)));
  if (t === from) return model;
  const chains = [...model.chains];
  const [c] = chains.splice(from, 1);
  chains.splice(t, 0, c!);
  const sel = model.chains[model.selected];
  return { ...model, chains, selected: Math.max(0, chains.findIndex(x => x === sel)) };
}

/** A mapping added to macro `i` (it moves off any other macro: one macro a parameter); the same model past FX_RACK_MAX_MAPS or for a target that is not there. */
export function addFxMacroMap(model: FxRackModel, i: number, map: FxRackMap): FxRackModel {
  const m = model.macros[i];
  const chain = model.chains.find(c => c.id === map.chain);
  const split = map.fx === FX_RACK_SPLIT_TARGET && map.chain === FX_RACK_SPLIT_TARGET && fxRackXoverIndex(map.param) >= 0 && fxRackXoverIndex(map.param) < fxRackBands(model) - 1;
  if (!m || (!split && (!chain || !chain.fx.some(f => f.id === map.fx)))) return model;
  const others = m.maps.filter(y => !(y.fx === map.fx && y.param === map.param));
  if (others.length >= FX_RACK_MAX_MAPS) return model;
  return { ...model, macros: model.macros.map((x, k) => (k === i ? { ...x, maps: [...others, map] } : { ...x, maps: x.maps.filter(y => !(y.fx === map.fx && y.param === map.param)) })) };
}

export function removeFxMacroMap(model: FxRackModel, i: number, at: number): FxRackModel {
  return { ...model, macros: model.macros.map((x, k) => (k === i ? { ...x, maps: x.maps.filter((_, n) => n !== at) } : x)) };
}

export function renameFxMacro(model: FxRackModel, i: number, name: string): FxRackModel {
  return { ...model, macros: model.macros.map((x, k) => (k === i ? { ...x, name: text(name, `Macro ${i + 1}`, 16) } : x)) };
}

/** The select zones spread equally over 0–127 in chain order (Live's "Distribute ranges equally"). */
export function distributeFxSelect(model: FxRackModel, fade = 0): FxRackModel {
  const zones = distributedZones(model.chains.length, fade);
  return { ...model, chains: model.chains.map((c, i) => (isFullSel(zones[i]!) ? (({ sel: _s, ...rest }) => rest)(c) : { ...c, sel: zones[i]! })) };
}

/** The selector given to macro `i` (null: none). */
export function mapFxSelectorToMacro(model: FxRackModel, i: number | null): FxRackModel {
  const { selectorMacro: _m, ...rest } = model;
  return i === null || i < 0 || i >= model.macros.length ? rest : { ...rest, selectorMacro: i };
}

// --- ⌘G: Group and Ungroup ------------------------------------------------------------------------

/** A rack slot's `params` at their defaults (the eight macros at 0, the selector at 0; 1.600: the insert sanitiser adds `m8`… as the rack's macros grow; 1.576: the crossovers). */
export const fxRackDefaultParams = (): Record<string, number> => ({
  ...Object.fromEntries(Array.from({ length: FX_RACK_MACROS }, (_, i) => [fxRackMacroKey(i), 0])), [FX_RACK_SEL_KEY]: 0,
  // 1.576: the crossovers (read only while the rack cuts bands).
  ...Object.fromEntries(defaultCrossovers(FX_RACK_MAX_BANDS).map((v, k) => [fxRackXoverKey(k), v])),
});

/**
 * Live's ⌘G on chosen devices: the chosen inserts of a strip (`ids`, in the strip's order) into a
 * new rack of one chain holding them, the rack where the first of them was. The words why when it
 * cannot be (nothing chosen, a device a chain cannot hold).
 */
export function groupIntoFxRack(fx: readonly FxSlot[], ids: readonly string[], rackId: string, chainId = newFxChainId()): { fx: FxSlot[]; rack: FxSlot } | { refusal: string } {
  const chosen = fx.filter(f => ids.includes(f.id));
  if (!chosen.length) return { refusal: 'Choose the effects to group first.' };
  if (chosen.length > FX_RACK_MAX_CHAIN_FX) return { refusal: `A chain holds at most ${FX_RACK_MAX_CHAIN_FX} effects.` };
  for (const f of chosen) { const why = fxRackRefusal(f); if (why) return { refusal: why }; }
  const rack: FxSlot = {
    id: rackId, type: 'fxRack', on: true, params: fxRackDefaultParams(),
    rack: { v: 1, chains: [makeFxChain(chosen.map(f => ('keyTrackId' in f ? (({ keyTrackId: _k, ...rest }) => (f.type === 'cyberComp' ? rest : { ...rest, keyTrackId: null }))(f) : f)), 'Chain 1', chainId)], macros: Array.from({ length: FX_RACK_MACROS }, (_, i) => ({ name: `Macro ${i + 1}`, maps: [] })), selected: 0 },
  };
  const first = fx.findIndex(f => ids.includes(f.id));
  const out: FxSlot[] = [];
  fx.forEach((f, i) => { if (i === first) out.push(rack); if (!ids.includes(f.id)) out.push(f); });
  return { fx: out, rack };
}

/** Ungroup: the rack's first chain's inserts back on the strip in its place (its other chains and macros go); the words why when they would not fit. */
export function ungroupFxRack(fx: readonly FxSlot[], rackId: string, maxFx: number): FxSlot[] | { refusal: string } {
  const at = fx.findIndex(f => f.id === rackId);
  const rack = fx[at];
  if (!rack || rack.type !== 'fxRack' || !rack.rack) return { refusal: 'Choose an Audio Effect Rack to ungroup.' };
  const inner = rack.rack.chains[0]?.fx ?? [];
  if (fx.length - 1 + inner.length > maxFx) return { refusal: `A track holds at most ${maxFx} effects: make room before ungrouping.` };
  return [...fx.slice(0, at), ...inner, ...fx.slice(at + 1)];
}

// --- Presets (kind 'fxRack' in the track presets' store) -----------------------------------------

/** A rack preset: the rack slot's model and its macro values (`params`), sanitised as a song's. */
export interface FxRackPresetBody { v: 1; fxRack: { rack: FxRackModel; params: Record<string, number> } }
