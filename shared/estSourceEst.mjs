/**
 * 1.909 (source .est): the one rule that tells **a plugin's source** packed as `<name>.est` from a
 * built EST bundle, and the one sentence that refuses it wherever a built bundle is read.
 *
 * A chat assistant with file tools cannot compile WebAssembly, but it can write a zip. So the one
 * prompt asks it for `<name>.est`: a zip of the same files a pasted answer holds (est.json,
 * `assembly/index.ts`, the window's `ui/…` files, optional assets) and **no compiled module**.
 *
 * **The marker (precise):** a zip is a source `.est` when **none of its entries is a WebAssembly
 * module** (a name ending in `.wasm`, any case, anywhere) **and at least one entry is an
 * AssemblyScript source** (a name ending in `.ts`, not `.d.ts`, any case, anywhere). A built bundle
 * always holds its module (`est.json`'s `module`, EST-B012 refuses one without it), so no built
 * bundle is ever a source `.est`, and no source `.est` is ever read as a built bundle: the two never
 * overlap, and the strict reader's rules for a built bundle (src/audio/est/install/bundle.ts,
 * shared/estStrictZip.mjs) are unchanged. Only names are read here: no entry is unpacked.
 *
 * Only **Add a plugin file** (and the playground) builds a source `.est`, in the browser's compile
 * Worker, then adds it through the one install pipeline. Everywhere else a `.est` is read (a
 * project's stored bundle, the sessions' store, shared projects, the registry, the store, Follow
 * `est dev`, developer mode's Load a bundle file, the kit's validator) refuses it with
 * `SOURCE_EST_WORDS` under `SOURCE_EST_RULE`, never compiling it there. Pure: no DOM, no Node.
 */

/** The rule id a source `.est` is refused under where a built bundle is read (src/audio/est/install/rules.ts). */
export const SOURCE_EST_RULE = 'EST-B017';

/** The one sentence a source `.est` is refused with, everywhere but Add a plugin file. */
export const SOURCE_EST_WORDS = "This is a plugin's source. Add it with Add a plugin file first; then Save its .est file gives you one to share.";

/** A WebAssembly module's name. @param {string} n */
const isModule = (n) => /\.wasm$/i.test(n);
/** An AssemblyScript source's name (a declaration file is not one). @param {string} n */
const isSource = (n) => /\.ts$/i.test(n) && !/\.d\.ts$/i.test(n);

/**
 * Whether a zip whose entry names are `names` is a plugin's source (the marker above).
 * Directory entries (ending `/`) are ignored.
 * @param {readonly string[]} names
 * @returns {boolean}
 */
export function isSourceEstNames(names) {
  const files = names.filter((n) => typeof n === 'string' && !n.endsWith('/'));
  return !files.some(isModule) && files.some(isSource);
}
