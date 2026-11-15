/**
 * The racks' zones (1.356, moved here in 1.543): a range of notes, velocities or chain-selector
 * values with fades at its ends. Pure and import-free, so the Instrument Rack's model
 * (`rackTypes.ts`) and the Audio Effect Rack's (`fxRackTypes.ts`, read by the light `fxDefs.ts`)
 * share one rule without an import cycle.
 */

/** A zone: notes (or velocities) `lo`…`hi` inclusive, fading in over `fadeLo` steps above `lo` and out over `fadeHi` below `hi`. */
export interface RackZone { lo: number; hi: number; fadeLo: number; fadeHi: number }

/** 1.386: the chain selector's range (Live's 0–127). */
export const RACK_SEL_MAX = 127;

const clampInt = (v: unknown, lo: number, hi: number, d: number) => Math.round(typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

export function sanitiseZone(raw: unknown, lo: number, hi: number): RackZone {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const a = clampInt(r.lo, lo, hi, lo);
  const b = clampInt(r.hi, lo, hi, hi);
  const [zlo, zhi] = a <= b ? [a, b] : [b, a];
  const span = zhi - zlo;
  const fadeLo = clampInt(r.fadeLo, 0, span, 0);
  return { lo: zlo, hi: zhi, fadeLo, fadeHi: clampInt(r.fadeHi, 0, span - fadeLo, 0) };
}

/** How much of a zone a value is in: 0 outside, 1 inside past the fades, linear across each fade. */
export function zoneGain(z: RackZone, v: number): number {
  if (v < z.lo || v > z.hi) return 0;
  let g = 1;
  if (z.fadeLo > 0 && v < z.lo + z.fadeLo) g = Math.min(g, (v - z.lo + 1) / (z.fadeLo + 1));
  if (z.fadeHi > 0 && v > z.hi - z.fadeHi) g = Math.min(g, (z.hi - v + 1) / (z.fadeHi + 1));
  return g;
}

/** 1.386: the whole selector range (a chain without a select zone of its own). */
export const FULL_SEL: Readonly<RackZone> = { lo: 0, hi: RACK_SEL_MAX, fadeLo: 0, fadeHi: 0 };
export const isFullSel = (z: RackZone) => z.lo === 0 && z.hi === RACK_SEL_MAX && z.fadeLo === 0 && z.fadeHi === 0;
/** 1.386: the select zones spread over 0–127 in order, one equal slice each with `fade` steps into each neighbour (Live's "Distribute ranges equally"). */
export function distributedZones(n: number, fade = 0): RackZone[] {
  const span = (RACK_SEL_MAX + 1) / n;
  return Array.from({ length: n }, (_, i) => {
    const lo = Math.round(i * span), hi = Math.round((i + 1) * span) - 1;
    const f = Math.max(0, Math.min(Math.floor((hi - lo) / 2), Math.round(fade)));
    return { lo: Math.max(0, lo - (i > 0 ? f : 0)), hi: Math.min(RACK_SEL_MAX, hi + (i < n - 1 ? f : 0)), fadeLo: i > 0 ? f * 2 : 0, fadeHi: i < n - 1 ? f * 2 : 0 };
  });
}
