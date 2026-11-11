/**
 * EST Phase 4 (4-B): what the SDK's tests share. A built module (committed under sdk/fixtures/,
 * written by scripts/est-sdk-fixtures.sh: the suite needs no Rust or AssemblyScript toolchain)
 * packed with a template's est.json, read, metered and run as Cyber's install does it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packBundle } from '../../scripts/est-pack.mjs';
import { readPluginDir } from '../packages/tools/src/pack.mjs';
import { readBundle, type EstBundle } from '../../src/audio/est/install/bundle';
import { runConformance, type ConformanceReport } from '../../src/audio/est/install/conformance';
import { meter } from '../../src/audio/est/install/estMeter';
import { estShim } from '../testing/golden';

/** A path from the repository's root. */
export const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
export const bytes = (p: string) => new Uint8Array(readFileSync(repo(p)));
export const json = <T = Record<string, unknown>>(p: string) => JSON.parse(readFileSync(repo(p), 'utf8')) as T;

export interface Packed { bundle: EstBundle; module: WebAssembly.Module }

/** `wasm` packed with `dir`'s est.json (and its ui/ and presets/ when it has them), read and metered. */
export async function packed(dir: string, wasm: Uint8Array): Promise<Packed> {
  const manifest = json<{ ui?: unknown }>(`${dir}/est.json`);
  // A plugin with its own page (DEV-F's visualiser): its ui/ and @est/ui, as `est pack` packs them
  // (readPluginDir reads a module from disk: est.json stands in for it, then the built one replaces it).
  const files: Record<string, Uint8Array> = manifest.ui ? { ...readPluginDir(repo(dir), { module: repo(`${dir}/est.json`) }).files, 'module.wasm': wasm } : { 'module.wasm': wasm };
  const bundle = await readBundle(packBundle(manifest, files).bytes);
  return { bundle, module: new WebAssembly.Module(meter(bundle.module).bytes as BufferSource) };
}

/** The install's conformance run on a packed plugin. */
export function conform(p: Packed, seconds = 4): ConformanceReport {
  return runConformance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest, seconds });
}
