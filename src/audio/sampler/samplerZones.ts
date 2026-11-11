/**
 * 1.385 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 3): the SAMPLER's **zones**, Live's
 * Sampler's Zone editor. A zone is one sample placed across keys (its root key, a low–high key
 * range) and velocities (a low–high range with a fade in and out, so two layers cross-fade), in a
 * round-robin group or none. A patch with zones plays them instead of its single `sample`.
 *
 * What a note plays is decided here (`pickZones`), the same for the live node and an offline
 * render: they get the same messages in the same order, so the round-robin counters agree.
 *
 * Pure: no DOM, Web Audio or store imports.
 */

export interface SamplerZone {
  /** The upload the zone plays (its SHA-256) and its file's name. */
  sample: { hash: string; name: string };
  /** The key that plays the sample at its own pitch (MIDI note). */
  root: number;
  /** The keys the zone answers, inclusive (MIDI notes). */
  keyLo: number;
  keyHi: number;
  /** The velocities it answers, inclusive (1…127), fading in over `velFadeLo` steps above `velLo` and out over `velFadeHi` below `velHi`. */
  velLo: number;
  velHi: number;
  velFadeLo: number;
  velFadeHi: number;
  /** 0: none (every matching zone plays); 1…`MAX_RR_GROUP`: the matching zones of a group take turns. */
  group: number;
  /** The zone's own level, dB. */
  gain: number;
}

/** The most zones a patch holds (a big multisampled piano is 88 keys × a few layers; a SAMPLER keeps it light). */
export const MAX_SAMPLER_ZONES = 128;
/** The highest round-robin group number. */
export const MAX_RR_GROUP = 64;
export const ZONE_MIN_DB = -36;
export const ZONE_MAX_DB = 12;

const HASH_RE = /^[a-f0-9]{64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

/** A zone from anything, or null when it names no sample. Ranges are put in order and the fades fit inside them. */
export function sanitiseZone(raw: unknown): SamplerZone | null {
  if (!isObj(raw)) return null;
  const s = isObj(raw.sample) ? raw.sample : null;
  if (!s || typeof s.hash !== 'string' || !HASH_RE.test(s.hash)) return null;
  const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : 'Sample';
  let keyLo = int(raw.keyLo, 0, 127, 0), keyHi = int(raw.keyHi, 0, 127, 127);
  if (keyLo > keyHi) [keyLo, keyHi] = [keyHi, keyLo];
  let velLo = int(raw.velLo, 1, 127, 1), velHi = int(raw.velHi, 1, 127, 127);
  if (velLo > velHi) [velLo, velHi] = [velHi, velLo];
  const span = velHi - velLo;
  const velFadeLo = int(raw.velFadeLo, 0, span, 0);
  const velFadeHi = int(raw.velFadeHi, 0, span, 0);
  const gain = typeof raw.gain === 'number' && Number.isFinite(raw.gain) ? Math.max(ZONE_MIN_DB, Math.min(ZONE_MAX_DB, raw.gain)) : 0;
  return {
    sample: { hash: s.hash, name }, root: int(raw.root, 0, 127, 60), keyLo, keyHi, velLo, velHi, velFadeLo, velFadeHi,
    group: int(raw.group, 0, MAX_RR_GROUP, 0), gain,
  };
}

/** The zones of a patch from anything: valid ones only, at most `MAX_SAMPLER_ZONES`; null when there are none (the field is then left out). */
export function sanitiseZones(raw: unknown): SamplerZone[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SamplerZone[] = [];
  for (const z of raw) {
    const s = sanitiseZone(z);
    if (s) out.push(s);
    if (out.length >= MAX_SAMPLER_ZONES) break;
  }
  return out.length ? out : null;
}

/**
 * How much of a zone a velocity is in: 0 outside, 1 inside past the fades, linear across each fade
 * (the Instrument Rack's `zoneGain` rule). Two layers whose overlap is as wide as their fades sum
 * to 1 at every velocity in it: (hi − v + 1) / (f + 1) + (v − lo + 1) / (f + 1) = 1 when hi − lo + 1 = f.
 */
export function velocityGain(z: Pick<SamplerZone, 'velLo' | 'velHi' | 'velFadeLo' | 'velFadeHi'>, v: number): number {
  if (v < z.velLo || v > z.velHi) return 0;
  let g = 1;
  if (z.velFadeLo > 0 && v < z.velLo + z.velFadeLo) g = Math.min(g, (v - z.velLo + 1) / (z.velFadeLo + 1));
  if (z.velFadeHi > 0 && v > z.velHi - z.velFadeHi) g = Math.min(g, (z.velHi - v + 1) / (z.velFadeHi + 1));
  return g;
}

/** A zone a note plays: its index in the patch and its velocity gain (0…1]. */
export interface ZonePick { index: number; gain: number }

/**
 * The zones a note (`note`, `velocity` 1…127) plays, and the round-robin counters after it.
 * Every matching zone outside a group plays; of the matching zones in a group, one plays, the
 * group's counter modulo how many match (in the patch's order), and the counter moves on. Pure: the
 * counters in are not changed (a node keeps the ones returned).
 */
export function pickZones(zones: readonly SamplerZone[], note: number, velocity: number, counters: Readonly<Record<number, number>> = {}): { picks: ZonePick[]; counters: Record<number, number> } {
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  const picks: ZonePick[] = [];
  const groups = new Map<number, ZonePick[]>();
  zones.forEach((z, index) => {
    if (note < z.keyLo || note > z.keyHi) return;
    const gain = velocityGain(z, v);
    if (gain <= 0) return;
    if (z.group === 0) { picks.push({ index, gain }); return; }
    const g = groups.get(z.group) ?? [];
    g.push({ index, gain });
    groups.set(z.group, g);
  });
  const next: Record<number, number> = { ...counters };
  for (const [group, list] of groups) {
    const c = next[group] ?? 0;
    picks.push(list[c % list.length]!);
    next[group] = c + 1;
  }
  picks.sort((a, b) => a.index - b.index);
  return { picks, counters: next };
}

/** Every upload a zone list names, in order, once each. */
export function zoneHashes(zones: readonly SamplerZone[] | null | undefined): string[] {
  const out: string[] = [];
  for (const z of zones ?? []) if (!out.includes(z.sample.hash)) out.push(z.sample.hash);
  return out;
}

/** A zone on `sample` over every key and velocity at `root` (a new row in the editor). */
export function zoneOf(sample: { hash: string; name: string }, root = 60): SamplerZone {
  return { sample: { ...sample }, root, keyLo: 0, keyHi: 127, velLo: 1, velHi: 127, velFadeLo: 0, velFadeHi: 0, group: 0, gain: 0 };
}

/** The zones with one replaced by `zone` (sanitised), or dropped when `zone` is null. */
export function withZone(zones: readonly SamplerZone[], i: number, zone: Partial<SamplerZone> | null): SamplerZone[] {
  if (i < 0 || i >= zones.length) return [...zones];
  if (zone === null) return zones.filter((_, k) => k !== i);
  const z = sanitiseZone({ ...zones[i], ...zone });
  return z ? zones.map((x, k) => (k === i ? z : x)) : [...zones];
}
