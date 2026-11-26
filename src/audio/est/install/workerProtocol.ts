/**
 * EST Phase 2 (2-D): the messages between the page (`workerClient.ts`) and the compiling Worker
 * (`estWorker.ts`). Types only.
 */
import type { EstManifestInfo } from '../library';
import type { EstBundleRefusal, EstManifest } from './bundle';
import type { ConformanceReport } from './conformance';
import type { AddCheckId, AddCheckReport } from '../review/addChecks';

/** Why an install or a compile failed: a bundle refusal, or the pipeline's own. */
export type EstInstallRefusal = EstBundleRefusal | 'conformance' | 'kind' | 'timeout' | 'worker' | 'storage' | 'network';

export type WorkerRequest =
  /** Validate, meter, compile and run a bundle (an install). */
  | { type: 'install'; id: number; bytes: ArrayBuffer; expectHash: string | null; seconds?: number }
  /** Compile an installed module's stored metered bytes (re-hashed first). */
  | { type: 'compile'; id: number; bytes: ArrayBuffer; sha256: string }
  /**
   * 1.914: the add-time checks (`review/addChecks.ts`) on a bundle the install pipeline already passed:
   * read, metered and compiled here again (nothing stored, nothing sent back but the report), then played
   * for at most `budgetMs`. `expectHash`: the bundle the library holds (another is refused).
   */
  | {
      type: 'checks'; id: number; bytes: ArrayBuffer; expectHash: string | null; budgetMs?: number;
      /** Only these checks (a second look at one). */
      only?: AddCheckId[];
      /** The same module built with its functions' names kept (a build made here): what the profile reads its names from. Never run for sound. */
      named?: ArrayBuffer;
    };

export interface InstallTimings { readMs: number; meterMs: number; compileMs: number; conformanceMs: number }

export type WorkerReply =
  | {
      type: 'installed'; id: number; hash: string; bytes: number; manifest: EstManifest; info: EstManifestInfo;
      /** The metered module's bytes (what the store keeps) and their SHA-256. */
      metered: ArrayBuffer; meteredSha256: string; points: number;
      module: WebAssembly.Module; shim: WebAssembly.Module; report: ConformanceReport; timings: InstallTimings;
    }
  | { type: 'compiled'; id: number; module: WebAssembly.Module; shim: WebAssembly.Module; compileMs: number }
  /** 1.914: the add-time checks' report (facts with numbers; the words are `review/addCheckWords.ts`'). */
  | { type: 'checked'; id: number; hash: string; report: AddCheckReport }
  /** `rule`: the validator's rule (`rules.ts`, EST Phase 4), null for a fault that is not the plugin's. */
  | { type: 'refused'; id: number; code: EstInstallRefusal; message: string; rule?: string | null };
