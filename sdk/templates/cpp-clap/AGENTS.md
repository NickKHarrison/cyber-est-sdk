# An EST effect in C++ (CLAP)

This folder is an EST plugin written as a CLAP plugin in C++: a WebAssembly audio effect that Cyber
(and any EST host) installs from a `.est` bundle. It starts as a smoothed gain. It is the starting
point for porting a C++ plugin (a CLAP one, or the DSP of a VST3, AU or JUCE one) to EST; the guide
is `sdk/docs/porting-cpp.md` in the kit (JUCE: `porting-juce.md`). This file is for you and for any
coding agent working on the plugin; `CLAUDE.md` points here.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. The **only** file that names the plugin: the build writes `build/est_plugin.h` from it. |
| `src/gain.hpp` | The DSP: plain C++, no CLAP, no allocation. Replace it with yours (it may be the same file your desktop build compiles). |
| `src/plugin.cpp` | The CLAP side: the entry, the factory, the descriptor, `kParams`, process, `clap.params`, `clap.state`, `clap.audio-ports`, `clap.latency`. |
| `est-build.json` | How `est` builds it: the sources, include folders, defines, the C++ standard, where the module lands. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `est-manifest-1.schema.json`, `est-validator-rules.json`, `est-abi-1.0.json`, `est-abi-1.1.json`, `est-ui.d.ts` | The contract, machine-readable (copied in by `est new`). |
| `llms.txt` | Where everything is, for a coding agent. |

The CLAP 1.2.2 headers (`<clap/clap.h>`) and the freestanding runtime (`<est/runtime.hpp>`) come
from the kit (`sdk/cpp/include/`); the build puts them on the include path.

## The commands

```sh
est doctor      # Node, and a clang with the wasm32 target and wasm-ld: what is missing and the command to fix it
est pack        # clang to wasm32 (sdk/cpp/build.mjs), then dist/<id>-<version>.est
est validate    # every check Cyber's install runs; a readable report, and validation.json next to the bundle
est test        # the golden render in test/ and the conformance run
est compare dist/<id>-<version>.est reference.wav --input input.wav   # against your desktop build
est dev         # the dev host: play the plugin while you build it
```

`est` is the kit's command, run from a clone of Cyber's repository: `node <cyber>/sdk/packages/cli/bin/est.mjs <command>`, or `npm run est -- <command>` at the clone's root. `node <cyber>/sdk/cpp/build.mjs . --print` prints the exact clang commands, for your own build system.

The toolchain: any clang 16 or newer with the WebAssembly target and `wasm-ld` (Linux `apt install clang lld`, macOS `brew install llvm`, Windows `winget install LLVM.LLVM`), or the clang inside an Emscripten (emsdk) or wasi-sdk install. `est` calls clang directly, never the `emcc` driver (it adds a JavaScript runtime and imports EST refuses). `EST_CLANG=/path/to/clang++` picks one.

## The loop

1. Change `src/gain.hpp` (your DSP) and `src/plugin.cpp` (`kParams`, the events), and `est.json`
   when the parameters or the identity change.
2. `est validate`: it builds, packs and runs every check Cyber's install runs. Read
   `dist/validation.json`: every failed check has a `rule`, a `message`, a `fix` and a `where`.
3. Fix what it names and go back to 2. When it is green, `est test` (after changing the sound on
   purpose, `est test --update`).
4. Listen: `est dev`, or without a screen `est dev --json --seconds 3 < /dev/null`.
5. Install: in Cyber, **Settings → Plugins**, Developer mode, **Load a bundle file…**.

The rule ids are stable; their prefix says where to look: `EST-M` the manifest, `EST-B` the bundle,
`EST-W` the WebAssembly module (imports, exports, memory, features), `EST-C` conformance (lifecycle,
ports, parameters, state, process, determinism, level), `EST-U` a custom UI, `EST-P` performance.
`est-validator-rules.json` has each rule's explanation and fix.

## How the plugin is written

- **Parameters** are declared once, in `kParams` (`id`, name, module, min, max, default, CLAP
  flags, unit). List each id in `est.json`'s `parameters` too (`EST-C008`). Ids are stable for the
  plugin's life: never reuse or renumber one. Values are plain units (dB, Hz), never 0–1.
- **Events** are sample accurate: `Plugin::process` runs the DSP between two events and applies
  each at its own frame. Add your event types in `handleEvent` (notes for an instrument:
  `CLAP_EVENT_NOTE_ON` …, and set `kind` and `notes.inputs` in est.json).
- **activate** is the only place to allocate (`malloc` or `new`): delay lines, tables. Never in
  `process`, the `clap.params` calls or `handleEvent`.
- **The state** is `kStateMagic`, `kStateVersion`, then every parameter. Choose your four magic
  bytes before you ship and **never change them**; raise `kStateVersion` when the bytes change and
  keep loading the old ones.
- **Identity**: `est.json`'s `id` reaches the descriptor through `EST_PLUGIN_ID`; never write the id
  in the source (`EST-C001` when they differ). The kind and ports must match est.json (`EST-C003`,
  `EST-C004`).

### The rules the validator holds you to

- **Allocate nothing** in `process`, the params calls or the event handlers.
- **Be deterministic**: the same input and events give the same output, bit for bit. Use `est::`
  maths from `<est/runtime.hpp>` (`exp`, `log`, `sin`, `cos`, `pow`, `db_to_gain`); no clock and no
  `rand()` in `process`.
- **Import nothing**: no libc, no libm. An "undefined symbol" at the link is a function the module
  would have to import (`sinf`, `printf`, `std::thread` …): use `est::`, or write it.
- **No exceptions, no RTTI, no threads** (`-fno-exceptions -fno-rtti`; one thread: every CLAP
  main-thread call runs on the audio thread between blocks).
- **Stay within the manifest**: the memory maximum is `limits.memoryPagesMax` (the build sets it
  from est.json); no output above +18 dBFS; no NaN.

## A custom UI

None here: Cyber generates knobs from the parameters. A UI is a web page in a sandboxed frame,
never CLAP's `clap.gui`: `ui/index.html` with `est-ui.js` and `"ui"` in est.json. `sdk/docs/ui.md`
in the kit has the guide.

## The golden render

`test/golden.json` says what to play and `test/golden.f32` is what came out; `est test` plays it
again and compares, then runs the conformance checks. **The events name parameters by their id**,
so when you change a parameter, change the events too. After changing the sound on purpose,
`est test --update`, listen, and commit both files.
