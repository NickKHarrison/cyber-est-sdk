#!/usr/bin/env node
/**
 * `est`, the EST developer kit's command (EST Phase 4, sdk/packages/cli), run from Cyber's clone:
 * `npm run est -- <command>` or `node sdk/packages/cli/bin/est.mjs <command>`.
 *
 * The command and @cyber-est/tools are TypeScript over Cyber's own install code (D-37), so this launcher
 * bundles them with esbuild (the repository's dev dependency) on each run, every file in
 * `src/commands/` a command (`entry.mjs`), and runs the bundle. Each module keeps its own
 * `import.meta.url`, so paths resolve as in the source.
 *
 * 1.319 (DEV-A, D-50): the published `@cyber-est/cli` is not this file. `scripts/sdk-build.mjs`
 * stages the package with the bundle prebuilt (`dist/est.mjs`, the repository's files it reads
 * under `assets/` at their paths) and a launcher of its own (`bin/est.mjs`, two lines).
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { entrySource } from '../entry.mjs';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Keeps each bundled module's own `import.meta.url` (its path in the source tree). */
const metaUrl = {
  name: 'est-import-meta-url',
  setup(b) {
    b.onLoad({ filter: /\.(m?ts|mjs|js)$/ }, args => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes('import.meta.url')) return undefined;
      return { contents: src.split('import.meta.url').join(JSON.stringify(pathToFileURL(args.path).href)), loader: /\.m?ts$/.test(args.path) ? 'ts' : 'js', resolveDir: dirname(args.path) };
    });
  },
};

async function bundle(outfile) {
  const { build } = await import('esbuild');
  await build({
    stdin: { contents: entrySource(pkg), resolveDir: pkg, loader: 'ts', sourcefile: 'est-entry.ts' },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
    packages: 'external', logLevel: 'error', plugins: [metaUrl], legalComments: 'none',
  });
}

async function run() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--build-dist') {
    // Before 1.319 this wrote dist/est.mjs with the build machine's paths baked in.
    console.error('est: the package is built by node scripts/sdk-build.mjs (Cyber_Deploy_Web_Runbook.md §6e)');
    return 2;
  }
  const dir = join(pkg, '.build');
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `est-${process.pid}-${Date.now()}.mjs`);
  await bundle(temp);
  try {
    const m = await import(pathToFileURL(temp).href);
    // `npm run est -- …` runs this from the repository's root; the folder the command was typed in is
    // npm's INIT_CWD (only for that script: a process this one starts inherits the variables).
    const cwd = process.env.npm_lifecycle_event === 'est' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
    return await m.main(m.commands, argv, { cwd });
  } finally {
    rmSync(temp, { force: true });
  }
}

run().then(code => { process.exitCode = code; }, err => {
  process.stderr.write(`est: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
