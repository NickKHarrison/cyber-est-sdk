/**
 * EST Phase 2 (2-D): the page's side of the compiling Worker (`estWorker.ts`). The page makes the
 * Worker, sends it one request at a time, and **terminates it when it has not answered in time**
 * (EST_SECURITY_ARCHITECTURE.md §5.3 and §6.1: the one thing a page can do to code that never
 * returns). An install (or a run of them, `installSession`) gets a Worker of its own, ended when
 * it is done (the meter's Binaryen is large, a few seconds to load, and needed only then);
 * compiles share one Worker, ended after a minute idle.
 *
 * Phase 1 found that Chromium frees a busy Worker's thread about 2 s after `terminate()`, so after
 * a timeout the next Worker starts no sooner than `TERMINATE_GRACE_MS` later.
 */
import type { EstInstallRefusal, WorkerReply, WorkerRequest } from './workerProtocol';

export const INSTALL_TIMEOUT_MS = 30_000;
export const COMPILE_TIMEOUT_MS = 15_000;
export const TERMINATE_GRACE_MS = 2_000;
const COMPILER_IDLE_MS = 60_000;

export class EstWorkerError extends Error {
  readonly code: EstInstallRefusal;
  /** EST Phase 4: the validator's rule (`rules.ts`), null when the fault is not the plugin's. */
  readonly rule: string | null;
  constructor(code: EstInstallRefusal, message: string, rule: string | null = null) {
    super(message);
    this.name = 'EstWorkerError';
    this.code = code;
    this.rule = rule;
  }
}

/** Something that behaves like a Worker (the tests' fake). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent | Event) => void) | null;
  /** A reply the page could not deserialise (1.286, ET-C); the tests' fake may leave it out. */
  onmessageerror?: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** The compiling Worker (Vite builds it as `assets/estWorker-<hash>.js`, the name the server's policy matches). */
const realWorker = (): WorkerLike => new Worker(new URL('./estWorker.ts', import.meta.url), { type: 'module', name: 'est-compiler' }) as unknown as WorkerLike;
let makeWorker: () => WorkerLike = realWorker;
/** Tests: stand a fake in for the Worker (null restores the real one). */
export function setEstWorkerFactory(f: (() => WorkerLike) | null) {
  makeWorker = f ?? realWorker;
  compiler?.worker.terminate();
  compiler = null;
}

let nextId = 1;
let coolUntil = 0;
let compiler: { worker: WorkerLike; idle: ReturnType<typeof setTimeout> | null; busy: number } | null = null;
/** How many Workers were terminated at a timeout (the browser spec reads it). */
let timeouts = 0;
export const estWorkerTimeouts = () => timeouts;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function spawn(): Promise<WorkerLike> {
  const ms = coolUntil - Date.now();
  if (ms > 0) await wait(ms);
  return makeWorker();
}

type Request = WorkerRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never;

/** One request on `worker`; rejects with an `EstWorkerError`, terminating the Worker on a timeout. */
function ask(worker: WorkerLike, req: Request, transfer: Transferable[], timeoutMs: number, onTimeout: () => void): Promise<WorkerReply> {
  const id = nextId++;
  return new Promise<WorkerReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      timeouts++;
      coolUntil = Date.now() + TERMINATE_GRACE_MS;
      onTimeout();
      reject(new EstWorkerError('timeout', `the install Worker did not answer within ${Math.round(timeoutMs / 1000)} s and was stopped`));
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      const r = e.data as WorkerReply;
      if (!r || r.id !== id) return;
      clearTimeout(timer);
      if (r.type === 'refused') reject(new EstWorkerError(r.code, r.message, r.rule ?? null));
      else resolve(r);
    };
    worker.onerror = (e: ErrorEvent | Event) => {
      clearTimeout(timer);
      // A bare Event (no message) is a module Worker whose script or one of its imports did not
      // load (a refused import, ET-C), never a plugin's fault.
      const msg = 'message' in e && e.message ? String(e.message) : 'the install Worker could not start';
      reject(new EstWorkerError('worker', msg));
    };
    // 1.286 (ET-C, D-32): a reply this browser could not deserialise (a `WebAssembly.Module` it will
    // not take from a Worker) arrives as `messageerror`, never as a message: say so at once.
    worker.onmessageerror = () => {
      clearTimeout(timer);
      reject(new EstWorkerError('worker', "this browser could not read the install Worker's reply (a compiled module it will not take from a Worker)"));
    };
    worker.postMessage({ ...req, id }, transfer);
  });
}

export interface InstallRequest { expectHash?: string | null; timeoutMs?: number; seconds?: number }

/**
 * A run of installs in one Worker of their own (the meter's Binaryen loads once, a few seconds),
 * one at a time, each with its own timeout; a timeout ends the Worker and the next install makes
 * a new one. `close()` ends it.
 */
export function installSession() {
  let worker: WorkerLike | null = null;
  return {
    async install(bytes: ArrayBuffer, opts: InstallRequest = {}) {
      worker ??= await spawn();
      const w = worker;
      const r = await ask(w, { type: 'install', bytes, expectHash: opts.expectHash ?? null, seconds: opts.seconds }, [bytes], opts.timeoutMs ?? INSTALL_TIMEOUT_MS, () => { if (worker === w) worker = null; });
      if (r.type !== 'installed') throw new EstWorkerError('worker', `unexpected reply ${r.type}`);
      return r;
    },
    close() { worker?.terminate(); worker = null; },
  };
}

/** One install in a Worker of its own (ended when it answers or at its timeout). */
export async function installInWorker(bytes: ArrayBuffer, opts: InstallRequest = {}) {
  const s = installSession();
  try {
    return await s.install(bytes, opts);
  } finally {
    s.close();
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Compile stored metered bytes on the shared compiling Worker (one request at a time). */
export function compileInWorker(bytes: ArrayBuffer, sha256: string, timeoutMs = COMPILE_TIMEOUT_MS): Promise<Extract<WorkerReply, { type: 'compiled' }>> {
  const run = queue.then(() => compileNow(bytes, sha256, timeoutMs));
  queue = run.catch(() => {});
  return run;
}

async function compileNow(bytes: ArrayBuffer, sha256: string, timeoutMs: number) {
  if (!compiler) compiler = { worker: await spawn(), idle: null, busy: 0 };
  const c = compiler;
  if (c.idle) { clearTimeout(c.idle); c.idle = null; }
  c.busy++;
  try {
    const r = await ask(c.worker, { type: 'compile', bytes, sha256 }, [bytes], timeoutMs, () => { if (compiler === c) compiler = null; });
    if (r.type !== 'compiled') throw new EstWorkerError('worker', `unexpected reply ${r.type}`);
    return r;
  } finally {
    c.busy--;
    if (compiler === c && c.busy === 0) {
      c.idle = setTimeout(() => { if (compiler === c && c.busy === 0) { c.worker.terminate(); compiler = null; } }, COMPILER_IDLE_MS);
    }
  }
}
