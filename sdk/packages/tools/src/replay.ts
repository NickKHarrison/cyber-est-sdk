/**
 * @cyber-est/tools: `replay` (1.669; `est replay <bundle> <capture>`, sdk/docs/dev-host.md "Replaying
 * a crash"). A crash capture (src/audio/est/crashCapture.ts: the last blocks a plugin was given before
 * it trapped in Cyber, saved by a developer from the plugin's card or Diagnostics) played again on
 * the conformance run's stand-in audio thread (the real `est-plugin` processor), block by block, the
 * events at their frames, until the plugin traps or the capture ends.
 *
 * The module is metered as at install, with the profiling meter's counters (`meter(…, { profile:
 * true })`: they cost no fuel, so the run is the installed one's), which also gives every function's
 * index and name. The trap's own stack (V8's, from the error the processor caught) names the
 * function it happened in: by the module's name section when the build kept one (`est replay
 * --debug` builds the folder once more with names, as `est profile --debug` does), else by index.
 */
import { readBundle } from '../../../../src/audio/est/install/bundle';
import { standInInstance } from '../../../../src/audio/est/install/conformance';
import type { EstParam } from '../../../../src/audio/est/EstNode';
import { replayBlocks, type EstCapture } from '../../../../src/audio/est/crashCapture';
import { demangle } from './profile';
import { hostShim } from './host';

export interface ReplayFrame {
  /** The function's index in the module (imports first). */
  index: number;
  /** Its name from the module's name section (a Rust symbol demangled), or null. */
  name: string | null;
  /** The code offset V8 reported, when it did. */
  offset: string | null;
}

export interface ReplayReport {
  id: string;
  version: string;
  /** What the capture says happened in Cyber. */
  captured: { phase: string; message: string; block: number | null };
  /** Blocks played (up to and with the one that trapped). */
  blocks: number;
  /** Whether the plugin trapped (or faulted) in the replay. */
  trapped: boolean;
  /** The captured block number it faulted in, and the fault's phase and message. */
  block: number | null;
  phase: string | null;
  message: string | null;
  /** The innermost function of the plugin's own code in the trap's stack, and the whole wasm stack, innermost first. */
  function: ReplayFrame | null;
  stack: ReplayFrame[];
  /** Whether it faulted in the same block with the same message as in Cyber. */
  same: boolean;
  /** Whether the bundle is the one the capture names (its id and version; its hash when the capture has one). */
  bundleMatches: { id: boolean; version: boolean; hash: boolean | null };
}

/** V8's wasm frames: `at name (wasm://wasm/<id>:wasm-function[<index>]:0x<offset>)` or the same without a name. */
const WASM_FRAME = /at (?:(.+?) \()?wasm:\/\/wasm\/[^\s:]*:wasm-function\[(\d+)\]:(0x[0-9a-f]+)\)?/;

/** The wasm frames of an error's stack, innermost first, named from `names` (by index) or V8's own name. */
export function wasmFrames(stack: string, names: ReadonlyMap<number, string | null>): ReplayFrame[] {
  const out: ReplayFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = WASM_FRAME.exec(line);
    if (!m) continue;
    const index = Number(m[2]);
    const own = names.get(index) ?? null;
    // V8 prints `$name` for some names, and its own `wasm-function[n]` text when there is none.
    const v8 = m[1] && !/^wasm-function\[/.test(m[1]) ? m[1].replace(/^\$/, '').replace(/^.*?\./, s => (/^\d+\.$/.test(s) ? '' : s)) : null;
    const name = own ?? v8;
    out.push({ index, name: name ? demangle(name) : null, offset: m[3] ?? null });
  }
  return out;
}

/** Replay `capture` on the bundle's plugin (`.est` bytes). */
export async function replay(bytes: Uint8Array, capture: EstCapture): Promise<ReplayReport> {
  const bundle = await readBundle(bytes);
  const { meter } = await import('../../../../src/audio/est/install/estMeter');
  const shim = await hostShim();
  const manifest = bundle.manifest;
  const metered = meter(bundle.module, { mode: 'local', profile: true });
  const module = await WebAssembly.compile(metered.bytes as Uint8Array<ArrayBuffer>);
  const names = new Map<number, string | null>((metered.profile?.functions ?? []).map(f => [f.index, f.name]));

  const plan0 = capture.blocks;
  const queueSize = 256 + plan0.reduce((s, b) => s + b.events.length + 2, 0) + capture.params.length;
  const inst = standInInstance({ module, shim, manifest }, capture.sampleRate, { queueSize });
  // The processor catches the trap and posts its message only; its stack names the function.
  let caught: unknown = null;
  const proc = inst.proc as unknown as { fail(phase: string, err: unknown): void };
  const fail = proc.fail.bind(proc);
  proc.fail = (phase, err) => { if (caught === null) caught = err; fail(phase, err); };

  const report: ReplayReport = {
    id: manifest.id, version: manifest.version, captured: { ...capture.trap }, blocks: 0, trapped: false, block: null, phase: null, message: null,
    function: null, stack: [], same: false,
    bundleMatches: { id: manifest.id === capture.plugin.id, version: manifest.version === capture.plugin.version, hash: capture.plugin.hash ? capture.plugin.hash === bundle.hash : null },
  };
  const boot = inst.boot.find(m => m.type === 'error');
  if (!inst.boot.some(m => m.type === 'ready')) {
    report.trapped = true;
    report.phase = boot ? String(boot.phase) : 'boot';
    report.message = boot ? String(boot.message) : 'it did not start';
  } else {
    const ready = inst.boot.find(m => m.type === 'ready')!;
    const defaults = new Map(((ready.params as EstParam[] | undefined) ?? []).map(p => [p.id, p.value ?? p.def]));
    const zeros = new Float32Array(128);
    for (const b of replayBlocks(capture, defaults)) {
      if (b.events.length) inst.send({ type: 'events', events: b.events });
      const blank = b.frames === zeros.length ? zeros : new Float32Array(b.frames);
      const { posted } = inst.block(b.input[0] ?? blank, b.input[1] ?? b.input[0] ?? blank, b.frame, { inputs: b.input, key: b.key });
      report.blocks++;
      const e = posted.find(m => m.type === 'error');
      if (e) {
        report.trapped = true;
        report.block = b.block;
        report.phase = String(e.phase);
        report.message = String(e.message);
        break;
      }
    }
  }
  inst.send({ type: 'dispose' });
  const stack = caught instanceof Error && typeof caught.stack === 'string' ? caught.stack : '';
  report.stack = wasmFrames(stack, names);
  report.function = report.stack[0] ?? null;
  report.same = report.trapped && report.block === capture.trap.block && report.message === capture.trap.message;
  return report;
}

/** A frame's label: its name, else its index. */
export const frameLabel = (f: ReplayFrame): string => f.name ?? `function ${f.index}`;

/** The report as `est replay` prints it. */
export function formatReplay(r: ReplayReport): string {
  const lines = [
    `est replay: ${r.id} ${r.version}`,
    `The capture: ${r.captured.phase === 'process' ? 'a trap' : `a fault in ${r.captured.phase}`} in block ${r.captured.block ?? '(unknown)'}: ${r.captured.message}`,
  ];
  if (!r.bundleMatches.id) lines.push('Warning: the capture is of another plugin; the replay is of this bundle all the same.');
  else if (!r.bundleMatches.version) lines.push('Warning: the capture is of another version of this plugin.');
  else if (r.bundleMatches.hash === false) lines.push('Note: this bundle is not the exact build the capture was made with (a --debug build never is).');
  lines.push('');
  if (!r.trapped) {
    lines.push(`It did not trap in the ${r.blocks} captured block${r.blocks === 1 ? '' : 's'}.`,
      'The replay starts from a fresh instance with the captured parameters: a crash that depends on what the plugin heard earlier (a delay line, a voice) needs more blocks kept, or the state the project held.');
    return lines.join('\n');
  }
  lines.push(`It ${r.phase === 'process' ? 'trapped' : `faulted in ${r.phase}`} in block ${r.block ?? '(before the first)'} (after ${r.blocks} block${r.blocks === 1 ? '' : 's'} of the replay): ${r.message}`);
  lines.push(r.same ? 'The same block and message as in Cyber.' : 'Not the same block or message as in Cyber: compare the two.');
  if (r.function) {
    lines.push('', `The trapping function: ${frameLabel(r.function)}${r.function.offset ? ` (at ${r.function.offset})` : ''}`);
    if (r.stack.length > 1) {
      lines.push('Its callers, innermost first:');
      for (const f of r.stack.slice(1, 12)) lines.push(`  ${frameLabel(f)}`);
    }
    if (!r.stack.some(f => f.name)) lines.push('', 'The module has no name section, so functions show by index: run est replay --debug on the plugin\'s folder to build it once more with names (or keep them yourself: asc --debug; Rust: strip = false; clang: no --strip-all, -g).');
  } else lines.push('', 'The fault named no function of the plugin\'s (a host check stopped it, not a trap in its code).');
  return lines.join('\n');
}
