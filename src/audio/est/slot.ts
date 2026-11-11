/**
 * EST Phase 2 foundation (docs/est/EST_Phase2_Work_Order.md §0.1): what a project stores for one
 * EST plugin instance, shared by the mixer insert (stream 2-A), persistence and live sessions
 * (2-B), the UI (2-C) and the install pipeline (2-D). Pure: no DOM, no Web Audio, no store.
 *
 * A slot names its plugin by `id`, `version` and the bundle's content `hash` (D-12: a project pins
 * its version; opening a project never installs or updates anything, D-13). Its state is the
 * plugin's CLAP state stream, inline as base64 up to `EST_STATE_INLINE_MAX` (D-17), otherwise the
 * content hash of an `application/x-est-state` blob kept like an upload. `params` is the host's
 * cache of the plugin's plain parameter values (CLAP ids as decimal strings): what the generated
 * UI, MIDI learn and the card show before the instance is ready, never the plugin's truth.
 */

/** EST plugin ids (spec §1): reverse-DNS, lower case, 3–120 characters. */
export const EST_ID_RE = /^[a-z0-9](?:[a-z0-9.-]{1,118})[a-z0-9]$/;
/** A plain semver 2.0.0 version (a pre-release or build part allowed, as the spec says). */
export const EST_VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
/** A bundle's SHA-256, lower-case hex. */
export const EST_HASH_RE = /^[0-9a-f]{64}$/;

/** D-17: a state stream kept inline in the project, at most this many bytes (before base64). */
export const EST_STATE_INLINE_MAX = 64 * 1024;
/** D-17: a larger state goes out of line as a blob, at most this many bytes. */
export const EST_STATE_BLOB_MAX = 4 * 1024 * 1024;
/** At most this many cached parameter values per slot (CLAP allows more; the cache needs no more). */
export const EST_PARAMS_MAX = 512;

export interface EstRef {
  /** The plugin's `est.json` id. */
  id: string;
  version: string;
  /** The bundle's content hash: the exact bytes this project was made with. */
  hash: string;
}

export interface EstSlotBlock {
  ref: EstRef;
  /** The plugin's name and vendor when it was added: shown by a missing-plugin placeholder. */
  name: string;
  vendor: string;
  /** Base64 of the CLAP state stream, at most `EST_STATE_INLINE_MAX` bytes decoded; null: none saved. */
  state: string | null;
  /** The content hash of a state blob larger than the inline limit; null when inline or none. */
  stateBlob: string | null;
  /** Plain parameter values by CLAP param id (decimal string). */
  params: Record<string, number>;
}

/** Text with control characters (below U+0020, and U+007F) removed, then cut to `max`. */
const text = (v: unknown, max: number) => {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  return out.slice(0, max);
};

/** Decoded byte length of a base64 string, or -1 when it is not base64. */
export function base64Bytes(s: string): number {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return -1;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

export function sanitiseEstRef(raw: unknown): EstRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !EST_ID_RE.test(r.id)) return null;
  if (typeof r.version !== 'string' || !EST_VERSION_RE.test(r.version)) return null;
  if (typeof r.hash !== 'string' || !EST_HASH_RE.test(r.hash)) return null;
  return { id: r.id, version: r.version, hash: r.hash };
}

/**
 * One slot block from anything (a project, a live room, a paste). Null only when the plugin
 * reference itself is unusable: an unknown but well-formed plugin is kept (it becomes a
 * missing-plugin placeholder at run time, D-10), and a bad state is dropped rather than the slot.
 */
export function sanitiseEstBlock(raw: unknown): EstSlotBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ref = sanitiseEstRef(r.ref);
  if (!ref) return null;
  let state: string | null = null;
  if (typeof r.state === 'string') {
    const n = base64Bytes(r.state);
    if (n >= 0 && n <= EST_STATE_INLINE_MAX) state = r.state;
  }
  const stateBlob = state === null && typeof r.stateBlob === 'string' && EST_HASH_RE.test(r.stateBlob) ? r.stateBlob : null;
  const params: Record<string, number> = {};
  if (r.params && typeof r.params === 'object') {
    let count = 0;
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      if (count >= EST_PARAMS_MAX) break;
      if (!/^\d{1,10}$/.test(k) || Number(k) > 0xffffffff) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      params[k] = v;
      count++;
    }
  }
  return { ref, name: text(r.name, 60) || ref.id, vendor: text(r.vendor, 60), state, stateBlob, params };
}

/**
 * 1.337 (R-F): one entry of a manifest's optional `migrate` list, what a version says about the
 * settings of its earlier versions (`Cyber_EST_Robustness_Work_Order.md` R-F; `migrate.ts` applies
 * it on Use installed version). The host applies the first entry whose `from` takes the version
 * moved from: a renamed parameter's value moves to its new id, a `null` drops it, an old id neither
 * names nor the new version lists is dropped with a note, and `state: 'drop'` leaves the saved
 * state behind on purpose.
 */
export interface EstMigrateEntry {
  /** The versions it applies to: comparators separated by spaces (`>=1.0.0 <1.2.0`), a bare version (that one) or `*`. */
  from: string;
  /** Old CLAP id (a decimal string) → new id, or null (dropped). */
  params: Record<string, string | null>;
  /** Whether the saved state crosses: 'keep' (the default) or 'drop'. */
  state: 'keep' | 'drop';
}
/** At most this many `migrate` entries in a manifest. */
export const EST_MIGRATE_MAX = 32;
/** A `from` range's text, at most. */
export const EST_MIGRATE_FROM_MAX = 100;

/** The same plugin, version and bytes. */
export const sameEstRef = (a: EstRef, b: EstRef) => a.id === b.id && a.version === b.version && a.hash === b.hash;

/**
 * EST Phase 3 (1.283): the slot id an EST instrument track's block is registered under, beside its
 * strip's inserts (status.ts, placeholders.ts): a NUL is never in an insert's id (`ID_RE`), so it
 * cannot meet one. The track's id is the strip's.
 */
export const EST_TRACK_SLOT = '\u0000instrument';
