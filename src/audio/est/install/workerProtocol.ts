/**
 * EST Phase 2 (2-D): the messages between the page (`workerClient.ts`) and the compiling Worker
 * (`estWorker.ts`). Types only.
 */
import type { EstManifestInfo } from '../library';
import type { EstBundleRefusal, EstManifest } from './bundle';
import type { ConformanceReport } from './conformance';

/** Why an install or a compile failed: a bundle refusal, or the pipeline's own. */
export type EstInstallRefusal = EstBundleRefusal | 'conformance' | 'kind' | 'timeout' | 'worker' | 'storage' | 'network';

export type WorkerRequest =
  /** Validate, meter, compile and run a bundle (an install). */
  | { type: 'install'; id: number; bytes: ArrayBuffer; expectHash: string | null; seconds?: number }
  /** Compile an installed module's stored metered bytes (re-hashed first). */
  | { type: 'compile'; id: number; bytes: ArrayBuffer; sha256: string };

export interface InstallTimings { readMs: number; meterMs: number; compileMs: number; conformanceMs: number }

export type WorkerReply =
  | {
      type: 'installed'; id: number; hash: string; bytes: number; manifest: EstManifest; info: EstManifestInfo;
      /** The metered module's bytes (what the store keeps) and their SHA-256. */
      metered: ArrayBuffer; meteredSha256: string; points: number;
      module: WebAssembly.Module; shim: WebAssembly.Module; report: ConformanceReport; timings: InstallTimings;
    }
  | { type: 'compiled'; id: number; module: WebAssembly.Module; shim: WebAssembly.Module; compileMs: number }
  /** `rule`: the validator's rule (`rules.ts`, EST Phase 4), null for a fault that is not the plugin's. */
  | { type: 'refused'; id: number; code: EstInstallRefusal; message: string; rule?: string | null };
