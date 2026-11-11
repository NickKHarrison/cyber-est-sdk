/**
 * `est`: building and packing a plugin folder (shared by `pack`, `validate`, `test`). The build is
 * the template's own (`readProject`: cargo or asc); its output goes to standard error, so `--json`
 * keeps standard output for the report.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pack, readProject, type EstProject } from '../../tools/src/index';
import type { CommandContext } from './command';

/** A path as the user would type it from `cwd`: relative when inside it, else absolute. */
export function shown(cwd: string, p: string): string {
  const r = relative(cwd, p);
  return !r ? '.' : r.startsWith('..') || isAbsolute(r) ? p : r;
}

export function isBundleFile(p: string): boolean {
  return p.endsWith('.est') && existsSync(p) && statSync(p).isFile();
}

/** Run the project's build; throws with what to do when the tool is missing or the build fails. */
export function build(project: EstProject, ctx: CommandContext): void {
  if (!project.build) return;
  const { cmd, args } = project.build;
  ctx.err(`est: building (${[cmd.split(/[\\/]/).pop(), ...args].join(' ')})`);
  const r = spawnSync(cmd, args, { cwd: project.dir, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error(`${cmd} is not installed (run \`est doctor\` for the command that installs it)`);
  }
  if (r.status !== 0) throw new Error(`the build failed (${cmd} exited with ${r.status ?? r.signal})`);
  if (!existsSync(project.wasm)) throw new Error(`the build did not write ${project.wasm}`);
}

export interface Packed { file: string; hash: string; bytes: Uint8Array; id: string; version: string }

/** Build (unless `noBuild`) and pack `dir` to `dir/dist/<id>-<version>.est`. */
export function buildAndPack(dir: string, ctx: CommandContext, opts: { noBuild?: boolean } = {}): Packed {
  const d = resolve(ctx.cwd, dir);
  if (!existsSync(join(d, 'est.json'))) throw new Error(`no est.json in ${d} (a plugin folder; \`est new\` makes one)`);
  const project = readProject(d);
  if (!opts.noBuild) build(project, ctx);
  const p = pack(d, { module: project.wasm });
  const id = String(p.manifest.id ?? 'plugin');
  const version = String(p.manifest.version ?? '0.0.0');
  const out = join(d, 'dist');
  mkdirSync(out, { recursive: true });
  const safe = `${id}-${version}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = join(out, `${safe}.est`);
  writeFileSync(file, p.bytes);
  return { file, hash: p.hash, bytes: p.bytes, id, version };
}

/**
 * 1.400 (P3, `est profile --debug`): the project's build once more with the function names kept
 * (AssemblyScript `--debug`; Rust `strip = false` through Cargo's environment, in a target folder
 * of its own), its module written outside the build's usual place, so `dist/` and the module
 * `est pack` packs are never touched. Null for a kind it cannot do (C and C++ keep names with
 * `-g` in est-build.json's flags; a prebuilt module has what it has).
 */
export function namesBuildOf(project: EstProject, out: string): { cmd: string; args: string[]; env: Record<string, string>; wasm: string } | null {
  if (!project.build) return null;
  if (project.kind === 'as') {
    const args = [...project.build.args];
    const at = args.indexOf('--outFile');
    const wasm = join(out, 'module.wasm');
    if (at >= 0) args.splice(at, 2);
    return { cmd: project.build.cmd, args: [...args, '--debug', '--outFile', wasm], env: {}, wasm };
  }
  if (project.kind === 'rust') {
    const target = join(project.dir, 'target', 'est-profile');
    // The module's place under the usual target folder, moved under this one.
    const rel = relative(process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(project.dir, 'target'), project.wasm);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    const wasm = join(target, rel);
    return { cmd: project.build.cmd, args: project.build.args, env: { CARGO_TARGET_DIR: target, CARGO_PROFILE_RELEASE_STRIP: 'false', CARGO_PROFILE_RELEASE_DEBUG: 'false' }, wasm };
  }
  return null;
}

/**
 * Build `dir` with names (`namesBuildOf`) and pack it in memory: the bytes `est profile --debug`
 * profiles, never written to `dist/` and never to install (the names change the bundle's hash, not
 * its fuel: a name section holds no code).
 */
export function buildWithNames(dir: string, ctx: CommandContext): Uint8Array {
  const d = resolve(ctx.cwd, dir);
  const project = readProject(d);
  const out = mkdtempSync(join(tmpdir(), 'est-profile-'));
  try {
    const plan = namesBuildOf(project, out);
    if (!plan) throw new Error(`--debug builds AssemblyScript folders and Rust folders whose module is under target/; for C or C++ add -g to est-build.json's flags and run est profile without --debug`);
    ctx.err(`est: building with names for the profile (${[plan.cmd.split(/[\\/]/).pop(), ...plan.args].join(' ')})`);
    const r = spawnSync(plan.cmd, plan.args, { cwd: project.dir, stdio: ['ignore', 2, 2], shell: process.platform === 'win32', env: { ...process.env, ...plan.env } });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${plan.cmd} is not installed (run \`est doctor\` for the command that installs it)`);
    if (r.status !== 0) throw new Error(`the build with names failed (${plan.cmd} exited with ${r.status ?? r.signal})`);
    if (!existsSync(plan.wasm)) throw new Error(`the build with names did not write ${plan.wasm}`);
    return pack(d, { module: plan.wasm }).bytes;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
