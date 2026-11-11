/**
 * The dev host's `@cyber-est/tools` (4-A's `pack` and `validate`), loaded from Cyber's clone: its
 * TypeScript bundled once with esbuild (the repository's dev dependency). A published
 * `@cyber-est/cli` carries `tools.package.mjs` in this module's place (`scripts/sdk-build.mjs`).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './paths.mjs';

/**
 * Keeps each bundled module's own `import.meta.url` (its path in the source tree), as `est`'s
 * launcher does (sdk/packages/cli/bin/est.mjs): @cyber-est/tools finds @cyber-est/ui's script, `asc` and the
 * spec's files from where its sources are, not from the bundle's cache folder.
 */
const KEEP_META_URL = {
  name: 'est-import-meta-url',
  setup(b) {
    b.onLoad({ filter: /\.(m?ts|mjs|js)$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes('import.meta.url')) return undefined;
      return { contents: src.split('import.meta.url').join(JSON.stringify(pathToFileURL(args.path).href)), loader: /\.m?ts$/.test(args.path) ? 'ts' : 'js', resolveDir: dirname(args.path) };
    });
  },
};

/** 4-A's `@cyber-est/tools` when it is in the repository (its `pack` and `validate`), else null. */
export async function loadTools(log) {
  const dir = join(REPO, 'sdk', 'packages', 'tools');
  for (const f of ['src/index.mjs', 'src/index.js', 'index.mjs', 'dist/index.js', 'src/index.ts']) {
    const file = join(dir, f);
    if (!existsSync(file)) continue;
    try {
      if (!f.endsWith('.ts')) return await import(pathToFileURL(file).href);
      const { build } = await import('esbuild');
      const out = join(REPO, 'node_modules', '.cache', 'est-devhost', `tools-${process.pid}.mjs`);
      mkdirSync(dirname(out), { recursive: true });
      await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: out, packages: 'external', alias: { '@': join(REPO, 'src') }, logLevel: 'silent', plugins: [KEEP_META_URL] });
      return await import(pathToFileURL(out).href);
    } catch (err) {
      log(`[est dev] @cyber-est/tools did not load (${err instanceof Error ? err.message : err}); packing with the dev host's own steps`);
      return null;
    }
  }
  return null;
}
