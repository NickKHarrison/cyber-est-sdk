/**
 * @cyber-est/tools: the install check's Node host (D-37). The validator, `inspect` and `render` run
 * Cyber's own install code (`src/audio/est/install/`) here with Node's WebAssembly: the same
 * reader, the same meter (Binaryen, `local` placement, D-30), the same shim and the same
 * conformance run as the compiling Worker. Nothing here re-implements a check.
 */
import { compactAbi } from '../../../../src/audio/est/abi/layout';
import type { InstallCheckDeps } from '../../../../src/audio/est/install/pipeline';
import { buildEstShim } from '../../../../src/audio/est/runtime/shim';

let shim: Promise<WebAssembly.Module> | null = null;
/** The host shim, compiled once. */
export const hostShim = (): Promise<WebAssembly.Module> => (shim ??= WebAssembly.compile(buildEstShim(compactAbi().sig) as Uint8Array<ArrayBuffer>));

/** The meter, loaded once (Binaryen takes a moment to load). */
export const loadMeter: InstallCheckDeps['loadMeter'] = async () => (await import('../../../../src/audio/est/install/estMeter')).meter;

export const nodeDeps: InstallCheckDeps = {
  loadMeter,
  compile: bytes => WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>),
  shim: hostShim,
  now: () => performance.now(),
};
