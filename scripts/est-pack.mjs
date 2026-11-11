#!/usr/bin/env node
/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §4; the specification draft §1 and §2): packs a
 * `.est` bundle, the canonical way the host's reader (`src/audio/est/install/bundle.ts`) accepts:
 * a ZIP of **stored** entries only, `est.json` first, then `module.wasm`, then every other file in
 * name order; no directories, no extra fields, no comment, every time stamp 1980-01-01 00:00, so
 * the same files always give the same bytes and so the same content hash (the SHA-256 of the
 * archive, which names the bundle everywhere: `EstRef.hash`, `/est/b/<hash>/…`).
 *
 * `est.json` is completed here from the files: `module.sha256` and `module.bytes`, `ui.sha256`,
 * and `assets` (every other file, each hashed), so a plugin's source manifest leaves them out.
 *
 *   node scripts/est-pack.mjs <plugin dir> <module.wasm> <out dir> [--est-ui <est-ui.js>]
 *
 * `--est-ui` (EST tidy, 1.286): the @cyber-est/ui script to copy into a UI that names it, instead of the
 * SDK's current build: a frozen bundle (est-plugins/vendor/est-eq-1.0.0/) carries the library it
 * shipped with, so its bytes never change.
 *
 * reads `<plugin dir>/est.json`, `<plugin dir>/ui/**` when the manifest has a `ui`,
 * `<plugin dir>/presets/**` when it has `presets` (EST Phase 3; spec §6), and
 * `<plugin dir>/LICENSE` (or `est-plugins/LICENSE`), and writes into `<out dir>/<hash>/` the bundle
 * (`bundle.est`) and its files unpacked, as the plugin origin serves them
 * (`server/estOrigin.mjs`: `/est/b/<hash>/<path>`). Prints `{ id, version, name, kind, hash, bytes, module }`
 * as JSON (a line of est-plugins/dist/reference.json).
 *
 * EST Phase 4 (4-A): the packer itself moved to @cyber-est/tools (`sdk/packages/tools/src/pack.mjs`);
 * this script is a thin wrapper that writes the same bytes (the reference hashes prove it), and
 * re-exports `sha256`, `crc32`, `storedZip` and `packBundle` for its existing importers.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDir } from '../sdk/packages/tools/src/pack.mjs';

export { crc32, packBundle, sha256, storedZip } from '../sdk/packages/tools/src/pack.mjs';

function main() {
  const args = process.argv.slice(2);
  const ui = args.indexOf('--est-ui');
  const estUi = ui >= 0 ? args.splice(ui, 2)[1] : undefined;
  const [pluginDir, wasm, outDir] = args;
  if (!pluginDir || !wasm || !outDir || (ui >= 0 && !estUi)) {
    console.error('usage: node scripts/est-pack.mjs <plugin dir> <module.wasm> <out dir> [--est-ui <est-ui.js>]');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packed = packDir(pluginDir, { module: wasm, license: join(root, 'est-plugins', 'LICENSE'), ...(estUi ? { estUi } : {}) });
  const dir = join(outDir, packed.hash);
  rmSync(dir, { recursive: true, force: true });
  for (const [name, data] of Object.entries(packed.files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  writeFileSync(join(dir, 'bundle.est'), packed.bytes);
  console.log(JSON.stringify({ id: packed.manifest.id, version: packed.manifest.version, name: packed.manifest.name, kind: packed.manifest.kind, hash: packed.hash, bytes: packed.bytes.length, module: packed.manifest.module.bytes }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
