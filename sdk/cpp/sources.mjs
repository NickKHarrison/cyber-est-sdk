#!/usr/bin/env node
/**
 * What a C or C++ module is built from, as SHA-256 digests (EST-DEV-3, DEV-G 1.326): the folder's
 * est.json and est-build.json, its sources, every file in the include folders est-build.json
 * names, and the kit's own inputs (`est/runtime.hpp`, `freestanding/`, `build.mjs`,
 * `toolchain.mjs`). `scripts/est-cpp-fixtures.sh` writes it beside each committed module
 * (`<module>.sources.json`) and `sdk/tests/cppKit.test.ts` checks it on every run, toolchain or
 * not, so a source changed without rebuilding the committed module fails the suite.
 *
 *     node sdk/cpp/sources.mjs <plugin dir>     prints the JSON
 *
 * Paths are relative to the repository's root, forward slashes, sorted.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SOURCE = /\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|inc)$/i;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap(n => {
    const p = join(dir, n);
    if (['build', 'dist', 'node_modules'].includes(n)) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The digests a folder's module is built from. @param {string} dir @returns {{ files: Record<string, string> }} */
export function sourcesDigest(dir) {
  const d = resolve(dir);
  const cfg = JSON.parse(readFileSync(join(d, 'est-build.json'), 'utf8'));
  const abs = (/** @type {string} */ p) => (isAbsolute(p) ? p : join(d, p));
  const set = new Set([join(d, 'est.json'), join(d, 'est-build.json')]);
  for (const s of Array.isArray(cfg.sources) ? cfg.sources : ['src/plugin.cpp']) set.add(abs(s));
  for (const inc of Array.isArray(cfg.include) ? cfg.include : []) for (const f of walk(abs(inc))) if (SOURCE.test(f)) set.add(f);
  set.add(join(HERE, 'include', 'est', 'runtime.hpp'));
  for (const f of walk(join(HERE, 'freestanding'))) set.add(f);
  set.add(join(HERE, 'build.mjs'));
  set.add(join(HERE, 'toolchain.mjs'));
  /** @type {Record<string, string>} */
  const files = {};
  for (const f of [...set].map(f => resolve(f)).sort()) {
    files[relative(ROOT, f).split(sep).join('/')] = createHash('sha256').update(readFileSync(f)).digest('hex');
  }
  return { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.stdout.write(`${JSON.stringify(sourcesDigest(process.argv[2] ?? '.'), null, 2)}\n`);
