# An EST effect in C++ (CLAP)

This folder is an EST plugin written as a CLAP plugin in C++: a WebAssembly audio effect that Cyber installs from a `.est` bundle. It starts as a smoothed gain; you change it into the plugin described under **What to build**. It is also the starting point for porting a C++ plugin (a CLAP one, or the DSP of one in another format).

## What to build

<!-- est:idea -->
Nobody has said yet what this plugin should do. Ask the person for one sentence, write it here, then build it.
<!-- /est:idea -->

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. The **only** file that names the plugin. |
| `src/gain.hpp` | The DSP: plain C++. Replace it with yours. |
| `src/plugin.cpp` | The CLAP side: entry, factory, descriptor, `kParams`, process, parameters, state, ports. |
| `est-build.json` | How `est` builds it: sources, include folders, defines, the C++ standard. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

## The loop

Run `est` as `npx est <command>` in this folder: `package.json` pins the kit (if `node_modules` is missing, `npm install` first). Never a bare `npx est` in a folder without the kit: npm would fetch another package of that name.

1. Read **What to build**. Change the source and, when the parameters or the identity change, `est.json`.
2. `npx est validate` builds, packs `dist/<id>-<version>.est` and runs every check Cyber runs when a plugin is added. Read `dist/validation.json`: each failed check has `rule`, `message`, `fix` and `where`. Fix and repeat until `"ok": true`.
3. `npx est test`: the golden render in `test/` and the conformance run. After changing the sound on purpose: `npx est test --update`.
4. Hear it (below), then tell the person what you built and the choices you made for them.

**Follow the `Next:` line** that ends every `est validate`, `est test`, `est doctor` and `est dev` build: the first error or failed check with its fix, or the next step.

Also: `npx est doctor` (what is wrong with this folder or machine, and the fix), `npx est pack` (build and pack only), `npx est profile --json` (which function costs most).

Rule ids are stable; the prefix says where to look: `EST-M` the manifest, `EST-B` the bundle, `EST-W` the WebAssembly module, `EST-C` conformance and behaviour, `EST-U` the window, `EST-P` speed (a warning). `est-validator-rules.json` lists every rule: `id`, `title`, `explain`, `fix`, `severity`.

## The rules

- **Allocate nothing while playing**: not in `render`, `process`, the parameter hook or a note handler.
  - `malloc` or `new` only in `activate`. No exceptions, no RTTI, no threads, no libc, no libm: an "undefined symbol" at the link is a function the module would have to import (`sinf`, `printf` …); use `est::` or write it.
- **Be deterministic, import nothing**: the same input and events give the same output, bit for bit. No clock, no file, no host function. For noise, step your own seed, a 32-bit xorshift (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset`.
- **Size every buffer and time from the sample rate `activate` gives.** The validator runs at 48 kHz; Cyber runs at the device's rate.
- **The ids agree**: the descriptor's id is `est.json`'s `id` (`EST-C001`); the kind and ports match (`EST-C003`, `EST-C004`); each parameter has one numeric id in the code, in `est.json`'s `parameters`, in `test/golden.json`'s events and in the window (`EST-C008`), and it never changes.
- **The state magic** (four characters, where the plugin is described) never changes once anyone has a version.
- **Stay in range**: no output above +18 dBFS, no NaN, memory within `limits.memoryPagesMax` (64 KiB pages).
- **Flush tiny numbers** (`EST-C027`): set a state that feeds itself (a feedback path, a filter's memory, an envelope falling to 0) to 0 once it is below `1e-20`.
- **Every version is new**: bump `version` in `est.json` for each build you hand to anyone.

## How it is written (C and C++)

- **`est.json` is the only file that names the plugin**: the build writes `build/est_plugin.h` from it, and the descriptor reads `EST_PLUGIN_ID`. Never write the id in the source.
- **The DSP** is plain C++ in `src/gain.hpp`: no CLAP, no allocation. Replace it with yours; it may be the same file a desktop build compiles.
- **The CLAP side** is `src/plugin.cpp`: the entry, the factory, the descriptor, `kParams`, `process`, `clap.params`, `clap.state`, `clap.audio-ports`, `clap.latency`.
- **Parameters** are declared once, in `kParams` (id, name, module, min, max, default, flags, unit), and listed in `est.json`. Values are plain units (dB, Hz), never 0 to 1.
- **Events are sample accurate**: `Plugin::process` runs the DSP between two events and applies each at its frame. Add your event types in `handleEvent` (for an instrument: `CLAP_EVENT_NOTE_ON` and the rest, and set `kind` and `notes.inputs` in `est.json`).
- **`activate`** is the only place to allocate: delay lines, tables.
- **The state** is `kStateMagic`, `kStateVersion`, then every parameter.
- `est-build.json` lists the sources, include folders, defines and the C++ standard. `npx est pack --print` prints the exact clang commands.
- **The toolchain**: any clang 16 or newer with the WebAssembly target and `wasm-ld` (`npx est doctor` says what is missing). `est` calls clang directly, never the `emcc` driver, which adds imports EST refuses. `EST_CLANG=/path/to/clang++` picks one.
- **Check a port against the original**: `npx est compare dist/<id>-<version>.est reference.wav --input input.wav`, with a render from the desktop build.
- **What does not come across**: a native window toolkit (the window is a web page), threads, files, the network.

## The runtime on one page (C and C++)

There is no libc and no system libm. `<est/runtime.hpp>` (on the include path, with the CLAP 1.2 headers as `<clap/clap.h>`) has everything below, as `est_name` in C and `est::name` in C++; the maths takes and returns `double`. For a port, `<cmath>` and `<math.h>` also work (`std::tanh`, `sinf` and the rest, `float` and `double`; the header's opening comment lists what they have and have not). `exp` and `tanh` are cheap; `log` and `pow` cost about 20 divisions, so call them when a knob moves, not per sample.

- **Maths**: `est_fabs(x)`, `est_sqrt(x)`, `est_floor(x)`, `est_clamp(x, lo, hi)`, `est_exp(x)`, `est_fast_exp(x)` (no division: the one to call per sample), `est_tanh(x)`, `est_atan(x)`, `est_log(x)`, `est_pow(base, ex)`, `est_sin(x)`, `est_cos(x)`, `est_tan(x)` (radians), `est_db_to_gain(db)`, `est_gain_to_db(gain)`; the constants `EST_PI`, `EST_LN2`, `EST_LN10`.
- **Text**: `est_streq(a, b)`, `est_strcpy(dst, src, cap)`.
- **State streams**: `est_write_all(stream, data, n)`, `est_read_all(stream, data, n)`: each is true only when every byte moved.
- **Placement `new`** is defined; `EST_EXPORT(name)` exports a function.

## What costs time

`npx est validate` reports a block's mean cost and warns past 100 µs (`EST-P001`, a warning only). The warning is the best of three runs, so the cost is real (`npx est profile --json` names the function). The usual causes:

- **`est_exp`, `est_log`, `est_pow`, `est_sin` a sample.** Each is a loop of divisions. Work them out when a parameter changes, and smooth the result.

## Following the song

The transport (tempo, beat, playing) is **as of the block's first sample**, or of a transport event inside the block. It does not move while you render: keep your own beat and add `tempo / 60 / sampleRate` each sample while it plays. With no transport event `playing` is false, and `npx est validate` and the default golden render run that way.

To prove a plugin that follows the tempo, put a transport event in `test/golden.json`'s `events` (every field is needed; `time` in seconds):

```json
{ "type": "transport", "time": 0, "tempo": 120, "beat": 0, "seconds": 0, "num": 4, "den": 4, "barStart": 0, "barNumber": 0, "playing": true }
```

Count bars from `barStart`, never from beat 0.

## A delay or a reverb

- **Memory.** A buffer of floats holds 4 bytes a frame: a second of stereo at 96 kHz is about 12 pages of 64 KiB. Raise `limits.memoryPagesMax` in `est.json`; the build sets the module's maximum from it.
- **The tail.** Report how long it rings, in frames, through `clap.tail`, and keep `limits.tailSeconds` in `est.json` at least that long. It may be 60 at most: cap the feedback (or the time) so it dies inside that. `EST-C028` fails a plugin that still sounds after the tail it reports.
- **Noise of its own.** An effect that sounds with silence in (hiss, crackle) trips `EST-C028` too: fade it out when the input stops.

## Easy to get wrong

- **A frequency or time knob** wants a log scale: `"scale": "log"` on its row in `est.json`'s `parameters`.
- **`test/golden.json`'s events name parameters by id** (`{ "type": "param", "time": 0.1, "id": 1, "value": 800 }`: plain units, seconds). Change them when a parameter changes, then `npx est test --update`.
- **`test/golden.f32`** is every left frame, then every right frame (little-endian float32), not interleaved.
- **validate's `peak`** is the stress run's worst case, not the level at the defaults.

## Hear it

- With a screen: `npx est dev` opens a page that plays the plugin (add `--port 0 --files-port 0` if a port is taken).
- Without one: `npx est dev --json` needs a browser download (Playwright's Chromium; `npx est doctor` says how). Without it, **still check**: `npx est demo` writes `dist/demo.wav`, and `test/golden.f32` is the plugin's real output. Read one and check the level and the shape (silent? clipping? does a knob change it?). Tell the person what you checked, and that nobody has listened yet.

## The window

Cyber draws knobs from the parameters, and that is enough to start. A window of your own is a web page in the bundle (`ui/index.html`, named by `"ui"` in `est.json`), never a native one: scripts as files, nothing from another host, no `fetch`. The `EST-U` rules in `est-validator-rules.json` say what a page may hold, and `est-ui.d.ts` has the page library's types.

## Put it in Cyber

In Cyber, on Home: **EST PLUGINS → Add a plugin**, and drop `dist/<id>-<version>.est` there. Cyber runs the same checks; a refusal names the same rule id. It stays on the person's own account.

Publishing on the EST Store is a later step and the person's choice: a published id starts with their own `dev.<10 hex>` name, which Cyber shows them, in `est.json` and in the source alike.
