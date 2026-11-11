/**
 * EST Phase 4 (docs/est/EST_Phase4_Work_Order.md §1, 4-A): the broken fixtures, each a plugin
 * folder (`<name>/est.json`, a `ui/` for one) whose module is one of the built modules in `wasm/`
 * (sources in `src/`, built by `build.sh`) or one of Phase 1's fixtures in
 * src/audio/est/fixtures/ (packed from there, not copied). `fixtures.json` lists each with the rule
 * it breaks and whether Cyber's install refuses it (`install`; otherwise only the validator does).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDir } from '../../packages/tools/src/pack.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ name: string, dir: string, module: string, rule: string, install: boolean }} BrokenFixture */

/** @type {BrokenFixture[]} */
export const BROKEN = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8')).map(
  (/** @type {{ name: string, module: string, rule: string, install: boolean }} */ f) => ({ ...f, dir: join(here, f.name), module: resolve(here, f.module) }),
);

/**
 * EST tidy (1.286): fixtures built like the broken ones that must **pass** (`passing.json`), each
 * proving the host does something the spec requires (`init-ok`: it calls `_initialize` once, with
 * fuel, before `clap_entry`; skipped, its output is NaN).
 * @type {{ name: string, dir: string, module: string }[]}
 */
export const PASSING = JSON.parse(readFileSync(join(here, 'passing.json'), 'utf8')).map(
  (/** @type {{ name: string, module: string }} */ f) => ({ ...f, dir: join(here, f.name), module: resolve(here, f.module) }),
);

/**
 * A fixture's canonical bundle.
 * @param {{ dir: string, module: string }} f
 */
export const packFixture = (f) => packDir(f.dir, { module: f.module });
