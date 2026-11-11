/**
 * `tools.mjs` in a published `@cyber-est/cli` (scripts/sdk-build.mjs puts this module in its
 * place): `@cyber-est/tools` is bundled into the dev host itself, so nothing is built at run time.
 */
import * as tools from '../packages/tools/src/index.ts';

export async function loadTools() {
  return tools;
}
