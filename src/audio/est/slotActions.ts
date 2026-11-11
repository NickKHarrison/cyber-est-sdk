/**
 * EST Phase 5a, stream 5-A (docs/est/EST_Phase5a_Work_Order.md §1, §6): what an EST slot or track
 * offers, by its status and the versions of its plugin installed here. Pure and light (no store, no
 * DOM, no Web Audio): the card, the window's placeholder, the instrument panel and 5-D read it.
 *
 * - **install**: a plugin not installed here that Cyber can install (Available: the reference list,
 *   from 5b the catalogue): the version the slot names when it is available, else the newest one.
 * - **useVersion**: the other installed versions of the same plugin, newest first. A slot whose exact
 *   version is not installed (`other-version`) offers them as **Use installed version…**; a running
 *   slot may move too (the UX's "Use latest in this project"). The move keeps the slot's state.
 * - **replace**: any EST slot may be swapped for another installed plugin of its kind (its state
 *   dropped, its place kept), unless it is blocked or refused: those say why and offer nothing.
 */
import type { EstInstalled, EstUnavailable } from './library';
import { sameEstRef, type EstRef } from './slot';

/** Semver order of two versions (the numbers only; a pre-release sorts before its release): <0, 0, >0. */
export function compareEstVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const plain = v.split('+')[0] ?? '';
    const dash = plain.indexOf('-');
    const core = dash < 0 ? plain : plain.slice(0, dash);
    return { nums: core.split('.').map(n => Number(n) || 0), pre: dash < 0 ? null : plain.slice(dash + 1) };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * EST Phase 5a (5-D): the one rule for "the newest version of each plugin": of a list naming a
 * plugin in several versions, the newest of each id (`compareEstVersions`; a `superseded` entry
 * never), the rest in the list's order. The reference list offered (`EST_REFERENCE`,
 * `estReferenceList()`) and the Browser's Available rows (`pluginRows`) both go through it.
 */
export function newestOfEach<T>(list: readonly T[], refOf: (t: T) => { id: string; version: string; superseded?: boolean }): T[] {
  return list.filter(t => {
    const r = refOf(t);
    return !r.superseded && !list.some(o => { const x = refOf(o); return x.id === r.id && compareEstVersions(x.version, r.version) > 0; });
  });
}

export interface EstSlotActionSet {
  /** Install this (Available) version: the slot's own when available, else the newest. */
  install?: EstRef;
  /** Other installed versions of the slot's plugin, newest first (never empty when present). */
  useVersion?: readonly EstInstalled[];
  /** Replace plugin… (another installed plugin of the kind takes the slot). */
  replace?: true;
}

export interface EstActionContext {
  /** The plugin the slot names. */
  ref: EstRef;
  /** What Cyber can install here (the reference list; from 5b the catalogue). */
  available?: readonly EstRef[];
  /** Whether another installed plugin of the slot's kind exists to replace it with (default true). */
  replaceable?: boolean;
}

/**
 * The actions an EST slot or track offers (contract §6). `status` is the slot's (`estStatusOf`);
 * `installedVersions` the library's records (any plugin: those of another id are ignored).
 */
export function actionsFor(
  status: { state: 'loading' | 'ready' | 'placeholder'; reason?: EstUnavailable },
  installedVersions: readonly EstInstalled[],
  ctx: EstActionContext,
): EstSlotActionSet {
  const reason = status.state === 'placeholder' ? status.reason : undefined;
  // Blocked (not an admin's, or by a registry) and refused (failed the safety check) say why and offer nothing.
  if (reason === 'blocked' || reason === 'refused') return {};
  const out: EstSlotActionSet = {};
  const others = installedVersions
    .filter(i => i.ref.id === ctx.ref.id && !sameEstRef(i.ref, ctx.ref))
    .slice()
    .sort((a, b) => compareEstVersions(b.ref.version, a.ref.version) || (a.installedAt < b.installedAt ? 1 : a.installedAt > b.installedAt ? -1 : 0));
  if (others.length) out.useVersion = others;
  if (reason === 'not-installed') {
    const same = (ctx.available ?? []).filter(r => r.id === ctx.ref.id);
    const exact = same.find(r => r.version === ctx.ref.version && r.hash === ctx.ref.hash);
    const newest = same.slice().sort((a, b) => compareEstVersions(b.version, a.version))[0];
    const pick = exact ?? newest;
    if (pick) out.install = pick;
  }
  if (ctx.replaceable !== false) out.replace = true;
  return out;
}
