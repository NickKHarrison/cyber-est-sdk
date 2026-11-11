/**
 * EST Phase 4 (4-B, docs/est/EST_Phase4_Work_Order.md §2): a template's golden render. A template
 * carries `test/golden.json` (what to play: the sample rate, the length, the input and the events)
 * and `test/golden.f32` (what it must sound like: little-endian float32, the left channel's frames
 * then the right's). `renderGolden` plays the spec through the plugin on Cyber's own host code (the
 * Phase 1 processor on the conformance run's stand-in audio thread, `standInInstance`: the module
 * metered as at install), so a golden is what Cyber would play; `compareGolden` says how far a
 * render is from the stored one. `est test` (4-A's `@cyber-est/tools`) runs exactly this.
 *
 * The input is computed with integer arithmetic only (an xorshift noise and a square), so it is the
 * same bits on every machine and engine.
 */
import { compactAbi } from '../../src/audio/est/abi/layout';
import type { EstEvent } from '../../src/audio/est/EstNode';
import { standInInstance } from '../../src/audio/est/install/conformance';
import type { EstManifest } from '../../src/audio/est/install/bundle';
import { buildEstShim } from '../../src/audio/est/runtime/shim';

const FRAMES = 128;

export interface GoldenSpec {
  sampleRate: number;
  /** The render's length in frames (a multiple of 128). */
  frames: number;
  /** An effect's input ('noise': `level` × (½ noise + ½ a 110 Hz square)); an instrument's is silence. */
  input: { kind: 'noise' | 'none'; seed?: number; level?: number };
  /** The events, as Cyber's processor takes them (`time` in seconds from the start). */
  events: EstEvent[];
  /** The largest difference allowed from the stored render, per sample. */
  tolerance: number;
  /** The stored render beside the spec. */
  render: string;
  /**
   * DEV-F (1.321): a note effect's stored notes beside the spec (`golden-notes.json`: what it
   * sends, each `{ type, frame, key, channel, velocity }`), compared exactly. Absent: none checked.
   */
  notes?: string;
}

/** One note a plugin sent in a golden render (`frame` from the render's start). */
export interface GoldenNote { type: 'noteOn' | 'noteOff' | 'choke'; frame: number; key: number; channel: number; velocity: number }

let shim: WebAssembly.Module | null = null;
/** The host's shim module (built once). */
export function estShim(): WebAssembly.Module {
  shim ??= new WebAssembly.Module(buildEstShim(compactAbi().sig) as BufferSource);
  return shim;
}

/** Channel `c`'s input, frames `from`…`from + n`, for a spec (exact: integers and powers of two only). */
export function goldenInput(spec: GoldenSpec, c: number, from: number, n: number): Float32Array {
  const out = new Float32Array(n);
  if (spec.input.kind !== 'noise') return out;
  const level = spec.input.level ?? 0.5;
  const half = Math.round(spec.sampleRate / 220);
  // The noise is the same sequence for any block size: frame f's value is the xorshift's f-th step.
  let s = ((spec.input.seed ?? 1) * 0x9e3779b1 + c * 0x85ebca6b) >>> 0 || 1;
  for (let f = 0; f < from; f++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; }
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const noise = (s >>> 8) / 8388608 - 1; // −1 … 1 in steps of 2⁻²³
    const square = Math.floor((from + i) / half) % 2 ? -1 : 1;
    out[i] = level * (0.5 * noise + 0.5 * square);
  }
  return out;
}

/** Play `spec` through the plugin: the render, planar (left frames, then right). */
export function renderGolden(module: WebAssembly.Module, manifest: Pick<EstManifest, 'id' | 'kind' | 'audio' | 'limits' | 'parameters'>, spec: GoldenSpec): Float32Array {
  return renderGoldenFull(module, manifest, spec).audio;
}

/** Play `spec` through the plugin: the render and (DEV-F, 1.321) the notes it sent, in order. */
export function renderGoldenFull(module: WebAssembly.Module, manifest: Pick<EstManifest, 'id' | 'kind' | 'audio' | 'limits' | 'parameters'>, spec: GoldenSpec): { audio: Float32Array; notes: GoldenNote[] } {
  if (spec.frames % FRAMES) throw new Error(`a golden render's length is a multiple of ${FRAMES} frames`);
  const inst = standInInstance({ module, shim: estShim(), manifest }, spec.sampleRate);
  const ready = inst.boot.find(m => m.type === 'ready');
  if (!ready) {
    const err = inst.boot.find(m => m.type === 'error');
    throw new Error(`the plugin did not start${err ? ` (${String(err.phase)}: ${String(err.message)})` : ''}`);
  }
  const notes: GoldenNote[] = [];
  const take = (posted: { type?: unknown; [k: string]: unknown }[], f: number) => {
    for (const m of posted) {
      if (m.type !== 'notes') continue;
      if (Number(m.dropped)) throw new Error(`the plugin sent more notes than the host keeps between posts, by frame ${f}`);
      for (const n of m.notes as GoldenNote[]) notes.push({ type: n.type, frame: n.frame, key: n.key, channel: n.channel, velocity: n.velocity });
    }
  };
  inst.send({ type: 'notes:on' }); // the processor keeps a note effect's notes only while asked (DEV-F)
  if (spec.events.length) inst.send({ type: 'events', events: spec.events });
  const out = new Float32Array(spec.frames * 2);
  // The whole input, once (its noise is sequential).
  const inL = goldenInput(spec, 0, 0, spec.frames), inR = goldenInput(spec, 1, 0, spec.frames);
  for (let f = 0; f < spec.frames; f += FRAMES) {
    const { out: o, posted } = inst.block(inL.slice(f, f + FRAMES), inR.slice(f, f + FRAMES), f);
    const err = posted.find(m => m.type === 'error');
    if (err) throw new Error(`the plugin stopped at frame ${f} (${String(err.phase)}: ${String(err.message)})`);
    take(posted, f);
    out.set(o[0], f);
    out.set(o[1], spec.frames + f);
  }
  take(inst.send({ type: 'notes:flush' }), spec.frames);
  inst.send({ type: 'dispose' });
  return { audio: out, notes };
}

/** A note list as the stored file's text: one note a line. */
export function notesJson(notes: readonly GoldenNote[]): string {
  return notes.length ? `[\n${notes.map(n => ` ${JSON.stringify(n)}`).join(',\n')}\n]\n` : '[]\n';
}

/** The first difference between two note lists, worded, or null when they are the same. */
export function compareNotes(a: readonly GoldenNote[], b: readonly GoldenNote[]): string | null {
  const n = Math.max(a.length, b.length);
  const say = (x: GoldenNote | undefined) => (x ? `${x.type} key ${x.key} at frame ${x.frame} (velocity ${x.velocity})` : 'nothing');
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (!x || !y || x.type !== y.type || x.frame !== y.frame || x.key !== y.key || x.channel !== y.channel || Math.abs(x.velocity - y.velocity) > 1e-9) {
      return `note ${i + 1}: ${say(x)}, stored ${say(y)}`;
    }
  }
  return null;
}

/** The largest difference between two renders, and where it is (Infinity when their lengths differ). */
export function compareGolden(a: Float32Array, b: Float32Array): { maxDiff: number; at: number } {
  if (a.length !== b.length) return { maxDiff: Infinity, at: -1 };
  let maxDiff = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (!(d <= maxDiff)) { maxDiff = d; at = i; }
  }
  return { maxDiff, at };
}

/** A render as the stored file's bytes (little-endian float32). */
export function goldenBytes(render: Float32Array): Uint8Array {
  const b = new Uint8Array(render.length * 4);
  const v = new DataView(b.buffer);
  render.forEach((x, i) => v.setFloat32(i * 4, x, true));
  return b;
}

/** The stored file's bytes as a render. */
export function goldenFromBytes(bytes: Uint8Array): Float32Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => v.getFloat32(i * 4, true));
}
