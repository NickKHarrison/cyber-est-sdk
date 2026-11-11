/**
 * @cyber-est/tools: a plugin project's layout (the contract with 4-B's templates, docs/est/
 * EST_Phase4_Work_Order.md §6): `est.json`, the source, `ui/` if any, and a build that writes a
 * known `.wasm`:
 * - **Rust** (`Cargo.toml`): `cargo build --release` (the template's `.cargo/config.toml` sets
 *   `wasm32-unknown-unknown` and the link flags); the module is `[package.metadata.est] module`
 *   (or `wasm`) when given (under CARGO_TARGET_DIR when that is set and the path starts with
 *   `target/`), else `<target dir>/wasm32-unknown-unknown/release/<lib name>.wasm`;
 * - **AssemblyScript** (`asconfig.json`): `asc <entry> --config asconfig.json --target release`;
 *   the module is the `"est": { "wasm" }` block when given, else the release target's `outFile`;
 *   the entry is the `"est": { "entry" }`, else `assembly/index.ts`;
 * - **C or C++** (`est-build.json`, DEV-G 1.326): `node sdk/cpp/build.mjs <dir>` (clang to wasm32,
 *   sdk/docs/porting-cpp.md); the module is the file's `module` (default `build/module.wasm`);
 * - otherwise est.json's `module.path` in the folder (a prebuilt module).
 * Node only (reads the folder).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProjectKind = 'rust' | 'as' | 'cpp' | 'prebuilt';

export interface EstProject {
  dir: string;
  kind: ProjectKind;
  /** Where the build writes the module. */
  wasm: string;
  /** The build: a program and its arguments, run in `dir` (none for a prebuilt module). */
  build: { cmd: string; args: string[] } | null;
  /** The golden render's spec (`est test`): the build block's `golden`, else `test/golden.json`. */
  golden: string;
}

/** The few keys of a Cargo.toml this reads: `[section] key = "value"` lines (no inline tables). */
export function tomlValues(src: string): Map<string, string> {
  const out = new Map<string, string>();
  let section = '';
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { section = sec[1]!.trim(); continue; }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (kv) out.set(`${section}.${kv[1]}`, kv[2]!);
  }
  return out;
}

/** The repository's own `asc` (the `assemblyscript` dev dependency), or the project's, or null. */
export function findAsc(from: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const start of [resolve(from), here]) {
    let d = start;
    for (;;) {
      const p = join(d, 'node_modules', '.bin', process.platform === 'win32' ? 'asc.cmd' : 'asc');
      if (existsSync(p)) return p;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return null;
}

/** Where a template keeps its golden render's spec (4-B's layout). */
const GOLDEN = 'test/golden.json';

/** The SDK's C and C++ build (sdk/cpp/build.mjs), run with this Node. */
export const CPP_BUILD = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cpp', 'build.mjs');

const abs = (dir: string, p: string) => (isAbsolute(p) ? p : join(dir, p));

/** A plugin folder's project: what builds it and where its module lands. */
export function readProject(dir: string): EstProject {
  const d = resolve(dir);
  const cargo = join(d, 'Cargo.toml');
  if (existsSync(cargo)) {
    const t = tomlValues(readFileSync(cargo, 'utf8'));
    const given = t.get('package.metadata.est.wasm') ?? t.get('package.metadata.est.module');
    let wasm: string;
    // A module under `target/` follows CARGO_TARGET_DIR when it is set (cargo writes there instead).
    if (given) wasm = process.env.CARGO_TARGET_DIR && /^target[\\/]/.test(given) ? join(resolve(process.env.CARGO_TARGET_DIR), given.slice('target/'.length)) : abs(d, given);
    else {
      const lib = (t.get('lib.name') ?? t.get('package.name') ?? 'plugin').replace(/-/g, '_');
      const target = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(d, 'target');
      wasm = join(target, 'wasm32-unknown-unknown', 'release', `${lib}.wasm`);
    }
    return { dir: d, kind: 'rust', wasm, build: { cmd: 'cargo', args: ['build', '--release', '--target', 'wasm32-unknown-unknown'] }, golden: abs(d, t.get('package.metadata.est.golden') ?? GOLDEN) };
  }
  const asconfig = join(d, 'asconfig.json');
  if (existsSync(asconfig)) {
    const c = JSON.parse(readFileSync(asconfig, 'utf8')) as { est?: { wasm?: string; module?: string; entry?: string; golden?: string }; entries?: string[]; targets?: { release?: { outFile?: string } } };
    const wasm = abs(d, c.est?.wasm ?? c.est?.module ?? c.targets?.release?.outFile ?? 'build/module.wasm');
    const entry = c.est?.entry ?? c.entries?.[0] ?? 'assembly/index.ts';
    const asc = findAsc(d);
    return { dir: d, kind: 'as', wasm, build: { cmd: asc ?? 'asc', args: [entry, '--config', 'asconfig.json', '--target', 'release', '--outFile', wasm] }, golden: abs(d, c.est?.golden ?? GOLDEN) };
  }
  const cppConfig = join(d, 'est-build.json');
  if (existsSync(cppConfig)) {
    const c = JSON.parse(readFileSync(cppConfig, 'utf8')) as { module?: unknown; golden?: unknown };
    const wasm = abs(d, typeof c.module === 'string' ? c.module : 'build/module.wasm');
    return { dir: d, kind: 'cpp', wasm, build: { cmd: process.execPath, args: [CPP_BUILD, d] }, golden: abs(d, typeof c.golden === 'string' ? c.golden : GOLDEN) };
  }
  let modulePath = 'module.wasm';
  try {
    const m = JSON.parse(readFileSync(join(d, 'est.json'), 'utf8')) as { module?: { path?: unknown } };
    if (typeof m.module?.path === 'string') modulePath = m.module.path;
  } catch { /* est.json is checked when packing */ }
  return { dir: d, kind: 'prebuilt', wasm: join(d, modulePath), build: null, golden: join(d, GOLDEN) };
}
