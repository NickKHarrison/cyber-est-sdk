/**
 * The sandbox attack order (Cyber_EST_Sandbox_Attack_Work_Order.md, stream E): the hostile
 * fixtures of "what a plugin can do through the front door", laid out like sdk/fixtures/broken/
 * (a plugin folder with est.json, its module built by build.sh into wasm/). Each must **install**:
 * it is what a plugin maker with a live key could publish. Never in est-plugins/, never listed,
 * never signed.
 *
 * - `text-everywhere`: every string is an attack (markup, `javascript:` links, template tokens,
 *   `__proto__`, the longest text each field takes), in est.json, its presets and the names the DSP
 *   reports at run time (control bytes too, which est.json's own text may not hold). Tries: to be
 *   drawn anywhere as other than plain text.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDir } from '../../../packages/tools/src/pack.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** What a hostile string tries to set: no page may ever have it. */
export const PWNED = '__estPwned';

/** @type {{ name: string, dir: string, module: string, tries: string }[]} */
export const HOSTILE_E = [
  { name: 'text-everywhere', dir: join(here, 'text-everywhere'), module: join(here, 'wasm/text-everywhere.wasm'), tries: 'to be drawn as other than plain text' },
];

/** A fixture's canonical bundle. @param {{ dir: string, module: string }} f */
export const packHostile = (f) => packDir(f.dir, { module: f.module });
