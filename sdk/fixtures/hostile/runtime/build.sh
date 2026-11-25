#!/usr/bin/env bash
# 1.902 (the sandbox review): builds the hostile runtime fixtures' modules in
# sdk/fixtures/hostile/runtime/wasm/ from src/ (each Phase 1's EST Gain, src/audio/est/fixtures/gain.c,
# with one attack on the worklet processor), with clang and wasm-ld exactly as
# sdk/fixtures/broken/build.sh builds the broken ones. The modules are committed, so the suite needs
# no toolchain. Never packed into est-plugins/, never listed, never signed.
#   bash sdk/fixtures/hostile/runtime/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
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
