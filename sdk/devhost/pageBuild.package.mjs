/**
 * `pageBuild.mjs` in a published `@cyber-est/cli` (scripts/sdk-build.mjs puts this module in its
 * place): the dev host page was built with the package (Vite, `pageBuild.mjs`'s own build, into
 * `page/` beside this folder's other files), and Cyber's bundle reader is bundled in. Nothing is
 * built or fetched at run time, and neither Vite nor esbuild is a dependency of the package.
 */
import { join } from 'node:path';
import * as reader from '../../src/audio/est/install/bundle.ts';
import { DEVHOST } from './paths.mjs';

/** The shipped page's folder. */
export const SHIPPED_PAGE = join(DEVHOST, 'page');

export function sourceKey() {
  return 'shipped';
}

export async function ensurePage() {
  return SHIPPED_PAGE;
}

export async function loadReader() {
  return reader;
}
