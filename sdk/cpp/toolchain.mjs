/**
 * The C and C++ toolchain for EST modules (EST-DEV-3, DEV-G; sdk/docs/porting-cpp.md): a clang that
 * targets `wasm32` and the `wasm-ld` beside it. Never installs or downloads anything.
 *
 * Where it looks, in order (the first that compiles and links a probe wins):
 * 1. `EST_CLANG`: a clang++ you name;
 * 2. Emscripten's own clang: `$EMSDK/upstream/bin/clang++`, or the one beside `emcc` on PATH
 *    (emsdk's `upstream/emscripten/emcc` → `upstream/bin/clang++`). `est` calls that clang
 *    directly, never the `emcc` driver: `emcc` adds its JavaScript runtime and imports EST refuses;
 * 3. wasi-sdk's: `$WASI_SDK_PATH/bin/clang++`, `/opt/wasi-sdk/bin/clang++` (with `-nostdlib`: its
 *    libc is not linked unless you add it);
 * 4. `clang++` on PATH, then Homebrew's LLVM (`/opt/homebrew/opt/llvm/bin`, `/usr/local/opt/llvm/bin`;
 *    Apple's own clang has no `wasm-ld`, so it fails the probe and is passed over).
 *
 * The probe compiles a two-line C++ file to wasm32 and links it with EST's flags, so a clang
 * without the WebAssembly backend or without `wasm-ld` is reported, with what was tried.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

const EXE = process.platform === 'win32' ? '.exe' : '';

/** @param {string} cmd */
function onPath(cmd) {
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const d of (process.env.PATH ?? '').split(sep)) {
    // Only absolute folders: a relative entry ("." among them) would make the folder being built
    // choose the compiler.
    if (!d || !isAbsolute(d)) continue;
    const p = join(d, cmd + EXE);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Never a `wasm-opt`. Clang's wasm32 driver runs a `wasm-opt` it finds (beside itself, as in emsdk,
 * or on PATH, where npm puts binaryen's) after a link given an `-O` level, so the module's bytes
 * would depend on which binaryen happened to be there. The cure is `LINK_CODEGEN`: the link step
 * gets no `-O` (the objects are already optimised; there is no LTO), so the driver never runs it
 * (clang 20's `--no-wasm-opt` says the same; clang 16–19 have no such flag). As a second line,
 * clang also runs with PATH's folders holding a `wasm-opt` removed (its own folder kept, for
 * `wasm-ld`), and with no relative PATH entry.
 * @param {string} clang
 */
export function clangEnv(clang) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const own = dirname(clang);
  const path = (process.env.PATH ?? '').split(sep).filter(d => d && isAbsolute(d) && (d === own || !existsSync(join(d, `wasm-opt${EXE}`)))).join(sep);
  return { ...process.env, PATH: path };
}

/** Every clang++ worth probing, in order, with where it came from. @returns {{ path: string, from: string }[]} */
export function candidates() {
  /** @type {{ path: string, from: string }[]} */
  const out = [];
  const add = (/** @type {string | null | undefined} */ p, /** @type {string} */ from) => { if (p && !out.some(c => c.path === p)) out.push({ path: p, from }); };
  if (process.env.EST_CLANG) add(process.env.EST_CLANG, 'EST_CLANG');
  if (process.env.EMSDK) add(join(process.env.EMSDK, 'upstream', 'bin', `clang++${EXE}`), 'Emscripten ($EMSDK)');
  const emcc = onPath('emcc');
  if (emcc) {
    let real = emcc;
    try { real = realpathSync(emcc); } catch { /* keep the PATH entry */ }
    add(join(dirname(real), '..', 'bin', `clang++${EXE}`), 'Emscripten (beside emcc)');
    add(join(dirname(real), 'llvm', 'bin', `clang++${EXE}`), 'Emscripten (beside emcc)');
  }
  if (process.env.WASI_SDK_PATH) add(join(process.env.WASI_SDK_PATH, 'bin', `clang++${EXE}`), 'wasi-sdk ($WASI_SDK_PATH)');
  add('/opt/wasi-sdk/bin/clang++', 'wasi-sdk (/opt/wasi-sdk)');
  add(onPath('clang++'), 'clang++ on PATH');
  add('/opt/homebrew/opt/llvm/bin/clang++', 'Homebrew LLVM');
  add('/usr/local/opt/llvm/bin/clang++', 'Homebrew LLVM');
  return out.filter(c => c.from === 'EST_CLANG' || existsSync(c.path));
}

/** The link flags every EST module needs (spec §3.1; the same as the Rust templates' `.cargo/config.toml`). @param {number} maxPages */
export function linkFlags(maxPages) {
  const max = Math.max(1, Math.min(2048, Math.floor(maxPages)));
  return [
    // Exports are named, never `--export-dynamic` (it would export C++'s `new` and `delete` too):
    // `clap_entry` here, `malloc`, `free` and `_initialize` by `export_name` in est/runtime.hpp.
    '-Wl,--no-entry', '-Wl,--export-if-defined=clap_entry', '-Wl,--export-table', '-Wl,--growable-table',
    '-Wl,-z,stack-size=65536', `-Wl,--initial-memory=${Math.min(max, 4) * 65536}`, `-Wl,--max-memory=${max * 65536}`,
    '-Wl,--strip-all',
  ];
}

/**
 * The code-generation flags: wasm32, no libc, a pinned feature set (MVP plus what every engine and
 * the meter accept; the same bytes from any clang 16 or newer), no exceptions or RTTI (EST refuses
 * the exceptions proposal), no FMA contraction (so a desktop build of the same DSP matches).
 */
export const CODEGEN = [
  '--target=wasm32', '-O2', '-mcpu=mvp', '-mmutable-globals', '-msign-ext', '-mnontrapping-fptoint',
  '-nostdlib', '-ffreestanding', '-fvisibility=hidden', '-ffp-contract=off', '-fno-math-errno',
];
export const CXX_ONLY = ['-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics'];
/** The link's flags: CODEGEN without its `-O` level, so clang never runs `wasm-opt` (`clangEnv`). */
export const LINK_CODEGEN = CODEGEN.filter(f => !/^-O/.test(f));

/** @type {Map<string, { ok: boolean, version: string | null, problem: string | null }>} */
const probed = new Map();

/** Does this clang++ compile and link wasm32 with EST's flags? @param {string} clang */
export function probe(clang) {
  const hit = probed.get(clang);
  if (hit) return hit;
  const v = spawnSync(clang, ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) {
    const r = { ok: false, version: null, problem: v.error ? `${clang}: ${v.error.message}` : `${clang} --version failed` };
    probed.set(clang, r);
    return r;
  }
  const version = (v.stdout.split('\n')[0] ?? '').trim();
  const dir = mkdtempSync(join(tmpdir(), 'est-clang-'));
  try {
    const src = join(dir, 'probe.cpp');
    writeFileSync(src, 'extern "C" __attribute__((export_name("probe"))) int probe(int x) { return x * 2; }\n');
    const r = spawnSync(clang, [...LINK_CODEGEN, ...CXX_ONLY, '-std=c++17', ...linkFlags(4), '-o', join(dir, 'probe.wasm'), src], { encoding: 'utf8', env: clangEnv(clang) });
    const ok = !r.error && r.status === 0 && existsSync(join(dir, 'probe.wasm'));
    const said = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').slice(0, 3).join(' ');
    const problem = ok ? null : /wasm-ld/.test(said) ? `${version}: no wasm-ld beside it (${said})` : /unknown target|No available targets|wasm32/.test(said) ? `${version}: no WebAssembly target (${said})` : `${version}: the probe did not build (${said || r.error?.message || r.status})`;
    const out = { ok, version, problem };
    probed.set(clang, out);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The toolchain to build with: the first candidate that passes the probe, else null with what was
 * tried. Also says whether `emcc` is installed (for `est doctor`).
 */
export function findWasmClang() {
  const tried = [];
  for (const c of candidates()) {
    const p = probe(c.path);
    if (p.ok) return { clang: c.path, from: c.from, version: p.version, tried, emcc: onPath('emcc') };
    tried.push(`${c.from}: ${p.problem}`);
  }
  return { clang: null, from: null, version: null, tried, emcc: onPath('emcc') };
}

/** What to run when there is none (the same words in `est doctor` and a failed build). */
export const INSTALL_HELP = [
  'a clang with the WebAssembly target and wasm-ld (LLVM 16 or newer). Any one of:',
  '  Ubuntu/Debian: sudo apt install clang lld',
  '  macOS: brew install llvm   (Apple\'s clang has no wasm-ld)',
  '  Windows: winget install LLVM.LLVM',
  '  Emscripten (emsdk) or wasi-sdk, already installed: est uses the clang inside it',
  '  or name one: EST_CLANG=/path/to/clang++',
].join('\n');
