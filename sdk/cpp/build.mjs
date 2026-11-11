#!/usr/bin/env node
/**
 * `est`'s C and C++ build (EST-DEV-3, DEV-G; sdk/docs/porting-cpp.md): the build of a plugin
 * folder with an `est-build.json` (the `cpp-clap` template, the JUCE kit's `est/`). `est pack`,
 * `est validate`, `est test` and `est dev` run it (`readProject`'s `cpp` kind):
 *
 *     node sdk/cpp/build.mjs <plugin dir> [--print]
 *
 * It compiles each source to wasm32 with the toolchain `toolchain.mjs` finds (never downloads one),
 * then links them with EST's flags into the module `est-build.json` names. The memory maximum is
 * est.json's `limits.memoryPagesMax`, so the two never disagree.
 *
 * Before compiling it writes `build/est_plugin.h` from est.json: the identity CLAP's descriptor
 * needs, so est.json is the only file that names it (`est new` renames it there):
 * `EST_PLUGIN_ID`, `_NAME`, `_VENDOR`, `_VERSION`, `_DESCRIPTION`, `_URL`, `_FEATURES` (string
 * literals, comma-separated), `EST_PLUGIN_IS_INSTRUMENT` (0 or 1), `EST_MEMORY_PAGES_MAX`.
 *
 * `est-build.json`:
 *   { "sources": ["src/plugin.cpp"],     C (.c) or C++ (.cpp, .cc, .cxx) files, from the folder
 *     "include": ["src"],                 more include folders (the SDK's `clap/` and `est/` come first)
 *     "defines": { "MY_FLAG": "1" },      -D for every source
 *     "std": "c++17",                     the C++ standard (C sources are c11)
 *     "simd": false,                      true: fixed-width SIMD (-msimd128; relaxed SIMD is refused)
 *     "flags": [], "linkFlags": [],       anything else, appended (the validator still decides); never a
 *                                         flag that runs or loads a program, names the output or
 *                                         reaches outside the folder (`flagRefusal`)
 *     "module": "build/module.wasm",      where the module lands (inside the folder)
 *     "golden": "test/golden.json" }      the golden render's spec (`est test`)
 *
 * The output is reproducible: paths are mapped out (`-ffile-prefix-map`), the module stripped, and
 * clang never runs a `wasm-opt` it finds on PATH (`clangEnv`).
 * `--print` prints the commands instead of running them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEGEN, CXX_ONLY, INSTALL_HELP, LINK_CODEGEN, clangEnv, findWasmClang, linkFlags } from './toolchain.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The SDK's headers: CLAP 1.2.2 (`clap/`) and the freestanding runtime (`est/runtime.hpp`). */
export const SDK_INCLUDE = join(HERE, 'include');
const FREESTANDING = join(HERE, 'freestanding');
const CXX = new Set(['.cpp', '.cc', '.cxx', '.c++']);

/** A C string literal for `s` (UTF-8 bytes; quotes, backslashes and controls escaped). @param {unknown} s */
export function cString(s) {
  const t = typeof s === 'string' ? s : '';
  let out = '"';
  for (const b of Buffer.from(t, 'utf8')) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x3f) out += '\\?'; // never a trigraph
    else if (b < 0x20 || b === 0x7f || b >= 0x80) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out}"`;
}

/** `build/est_plugin.h`'s text for a manifest. @param {Record<string, any>} m */
export function pluginHeader(m) {
  const features = Array.isArray(m.features) ? m.features.filter(f => typeof f === 'string') : [];
  const pages = Number(m.limits?.memoryPagesMax) || 16;
  return [
    '/* Written by est (sdk/cpp/build.mjs) from est.json before every build: do not edit, edit est.json. */',
    '#pragma once',
    `#define EST_PLUGIN_ID ${cString(m.id)}`,
    `#define EST_PLUGIN_NAME ${cString(m.name)}`,
    `#define EST_PLUGIN_VENDOR ${cString(m.vendor)}`,
    `#define EST_PLUGIN_VERSION ${cString(m.version)}`,
    `#define EST_PLUGIN_DESCRIPTION ${cString(m.description)}`,
    `#define EST_PLUGIN_URL ${cString(m.homepage ?? m.url ?? '')}`,
    `#define EST_PLUGIN_FEATURES ${features.map(cString).join(', ')}${features.length ? ',' : ''}`,
    `#define EST_PLUGIN_IS_INSTRUMENT ${m.kind === 'instrument' ? 1 : 0}`,
    `#define EST_MEMORY_PAGES_MAX ${pages}`,
    '',
  ].join('\n');
}

/**
 * Flags `est-build.json` may not pass to clang: each would run a program or load code the folder
 * names (a linker, a plugin, a response file), name the output, or reach outside the folder.
 * Building a folder still runs its own C and C++ through clang, as `cargo build` runs a crate's
 * build script: build only folders you trust (porting-cpp.md).
 */
const REFUSED_FLAG = /^(-fplugin|-fpass-plugin|-Xclang|-Xlinker|-B|-fuse-ld|--ld-path|-load|-mllvm|-ccc|--driver-mode|-o|--output|-specs|--sysroot|-isysroot|@)/;
const OUTSIDE_PATH = /(^|[=,]|^-[A-Za-z]|^-(isystem|iquote|idirafter|include|imacros|iprefix|iwithprefix|iwithprefixbefore|isysroot))(\/|\\|[A-Za-z]:[\\/]|~)|(^|[^.])\.\.([/\\]|$)/;

/** Why a flag is refused, or null. @param {string} f */
export function flagRefusal(f) {
  if (REFUSED_FLAG.test(f)) return `${f}: est-build.json may not pass this flag (it would run or load a program, name the output, or change the toolchain)`;
  if (OUTSIDE_PATH.test(f)) return `${f}: est-build.json's flags may not name an absolute path or one outside the folder`;
  return null;
}

/** The folder's build settings; throws on what it refuses. @param {string} dir */
export function readBuildConfig(dir) {
  const file = join(dir, 'est-build.json');
  /** @type {Record<string, any>} */
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const list = (/** @type {unknown} */ v, /** @type {string[]} */ dflt) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : dflt);
  const flags = list(c.flags, []), link = list(c.linkFlags, []);
  for (const f of [...flags, ...link]) { const why = flagRefusal(f); if (why) throw new Error(why); }
  for (const k of Object.keys(c.defines && typeof c.defines === 'object' ? c.defines : {})) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`est-build.json: the define "${k}" is not a C identifier`);
  const module = typeof c.module === 'string' ? c.module : 'build/module.wasm';
  const at = resolve(dir, module), rel = relative(resolve(dir), at);
  if (isAbsolute(module) || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`est-build.json: "module" (${module}) must be a path inside the folder`);
  return {
    sources: list(c.sources, ['src/plugin.cpp']),
    include: list(c.include, []),
    defines: c.defines && typeof c.defines === 'object' ? /** @type {Record<string, unknown>} */ (c.defines) : {},
    std: typeof c.std === 'string' ? c.std : 'c++17',
    simd: c.simd === true,
    flags,
    linkFlags: link,
    module,
    golden: typeof c.golden === 'string' ? c.golden : 'test/golden.json',
  };
}

/** The compile and link commands for a folder (the clang is passed in). @param {string} dir @param {string} clang */
export function buildPlan(dir, clang) {
  const d = resolve(dir);
  const cfg = readBuildConfig(d);
  const m = JSON.parse(readFileSync(join(d, 'est.json'), 'utf8'));
  const out = join(d, 'build');
  const abs = (/** @type {string} */ p) => (isAbsolute(p) ? p : join(d, p));
  // The freestanding <cstdint> and <cstddef> come last (`-idirafter`), so a real C++ library wins.
  const includes = [...[SDK_INCLUDE, out, ...cfg.include.map(abs)].flatMap(p => ['-I', p]), '-idirafter', FREESTANDING];
  const defines = Object.entries(cfg.defines).map(([k, v]) => `-D${k}=${String(v)}`);
  const common = [...CODEGEN, ...(cfg.simd ? ['-msimd128'] : []), `-ffile-prefix-map=${d}=.`, `-ffile-prefix-map=${HERE}=/est-sdk`, ...includes, ...defines, ...cfg.flags];
  const objects = [];
  const compile = [];
  cfg.sources.forEach((s, i) => {
    const src = abs(s);
    const cxx = CXX.has(extname(src).toLowerCase());
    const obj = join(out, 'obj', `${i}-${relative(d, src).replace(/[^A-Za-z0-9._-]+/g, '_')}.o`);
    objects.push(obj);
    compile.push([clang, '-c', '-x', cxx ? 'c++' : 'c', cxx ? `-std=${cfg.std}` : '-std=c11', ...(cxx ? CXX_ONLY : []), ...common, '-o', obj, src]);
  });
  const wasm = abs(cfg.module);
  const link = [clang, ...LINK_CODEGEN, ...linkFlags(Number(m.limits?.memoryPagesMax) || 16), ...cfg.linkFlags, '-o', wasm, ...objects];
  return { dir: d, out, wasm, header: join(out, 'est_plugin.h'), headerText: pluginHeader(m), compile, link };
}

/** Build a folder; throws with what to do. @param {string} dir @param {{ print?: boolean, log?: (t: string) => void }} [opts] */
export function buildCpp(dir, opts = {}) {
  const log = opts.log ?? (t => process.stderr.write(`${t}\n`));
  const tc = findWasmClang();
  if (!tc.clang) {
    const tried = tc.tried.length ? `\nTried:\n  ${tc.tried.join('\n  ')}` : '';
    throw new Error(`no C/C++ toolchain for wasm32: install ${INSTALL_HELP}${tried}`);
  }
  const plan = buildPlan(dir, tc.clang);
  if (opts.print) {
    for (const c of [...plan.compile, plan.link]) log(c.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    return plan;
  }
  log(`est: C/C++ with ${tc.version} (${tc.from})`);
  mkdirSync(join(plan.out, 'obj'), { recursive: true });
  mkdirSync(dirname(plan.wasm), { recursive: true });
  if (!existsSync(plan.header) || readFileSync(plan.header, 'utf8') !== plan.headerText) writeFileSync(plan.header, plan.headerText);
  for (const cmd of [...plan.compile, plan.link]) {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: plan.dir, stdio: ['ignore', 2, 2], env: clangEnv(tc.clang) });
    if (r.error) throw new Error(`${cmd[0]}: ${r.error.message}`);
    if (r.status !== 0) {
      const what = cmd === plan.link ? 'the link failed (an "undefined symbol" is a function EST does not give a module: see porting-cpp.md, "What breaks")' : `compiling ${relative(plan.dir, cmd[cmd.length - 1])} failed`;
      throw new Error(what);
    }
  }
  return plan;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--')) ?? '.';
  try {
    const plan = buildCpp(dir, { print: args.includes('--print') });
    if (!args.includes('--print')) process.stderr.write(`est: wrote ${relative(process.cwd(), plan.wasm) || plan.wasm}\n`);
  } catch (err) {
    process.stderr.write(`est: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
