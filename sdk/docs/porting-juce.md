# Porting a JUCE plugin

Keep your JUCE desktop build. Share the DSP between it and an EST module, built from one source tree. The kit's example is `sdk/kits/juce-shared-dsp/` in the Cyber clone: a gain whose DSP is one header that a JUCE `AudioProcessor` and an EST module both compile, a CMake file that builds both, and a small native renderer to compare them with `est compare`.

JUCE itself does not run in EST: its `AudioProcessor`, its message thread, its editor and its file and network classes have nothing to run on in a WebAssembly sandbox (one thread, no window, no files, no libc; [porting-cpp.md](porting-cpp.md) has the list). What carries over is your DSP, if it is written to be portable.

## The layout

```
juce-shared-dsp/
  dsp/SharedGain.h          the shared DSP: no JUCE, no CLAP, no EST
  juce/PluginProcessor.*    the desktop plugin: a JUCE AudioProcessor calling the shared DSP
  est/                      the EST plugin: est.json, est-build.json, src/plugin.cpp (the CLAP side)
  reference/render.cpp      the shared DSP over a WAV, natively, with no JUCE (for est compare)
  CMakeLists.txt            builds them all from this one tree
```

`est/` is `est new cpp-clap`'s folder with two lines changed: `src/plugin.cpp` includes `SharedGain.h` instead of the template's `gain.hpp`, and `est-build.json` adds `../dsp` to the include path. Everything else (the parameters, the state, the ports, the events) is the template's.

## Building

```
cmake -S . -B build -DJUCE_DIR=/path/to/your/JUCE -DEST_CLI=/path/to/cyber/sdk/packages/cli/bin/est.mjs
cmake --build build                 # the JUCE plugin (VST3, AU, Standalone) and the reference renderer
cmake --build build --target est    # est pack est/: est/dist/org.example.shared-gain-1.0.0.est
```

`JUCE_DIR` is your own checkout of [JUCE](https://github.com/juce-framework/JUCE): no JUCE source is in Cyber's repository. **JUCE's terms are yours:** the desktop build links JUCE, so it is under JUCE's licence, the AGPLv3 (JUCE 8; JUCE 7 was the GPLv3) unless you hold a commercial JUCE licence. The EST bundle links no JUCE code: `est/` compiles only `dsp/SharedGain.h`, its own `src/plugin.cpp` and the EST kit's MIT headers, so the shared DSP's own licence is what governs it; keep JUCE out of `dsp/` and that stays true. Without `JUCE_DIR` the desktop plugin is skipped and the rest still builds, which is how Cyber's suite builds the kit: the JUCE half is never compiled there. The EST module is not built by CMake's compiler: the `est` target runs `est pack`, which builds with its own clang for wasm32 ([porting-cpp.md](porting-cpp.md), "The toolchain").

## Making your DSP shareable

Move what `processBlock` does into a class with no JUCE in it:

| JUCE | The shared class |
|---|---|
| `prepareToPlay(sampleRate, blockSize)` | `prepare(sampleRate)`: CLAP's `activate`. Allocate here, sized from the largest block. |
| `processBlock(AudioBuffer&, MidiBuffer&)` | `process(const float* const* in, float* const* out, channels, from, to)`: raw pointers, a frame range. JUCE passes the whole block; the EST side passes the frames between two events, so automation is sample accurate with no change to the class. |
| `AudioProcessorValueTreeState`, `getRawParameterValue` | a setter per parameter in plain units (`setGainDb(-6)`), called by each side from its own parameter system. Never JUCE's normalised 0–1. |
| `juce::dsp::IIR`, `juce::dsp::Oscillator`, `juce::dsp::Gain` … | your own code or a header-only library with no JUCE in it. The EST SDK's Rust and AssemblyScript DSP blocks are not C++; port the few you need, or keep the ones you have. |
| `std::exp`, `std::sin` | one macro or inline function per maths call, `<cmath>` on the desktop and `est::` on wasm32 (`#if defined(__wasm__)`, as `SharedGain.h` does). |
| `juce::ScopedNoDenormals` | stays on the desktop side; in the shared class, flush feedback paths or add a tiny offset (WebAssembly has no flush-to-zero). |
| `juce::Random`, `Time::getMillisecondCounter` in the audio path | a PRNG seeded from the state: EST renders must be deterministic. |
| `juce::File`, `URL`, `AudioFormatManager` | samples ship in the bundle's `assets` or the state. |

Build the shared code with `-ffp-contract=off` on the desktop too (the kit's CMake does): WebAssembly never fuses a multiply and an add, and a fused desktop build differs in the last bits.

## Parameters

Give each parameter the same identity on both sides: JUCE's `ParameterID` string and the EST `kParams` id (a number, stable forever), the same range and default, in plain units. JUCE's normalisation (`NormalisableRange`, skew) is a desktop UI concern: EST takes plain values, and a log-feeling frequency control is `"scale": "log"` on the parameter in est.json.

JUCE reads a parameter once per block; EST delivers each change at its frame. If your DSP smooths parameters, the two sides converge; if it does not, the EST side changes sooner within a block, and `est compare`'s first divergence is at the block boundary.

## State

The desktop state is JUCE's (`copyState().createXml()`). The EST state is the bytes `clap.state` writes: the template writes a magic, a version and each parameter. They need not be the same format; if projects must move between the desktop and Cyber, write a small converter, or make the EST state the format both read.

## Checking the port

The kit's `reference/render.cpp` is the desktop build's stand-in: the shared DSP, natively, over a WAV, with one parameter change at a time you give. Your JUCE plugin can do the same in a unit test.

```
cd est && est pack
est compare dist/org.example.shared-gain-1.0.0.est dist/org.example.shared-gain-1.0.0.est --seconds 1 --write-input ../build/input.wav
../build/reference ../build/input.wav ../build/reference.wav --gain -6 --at 0.25
est compare dist/org.example.shared-gain-1.0.0.est ../build/reference.wav --input ../build/input.wav \
  --events '[{"type":"param","time":0.25,"id":0,"value":-6}]' --tolerance -120
```

The last line says `SAME`: the module and the native build agree bit for bit. Open `est-compare.html` for the waveforms.

## What does not port

The editor (a web page or Cyber's generated knobs instead: [ui.md](ui.md)); anything on a background thread; file and network access; plugin hosting inside your plugin; MIDI output and sidechain inputs until EST 1.1; more than two channels per port in EST 1.0.
