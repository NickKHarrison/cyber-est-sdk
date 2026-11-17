import { MACROS_DEFAULT, MACROS_MAX } from './macroCount';

/**
 * 1.386 (the Instrument Rack) and, since 1.673, the Audio Effect Rack: a rack's **macro variations**
 * (Live's; the work order's "macro snapshots"): the macros' values kept under a name, recalled in one
 * write, and (1.673) **morphed** between two of them. Pure and shared by both racks, so the two read,
 * clean and blend a variation by one rule (`rackTypes.ts`' and `fxRackVariations.ts`' edits call these).
 */

/** A variation: a name and the macros' values 0…1 (as many as the rack's macros when it was stored, eight at least). */
export interface RackVariation { name: string; values: number[] }

/** The most variations a rack keeps. */
export const RACK_MAX_VARIATIONS = 16;

const clamp01 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
/** A value as a variation keeps it (0…1, to 0.001). */
export const roundMacro = (v: number): number => Math.round(clamp01(v) * 1000) / 1000;

/** Text with control characters dropped, trimmed and cut to `max` (else `d`). */
export function variationText(v: unknown, d: string, max = 24): string {
  if (typeof v !== 'string') return d;
  let out = '';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  return out.trim().slice(0, max) || d;
}

/** A variation from anything: a name and its values 0…1 (a missing one 0): eight at least (1.386's), 32 at most (1.600). */
export function sanitiseVariation(raw: unknown, i: number): RackVariation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const vals = Array.isArray(r.values) ? r.values : [];
  const n = Math.max(MACROS_DEFAULT, Math.min(MACROS_MAX, vals.length));
  return { name: variationText(r.name, `Variation ${i + 1}`, 24), values: Array.from({ length: n }, (_, k) => roundMacro(vals[k] as number)) };
}

/** A list of variations from anything (at most RACK_MAX_VARIATIONS). */
export function sanitiseVariations(raw: unknown): RackVariation[] {
  const out: RackVariation[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (out.length >= RACK_MAX_VARIATIONS) break;
    const x = sanitiseVariation(v, out.length);
    if (x) out.push(x);
  }
  return out;
}

/** The list with a new variation holding `values` (null past RACK_MAX_VARIATIONS). */
export function withStored(list: readonly RackVariation[], values: readonly number[], name?: string): RackVariation[] | null {
  if (list.length >= RACK_MAX_VARIATIONS) return null;
  return [...list, { name: variationText(name, `Variation ${list.length + 1}`, 24), values: values.map(roundMacro) }];
}

/**
 * 1.673: the values `t` (0…1) of the way from variation `a` to variation `b`, one a macro of `now`
 * (the macros' values now): a straight blend where both hold the macro, else the one that does,
 * else the macro's own value (a macro past both stored lengths keeps its own, as Recall does).
 * `t` 0 is `a`'s Recall and 1 is `b`'s. Rounded to 0.001, as a variation keeps them.
 */
export function morphValues(a: RackVariation, b: RackVariation, t: number, now: readonly number[]): number[] {
  const x = clamp01(t);
  return now.map((v, k) => {
    const va = k < a.values.length ? a.values[k]! : undefined;
    const vb = k < b.values.length ? b.values[k]! : undefined;
    if (va === undefined && vb === undefined) return v;
    return roundMacro((va ?? v) + ((vb ?? v) - (va ?? v)) * x);
  });
}

export function withoutVariation(list: readonly RackVariation[], i: number): RackVariation[] { return list.filter((_, k) => k !== i); }

export function withRenamed(list: readonly RackVariation[], i: number, name: string): RackVariation[] {
  return list.map((v, k) => (k === i ? { ...v, name: variationText(name, v.name, 24) } : v));
}

export function withOverwritten(list: readonly RackVariation[], i: number, values: readonly number[]): RackVariation[] {
  return list.map((v, k) => (k === i ? { ...v, values: values.map(roundMacro) } : v));
}
