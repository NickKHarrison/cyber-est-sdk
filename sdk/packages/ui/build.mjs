#!/usr/bin/env node
/**
 * Builds `@est/ui` (esbuild; no dependencies at run time):
 * - `dist/est-ui.js`: the classic script a plugin's `ui/` loads (`window.EstUI`), minified: the
 *   file `est pack` copies into a bundle's `ui/` when the UI's HTML names it (`copyRule.mjs`);
 * - `dist/index.js`: the ES module, for a UI written in TypeScript and bundled into one script.
 *
 *   node sdk/packages/ui/build.mjs           # write dist/
 *   node sdk/packages/ui/build.mjs --check   # fail when dist/ is not what the sources build
 *
 * dist/ is committed, so packing a plugin needs no build of this package.
 */
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BANNER = '/* @est/ui (MIT): the EST plugin UI library, frame protocol v2. */';

/** The two builds' text, by file name under dist/. */
export async function buildUi() {
  /** @type {import('esbuild').BuildOptions} */
  const common = { bundle: true, write: false, target: 'es2022', legalComments: 'none', charset: 'utf8', banner: { js: BANNER }, logLevel: 'silent' };
  const [iife, esm] = await Promise.all([
    build({ ...common, entryPoints: [join(HERE, 'src/global.ts')], format: 'iife', minify: true, mangleProps: /^_[a-zA-Z]/ }),
    build({ ...common, entryPoints: [join(HERE, 'src/index.ts')], format: 'esm', minify: false }),
  ]);
  /** `write: false`: the files come back. @param {import('esbuild').BuildResult} r */
  const text = (r) => /** @type {import('esbuild').OutputFile[]} */ (r.outputFiles)[0].text;
  return { 'est-ui.js': text(iife), 'index.js': text(esm) };
}

/** The names under dist/ that differ from a fresh build (empty when up to date). */
export async function staleUi() {
  const out = await buildUi();
  return Object.entries(out)
    .filter(([name, text]) => {
      const file = join(HERE, 'dist', name);
      return !existsSync(file) || readFileSync(file, 'utf8') !== text;
    })
    .map(([name]) => name);
}

async function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const stale = await staleUi();
    if (stale.length) {
      console.error(`@est/ui: dist/ is stale (${stale.join(', ')}); run node sdk/packages/ui/build.mjs`);
      process.exit(1);
    }
    console.log('@est/ui: dist/ is up to date');
    return;
  }
  const out = await buildUi();
  mkdirSync(join(HERE, 'dist'), { recursive: true });
  for (const [name, text] of Object.entries(out)) writeFileSync(join(HERE, 'dist', name), text);
  console.log(`@est/ui: est-ui.js ${Buffer.byteLength(out['est-ui.js'])} bytes minified`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
