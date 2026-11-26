/**
 * `est`: building and packing a plugin folder (shared by `pack`, `validate`, `test`). The build is
 * the template's own (`readProject`: cargo or asc); its output goes to standard error, so `--json`
 * keeps standard output for the report.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { nextLine, pack, readProject, type EstProject } from '../../tools/src/index';
import type { CommandContext } from './command';
import { isSourceEst } from '../../../../src/audio/est/install/bundle';
import { SOURCE_EST_WORDS } from '../../../../shared/estSourceEst.mjs';

/** A path as the user would type it from `cwd`: relative when inside it, else absolute. */
export function shown(cwd: string, p: string): string {
  const r = relative(cwd, p);
  return !r ? '.' : r.startsWith('..') || isAbsolute(r) ? p : r;
}

export function isBundleFile(p: string): boolean {
  return p.endsWith('.est') && existsSync(p) && statSync(p).isFile();
}

/** A failed build: what it printed (the compiler's output), kept so the caller can name the first error (`nextLine`). */
export class BuildError extends Error {
  /** The build's output, both streams, as it was printed. */
  readonly log: string;
  /** The tool that did not start, when that is why (it is not installed). */
  readonly missing: string | null;
  constructor(message: string, log: string, missing: string | null = null) {
    super(message);
    this.log = log;
    this.missing = missing;
  }
}

/**
 * 1.803: the build's output is shown as it comes (a first Rust build takes a while) **and** kept,
 * so a failure can end with the first compiler error in one line. A synchronous spawn cannot do
 * both, so the build runs under this small Node child: it starts the tool, copies both streams to
 * its own standard error (the person's terminal) and to the file named first, and exits with the
 * tool's code (127 when the tool did not start).
 */
const TEE = [
  "const { spawn } = require('node:child_process'); const fs = require('node:fs');",
  'const [log, cmd, ...args] = process.argv.slice(1); const out = fs.openSync(log, \'w\');',
  "const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });",
  'for (const s of [c.stdout, c.stderr]) s.on(\'data\', d => { process.stderr.write(d); fs.writeSync(out, d); });',
  "c.on('error', e => { fs.writeSync(out, String(e.message)); process.exit(e.code === 'ENOENT' ? 127 : 1); });",
  "c.on('close', code => process.exit(code === null ? 1 : code));",
].join('\n');

/** Run a build tool in `cwd`, its output shown and kept. */
export function runShown(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): { status: number | null; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'est-build-'));
  const logFile = join(dir, 'log.txt');
  try {
    const r = spawnSync(process.execPath, ['-e', TEE, logFile, cmd, ...args], { cwd, stdio: ['ignore', 2, 2], env: env ?? process.env });
    let log = '';
    try { log = readFileSync(logFile, 'utf8'); } catch { /* nothing was written */ }
    return { status: r.error ? 1 : r.status, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run the project's build; throws a `BuildError` with what to do when the tool is missing or the build fails. */
export function build(project: EstProject, ctx: CommandContext): void {
  if (!project.build) return;
  const { cmd, args } = project.build;
  ctx.err(`est: building (${[cmd.split(/[\\/]/).pop(), ...args].join(' ')})`);
  const r = runShown(cmd, args, project.dir);
  if (r.status === 127) throw new BuildError(`${cmd} is not installed (run \`est doctor\` for the command that installs it)`, r.log, cmd.split(/[\\/]/).pop() ?? cmd);
  if (r.status !== 0) throw new BuildError(`the build failed (${cmd.split(/[\\/]/).pop()} exited with ${r.status})`, r.log);
  if (!existsSync(project.wasm)) throw new BuildError(`the build did not write ${project.wasm}`, r.log);
}

export interface Packed { file: string; hash: string; bytes: Uint8Array; id: string; version: string }

/** Build (unless `noBuild`) and pack `dir` to `dir/dist/<id>-<version>.est`. */
export function buildAndPack(dir: string, ctx: CommandContext, opts: { noBuild?: boolean } = {}): Packed {
  const d = resolve(ctx.cwd, dir);
  // 1.909: a plugin's source packed as a .est (shared/estSourceEst.mjs) is not a folder: said in words.
  if (/\.est$/i.test(d) && existsSync(d) && statSync(d).isFile()) {
    if (isSourceEst(new Uint8Array(readFileSync(d)))) throw new Error(`${SOURCE_EST_WORDS} With the kit, unzip ${shown(ctx.cwd, d)} into a folder and run \`est pack\` in that folder.`);
    throw new Error(`${shown(ctx.cwd, d)} is already a built plugin (.est): \`est pack\` packs a plugin folder. Check it with \`est validate ${shown(ctx.cwd, d)}\`.`);
  }
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
 * profiles (and, 1.669, `est replay --debug` replays), never written to `dist/` and never to install (the names change the bundle's hash, not
 * its fuel: a name section holds no code).
 */
export function buildWithNames(dir: string, ctx: CommandContext, purpose: 'profile' | 'replay' = 'profile'): Uint8Array {
  const d = resolve(ctx.cwd, dir);
  const project = readProject(d);
  const out = mkdtempSync(join(tmpdir(), 'est-profile-'));
  try {
    const plan = namesBuildOf(project, out);
    if (!plan) throw new Error(`--debug builds AssemblyScript folders and Rust folders whose module is under target/; for C or C++ add -g to est-build.json's flags and run est ${purpose} without --debug`);
    ctx.err(`est: building with names for the ${purpose} (${[plan.cmd.split(/[\\/]/).pop(), ...plan.args].join(' ')})`);
    const r = spawnSync(plan.cmd, plan.args, { cwd: project.dir, stdio: ['ignore', 2, 2], shell: process.platform === 'win32', env: { ...process.env, ...plan.env } });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${plan.cmd} is not installed (run \`est doctor\` for the command that installs it)`);
    if (r.status !== 0) throw new Error(`the build with names failed (${plan.cmd} exited with ${r.status ?? r.signal})`);
    if (!existsSync(plan.wasm)) throw new Error(`the build with names did not write ${plan.wasm}`);
    return pack(d, { module: plan.wasm }).bytes;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * 1.803: build and pack for a command that ends with a `Next:` line. A failed build prints its
 * reason and the line (the first compiler error with its file and line) and gives null; the command
 * then exits 1. `quiet`: `--json`, where standard output is the report's alone, so both go to
 * standard error.
 */
export function buildOrNext(dir: string, ctx: CommandContext, opts: { noBuild?: boolean; quiet?: boolean; name: string }): Packed | null {
  try {
    return buildAndPack(dir, ctx, opts);
  } catch (err) {
    if (!(err instanceof BuildError)) throw err;
    ctx.err(`est ${opts.name}: ${err.message}`);
    const line = nextLine(err.missing ? { kind: 'tool', tool: err.missing } : { kind: 'build', log: err.log, message: err.message });
    (opts.quiet ? ctx.err : ctx.out)(line);
    return null;
  }
}
