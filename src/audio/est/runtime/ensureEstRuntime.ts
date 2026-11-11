/**
 * EST Phase 1 (docs/est/EST_Phase1_Work_Order.md §1.3): registers the `est-plugin` processor on a
 * context as **a second Blob module**, apart from Cyber's own (`worklets.ts`'s `ensureWorklets`
 * is untouched and never loads this). Idempotent per context and coalesced, like `ensureWorklets`;
 * a failed registration may be tried again.
 */

import { compactAbi } from '../abi/layout';
import { estProcessorSource } from './estProcessor';
import { buildEstShim } from './shim';

let source: string | null = null;
let url: string | null = null;
const registered = new WeakSet<BaseAudioContext>();
const pending = new WeakMap<BaseAudioContext, Promise<void>>();

/** The module text (also what `scripts/check-worklets.mjs` checks in the build). */
export function getEstRuntimeSource(): string {
  return (source ??= estProcessorSource(compactAbi(), buildEstShim));
}

export function estRuntimeReady(ctx: BaseAudioContext): boolean {
  return registered.has(ctx);
}

export async function ensureEstRuntime(ctx: BaseAudioContext): Promise<void> {
  if (registered.has(ctx)) return;
  let p = pending.get(ctx);
  if (!p) {
    // Kept for the page's life, like worklets.ts's URL: a context made later reuses it.
    url ??= URL.createObjectURL(new Blob([getEstRuntimeSource()], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { registered.add(ctx); })
      .catch((err: unknown) => { pending.delete(ctx); throw err; });
    pending.set(ctx, p);
  }
  await p;
}
