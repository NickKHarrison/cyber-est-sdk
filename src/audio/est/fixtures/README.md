# EST Phase 1 fixtures

Small CLAP plugins in C, built to wasm32 for the EST runtime (`src/audio/est/runtime/`), the EST lab
(Settings → About → Diagnostics… → EST lab…, admins only) and the tests. See
`docs/est/EST_Phase1_Work_Order.md` §1.2.

| File | What |
|---|---|
| `gain.c` | EST Gain: one stereo in and out port, a smoothed Gain in dB (-60 to +12, sample-accurate), Bypass, `clap.state`, `clap.latency` 0 |
| `trap.c` | EST Trap: EST Gain that traps (`unreachable`) on its 100th `process()` |
| `spin.c` | EST Spin: EST Gain that never returns from its 100th `process()` (stalls the whole AudioContext) |
| `gainsimd.c` | EST Gain SIMD (1.282): EST Gain with its samples multiplied four frames at a time in fixed-width SIMD (`wasm_simd128.h`, built with `-msimd128`), for the meter's SIMD path (spec §3.6) |
| `synth.c` | EST Synth: eight sine voices, note on/off/choke at their sample, a release tail, `NOTE_END` reported |
| `synth-trap.c` | EST Synth Trap (1.286, ET-B): EST Synth that traps (`unreachable`) on the 100th block after its first note-on, so a note is sounding when it traps (the security checklist's §9.4 for instruments, `e2e/est-instrument.spec.ts`) |
| `probe.c` | EST Probe (1.283, EST Phase 3): an instrument that logs every input event (notes with their ids, chokes, note expressions, MIDI, parameters, transport events with their offsets) and each block's transport, read back through its `clap.state` save; silent; a 0.25 s tail |
| `hostcalls.c` | EST Host Calls (1.314, LR-8b, EST-02): EST Gain that imports `random_get` and `fd_write` with their preview-1 types and asks the host for what it must refuse or bound (a pointer outside its memory, 2^31 iovecs, a fair 4 KiB), each return code written to its block's first sample over 100 |
| `nanout.c` | EST NaN Out (1.314, LCH-21 a): EST Gain that writes NaN, +∞, +100 and −100 from its 10th block: the host's output check zeroes and clamps them and counts the faults |
| `est_rt.h` | The freestanding runtime they share: `memset`, `memcpy`, the exported `malloc`/`free`, the maths |
| `clap/` | The official CLAP 1.2.2 headers (`include/`) and their MIT licence (`LICENSE`), unchanged from github.com/free-audio/clap at tag 1.2.2 (`27f20f8`) |

Each `*.wasm` is committed. It exports `clap_entry` (an `i32` global), `malloc`, `free`, its function
table (`__indirect_function_table`, growable: the host adds its callbacks to it) and `memory` (4 pages,
at most 64), and imports nothing (1.314: `hostcalls.wasm` imports the two WASI functions it tests). Only `gainsimd.wasm` uses SIMD.

## Rebuilding

Needs `clang` and `wasm-ld` (LLVM 18 was used; no Emscripten, no libc):

```bash
bash scripts/est-fixtures.sh
```

The build is reproducible: the same compiler gives the same bytes. After changing a fixture, run
`npx vitest run src/audio/est` and the browser spec (`e2e/est-runtime.spec.ts`).

## The ABI table

`src/audio/est/abi/est-abi-1.0.json` is derived from the headers here by `node scripts/est-abi.mjs`
(clang `--target=wasm32` prints every `sizeof`, `_Alignof` and `offsetof` through a tiny module run in
Node). `node scripts/est-abi.mjs --check` re-derives it and fails on any difference;
`scripts/est-abi.test.mjs` checks it against the ILP32 rules without clang.
