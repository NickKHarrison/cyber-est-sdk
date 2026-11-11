#!/usr/bin/env node
/**
 * Checks an EST SDK package tarball (1.319, DEV-A; EST-16, gate 3 of docs/est/EST_PUBLIC_GATES.md):
 *
 *   node scripts/sdk-pack-check.mjs [--stage-root <dir>] <tarball.tgz>...
 *
 * - it holds only what its `files` names (and the `package.json` npm always adds), and, with
 *   `--stage-root` (`scripts/sdk-build.mjs`'s output), exactly the staged files: none dropped;
 * - no TypeScript source (declarations only), except the AssemblyScript a plugin folder compiles
 *   (`est new`'s templates, the cookbook's recipes and the DSP library, `TS_ALLOWED`);
 * - every dependency is an exact version, and nothing is a dev, bundled or optional dependency;
 * - no `scripts` at all, so no `preinstall`, `install`, `postinstall` or `prepare`;
 * - every import of its JavaScript is a Node built-in, a declared dependency, or a relative path
 *   that stays inside the package, and every `new URL(…, import.meta.url)` stays inside it too;
 * - no path of the machine that built it (a baked `import.meta.url`).
 *
 * Exit 1 naming each problem. Writes nothing outside a temporary folder.
 */
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where TypeScript may be: AssemblyScript sources, compiled by asc in the developer's plugin folder. */
export const TS_ALLOWED = ['assets/sdk/templates/', 'assets/sdk/cookbook/', 'assets/sdk/as/'];
/** Browser code (the dev host's page), whose imports are the page's own chunks. */
const BROWSER = ['assets/sdk/devhost/page/'];
/** Lifecycle scripts npm runs on install (EST-16: none, and no `scripts` at all). */
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish'];
const EXACT = /^\d+\.\d+\.\d+$/;

const posix = (p) => p.split(sep).join('/');

/** Every file under `dir`, `/`-separated and relative to it. */
export function walk(dir, base = dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(posix(relative(base, p)));
  }
  return out;
}

const isBuiltin = (s) => s.startsWith('node:') || builtinModules.includes(s);
const packageOf = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);

/** The import specifiers and `import.meta.url`-relative URLs written in a JavaScript file. */
export function specifiersOf(text) {
  const imports = new Set();
  for (const m of text.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
  const urls = new Set();
  for (const m of text.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) urls.add(m[1]);
  return { imports: [...imports], urls: [...urls] };
}

/**
 * The problems with an unpacked package folder (`root` holds its `package.json`).
 * @param {string} root
 * @param {{ staged?: string, machinePaths?: string[] }} [o]
 * @returns {string[]}
 */
export function checkUnpacked(root, o = {}) {
  const problems = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const name = pkg.name ?? basename(root);
  const files = walk(root);
  const say = (s) => problems.push(`${name}: ${s}`);

  // Only `files` (npm adds package.json, and README and LICENSE are named there).
  const allowed = (pkg.files ?? []).map((f) => f.replace(/\/$/, ''));
  if (!allowed.length) say('package.json names no "files"');
  for (const f of files) {
    if (f === 'package.json') continue;
    if (!allowed.some((a) => f === a || f.startsWith(`${a}/`))) say(`${f} is not under "files"`);
  }
  if (o.staged) {
    const want = new Set(walk(o.staged));
    const have = new Set(files);
    for (const f of want) if (!have.has(f)) say(`${f} was staged but is not in the tarball (npm dropped it)`);
    for (const f of have) if (!want.has(f)) say(`${f} is in the tarball but was not staged`);
  }

  // No TypeScript source.
  for (const f of files) {
    if (/\.(ts|tsx|mts|cts)$/.test(f) && !/\.d\.ts$/.test(f) && !TS_ALLOWED.some((p) => f.startsWith(p))) say(`${f} is TypeScript source`);
  }

  // Exact pins; no dev, bundled or optional dependencies; no scripts.
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [dep, v] of Object.entries(pkg[field] ?? {})) if (!EXACT.test(String(v))) say(`${field}.${dep} is "${v}", not an exact version`);
  }
  for (const field of ['devDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) if (pkg[field]) say(`declares ${field}`);
  if (pkg.private) say('is private');
  if (pkg.scripts) {
    const hooks = INSTALL_SCRIPTS.filter((s) => s in pkg.scripts);
    say(hooks.length ? `declares install scripts: ${hooks.join(', ')}` : 'declares scripts');
  }
  if (!EXACT.test(String(pkg.version))) say(`version "${pkg.version}" is not plain semver`);

  // Imports: built-ins, declared dependencies, or inside the package.
  // A package may name itself (`@cyber-est/ui/copy-rule` from inside @cyber-est/ui).
  const declared = new Set([name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const machine = (o.machinePaths ?? [REPO]).filter(Boolean);
  for (const f of files) {
    const text = /\.(m?js|cjs|json|d\.ts|md|html|css)$/.test(f) ? readFileSync(join(root, f), 'utf8') : null;
    if (text === null) continue;
    for (const p of machine) if (text.includes(p)) say(`${f} contains the build machine's path ${p}`);
    if (/file:\/\/\//.test(text) && /\.m?js$/.test(f)) say(`${f} contains a file:/// URL`);
    if (!/\.(m?js|cjs)$/.test(f) || BROWSER.some((b) => f.startsWith(b)) || TS_ALLOWED.some((b) => f.startsWith(b))) continue;
    const { imports, urls } = specifiersOf(text);
    for (const s of imports) {
      if (s.startsWith('.') || s.startsWith('/')) {
        const to = resolve(dirname(join(root, f)), s);
        if (relative(root, to).startsWith('..') || s.startsWith('/')) say(`${f} imports ${s}, outside the package`);
        else if (!existsSync(to)) say(`${f} imports ${s}, which the package does not hold`);
      } else if (!isBuiltin(s) && !declared.has(packageOf(s))) say(`${f} imports ${s}, which is not a declared dependency`);
    }
    for (const u of urls) {
      const to = resolve(dirname(join(root, f)), u);
      if (relative(root, to).startsWith('..')) say(`${f} reads ${u}, outside the package`);
    }
  }
  return problems;
}

/** Unpack a tarball into a temporary folder; returns the package's root (`package/`) and a cleanup. */
export function unpack(tgz) {
  const dir = mkdtempSync(join(tmpdir(), 'cyber-est-check-'));
  const r = spawnSync('tar', ['-xzf', resolve(tgz), '-C', dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar could not unpack ${tgz}: ${r.stderr}`);
  return { root: join(dir, 'package'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The staged folder for a tarball under `stageRoot` (sdk-build's layout: tools, ui, cli). */
function stagedFor(stageRoot, tgz) {
  const key = /cyber-est-(cli|tools|ui)-/.exec(basename(tgz))?.[1];
  return key ? join(stageRoot, key) : undefined;
}

/** Check tarballs; the problems, all of them. */
export function checkTarballs(tgzs, o = {}) {
  const problems = [];
  for (const t of tgzs) {
    const { root, done } = unpack(t);
    try {
      problems.push(...checkUnpacked(root, { staged: o.stageRoot ? stagedFor(o.stageRoot, t) : undefined, machinePaths: o.machinePaths }));
    } finally {
      done();
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--stage-root');
  const stageRoot = i >= 0 ? args.splice(i, 2)[1] : undefined;
  if (!args.length) {
    console.error('usage: node scripts/sdk-pack-check.mjs [--stage-root <dir>] <tarball.tgz>...');
    process.exit(2);
  }
  const problems = checkTarballs(args, { stageRoot, machinePaths: [REPO, ...(stageRoot ? [resolve(stageRoot)] : [])] });
  for (const p of problems) console.error(`sdk-pack-check: ${p}`);
  if (problems.length) process.exit(1);
  console.log(`sdk-pack-check: ${args.map((a) => basename(a)).join(', ')}: only "files", no TypeScript source, exact pins, no install scripts, nothing imported from outside`);
}
