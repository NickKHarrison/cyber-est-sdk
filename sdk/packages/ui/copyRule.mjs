/**
 * The contract between `@cyber-est/ui` and `est pack` (docs/est/EST_Phase4_Work_Order.md §6): a bundle
 * whose UI page names `est-ui.js` gets the library as `ui/est-ui.js`, the SDK's own build
 * (`dist/est-ui.js`), so nothing loads from outside the bundle. A plugin's sources never carry a
 * copy of it.
 *
 *   import { withEstUi } from '@cyber-est/ui/copy-rule';   // in Cyber's clone: sdk/packages/ui/copyRule.mjs
 *   const { files, copied } = withEstUi(files);   // files: { 'ui/index.html': Uint8Array, … }
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EST_UI_PATH = 'ui/est-ui.js';
export const EST_UI_FILE = join(dirname(fileURLToPath(import.meta.url)), 'dist', 'est-ui.js');
/** The library's types (`window.EstUI`), which `est new` copies into a plugin's folder. */
export const EST_UI_TYPES = join(dirname(fileURLToPath(import.meta.url)), 'est-ui.d.ts');

/** A `<script src="est-ui.js">` (or `./est-ui.js`) in a page of the bundle's `ui/` folder. */
const REFERENCE = /<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?est-ui\.js["']/i;

/**
 * Whether a bundle's files name the library: a page directly in `ui/` loading `est-ui.js`.
 * @param {Record<string, Uint8Array>} files
 */
export function referencesEstUi(files) {
  const dec = new TextDecoder();
  return Object.entries(files).some(([path, data]) => /^ui\/[^/]+\.html?$/i.test(path) && REFERENCE.test(dec.decode(data)));
}

/**
 * The files with `ui/est-ui.js` set to the SDK's build when the UI names it (replacing any copy
 * the sources had, so a bundle always carries the library its SDK built).
 * @param {Record<string, Uint8Array>} files
 * @param {{ library?: Uint8Array }} [o] `library`: the bytes to copy (default: dist/est-ui.js)
 * @returns {{ files: Record<string, Uint8Array>, copied: boolean }}
 */
export function withEstUi(files, o = {}) {
  if (!referencesEstUi(files)) return { files, copied: false };
  const library = o.library ?? new Uint8Array(readFileSync(EST_UI_FILE));
  return { files: { ...files, [EST_UI_PATH]: library }, copied: true };
}
