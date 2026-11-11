#!/usr/bin/env bash
# EST Phase 4 (docs/est/EST_Phase4_Work_Order.md §1, 4-A): builds the broken fixtures' modules in
# sdk/fixtures/broken/wasm/ from their sources in src/ (each Phase 1's EST Gain or EST Synth,
# src/audio/est/fixtures/, with one fault), with clang and wasm-ld exactly as
# scripts/est-fixtures.sh builds the Phase 1 fixtures (no Emscripten, no libc), then start.wasm
# (EST Gain with a start function) with Binaryen (build-start.mjs). The modules are committed, so
# the suite needs no toolchain; the build is reproducible (the same compiler gives the same bytes).
#   bash sdk/fixtures/broken/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
FIX="$ROOT/src/audio/est/fixtures"
mkdir -p "$HERE/wasm"
cd "$HERE/src"
for src in *.c; do
  name="${src%.c}"
  clang --target=wasm32 -std=c11 -O2 -nostdlib -ffreestanding -fvisibility=hidden \
    -Wall -Wextra -Werror -Wno-unused-function \
    -I "$FIX" -I "$FIX/clap/include" \
    -Wl,--no-entry -Wl,--export-dynamic -Wl,--export-table -Wl,--growable-table \
    -Wl,-z,stack-size=65536 -Wl,--initial-memory=262144 -Wl,--max-memory=4194304 \
    -Wl,--strip-all \
    -o "$HERE/wasm/$name.wasm" "$src"
  echo "built $name.wasm ($(wc -c < "$HERE/wasm/$name.wasm") bytes)"
done
node "$HERE/build-start.mjs"
