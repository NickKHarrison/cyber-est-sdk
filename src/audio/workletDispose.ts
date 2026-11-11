/**
 * Review 1.36 A-9: a processor lives until its context closes unless it is told to stop. Every
 * Cyber processor (`cyber-limiter`, `cyber-compressor`, `cyber-guard`, `cyber-synth`,
 * `cyber-recorder`, `cyber-wave`, `cyber-fm`, `cyber-mic-recorder`, `cyber-saturator` and, since
 * 1.311, `cyber-bitcrusher`) handles `{ type: 'dispose' }`
 * by returning false from `process()` from then on, so the audio thread lets it go.
 *
 * `disposeWorkletNode` posts that message and closes the node's port. Call it once the node is
 * disconnected and nothing will be posted to it again. Anything that is not a worklet node (a
 * plain gain standing in for a guard, the SAMPLER's or the Drum Rack's look-alike port, a test's
 * fake) is left alone, or gets the message harmlessly.
 */

export const DISPOSE_MESSAGE = { type: 'dispose' } as const;

/** Something with a worklet-like port (an AudioWorkletNode, a drum voice pad's node, a fake). */
interface PortLike { postMessage(m: unknown): void; close?(): void }

export function disposeWorkletNode(node: unknown): void {
  if (!node || typeof node !== 'object' || !('port' in node)) return;
  const port = (node as { port?: PortLike | null }).port;
  if (!port || typeof port.postMessage !== 'function') return;
  try { port.postMessage(DISPOSE_MESSAGE); } catch { /* the port is closed already */ }
  try { port.close?.(); } catch { /* gone */ }
}
