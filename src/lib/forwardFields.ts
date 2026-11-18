/**
 * 1.661: forward compatibility (docs/releases/1.661.md). A build reading project data written by a
 * newer Cyber keeps what it does not know, so a save from it gives the newer parts back:
 *
 * - **Unknown fields** of an object a sanitiser knows are kept beside the fields it writes
 *   (`keepExtras`): opaque, copied as JSON (never interpreted, never a reference into the input),
 *   at most `EXTRAS_OBJECT_BYTES` an object and, inside one document's sanitise
 *   (`withExtrasBudget`), at most `EXTRAS_DOC_BYTES` in all. Past either bound an object's unknown
 *   fields are all left out (never half of them). They go when their object goes.
 * - **Unknown kinds** (an insert type, an instrument engine, a MIDI effect type, a clip kind) are
 *   inert placeholders carrying the raw object under `NEWER` (`holdNewer`, at most
 *   `NEWER_OBJECT_BYTES` each, from the same budget), given back unchanged by the song's way out
 *   (`trialSlots.ts`' `songWithoutTrials`, `restoreNewer.ts`).
 *
 * A sanitiser names every field it knows (`fieldsOf<T>()`: a compile error lists a field of `T`
 * the list misses) plus the retired names it still reads, so a field it drops on purpose (out of
 * range, a legacy name it migrates) is never kept as unknown.
 */

/** An object's unknown fields at most (UTF-8 bytes of their JSON). */
export const EXTRAS_OBJECT_BYTES = 4096;
/** An unknown kind's raw object at most (a placeholder's `NEWER`). */
export const NEWER_OBJECT_BYTES = 64 * 1024;
/**
 * One document's unknown fields and placeholders at most: a quarter of a project's 2 MB
 * (`WORKSPACE_LIMITS.projectBytes`), so whatever a newer build stored, at least three quarters of a
 * project is what this build reads. Kept parts are saved with the project and count in its bytes
 * like any other field; a round trip never adds to them.
 */
export const EXTRAS_DOC_BYTES = 512 * 1024;

/**
 * The key a placeholder holds its raw object under. No release writes it (`restoreNewer` takes it
 * off before anything leaves the tab), so a newer build's own field can never be read as it.
 */
export const NEWER = '__cyberNewer' as const;

/** Names never copied onto an object (they would reach its prototype). */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', NEWER]);

export type FieldList = ReadonlySet<string>;
/** A type's named keys (an index signature's `string` left out), across a union. */
type Named<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type AllKeys<T> = T extends unknown ? Extract<keyof Named<T>, string> : never;

/**
 * The fields a sanitiser knows: every key of `T` (across a union) and any retired names it still
 * reads. A key of `T` missing from the list is a compile error naming it.
 */
export function fieldsOf<T>() {
  return <const K extends readonly string[]>(
    keys: K,
    ..._missing: [Exclude<AllKeys<T>, K[number]>] extends [never] ? [] : [missing: Exclude<AllKeys<T>, K[number]>]
  ): FieldList => new Set<string>(keys);
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** UTF-8 bytes of a string (no TextEncoder: this runs in workers and plain Node alike). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

let budget: { left: number } | null = null;

/**
 * Run one document's sanitise under the document bound. Nested calls share the outermost budget;
 * outside one, only the per-object bounds apply (a single object sanitised on its own).
 */
export function withExtrasBudget<T>(fn: () => T, bytes = EXTRAS_DOC_BYTES): T {
  if (budget) return fn();
  budget = { left: bytes };
  try { return fn(); } finally { budget = null; }
}

/** What each object's kept parts cost when they were kept, so an object reused whole is charged again. */
const cost = new WeakMap<object, number>();

/** A copy of `v` as JSON and its size, or null when it cannot be one or is over `cap` or the budget. */
function take(v: unknown, cap: number): { copy: unknown; bytes: number } | null {
  let text: string | undefined;
  try { text = JSON.stringify(v); } catch { return null; }
  if (text === undefined) return null;
  const bytes = utf8Bytes(text);
  if (bytes > cap || (budget && bytes > budget.left)) return null;
  if (budget) budget.left -= bytes;
  return { copy: JSON.parse(text) as unknown, bytes };
}

/** The unknown fields of `raw` (not in `known`, not already in `out`), or null. */
function unknownOf(raw: Record<string, unknown>, out: object, known: FieldList): Record<string, unknown> | null {
  let extras: Record<string, unknown> | null = null;
  for (const k of Object.keys(raw)) {
    if (known.has(k) || FORBIDDEN.has(k) || Object.prototype.hasOwnProperty.call(out, k) || raw[k] === undefined) continue;
    (extras ??= {})[k] = raw[k];
  }
  return extras;
}

/**
 * `out` with the unknown fields of `raw` kept beside its own (a new object only when there are
 * some, so a sanitiser's identity rules are unchanged otherwise). All of them or none: past the
 * object's or the document's bound none is kept.
 */
export function keepExtras<T extends object>(raw: unknown, out: T, known: FieldList): T {
  if (!isPlain(raw)) return out;
  const extras = unknownOf(raw, out, known);
  if (!extras) return out;
  const got = take(extras, EXTRAS_OBJECT_BYTES);
  if (!got) return out;
  const next = { ...out } as Record<string, unknown>;
  for (const [k, v] of Object.entries(got.copy as Record<string, unknown>)) next[k] = v;
  cost.set(next, got.bytes);
  return next as T;
}

/** The unknown fields an object carries (its own keys not in `known`), for a writer that lists fields (the room's notes). */
export function extrasOf(obj: object, known: FieldList): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k) || FORBIDDEN.has(k) || v === undefined) continue;
    (out ??= {})[k] = v;
  }
  return out;
}

/**
 * An object kept whole from before (`sanitiseSlidesData`'s identity reuse): its kept parts are
 * charged to the document's budget again, so the bound holds however the document was built.
 * False when the budget has no room left for them (the caller then sanitises it afresh).
 */
export function chargeKept(obj: object): boolean {
  const c = cost.get(obj);
  if (!c || !budget) return true;
  if (c > budget.left) return false;
  budget.left -= c;
  return true;
}

/**
 * `chargeKept` for several objects kept together: all of them charged, or none (false) when the
 * budget has no room for them all, so a caller that then sanitises them afresh charges each once.
 */
export function chargeKeptAll(objs: readonly object[]): boolean {
  if (!budget) return true;
  let c = 0;
  for (const o of objs) c += cost.get(o) ?? 0;
  if (c > budget.left) return false;
  budget.left -= c;
  return true;
}

/**
 * What a placeholder holds under `NEWER`: the raw object (`raw`), the fields this build owns on it
 * (`own`: copied from the placeholder onto `raw` as it is given back, e.g. its id after a duplicate),
 * or (`merge`) a part of a known object (an unknown engine's `engine` and `patch` on a track),
 * given back over the object only while `merge.key` is still `merge.is` (the person has not put
 * something of their own in its place).
 */
export interface Newer { raw: Record<string, unknown>; own?: string[]; merge?: { key: string; is: unknown } }

/** A placeholder's hold (`NEWER`), or undefined. */
export function newerOf(obj: unknown): Newer | undefined {
  if (!isPlain(obj)) return undefined;
  const n = (obj as Record<string, unknown>)[NEWER];
  return isPlain(n) && isPlain(n.raw) ? n as unknown as Newer : undefined;
}

/** Whether any placeholder was made in this tab (`restoreNewer`'s fast path: none, nothing to walk). */
let anyNewer = false;
export const hasPlaceholders = () => anyNewer;

/**
 * A placeholder of an unknown kind: `inert` (a known, silent shape this build can draw and play)
 * holding a copy of `raw` under `NEWER`, or null when `raw` is over `NEWER_OBJECT_BYTES` or the
 * document's budget (the kind is then left out, as before 1.661).
 */
export function holdNewer<T extends object>(raw: Record<string, unknown>, inert: T, opts: { own?: string[]; merge?: { key: string; is: unknown } } = {}): T | null {
  const got = take(raw, NEWER_OBJECT_BYTES);
  if (!got) return null;
  const hold: Newer = { raw: got.copy as Record<string, unknown>, ...(opts.own ? { own: opts.own } : {}), ...(opts.merge ? { merge: opts.merge } : {}) };
  const next = { ...inert, [NEWER]: hold } as T;
  cost.set(next, got.bytes);
  anyNewer = true;
  return next;
}

/** A placeholder as it is saved (its hold given back), else the object without `NEWER`. */
export function givenBack(obj: Record<string, unknown>): Record<string, unknown> {
  const n = newerOf(obj);
  const { [NEWER]: _n, ...rest } = obj;
  if (!n) return NEWER in obj ? rest : obj;
  if (n.merge) return rest[n.merge.key] === n.merge.is ? { ...rest, ...n.raw } : rest;
  const out: Record<string, unknown> = { ...n.raw };
  for (const k of n.own ?? []) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

/**
 * A raw object read again: one saved with its hold still on (a way out that missed
 * `restoreNewer`) is read as the object it holds, so nothing is lost even then. Anything else as it is.
 */
export function unwrapNewer(raw: unknown): unknown {
  return isPlain(raw) && NEWER in raw ? givenBack(raw) : raw;
}

/**
 * The value with every placeholder given back (`givenBack`), unchanged objects kept by reference:
 * a song (or any document) as it leaves the tab. Nothing is walked when no placeholder was made.
 */
export function restoreNewer<T>(value: T): T {
  if (!anyNewer) return value;
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const w = walk(v[i]);
      if (w !== v[i]) (out ??= v.slice())[i] = w;
    }
    return out ?? v;
  }
  if (!isPlain(v)) return v;
  const n = newerOf(v);
  if (n && !n.merge) return givenBack(v);
  let out: Record<string, unknown> | null = null;
  for (const [k, x] of Object.entries(v)) {
    if (k === NEWER) continue;
    const w = walk(x);
    if (w !== x) (out ??= { ...v })[k] = w;
  }
  const base = out ?? v;
  return NEWER in base ? givenBack(base) : base;
}

/** Tests only. */
export function resetPlaceholdersForTests(): void { anyNewer = false; }

/** The words a placeholder shows. */
export const NEWER_WORDS = 'Made in a newer Cyber';
