/**
 * @cyber-est/tools: `render` and golden renders (EST Phase 4; 4-B's templates' golden-render tests and
 * `est test`). A bundle is read, metered and compiled exactly as at install (`checkBundle`'s first
 * stages are not repeated here: `render` uses the same reader, meter and shim), then run on the
 * conformance run's stand-in audio thread (`standInInstance`, the real `est-plugin` processor) with
 * a chosen input and events, block by block.
 *
 * `render(bytes, spec)` is a free render (an input of silence, an impulse, a sine or seeded noise,
 * and the processor's own events, `time` in seconds from the start), the output as two channels.
 *
 * A **golden** render is 4-B's format, one for the whole kit (`est test`, the templates' tests):
 * `test/golden.json` (`GoldenSpec`: the sample rate, the length in frames, the input, the events,
 * the tolerance, the stored render's file) beside its render (little-endian float32, the left
 * channel's frames then the right's), played by `sdk/testing/golden.ts`; `renderGoldenBundle`
 * plays one from a bundle's bytes.
 */
import { readBundle } from '../../../../src/audio/est/install/bundle';
import { standInInstance } from '../../../../src/audio/est/install/conformance';
import { isMetered } from '../../../../src/audio/est/install/fuel';
import { renderGoldenFull, type GoldenNote, type GoldenSpec } from '../../../testing/golden';
import { hostShim, loadMeter } from './host';

const FRAMES = 128;

export type RenderInput =
  | { kind: 'silence' }
  | { kind: 'impulse'; amp?: number }
  | { kind: 'sine'; freq?: number; amp?: number }
  | { kind: 'noise'; amp?: number; seed?: number }
  /** Given samples (`est compare --input <file.wav>`): frames past their end are silence. */
  | { kind: 'samples'; left: Float32Array; right: Float32Array };

export interface RenderEvent { type: string; time?: number; [k: string]: unknown }

export interface RenderSpec {
  seconds?: number;
  sampleRate?: number;
  input?: RenderInput;
  events?: RenderEvent[];
  tolerance?: number;
}

export interface Rendered {
  sampleRate: number;
  frames: number;
  left: Float32Array;
  right: Float32Array;
  /** Whether the plugin stopped (a trap or an error), and how. */
  error: string | null;
}

function fill(input: RenderInput, l: Float32Array, r: Float32Array, start: number, sr: number, rng: () => number) {
  for (let i = 0; i < l.length; i++) {
    const t = start + i;
    let v = 0;
    if (input.kind === 'impulse') v = t === 0 ? (input.amp ?? 1) : 0;
    else if (input.kind === 'sine') v = (input.amp ?? 0.5) * Math.sin((2 * Math.PI * (input.freq ?? 440) * t) / sr);
    else if (input.kind === 'noise') v = (input.amp ?? 0.25) * (rng() * 2 - 1);
    else if (input.kind === 'samples') { l[i] = input.left[t] ?? 0; r[i] = input.right[t] ?? 0; continue; }
    l[i] = v;
    r[i] = v;
  }
}

const rngOf = (input: RenderInput) => {
  let seed = (input.kind === 'noise' ? input.seed ?? 1 : 1) >>> 0 || 1;
  return () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
};

/** The input `render` feeds a plugin, `frames` long (`est compare --write-input`: the same samples). */
export function inputSamples(input: RenderInput, frames: number, sampleRate: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const rng = rngOf(input);
  const l = new Float32Array(FRAMES), r = new Float32Array(FRAMES);
  for (let at = 0; at < frames; at += FRAMES) {
    fill(input, l, r, at, sampleRate, rng);
    const n = Math.min(FRAMES, frames - at);
    left.set(l.subarray(0, n), at);
    right.set(r.subarray(0, n), at);
  }
  return { left, right };
}

/** Render a bundle (`.est` bytes) under `spec`. */
export async function render(bytes: Uint8Array, spec: RenderSpec = {}): Promise<Rendered> {
  const bundle = await readBundle(bytes);
  const meter = await loadMeter();
  const metered = meter(bundle.module, { mode: 'local' });
  const module = await WebAssembly.compile(metered.bytes as Uint8Array<ArrayBuffer>);
  if (!isMetered(module)) throw new Error('the metered module lost its fuel exports');
  const shim = await hostShim();
  const sr = spec.sampleRate ?? 48000;
  const frames = Math.round((spec.seconds ?? 1) * sr);
  const inst = standInInstance({ module, shim, manifest: bundle.manifest }, sr);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const err = inst.boot.find(m => m.type === 'error');
  if (!inst.boot.some(m => m.type === 'ready')) return { sampleRate: sr, frames, left, right, error: err ? `${String(err.phase)}: ${String(err.message)}` : 'it did not start' };
  if (spec.events?.length) inst.send({ type: 'events', events: spec.events.map(e => ({ time: 0, ...e })) });
  const rng = rngOf(spec.input ?? { kind: 'silence' });
  const inL = new Float32Array(FRAMES), inR = new Float32Array(FRAMES);
  const input = spec.input ?? { kind: 'silence' };
  let error: string | null = null;
  for (let at = 0; at < frames; at += FRAMES) {
    fill(input, inL, inR, at, sr, rng);
    const { out, posted } = inst.block(inL, inR, at);
    const e = posted.find(m => m.type === 'error');
    if (e) { error = `frame ${at}: ${String(e.phase)}: ${String(e.message)}`; break; }
    const n = Math.min(FRAMES, frames - at);
    left.set(out[0].subarray(0, n), at);
    right.set(out[1].subarray(0, n), at);
  }
  inst.send({ type: 'dispose' });
  return { sampleRate: sr, frames, left, right, error };
}

/**
 * A template's golden render (4-B's format, the one `est test` runs: `test/golden.json` and its
 * stored render, planar little-endian float32; `sdk/testing/golden.ts`) of a bundle, read and
 * metered as at install.
 */
export async function renderGoldenBundle(bytes: Uint8Array, spec: GoldenSpec): Promise<Float32Array> {
  return (await renderGoldenBundleFull(bytes, spec)).audio;
}

/** The golden render and (DEV-F, 1.321) the notes a note effect sent. */
export async function renderGoldenBundleFull(bytes: Uint8Array, spec: GoldenSpec): Promise<{ audio: Float32Array; notes: GoldenNote[] }> {
  const bundle = await readBundle(bytes);
  const meter = await loadMeter();
  const module = await WebAssembly.compile(meter(bundle.module, { mode: 'local' }).bytes as Uint8Array<ArrayBuffer>);
  if (!isMetered(module)) throw new Error('the metered module lost its fuel exports');
  return renderGoldenFull(module, bundle.manifest, spec);
}
