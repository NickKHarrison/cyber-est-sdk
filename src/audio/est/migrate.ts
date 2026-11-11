/**
 * 1.337 (R-F, `Cyber_EST_Robustness_Work_Order.md`): version upgrades that keep settings. A
 * manifest's optional `migrate` list (`EstMigrateEntry`, slot.ts; read by `bundle.ts`, EST-M022)
 * says what a version does with the settings of its earlier versions; Use installed version
 * (`estActions.ts`' `switchEstInsertVersion` and `switchEstTrackVersion`) applies it through
 * `migrateEstBlock` and words what happened through `estSwitchWords` (the toast in
 * `EstSlotActions.tsx`). Pure and light: no DOM, no Web Audio, no store (the install pipeline runs
 * the range parser in the compiling Worker and in the SDK's validator).
 *
 * A `from` range is comparators separated by spaces, all of which must hold (`>=1.0.0 <1.2.0`), a
 * bare version (that version only) or `*` (every version). Versions compare as `compareEstVersions`
 * does (the numbers, then a pre-release before its release; build metadata ignored).
 */
import type { EstManifestInfo } from './library';
import { compareEstVersions } from './slotActions';
import { EST_MIGRATE_FROM_MAX, EST_VERSION_RE, type EstMigrateEntry, type EstSlotBlock } from './slot';

const CLAP_ID_RE = /^\d{1,10}$/;
const COMPARATOR_RE = /^(>=|<=|>|<|=)?(\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?)$/;

/** A parsed `from` range: every comparator must hold. Empty: every version (`*`). */
export type EstRange = { op: '>=' | '<=' | '>' | '<' | '='; version: string }[];

/** The range `text` parses to, or null when it is not one (`EST-M022` at install). */
export function parseEstRange(text: string): EstRange | null {
  if (typeof text !== 'string' || !text.trim() || text.length > EST_MIGRATE_FROM_MAX) return null;
  const out: EstRange = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (tok === '*') continue;
    const m = COMPARATOR_RE.exec(tok);
    if (!m || !EST_VERSION_RE.test(m[2]!)) return null;
    out.push({ op: (m[1] as EstRange[number]['op'] | undefined) ?? '=', version: m[2]! });
  }
  return out;
}

/** Whether `version` is in the range `text` (a range that does not parse takes nothing). */
export function estRangeTakes(text: string, version: string): boolean {
  const range = parseEstRange(text);
  if (!range) return false;
  return range.every(({ op, version: v }) => {
    const c = compareEstVersions(version, v);
    return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
  });
}

/** The first entry of `migrate` whose `from` takes `fromVersion`, or null. */
export function estMigrationFor(migrate: readonly EstMigrateEntry[] | undefined, fromVersion: string): EstMigrateEntry | null {
  return migrate?.find(e => estRangeTakes(e.from, fromVersion)) ?? null;
}

/** What a switch did with a slot's settings (ids as the block keys them: decimal strings). */
export interface EstSwitchReport {
  /** The version moved from and to. */
  from: string;
  to: string;
  /** Cached values that crossed under the same id. */
  kept: number;
  /** Values moved to a new id (`params` named a rename). */
  moved: { from: string; to: string }[];
  /** Values dropped because `params` says `null`. */
  dropped: string[];
  /** Values dropped because the new version lists no such id (and `params` says nothing of it). */
  unknown: string[];
  /** The saved state left behind (`state: 'drop'`). */
  stateDropped: boolean;
}

/**
 * The block as the new version `to` takes it, under the first `migrate` entry that takes the
 * block's version, with a report of what moved; null when no entry applies (the block then
 * crosses as it is, as before 1.337). The ref, name and vendor are the caller's to set.
 */
export function migrateEstBlock(block: EstSlotBlock, to: Pick<EstManifestInfo, 'version' | 'migrate' | 'paramNames'>): { block: EstSlotBlock; report: EstSwitchReport } | null {
  const entry = estMigrationFor(to.migrate, block.ref.version);
  if (!entry) return null;
  const known = to.paramNames ? new Set(Object.keys(to.paramNames)) : null;
  const report: EstSwitchReport = { from: block.ref.version, to: to.version, kept: 0, moved: [], dropped: [], unknown: [], stateDropped: entry.state === 'drop' };
  const params: Record<string, number> = {};
  const movedTo = new Set<string>();
  // The renames first, so a moved value wins over a stale one already under the new id.
  for (const [k, v] of Object.entries(block.params)) {
    if (!(k in entry.params)) continue;
    const target = entry.params[k];
    if (target === null || target === undefined) { report.dropped.push(k); continue; }
    params[target] = v;
    movedTo.add(target);
    report.moved.push({ from: k, to: target });
  }
  for (const [k, v] of Object.entries(block.params)) {
    if (k in entry.params || movedTo.has(k)) continue;
    if (known && !known.has(k)) { report.unknown.push(k); continue; }
    params[k] = v;
    report.kept++;
  }
  const next: EstSlotBlock = entry.state === 'drop' ? { ...block, state: null, stateBlob: null, params } : { ...block, params };
  return { block: next, report };
}

/** A parameter's name for the toast: `names(id)` when it knows it, else "parameter <id>". */
export type EstParamNamer = (id: string) => string | undefined;

/**
 * The toast's words for a report: "Kept 12 settings; Drive became Saturation; Old Mix dropped;
 * Parameter 9 dropped (not in 1.1.0); its saved state left behind". `oldName` names an id as the
 * old version called it, `newName` as the new one does.
 */
export function estSwitchWords(r: EstSwitchReport, oldName: EstParamNamer, newName: EstParamNamer): string {
  const old = (id: string) => oldName(id) ?? `Parameter ${id}`;
  const parts: string[] = [];
  parts.push(r.kept === 0 ? 'Kept no settings' : `Kept ${r.kept} setting${r.kept === 1 ? '' : 's'}`);
  for (const m of r.moved) {
    const a = old(m.from);
    const b = newName(m.to) ?? `Parameter ${m.to}`;
    parts.push(a === b ? `${a} moved` : `${a} became ${b}`);
  }
  for (const id of r.dropped) parts.push(`${old(id)} dropped`);
  for (const id of r.unknown) parts.push(`${old(id)} dropped (not in ${r.to})`);
  if (r.stateDropped) parts.push('its saved state left behind');
  return parts.join('; ');
}

/** Whether `k` is a CLAP id as a block keys it. */
export const isEstParamKey = (k: string): boolean => CLAP_ID_RE.test(k) && Number(k) <= 0xffffffff;
