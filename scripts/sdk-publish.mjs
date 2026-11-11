#!/usr/bin/env node
/**
 * Publishes the EST SDK's npm packages (1.319, DEV-A §4, D-50; EST-16, gate 3 of
 * docs/est/EST_PUBLIC_GATES.md). The runbook is Cyber_Deploy_Web_Runbook.md §6e.
 *
 *   node scripts/sdk-publish.mjs                         # anywhere: build, test, pack, check, smoke; publishes nothing
 *   node scripts/sdk-publish.mjs --pack-only --out <dir>  # the workflow's `build` job: the same, then the
 *                                                         # tarballs and SHA256SUMS written to <dir>
 *   node scripts/sdk-publish.mjs --publish --from <dir>   # the workflow's `publish` job only
 *
 * **Where (1.403, L13):** Cyber's repository is private and npm's provenance needs a public source
 * repository, so the packages are published from the kit's public mirror, `PUBLIC_REPO`, which
 * Cyber writes with `scripts/sdk-export.mjs` (`.github/workflows/sdk-mirror.yml`). There this file
 * sits at the same path, and its workflow is the mirror's `.github/workflows/publish.yml`, run by a
 * version tag `v<version>` (its source in Cyber: `scripts/sdk-mirror/.github/workflows/publish.yml`).
 * In Cyber's own repository, or anywhere else, `--publish` is refused.
 *
 * Building and publishing are separate jobs (the integrator's review of #456): the job that
 * installs, builds and runs the tests holds no OIDC token; the job that holds it installs nothing,
 * builds nothing and runs no package code. `--pack-only`: build the three packages
 * (`scripts/sdk-build.mjs`), run their tests (`TESTS`), `npm pack` each, check each tarball
 * (`scripts/sdk-pack-check.mjs`), run the smoke test on those very tarballs (`scripts/sdk-smoke.sh`),
 * and write them with a `SHA256SUMS` list. `--publish --from`: refuse unless every condition of
 * `publishRefusal` holds; check that `<dir>` holds exactly the three tarballs its `SHA256SUMS`
 * names, with those hashes, at the tag's version (`tagRefusal`); check them again; then
 * `npm publish <tarball> --access public --provenance` for each version not yet on npm (a
 * published version is never replaced).
 *
 * **Publishing is only from CI, through npm's trusted publishing** (OIDC, no token): no publish runs
 * from the owner's Mac or any developer's machine, a token in the environment is refused, and so
 * is a private repository, because npm's provenance needs a public one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackages, DEFAULT_OUT, PACKAGES, REPO } from './sdk-build.mjs';
import { checkTarballs } from './sdk-pack-check.mjs';

/**
 * The kit's public repository (1.403, L13), the only one that publishes: the packages' `repository`
 * fields name it (npm checks them against the provenance), and Cyber's mirror workflow pushes to it.
 */
export const PUBLIC_REPO = 'NickKHarrison/cyber-est-sdk';
/** The only workflow that may publish, in the public repository (its file name is what npm's trusted publisher names). */
export const PUBLISH_WORKFLOW = '.github/workflows/publish.yml';
/** The refs it publishes from: a version tag. */
export const PUBLISH_REF = /^refs\/tags\/v(\d+\.\d+\.\d+)$/;
/** npm's trusted publishing needs npm 11.5.1 or newer. */
export const MIN_NPM = [11, 5, 1];
/** The packages' own suites (the smoke test runs after the pack). */
export const TESTS = ['sdk/packages', 'sdk/devhost', 'sdk/tests', 'sdk/fixtures', 'scripts/sdk-pack.test.mjs'];
/** Publish order: the libraries first. */
const ORDER = ['tools', 'ui', 'cli'];

const newer = (v, min) => {
  const p = String(v).trim().split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i];
  return true;
};

/**
 * Why `--publish` may not run here, or null when it may.
 * @param {NodeJS.ProcessEnv} env @param {{ npmVersion: string, event: any }} facts
 */
export function publishRefusal(env, facts) {
  if (env.GITHUB_ACTIONS !== 'true') return 'publishing runs only in GitHub Actions (the public repository\'s publish workflow), never from a developer\'s machine';
  if (String(env.GITHUB_REPOSITORY ?? '').toLowerCase() !== PUBLIC_REPO.toLowerCase()) return `publishing runs only in the kit's public repository ${PUBLIC_REPO} (this is ${env.GITHUB_REPOSITORY ?? 'no repository'}): Cyber's own repository mirrors the kit there and never publishes`;
  if (!String(env.GITHUB_WORKFLOW_REF ?? '').toLowerCase().startsWith(`${PUBLIC_REPO}/${PUBLISH_WORKFLOW}@`.toLowerCase())) return `publishing runs only from ${PUBLIC_REPO}'s ${PUBLISH_WORKFLOW}`;
  if (!PUBLISH_REF.test(String(env.GITHUB_REF ?? ''))) return `publishing runs only from a version tag, refs/tags/vX.Y.Z (this is ${env.GITHUB_REF ?? 'no ref'})`;
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL) return 'the workflow has no OIDC token (permissions: id-token: write): npm\'s trusted publishing needs one';
  const token = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'npm_config__authToken', 'NPM_CONFIG__AUTHTOKEN'].find((k) => env[k]);
  if (token) return `${token} is set: publishing is through npm's trusted publishing only, never a token`;
  if (facts.event?.repository?.private !== false) return 'the repository is private (or its visibility is unknown): npm\'s provenance needs a public source repository (runbook §6e)';
  if (!newer(facts.npmVersion, MIN_NPM)) return `npm ${facts.npmVersion} is too old for trusted publishing (${MIN_NPM.join('.')} or newer)`;
  return null;
}

/**
 * Why these versions may not be published from this ref, or null: the tag names the one version all
 * three packages carry. @param {string | undefined} ref @param {string[]} versions
 */
export function tagRefusal(ref, versions) {
  const m = PUBLISH_REF.exec(String(ref ?? ''));
  if (!m) return `${ref ?? 'no ref'} is not a version tag`;
  const other = versions.filter((v) => v !== m[1]);
  if (other.length) return `the tag is v${m[1]} but the tarballs are ${[...new Set(versions)].join(', ')}: tag the version the packages carry`;
  return null;
}

function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: o.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', shell: false });
  if (!o.allowFail && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status ?? r.signal})${o.capture ? `\n${r.stderr}` : ''}`);
  return r;
}

/** Whether `name@version` is already on npm (a version is published once, never replaced). */
function published(name, version) {
  const r = sh('npm', ['view', `${name}@${version}`, 'version', '--json'], { capture: true, allowFail: true });
  return r.status === 0 && r.stdout.trim() !== '' && r.stdout.trim() !== '""';
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** The tarball file name `npm pack` gives a package of this name and version. */
const tarballName = (name, version) => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;

/** `SHA256SUMS`' text for these tarballs (`sha256sum` format, by file name). */
export function sumsOf(files) {
  return `${files.map((f) => `${sha256(f)}  ${basename(f)}`).join('\n')}\n`;
}

/**
 * The tarballs a `--from` folder may publish, each checked against `SHA256SUMS`: exactly one for each
 * of the three packages, listed, present, with its listed hash. Throws naming what is wrong.
 * @param {string} dir
 */
export function verifiedTarballs(dir) {
  const sums = join(dir, 'SHA256SUMS');
  if (!existsSync(sums)) throw new Error(`${dir} has no SHA256SUMS`);
  const listed = new Map();
  for (const line of readFileSync(sums, 'utf8').split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+\.tgz)$/.exec(line);
    if (!m) throw new Error(`SHA256SUMS has a line it cannot read: ${line}`);
    listed.set(m[2], m[1]);
  }
  const present = readdirSync(dir).filter((f) => f.endsWith('.tgz')).sort();
  const unlisted = present.filter((f) => !listed.has(f));
  if (unlisted.length) throw new Error(`tarballs not in SHA256SUMS: ${unlisted.join(', ')}`);
  if (listed.size !== ORDER.length) throw new Error(`SHA256SUMS lists ${listed.size} tarballs, not ${ORDER.length}`);
  return ORDER.map((key) => {
    const prefix = `${PACKAGES[key].name.replace('@', '').replace('/', '-')}-`;
    const names = [...listed.keys()].filter((n) => n.startsWith(prefix) && /^\d+\.\d+\.\d+\.tgz$/.test(n.slice(prefix.length)));
    if (names.length !== 1) throw new Error(`SHA256SUMS must list one tarball for ${PACKAGES[key].name}, not ${names.length}`);
    const file = join(dir, names[0]);
    if (!existsSync(file)) throw new Error(`${names[0]} is listed but missing`);
    if (sha256(file) !== listed.get(names[0])) throw new Error(`${names[0]} does not have the hash SHA256SUMS lists`);
    return file;
  });
}

/** Build, test, pack, check and smoke-test; the three tarballs, in ORDER. */
async function buildAndCheck() {
  const out = DEFAULT_OUT;
  const dirs = await buildPackages({ out });
  console.log('\n== the packages\' tests');
  sh(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...TESTS]);

  console.log('\n== pack');
  const tgzDir = join(out, 'tarballs');
  rmSync(tgzDir, { recursive: true, force: true });
  mkdirSync(tgzDir, { recursive: true });
  const tgzs = ORDER.map((key) => {
    sh('npm', ['pack', dirs[key], '--pack-destination', tgzDir, '--silent'], { capture: true });
    const { name, version } = JSON.parse(readFileSync(join(dirs[key], 'package.json'), 'utf8'));
    const file = join(tgzDir, tarballName(name, version));
    if (!existsSync(file)) throw new Error(`npm pack wrote no ${basename(file)}`);
    return file;
  });
  const problems = checkTarballs(tgzs, { stageRoot: out, machinePaths: [REPO, resolve(out)] });
  if (problems.length) throw new Error(`the tarballs do not pass:\n${problems.join('\n')}`);
  console.log('the tarballs pass sdk-pack-check');

  console.log('\n== the smoke test, on these tarballs');
  sh('bash', [join(REPO, 'scripts', 'sdk-smoke.sh'), ...tgzs]);
  return tgzs;
}

const flag = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  if (process.argv.includes('--publish')) {
    const from = flag('--from');
    if (!from) throw new Error('--publish needs --from <dir> (the build job\'s tarballs): this job builds nothing');
    const npmVersion = sh('npm', ['--version'], { capture: true }).stdout.trim();
    const event = process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
    const refusal = publishRefusal(process.env, { npmVersion, event });
    if (refusal) throw new Error(`refused: ${refusal}`);
    const tgzs = verifiedTarballs(resolve(from));
    const problems = checkTarballs(tgzs, { machinePaths: [REPO] });
    if (problems.length) throw new Error(`the tarballs do not pass:\n${problems.join('\n')}`);
    console.log(`the tarballs match SHA256SUMS and pass sdk-pack-check: ${tgzs.map((t) => basename(t)).join(', ')}`);
    const manifests = tgzs.map((tgz) => /** @type {{ name: string, version: string }} */ (JSON.parse(readFileSync(join(unpackedManifestDir(tgz), 'package.json'), 'utf8'))));
    const wrongTag = tagRefusal(process.env.GITHUB_REF, manifests.map((m) => m.version));
    if (wrongTag) throw new Error(`refused: ${wrongTag}`);
    for (const [i, tgz] of tgzs.entries()) {
      const { name, version } = /** @type {{ name: string, version: string }} */ (manifests[i]);
      if (published(name, version)) { console.log(`${name}@${version} is already on npm: left as it is`); continue; }
      sh('npm', ['publish', tgz, '--access', 'public', '--provenance']);
      console.log(`published ${name}@${version}`);
    }
    return;
  }
  const tgzs = await buildAndCheck();
  const out = flag('--out');
  if (process.argv.includes('--pack-only')) {
    if (!out) throw new Error('--pack-only needs --out <dir>');
    mkdirSync(out, { recursive: true });
    for (const t of tgzs) cpSync(t, join(out, basename(t)));
    const copies = tgzs.map((t) => join(out, basename(t)));
    writeFileSync(join(out, 'SHA256SUMS'), sumsOf(copies));
    console.log(`\nwrote ${copies.map((c) => basename(c)).join(', ')} and SHA256SUMS to ${out}`);
    return;
  }
  for (const t of tgzs) console.log(`would publish ${basename(t)}; ${PUBLIC_REPO}'s publish workflow builds with --pack-only and publishes with --publish --from`);
}

/** A tarball's package.json, unpacked into a temporary folder (removed at exit). */
function unpackedManifestDir(tgz) {
  const dir = join(DEFAULT_OUT, `manifest-${basename(tgz, '.tgz')}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  sh('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1', 'package/package.json']);
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`sdk-publish: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
