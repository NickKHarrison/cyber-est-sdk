/**
 * The `est` bundle's entry, shared by the clone's launcher (`bin/est.mjs`, which bundles the
 * source on each run) and the package build (`scripts/sdk-build.mjs`, which bundles it once into a
 * published `@cyber-est/cli`'s `dist/est.mjs`): every file in `src/commands/` is a command.
 *
 * `CLONE_ONLY` are Cyber's own registry commands (`keygen`, `sign`, `publish`: the owner's key and
 * `est-plugins/`, 1.305). They read and write Cyber's repository, so the published CLI leaves them
 * out. 1.322 (DEV-C follow-up): in their place it packs `src/developer/`'s developer-only versions of
 * the same three (`developer: true`): a developer's key, `--developer` signature and `publish <file>`,
 * the owner's modes refused with words. The clone keeps both modes in `src/commands/`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CLONE_ONLY = Object.freeze(['keygen', 'sign', 'publish']);
/** The published CLI's own versions of `CLONE_ONLY`, in `src/developer/`. */
export const DEVELOPER_DIR = 'developer';

/** The command files under `pkg/src/commands`, sorted (tests left out). @param {string} pkg @param {{ exclude?: string[] }} [o] */
export function commandFiles(pkg, { exclude = [] } = {}) {
  return readdirSync(join(pkg, 'src', 'commands'))
    .filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !exclude.includes(f.replace(/\.ts$/, '')))
    .sort();
}

/** The developer-only command files under `pkg/src/developer`, sorted. */
export function developerFiles(pkg) {
  return readdirSync(join(pkg, 'src', DEVELOPER_DIR)).filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).sort();
}

/**
 * The entry module's source: the commands as `commands`, and `main`. Resolve it from `pkg`.
 * `developer: true` adds `src/developer/`'s commands (the published CLI, with `CLONE_ONLY` excluded).
 */
export function entrySource(pkg, opts = {}) {
  const paths = [
    ...commandFiles(pkg, opts).map(f => `./src/commands/${f}`),
    ...(opts.developer ? developerFiles(pkg).map(f => `./src/${DEVELOPER_DIR}/${f}`) : []),
  ];
  return [
    ...paths.map((f, i) => `import c${i} from '${f}';`),
    "import { main } from './src/main.ts';",
    `export const commands = [${paths.map((_, i) => `c${i}`).join(', ')}];`,
    'export { main };',
  ].join('\n');
}
