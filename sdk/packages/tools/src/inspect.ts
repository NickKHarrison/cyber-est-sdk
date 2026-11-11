/**
 * @cyber-est/tools: `inspect` (EST Phase 4). What a bundle holds, read with Cyber's own reader: the
 * manifest, every file with its size and hash, and the module's imports, exports, memory, tables
 * and start section, and, with `meter: true`, what metering adds. A bundle the host refuses is
 * still described as far as it can be read, with the refusal (its rule) beside it.
 */
import { EstBundleError, inspectWasm, readBundle, readStoredZip, type WasmInspection } from '../../../../src/audio/est/install/bundle';
import { meterRuleOf } from '../../../../src/audio/est/install/pipeline';
import { loadMeter } from './host';
import { sha256 } from './pack.mjs';

export interface Inspection {
  hash: string;
  bytes: number;
  /** The manifest as the host reads it, or (refused) as its JSON says, or null. */
  manifest: Record<string, unknown> | null;
  files: { path: string; bytes: number; sha256: string }[];
  module: (WasmInspection & { path: string; bytes: number; metered?: { bytes: number; points: number } | { error: string; rule: string } }) | null;
  /** Why the host refuses it, or null. */
  refusal: { code: string; rule: string; message: string; where: string | null } | null;
}

export async function inspect(bytes: Uint8Array, opts: { meter?: boolean } = {}): Promise<Inspection> {
  const out: Inspection = { hash: sha256(bytes), bytes: bytes.length, manifest: null, files: [], module: null, refusal: null };
  let files: Map<string, Uint8Array> | null;
  let modulePath = 'module.wasm';
  try {
    const b = await readBundle(bytes);
    files = b.files;
    out.manifest = b.manifest as unknown as Record<string, unknown>;
    modulePath = b.manifest.module.path;
  } catch (err) {
    if (!(err instanceof EstBundleError)) throw err;
    out.refusal = { code: err.code, rule: err.rule, message: err.message, where: err.where };
    try { files = new Map(readStoredZip(bytes).map(e => [e.name, e.data])); } catch { files = null; }
    const json = files?.get('est.json');
    if (json) {
      try {
        const raw = JSON.parse(new TextDecoder().decode(json)) as Record<string, unknown>;
        out.manifest = raw;
        const m = raw.module as { path?: unknown } | undefined;
        if (typeof m?.path === 'string') modulePath = m.path;
      } catch { /* not JSON: the refusal says so */ }
    }
  }
  if (!files) return out;
  out.files = [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) }));
  const mod = files.get(modulePath);
  if (mod) {
    let w: WasmInspection | null;
    try { w = inspectWasm(mod); } catch { w = null; }
    if (w) {
      out.module = { path: modulePath, bytes: mod.length, ...w };
      if (opts.meter) {
        try {
          const r = (await loadMeter())(mod, { mode: 'local' });
          out.module.metered = { bytes: r.bytes.length, points: r.points };
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          out.module.metered = { error: why, rule: meterRuleOf(why) };
        }
      }
    }
  }
  return out;
}
