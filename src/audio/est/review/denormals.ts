/**
 * 1.520 (Cyber_EST_Store_Phase_C_Work_Order.md stream 6): **1.437's subnormal-store counter**, moved
 * here from `src/audio/est/install/estDenormals.test.ts` so the store's automatic review
 * (`autoReview.ts`) counts the same way the catalogue's test does; the test imports it from here.
 *
 * Timing would be flaky, so this counts: the module is rewritten by Binaryen's `instrument-memory`
 * pass so every f32 and f64 value it stores to memory goes through a function of the module's own
 * (the pass's imports replaced by bodies: no import is added, so the processor accepts it) that adds
 * one to a counter when the value is subnormal. Every state a plugin keeps from one sample to the
 * next lives in memory, so a run whose stores are never subnormal never multiplies a stuck subnormal
 * state either. The counter is the exported global `DENORMAL_COUNTER`.
 */
import binaryen from 'binaryen';

export const DENORMAL_COUNTER = '__dn_count';

/** The features Cyber's meter accepts (`estMeter.ts`), so any module that installs reads here. */
export const REVIEW_FEATURES = binaryen.Features.MVP | binaryen.Features.MutableGlobals | binaryen.Features.BulkMemory
  | binaryen.Features.BulkMemoryOpt | binaryen.Features.SignExt | binaryen.Features.NontrappingFPToInt
  | binaryen.Features.Multivalue | binaryen.Features.ReferenceTypes | binaryen.Features.CallIndirectOverlong
  | binaryen.Features.SIMD128;

/**
 * The module with every stored f32/f64 value checked: `instrument-memory` wraps each load and store
 * in a call to an `env` import that returns its last argument (the pointer or the value); each of
 * those imports becomes a function of the module that returns it too, and the two for stored floats
 * first add one to a mutable global when the value is subnormal (|v| below the smallest normal, and
 * not zero). The global is exported as `DENORMAL_COUNTER`. Throws when the pass did not run as expected.
 */
export function countDenormals(bytes: Uint8Array): Uint8Array {
  const mod = binaryen.readBinary(bytes);
  try {
    mod.setFeatures(REVIEW_FEATURES);
    const before = new Set<string>();
    for (let i = 0; i < mod.getNumFunctions(); i++) before.add(binaryen.getFunctionInfo(mod.getFunctionByIndex(i)).name);
    mod.runPasses(['instrument-memory']);
    mod.addGlobal(DENORMAL_COUNTER, binaryen.i32, true, mod.i32.const(0));
    mod.addGlobalExport(DENORMAL_COUNTER, DENORMAL_COUNTER);
    const added: binaryen.FunctionInfo[] = [];
    for (let i = 0; i < mod.getNumFunctions(); i++) {
      const info = binaryen.getFunctionInfo(mod.getFunctionByIndex(i));
      if (!before.has(info.name) && info.module === 'env') added.push(info);
    }
    if (!added.some(f => f.base === 'store_val_f64')) throw new Error('instrument-memory added no store_val_f64');
    const bump = () => mod.global.set(DENORMAL_COUNTER, mod.i32.add(mod.global.get(DENORMAL_COUNTER, binaryen.i32), mod.i32.const(1)));
    for (const info of added) {
      const params = binaryen.expandType(info.params);
      const last = params.length - 1;
      const v = () => mod.local.get(last, params[last]!);
      let body = v();
      if (info.base === 'store_val_f64') {
        body = mod.block(null, [
          mod.if(mod.i32.and(mod.f64.lt(mod.f64.abs(v()), mod.f64.const(2.2250738585072014e-308)), mod.f64.ne(v(), mod.f64.const(0))), bump()),
          v(),
        ], binaryen.f64);
      } else if (info.base === 'store_val_f32') {
        body = mod.block(null, [
          mod.if(mod.i32.and(mod.f32.lt(mod.f32.abs(v()), mod.f32.const(1.1754943508222875e-38)), mod.f32.ne(v(), mod.f32.const(0))), bump()),
          v(),
        ], binaryen.f32);
      }
      mod.removeFunction(info.name);
      mod.addFunction(info.name, info.params, info.results, [], body);
    }
    if (!mod.validate()) throw new Error('the instrumented module does not validate');
    return new Uint8Array(mod.emitBinary());
  } finally {
    mod.dispose();
  }
}
