/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §1): what the host has learned of a plugin's
 * parameters (names, ranges, flags), by bundle hash, from the instances that reached `ready`. The
 * automation picker, the lane labels and a lane's starting value read it; nothing that plays reads
 * it (a lane plays 0…1 and the processor maps it onto the parameter's range, so playback never
 * depends on what is known here). Pure and light: no Web Audio, no store.
 */

import { hasHiddenText } from '../../../shared/estHiddenText.mjs';

/** CLAP's parameter flags the host reads (clap/ext/params.h). */
export const CLAP_PARAM_IS_STEPPED = 1;
export const CLAP_PARAM_IS_HIDDEN = 4;
export const CLAP_PARAM_IS_READONLY = 8;
export const CLAP_PARAM_IS_BYPASS = 16;
export const CLAP_PARAM_IS_AUTOMATABLE = 32;

/** One parameter as the processor reports it (Phase 1's `EstParam` shape; `scale` since 1.286, absent: linear). */
export interface EstParamInfo {
  id: number; name: string; module: string; min: number; max: number; def: number; flags: number; scale?: 'linear' | 'log';
  /** 1.804: a stepped parameter's value text, by step (index: the value less `min`; '' where the plugin gave none). Runtime only: never saved or sent. */
  labels?: readonly string[];
}

/**
 * 1.804 (value text): the most steps a labelled parameter has and the longest label kept, in code
 * points (the processor's `LABEL_STEPS` and `LABEL_CHARS`, held equal by `paramInfo.test.ts`).
 */
export const EST_LABEL_STEPS = 64;
export const EST_LABEL_CHARS = 32;
// eslint-disable-next-line no-control-regex -- the control characters are the point
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * 1.804: a stepped parameter's labels as the host shows them, or undefined for none. The text is
 * the plugin's, so untrusted: only for a stepped parameter with whole ends and 2…64 steps, one
 * label a step; a label is trimmed and dropped ('' : the number shows) when it is not a string, is
 * empty, is longer than `EST_LABEL_CHARS`, holds a control character or an invisible or direction
 * character (shared/estHiddenText.mjs, the one rule), or only says the step's own number. It is
 * always drawn as text, never as markup.
 */
export function cleanEstLabels(p: Pick<EstParamInfo, 'min' | 'max' | 'flags'>, labels: unknown): string[] | undefined {
  if (!(p.flags & CLAP_PARAM_IS_STEPPED) || !Array.isArray(labels)) return undefined;
  const steps = p.max - p.min + 1;
  if (!Number.isInteger(p.min) || !Number.isInteger(p.max) || steps < 2 || steps > EST_LABEL_STEPS || labels.length !== steps) return undefined;
  let any = false;
  const out = labels.map((raw: unknown, i) => {
    if (typeof raw !== 'string' || raw.length > EST_LABEL_CHARS * 2) return '';
    const s = raw.trim();
    if (!s || Array.from(s).length > EST_LABEL_CHARS || CONTROL_RE.test(s) || hasHiddenText(s)) return '';
    if (Number(s) === p.min + i) return '';
    any = true;
    return s;
  });
  return any ? out : undefined;
}

/** 1.804: the label of value `v` of a stepped parameter, or '' (no labels, or none for that step). */
export function estLabelOf(p: Pick<EstParamInfo, 'min' | 'flags' | 'labels'>, v: number): string {
  if (!p.labels || !(p.flags & CLAP_PARAM_IS_STEPPED)) return '';
  return p.labels[Math.round(v) - p.min] ?? '';
}

const known = new Map<string, readonly EstParamInfo[]>();
const listeners = new Set<() => void>();

/** Remember a plugin's parameters (by its bundle's hash): an instance reached `ready`. */
export function rememberEstParams(hash: string, params: readonly EstParamInfo[]) {
  const prev = known.get(hash);
  const next = params.map(p => {
    // 1.804: an instance that asked for no labels (an offline render's) never takes away the ones known.
    const was = prev?.find(x => x.id === p.id);
    const labels = cleanEstLabels(p, p.labels) ?? (was && was.min === p.min && was.max === p.max && was.flags === p.flags ? was.labels : undefined);
    return { id: p.id, name: p.name, module: p.module, min: p.min, max: p.max, def: p.def, flags: p.flags, ...(p.scale === 'log' ? { scale: 'log' as const } : {}), ...(labels ? { labels } : {}) };
  });
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  known.set(hash, next);
  for (const fn of listeners) fn();
}

/** The parameters known for a bundle, or null before any of its instances was ready. */
export const estParamInfo = (hash: string): readonly EstParamInfo[] | null => known.get(hash) ?? null;

/** One parameter by its CLAP id (a decimal string or a number), or null. */
export function estParamById(hash: string, id: string | number): EstParamInfo | null {
  const n = typeof id === 'number' ? id : Number(id);
  return known.get(hash)?.find(p => p.id === n) ?? null;
}

/** Whether a lane may drive the parameter: automatable, not read-only, not hidden. */
export const isEstAutomatable = (p: Pick<EstParamInfo, 'flags'>) =>
  (p.flags & CLAP_PARAM_IS_AUTOMATABLE) !== 0 && (p.flags & (CLAP_PARAM_IS_READONLY | CLAP_PARAM_IS_HIDDEN)) === 0;

/** Whether 0…1 moves geometrically over the parameter's range (EST tidy, 1.286: `scale: 'log'` over a range above 0). */
export const isEstLog = (p: Pick<EstParamInfo, 'min' | 'max'> & { scale?: string }): boolean => p.scale === 'log' && p.min > 0 && p.max > p.min;

/** A plain value as 0…1 over the parameter's range (a lane's value; a log parameter's geometrically). */
export function estToNorm(p: Pick<EstParamInfo, 'min' | 'max'> & { scale?: string }, v: number): number {
  const span = p.max - p.min;
  if (!(span > 0)) return 0;
  if (isEstLog(p)) return v > p.min ? Math.min(1, Math.log(v / p.min) / Math.log(p.max / p.min)) : 0;
  return Math.min(1, Math.max(0, (v - p.min) / span));
}

/** 0…1 as a plain value (a stepped parameter rounded), as the processor maps a lane's events. */
export function estFromNorm(p: Pick<EstParamInfo, 'min' | 'max' | 'flags'> & { scale?: string }, u: number): number {
  const c = Math.min(1, Math.max(0, u));
  const v = isEstLog(p) ? p.min * Math.pow(p.max / p.min, c) : p.min + c * (p.max - p.min);
  return p.flags & CLAP_PARAM_IS_STEPPED ? Math.round(v) : v;
}

/**
 * EST Phase 3 (1.283): the longest tail (`clap.tail`, s) an instance of a bundle reported, so an
 * export or a freeze renders that much past its last note (the manifest's `limits.tailSeconds` is
 * the other bound, read beside it).
 */
const tails = new Map<string, number>();
export function rememberEstTail(hash: string, seconds: number) {
  if (Number.isFinite(seconds) && seconds > (tails.get(hash) ?? 0)) tails.set(hash, Math.min(60, seconds));
}
export const estTailOf = (hash: string): number => tails.get(hash) ?? 0;

/** Hear when what is known changes. Returns the unsubscribe. */
export function onEstParamInfo(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only. */
export function resetEstParamInfoForTests() { known.clear(); tails.clear(); }
