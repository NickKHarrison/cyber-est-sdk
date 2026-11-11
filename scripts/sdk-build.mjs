#!/usr/bin/env node
/**
 * Builds the EST developer kit's three npm packages (1.319, DEV-A, D-50: `@cyber-est/cli`,
 * `@cyber-est/tools`, `@cyber-est/ui`) into staged folders that `npm pack` packs as they are.
 * Nothing here publishes: `scripts/sdk-publish.mjs` does, from GitHub Actions only.
 *
 *   node scripts/sdk-build.mjs [--out <dir>]   # default node_modules/.cache/cyber-est-packages
 *
 * The source stays in `sdk/` (D-37) and each source `package.json` is the published manifest
 * except for `"private": true`, which only the staged copy drops: nothing can be published from
 * a source folder by mistake.
 *
 * **Self-contained (EST-16).** `@cyber-est/tools` and `@cyber-est/cli` are TypeScript over Cyber's
 * own install code (`src/audio/est/`, `shared/`, `server/estOrigin.mjs`), so each is bundled with
 * esbuild into `dist/`; their only imports are Node's own modules and the exactly pinned
 * dependencies their `package.json` declares (`checkExternals`). Files the code reads at run time
 * (the spec's JSON, `est-ui.js`, the templates and the DSP libraries, the dev host's page) are
 * copied under `assets/` **at their paths in the repository**, and every bundled module's
 * `import.meta.url` is rewritten to its own path under `assets/` relative to the bundle
 * (`assetMetaUrl`), so the source's path arithmetic is unchanged and no path of the machine that
 * built the package is baked in.
 *
 * **The dev host ships inside the CLI** (DEV-A §3): its page is `pageBuild.mjs`'s Vite build
 * (`buildPage`), made fresh on every package build at `assets/sdk/devhost/page/`; its server and command are one bundle at
 * `assets/sdk/devhost/cli/dev.mjs` (where `est dev` looks for it), with `pageBuild.mjs` and
 * `tools.mjs` replaced by their `.package.mjs` siblings (`SWAPS`). So `est dev` builds nothing and
 * needs neither Vite nor esbuild.
 *
 * The build is reproducible: the same commit stages the same bytes (`scripts/sdk-smoke.sh` packs
 * two builds and compares the tarballs).
 */
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = join(REPO, 'node_modules', '.cache', 'cyber-est-packages');

/** The three packages: their source folder and the folder name `npm pack` gives their tarball. */
export const PACKAGES = Object.freeze({
  tools: { dir: 'sdk/packages/tools', name: '@cyber-est/tools' },
  ui: { dir: 'sdk/packages/ui', name: '@cyber-est/ui' },
  cli: { dir: 'sdk/packages/cli', name: '@cyber-est/cli' },
});

/** Folders never copied into a package. */
const SKIP = new Set(['node_modules', 'target', 'build', 'dist', '.git', '.build', '.est-build']);
/** npm never packs a file of this name; scaffold.ts's `PACKED_GITIGNORE` names it back. */
const PACKED_GITIGNORE = '_gitignore';

/** The repository's files the tools read at run time (`SPEC_FILES`, pack's `EST_UI_DIST`, the C and C++ build). */
export const TOOLS_ASSETS = Object.freeze([
  'src/audio/est/abi/est-abi-1.0.json',
  'src/audio/est/abi/est-abi-1.1.json',
  'src/audio/est/abi/est-manifest-1.schema.json',
  'src/audio/est/abi/est-validator-rules.json',
  'docs/est/EST_SPECIFICATION_DRAFT.md',
  'sdk/packages/ui/dist/est-ui.js',
  // DEV-G (1.326): the C and C++ build `readProject`'s `cpp` kind runs (`CPP_BUILD`, spawned with
  // Node from here), its toolchain search, the CLAP headers and the freestanding runtime.
  'sdk/cpp',
]);
/** And the CLI's: the tools' (bundled into it), `est new`'s templates, the cookbook's recipes (`est new chorus`: the guide's and the prompt kit's commands) and libraries, the dev host's fallback LICENSE. */
export const CLI_ASSETS = Object.freeze([
  ...TOOLS_ASSETS,
  'sdk/packages/ui/est-ui.d.ts',
  'sdk/templates',
  'sdk/cookbook',
  'sdk/as/est',
  'sdk/rust/est',
  'est-plugins/LICENSE',
]);

/** 1.400 (P3): the guide @cyber-est/cli carries at its root (`files` names it). */
export const CLI_GUIDE = 'sdk/docs/BUILD_AN_EST_PLUGIN.md';
/**
 * 1.434: every doc @cyber-est/cli carries at its root, each named in its `files`: the guide, the
 * prompt kit and the sharing guide (`scripts/sdk-pack.test.mjs` holds the two lists together).
 */
export const CLI_DOCS = Object.freeze([CLI_GUIDE, 'sdk/docs/PROMPT_KIT.md', 'sdk/docs/SHARING.md']);

/**
 * 1.440 (rc-est 17): the kit's docs in its public repository (`PUBLIC_REPO` in sdk-publish.mjs; the
 * test holds the two equal). A packed doc's relative link to a page the package does not carry
 * (validator-rules.md, publishing.md …) is rewritten to that page there, so no link in the package
 * leads nowhere.
 */
export const KIT_DOCS_URL = 'https://github.com/NickKHarrison/cyber-est-sdk/blob/main/sdk/docs/';

/**
 * A doc as the CLI packs it: every relative Markdown link to a page outside `CLI_DOCS` points at
 * `KIT_DOCS_URL` instead; links to the packed docs, anchors and absolute URLs are kept. Pure.
 * @param {string} text
 * @returns {string}
 */
export function packedDoc(text) {
  const packed = new Set(CLI_DOCS.map((d) => basename(d)));
  return text.replace(/\]\(([^)#:\s]+\.md)(#[^)]*)?\)/g, (all, file, hash = '') => (packed.has(file) ? all : `](${KIT_DOCS_URL}${file}${hash})`));
}

/** Modules the dev host replaces with their `.package.mjs` sibling in a package. */
export const SWAPS = Object.freeze(['sdk/devhost/pageBuild.mjs', 'sdk/devhost/tools.mjs']);

const posix = (p) => p.split(sep).join('/');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const isBuiltin = (s) => s.startsWith('node:') || builtinModules.includes(s);

/** The package name a bare specifier names (`@scope/name/sub` → `@scope/name`). */
export function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * esbuild plugin: each module's `import.meta.url` becomes its own path under `<stage>/assets/`,
 * relative to the bundle's folder `outDir` (so the bundle runs from wherever npm puts it).
 * @param {string} stage @param {string} outDir
 */
export function assetMetaUrl(stage, outDir) {
  return {
    name: 'est-asset-meta-url',
    setup(b) {
      b.onLoad({ filter: /\.(m?ts|tsx|mjs|js)$/ }, (args) => {
        const src = readFileSync(args.path, 'utf8');
        if (!src.includes('import.meta.url')) return undefined;
        const rel = relative(REPO, args.path);
        if (rel.startsWith('..')) throw new Error(`${args.path} uses import.meta.url outside the repository`);
        const target = posix(relative(outDir, join(stage, 'assets', rel)));
        const expr = `new URL(${JSON.stringify(target)}, import.meta.url).href`;
        return { contents: src.split('import.meta.url').join(expr), loader: /\.tsx?$|\.mts$/.test(args.path) ? 'ts' : 'js', resolveDir: dirname(args.path) };
      });
    },
  };
}

/** esbuild plugin: `SWAPS` resolve to their `.package.mjs` sibling; `used` collects the ones met. */
function swapModules(used) {
  return {
    name: 'est-package-swaps',
    setup(b) {
      b.onResolve({ filter: /\.mjs$/ }, (args) => {
        if (!args.importer || !args.path.startsWith('.')) return undefined;
        const abs = resolve(args.resolveDir, args.path);
        const rel = posix(relative(REPO, abs));
        if (!SWAPS.includes(rel)) return undefined;
        used.add(rel);
        return { path: abs.replace(/\.mjs$/, '.package.mjs') };
      });
    },
  };
}

/**
 * One bundle. Bare imports stay imports (Node resolves them from the package's dependencies);
 * returns the bare specifiers it imports.
 * @param {{ entry?: string, stdin?: { contents: string, resolveDir: string }, outfile: string, stage: string, swaps?: Set<string> }} o
 */
async function bundle(o) {
  const { build } = await import('esbuild');
  const plugins = [assetMetaUrl(o.stage, dirname(o.outfile))];
  if (o.swaps) plugins.unshift(swapModules(o.swaps));
  const r = await build({
    ...(o.entry ? { entryPoints: [o.entry] } : { stdin: { .../** @type {{ contents: string, resolveDir: string }} */ (o.stdin), loader: 'ts', sourcefile: 'est-entry.ts' } }),
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: o.outfile,
    packages: 'external', alias: { '@': join(REPO, 'src'), '@game': join(REPO, 'shared', 'game') },
    // Dead branches folded, names and layout kept (a developer may read the bundle).
    minifySyntax: true, legalComments: 'none', charset: 'utf8', logLevel: 'error', metafile: true,
    banner: { js: '// Built from Cyber\'s repository by scripts/sdk-build.mjs (MIT). The source: sdk/ and src/audio/est/.' },
    plugins,
  });
  const meta = /** @type {import('esbuild').Metafile} */ (r.metafile); // `metafile: true`
  const out = meta.outputs[posix(relative(process.cwd(), o.outfile))] ?? Object.values(meta.outputs)[0];
  return [...new Set(out.imports.filter((i) => i.external).map((i) => i.path))].sort();
}

/**
 * Every bare import is a Node built-in or a declared dependency (EST-16: the tarball resolves
 * nothing outside itself and its pinned dependencies). Throws naming the rest.
 * @param {string[]} imports @param {Record<string, unknown>} pkg @param {string} what
 */
export function checkExternals(imports, pkg, what) {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const bad = imports.filter((s) => !isBuiltin(s) && !declared.has(packageOf(s)));
  if (bad.length) throw new Error(`${what} imports ${bad.join(', ')}, which ${pkg.name} does not declare`);
}

/** Copy a repository file or folder to `<stage>/assets/<same path>` (folders without build output). */
function copyAsset(stage, rel) {
  const from = join(REPO, rel);
  if (!existsSync(from)) throw new Error(`${rel} is missing (the package needs it)`);
  const to = join(stage, 'assets', rel);
  mkdirSync(dirname(to), { recursive: true });
  if (!statSync(from).isDirectory()) { cpSync(from, to); return; }
  cpSync(from, to, { recursive: true, filter: (s) => !SKIP.has(basename(s)) });
  renameGitignores(to);
}

function renameGitignores(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) renameGitignores(p);
    else if (n === '.gitignore') renameSync(p, join(dir, PACKED_GITIGNORE));
  }
}

/** The staged manifest: the source's, without `private` (and never with scripts or dev dependencies). */
function stageManifest(src, stage) {
  const pkg = readJson(join(REPO, src, 'package.json'));
  delete pkg.private;
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const f of ['README.md', 'LICENSE']) cpSync(join(REPO, src, f), join(stage, f));
  return pkg;
}

async function buildTools(stage) {
  const pkg = stageManifest(PACKAGES.tools.dir, stage);
  for (const a of TOOLS_ASSETS) copyAsset(stage, a);
  const src = join(REPO, PACKAGES.tools.dir, 'src');
  checkExternals(await bundle({ entry: join(src, 'index.ts'), outfile: join(stage, 'dist', 'index.mjs'), stage }), pkg, '@cyber-est/tools');
  checkExternals(await bundle({ entry: join(src, 'pack.mjs'), outfile: join(stage, 'dist', 'pack.mjs'), stage }), pkg, '@cyber-est/tools/pack');
}

async function buildUi(stage) {
  stageManifest(PACKAGES.ui.dir, stage);
  const src = join(REPO, PACKAGES.ui.dir);
  // The built library is the committed one (`build.mjs --check` holds it to the source).
  for (const f of ['dist/est-ui.js', 'dist/index.js', 'est-ui.d.ts', 'copyRule.mjs']) {
    mkdirSync(dirname(join(stage, f)), { recursive: true });
    cpSync(join(src, f), join(stage, f));
  }
  // Declarations, so the package carries no TypeScript source.
  const tsc = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
  const r = spawnSync(process.execPath, [tsc, join(src, 'src', 'index.ts'), '--declaration', '--emitDeclarationOnly', '--outDir', join(stage, 'dist', 'types'),
    '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom', '--strict', '--skipLibCheck', '--newLine', 'lf'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`@cyber-est/ui's declarations did not build:\n${r.stdout}${r.stderr}`);
}

function buildPageInto(dir, modulesFile) {
  const url = new URL('../sdk/devhost/pageBuild.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); await m.buildPage(${JSON.stringify(dir)}, { modulesFile: ${JSON.stringify(modulesFile)} });`], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' },
  });
  if (r.status !== 0 || !existsSync(join(dir, 'index.html'))) throw new Error(`the dev host page did not build:\n${r.stdout}${r.stderr}`);
}

/** The npm package (name and folder) a node_modules path belongs to. */
export function packageDirOf(file) {
  const i = file.lastIndexOf('/node_modules/');
  const rest = file.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: `${file.slice(0, i)}/node_modules/${name}` };
}

/**
 * THIRD_PARTY_LICENSES.md: every npm package bundled into the package's files (the dev host page's
 * React, react-dom, scheduler and Binaryen), with its version, its licence and the full text of its
 * own LICENSE and NOTICE files. Throws when a bundled package carries no licence file.
 * @param {string[]} modules node_modules files the bundles hold
 */
export function thirdPartyLicenses(modules) {
  const pkgs = new Map();
  for (const m of modules) { const p = packageDirOf(m); pkgs.set(p.name, p.dir); }
  const out = [
    '# Third-party software in @cyber-est/cli',
    '',
    "The dev host page in `assets/sdk/devhost/page/` bundles these packages. Everything else in this package is Cyber's own code, MIT (`LICENSE`). Its npm dependencies are installed by npm, not bundled, and carry their own licences.",
  ];
  for (const name of [...pkgs.keys()].sort()) {
    const dir = pkgs.get(name);
    const meta = readJson(join(dir, 'package.json'));
    const texts = readdirSync(dir).filter((f) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(f)).sort();
    if (!texts.some((f) => /^licen|^copying/i.test(f))) throw new Error(`${name} is bundled but has no licence file to ship`);
    out.push('', `## ${name} ${meta.version}`, '', `Licence: ${typeof meta.license === 'string' ? meta.license : JSON.stringify(meta.license)}. ${meta.homepage ?? meta.repository?.url ?? ''}`.trim());
    for (const f of texts) out.push('', `### ${f}`, '', '```', readFileSync(join(dir, f), 'utf8').trimEnd(), '```');
  }
  return `${out.join('\n')}\n`;
}

async function buildCli(stage) {
  const pkg = stageManifest(PACKAGES.cli.dir, stage);
  // 1.400 (P3): the first-plugin guide beside the README, so it is there from npm alone; 1.434: the
  // prompt kit and the sharing guide beside it.
  for (const doc of CLI_DOCS) writeFileSync(join(stage, basename(doc)), packedDoc(readFileSync(join(REPO, doc), 'utf8')));
  for (const a of CLI_ASSETS) copyAsset(stage, a);
  const cliSrc = join(REPO, PACKAGES.cli.dir);
  const { CLONE_ONLY, entrySource } = await import('../sdk/packages/cli/entry.mjs');
  checkExternals(await bundle({ stdin: { contents: entrySource(cliSrc, { exclude: CLONE_ONLY, developer: true }), resolveDir: cliSrc }, outfile: join(stage, 'dist', 'est.mjs'), stage }), pkg, '@cyber-est/cli');
  // The dev host: its command and server, where `est dev` (src/commands/dev.ts) looks for them.
  const swaps = new Set();
  const devOut = join(stage, 'assets', 'sdk', 'devhost', 'cli', 'dev.mjs');
  checkExternals(await bundle({ entry: join(REPO, 'sdk', 'devhost', 'cli', 'dev.mjs'), outfile: devOut, stage, swaps }), pkg, "@cyber-est/cli's dev host");
  const missed = SWAPS.filter((s) => !swaps.has(s));
  if (missed.length) throw new Error(`the dev host no longer imports ${missed.join(', ')}: update SWAPS`);
  // Its page: pageBuild.mjs's Vite build, made fresh (never the clone's cache) in a process of its
  // own with NODE_ENV=production, whatever the caller's (Vitest's `test` gives a development build
  // that names this machine's paths).
  const modulesFile = join(stage, '..', 'cli-page-modules.json');
  buildPageInto(join(stage, 'assets', 'sdk', 'devhost', 'page'), modulesFile);
  const modules = JSON.parse(readFileSync(modulesFile, 'utf8')).map((m) => posix(m));
  rmSync(modulesFile, { force: true });
  writeFileSync(join(stage, 'THIRD_PARTY_LICENSES.md'), thirdPartyLicenses(modules));
  // The launcher: two lines over the bundle.
  const bin = join(stage, 'bin', 'est.mjs');
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    "// @cyber-est/cli's `est` (written by Cyber's scripts/sdk-build.mjs): the command, prebuilt in dist/est.mjs.",
    "import { commands, main } from '../dist/est.mjs';",
    'main(commands, process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {',
    "  process.stderr.write(`est: ${err instanceof Error ? err.stack ?? err.message : String(err)}\\n`);",
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n'));
  chmodSync(bin, 0o755);
}

/**
 * Stage the packages (all three by default) under `out/<key>/`; returns their folders.
 * @param {{ out?: string, only?: (keyof typeof PACKAGES)[], log?: (s: string) => void }} [o]
 */
export async function buildPackages(o = {}) {
  const out = resolve(o.out ?? DEFAULT_OUT);
  const log = o.log ?? ((s) => console.log(s));
  const only = o.only ?? /** @type {(keyof typeof PACKAGES)[]} */ (Object.keys(PACKAGES));
  const builders = { tools: buildTools, ui: buildUi, cli: buildCli };
  /** @type {Record<string, string>} */
  const dirs = {};
  for (const key of only) {
    const stage = join(out, key);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    await builders[key](stage);
    dirs[key] = stage;
    log(`staged ${PACKAGES[key].name} in ${relative(process.cwd(), stage) || '.'}`);
  }
  return dirs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  buildPackages({ out: i > 0 ? process.argv[i + 1] : undefined }).catch((err) => {
    console.error(`sdk-build: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
