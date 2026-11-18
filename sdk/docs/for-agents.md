# For coding agents

You can make an EST plugin from start to finish with the `est` command; nothing needs a screen and nothing needs Cyber's source. A first plugin from npm alone, with the code inline: [Build an EST plugin](BUILD_AN_EST_PLUGIN.md). A chat assistant with no folder: [the one prompt](ONE_PROMPT.md).

**This page is the one source of every assistant file the kit hands out.** `node sdk/agents/generate.mjs` cuts it into the marked sections below and writes, from them and each template's short part in `sdk/agents/parts/`:

- each template's `AGENTS.md`, its two one-line pointers and its `llms.txt` (`sdk/templates/<name>/`), and the recipes' shared ones (`sdk/cookbook-agents/`);
- the two window sections `est new --ui` and `--app` put into a folder's `AGENTS.md` (`sdk/agents/sections/`);
- the one prompt for a chat assistant (`ONE_PROMPT.md` here, and `shared/estOnePrompt.mjs` for the app).

So change the words here (or in a part), run the generator, and commit what it writes; `--check` and `sdk/tests/agents.test.ts` fail while a copy differs. A line that ends with an `only:` mark is kept only for that language (`as`, `rust`, `cpp`) or kind (`effect`, `instrument`). A generated `AGENTS.md` must stand alone: inside a section, link nothing but a file `est new` puts in the folder.

`est` is the npm package `@cyber-est/cli`. `est new` (no arguments: three questions) makes a folder with the kit pinned in its `package.json`, so `npx est <command>` works there; outside such a folder write `npx @cyber-est/cli <command>`. To port C or C++, `npx @cyber-est/cli port <the source folder>` writes a `cpp-clap` folder with the parameters it found and a `PORT_PLAN.md` to follow ([Port your plugin](PORT_YOUR_VST.md); `est compare` checks a port against the original). The kit's public repository, https://github.com/NickKHarrison/cyber-est-sdk, holds these docs: [templates](templates.md), [the cookbook](cookbook.md), [the dev host](dev-host.md), [the manifest](manifest.md), [the rules](validator-rules.md), [the DSP library](dsp-library.md), [concepts](concepts.md), [the window](ui.md), [porting C++](porting-cpp.md), [publishing](PUBLISH_ON_THE_EST_STORE.md).

<!-- agents:begin idea -->
## What to build

<!-- est:idea -->
Nobody has said yet what this plugin should do. Ask the person for one sentence, write it here, then build it.
<!-- /est:idea -->
<!-- agents:end idea -->

<!-- agents:begin loop -->
## The loop

Run `est` as `npx est <command>` in this folder: `package.json` pins the kit (if `node_modules` is missing, `npm install` first). Never a bare `npx est` in a folder without the kit: npm would fetch another package of that name.

1. Read **What to build**. Change the source and, when the parameters or the identity change, `est.json`.
2. `npx est validate` builds, packs `dist/<id>-<version>.est` and runs every check Cyber runs when a plugin is added. Read `dist/validation.json`: each failed check has `rule`, `message`, `fix` and `where`. Fix and repeat until `"ok": true`.
3. `npx est test`: the golden render in `test/` and the conformance run. After changing the sound on purpose: `npx est test --update`.
4. Hear it (below), then tell the person what you built and the choices you made for them.

**Follow the `Next:` line** that ends every `est validate`, `est test`, `est doctor` and `est dev` build: the first error or failed check with its fix, or the next step.

Also: `npx est doctor` (what is wrong with this folder or machine, and the fix), `npx est pack` (build and pack only), `npx est profile --json` (which function costs most).

Rule ids are stable; the prefix says where to look: `EST-M` the manifest, `EST-B` the bundle, `EST-W` the WebAssembly module, `EST-C` conformance and behaviour, `EST-U` the window, `EST-P` speed (a warning). `est-validator-rules.json` lists every rule: `id`, `title`, `explain`, `fix`, `severity`.
<!-- agents:end loop -->

<!-- agents:begin rules -->
## The rules

- **Allocate nothing while playing**: not in `render`, `process`, the parameter hook or a note handler.
  - `new`, array literals, strings and closures only in field initialisers, the constructor or `activate`. No top-level code but constants (it would become a start function, which traps: `EST-W`). <!-- only:as -->
  - Heap memory (`DelayLine::allocate`) only in `activate`; no `Vec`, no `Box`. It is `no_std`: use `est::math`, and add no dependency that needs `std`. <!-- only:rust -->
  - `malloc` or `new` only in `activate`. No exceptions, no RTTI, no threads, no libc, no libm: an "undefined symbol" at the link is a function the module would have to import (`sinf`, `printf` …); use `est::` or write it. <!-- only:cpp -->
- **Be deterministic, import nothing**: the same input and events give the same output, bit for bit. No clock, no file, no host function. For noise, step your own seed, a 32-bit xorshift (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset`.
- **Size every buffer and time from the sample rate `activate` gives.** The validator runs at 48 kHz; Cyber runs at the device's rate.
- **The ids agree**: the descriptor's id is `est.json`'s `id` (`EST-C001`); the kind and ports match (`EST-C003`, `EST-C004`); each parameter has one numeric id in the code, in `est.json`'s `parameters`, in `test/golden.json`'s events and in the window (`EST-C008`), and it never changes.
- **The state magic** (four characters, where the plugin is described) never changes once anyone has a version.
- **Stay in range**: no output above +18 dBFS, no NaN, memory within `limits.memoryPagesMax` (64 KiB pages).
- **Flush tiny numbers** (`EST-C027`): set a state that feeds itself (a feedback path, a filter's memory, an envelope falling to 0) to 0 once it is below `1e-20`. The kit's `Filter` already does. <!-- only:as,rust -->
- **Flush tiny numbers** (`EST-C027`): set a state that feeds itself (a feedback path, a filter's memory, an envelope falling to 0) to 0 once it is below `1e-20`. <!-- only:cpp -->
- **Every note you start ends**: tell the host when a voice stops sounding (`Voices` does, when you call `end`). A choke stops at once. After the tail the output is silent. <!-- only:instrument -->
- **Every version is new**: bump `version` in `est.json` for each build you hand to anyone.
<!-- agents:end rules -->

<!-- agents:begin write-as -->
## How it is written (AssemblyScript)

- **The export block** at the top of `assembly/index.ts` and the `abort` function at the bottom stay as they are. `describe()` is the identity and the state magic; its first feature (`"audio-effect"` or `"instrument"`) decides the kind.
- **Parameters** are declared once, in `parameters()`, and listed in `est.json`. Values are plain units (dB, Hz, ms), never 0 to 1.
- `paramChanged(id, value)` gets each new value at its own sample. Every default arrives there first, before `activate`, so `activate` sets each block's sample rate and then resets it, as the template does.
- `render(io, from, to)` writes frames `from` to `to`: `io.input(c, n)` in, `io.output(c, n, v)` out. <!-- only:effect -->
- `tail()` is how many frames still sound after the input stops; 0 unless something rings. <!-- only:effect -->
- **Notes arrive at their sample**: `noteOn(io, note)`, `noteOff`, `choke`. `Voices<T>` keeps the books: `start(io, note)` gives a free voice or steals the oldest; in `render`, call `end(i, io, n)` the moment a voice falls silent. <!-- only:instrument -->
- `render(io, from, to)` **adds** the voices into frames `from` to `to` with `io.add(c, n, v)`: the outputs start each block at zero. <!-- only:instrument -->
- `tail()` is the longest a released note sounds (an `Envelope`'s `tailFrames()`), and `limits.tailSeconds` in `est.json` must cover it. <!-- only:instrument -->
- `saveState(w)` and `loadState(r, version)` add your own bytes after the parameters, which are saved for you.
<!-- agents:end write-as -->

<!-- agents:begin write-rust -->
## How it is written (Rust)

- **The plugin** is one `impl Effect` or `impl Instrument` in `src/lib.rs` and one `est::export_effect!`, `est::export_instrument!` or `est::export_note_effect!` at the bottom: the macro's `id` is the identity, and the macro decides the kind. `use est::prelude::*;` brings the library.
- **Parameters** are declared once, in `PARAMS`, and listed in `est.json`. Values are plain units (dB, Hz, ms), never 0 to 1.
- `param_changed(id, value)` gets each new value at its own sample. Every default arrives there first, before `activate`, so `activate` sets each block's sample rate and then resets it, as the template does.
- `new()` builds the plugin by value and allocates nothing; `activate(sample_rate, max_frames)` is the only place to allocate.
- `render(io, from, to)` writes frames `from..to`: `io.input(c, n)` in, `io.output(c, n, v)` out. <!-- only:effect -->
- `tail()` is how many frames still sound after the input stops; 0 unless something rings. <!-- only:effect -->
- **Notes arrive at their sample**: `note_on(io, note)`, `note_off`, `choke`. `Voices<T, N>` keeps the books: `start(io, note)` gives a free voice or steals the oldest; in `render`, call `end(i, io, n)` the moment a voice falls silent. <!-- only:instrument -->
- `render(io, from, to)` **adds** the voices into frames `from..to` with `io.add(c, n, v)`: the outputs start each block at zero. <!-- only:instrument -->
- `tail()` is the longest a released note sounds (an `Envelope`'s `tail_frames()`), and `limits.tailSeconds` in `est.json` must cover it. <!-- only:instrument -->
- `STATE_MAGIC` is four bytes (`u32::from_le_bytes(*b"ABCD")`); `save_state` and `load_state` add your own bytes after the parameters, which are saved for you.
<!-- agents:end write-rust -->

<!-- agents:begin write-cpp -->
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
<!-- agents:end write-cpp -->

<!-- agents:begin library-as -->
## The library on one page (AssemblyScript)

Import everything from `"est"`. Numbers are `f64` unless a type is shown. If a function is not listed here, it does not exist: write the few lines yourself.

The library's source is in `est/`: read it for anything more, do not edit it. <!-- only:folder -->

- **Base class**: extend `Effect` or `Instrument`. You must write `render(io: Io, from: i32, to: i32): void`. Optional hooks: `activate(sampleRate: f64, maxFrames: u32): bool`, `reset(): void`, `paramChanged(id: u32, value: f64): void`, `tail(): u32` and `latency(): u32` (frames), `event(io: Io, e: Event): void`, `saveState(w: StateWriter): void`, `loadState(r: StateReader, version: u32): bool`.
- **`Io`**: `io.channels: i32`, `io.frames: i32`, `io.input(c: i32, n: i32): f32`, `io.output(c, n, v: f32)`, `io.add(c, n, v: f32)`, `io.param(id: u32): f64`, `io.transport`.
- **Note hooks**: `noteOn(io: Io, note: Note): void`, `noteOff` and `choke` (the same arguments). Out: `io.noteEnd(id: i32, port: i16, channel: i16, key: i16, n: i32)`, `io.sendNoteOn(id: i32, channel: i16, key: i16, velocity: f64, n: i32)`, `io.sendNoteOff` (the same arguments). <!-- only:notes -->
- **`Note`** fields: `time: i32` (its frame in the block), `noteId: i32` (-1: none), `port: i16`, `channel: i16`, `key: i16`, `velocity: f64` (0 to 1). There is no `id` field. Cast before maths: `keyToHz(<f64>note.key)`. <!-- only:notes -->
- **`Transport`** fields: `tempo: f64`, `playing: bool`, `beat: f64`, `barStart: f64`, `num: u16`, `den: u16`.
- **`Event`** fields: `kind` (`EventKind.Param`, `NoteOn`, `NoteOff`, `Choke`, `Transport` …), `time: i32`, `id: u32`, `value: f64`, `note`, `transport`.
- **`Param`**: `new Param(id: u32, "Name")`, then `.range(min, max)`, `.default(v)`, `.unit("dB")`, `.decimals(n)`, `.hertz()`, `.log()`, `.labels(["A", "B"])` (a switch: values 0, 1 …), `.module("Group")`, `.bypass()`, `.hidden()`, `.readOnly()`.
- **`Descriptor`**: `new Descriptor(id, name, vendor, version, description, features: string[], stateMagic, stateVersion: u32)`; `.noteEffect()` for notes out.
- **Maths**: `dbToGain(db)`, `gainToDb(gain)`, `keyToHz(key)`, `clamp(x, lo, hi)`, `exp(x)`, `ln(x)`, `exp2(x)`, `log2(x)`, `floor(x)`, `round(x)`, `sinTurns(t)` and `cosTurns(t)` (`t` in turns: 1 is a whole cycle), `tanHalfTurns(t)`, `onePole(seconds, sampleRate)` (a smoothing coefficient). The language's own `Math.sqrt`, `Math.abs`, `Math.sin`, `Math.tanh`, `Math.pow` and `Math.exp` also work; never `Math.random`.
- **`Smoother`**: `new Smoother(seconds)`; `setSampleRate(sr)`, `setTime(seconds)`, `setTarget(v)`, `jump(v)`, `reset()` (jump to the target), `next(): f64` once a sample, `settled(): bool`.
- **`Filter`** (state-variable, one per channel): `setSampleRate(sr)`, `setMode(FilterMode.Low)` (or `Band`, `High`, `Notch`; `filterModeFromIndex(v)`), `setCutoff(hz)`, `setResonance(r)` (0 to 1), `setSmoothing(seconds)`, `reset()`, `process(x: f64): f64`.
- **`Biquad`**: `set(BiquadKind.Peak, freq, q, gainDb, sampleRate)` (or `LowShelf`, `HighShelf`, `LowPass`, `HighPass`), `reset()`, `process(x: f64): f64`.
- **`DelayLine`** (`f64` in and out): `allocate(maxFrames: i32): bool` in `activate`, `clear()`; each sample, `read(delayFrames: f64): f64` **before** `write(x: f64)`. The shortest delay is 1 frame; a fraction is interpolated.
- **`Oscillator`**: `setSampleRate(sr)`, `setFrequency(hz)`, `setWave(Wave.Sine)` (or `Saw`, `Square`, `Triangle`; `waveFromIndex(v)`), `reset(phase)`, `next(): f64` (-1 to 1).
- **`Lfo`**: `setSampleRate(sr)`, `setRate(hz)`, `setSync(beats)` (0: free), `setTempo(bpm)`, `setWave(Wave.Sine)`, `reset(phase)`, `next(): f64` (-1 to 1).
- **`Envelope`** (ADSR): `setSampleRate(sr)`, `setAdsr(attack, decay, sustain, release)` (seconds; sustain 0 to 1) or `setAttack`, `setDecay`, `setSustain`, `setRelease`; `start()`, `release()`, `reset()`, `next(): f64`, `isActive(): bool`, `tailFrames(): u32`.
- **`Voices<T>`**: `new Voices<MyVoice>(n)` in a field initialiser; `start(io, note): i32` (the voice's index), `release(note)`, `choke(io, note)`, `voice(i): T`, `note(i): Note`, `isOn(i): bool`, `end(i, io, n)`, `reset()`. A voice class extends `Voice`, has a constructor with no arguments, and overrides `release(): void` and `stop(): void`. <!-- only:notes -->
- **State**: `w.u32(v)`, `w.f32(v)`, `w.f64(v)`; `r.u32()`, `r.f32()`, `r.f64()`.
<!-- agents:end library-as -->

<!-- agents:begin library-rust -->
## The library on one page (Rust)

`use est::prelude::*;` brings all of it; its source is in `est/src/` (read it for anything more, do not edit it). Numbers are `f64` unless a type is shown. If a function is not listed here, it does not exist: write the few lines yourself.

- **Traits**: `Effect` and `Instrument`. You must write `const PARAMS: &'static [Param]`, `const STATE_MAGIC: u32`, `fn new() -> Self` and `fn render(&mut self, io: &mut Io, from: usize, to: usize)`. Optional: `activate(&mut self, sample_rate: f64, max_frames: u32) -> bool`, `reset(&mut self)`, `param_changed(&mut self, id: u32, value: f64)`, `tail(&self) -> u32` and `latency(&self) -> u32` (frames), `event(&mut self, io: &mut Io, e: &Event)`, `save_state(&self, w: &mut StateWriter)`, `load_state(&mut self, r: &mut StateReader, version: u32) -> bool`, `const STATE_VERSION: u32`, an effect's `const SIDECHAIN_CHANNELS: u32`.
- **`Io`**: `io.channels`, `io.frames`, `io.input(c: usize, n: usize) -> f32`, `io.output(c, n, v: f32)`, `io.add(c, n, v: f32)`, `io.param(id: u32) -> f64`, `io.transport`, `io.sidechain(c, n) -> f32`.
- **Note hooks** (an instrument must write all three): `note_on(&mut self, io: &mut Io, note: &Note)`, `note_off` and `choke` (the same arguments). Out: `io.note_end(id: i32, port: i16, channel: i16, key: i16, n: usize)`, `io.send_note_on(id: i32, channel: i16, key: i16, velocity: f64, n: usize)`, `io.send_note_off` (the same arguments). <!-- only:notes -->
- **`Note`** fields: `time` (its frame in the block), `note_id: i32` (-1: none), `port: i16`, `channel: i16`, `key: i16`, `velocity: f64` (0 to 1). There is no `id` field. Cast before maths: `key_to_hz(note.key as f64)`. <!-- only:notes -->
- **`Transport`** fields: `tempo: f64`, `playing: bool`, `beat: f64`, `bar_start: f64`, `num: u16`, `den: u16`.
- **`Event`** fields: `kind` (`EventKind::Param`, `NoteOn`, `NoteOff`, `Choke`, `Transport` …), `time`, `id: u32`, `value: f64`, `note`, `transport`.
- **`Param`**: `Param::new(id: u32, "Name")`, then `.range(min, max)`, `.default(v)`, `.unit("dB")`, `.decimals(n)`, `.hertz()`, `.log()`, `.labels(&["A", "B"])` (a switch: values 0.0, 1.0 …), `.module("Group")`, `.bypass()`, `.hidden()`, `.read_only()`.
- **Maths** (the prelude's): `db_to_gain(db)`, `gain_to_db(gain)`, `key_to_hz(key)`, `clamp(x, lo, hi)`, `exp(x)`, `ln(x)`, `exp2(x)`, `log2(x)`, `sin_turns(t)` and `cos_turns(t)` (`t` in turns: 1 is a whole cycle), `one_pole(seconds, sample_rate)` (a smoothing coefficient); and `est::math::floor`, `est::math::round`, `est::math::tan_half_turns`. `core` has no float maths: no `sin`, no `powf`, no `sqrt` on a float.
- **`Smoother`**: `Smoother::new(seconds)`; `set_sample_rate(sr)`, `set_time(seconds)`, `set_target(v)`, `jump(v)`, `reset()` (jump to the target), `next() -> f64` once a sample, `settled() -> bool`.
- **`Filter`** (state-variable, one per channel): `Filter::new()`; `set_sample_rate(sr)`, `set_mode(FilterMode::Low)` (or `Band`, `High`, `Notch`; `FilterMode::from_index(v)`), `set_cutoff(hz)`, `set_resonance(r)` (0 to 1), `set_smoothing(seconds)`, `reset()`, `process(x: f64) -> f64`.
- **`Biquad`**: `Biquad::new()`; `set(BiquadKind::Peak, freq, q, gain_db, sample_rate)` (or `LowShelf`, `HighShelf`, `LowPass`, `HighPass`), `reset()`, `process(x: f64) -> f64`.
- **`DelayLine`** (`f64` in and out): `DelayLine::new()`; `allocate(max_frames: usize) -> bool` in `activate`, `clear()`; each sample, `read(delay_frames: f64) -> f64` **before** `write(x: f64)`. The shortest delay is 1 frame; a fraction is interpolated.
- **`Oscillator`**: `Oscillator::new()`; `set_sample_rate(sr)`, `set_frequency(hz)`, `set_wave(Wave::Sine)` (or `Saw`, `Square`, `Triangle`; `Wave::from_index(v)`), `reset(phase)`, `next() -> f64` (-1 to 1).
- **`Lfo`**: `Lfo::new()`; `set_sample_rate(sr)`, `set_rate(hz)`, `set_sync(beats)` (0: free), `set_tempo(bpm)`, `set_wave(Wave::Sine)`, `reset(phase)`, `next() -> f64` (-1 to 1).
- **`Envelope`** (ADSR): `Envelope::new()`; `set_sample_rate(sr)`, `set_adsr(attack, decay, sustain, release)` (seconds; sustain 0 to 1) or `set_attack`, `set_decay`, `set_sustain`, `set_release`; `start()`, `release()`, `reset()`, `next() -> f64`, `is_active() -> bool`, `tail_frames() -> u32`.
- **`Voices<T, N>`**: `Voices::new(make)` with `make: impl Fn() -> T`; `start(io, note) -> usize` (the voice's index), `release(note)`, `choke(io, note)`, `voice(i)`, `voice_mut(i)`, `note(i)`, `is_on(i)`, `end(i, io, n)`, `reset()`. A voice implements `Voice`: `release(&mut self)` and `stop(&mut self)`. <!-- only:notes -->
- **State**: `w.u32(v)`, `w.f32(v)`, `w.f64(v)`; `r.u32()`, `r.f32()`, `r.f64()`.
<!-- agents:end library-rust -->

<!-- agents:begin library-cpp -->
## The runtime on one page (C and C++)

There is no libc and no system libm. `<est/runtime.hpp>` (on the include path, with the CLAP 1.2 headers as `<clap/clap.h>`) has everything below, as `est_name` in C and `est::name` in C++; the maths takes and returns `double`. For a port, `<cmath>` and `<math.h>` also work (`std::tanh`, `sinf` and the rest, `float` and `double`; the header's opening comment lists what they have and have not). `exp` and `tanh` are cheap; `log` and `pow` cost about 20 divisions, so call them when a knob moves, not per sample.

- **Maths**: `est_fabs(x)`, `est_sqrt(x)`, `est_floor(x)`, `est_clamp(x, lo, hi)`, `est_exp(x)`, `est_fast_exp(x)` (no division: the one to call per sample), `est_tanh(x)`, `est_atan(x)`, `est_log(x)`, `est_pow(base, ex)`, `est_sin(x)`, `est_cos(x)`, `est_tan(x)` (radians), `est_db_to_gain(db)`, `est_gain_to_db(gain)`; the constants `EST_PI`, `EST_LN2`, `EST_LN10`.
- **Text**: `est_streq(a, b)`, `est_strcpy(dst, src, cap)`.
- **State streams**: `est_write_all(stream, data, n)`, `est_read_all(stream, data, n)`: each is true only when every byte moved.
- **Placement `new`** is defined; `EST_EXPORT(name)` exports a function.
<!-- agents:end library-cpp -->

<!-- agents:begin costs -->
## What costs time

`npx est validate` reports a block's mean cost and warns past 100 µs (`EST-P001`, a warning only). The warning is the best of three runs, so the cost is real (`npx est profile --json` names the function). The usual causes:

- **A sine a sample.** `sinTurns`, `cosTurns`, a sine `Oscillator` and a sine `Lfo` each sum a series with a division per term. One LFO is fine; one per voice adds up. Cheaper: a triangle or saw `Lfo`, your own phase with a parabola, or one value every 16 frames, smoothed. <!-- only:as -->
- **A sine a sample.** `sin_turns`, `cos_turns`, a sine `Oscillator` and a sine `Lfo` each sum a series with a division per term. One LFO is fine; one per voice adds up. Cheaper: a triangle or saw `Lfo`, your own phase with a parabola, or one value every 16 frames, smoothed. <!-- only:rust -->
- **A gliding `Filter`** works out its coefficients again every sample while its cutoff or resonance moves. If you move the cutoff all the time (an envelope, an LFO), call `setSmoothing(0)` once and `setCutoff` every 16 frames. <!-- only:as -->
- **A gliding `Filter`** works out its coefficients again every sample while its cutoff or resonance moves. If you move the cutoff all the time (an envelope, an LFO), call `set_smoothing(0.0)` once and `set_cutoff` every 16 frames. <!-- only:rust -->
- **`DelayLine`'s `read` with a fraction** interpolates: a chorus needs it, a plain echo can round its delay to whole frames. <!-- only:as,rust -->
- **`exp`, `ln`, `dbToGain`, `keyToHz` a sample.** Work them out in `paramChanged` or at the note's start, and smooth the result. <!-- only:as -->
- **`exp`, `ln`, `db_to_gain`, `key_to_hz` a sample.** Work them out in `param_changed` or at the note's start, and smooth the result. <!-- only:rust -->
- **`est_exp`, `est_log`, `est_pow`, `est_sin` a sample.** Each is a loop of divisions. Work them out when a parameter changes, and smooth the result. <!-- only:cpp -->
<!-- agents:end costs -->

<!-- agents:begin song -->
## Following the song

The transport (tempo, beat, playing) is **as of the block's first sample**, or of a transport event inside the block. It does not move while you render: keep your own beat and add `tempo / 60 / sampleRate` each sample while it plays. With no transport event `playing` is false, and `npx est validate` and the default golden render run that way.

To prove a plugin that follows the tempo, put a transport event in `test/golden.json`'s `events` (every field is needed; `time` in seconds):

```json
{ "type": "transport", "time": 0, "tempo": 120, "beat": 0, "seconds": 0, "num": 4, "den": 4, "barStart": 0, "barNumber": 0, "playing": true }
```

Count bars from `barStart`, never from beat 0.
<!-- agents:end song -->

<!-- agents:begin ringing -->
## A delay or a reverb

- **Memory.** A `DelayLine` holds 4 bytes a frame: a second of stereo at 96 kHz is about 12 pages of 64 KiB. Raise `maximumMemory` in `asconfig.json` and `limits.memoryPagesMax` in `est.json` **together** (both in pages; 64 covers a few seconds). <!-- only:as -->
- **Memory.** A `DelayLine` holds 4 bytes a frame: a second of stereo at 96 kHz is about 12 pages of 64 KiB. Raise `--max-memory` in `.cargo/config.toml` (bytes) and `limits.memoryPagesMax` in `est.json` (pages) **together**. <!-- only:rust -->
- **Memory.** A buffer of floats holds 4 bytes a frame: a second of stereo at 96 kHz is about 12 pages of 64 KiB. Raise `limits.memoryPagesMax` in `est.json`; the build sets the module's maximum from it. <!-- only:cpp -->
- **The tail.** Report how long it rings, in frames, from `tail()`, and keep `limits.tailSeconds` in `est.json` at least that long. It may be 60 at most: cap the feedback (or the time) so it dies inside that. `EST-C028` fails a plugin that still sounds after the tail it reports; it tests with the song stopped at 60 BPM, where a tempo-synced echo is longest. <!-- only:as,rust -->
- **The tail.** Report how long it rings, in frames, through `clap.tail`, and keep `limits.tailSeconds` in `est.json` at least that long. It may be 60 at most: cap the feedback (or the time) so it dies inside that. `EST-C028` fails a plugin that still sounds after the tail it reports. <!-- only:cpp -->
- **Noise of its own.** An effect that sounds with silence in (hiss, crackle) trips `EST-C028` too: fade it out when the input stops. <!-- only:effect -->
<!-- agents:end ringing -->

<!-- agents:begin traps -->
## Easy to get wrong

- **A frequency or time knob** wants a log scale: `.log()` on the parameter and `"scale": "log"` on its row in `est.json`'s `parameters`. <!-- only:as,rust -->
- **A frequency or time knob** wants a log scale: `"scale": "log"` on its row in `est.json`'s `parameters`. <!-- only:cpp -->
- **A switch or chooser** (`.labels`) shows its labels on Cyber's knobs: at most 64 steps, 32 characters a label. <!-- only:as,rust -->
- **Smooth every level and cutoff change** (`Smoother`), or a moving knob clicks. <!-- only:as,rust -->
- **`test/golden.json`'s events name parameters by id** (`{ "type": "param", "time": 0.1, "id": 1, "value": 800 }`: plain units, seconds). Change them when a parameter changes, then `npx est test --update`.
- **A note in `test/golden.json`**: `{ "type": "noteOn", "time": 0.1, "key": 60, "channel": 0, "port": 0, "noteId": 1, "velocity": 0.8 }`, then a `noteOff` with the same `noteId`. <!-- only:notes -->
- **`test/golden.f32`** is every left frame, then every right frame (little-endian float32), not interleaved.
- **validate's `peak`** is the stress run's worst case, not the level at the defaults.
<!-- agents:end traps -->

<!-- agents:begin hear -->
## Hear it

- With a screen: `npx est dev` opens a page that plays the plugin (add `--port 0 --files-port 0` if a port is taken).
- Without one: `npx est dev --json` needs a browser download (Playwright's Chromium; `npx est doctor` says how). Without it, **still check**: `npx est demo` writes `dist/demo.wav`, and `test/golden.f32` is the plugin's real output. Read one and check the level and the shape (silent? clipping? does a knob change it?). Tell the person what you checked, and that nobody has listened yet.
<!-- agents:end hear -->

<!-- agents:begin window-short -->
## The window

<!-- est:window -->
This folder has no window of its own: Cyber draws knobs from the parameters, which is enough to start. For a page of your own, make the folder again with `est new … --ui` (a page with knobs) or `--app` (a small web app) and copy your source across: its `AGENTS.md` then has the window's rules.
<!-- /est:window -->
<!-- agents:end window-short -->

<!-- agents:begin window-none -->
## The window

Cyber draws knobs from the parameters, and that is enough to start. A window of your own is a web page in the bundle (`ui/index.html`, named by `"ui"` in `est.json`), never a native one: scripts as files, nothing from another host, no `fetch`. The `EST-U` rules in `est-validator-rules.json` say what a page may hold, and `est-ui.d.ts` has the page library's types.
<!-- agents:end window-none -->

<!-- agents:begin window-ui -->
This folder has a window in `ui/` (`ui/index.html`, `ui/ui.js`, `ui/style.css`): an `<est-knob>` for each parameter, and `est.json`'s `"ui"` entry. Change the page to match your parameters.

- `ui/index.html` loads `<script src="est-ui.js"></script>` and then your script, both as files. `npx est pack` copies `est-ui.js` into the bundle: do not add it yourself. It gives `EstUI.connect()`, `EstUI.bind(el, id)` and the `<est-knob param="ID">` and `<est-slider>` elements; `est-ui.d.ts` has its types.
- `est.json`: `"ui": { "path": "ui/index.html", "size": { "w": 440, "h": 180 } }`. Cyber draws the frame at exactly that size (CSS pixels) and never scales it.
- What loads: scripts, CSS, `.png`, `.webp` and `.svg` images and `.woff2` fonts that are files of the bundle (inline `<style>` too). No inline script, no `.jpg` or `.gif`, nothing from another host, no `fetch`. The `EST-U` rules check it.
- `npx est dev` shows the page beside the generated knobs. `npx est dev --json` reports it as `ui` lines: its load, `est:ready`, each message the host refused and why, console errors and files that did not load.
- A plugin other people add shows its own window only once Cyber has reviewed it; until then they see the generated knobs, so keep every control a parameter.
<!-- agents:end window-ui -->

<!-- agents:begin window-app -->
This folder's window is an app: `ui-app/` is its source, and `npm run build:ui` builds it into `ui/`, the page `est.json`'s `"ui"` names. Change the app in `ui-app/`, never in `ui/`: the build empties `ui/` each time. Then `npx est validate` and `npx est dev` as usual.

| File | What |
|---|---|
| `package.json` | `npm run build:ui`, and `npm run dev:ui` (the app in a plain browser with a stand-in engine) |
| `ui-app/vite.config.ts` | The build: one classic script, relative URLs, fonts from the script, other hosts cut out |
| `ui-app/index.html` | The page; its `est-ui-size` meta gave `est.json`'s `ui.size` |
| `ui-app/main.ts` | The example app, no framework: a slider per parameter. Replace it with yours |
| `ui-app/store.ts` | The app's state: the app reads and writes only this |
| `ui-app/bridge.ts` | The link to the host: `applyHost`, `pushStore` (a drag is one gesture), `decodeReadout` |
| `ui-app/engine.ts` | The stand-in for `npm run dev:ui`; the build swaps it for `bridge.ts` |
| `ui-app/bits.ts` | `packFields` and `unpackFields`: the app's own data in hidden parameters |
| `ui-app/fonts.ts` | `registerFonts`: a font imported as `?base64` and registered from its bytes |

What the frame needs (the build does it, and `npx est validate` checks it):

- **One classic script**: no `<script type="module">`, no `crossorigin`, no `modulepreload` (`EST-U005`), or the frame stays blank.
- **Nothing from another host** (`EST-U002`), and never `fetch`: put the data the app needs in the script.
- **Fonts in the script**: import each as `?base64` and call `registerFonts`.
- **The host plays.** The sound, the transport, the keys and the tempo are Cyber's: no play button or keyboard in the app.
- **Every piece of state is a parameter** (up to 512): knobs are ordinary ones, the app's own data `hidden()` ones packed with `bits.ts`, what the plugin is playing `hidden().readOnly()` ones the DSP sets.
- **The size is fixed**: change the `est-ui-size` meta and `est.json`'s `ui.size` together.
<!-- agents:end window-app -->

<!-- agents:begin install -->
## Put it in Cyber

In Cyber, on Home: **EST PLUGINS → Add a plugin**, and drop `dist/<id>-<version>.est` there. Cyber runs the same checks; a refusal names the same rule id. It stays on the person's own account.

Publishing on the EST Store is a later step and the person's choice: a published id starts with their own `dev.<10 hex>` name, which Cyber shows them, in `est.json` and in the source alike.
<!-- agents:end install -->

<!-- agents:begin prompt-rules -->
Rules (the playground refuses a plugin that breaks one):
- Import only from "est" (the library listed at the end). No other import, no console, no `Math.random`, no `Date`. For noise, step a seed of your own on a `u32` (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset()`.
- No allocation while playing: `new`, arrays and strings only in field initialisers, the constructor or `activate()`. Never in `render()`, `paramChanged()` or a note handler.
- No top-level code but constants. Keep the export block at the top and the `abort` function at the bottom exactly as in the examples.
- Size every buffer and every time from the sample rate `activate()` receives.
- Each parameter: a numeric id that never changes, a range, a default inside it. The same ids and names in est.json's "parameters". The descriptor's id must equal est.json's "id": use `com.example.<name-in-kebab-case>` in both.
- Smooth every level or cutoff change (`Smoother`) so a moving knob does not click.
- A delay or reverb must die away: report its tail in frames from `tail()`, keep est.json's `limits.tailSeconds` (60 at most) at least that long, set `limits.memoryPagesMax` to 64, and set any feedback value below 1e-20 to 0.
- An effect: first feature "audio-effect"; est.json "kind" is "effect", "notes" is `{ "inputs": 0, "outputs": 0 }`, and "audio" is as in the effect example. An instrument: first feature "instrument"; "kind" is "instrument", "notes" is `{ "inputs": 1, "outputs": 0 }`, and "audio" has no inputs, as in the instrument example.
- A note's fields are `key`, `velocity`, `noteId`, `channel`, `port`, `time`. There is no `note.id`. `key` is an `i16`: write `<f64>note.key` before maths.
- Start from the example of the same kind and change it. If you are unsure a function exists, do not use it: write the few lines yourself.
<!-- agents:end prompt-rules -->

## The docs' own notes (not in any generated file)

- **Sidechain** (EST 1.1, Rust and C/C++ only for now): `{ "role": "sidechain" }` on a second audio input; Rust `const SIDECHAIN_CHANNELS: u32 = 2;` and `io.sidechain(c, n)` (`io.side_live` says whether a key is chosen). Prove the ducking in the golden test: add `"key": { "kind": "bursts", "level": 0.9 }` to `test/golden.json` and `est test` feeds it to the sidechain (`est dev --json --key kick` and `est demo --key kick` play the test loop's drums into it; `est validate`'s own run still feeds silence).
- **A crash capture** from Cyber (a `.estcapture.json`): `est replay --debug <capture> --json` names the function the plugin trapped in ([the dev host](dev-host.md#replaying-a-crash-est-replay)).
- **`est dev --json`** takes commands on its standard input, one JSON object a line (`{"cmd":"param","id":0,"value":-6}`, `{"cmd":"wait","ms":500}`, `{"cmd":"state"}`, `{"cmd":"note","key":60,"ms":300}`): [the dev host](dev-host.md).
- **The ABI** (`est-abi-1.0.json`, `est-abi-1.1.json` in a new folder) is only for a plugin written without the kit's runtime.
