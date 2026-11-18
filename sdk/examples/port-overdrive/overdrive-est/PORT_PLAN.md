# Port plan: Overdrive

`est port` wrote this folder from the source in `original`: 1 source file read, 1 copied into `src/original/`. Nothing in the original folder was changed, built or run. Every find below is a text pattern, so check each one against the source.

**Where this folder stands.** It builds and passes `npx est validate` as it is. It is the kit's C++ template with the parameters below declared and the sound passing through unchanged (`src/adapter.hpp`). The original is not compiled yet. The work left is the adapter: the steps below, in order.

Port only code you wrote, or code whose licence lets you (MIT, BSD, zlib, Apache-2.0, ISC, public domain). Never port a commercial plugin's code or use its name.
Licences seen in the original: `Overdrive.h (SPDX MIT)`. Read them.

## What was found

### Files

| In this folder | From the original | Kind |
|---|---|---|
| `src/original/Overdrive.h` | `Overdrive.h` | header |

### Classes that process audio

- **Overdrive** at `Overdrive.h:10`
  - set-up, `prepare` at line 12: `void prepare(double sampleRate) { sr = sampleRate; reset(); updateTone(); }`
  - set-up, `reset` at line 13: `void reset() { z[0] = z[1] = 0.0f; }`
  - audio, `process` at line 20: `void process(const float* const* in, float* const* out, int n) {`

### Parameters

The ids are final once you share the plugin: never reuse or renumber one. `TODO` means it was not found in the source: the folder uses 0 to 1, starting at 0, until you set it.

| Id | Name | Range | Default | Unit | Setter | Seen at |
|---|---|---|---|---|---|---|
| 0 | Drive | 0 to 36 | TODO | dB | `setDrive` | `Overdrive.h:14` (a setter); `Overdrive.h:5` (a comment: `drive (0..36 dB`); `Overdrive.h:39` (a field: `drive = 1`, a hint for the default, in the DSP's own unit) |
| 1 | Tone | 200 to 12000 | TODO | Hz | `setTone` | `Overdrive.h:15` (a setter); `Overdrive.h:5` (a comment: `tone (200..12000 Hz`); `Overdrive.h:39` (a field: `toneHz = 6000`, a hint for the default, in the DSP's own unit) |
| 2 | Level | -24 to 6 | TODO | dB | `setLevel` | `Overdrive.h:16` (a setter); `Overdrive.h:6` (a comment: `level (-24..+6 dB`); `Overdrive.h:39` (a field: `level = 1`, a hint for the default, in the DSP's own unit) |
| 3 | Mix | 0 to 1 | TODO | TODO | `setMix` | `Overdrive.h:17` (a setter); `Overdrive.h:6` (a comment: `mix (0..1`); `Overdrive.h:39` (a field: `mix = 1`, a hint for the default, in the DSP's own unit) |

## The steps

1. **Read** `src/adapter.hpp` (the class to fill in), `src/plugin.cpp` (the CLAP side: it calls only the adapter) and the original's audio class (Overdrive) in `src/original/`.
2. **Bring the original in.** Include its header in `src/adapter.hpp` and give `Adapter` a member of its class. Each original `.cpp` file the header needs goes into `est-build.json`'s `"sources"` (this original is headers only: nothing to add). Build with `npx est validate` and fix what the compiler says: see "What does not port" and "The maths you have".
3. **Set-up.** `Adapter::prepare(sampleRate)` calls the original's set-up; size every delay line and buffer from that rate, and allocate only here. `Adapter::reset()` clears what rings.
4. **Audio.** `Adapter::process(in, out, channels, from, to)` calls the original's audio method on frames `from` to `to` of each channel (`in[c] + from`, `to - from` frames). If the original wants interleaved samples or a fixed block size, copy through a buffer taken in `prepare`.
5. **Parameters.** `Adapter::setParam(id, v)` calls the original's setter for each id, converting the unit if the knob's unit is not the DSP's. Then make the table above true in **both** places, which must agree: `kParams` in `src/plugin.cpp` (range, default, unit) and `"parameters"` in `est.json` (id, name, unit; add `"scale": "log"` for a frequency). Remove each `TODO(port)` as you go.
6. **State, tail, latency.** State: the template saves every parameter; change `kStateMagic` in `src/plugin.cpp` to four letters of your own. Tail: a reverb, a delay or anything that rings after the input stops needs `clap.tail` and `est.json`'s `limits.tailSeconds` (the validator fails a plugin that sounds past what it reports, EST-C028). Latency: a look-ahead or a linear-phase filter reports its frames in `latencyGet` and in `limits.maxLatencyFrames`. Silence: set a filter or feedback state below 1e-20 to 0 (EST-C027).
7. **The golden test.** `test/golden.json` holds an input and a few parameter changes; make its events exercise your knobs, then `npx est test --update` once the sound is right.

## The maths you have

A module links no C library, but `<cmath>` and `<math.h>` are there (the kit's own, in plain arithmetic, the same result in every browser), so `std::tanh(x)` and `powf(a, b)` compile as they are. Results are within a few 1e-16 of a desktop library, not bit-identical to it.

- **There:** `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh` `tanh` `exp` `exp2` `log` `log2` `log10` `pow` `sqrt` `cbrt` `hypot` `fabs` `abs` `floor` `ceil` `trunc` `round` `fmod` `fmin` `fmax` `copysign` `isnan` `isinf` `isfinite`, each for `float` and `double` (`sinf`, `std::sin`), and `M_PI` and friends. Also `<cstring>`'s `memset`, `memcpy`, `memmove`, `memcmp`, and `malloc`, `free`, `new`, `delete`.
- **Not there:** `long double` `erf` `tgamma` `lgamma` `frexp` `ldexp` `modf` `remainder` `nextafter` `fma` `lround` `lrint`. A missing one shows as a compile error naming it: write it from the ones above.
- **Cost:** `exp`, `exp2`, `tanh`, `sinh`, `cosh` are about 15 multiplications; `sin`, `cos`, `atan` about 20 operations; `log`, `log2`, `log10` and `pow` about 20 divisions. Call `log` and `pow` when a knob moves, not for every sample. `npx est validate` warns when a block costs too much (EST-P001; it depends on the machine and is a warning, not a failure).

## What does not port

An EST plugin is sound code in a sandbox: one thread, no window of its own, no files, no network. These parts of the original stay behind. Each line is where the pattern was seen.

### A native window, or GUI classes

Leave it out. Cyber draws knobs from the parameters in est.json; for your own look, write a page in `ui/` (ui.md in the kit's docs).

None seen.

### Threads, locks, atomics and timers

An EST module has one thread. Do the work in the audio callback, spread a heavy job over several blocks, or work it out once when a knob moves. A `std::atomic` becomes a plain variable; a lock goes away.

None seen.

### Files and printing

There is no file system. Compile the data in (a table in a header), or keep it in the plugin's state or its presets. Remove printing.

None seen.

The build is `c++17` (nothing in the original says which standard: the template's), without exceptions or run-time type information, with no C++ standard library unless your clang brings one for wasm32.

## The checks

```sh
npx est validate          # builds, packs, runs every check Cyber's install runs: read dist/validation.json
npx est test --update     # once the sound is right: writes the golden render
npx est test              # from then on: the golden render and the conformance run
npx est dev               # play it
```

To prove the port against the original, when you have a build of the original that can render a WAV:

```sh
npx est compare dist/<id>-1.0.0.est dist/<id>-1.0.0.est --seconds 3 --write-input build/in.wav --no-build
# render build/in.wav through the original, at the same rate, into build/original.wav, then:
npx est compare dist/<id>-1.0.0.est build/original.wav --input build/in.wav --tolerance -100 --no-build
```

## Done when

- no `TODO(port)` is left in `src/`;
- `npx est validate` says PASS and `npx est test` passes;
- the parameter table above matches `kParams` and `est.json`;
- you have listened to it (`npx est dev`), or compared it with the original.

Then add `dist/<id>-<version>.est` to Cyber: Home, EST PLUGINS, Add a plugin (where adding your own plugins is open; `npx est dev` plays it on your computer either way).
