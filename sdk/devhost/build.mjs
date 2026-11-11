/**
 * The dev host's build step: a plugin's folder → a canonical `.est` bundle.
 *
 * With `@cyber-est/tools` (4-A's, `sdk/packages/tools`), the build is its project's (`readProject`: the
 * template's cargo or asc build and module path, as `est pack` runs it) and the packing its `pack`
 * (and `validate` checks). Without it (it failed to load) this does what `scripts/est-plugins.sh`
 * does for one plugin: the module from
 * the template's own build (`cargo build --release` for a `Cargo.toml`, `asc … --target release`
 * for an `asconfig.json`), then `scripts/est-pack.mjs`'s `packBundle` over `est.json`, `ui/`,
 * `presets/` and `LICENSE`, with `@cyber-est/ui`'s `est-ui.js` copied in when the UI names it.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { packBundle } from '../../scripts/est-pack.mjs';
import { withEstUi } from '../packages/ui/copyRule.mjs';
import { REPO } from './paths.mjs';

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => reject(Object.assign(new Error(`${cmd} could not start (${err.message}); run \`est doctor\``), { log: out })));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(Object.assign(new Error(`${cmd} ${args.join(' ')} failed (exit ${code})`), { log: out }))));
  });
}

/** Every file under `dir`, as `/`-separated paths relative to `base`. @param {string} dir @param {string} base @returns {string[]} */
function walk(dir, base) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** The crate's library name (`[package] name`, `-` as `_`), from its Cargo.toml. @param {string} toml */
export function crateName(toml) {
  const pkg = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(toml)?.[1] ?? '';
  const lib = /\[lib\]([\s\S]*?)(?:\n\[|$)/.exec(toml)?.[1] ?? '';
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(lib)?.[1] ?? /^\s*name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  if (!name) throw new Error('Cargo.toml has no [package] name');
  return name.replace(/-/g, '_');
}

/**
 * The `asc` that builds an AssemblyScript folder: the folder's own `node_modules/.bin` or one above
 * it, else the one beside the dev host (the clone's, or a published @cyber-est/cli's dependency),
 * as @cyber-est/tools' `findAsc` looks. @param {string} dir @returns {string}
 */
export function ascFor(dir) {
  const bin = process.platform === 'win32' ? 'asc.cmd' : 'asc';
  for (const start of [dir, REPO]) {
    for (let d = start; ; d = dirname(d)) {
      const p = join(d, 'node_modules', '.bin', bin);
      if (existsSync(p)) return p;
      if (dirname(d) === d) break;
    }
  }
  return bin;
}

/** What a folder builds with: 'cargo', 'asc', or null (a folder that has its module already). @param {string} dir */
export function buildKind(dir) {
  if (existsSync(join(dir, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(dir, 'asconfig.json'))) return 'asc';
  return null;
}

/**
 * Build a plugin folder's module. Returns the module's bytes and the build's output.
 * @param {string} dir
 * @returns {Promise<{ module: Uint8Array, log: string, tool: string }>}
 */
export async function buildModule(dir) {
  const kind = buildKind(dir);
  if (kind === 'cargo') {
    const target = process.env.CARGO_TARGET_DIR || join(dir, 'target');
    const log = await run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], dir);
    const file = join(target, 'wasm32-unknown-unknown', 'release', `${crateName(readFileSync(join(dir, 'Cargo.toml'), 'utf8'))}.wasm`);
    if (!existsSync(file)) throw Object.assign(new Error(`cargo built no ${relative(dir, file)}`), { log });
    return { module: new Uint8Array(readFileSync(file)), log, tool: 'cargo' };
  }
  if (kind === 'asc') {
    const asc = ascFor(dir);
    const cfg = JSON.parse(readFileSync(join(dir, 'asconfig.json'), 'utf8'));
    const outFile = cfg?.targets?.release?.outFile ?? 'build/module.wasm';
    const log = await run(asc, ['assembly/index.ts', '--config', 'asconfig.json', '--target', 'release', '--outFile', outFile], dir);
    return { module: new Uint8Array(readFileSync(join(dir, outFile))), log, tool: 'asc' };
  }
  const prebuilt = ['module.wasm', 'build/module.wasm'].map((f) => join(dir, f)).find((f) => existsSync(f));
  if (prebuilt) return { module: new Uint8Array(readFileSync(prebuilt)), log: '', tool: 'none' };
  throw new Error('no Cargo.toml, asconfig.json or module.wasm: nothing to build');
}

/**
 * The bundle's files from a folder and its built module (`scripts/est-pack.mjs`'s rules), with
 * `@cyber-est/ui` copied in when the UI names it.
 * @param {string} dir @param {Uint8Array} module
 */
export function bundleFiles(dir, module) {
  const manifest = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8'));
  delete manifest.$schema;
  /** @type {Record<string, Uint8Array>} */
  let files = { [manifest.module?.path ?? 'module.wasm']: module };
  for (const sub of [manifest.ui ? 'ui' : null, manifest.presets ? 'presets' : null]) {
    if (!sub || !existsSync(join(dir, sub))) continue;
    for (const f of walk(join(dir, sub), dir)) files[f] = new Uint8Array(readFileSync(join(dir, f)));
  }
  const license = [join(dir, 'LICENSE'), join(REPO, 'est-plugins', 'LICENSE')].find((f) => existsSync(f));
  if (license) files.LICENSE = new Uint8Array(readFileSync(license));
  const r = withEstUi(files);
  files = r.files;
  return { manifest, files, copiedEstUi: r.copied };
}

/**
 * Build and pack a folder. `tools`: 4-A's `@cyber-est/tools` when loaded (its `pack` is used instead).
 * @param {string} dir @param {any} [tools]
 * @returns {Promise<{ bytes: Uint8Array, hash: string, log: string, via: string }>}
 */
export async function packFolder(dir, tools) {
  if (tools && typeof tools.pack === 'function' && typeof tools.readProject === 'function') {
    // @cyber-est/tools' `pack` packs a built module; the build is the project's own, as `est pack` runs it.
    const project = tools.readProject(dir);
    const log = project.build ? await run(project.build.cmd, project.build.args, project.dir) : '';
    if (!existsSync(project.wasm)) throw Object.assign(new Error(`the build did not write ${relative(dir, project.wasm)}`), { log });
    const r = tools.pack(dir, { module: project.wasm });
    return { bytes: r.bytes, hash: r.hash, log, via: `@cyber-est/tools (${project.kind})` };
  }
  const built = await buildModule(dir);
  const { manifest, files } = bundleFiles(dir, built.module);
  const packed = packBundle(manifest, files);
  return { bytes: packed.bytes, hash: packed.hash, log: built.log, via: `devhost (${built.tool})` };
}
