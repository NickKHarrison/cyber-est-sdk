# Porting a C++ plugin

For a developer with a CLAP, VST3, AU or JUCE plugin in C++. EST is CLAP 1.2 compiled to WebAssembly ([porting-clap.md](porting-clap.md) says what it adds and refuses), so a C++ CLAP plugin ports with its shape intact. For a VST3, AU or JUCE plugin you port the DSP, not the wrapper. JUCE has its own page: [porting-juce.md](porting-juce.md).

## Start from the template

```
est doctor                                     # is there a clang for wasm32?
est new cpp-clap ~/plugins/my-port --id com.example.my-port --name "My Port"
cd ~/plugins/my-port
est validate                                   # builds (clang to wasm32), packs, runs Cyber's install checks
est test                                       # the golden render and the conformance run
```

The folder:

| File | What |
|---|---|
| `src/gain.hpp` | The DSP: plain C++, no CLAP, no allocation. Put yours here, or include the file your desktop build already compiles. |
| `src/plugin.cpp` | The CLAP side, shaped like the CLAP SDK's own plugin template (`clap/src/plugin-template.c`): the entry, the factory, the descriptor, the parameters (`kParams`), sample-accurate `process`, `clap.params`, `clap.state`, `clap.audio-ports`, `clap.latency`. |
| `est-build.json` | The build: sources, include folders, defines, the C++ standard, SIMD on or off. |
| `est.json` | The manifest. It is the only file that names the plugin: the build writes `build/est_plugin.h` (`EST_PLUGIN_ID`, `EST_PLUGIN_NAME`, …) from it, and the descriptor uses those. |
| `test/` | The golden render. |

The headers come from the kit, so the folder needs nothing vendored: `<clap/clap.h>` (CLAP 1.2.2, unchanged, MIT) and `<est/runtime.hpp>` (below), both in `sdk/cpp/include/`.

The template ports a gain, written as the CLAP SDK's plugin template with the smoothed gain every CLAP example has. Replace `gain.hpp` with your DSP and `kParams` with your parameters; the rest of `plugin.cpp` stays as it is for most effects.

## The toolchain

Any clang 16 or newer with the WebAssembly target and `wasm-ld`:

| System | Install |
|---|---|
| Ubuntu, Debian | `sudo apt install clang lld` |
| macOS | `brew install llvm` (Apple's own clang has no `wasm-ld`) |
| Windows | `winget install LLVM.LLVM` |
| Emscripten or wasi-sdk already installed | nothing: `est` uses the clang inside it (`$EMSDK/upstream/bin`, the one beside `emcc`, `$WASI_SDK_PATH/bin`) |

`EST_CLANG=/path/to/clang++` picks one. `est doctor` says which it found and why it passed others over. `est` never downloads a toolchain.

**Why not `emcc` itself.** The `emcc` driver links Emscripten's JavaScript runtime and its libc, which import functions from JavaScript (`emscripten_memcpy_js`, `fd_write` …). EST's module imports nothing outside a small WASI subset (`EST-W004`). Emscripten's clang without the driver builds the bare module EST needs, so `est` calls that clang directly.

**The flags** (`sdk/cpp/toolchain.mjs`; `node <cyber>/sdk/cpp/build.mjs . --print` prints the exact commands, for your own build system):

- code: `--target=wasm32 -O2 -mcpu=mvp -mmutable-globals -msign-ext -mnontrapping-fptoint -nostdlib -ffreestanding -fvisibility=hidden -ffp-contract=off -fno-math-errno`, and for C++ `-fno-exceptions -fno-rtti -fno-threadsafe-statics`. The feature list is pinned, so every clang from 16 on gives the same instructions; `"simd": true` in `est-build.json` adds `-msimd128` (fixed-width SIMD; relaxed SIMD is refused);
- link: `--no-entry --export-if-defined=clap_entry --export-table --growable-table -z stack-size=65536 --initial-memory=… --max-memory=<est.json's memoryPagesMax × 64 KiB> --strip-all`. The table is exported and growable because the host adds its callbacks to it; the memory maximum comes from est.json, so the two never disagree (`EST-W009`).

**Reproducible.** The build maps its paths out (`-ffile-prefix-map`), strips the module, and never lets clang run `wasm-opt`: clang's wasm driver runs one it finds (beside itself, as in emsdk, or on PATH, where npm puts binaryen's) after any link given an `-O` level, so the bytes would depend on which binaryen happened to be installed. The link step is given no `-O` (the objects are already optimised), so the driver never runs it, and clang also runs with PATH's folders that hold a `wasm-opt`, and every relative PATH entry, removed. The same clang gives the same bytes from any folder.

**Building a folder runs that folder's build.** As `cargo build` runs a crate's build script, `est pack` on a folder compiles the sources it names with the flags it gives, so build only folders you trust. `est-build.json` may not pass a flag that runs or loads another program or names the output (`-fuse-ld`, `--ld-path`, `-B`, `-fplugin`, `-fpass-plugin`, `-Xclang`, `-Xlinker`, `-mllvm`, `-load`, `--sysroot`, `-o`, a `@file` response file), nor an absolute path or one through `..` in its flags, and its `module` stays inside the folder; a refusal names the flag. A build that needs those (a wasi-sdk sysroot, say) is your own build system's: `node <cyber>/sdk/cpp/build.mjs . --print` gives the commands to start from.

## What breaks, and what EST has instead

| Desktop C++ | In an EST module | Instead |
|---|---|---|
| libc and libm (`memcpy`, `sinf`, `printf`, `std::vector`'s allocator …) | not there: the module imports nothing | `<est/runtime.hpp>`: `memset`, `memcpy`, `memmove`, `memcmp`, `malloc`, `free`, `new`, `delete`, `est::exp`, `log`, `pow`, `sin`, `cos`, `tan`, `db_to_gain`, `gain_to_db` (`sqrt`, `floor`, `fabs` are single instructions). A link error "undefined symbol: sinf" names the function to replace. A wasi-sdk libc can be linked by your own build system (not `est-build.json`, which refuses `--sysroot`) within the import rules, but nothing it does may touch files or the clock. |
| The C++ standard library (`<vector>`, `<string>`, `<algorithm>`) | no library headers for bare wasm32 | header-only parts that need no runtime work if you bring a libc++ sysroot (wasi-sdk's); most DSP needs only fixed arrays. `<cstdint>` and `<cstddef>` are provided. |
| Exceptions, RTTI | refused (`-fno-exceptions -fno-rtti`; the meter refuses the exceptions proposal) | return codes; `static_cast` |
| Threads, `std::thread`, `std::atomic` waits, `clap.thread-pool` | one thread (no shared memory, no atomics) | do the work in `process`; spread a heavy job over blocks |
| `clap.gui`, a native window, an OpenGL editor | refused | a web page in a sandboxed frame ([ui.md](ui.md)), or Cyber's generated knobs from your parameters |
| Files: reading samples, impulse responses, a preset folder | no file system | the bundle's `assets`, `clap.state`, presets in `presets/` ([manifest.md](manifest.md)) |
| A clock, `rand()`, `std::random_device` in `process` | not deterministic (`EST-C018`: the validator renders twice) | a PRNG seeded from your state |
| Allocation in `process` | refused by the rules (the validator watches the heap) | allocate in `activate`, sized from its maximum frames |
| Static constructors | run once, by `_initialize`, before the host reads `clap_entry` | the same, but keep them cheap: they run under the meter |
| Memory without a ceiling | refused | `limits.memoryPagesMax` in est.json (at most 2048 pages, 128 MiB) |
| Denormals (`juce::ScopedNoDenormals`, FTZ) | WebAssembly has no flush-to-zero | add a tiny DC offset or flush in your feedback paths |
| `long double`, 80-bit maths | `long double` is 128-bit software maths on wasm32, very slow | `double` |

## Checking a port: `est compare`

`est compare` renders the same input and events through two things and tells you how they differ: two bundles (before and after a change), or a bundle and a WAV your desktop build rendered from the same input.

```
est compare old.est new.est                                   # two versions, seeded noise in
est compare dist/my-port-1.0.0.est desktop.wav --input in.wav # the module against the desktop build
```

The loop against the desktop build:

1. `est compare dist/x.est dist/x.est --seconds 5 --write-input in.wav`: the input, as a 32-bit float WAV (or bring your own WAV).
2. Render `in.wav` through your desktop build, offline, at the same sample rate, with the same parameter changes at the same times, into `desktop.wav`. The JUCE kit's `reference/render.cpp` is a tiny example of such a renderer.
3. `est compare dist/x.est desktop.wav --input in.wav --events events.json --tolerance -100`.

It reports, per channel: each side's peak and RMS, the level difference, the peak and RMS of the difference B − A, the difference in ten octave bands (31.5 Hz to 16 kHz), and the first frame where they part by more than `--threshold` (default: the tolerance). It writes `est-compare.html` (`--report`): the tables and the two waveforms overlaid, with the difference under them. It exits 1 when the difference's peak passes `--tolerance` (dBFS, default −80), the lengths differ, or either side holds a NaN or an infinity anywhere (counted per channel, the first reported as where they part, whatever the tolerance), so it can gate a script; `--json` prints the same report.

`--events` takes the EST processor's own events (`{"type":"param","time":0.5,"id":0,"value":-6}`, `noteOn`, `noteOff` …, time in seconds; a `golden.json`'s `events` work as they are); `--events-a` and `--events-b` add events to one side only, for a parameter that maps differently in the port. `--input` is `noise` (default), `sine`, `impulse`, `silence` (an instrument: send notes) or a WAV.

A bundle renders on the same code Cyber plays it with: `@est/tools`' `render`, Cyber's `est-plugin` processor on the conformance host, metered as at install, in 128-frame blocks. It is not the dev host's browser page: a browser's audio clock is not repeatable, and a comparison has to be.

What to expect. The same DSP built natively and for EST should differ by nothing, or by a float's last bit where the maths differs (`est::exp` against your libm's `exp`): the JUCE kit's shared gain is identical, bit for bit. Bigger differences have causes worth finding: a parameter that maps differently (normalised 0–1 against plain units), smoothing that starts at a different value, the host's block size (EST splits blocks at every event), latency not reported (the first divergence is at the latency), or an `-ffast-math` or FMA contraction in the desktop build (build the shared DSP with `-ffp-contract=off` there too).

## From VST3 or AU

Keep the DSP class; drop the wrapper. Put the DSP behind a plain C++ interface (`prepare`, `process` on channel pointers between two frames, setters in plain units), include it from `src/plugin.cpp` as the template includes `gain.hpp`, and declare the parameters in `kParams`. The checklist in [vibe-coding-guide.md](vibe-coding-guide.md) §8 goes through parameters, sample rate, latency, bypass, state and presets.
