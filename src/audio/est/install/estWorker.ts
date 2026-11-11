/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §4, decisions D-27 and D-30): the compiling
 * Worker. Built by Vite as `assets/estWorker-<hash>.js` and served by the app's server with a
 * policy of its own that allows `'wasm-unsafe-eval'` (2-B), so WebAssembly is compiled here and
 * nowhere else: the page's policy stays as it is, and the page and the worklet only instantiate
 * the `WebAssembly.Module`s this posts back (Phase 1: Chromium allows that under the page's CSP).
 *
 * Two requests (`workerProtocol.ts`):
 * - `install`: the bundle read and checked (`bundle.ts`: the archive, the manifest, every hash,
 *   the module's imports, exports and memory, the note ports and presets, before anything runs);
 *   effects and, since Phase 3, instruments (the conformance run checks their notes); the module metered (`estMeter.ts`, Binaryen, `local` placement; loaded only for an install); the
 *   metered bytes compiled with the host shim; the conformance run (`conformance.ts`: the Phase 1
 *   processor's code on a stand-in audio thread, since a Worker has no AudioWorklet or
 *   OfflineAudioContext); then the metered bytes, their hash, the report and both Modules back.
 * - `compile`: an installed module's stored metered bytes, re-hashed against the record before
 *   they are compiled, and refused unless they carry the fuel exports.
 *
 * It never decides a timeout: the page that made it terminates it (`workerClient.ts`), the one
 * thing that stops code that never returns. Never imported by the page (only its URL is).
 *
 * EST Phase 4 (D-37): the install's checks moved to `pipeline.ts` (`checkBundle`), so the SDK's
 * validator runs the same code in Node; this file keeps the Worker's own parts (the message
 * handler, the cached shim, the lazy meter, the transfer) and every refusal now carries its rule.
 */
import { compactAbi } from '../abi/layout';
import { buildEstShim } from '../runtime/shim';
import { EstBundleError, inspectWasm, sha256Hex, wasiTypeRefusal } from './bundle';
import { isMetered } from './fuel';
import { checkBundle, type InstallCheckDeps } from './pipeline';
import type { EstInstallRefusal, WorkerReply, WorkerRequest } from './workerProtocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

class Refusal extends Error {
  constructor(readonly code: EstInstallRefusal, message: string, readonly rule: string | null = null) { super(message); }
}

let shim: Promise<WebAssembly.Module> | null = null;
const hostShim = () => (shim ??= WebAssembly.compile(buildEstShim(compactAbi().sig)));
const now = () => performance.now();

const deps: InstallCheckDeps = {
  loadMeter: async () => (await import('./estMeter')).meter,
  compile: bytes => WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>),
  shim: hostShim,
  now,
};

async function install(m: Extract<WorkerRequest, { type: 'install' }>): Promise<{ reply: WorkerReply; transfer: Transferable[] }> {
  const r = await checkBundle(new Uint8Array(m.bytes), { expectHash: m.expectHash, seconds: m.seconds }, deps);
  if (!r.ok) throw new Refusal(r.code, r.message, r.rule);
  const { bundle, metered, points, module, shim: shimModule, report, timings } = r;
  const meteredSha256 = await sha256Hex(metered);
  const buf = metered.buffer.byteLength === metered.byteLength && metered.byteOffset === 0
    ? metered.buffer as ArrayBuffer
    : metered.slice().buffer as ArrayBuffer;
  return {
    reply: {
      type: 'installed', id: m.id, hash: bundle.hash, bytes: bundle.bytes, manifest: bundle.manifest, info: bundle.info,
      metered: buf, meteredSha256, points, module, shim: shimModule, report, timings,
    },
    transfer: [buf],
  };
}

async function compile(m: Extract<WorkerRequest, { type: 'compile' }>): Promise<WorkerReply> {
  const t0 = now();
  const bytes = new Uint8Array(m.bytes);
  if (await sha256Hex(bytes) !== m.sha256) throw new Refusal('hash', 'the stored module does not match its record');
  // 1.314 (EST-02): the WASI imports' types, checked again on the bytes every boot runs (the install
  // checked them on the bundle's module; the processor cannot read types from a compiled Module).
  const typed = wasiTypeRefusal(inspectWasm(bytes));
  if (typed) throw new Refusal('module', typed.message, typed.rule);
  const [module, shimModule] = await Promise.all([WebAssembly.compile(bytes), hostShim()]);
  if (!isMetered(module)) throw new Refusal('module', 'the stored module is not metered');
  return { type: 'compiled', id: m.id, module, shim: shimModule, compileMs: now() - t0 };
}

scope.onmessage = (e: MessageEvent) => {
  const m = e.data as WorkerRequest;
  if (!m || typeof m !== 'object' || typeof m.id !== 'number') return;
  const run = m.type === 'install' ? install(m) : m.type === 'compile' ? compile(m).then(reply => ({ reply, transfer: [] as Transferable[] })) : null;
  if (!run) return;
  run.then(({ reply, transfer }) => {
    // 1.286 (ET-C, D-32): a browser that will not pass a compiled `WebAssembly.Module` to the page
    // throws here (a DataCloneError). Said as a refusal, so the page reports the browser's own words
    // rather than waiting out its timeout (D-27's Worker route needs that transfer).
    try {
      scope.postMessage(reply, transfer);
    } catch (err) {
      const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      scope.postMessage({ type: 'refused', id: m.id, code: 'worker', message: `this browser would not pass the compiled module to the page (${why})`, rule: null } satisfies WorkerReply);
    }
  }, (err: unknown) => {
    const code: EstInstallRefusal = err instanceof EstBundleError || err instanceof Refusal ? err.code : 'worker';
    const rule = err instanceof EstBundleError || err instanceof Refusal ? err.rule : null;
    const message = err instanceof Error ? err.message : String(err);
    scope.postMessage({ type: 'refused', id: m.id, code, message, rule } satisfies WorkerReply);
  });
};
