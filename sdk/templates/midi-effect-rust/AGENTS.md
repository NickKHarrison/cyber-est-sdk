# An EST note effect in Rust

This folder is an EST plugin: a WebAssembly note effect (notes in, notes out) that Cyber installs from a `.est` bundle. It starts as an arpeggiator that follows the song's tempo and a chord memory that plays a learned chord from each key; you change it into the plugin described under **What to build**.

## What to build

<!-- est:idea -->
Nobody has said yet what this plugin should do. Ask the person for one sentence, write it here, then build it.
<!-- /est:idea -->

## This template: notes in, notes out

A note effect is an effect (`"kind": "effect"`, audio passed through) with a note input and a **note output**: `"notes": { "inputs": 1, "outputs": 1 }` in `est.json`, `"note-effect"` in its features, and est::export_note_effect! in the code. Notes arrive at their sample; it sends notes with `io.send_note_on(id, channel, key, velocity, n)` and `io.send_note_off`, each at a sample of the block.

- **Every note it starts it ends**: when the key is let go, when the mode changes, on a choke. The golden test counts them.
- The held keys and the chords are fixed arrays: nothing allocates while playing.
- `npx est dev` shows a keyboard; `npx est test` compares the notes it sends with `test/golden-notes.json`.

**What Cyber does with the notes today:** it runs a note effect as an insert (the audio passes through) and reports the notes it sends; whether they reach the next plugin on the track depends on the host's EST version. Build and test it now.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `src/lib.rs` | The plugin: one `impl Effect` and one `est::export_note_effect!`. |
| `test/golden-notes.json` | The notes the golden render must send, compared exactly. |
| `Cargo.toml` | The crate; `[package.metadata.est]` tells `est` how to build it. |
| `.cargo/config.toml` | The target (`wasm32-unknown-unknown`) and the link flags. Change only `--max-memory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The kit's crate `est`, copied in (a path dependency): read it for exact signatures, do not edit it. |
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
  - Heap memory (`DelayLine::allocate`) only in `activate`; no `Vec`, no `Box`. It is `no_std`: use `est::math`, and add no dependency that needs `std`.
- **Be deterministic, import nothing**: the same input and events give the same output, bit for bit. No clock, no file, no host function. For noise, step your own seed, a 32-bit xorshift (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset`.
- **Size every buffer and time from the sample rate `activate` gives.** The validator runs at 48 kHz; Cyber runs at the device's rate.
- **The ids agree**: the descriptor's id is `est.json`'s `id` (`EST-C001`); the kind and ports match (`EST-C003`, `EST-C004`); each parameter has one numeric id in the code, in `est.json`'s `parameters`, in `test/golden.json`'s events and in the window (`EST-C008`), and it never changes.
- **The state magic** (four characters, where the plugin is described) never changes once anyone has a version.
- **Stay in range**: no output above +18 dBFS, no NaN, memory within `limits.memoryPagesMax` (64 KiB pages).
- **Flush tiny numbers** (`EST-C027`): set a state that feeds itself (a feedback path, a filter's memory, an envelope falling to 0) to 0 once it is below `1e-20`. The kit's `Filter` already does.
- **Every version is new**: bump `version` in `est.json` for each build you hand to anyone.

## How it is written (Rust)

- **The plugin** is one `impl Effect` or `impl Instrument` in `src/lib.rs` and one `est::export_effect!`, `est::export_instrument!` or `est::export_note_effect!` at the bottom: the macro's `id` is the identity, and the macro decides the kind. `use est::prelude::*;` brings the library.
- **Parameters** are declared once, in `PARAMS`, and listed in `est.json`. Values are plain units (dB, Hz, ms), never 0 to 1.
- `param_changed(id, value)` gets each new value at its own sample. Every default arrives there first, before `activate`, so `activate` sets each block's sample rate and then resets it, as the template does.
- `new()` builds the plugin by value and allocates nothing; `activate(sample_rate, max_frames)` is the only place to allocate.
- `render(io, from, to)` writes frames `from..to`: `io.input(c, n)` in, `io.output(c, n, v)` out.
- `tail()` is how many frames still sound after the input stops; 0 unless something rings.
- `STATE_MAGIC` is four bytes (`u32::from_le_bytes(*b"ABCD")`); `save_state` and `load_state` add your own bytes after the parameters, which are saved for you.

## The library on one page (Rust)

`use est::prelude::*;` brings all of it; its source is in `est/src/` (read it for anything more, do not edit it). Numbers are `f64` unless a type is shown. If a function is not listed here, it does not exist: write the few lines yourself.

- **Traits**: `Effect` and `Instrument`. You must write `const PARAMS: &'static [Param]`, `const STATE_MAGIC: u32`, `fn new() -> Self` and `fn render(&mut self, io: &mut Io, from: usize, to: usize)`. Optional: `activate(&mut self, sample_rate: f64, max_frames: u32) -> bool`, `reset(&mut self)`, `param_changed(&mut self, id: u32, value: f64)`, `tail(&self) -> u32` and `latency(&self) -> u32` (frames), `event(&mut self, io: &mut Io, e: &Event)`, `save_state(&self, w: &mut StateWriter)`, `load_state(&mut self, r: &mut StateReader, version: u32) -> bool`, `const STATE_VERSION: u32`, an effect's `const SIDECHAIN_CHANNELS: u32`.
- **`Io`**: `io.channels`, `io.frames`, `io.input(c: usize, n: usize) -> f32`, `io.output(c, n, v: f32)`, `io.add(c, n, v: f32)`, `io.param(id: u32) -> f64`, `io.transport`, `io.sidechain(c, n) -> f32`.
- **Note hooks** (an instrument must write all three): `note_on(&mut self, io: &mut Io, note: &Note)`, `note_off` and `choke` (the same arguments). Out: `io.note_end(id: i32, port: i16, channel: i16, key: i16, n: usize)`, `io.send_note_on(id: i32, channel: i16, key: i16, velocity: f64, n: usize)`, `io.send_note_off` (the same arguments).
- **`Note`** fields: `time` (its frame in the block), `note_id: i32` (-1: none), `port: i16`, `channel: i16`, `key: i16`, `velocity: f64` (0 to 1). There is no `id` field. Cast before maths: `key_to_hz(note.key as f64)`.
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
- **`Voices<T, N>`**: `Voices::new(make)` with `make: impl Fn() -> T`; `start(io, note) -> usize` (the voice's index), `release(note)`, `choke(io, note)`, `voice(i)`, `voice_mut(i)`, `note(i)`, `is_on(i)`, `end(i, io, n)`, `reset()`. A voice implements `Voice`: `release(&mut self)` and `stop(&mut self)`.
- **State**: `w.u32(v)`, `w.f32(v)`, `w.f64(v)`; `r.u32()`, `r.f32()`, `r.f64()`.

## What costs time

`npx est validate` reports a block's mean cost and warns past 100 µs (`EST-P001`, a warning only). The warning is the best of three runs, so the cost is real (`npx est profile --json` names the function). The usual causes:

- **A sine a sample.** `sin_turns`, `cos_turns`, a sine `Oscillator` and a sine `Lfo` each sum a series with a division per term. One LFO is fine; one per voice adds up. Cheaper: a triangle or saw `Lfo`, your own phase with a parabola, or one value every 16 frames, smoothed.
- **A gliding `Filter`** works out its coefficients again every sample while its cutoff or resonance moves. If you move the cutoff all the time (an envelope, an LFO), call `set_smoothing(0.0)` once and `set_cutoff` every 16 frames.
- **`DelayLine`'s `read` with a fraction** interpolates: a chorus needs it, a plain echo can round its delay to whole frames.
- **`exp`, `ln`, `db_to_gain`, `key_to_hz` a sample.** Work them out in `param_changed` or at the note's start, and smooth the result.

## Following the song

The transport (tempo, beat, playing) is **as of the block's first sample**, or of a transport event inside the block. It does not move while you render: keep your own beat and add `tempo / 60 / sampleRate` each sample while it plays. With no transport event `playing` is false, and `npx est validate` and the default golden render run that way.

To prove a plugin that follows the tempo, put a transport event in `test/golden.json`'s `events` (every field is needed; `time` in seconds):

```json
{ "type": "transport", "time": 0, "tempo": 120, "beat": 0, "seconds": 0, "num": 4, "den": 4, "barStart": 0, "barNumber": 0, "playing": true }
```

Count bars from `barStart`, never from beat 0.

## Easy to get wrong

- **A frequency or time knob** wants a log scale: `.log()` on the parameter and `"scale": "log"` on its row in `est.json`'s `parameters`.
- **A switch or chooser** (`.labels`) shows its labels on Cyber's knobs: at most 64 steps, 32 characters a label.
- **Smooth every level and cutoff change** (`Smoother`), or a moving knob clicks.
- **`test/golden.json`'s events name parameters by id** (`{ "type": "param", "time": 0.1, "id": 1, "value": 800 }`: plain units, seconds). Change them when a parameter changes, then `npx est test --update`.
- **A note in `test/golden.json`**: `{ "type": "noteOn", "time": 0.1, "key": 60, "channel": 0, "port": 0, "noteId": 1, "velocity": 0.8 }`, then a `noteOff` with the same `noteId`.
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
