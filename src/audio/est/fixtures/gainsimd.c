/*
 * EST Gain SIMD (EST 1.282 fixture): EST Gain with its samples multiplied four frames at a time in
 * fixed-width WebAssembly SIMD (`wasm_simd128.h`, built with -msimd128; spec §3.6 allows it, relaxed
 * SIMD is refused). Proves the meter (src/audio/est/install/estMeter.ts), the bundle reader, the
 * runtime and the conformance run take a v128 module. Its gains are rounded to f32 before the
 * multiply, so it matches EST Gain within an f32 rounding, not bit for bit.
 */
#define FIXTURE_ID "org.cyber.est.gainsimd"
#define FIXTURE_NAME "EST Gain SIMD"
#define FIXTURE_SIMD 1
#include "gain.c"
