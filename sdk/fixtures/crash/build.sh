#!/usr/bin/env bash
# 1.669 (the crash replayer): builds the planted crashing fixture's module twice from src/crash-spike.c
# (Phase 1's EST Gain with FIXTURE_FAULT_SPIKE, src/audio/est/fixtures/gain.c) with clang and wasm-ld
# exactly as sdk/fixtures/broken/build.sh builds its modules: wasm/crash-spike.wasm stripped (a
# release build: functions by index) and wasm/crash-spike-named.wasm keeping its name section (what
# `est replay --debug` builds). The modules are committed, so the suite needs no toolchain.
#   bash sdk/fixtures/crash/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
FIX="$ROOT/src/audio/est/fixtures"
mkdir -p "$HERE/wasm"
cd "$HERE/src"
for variant in stripped named; do
  strip=(-Wl,--strip-all)
  out="$HERE/wasm/crash-spike.wasm"
  if [ "$variant" = named ]; then strip=(); out="$HERE/wasm/crash-spike-named.wasm"; fi
  clang --target=wasm32 -std=c11 -O2 -nostdlib -ffreestanding -fvisibility=hidden \
    -Wall -Wextra -Werror -Wno-unused-function \
    -I "$FIX" -I "$FIX/clap/include" \
    -Wl,--no-entry -Wl,--export-dynamic -Wl,--export-table -Wl,--growable-table \
    -Wl,-z,stack-size=65536 -Wl,--initial-memory=262144 -Wl,--max-memory=4194304 \
    ${strip[@]+"${strip[@]}"} \
    -o "$out" crash-spike.c
  echo "built $(basename "$out") ($(wc -c < "$out") bytes)"
done
