# An EST note effect in AssemblyScript

This folder is an EST plugin: a WebAssembly note effect (notes in, notes out) that Cyber installs from a `.est` bundle. It starts as an arpeggiator that follows the song's tempo and a chord memory that plays a learned chord from each key; you change it into the plugin described under **What to build**. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly, with no other toolchain.

## What to build

<!-- est:idea -->
Nobody has said yet what this plugin should do. Ask the person for one sentence, write it here, then build it.
<!-- /est:idea -->

## This template: notes in, notes out

A note effect is an effect (`"kind": "effect"`, audio passed through) with a note input and a **note output**: `"notes": { "inputs": 1, "outputs": 1 }` in `est.json`, `"note-effect"` in its features, and `Descriptor(…).noteEffect()` in the code. Notes arrive at their sample; it sends notes with `io.sendNoteOn(id, channel, key, velocity, n)` and `io.sendNoteOff`, each at a sample of the block.

- **Every note it starts it ends**: when the key is let go, when the mode changes, on a choke. The golden test counts them.
- The held keys and the chords are fixed arrays: nothing allocates while playing.
- `npx est dev` shows a keyboard; `npx est test` compares the notes it sends with `test/golden-notes.json`.

**What Cyber does with the notes today:** it runs a note effect as an insert (the audio passes through) and reports the notes it sends; whether they reach the next plugin on the track depends on the host's EST version. Build and test it now.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()` and one class extending `Effect`. |
| `test/golden-notes.json` | The notes the golden render must send, compared exactly. |
| `asconfig.json` | The compiler's options and how `est` builds it. Change only `maximumMemory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The kit's library, copied in: read it for exact signatures, do not edit it. |
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
  - `new`, array literals, strings and closures only in field initialisers, the constructor or `activate`. No top-level code but constants (it would become a start function, which traps: `EST-W`).
- **Be deterministic, import nothing**: the same input and events give the same output, bit for bit. No clock, no file, no host function. For noise, step your own seed, a 32-bit xorshift (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset`.
- **Size every buffer and time from the sample rate `activate` gives.** The validator runs at 48 kHz; Cyber runs at the device's rate.
- **The ids agree**: the descriptor's id is `est.json`'s `id` (`EST-C001`); the kind and ports match (`EST-C003`, `EST-C004`); each parameter has one numeric id in the code, in `est.json`'s `parameters`, in `test/golden.json`'s events and in the window (`EST-C008`), and it never changes.
- **The state magic** (four characters, where the plugin is described) never changes once anyone has a version.
- **Stay in range**: no output above +18 dBFS, no NaN, memory within `limits.memoryPagesMax` (64 KiB pages).
- **Flush tiny numbers** (`EST-C027`): set a state that feeds itself (a feedback path, a filter's memory, an envelope falling to 0) to 0 once it is below `1e-20`. The kit's `Filter` already does.
- **Every version is new**: bump `version` in `est.json` for each build you hand to anyone.

## How it is written (AssemblyScript)

- **The export block** at the top of `assembly/index.ts` and the `abort` function at the bottom stay as they are. `describe()` is the identity and the state magic; its first feature (`"audio-effect"` or `"instrument"`) decides the kind.
- **Parameters** are declared once, in `parameters()`, and listed in `est.json`. Values are plain units (dB, Hz, ms), never 0 to 1.
- `paramChanged(id, value)` gets each new value at its own sample. Every default arrives there first, before `activate`, so `activate` sets each block's sample rate and then resets it, as the template does.
- `render(io, from, to)` writes frames `from` to `to`: `io.input(c, n)` in, `io.output(c, n, v)` out.
- `tail()` is how many frames still sound after the input stops; 0 unless something rings.
- `saveState(w)` and `loadState(r, version)` add your own bytes after the parameters, which are saved for you.

## The library on one page (AssemblyScript)

Import everything from `"est"`. Numbers are `f64` unless a type is shown. If a function is not listed here, it does not exist: write the few lines yourself.

The library's source is in `est/`: read it for anything more, do not edit it.

- **Base class**: extend `Effect` or `Instrument`. You must write `render(io: Io, from: i32, to: i32): void`. Optional hooks: `activate(sampleRate: f64, maxFrames: u32): bool`, `reset(): void`, `paramChanged(id: u32, value: f64): void`, `tail(): u32` and `latency(): u32` (frames), `event(io: Io, e: Event): void`, `saveState(w: StateWriter): void`, `loadState(r: StateReader, version: u32): bool`.
- **`Io`**: `io.channels: i32`, `io.frames: i32`, `io.input(c: i32, n: i32): f32`, `io.output(c, n, v: f32)`, `io.add(c, n, v: f32)`, `io.param(id: u32): f64`, `io.transport`.
- **Note hooks**: `noteOn(io: Io, note: Note): void`, `noteOff` and `choke` (the same arguments). Out: `io.noteEnd(id: i32, port: i16, channel: i16, key: i16, n: i32)`, `io.sendNoteOn(id: i32, channel: i16, key: i16, velocity: f64, n: i32)`, `io.sendNoteOff` (the same arguments).
- **`Note`** fields: `time: i32` (its frame in the block), `noteId: i32` (-1: none), `port: i16`, `channel: i16`, `key: i16`, `velocity: f64` (0 to 1). There is no `id` field. Cast before maths: `keyToHz(<f64>note.key)`.
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
- **`Voices<T>`**: `new Voices<MyVoice>(n)` in a field initialiser; `start(io, note): i32` (the voice's index), `release(note)`, `choke(io, note)`, `voice(i): T`, `note(i): Note`, `isOn(i): bool`, `end(i, io, n)`, `reset()`. A voice class extends `Voice`, has a constructor with no arguments, and overrides `release(): void` and `stop(): void`.
- **State**: `w.u32(v)`, `w.f32(v)`, `w.f64(v)`; `r.u32()`, `r.f32()`, `r.f64()`.

## What costs time

`npx est validate` reports a block's mean cost and warns past 100 µs (`EST-P001`, a warning only). The warning is the best of three runs, so the cost is real (`npx est profile --json` names the function). The usual causes:

- **A sine a sample.** `sinTurns`, `cosTurns`, a sine `Oscillator` and a sine `Lfo` each sum a series with a division per term. One LFO is fine; one per voice adds up. Cheaper: a triangle or saw `Lfo`, your own phase with a parabola, or one value every 16 frames, smoothed.
- **A gliding `Filter`** works out its coefficients again every sample while its cutoff or resonance moves. If you move the cutoff all the time (an envelope, an LFO), call `setSmoothing(0)` once and `setCutoff` every 16 frames.
- **`DelayLine`'s `read` with a fraction** interpolates: a chorus needs it, a plain echo can round its delay to whole frames.
- **`exp`, `ln`, `dbToGain`, `keyToHz` a sample.** Work them out in `paramChanged` or at the note's start, and smooth the result.

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
