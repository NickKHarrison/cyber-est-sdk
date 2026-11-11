/**
 * @cyber-est/tools: `profile` (1.334, R-C; `est profile`, sdk/docs/dev-host.md "Profiling"). Where
 * a block's fuel goes, function by function.
 *
 * The bundle is read as at install and metered twice: once plainly (the module Cyber installs,
 * timed, its block fuel the processor's own count, `statPoints`), once with the **profiling meter**
 * (`meter(…, { profile: true })`, `install/estMeter.ts`): the same rewrite plus an i64 fuel counter
 * and call counter per function, which cost no fuel, so the profiled run spends exactly the plain
 * run's fuel and the counters sum to it (`fuelExact`). Both run on the conformance run's stand-in
 * audio thread (the real `est-plugin` processor), block by block, on the conformance run's signal
 * (or the plugin's golden spec, `test/golden.json`). The profiling build exists only here: nothing
 * stores or installs it, and the installer's meter refuses a module carrying its exports.
 *
 * The counters are read from the profiled instance: the processor makes it inside
 * `standInInstance`, so `WebAssembly.Instance` is wrapped for that one synchronous call to keep
 * the instance of the profiled module (the shim's is let through), and restored at once.
 */
import { readBundle, type EstManifest } from '../../../../src/audio/est/install/bundle';
import { instrumentEvents, standInInstance } from '../../../../src/audio/est/install/conformance';
import { isMetered } from '../../../../src/audio/est/install/fuel';
import { EST_BLOCK_BUDGET_US, estRule } from '../../../../src/audio/est/install/rules';
import type { EstParam } from '../../../../src/audio/est/EstNode';
import { goldenInput, type GoldenSpec } from '../../../testing/golden';
import { hostShim } from './host';

const FRAMES = 128;

export interface ProfileOptions {
  /** Seconds of the conformance run (default 10, as at install). Ignored with `golden`. */
  seconds?: number;
  /** Play the conformance run's notes into an effect too (an instrument always gets them). */
  notes?: boolean;
  /** Render this golden spec (`test/golden.json`) instead of the conformance signal. */
  golden?: GoldenSpec;
  /** The sample rate of the conformance signal (default 48000). */
  sampleRate?: number;
}

export interface ProfileRow {
  /** The function's index in the module (imports first). */
  index: number;
  /** Its name from the name section, or null when the build kept none. */
  name: string | null;
  /** The fuel it spent in the run's blocks (its own points: what it calls is counted on the callee). */
  fuel: number;
  /** Its share of all the fuel the blocks spent, 0 to 1. */
  share: number;
  /** Its mean fuel a block. */
  perBlock: number;
  /** How many times it was entered in the run's blocks. */
  calls: number;
  /** Its estimated part of the block's time on this machine, µs (its share of `blockUs`). */
  us: number;
}

export interface ProfileReport {
  id: string;
  version: string;
  kind: 'effect' | 'instrument';
  signal: 'conformance' | 'golden';
  sampleRate: number;
  blocks: number;
  /** The mean fuel of one block's `process()`, from the plain build: what the meter charges at install. */
  blockFuel: number;
  /** The mean time of one block of the plain build on this machine, µs (EST-P001's measure). */
  blockUs: number;
  budgetUs: number;
  /** Whether `blockUs` is over the budget (EST-P001 would warn). */
  over: boolean;
  /** The fuel the counters saw in the blocks (`process()`, and any `on_main_thread` or restart the blocks made). */
  totalFuel: number;
  /** Of it, the fuel outside `process()` (an `on_main_thread` callback, a restart). */
  otherFuel: number;
  /**
   * Whether the profiled build spent exactly the plain build's block fuel and the counters' sum
   * is it. False only for a plugin whose work depends on `random_get` or the clock.
   */
  fuelExact: boolean;
  /** Every function that spent fuel, the most first. */
  functions: ProfileRow[];
  /** Whether the plugin stopped (a trap or an error), and how; the table is up to there. */
  error: string | null;
}

type Instance = ReturnType<typeof standInInstance>;
interface Signal { frames: number; sr: number; events: Record<string, unknown>[][]; queueSize: number; fill(b: number, l: Float32Array, r: Float32Array): void }

/** The conformance run's signal, block for block as `conformance.ts`'s `render` plays it. */
function conformanceSignal(manifest: EstManifest, params: EstParam[], seconds: number, sr: number, notes: boolean): Signal {
  const blocks = Math.max(1, Math.ceil((seconds * sr) / FRAMES));
  const S = (blocks * FRAMES) / sr;
  const instrument = manifest.kind === 'instrument';
  const plan = instrument || notes ? instrumentEvents(S) : null;
  // Its sweep: the first 64 parameters to their min, max, middle and default (conformance's `sweepEvents`).
  const span = instrument ? 0.55 * 0.95 : 0.9;
  const swept = params.slice(0, 64);
  const sweep = swept.flatMap((p, k) => [p.min, p.max, (p.min + p.max) / 2, p.def].map((value, j) => (
    { type: 'param', time: ((k * 4 + j + 1) / (swept.length * 4 + 2)) * S * span, id: p.id, value })))
    .sort((a, b) => a.time - b.time).slice(0, 900);
  let seed = 0x9e3779b9;
  const rng = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  // An effect's test signal (conformance's `fillInput`): tones, noise bursts, silence and a click each second.
  const fillInput = (buf: Float32Array, b: number, c: number) => {
    const t0 = b * FRAMES;
    const phase = Math.floor(t0 / sr) % 4;
    for (let i = 0; i < FRAMES; i++) {
      const t = (t0 + i) / sr;
      let v = 0;
      if (phase === 0) v = 0.25 * Math.sin(2 * Math.PI * (c ? 330 : 220) * t);
      else if (phase === 1) v = 0.25 * (rng() * 2 - 1);
      else if (phase === 3) v = 0.5 * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 7040 * t);
      if ((t0 + i) % sr === 0) v = c ? -1 : 1;
      buf[i] = v;
    }
  };
  return {
    frames: blocks * FRAMES, sr,
    events: [sweep, ...(plan ? [plan.events as unknown as Record<string, unknown>[]] : []), [{ type: 'transport', tempo: 120, beat: 0, playing: true, num: 4, den: 4 }]],
    queueSize: 64 * 4 + (plan?.events.length ?? 0) + 256,
    fill(b, l, r) { if (instrument) return; fillInput(l, b, 0); fillInput(r, b, 1); },
  };
}

function goldenSignal(spec: GoldenSpec): Signal {
  if (spec.frames % FRAMES) throw new Error(`a golden render's length is a multiple of ${FRAMES} frames`);
  const inL = goldenInput(spec, 0, 0, spec.frames), inR = goldenInput(spec, 1, 0, spec.frames);
  return {
    frames: spec.frames, sr: spec.sampleRate,
    events: spec.events.length ? [spec.events as unknown as Record<string, unknown>[]] : [],
    queueSize: spec.events.length + 256,
    fill(b, l, r) { l.set(inL.subarray(b * FRAMES, b * FRAMES + FRAMES)); r.set(inR.subarray(b * FRAMES, b * FRAMES + FRAMES)); },
  };
}

/** `standInInstance`, keeping the `WebAssembly.Instance` the processor makes of `module`. */
function instanceKeeping(module: WebAssembly.Module, make: () => Instance): { inst: Instance; wasm: WebAssembly.Instance | null } {
  const W = WebAssembly as unknown as { Instance: typeof WebAssembly.Instance };
  const Original = W.Instance;
  let kept: WebAssembly.Instance | null = null;
  W.Instance = new Proxy(Original, {
    construct(target, args: [WebAssembly.Module, WebAssembly.Imports?]) {
      const made = Reflect.construct(target, args) as WebAssembly.Instance;
      if (args[0] === module) kept = made;
      return made;
    },
  });
  try { return { inst: make(), wasm: kept }; } finally { W.Instance = Original; }
}

interface Run { blocks: number; points: number; ms: number; error: string | null }

/** Play `signal` on `inst`, block by block; `between` runs before the first block and after the last. */
function play(inst: Instance, signal: Signal, between?: (when: 'start' | 'end') => void): Run {
  const err = inst.boot.find(m => m.type === 'error');
  if (!inst.boot.some(m => m.type === 'ready')) return { blocks: 0, points: 0, ms: 0, error: err ? `${String(err.phase)}: ${String(err.message)}` : 'it did not start' };
  for (const events of signal.events) if (events.length) inst.send({ type: 'events', events });
  const proc = inst.proc as unknown as { statPoints: number };
  const inL = new Float32Array(FRAMES), inR = new Float32Array(FRAMES);
  const clock = () => performance.now();
  between?.('start');
  const p0 = proc.statPoints;
  let ms = 0, blocks = 0, error: string | null = null;
  for (let at = 0; at < signal.frames; at += FRAMES) {
    signal.fill(at / FRAMES, inL, inR);
    const t0 = clock();
    const { posted } = inst.block(inL, inR, at);
    ms += clock() - t0;
    const e = posted.find(m => m.type === 'error');
    if (e) { error = `block ${at / FRAMES}: ${String(e.phase)}: ${String(e.message)}`; break; }
    blocks++;
  }
  const points = proc.statPoints - p0;
  between?.('end');
  inst.send({ type: 'dispose' });
  return { blocks, points, ms, error };
}

/** Profile a bundle (`.est` bytes): where its blocks' fuel goes, function by function. */
export async function profile(bytes: Uint8Array, opts: ProfileOptions = {}): Promise<ProfileReport> {
  const bundle = await readBundle(bytes);
  const { meter } = await import('../../../../src/audio/est/install/estMeter');
  const shim = await hostShim();
  const manifest = bundle.manifest;
  const plain = await WebAssembly.compile(meter(bundle.module, { mode: 'local' }).bytes as Uint8Array<ArrayBuffer>);
  if (!isMetered(plain)) throw new Error('the metered module lost its fuel exports');
  const profiled = meter(bundle.module, { mode: 'local', profile: true });
  const profiledModule = await WebAssembly.compile(profiled.bytes as Uint8Array<ArrayBuffer>);
  const fns = profiled.profile!.functions;

  const sr = opts.golden?.sampleRate ?? opts.sampleRate ?? 48000;
  const signalFor = (inst: Instance): Signal => {
    if (opts.golden) return goldenSignal(opts.golden);
    const params = (inst.boot.find(m => m.type === 'ready')?.params as EstParam[] | undefined) ?? [];
    return conformanceSignal(manifest, params, opts.seconds ?? 10, sr, opts.notes === true);
  };
  const queueOf = (): number => {
    // The queue holds every event of the run before the first block (1.331), as the conformance run's does.
    if (opts.golden) return goldenSignal(opts.golden).queueSize;
    return conformanceSignal(manifest, [], opts.seconds ?? 10, sr, opts.notes === true).queueSize;
  };

  // 1. The plain build: the block fuel and the time, as at install.
  const a = standInInstance({ module: plain, shim, manifest }, sr, { queueSize: queueOf() });
  const one = play(a, signalFor(a));

  // 2. The profiling build: the same run, the counters read around the blocks.
  const fuel = new Float64Array(fns.length), calls = new Float64Array(fns.length);
  const { inst: b, wasm } = instanceKeeping(profiledModule, () => standInInstance({ module: profiledModule, shim, manifest }, sr, { queueSize: queueOf() }));
  const ex = (wasm?.exports ?? {}) as Record<string, WebAssembly.Global>;
  const read = (sign: 1 | -1) => {
    for (let k = 0; k < fns.length; k++) {
      // The counters' exports (`profileFuelExport`, `profileCallsExport` in estMeter.ts, named here so
      // this module does not load Binaryen until `profile` runs).
      fuel[k] = fuel[k]! + sign * Number(ex[`est_profile_fuel_${k}`]?.value ?? 0n);
      calls[k] = calls[k]! + sign * Number(ex[`est_profile_calls_${k}`]?.value ?? 0n);
    }
  };
  if (!wasm) throw new Error('the profiled instance was not made');
  const two = play(b, signalFor(b), when => read(when === 'start' ? -1 : 1));

  const totalFuel = fuel.reduce((s, x) => s + x, 0);
  const blocks = two.blocks;
  const blockUs = one.blocks ? (one.ms * 1000) / one.blocks : 0;
  const functions: ProfileRow[] = [];
  for (let k = 0; k < fns.length; k++) {
    if (!fuel[k] && !calls[k]) continue;
    const share = totalFuel ? fuel[k]! / totalFuel : 0;
    functions.push({ index: fns[k]!.index, name: fns[k]!.name, fuel: fuel[k]!, share, perBlock: blocks ? fuel[k]! / blocks : 0, calls: calls[k]!, us: share * blockUs });
  }
  functions.sort((x, y) => y.fuel - x.fuel || x.index - y.index);
  return {
    id: manifest.id, version: manifest.version, kind: manifest.kind,
    signal: opts.golden ? 'golden' : 'conformance', sampleRate: sr, blocks,
    blockFuel: one.blocks ? one.points / one.blocks : 0,
    blockUs, budgetUs: EST_BLOCK_BUDGET_US, over: blockUs > EST_BLOCK_BUDGET_US,
    totalFuel, otherFuel: totalFuel - two.points,
    fuelExact: !one.error && !two.error && one.blocks === two.blocks && one.points === two.points && totalFuel === two.points,
    functions, error: one.error ?? two.error,
  };
}

/** A function's label: its source name (a Rust symbol demangled), else its index. */
export const functionLabel = (r: Pick<ProfileRow, 'index' | 'name'>): string => (r.name ? demangle(r.name) : `function ${r.index}`);

/**
 * A Rust symbol as source reads it: legacy (`_ZN…E`, the hash dropped) and v0 (`_R…`: paths, impls,
 * generic arguments and the common types). Anything else, or a v0 symbol using what this does not
 * read (function pointers, `dyn`), comes back unchanged: a name section's C, C++ (wasm-ld demangles
 * those) and AssemblyScript names are already readable.
 */
export function demangle(sym: string): string {
  if (/^_ZN.*E$/.test(sym)) {
    const parts: string[] = [];
    let i = 3;
    while (i < sym.length - 1) {
      const m = /^\d+/.exec(sym.slice(i));
      if (!m) return sym;
      const n = Number(m[0]);
      parts.push(sym.slice(i + m[0].length, i + m[0].length + n));
      i += m[0].length + n;
    }
    if (parts.length > 1 && /^h[0-9a-f]{16}$/.test(parts[parts.length - 1]!)) parts.pop();
    const map: Record<string, string> = { SP: '@', BP: '*', RF: '&', LT: '<', GT: '>', LP: '(', RP: ')', C: ',' };
    return parts.map(p => p.replace(/\$([A-Z]{1,2}|u[0-9a-f]+)\$/g, (_, c: string) => map[c] ?? (c.startsWith('u') ? String.fromCharCode(parseInt(c.slice(1), 16)) : _)).replace(/\.\./g, '::')).join('::');
  }
  if (!sym.startsWith('_R')) return sym;
  try { return v0(sym.slice(2)); } catch { return sym; }
}

/** Rust's v0 mangling (RFC 2603), the subset `demangle` reads; throws on anything else. */
function v0(s: string): string {
  let i = 0;
  const peek = () => s[i] ?? '';
  const eat = (c: string) => { if (s[i] === c) { i++; return true; } return false; };
  const b62 = (): number => {
    if (eat('_')) return 0;
    let n = 0;
    for (;;) {
      const c = s[i++];
      if (c === undefined) throw new Error('end');
      if (c === '_') return n + 1;
      const d = c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c >= 'a' && c <= 'z' ? c.charCodeAt(0) - 87 : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 29 : -1;
      if (d < 0) throw new Error('base 62');
      n = n * 62 + d;
    }
  };
  const ident = (): string => {
    if (eat('s')) b62();
    eat('u');
    const m = /^\d+/.exec(s.slice(i));
    if (!m) throw new Error('ident');
    i += m[0].length;
    eat('_');
    const n = Number(m[0]);
    const id = s.slice(i, i + n);
    i += n;
    return id;
  };
  const backref = <T>(f: () => T): T => { const at = b62(); const keep = i; i = at; try { return f(); } finally { i = keep; } };
  const BASIC: Record<string, string> = { a: 'i8', b: 'bool', c: 'char', d: 'f64', e: 'str', f: 'f32', h: 'u8', i: 'isize', j: 'usize', l: 'i32', m: 'u32', n: 'i128', o: 'u128', s: 'i16', t: 'u16', u: '()', v: '...', x: 'i64', y: 'u64', z: '!', p: '_' };
  const lifetime = () => { if (eat('L')) b62(); };
  const type = (): string => {
    const c = peek();
    if (BASIC[c]) { i++; return BASIC[c]!; }
    if (eat('A')) { const t = type(); return `[${t}; ${konst()}]`; }
    if (eat('S')) return `[${type()}]`;
    if (eat('T')) { const ts: string[] = []; while (!eat('E')) ts.push(type()); return `(${ts.join(', ')}${ts.length === 1 ? ',' : ''})`; }
    if (eat('R')) { lifetime(); return `&${type()}`; }
    if (eat('Q')) { lifetime(); return `&mut ${type()}`; }
    if (eat('P')) return `*const ${type()}`;
    if (eat('O')) return `*mut ${type()}`;
    if (eat('B')) return backref(type);
    return path();
  };
  const konst = (): string => {
    if (eat('p')) return '_';
    if (eat('B')) return backref(konst);
    const t = peek();
    i++;
    const neg = eat('n');
    const m = /^[0-9a-f]*_/.exec(s.slice(i));
    if (!m) throw new Error('const');
    i += m[0].length;
    const v = BigInt(`0x${m[0].slice(0, -1) || '0'}`);
    return t === 'b' ? String(v !== 0n) : `${neg ? '-' : ''}${v}`;
  };
  const arg = (): string => {
    if (peek() === 'L') { lifetime(); return "'_"; }
    if (eat('K')) return konst();
    return type();
  };
  const path = (): string => {
    const c = s[i++];
    if (c === 'C') return ident();
    if (c === 'N') {
      const ns = s[i++] ?? '';
      const inner = path();
      const id = ident();
      if (ns >= 'A' && ns <= 'Z') return `${inner}::{${ns === 'C' ? 'closure' : ns === 'S' ? 'shim' : ns}${id ? `:${id}` : ''}}`;
      return `${inner}::${id}`;
    }
    if (c === 'M') { if (eat('s')) b62(); path(); return `<${type()}>`; }
    if (c === 'X') { if (eat('s')) b62(); path(); const t = type(); return `<${t} as ${path()}>`; }
    if (c === 'Y') { const t = type(); return `<${t} as ${path()}>`; }
    if (c === 'I') { const p = path(); const args: string[] = []; while (!eat('E')) args.push(arg()); return `${p}::<${args.join(', ')}>`; }
    if (c === 'B') return backref(path);
    throw new Error(`path ${c ?? 'end'}`);
  };
  return path();
}

const group = (n: number): string => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

/** What the numbers mean, in EST-P001's words. */
export function profileExplanation(): string {
  const rule = estRule('EST-P001');
  return `The budget is EST-P001's: ${rule.explain} Fuel is the meter's count of work: a function entry or a loop header charges its body's weighted instructions (a division, a square root or a float-to-int conversion more, a memory access a little more), so a function's fuel is its own work, and what it calls is counted on the callee. Its time here is its share of the block's measured time, an estimate: the fuel over-estimates time (the branch not taken is charged too). The fix, in EST-P001's words: ${rule.fix}`;
}

/** `text` in lines of at most `width` characters, broken at spaces. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** The report as `est profile` prints it (the first `top` functions). */
export function formatProfile(r: ProfileReport, opts: { top?: number } = {}): string {
  const top = Math.max(1, opts.top ?? 10);
  const seconds = (r.blocks * FRAMES) / r.sampleRate;
  const lines = [
    `est profile: ${r.id} ${r.version} (${r.kind})`,
    `${r.signal === 'golden' ? 'The golden spec' : 'The conformance run'}: ${seconds.toFixed(2)} s, ${r.blocks} blocks of ${FRAMES} frames at ${r.sampleRate} Hz, metered as at install.`,
    '',
    `A block: ${group(r.blockFuel)} points of fuel on average, ${r.blockUs.toFixed(1)} µs on this machine, against a budget of ${r.budgetUs} µs`
      + ` (EST-P001: ${r.over ? 'over the budget' : `${Math.round((100 * r.blockUs) / r.budgetUs)} % of it`}).`,
  ];
  if (r.error) lines.push(`The plugin stopped (${r.error}): the table is up to there.`);
  if (!r.fuelExact && !r.error) lines.push('The two runs spent different fuel (the plugin reads random_get or the clock): the table is the profiled run\'s.');
  if (r.otherFuel > 0) lines.push(`Of the table's fuel, ${group(r.otherFuel)} points were spent outside process() (on_main_thread or a restart).`);
  lines.push('');
  const shown = r.functions.slice(0, top);
  const labels = shown.map(f => { const l = functionLabel(f); return l.length > 72 ? `${l.slice(0, 71)}…` : l; });
  const w = Math.max(8, ...labels.map(l => l.length));
  lines.push(`  ${'#'.padStart(3)}  ${'function'.padEnd(w)}  ${'fuel/block'.padStart(12)}  ${'share'.padStart(7)}  ${'calls/block'.padStart(11)}  ${'~µs'.padStart(7)}`);
  shown.forEach((f, i) => {
    lines.push(`  ${String(i + 1).padStart(3)}  ${labels[i]!.padEnd(w)}  ${group(f.perBlock).padStart(12)}  ${`${(100 * f.share).toFixed(1)} %`.padStart(7)}  ${(r.blocks ? f.calls / r.blocks : 0).toFixed(2).padStart(11)}  ${f.us.toFixed(2).padStart(7)}`);
  });
  const rest = r.functions.slice(top);
  if (rest.length) {
    const share = rest.reduce((s, f) => s + f.share, 0);
    lines.push(`       ${rest.length} more function${rest.length === 1 ? '' : 's'}: ${(100 * share).toFixed(1)} % together (--top ${r.functions.length} lists all; --json gives the table)`);
  }
  if (!r.functions.some(f => f.name)) lines.push('', 'The module has no name section, so functions show by index: run est profile --debug on the plugin\'s folder to build it once more with names (or keep them yourself: asc --debug; Rust: strip = false in the release profile; clang: -g).');
  lines.push('', ...wrap(profileExplanation(), 100));
  return lines.join('\n');
}
