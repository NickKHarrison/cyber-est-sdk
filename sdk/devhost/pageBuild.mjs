/**
 * The dev host page, built with Vite (as Cyber's own build: the compiling Worker becomes
 * `assets/estWorker-*.js`, the processor's source its own chunk) into a cache folder, and rebuilt
 * only when a source it may import changed (`src/`, `sdk/devhost/`, `sdk/packages/ui/`, the lock
 * file). A built page, not Vite's dev server: no HMR socket, no dependency optimiser reloading the
 * page while the Worker loads Binaryen, the same chunks every time.
 *
 * `loadReader()`: Cyber's bundle reader (`src/audio/est/install/bundle.ts`) bundled for Node with
 * esbuild, so the server reads every bundle with the host's own code before serving it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEVHOST, REPO } from './paths.mjs';

const CACHE = join(REPO, 'node_modules', '.cache', 'est-devhost');
const SOURCES = ['src', 'sdk/devhost/src', 'sdk/devhost/index.html', 'sdk/packages/ui/src', 'package-lock.json', 'sdk/devhost/pageBuild.mjs'];

/** A key over every source file's path, size and modification time. */
export function sourceKey() {
  const h = createHash('sha256');
  const visit = (p) => {
    if (!existsSync(p)) return;
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const name of readdirSync(p).sort()) if (name !== 'node_modules' && !name.startsWith('.')) visit(join(p, name));
    } else if (!/\.test\.tsx?$/.test(p)) {
      h.update(`${relative(REPO, p)}\0${s.size}\0${Math.round(s.mtimeMs)}\n`);
    }
  };
  for (const s of SOURCES) visit(join(REPO, s));
  return h.digest('hex').slice(0, 16);
}

let building = null;

/**
 * The built page's folder (built now when its sources changed since the last build).
 * @param {{ log?: (s: string) => void, force?: boolean }} [o]
 * @returns {Promise<string>}
 */
export function ensurePage(o = {}) {
  building ??= (async () => {
    const key = sourceKey();
    const out = join(CACHE, `page-${key}`);
    if (!o.force && existsSync(join(out, 'index.html'))) return out;
    o.log?.('[est dev] building the dev host page (once per change to its sources)…');
    const t0 = Date.now();
    const tmp = `${out}.tmp-${process.pid}`;
    await buildPage(tmp);
    // Older builds go (one page is kept).
    if (existsSync(CACHE)) for (const name of readdirSync(CACHE)) if (name.startsWith('page-') && name !== `page-${key}` && !name.includes('.tmp-')) rmSync(join(CACHE, name), { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
    mkdirSync(CACHE, { recursive: true });
    // A rename is atomic: another dev host never sees half a page.
    renameSync(tmp, out);
    o.log?.(`[est dev] the dev host page is built (${Math.round((Date.now() - t0) / 1000)} s)`);
    return out;
  })().finally(() => { building = null; });
  return building;
}

/**
 * Build the dev host page into `outDir` (replaced). A published @cyber-est/cli's page is this
 * build, made by scripts/sdk-build.mjs in a process of its own with NODE_ENV=production: under any
 * other NODE_ENV (Vitest sets `test`) the React plugin writes a development build, which names
 * the source files by their paths on the building machine.
 * `modulesFile`: also write there, as JSON, every bundled module under node_modules (the package
 * build lists their licences in THIRD_PARTY_LICENSES.md).
 * @param {string} outDir @param {{ modulesFile?: string }} [o]
 */
export async function buildPage(outDir, o = {}) {
  const { build, createLogger } = await import('vite');
  // Vite's own lines never reach stdout (`est dev --json` prints JSON lines there): warnings and
  // errors go to stderr, and the two expected ones are dropped, so stderr is quiet on a good build:
  // binaryen (the compiling Worker's) imports `node:module`, which the browser build externalises,
  // as it should; and Rolldown's note that the Worker's transform takes most of the build's time.
  const logger = createLogger('warn', { allowClearScreen: false });
  const expected = (/** @type {string} */ msg) => /has been externalized for browser compatibility|PLUGIN_TIMINGS/.test(msg);
  logger.info = () => {};
  logger.warn = (msg) => { if (!expected(String(msg))) process.stderr.write(`${msg}\n`); };
  logger.warnOnce = logger.warn;
  logger.error = (msg) => { process.stderr.write(`${msg}\n`); };
  const react = (await import('@vitejs/plugin-react')).default;
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  rmSync(outDir, { recursive: true, force: true });
  const modules = o.modulesFile ? bundledModules(o.modulesFile) : null;
  await build({
    configFile: false,
    root: DEVHOST,
    base: '/',
    logLevel: 'warn',
    customLogger: logger,
    plugins: [react(), ...(modules ? [modules.plugin(true)] : [])],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@': join(REPO, 'src'), '@game': join(REPO, 'shared', 'game') } },
    css: { postcss: { plugins: [] } },
    // The compiling Worker (Binaryen) is its own build: its modules count too.
    worker: { format: 'es', ...(modules ? { plugins: () => [modules.plugin(false)] } : {}) },
    build: { outDir, emptyOutDir: true, sourcemap: false, minify: false, reportCompressedSize: false, chunkSizeWarningLimit: 1 << 20 },
  });
}

/**
 * Vite plugins recording the node_modules files in the written chunks, the page's and the
 * Worker's, into one list; the page's (`writes`) writes it to `file` as JSON when it closes.
 * @param {string} file
 */
function bundledModules(file) {
  const seen = new Set();
  return {
    plugin: (/** @type {boolean} */ writes) => ({
      name: 'est-bundled-modules',
      generateBundle(/** @type {unknown} */ _options, /** @type {Record<string, any>} */ bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const id of Object.keys(chunk.modules)) if (id.includes('/node_modules/')) seen.add(id.split('?')[0].replace(/^\0/, ''));
        }
      },
      closeBundle() { if (writes) writeFileSync(file, JSON.stringify([...seen].sort())); },
    }),
  };
}

/** Cyber's bundle reader for Node (`readBundle`, `sha256Hex`, …), bundled by esbuild from src/. */
export async function loadReader() {
  const { build } = await import('esbuild');
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `reader-${sourceKey()}.mjs`);
  if (!existsSync(file)) {
    const r = await build({
      entryPoints: [join(REPO, 'src', 'audio', 'est', 'install', 'bundle.ts')],
      bundle: true, platform: 'node', format: 'esm', target: 'node20', write: false, logLevel: 'silent',
      alias: { '@': join(REPO, 'src') },
    });
    writeFileSync(`${file}.tmp`, r.outputFiles[0].text);
    renameSync(`${file}.tmp`, file);
  }
  return import(pathToFileURL(file).href);
}
