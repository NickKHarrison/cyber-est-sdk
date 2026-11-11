/**
 * EST Phase 2 (docs/est/EST_Phase2_Work_Order.md §4, decision D-30): every installed module runs
 * on fuel. Moved here from Phase 1's spike (`e2e/est/meter/instrument.mjs`, EST-B), unchanged in
 * what it does, and run by the compiling Worker (`estWorker.ts`) at install; never in the page.
 * (Named `estMeter` rather than the order's `meter.ts` so its chunk, Binaryen and all, about 13 MB,
 * is `assets/estMeter-<hash>.js`, which the service worker leaves out of its precache.)
 *
 * `meter(bytes)` rewrites a WebAssembly module with Binaryen (the `binaryen` package, Apache-2.0)
 * so that a mutable i32 global is decremented at every function entry, every loop header and
 * every `return`, and the module traps (`unreachable`) once it would go below zero. The host calls
 * the added `refuel(n)` export before each call into the plugin (the runtime does,
 * `estProcessor.ts`), so a `process()` that never returns becomes a catchable trap instead of a
 * frozen audio thread (EST_SECURITY_ARCHITECTURE.md §6.2).
 *
 * How: Binaryen's own `log-execution` pass places a `call $log_execution(i32 id)` at exactly those
 * points; this file then replaces each call with the fuel check, so the rewritten module imports
 * nothing new. The placement is `'local'` (D-30, the Phase 1 measurement): each function copies the
 * global into a local at entry, every point decrements the local (a register), and the local is
 * written back before every `return` and at the end. Since the review of #449 (1.314) every call
 * and `call_indirect` syncs: its operands are evaluated first, the copy is written to the global,
 * the callee runs from it and writes back what it left, and the caller reads the global again
 * (`synced`), so the fuel a call chain spends is the exact sum of its points, whatever the depth.
 * (Before, it did not sync, and a caller's stale copy, written back at its own return, erased what
 * its callees spent: a loop over calls ran about fuel² over the calls' costs.) Runaway recursion
 * still ends in a stack overflow, a catchable trap. `'global'` (every point on the global itself) is kept for the
 * comparison bench (e2e/est-meter.spec.ts).
 *
 * 1.314 (LR-8b stream A, EST-01): **fuel bounds time, not metering points.** A point used to cost
 * 1 whatever it covered, so one `memory.fill` over the whole memory, or a loop body of thousands
 * of instructions, ran for one point each: one block's fuel allowed hours of work. Now (a) every
 * `memory.fill`, `memory.copy` and `memory.init` evaluates its size into a local first and charges
 * `1 + (size >>> BULK_SHIFT)` before it runs; (b) a function entry charges the function body's
 * expression count and a loop header its body's (Wasmtime's fuel charges each instruction; this
 * charges the same count once per entry); a `return` stays 1. A point is then a bounded amount of
 * work, and `BLOCK_FUEL` (`estProcessor.ts`) is a real-time budget measured against the reference
 * plugins (its comment has the figures). `METER_VERSION` (`store.ts`) moved, so installed modules
 * re-meter on their next load. The host's own imports are charged on the host's side
 * (`estProcessor.ts` `charge()`), since a function's local copy of the fuel never sees the global.
 *
 * Fixed-width SIMD (1.282; spec §3.6 allows it): a v128 instruction is straight-line code (no
 * branch, no call, no loop), so it needs no metering point of its own and the placement above is
 * unchanged; the walk only has to reach through it (the lane, shuffle, ternary, shift and SIMD
 * memory kinds below; SIMD arithmetic is a Unary or a Binary, `v128.const` a Const, `v128.load` and
 * `v128.store` a Load and a Store) so a call or a return under a SIMD operand is still found.
 *
 * What it refuses, never leaving it unmetered: a module that needs any feature outside `FEATURES`,
 * checked on the module as read, before the rewrite (`features`): threads and atomics (no shared
 * memory in EST 1.0, and `memory.atomic.wait` would block the audio thread), exception handling (a
 * throw unwinds past the local placement's write-back), GC, tail calls, memory64, multi-memory,
 * and **relaxed SIMD**: its results are implementation-defined (FMA or not, the x86 or ARM answer
 * for out-of-range lanes), so two machines, or two peers in a live room, could render a project
 * differently, and Safari lacks it (spec §3.6). And any expression kind the walk does not know
 * (table and reference instructions among them).
 *
 * 1.334 (R-C, `est profile`): **the profiling meter**, `meter(bytes, { profile: true })`, the SDK's
 * only caller (`sdk/packages/tools/src/profile.ts`). The same rewrite, point for point and charge
 * for charge (`pointCosts` reads the body before anything is added), plus two i64 counters a
 * function, exported as `est_profile_fuel_<k>` and `est_profile_calls_<k>`: every check adds the
 * fuel it takes from the copy to its function's counter, and the entry check counts a call. The
 * counters are not metering points and cost no fuel, so a profiled module spends exactly the fuel
 * the plain one does and the counters sum to it. **Never installed:** the installer never asks for
 * it, with `profile` off the rewrite emits exactly the bytes it did before (no counter, no
 * expression built; `sdk/tests/profile.test.ts` holds the hashes, and `METER_VERSION` is unchanged),
 * and a module that already exports an `est_profile_` name is refused (`PROFILE_PREFIX`).
 */
import binaryen from 'binaryen';
import { FUEL_GLOBAL, FUEL_LEFT_EXPORT, REFUEL_EXPORT } from './fuel';

export { FUEL_GLOBAL, FUEL_LEFT_EXPORT, REFUEL_EXPORT, isMetered } from './fuel';
const LOG_MODULE = 'env';
const LOG_BASE = 'log_execution';

export type MeterMode = 'global' | 'local';

/**
 * 1.314 (EST-01): a bulk memory op charges `1 + (size >>> BULK_SHIFT)` points: one point a byte.
 * Measured (stream A's calibration, 2026-11-05, Node 22's V8): a 16 MiB `memory.fill` takes about
 * 0.7 to 2 ms, so a byte a point spends 8 000 to 24 000 points per µs, the rate of the reference
 * plugins' own code (EST Gain, the slowest spender, about 6 000 a µs); a coarser granule let a fill
 * loop run far longer than any code on the same fuel.
 */
export const BULK_SHIFT = 0;

/**
 * 1.314 (EST-01): what one expression costs in a body's count. Binaryen's IR counts every leaf
 * (`local.get`, a constant) as an expression, and most run in well under a nanosecond; a few kinds
 * take several (a division, a square root, a float-to-int conversion), a memory access a little
 * more than arithmetic, a call its frame, and `memory.grow` a system call. These weights keep the
 * points a block spends within a factor of a few of its time whatever the plugin does; a
 * code path's points are an over-estimate of its time, never under (the branch not taken is
 * charged too, since a function entry charges its whole body).
 *
 * 1.405 (MEDIUM-1, the pre-review of 2026-11-09): **the weights from measurement.** The aim is that
 * no loop a plugin can write spends fewer than about 5 points a nanosecond (the slowest reference
 * plugin's rate, the one `BLOCK_FUEL` is set by), so a block's fuel is at most about 3 to 4 blocks of
 * time. Measured on 2026-11-09 (Node 22's V8, a Xeon at 2.3 GHz under KVM; each pattern a dependent
 * chain, the best of 40 runs of about 3 ms, through this `meter()`; `estMeter.cost.test.ts` holds
 * the ceilings), with the weights before → after, in points a nanosecond and blocks of time per
 * `BLOCK_FUEL`:
 *   a scalar add loop 49.5 (0.3 blocks: the floor); an f64 multiply-add 9.8 (1.6);
 *   `f64.sqrt` 3.95 → 5.4 (4.0 → 2.9 blocks), `slowUnary` 8 → 16;
 *   `f64x2.div` 4.2 → 7.9 (3.8 → 2.0), `f64x2.sqrt` 3.1 → 5.4 (5.1 → 2.9), a `sqrt(div)` chain
 *   1.9 → 5.0 (8.2 → 3.2), `f32x4.div` and `.sqrt` 5.7 / 4.3 → 10.1 / 7.5: the vector divisions in
 *   `SLOW_BINARY`, the vector square roots in `SLOW_UNARY` (they were 1, the report's 27×);
 *   `i32.trunc_sat_f64_s` 3.7 → 5.3 (4.3 → 2.9); `i32x4.trunc_sat_f32x4_u` 2.2 → 4.3 (7.1 → 3.7),
 *   `i32x4.trunc_sat_f64x2_u_zero` 2.6 → 5.0 (6.1 → 3.1): the vector truncations in `SLOW_UNARY`,
 *   the unsigned vector conversions, the vector float min and max and `i64x2.mul` in
 *   `SEQUENCE_OPS` (`sequence` 4: `f32x4.min` 4.3 → 5.2);
 *   `memory.fill` / `memory.copy` of 0 bytes 4.0 → 5.4 (3.9 → 2.9): a bulk op costs `bulk` 8 before
 *   its bytes (a call into the engine, about 5 ns whatever the size);
 *   `memory.grow` 0.34 → 8.9 (46 → 1.8 blocks): `grow` 64 → 2048 (a runtime call, about 230 ns;
 *   about 700 ns on a loaded machine); a failing grow 85 points a ns;
 *   an unaligned load across a page 3.0 → 3.8 (5.2 → 4.1 blocks; the `memory` weight below).
 * **What no static weight can price**, and the watchdog (`watchdog.ts`, `OVERRUN_MS`) stops instead:
 *   a load that misses the cache, since the same instruction costs 1 ns from L1 and 100 to 300 ns
 *   from memory (a random chase over 1 MiB 3.0 points a ns, 5 blocks; 16 MiB 1.7, 9 blocks; 128 MiB
 *   0.8, 19 blocks warm and up to 325 blocks cold, the report's figure), and a float multiply on a
 *   denormal number, about 40 ns on Intel against 1 (0.47 points a ns, 33 blocks). Pricing either
 *   needs a weight a hundred times an add on every load or multiply. The trade-off measured on the
 *   shipped plugins (the heaviest block of each, chords and the test loop, `estMeter.fuel.test.ts`):
 *   `memory` 2 → 4 raises VOX CHOP's 24.4 M points to 27.4 M and → 8 to 33.3 M (79 % of `BLOCK_FUEL`)
 *   while the 128 MiB chase gains a quarter (19 → 25 points a hop), so `memory` stays 2.
 */
const WEIGHT = { slowBinary: 16, slowUnary: 16, sequence: 4, memory: 2, bulk: 8, call: 4, grow: 2048 } as const;

export interface Metered {
  /** The metered module. */
  bytes: Uint8Array;
  /** How many metering points it has (function entries, loop headers, returns). */
  points: number;
  /** 1.334: with `profile`, the function each counter pair `k` belongs to. */
  profile?: MeterProfile;
}

/** 1.334 (R-C): every name a profiling build exports starts with this; the meter refuses an input that has one. */
export const PROFILE_PREFIX = 'est_profile_';
/** The export of function `k`'s fuel counter (i64) in a profiling build. */
export const profileFuelExport = (k: number): string => `${PROFILE_PREFIX}fuel_${k}`;
/** The export of function `k`'s call counter (i64) in a profiling build. */
export const profileCallsExport = (k: number): string => `${PROFILE_PREFIX}calls_${k}`;

/** 1.334: the defined functions of a profiling build, `k` in the order of the counters. */
export interface MeterProfile {
  functions: {
    /** The function's index in the module as given (imports first, as the WebAssembly index space counts). */
    index: number;
    /** Its name from the module's name section, or null when the build kept none. */
    name: string | null;
  }[];
}

/**
 * What the rewrite reads and writes: the MVP plus what wasm32 toolchains emit by default, and
 * fixed-width SIMD (1.282). Not relaxed SIMD, atomics, exceptions, GC or tail calls (above).
 */
const FEATURES = binaryen.Features.MVP | binaryen.Features.MutableGlobals | binaryen.Features.BulkMemory
  | binaryen.Features.BulkMemoryOpt | binaryen.Features.SignExt | binaryen.Features.NontrappingFPToInt
  | binaryen.Features.Multivalue | binaryen.Features.ReferenceTypes | binaryen.Features.CallIndirectOverlong
  | binaryen.Features.SIMD128;

type ExprRef = number;
type Accessor = Record<string, (...a: number[]) => number>;
/** binaryen.js's expression classes (`binaryen.If.getCondition(e)` …), which its typings omit. */
const B = binaryen as unknown as Record<string, Accessor> & Record<string, number>;

/**
 * Meter a module. Throws on a module Binaryen cannot read, on an expression kind it would leave
 * unmetered, and on a module that already imports `env.log_execution`.
 */
export function meter(bytes: Uint8Array, opts: { mode?: MeterMode; profile?: boolean } = {}): Metered {
  const mode = opts.mode ?? 'local';
  const mod = binaryen.readBinary(bytes);
  try {
    if (findLogImport(mod)) throw new Error('meter: the module already imports env.log_execution');
    if (hasProfileExport(mod)) throw new Error(`meter: the module exports a ${PROFILE_PREFIX} name (a profiling build is never installed)`);
    // 1.334: the source names and indices, read before anything is added (profiling builds only).
    const original = opts.profile ? originalFunctions(mod) : null;
    // 0. Only the features the meter knows (relaxed SIMD, threads, exceptions … are refused here).
    mod.setFeatures(FEATURES);
    if (!quietly(() => mod.validate())) throw new Error('meter: the module uses a WebAssembly feature EST does not run (relaxed SIMD, threads and atomics, exceptions, GC, tail calls, memory64 …)');
    // 1. The metering points: an import call at every function entry, loop header and return.
    binaryen.setPassArgument('log-execution', LOG_MODULE);
    mod.runPasses(['log-execution']);
    const imp = findLogImport(mod);
    if (!imp) return { bytes: new Uint8Array(mod.emitBinary()), points: 0 };
    const points = countCalls(mod.emitText(), imp);
    // 2. The fuel: a global, refuel(n) and fuel_left().
    mod.addGlobal(FUEL_GLOBAL, binaryen.i32, true, mod.i32.const(0));
    const fuel = () => mod.global.get(FUEL_GLOBAL, binaryen.i32);
    // 3. Rewrite every defined function (1.314: both placements, so each point's cost and the bulk
    //    charges are the same in the bench's `global` as in production's `local`): `local` keeps a
    //    local copy of the fuel and the points on it; `global` puts every point on the global.
    const names: string[] = [];
    for (let i = 0; i < mod.getNumFunctions(); i++) {
      const info = binaryen.getFunctionInfo(mod.getFunctionByIndex(i));
      if (!info.module) names.push(info.name);
    }
    if (original) {
      const functions: MeterProfile['functions'] = [];
      names.forEach((name, k) => {
        mod.addGlobal(`${PROFILE_PREFIX}f${k}`, binaryen.i64, true, mod.i64.const(0n));
        mod.addGlobal(`${PROFILE_PREFIX}c${k}`, binaryen.i64, true, mod.i64.const(0n));
        mod.addGlobalExport(`${PROFILE_PREFIX}f${k}`, profileFuelExport(k));
        mod.addGlobalExport(`${PROFILE_PREFIX}c${k}`, profileCallsExport(k));
        const o = original.get(name);
        functions.push({ index: o?.index ?? -1, name: o?.named ? name : null });
        rewriteFuel(mod, name, imp, mode, k);
      });
      mod.removeFunction(imp);
      addFuelExports(mod, fuel);
      if (!quietly(() => mod.validate())) throw new Error('meter: the rewritten module does not validate');
      return { bytes: new Uint8Array(mod.emitBinary()), points, profile: { functions } };
    }
    for (const name of names) rewriteFuel(mod, name, imp, mode);
    mod.removeFunction(imp);
    mod.addFunction('est_refuel', binaryen.i32, binaryen.none, [],
      mod.global.set(FUEL_GLOBAL, mod.local.get(0, binaryen.i32)));
    mod.addFunctionExport('est_refuel', REFUEL_EXPORT);
    mod.addFunction('est_fuel_left', binaryen.none, binaryen.i32, [], fuel());
    mod.addFunctionExport('est_fuel_left', FUEL_LEFT_EXPORT);
    if (!quietly(() => mod.validate())) throw new Error('meter: the rewritten module does not validate');
    return { bytes: new Uint8Array(mod.emitBinary()), points };
  } finally {
    mod.dispose();
  }
}

/**
 * The rewrite of one function. `'local'`: re-made with two more locals (the fuel copy, and a
 * temporary for its result), the log calls replaced by checks on the copy, written back before
 * every return and at the end. `'global'` (the bench's comparison): the checks on the global
 * itself. 1.314 (EST-01): each check charges its point's cost (`pointCosts`: the body's weighted
 * expression count at a function entry and a loop header, 1 at a return), and every bulk memory
 * op charges by its size first (a local per op holds the size, so it is evaluated once).
 */
function rewriteFuel(mod: binaryen.Module, name: string, imp: string, mode: MeterMode, profileK?: number) {
  const fn = mod.getFunction(name);
  const info = binaryen.getFunctionInfo(fn);
  const params = binaryen.expandType(info.params);
  const vars = info.vars.slice();
  const results = info.results;
  if (binaryen.expandType(results).length > 1) throw new Error(`meter: ${name} returns several values`);
  const local = mode === 'local';
  const L = params.length + vars.length;
  if (local) vars.push(binaryen.i32);
  let T = -1;
  if (local && results !== binaryen.none) { T = params.length + vars.length; vars.push(results); }
  const costs = pointCosts(info.body, imp);
  // 1.334: a profiling build's counters (`profileK` set only by `meter(…, { profile: true })`).
  const prof = profileK === undefined ? null : profileCounters(mod, profileK, entryPointOf(info.body, imp));
  const getL = () => (local ? mod.local.get(L, binaryen.i32) : mod.global.get(FUEL_GLOBAL, binaryen.i32));
  const setL = (v: ExprRef) => (local ? mod.local.set(L, v) : mod.global.set(FUEL_GLOBAL, v));
  const store = () => mod.global.set(FUEL_GLOBAL, getL());
  const trapBelowZero = () => mod.if(mod.i32.lt_s(getL(), mod.i32.const(0)), mod.unreachable());
  const check = (cost: number, point: ExprRef) => (prof ? mod.block(null, [
    setL(mod.i32.sub(getL(), mod.i32.const(cost))),
    ...prof.charged(mod.i64.const(BigInt(cost)), point),
    trapBelowZero(),
  ]) : mod.block(null, [
    setL(mod.i32.sub(getL(), mod.i32.const(cost))),
    trapBelowZero(),
  ]));
  const newLocal = (type: number) => { const i = params.length + vars.length; vars.push(type); return i; };
  /**
   * Review of #449 (EST-01): a call in the `local` placement syncs the fuel around it. Its operands
   * (and a `call_indirect`'s target) are evaluated first, into locals of their own, so what they
   * spend lands on this frame's copy; the copy is then written to the global, the call made (the
   * callee starts from it and writes back what is left when it returns), and the copy read back.
   * So a chain of calls spends exactly the sum of its points: before, a callee's write-back was
   * overwritten by its caller's stale copy at the caller's next return, and A looping over B
   * calling C ran about fuel² / (cost B × cost C) iterations of C, billions on one block's fuel.
   */
  const synced = (e: ExprRef, kind: 'Call' | 'CallIndirect'): ExprRef => {
    const type = binaryen.getExpressionType(e);
    if (type === binaryen.unreachable) return e; // never completes normally: nothing to read back
    const cls = B[kind]!;
    const pre: ExprRef[] = [];
    const n = cls.getNumOperands!(e);
    for (let i = 0; i < n; i++) {
      const op = cls.getOperandAt!(e, i);
      const t = binaryen.getExpressionType(op);
      if (t === binaryen.unreachable) return e;
      const k = newLocal(t);
      pre.push(mod.local.set(k, op));
      cls.setOperandAt!(e, i, mod.local.get(k, t));
    }
    if (kind === 'CallIndirect') {
      const target = cls.getTarget!(e);
      const k = newLocal(binaryen.i32);
      pre.push(mod.local.set(k, target));
      cls.setTarget!(e, mod.local.get(k, binaryen.i32));
    }
    pre.push(store());
    const reload = mod.local.set(L, mod.global.get(FUEL_GLOBAL, binaryen.i32));
    if (type === binaryen.none) return mod.block(null, [...pre, e, reload], binaryen.none);
    const r = newLocal(type);
    return mod.block(null, [...pre, mod.local.set(r, e), reload, mod.local.get(r, type)], type);
  };
  const replace = (e: ExprRef): ExprRef => {
    const id = binaryen.getExpressionId(e);
    if (id === binaryen.CallId) {
      const c = binaryen.getExpressionInfo(e) as binaryen.CallInfo;
      if (c.target === imp) return check(costs.get(e) ?? 1, e);
      if (c.isReturn && local) return mod.block(null, [store(), e], binaryen.unreachable);
      if (local) return synced(e, 'Call');
    }
    if (local && id === binaryen.CallIndirectId && !(binaryen.getExpressionInfo(e) as binaryen.CallIndirectInfo).isReturn) return synced(e, 'CallIndirect');
    const bulk = BULK_SIZE[KIND_OF_ID.get(id) ?? ''];
    if (bulk) {
      // The size into a local of its own, the charge, the check, then the op on that local.
      const S = params.length + vars.length;
      vars.push(binaryen.i32);
      const cls = B[bulk[0]]!;
      const size = cls[bulk[1]]!(e);
      cls[bulk[2]]!(e, mod.local.get(S, binaryen.i32));
      // The review of #449: the size compared unsigned first (a size of 2^31 or more is a negative
      // i32, and subtracting it would add fuel); then the charge.
      const charge = () => mod.i32.add(mod.i32.const(1), mod.i32.shr_u(mod.local.get(S, binaryen.i32), mod.i32.const(BULK_SHIFT)));
      return mod.block(null, [
        mod.local.set(S, size),
        mod.if(mod.i32.ge_u(mod.i32.shr_u(mod.local.get(S, binaryen.i32), mod.i32.const(BULK_SHIFT)), getL()), mod.unreachable()),
        setL(mod.i32.sub(getL(), charge())),
        ...(prof ? prof.charged(mod.i64.extend_u(charge()), 0) : []),
        trapBelowZero(),
        e,
      ]);
    }
    if (local && id === binaryen.CallIndirectId && (binaryen.getExpressionInfo(e) as binaryen.CallIndirectInfo).isReturn) return mod.block(null, [store(), e], binaryen.unreachable);
    if (local && id === binaryen.ReturnId) return mod.block(null, [store(), e], binaryen.unreachable);
    return e;
  };
  const body = walk(info.body, replace);
  let newBody = body;
  if (local) {
    const load = mod.local.set(L, mod.global.get(FUEL_GLOBAL, binaryen.i32));
    newBody = T < 0
      ? mod.block(null, [load, body, store()])
      : mod.block(null, [load, mod.local.set(T, body), store(), mod.local.get(T, results)], results);
  }
  mod.removeFunction(name);
  mod.addFunction(name, info.params, results, vars, newBody);
}

/** 1.334 (R-C): the fuel the profiling meter's export functions read and set (the plain path writes the same four lines inline). */
function addFuelExports(mod: binaryen.Module, fuel: () => ExprRef) {
  mod.addFunction('est_refuel', binaryen.i32, binaryen.none, [],
    mod.global.set(FUEL_GLOBAL, mod.local.get(0, binaryen.i32)));
  mod.addFunctionExport('est_refuel', REFUEL_EXPORT);
  mod.addFunction('est_fuel_left', binaryen.none, binaryen.i32, [], fuel());
  mod.addFunctionExport('est_fuel_left', FUEL_LEFT_EXPORT);
}

/**
 * 1.334 (R-C): function `k`'s counters in a profiling build. `charged(amount, point)` is what a
 * check adds after taking `amount` from the copy: the amount on the fuel counter and, at the entry
 * point, one on the call counter. Plain `global.set`s: no metering point, no fuel.
 */
function profileCounters(mod: binaryen.Module, k: number, entry: ExprRef | null) {
  const f = `${PROFILE_PREFIX}f${k}`, c = `${PROFILE_PREFIX}c${k}`;
  const add = (g: string, v: ExprRef) => mod.global.set(g, mod.i64.add(mod.global.get(g, binaryen.i64), v));
  return {
    charged(amount: ExprRef, point: ExprRef): ExprRef[] {
      const out = [add(f, amount)];
      if (entry && point === entry) out.push(add(c, mod.i64.const(1n)));
      return out;
    },
  };
}

/** 1.334: the function entry's metering point (`log-execution` puts it first in the block wrapping the body), or null. */
function entryPointOf(body: ExprRef, imp: string): ExprRef | null {
  if (!body || binaryen.getExpressionId(body) !== binaryen.BlockId || B.Block!.getNumChildren!(body) < 1) return null;
  const first = B.Block!.getChildAt!(body, 0);
  return binaryen.getExpressionId(first) === binaryen.CallId && (binaryen.getExpressionInfo(first) as binaryen.CallInfo).target === imp ? first : null;
}

/** 1.334: each function's index in the module as read, and whether its name came from a name section (Binaryen names the rest by index). */
function originalFunctions(mod: binaryen.Module): Map<string, { index: number; named: boolean }> {
  const out = new Map<string, { index: number; named: boolean }>();
  for (let i = 0; i < mod.getNumFunctions(); i++) {
    const name = binaryen.getFunctionInfo(mod.getFunctionByIndex(i)).name;
    out.set(name, { index: i, named: name !== String(i) });
  }
  return out;
}

function hasProfileExport(mod: binaryen.Module): boolean {
  for (let i = 0; i < mod.getNumExports(); i++) {
    if (binaryen.getExportInfo(mod.getExportByIndex(i)).name.startsWith(PROFILE_PREFIX)) return true;
  }
  return false;
}

/** The bulk memory ops (1.314, EST-01), each as [class, size getter, size setter]. */
const BULK_SIZE: Record<string, [string, string, string]> = {
  MemoryFill: ['MemoryFill', 'getSize', 'setSize'],
  MemoryCopy: ['MemoryCopy', 'getSize', 'setSize'],
  MemoryInit: ['MemoryInit', 'getSize', 'setSize'],
};

/**
 * 1.314 (EST-01): what each metering point costs. `log-execution` places a loop's point as the
 * first child of the block it wraps the loop's body in, and the function's as the first child of
 * the block it wraps the body in (its placement, checked by the test); each of those charges the
 * expressions of the body it guards (nested loops counted again: an over-estimate, never under).
 * A return's point is not in the map and costs 1.
 */
export function pointCosts(body: ExprRef, imp: string): Map<ExprRef, number> {
  const costs = new Map<ExprRef, number>();
  const isPoint = (e: ExprRef) => binaryen.getExpressionId(e) === binaryen.CallId && (binaryen.getExpressionInfo(e) as binaryen.CallInfo).target === imp;
  const pointOf = (block: ExprRef): ExprRef | null => {
    if (!block || binaryen.getExpressionId(block) !== binaryen.BlockId) return null;
    const cls = B.Block!;
    if (cls.getNumChildren!(block) < 1) return null;
    const first = cls.getChildAt!(block, 0);
    return isPoint(first) ? first : null;
  };
  const count = (e: ExprRef): number => { let n = 0; walk(e, x => { n += weightOf(x); return x; }); return n; };
  const entry = pointOf(body);
  if (entry) costs.set(entry, count(body));
  walk(body, e => {
    if (binaryen.getExpressionId(e) === binaryen.LoopId) {
      const loopBody = B.Loop!.getBody!(e);
      const p = pointOf(loopBody);
      if (p) costs.set(p, count(loopBody));
    }
    return e;
  });
  return costs;
}

/** Scalar division and remainder (a divider's latency, 13 to 40 cycles), and vector float division (1.405). */
const SLOW_BINARY = new Set<number>([
  binaryen.DivSInt32, binaryen.DivUInt32, binaryen.RemSInt32, binaryen.RemUInt32,
  binaryen.DivSInt64, binaryen.DivUInt64, binaryen.RemSInt64, binaryen.RemUInt64,
  binaryen.DivFloat32, binaryen.DivFloat64,
  binaryen.DivVecF32x4, binaryen.DivVecF64x2,
]);
/**
 * Square roots and float-to-int conversions (a scalar truncation is a guarded sequence in V8, a
 * vector one an emulation of several instructions on x64), scalar and vector (1.405).
 */
const SLOW_UNARY = new Set<number>([
  binaryen.SqrtFloat32, binaryen.SqrtFloat64,
  binaryen.SqrtVecF32x4, binaryen.SqrtVecF64x2,
  binaryen.TruncSFloat32ToInt32, binaryen.TruncSFloat32ToInt64, binaryen.TruncUFloat32ToInt32, binaryen.TruncUFloat32ToInt64,
  binaryen.TruncSFloat64ToInt32, binaryen.TruncSFloat64ToInt64, binaryen.TruncUFloat64ToInt32, binaryen.TruncUFloat64ToInt64,
  binaryen.TruncSatSFloat32ToInt32, binaryen.TruncSatSFloat32ToInt64, binaryen.TruncSatUFloat32ToInt32, binaryen.TruncSatUFloat32ToInt64,
  binaryen.TruncSatSFloat64ToInt32, binaryen.TruncSatSFloat64ToInt64, binaryen.TruncSatUFloat64ToInt32, binaryen.TruncSatUFloat64ToInt64,
  binaryen.TruncSatSVecF32x4ToVecI32x4, binaryen.TruncSatUVecF32x4ToVecI32x4,
  binaryen.TruncSatZeroSVecF64x2ToVecI32x4, binaryen.TruncSatZeroUVecF64x2ToVecI32x4,
]);
/**
 * 1.405: the ops V8 lowers to a short sequence on x64 rather than one instruction (an unsigned
 * int-to-float conversion, the IEEE min and max with their NaN and signed-zero rules, a 64-bit lane
 * multiply): a few times an add.
 */
const SEQUENCE_OPS = new Set<number>([
  binaryen.ConvertUInt64ToFloat32, binaryen.ConvertUInt64ToFloat64,
  binaryen.ConvertUVecI32x4ToVecF32x4, binaryen.ConvertLowUVecI32x4ToVecF64x2,
  binaryen.MinVecF32x4, binaryen.MaxVecF32x4, binaryen.MinVecF64x2, binaryen.MaxVecF64x2,
  binaryen.MulVecI64x2,
]);
const MEMORY_KINDS = new Set(['Load', 'Store', 'SIMDLoad', 'SIMDLoadStoreLane']);
/** 1.405: a bulk memory op's own cost before its bytes (a call into the engine, about 5 ns even for 0 bytes). */
const BULK_KINDS = new Set(['MemoryFill', 'MemoryCopy', 'MemoryInit']);

/** An expression's weight in a body's count (`WEIGHT`). */
function weightOf(e: ExprRef): number {
  const id = binaryen.getExpressionId(e);
  if (id === binaryen.BinaryId) {
    const op = (binaryen.getExpressionInfo(e) as binaryen.BinaryInfo).op;
    return SLOW_BINARY.has(op) ? WEIGHT.slowBinary : SEQUENCE_OPS.has(op) ? WEIGHT.sequence : 1;
  }
  if (id === binaryen.UnaryId) {
    const op = (binaryen.getExpressionInfo(e) as binaryen.UnaryInfo).op;
    return SLOW_UNARY.has(op) ? WEIGHT.slowUnary : SEQUENCE_OPS.has(op) ? WEIGHT.sequence : 1;
  }
  if (id === binaryen.CallId || id === binaryen.CallIndirectId) return WEIGHT.call;
  if (id === binaryen.MemoryGrowId) return WEIGHT.grow;
  const kind = KIND_OF_ID.get(id) ?? '';
  if (BULK_KINDS.has(kind)) return WEIGHT.bulk;
  return MEMORY_KINDS.has(kind) ? WEIGHT.memory : 1;
}

/** Each expression kind's children, as [getter, setter] names on its binaryen.js class. */
const CHILDREN: Record<string, [string, string][]> = {
  If: [['getCondition', 'setCondition'], ['getIfTrue', 'setIfTrue'], ['getIfFalse', 'setIfFalse']],
  Loop: [['getBody', 'setBody']],
  Break: [['getCondition', 'setCondition'], ['getValue', 'setValue']],
  Switch: [['getCondition', 'setCondition'], ['getValue', 'setValue']],
  LocalSet: [['getValue', 'setValue']],
  GlobalSet: [['getValue', 'setValue']],
  Load: [['getPtr', 'setPtr']],
  Store: [['getPtr', 'setPtr'], ['getValue', 'setValue']],
  Unary: [['getValue', 'setValue']],
  Binary: [['getLeft', 'setLeft'], ['getRight', 'setRight']],
  Select: [['getIfTrue', 'setIfTrue'], ['getIfFalse', 'setIfFalse'], ['getCondition', 'setCondition']],
  Drop: [['getValue', 'setValue']],
  Return: [['getValue', 'setValue']],
  MemoryGrow: [['getDelta', 'setDelta']],
  MemoryCopy: [['getDest', 'setDest'], ['getSource', 'setSource'], ['getSize', 'setSize']],
  MemoryFill: [['getDest', 'setDest'], ['getValue', 'setValue'], ['getSize', 'setSize']],
  MemoryInit: [['getDest', 'setDest'], ['getOffset', 'setOffset'], ['getSize', 'setSize']],
  // Fixed-width SIMD (1.282): straight-line, walked only for what their operands hold.
  SIMDExtract: [['getVec', 'setVec']],
  SIMDReplace: [['getVec', 'setVec'], ['getValue', 'setValue']],
  SIMDShuffle: [['getLeft', 'setLeft'], ['getRight', 'setRight']],
  SIMDTernary: [['getA', 'setA'], ['getB', 'setB'], ['getC', 'setC']],
  SIMDShift: [['getVec', 'setVec'], ['getShift', 'setShift']],
  SIMDLoad: [['getPtr', 'setPtr']],
  SIMDLoadStoreLane: [['getPtr', 'setPtr'], ['getVec', 'setVec']],
};
const LEAVES = new Set(['Nop', 'LocalGet', 'GlobalGet', 'Const', 'Unreachable', 'MemorySize', 'DataDrop']);
const KIND_OF_ID = new Map<number, string>();
for (const k of [...Object.keys(CHILDREN), ...LEAVES, 'Block', 'Call', 'CallIndirect']) KIND_OF_ID.set(B[`${k}Id`] as number, k);

/**
 * Post-order walk: children first, then `replace` on the node; a changed child is set in place.
 * An expression kind outside the table is refused rather than left unmetered.
 */
function walk(e: ExprRef, replace: (e: ExprRef) => ExprRef): ExprRef {
  if (!e) return e;
  const kind = KIND_OF_ID.get(binaryen.getExpressionId(e));
  if (!kind) throw new Error(`meter: unsupported expression id ${binaryen.getExpressionId(e)}`);
  if (kind === 'Block') {
    const cls = B.Block!;
    const n = cls.getNumChildren!(e);
    for (let i = 0; i < n; i++) {
      const c = cls.getChildAt!(e, i);
      const r = walk(c, replace);
      if (r !== c) cls.setChildAt!(e, i, r);
    }
  } else if (kind === 'Call' || kind === 'CallIndirect') {
    const cls = B[kind]!;
    if (kind === 'CallIndirect') {
      const t = cls.getTarget!(e);
      const r = walk(t, replace);
      if (r !== t) cls.setTarget!(e, r);
    }
    const n = cls.getNumOperands!(e);
    for (let i = 0; i < n; i++) {
      const c = cls.getOperandAt!(e, i);
      const r = walk(c, replace);
      if (r !== c) cls.setOperandAt!(e, i, r);
    }
  } else if (!LEAVES.has(kind)) {
    const cls = B[kind]!;
    for (const [get, set] of CHILDREN[kind]!) {
      const c = cls[get]!(e);
      if (!c) continue;
      const r = walk(c, replace);
      if (r !== c) cls[set]!(e, r);
    }
  }
  return replace(e);
}

/**
 * `fn` with Binaryen's validation report (printed to the console on a failure) kept out of the
 * console: a refusal says why in its own words.
 */
function quietly<T>(fn: () => T): T {
  const c = console as unknown as Record<'log' | 'warn' | 'error', (...a: unknown[]) => void>;
  const keep = { log: c.log, warn: c.warn, error: c.error };
  c.log = c.warn = c.error = () => {};
  try { return fn(); } finally { Object.assign(c, keep); }
}

function findLogImport(mod: binaryen.Module): string | null {
  for (let i = 0; i < mod.getNumFunctions(); i++) {
    const info = binaryen.getFunctionInfo(mod.getFunctionByIndex(i));
    if (info.module === LOG_MODULE && info.base === LOG_BASE) return info.name;
  }
  return null;
}

function countCalls(wat: string, name: string): number {
  return wat.split(`(call $${name}`).length - 1;
}
