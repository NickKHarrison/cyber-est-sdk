import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findAsc } from '../../../tools/src/index';
import type { EstCommand } from '../command';
import { CLI_VERSION, versionLine } from '../main';
import { INSTALL_HELP, findWasmClang } from '../../../../cpp/toolchain.mjs';

/**
 * What a probe is for: every template (`all`), the Rust ones, the AssemblyScript ones, the C and C++
 * kit (`cpp`, DEV-G 1.326: cpp-clap and the JUCE kit's est/), or `est dev
 * --json` (`dev`: optional, never counted in `ready`).
 */
interface Probe { name: string; ok: boolean; version: string | null; fix: string | null; for: 'all' | 'rust' | 'as' | 'cpp' | 'dev' }

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** Where a package resolves from: the plugin's folder first, then where `est` itself is installed. */
export function resolveFrom(cwd: string, name: string): string | null {
  for (const base of [join(cwd, 'package.json'), fileURLToPath(import.meta.url)]) {
    try { return createRequire(base).resolve(name); } catch { /* not there */ }
  }
  return null;
}

/** The CLI comes with these (`@cyber-est/cli`'s dependencies); in the clone `npm ci` installs them. */
const REINSTALL = `npm install --save-dev --save-exact @cyber-est/cli@${CLI_VERSION}   (it brings them; in Cyber's clone: npm ci)`;

/** What `est doctor` checks (exported for the tests). Never installs anything, never fetches anything. */
export function probes(cwd: string): Probe[] {
  const out: Probe[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ name: 'Node 20 or newer', ok: major >= 20, version: process.versions.node, fix: major >= 20 ? null : 'install Node 20 or newer from https://nodejs.org (or `nvm install 20`)', for: 'all' });
  // Binaryen meters every module in `est validate`, exactly as Cyber's install does.
  const binaryen = resolveFrom(cwd, 'binaryen');
  out.push({ name: 'binaryen (the meter)', ok: !!binaryen, version: binaryen ? 'found' : null, fix: binaryen ? null : REINSTALL, for: 'all' });
  const rustup = run('rustup', ['--version']);
  out.push({ name: 'rustup', ok: rustup.ok, version: rustup.ok ? rustup.out.split('\n')[0]! : null, fix: rustup.ok ? null : "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   (then open a new shell)", for: 'rust' });
  const targets = rustup.ok ? run('rustup', ['target', 'list', '--installed']) : { ok: false, out: '' };
  const hasTarget = targets.ok && targets.out.split(/\s+/).includes('wasm32-unknown-unknown');
  out.push({ name: 'the wasm32-unknown-unknown target', ok: hasTarget, version: hasTarget ? 'installed' : null, fix: hasTarget ? null : 'rustup target add wasm32-unknown-unknown', for: 'rust' });
  const cargo = run('cargo', ['--version']);
  out.push({ name: 'cargo', ok: cargo.ok, version: cargo.ok ? cargo.out : null, fix: cargo.ok ? null : 'rustup default stable   (cargo comes with Rust through rustup)', for: 'rust' });
  const asc = findAsc(cwd);
  const ascV = asc ? run(asc, ['--version']) : { ok: false, out: '' };
  out.push({ name: 'asc (AssemblyScript)', ok: !!asc && ascV.ok, version: ascV.ok ? ascV.out.replace(/^Version\s*/i, '') : null, fix: asc && ascV.ok ? null : REINSTALL, for: 'as' });
  // DEV-G (1.326): the C and C++ kit: a clang with wasm32 and wasm-ld.
  const cpp = findWasmClang();
  out.push({ name: 'clang for wasm32, with wasm-ld (C and C++)', ok: !!cpp.clang, version: cpp.clang ? `${cpp.version} (${cpp.from}: ${cpp.clang})` : null, fix: cpp.clang ? null : `install ${INSTALL_HELP.replace(/\n/g, '\n          ')}${cpp.tried.length ? `\n          tried: ${cpp.tried.join('; ')}` : ''}`, for: 'cpp' });
  if (cpp.emcc) out.push({ name: 'emcc (Emscripten)', ok: true, version: `${cpp.emcc}: est uses the clang inside it, never the emcc driver`, fix: null, for: 'cpp' });
  out.push(playwrightProbe(cwd));
  return out;
}

/** `est dev --json` drives Playwright's Chromium: an optional peer, so only reported. */
function playwrightProbe(cwd: string): Probe {
  const name = "Playwright's Chromium (only for est dev --json)";
  const pw = resolveFrom(cwd, '@playwright/test');
  if (!pw) return { name, ok: false, version: null, fix: 'npm install --save-dev --save-exact @playwright/test@1.64.1 && npx playwright install chromium', for: 'dev' };
  const check = `import(${JSON.stringify(pathToFileURL(pw).href)}).then(m => { const p = (m.chromium ?? m.default?.chromium).executablePath(); process.stdout.write(require('node:fs').existsSync(p) ? 'ok' : 'missing'); }, () => process.stdout.write('missing'))`;
  const r = spawnSync(process.execPath, ['-e', check], { encoding: 'utf8', timeout: 20_000 });
  const ok = r.stdout === 'ok';
  return { name, ok, version: ok ? 'installed' : null, fix: ok ? null : 'npx playwright install chromium', for: 'dev' };
}

/** `est doctor [--json]`: checks the toolchains; prints the exact command for anything missing. */
const command: EstCommand = {
  name: 'doctor',
  summary: 'Check Node, the meter, rustup with wasm32-unknown-unknown, cargo, asc and clang for wasm32; print the command for anything missing',
  usage: [
    'est doctor [--json]',
    '',
    'Checks what the templates need: Node 20 or newer and binaryen (the meter, which comes with',
    '@cyber-est/cli) for every one; rustup, the wasm32-unknown-unknown target and cargo for the Rust',
    'templates (the -rust ones); asc for the AssemblyScript ones (the -as ones and the cookbook\'s',
    'recipes; it comes with @cyber-est/cli); a clang with the wasm32 target and wasm-ld for',
    'cpp-clap (Emscripten\'s or wasi-sdk\'s clang counts; EST_CLANG names one). It also reports Playwright\'s Chromium, which only',
    'est dev --json needs. It installs nothing and fetches nothing. Exit 0 when at least one kind of',
    'template can be built, 1 otherwise.',
  ].join('\n'),
  async run(args, ctx) {
    const p = probes(ctx.cwd);
    const all = p.filter(x => x.for === 'all').every(x => x.ok);
    const rust = all && p.filter(x => x.for === 'rust').every(x => x.ok);
    const as = all && p.filter(x => x.for === 'as').every(x => x.ok);
    const cpp = all && p.filter(x => x.for === 'cpp').every(x => x.ok);
    const devJson = p.filter(x => x.for === 'dev').every(x => x.ok);
    if (args.flags.json) {
      ctx.out(JSON.stringify({ version: CLI_VERSION, probes: p, ready: { rust, as, cpp, devJson } }, null, 2));
    } else {
      ctx.out(versionLine());
      for (const x of p) ctx.out(`${x.ok ? 'ok     ' : x.for === 'dev' ? 'absent ' : 'missing'} ${x.name}${x.version ? `: ${x.version}` : ''}${x.fix ? `\n          run: ${x.fix}` : ''}`);
      ctx.out(`\nRust templates: ${rust ? 'ready' : 'not ready'}; AssemblyScript templates: ${as ? 'ready' : 'not ready'}; C++ (cpp-clap): ${cpp ? 'ready' : 'not ready'}; est dev --json: ${devJson ? 'ready' : 'not ready (optional)'}`);
    }
    return rust || as || cpp ? 0 : 1;
  },
};
export default command;
