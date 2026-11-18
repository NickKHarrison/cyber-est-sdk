# Port your plugin

You have an effect or an instrument in C or C++: a VST, an AU, a CLAP plugin, or plain DSP code. Its sound code can run in Cyber as an EST plugin. One command reads your source and writes a new plugin folder with a plan in it; your assistant (or you) follows the plan.

Port only code you wrote, or code whose licence lets you (MIT, BSD, zlib, Apache-2.0, ISC, public domain). Never port a commercial plugin's code or use its name.

You need Node 20 or newer, and clang with the WebAssembly target and `wasm-ld` (`npx @cyber-est/cli doctor` says, and names the install command).

## What comes across, and what does not

An EST plugin is sound code in a sandbox. The part of your plugin that turns samples into samples comes across. These do not:

- **The window.** A native window toolkit, an editor class, custom drawing: none of it runs. Cyber draws knobs from your parameters, or you write a page in `ui/` ([ui.md](ui.md)).
- **Threads.** One thread. No worker threads, locks, atomics or timers. Do the work in the audio callback, or work it out once when a knob moves.
- **Files and the network.** No file system, no sockets. Compile data in (a table in a header), or keep it in the plugin's state or presets.

Also: no exceptions or run-time type information, no clock and no `rand()` (the validator renders twice and compares), and no C++ standard library unless your clang brings one for wasm32 (`<cmath>`, `<math.h>`, `<cstring>`, `<cstdint>` and `<cstddef>` are always there). The full table is in [Porting a C++ plugin](porting-cpp.md#what-breaks-and-what-est-has-instead).

`est port` finds each of these in your source and lists it by file and line.

## 1. One command

```sh
npx @cyber-est/cli port path/to/your/source
```

It reads your folder (or one file) as text. It runs nothing in it, builds nothing, changes nothing, and follows no symbolic link. It writes a **new** folder beside it, `<name>-est` (`--out` names another; `--id` and `--name` set the plugin's id and name; `--json` prints what it found; `--dry-run` writes nothing):

| In the new folder | What |
|---|---|
| `PORT_PLAN.md` | What was found, the steps to finish, the maths you have, the checks, and what does not port. |
| `src/original/` | Your DSP files, copied. Window code stays behind. |
| `src/adapter.hpp` | The one class to fill in: it will call your code. For now it passes the sound through. |
| `src/plugin.cpp`, `est.json` | The CLAP side and the manifest, with the parameters `est port` found already declared in both. |
| `est-build.json` | The build: the include folders, the C++ standard your build files name, and a record of your `.cpp` files to add. |

What it looks for: classes with a `process…`, `render…` or `tick` method; set-up methods (`prepare…`, `setSampleRate`, `reset`); and parameters, from setters such as `setDrive(float)`, ranges written in comments, parameter tables and enums, and parameter layout declarations (an id, a name, a range, a default). Every find is a text pattern and is listed with where it was seen, so check them. Where a range, default or unit was not found the plan says `TODO` and the folder uses 0 to 1.

Then:

```sh
cd <name>-est
npm install --save-dev --save-exact @cyber-est/cli
npx est validate        # PASS at once: your knobs are there, the sound passes through
```

The folder is green from the first minute. The work left is the adapter.

## 2. One prompt

Open the new folder in your assistant and say:

> Follow PORT_PLAN.md. Finish the port: make `src/adapter.hpp` call the original class in `src/original/`. Set each parameter's range, default and unit in `kParams` in `src/plugin.cpp` and in `est.json`, so that the two agree. Give the state its own four letters. Then run `npx est validate` and fix what it reports until it says PASS; run `npx est test --update`, then `npx est test`. Leave no `TODO(port)` in `src/`. At the end tell me what you changed, and anything in the plan that turned out wrong.

The plan holds everything the assistant needs, so it reads no other page.

## 3. What the plan asks for

- **The adapter** (`src/adapter.hpp`): include your header, hold your class, and pass on four calls: `prepare(sampleRate)`, `reset()`, `setParam(id, value)` and `process(in, out, channels, from, to)`. List each `.cpp` file your header needs in `est-build.json`'s `"sources"`.
- **The parameters**, in two places that must agree: `kParams` in `src/plugin.cpp` (range, default, unit) and `"parameters"` in `est.json` (id, name, unit; `"scale": "log"` for a frequency). Ids are final once you share the plugin.
- **Size from the sample rate.** A buffer sized for 44.1 kHz is wrong at 48 kHz: size every delay line from the rate `prepare` receives, and allocate only there.
- **Tail and latency.** Anything that rings after the input stops (a reverb, a delay) needs `clap.tail` and `est.json`'s `limits.tailSeconds` (at most 60); `EST-C028` fails a plugin that sounds past what it reports. A look-ahead reports its latency.
- **Silence.** WebAssembly has no flush-to-zero. Set a filter or feedback state below 1e-20 to 0; `EST-C027` counts the ones that stick.
- **Zipper noise.** Glide a gain over about 10 ms when its knob moves.

## 4. The maths you have

Your source's `#include <cmath>` works. The kit has its own `<cmath>` and `<math.h>`, in plain arithmetic, so `std::tanh(x)`, `std::pow(a, b)` and `sinf(x)` compile as they are and give the same result in every browser.

- **There:** `sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2 log10 pow sqrt cbrt hypot fabs abs floor ceil trunc round fmod fmin fmax copysign isnan isinf isfinite`, for `float` and `double`.
- **Not there:** `long double`, `erf`, `tgamma`, `lgamma`, `frexp`, `ldexp`, `modf`, `remainder`, `nextafter`, `fma`, `lround`, `lrint`. A missing one is a compile error that names it.
- **Cost:** `exp` and `tanh` are about 15 multiplications; `log` and `pow` about 20 divisions. Call `log` and `pow` when a knob moves, not for every sample. `est validate`'s block-cost warning (`EST-P001`) depends on your machine and is only a warning.

Results are within a few 1e-16 of a desktop maths library, not bit-identical to it.

## 5. Prove it against the original

If you have a build of the original that can render a WAV, compare. `--write-input` writes the input both sides process:

```sh
npx est compare dist/<id>-1.0.0.est dist/<id>-1.0.0.est --seconds 3 --sample-rate 44100 --write-input build/in.wav --no-build
./your-original-render build/in.wav build/original.wav
npx est compare dist/<id>-1.0.0.est build/original.wav --input build/in.wav --tolerance -100 --no-build
```

`SAME` is the goal at the original's sample rate.

## 6. Presets, the golden test, playing it

**Presets** are files of the plugin's own state bytes. The C++ template's state is: u32 magic, u32 version, u32 parameter count, then one f64 per parameter in `kParams` order. Write them with a small script into `presets/`, list them in `presets/index.json` (`{ "presets": [{ "name", "path", "tags", "stateVersion" }] }`) and name that file in `est.json`'s `"presets"`.

**The golden test.** Make `test/golden.json`'s events move your knobs, then `npx est test --update` once and `npx est test` from then on.

```sh
npx est dev             # play it; add --port 0 --files-port 0 if a port is taken
npx est profile         # where a block's cost goes
npx est demo            # dist/demo.wav, a demo clip
```

To load it into Cyber and share it: [Sharing what you made](SHARING.md). To publish it: [Publish a plugin on the EST Store](PUBLISH_ON_THE_EST_STORE.md).

## A worked example

The kit's public repository (https://github.com/NickKHarrison/cyber-est-sdk) has one port from start to finish, in `sdk/examples/port-overdrive/`: a small overdrive in plain C++ (written for the example, taken from no product), the folder `est port` wrote from it, finished, with its `PORT_PLAN.md` as written, and `PROMPT.md`, the command and the prompt. The original class is compiled into the plugin unchanged; the adapter is about forty lines, and its one new rule is the silence step above.

Before `est port` existed, a test builder ported the same overdrive from the plain template with one sentence: the first validate passed at 1.1 minutes and the port was done in 3.9 minutes, after reading six files, rewriting the DSP, writing a `tanh` and replacing a slow `exp`. `est port` and the kit's `<cmath>` remove those steps.

## If you would rather do it by hand

`npx @cyber-est/cli new cpp-clap my-plugin` gives the same template without a plan: copy your DSP into `src/`, replace `src/gain.hpp`, list your `.cpp` files in `est-build.json`, and fill `kParams`. `npx est pack --print` prints the exact clang commands. [Porting a C++ plugin](porting-cpp.md) has every detail.

## From JUCE

A JUCE plugin keeps its desktop build: move the DSP behind a plain interface both builds share. The kit's example, `sdk/kits/juce-shared-dsp/`, is in the kit's public repository (https://github.com/NickKHarrison/cyber-est-sdk), not in the npm package: [Porting a JUCE plugin](porting-juce.md).
