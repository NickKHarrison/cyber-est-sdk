# The DSP library

One library in two languages with the same blocks and the same names (Rust's `snake_case` is AssemblyScript's `camelCase`):

- **Rust**: the crate `est` (no dependencies, `no_std`; its blocks in `est::dsp`, `use est::prelude::*` for everything);
- **AssemblyScript**: the library `est` (`import { … } from "est"`, found through asconfig.json's `"path"`).

`est new` copies the library into your plugin's folder as `est/` and points the build at the copy, so a new plugin builds on its own. The two builds of every block render the same input to within 1e-5 (in practice bit for bit: the SDK's cross-language test), so a plugin ported from one language to the other sounds the same.

The source in your folder is the reference: `est/src/lib.rs` and `est/src/dsp/*.rs` (Rust), or `est/index.ts` and `est/dsp/*.ts` (AssemblyScript). This page is the map.

## The rules every block keeps

- **Allocation, the same rule everywhere.** Rust: heap memory (`DelayLine::allocate`, `alloc_floats`) only in `activate`; `new` builds the plugin by value (its filters, smoothers and voices are plain values inside it) and allocates nothing. AssemblyScript: allocate (`new`, an array, a string) only in the plugin's constructor and field initialisers, or in `activate` (a delay line's buffer); the SDK's `setup`, which the export block calls, allocates the glue's own structs before them. In both, **nothing allocates in `render`, `process`, `param_changed`/`paramChanged` or the note handlers**: they run on the audio thread, inside a block.
- **A filter's cutoff and resonance are smoothed** inside the block, so automation does not click (see [Filter](#filter-the-cost-of-smoothing) for what that costs); anything else you move smoothly goes through a `Smoother`.
- **Deterministic**: no randomness in `render`, no reading the clock. Use the library's maths (`est::math` / the `est` exports: `exp`, `ln`, `sinTurns` …), never the host's.

## The plugin interface

An effect implements `Effect` (Rust: a trait; AssemblyScript: a class to extend), an instrument `Instrument`. Every hook but `render` (and, for an instrument, the note hooks) has a default.

| | Rust | AssemblyScript |
|---|---|---|
| Identity | `est::export_effect!(MyEffect, id: "…", name: "…", vendor: "…", version: "…", description: "…", features: ["audio-effect", …]);` (`export_instrument!` for an instrument) | a `Descriptor` given to `setup(describe(), parameters(), make)` in the template's `malloc` export block |
| Parameters, declared once | in the `impl`: `const PARAMS: &'static [Param] = &[Param::new(0, "Gain").range(-24.0, 24.0).default(0.0).unit("dB").decimals(1), …];` | `parameters(): Param[]` returning `[new Param(0, "Gain").range(-24, 24).default(0).unit("dB").decimals(1), …]` |
| Builder | `.range(min, max)`, `.default(v)`, `.unit("dB")`, `.decimals(n)`, `.module("Group")`, `.labels(&["A", "B"])` (a switch: see below), `.hertz()` (a frequency, worded "440 Hz", "1.20 kHz"), `.log()` (moves logarithmically: use it for a frequency, a time or a Q whose range starts above 0, and mark the same parameter `"scale": "log"` in est.json, which is what hosts read; see below), `.bypass()` (Off/On labels and CLAP's bypass flag), `.hidden()`, `.read_only()` | the same; `.readOnly()` |
| A value changed | `fn param_changed(&mut self, id: u32, value: f64)` (clamped and stepped already, at its own sample; every default arrives here first, before `activate`: see below) | `paramChanged(id: u32, value: f64): void` |
| Start | `fn activate(&mut self, sample_rate: f64, max_frames: u32) -> bool` | `activate(sampleRate: f64, maxFrames: u32): bool` |
| Audio | `fn render(&mut self, io: &mut Io, from: usize, to: usize)`: frames `from..to`; `io.input(c, n)`, `io.output(c, n, v)`, `io.add(c, n, v)`, `io.channels`, `io.param(id)` | `render(io: Io, from: i32, to: i32): void` |
| The block | `fn process(&mut self, io, events)`: by default splits the block at its events and calls `render` between them (override it only to see every event yourself) | `process(io: Io, events: Events): void` |
| Transport | `io.transport`: `tempo`, `playing`, `beat`, `bar_start`, `num`, `den` | `io.transport` (`barStart`) |
| State | the parameters are saved and loaded for you; your own bytes in `fn save_state(&self, w: &mut StateWriter)` / `fn load_state(&mut self, r: &mut StateReader, version: u32) -> bool` (`w.f64(x)`, `r.f64()`, `u32`, `f32`, `bytes`); the `impl`'s `const STATE_VERSION: u32` (default 1) says which version you write: raise it when your bytes change, and keep loading the old ones | `saveState(w: StateWriter): void` / `loadState(r: StateReader, version: u32): bool`; the version you write is the `Descriptor`'s `stateVersion` (default 1) |
| Notes (instruments) | `note_on(io, &Note)`, `note_off(io, &Note)`, `choke(io, &Note)`, `note_expression(io, &Expression)`, `midi(io, port, [u8; 3])`; a `Note` has `time` (its sample in the block), `note_id`, `port`, `channel`, `key`, `velocity` | `noteOn`, `noteOff`, `choke`, `noteExpression`, `midi(io, port, StaticArray<u8>)`; `noteId` |
| A note ended | `io.note_end(id, port, channel, key, n)` (`Voices` does it for you) | `io.noteEnd(…)` |
| Reported | `fn latency(&self) -> u32`, `fn tail(&self) -> u32` (frames; `est.json`'s `limits` must cover both) | `latency(): u32`, `tail(): u32` |

### Parameters: labels, defaults and the order of calls

- **`.labels(…)` makes a parameter stepped and sets its range**: one whole value per label, from 0 to the count − 1 (`min` 0, `max` n − 1, no decimals), replacing any `.range(…)` before it. A `.range(…)` after it changes the range again but the parameter stays stepped (its values are rounded to whole numbers) and its labels then name `min`, `min` + 1 …; give `.default(…)` as an index into the labels. The host shows a stepped parameter as a list or a stepped knob.
- **`.log()` for a frequency, a time or a Q.** CLAP has no scale, so a host reads it from est.json: give the parameter `"scale": "log"` there as well, and Cyber's generated knobs, `@cyber-est/ui`'s controls and automation lanes move over it geometrically (a lane's middle is the geometric middle, √(min · max)). The range must start above 0 and the parameter must not be stepped: Rust's `params_valid` refuses it at compile time, and the conformance run refuses an est.json `log` on any other range (EST-C021). Leave gains in dB, mixes and percentages linear.
- **Defaults reach `param_changed` before `activate`.** When the host creates the plugin (CLAP's `init`, right after `new`/the constructor), the glue stores every parameter's default and calls `param_changed(id, default)` for each, in declaration order. So a block set from a parameter (a `Smoother`'s target, a filter's cutoff) holds its default before `activate`; call the block's `reset()` in `activate` (after `set_sample_rate`) so it starts there instead of gliding from zero (the templates do). A loaded state's values arrive through `param_changed` too.
- **A value is clamped and stepped before it reaches you**, at its own sample in the block; `io.param(id)` reads the current value at any time.

## The blocks

| Block | Rust | AssemblyScript |
|---|---|---|
| `Smoother`: a one-pole glide to a target | `Smoother::new(seconds)`, `set_sample_rate`, `set_time`, `set_target`, `jump(v)`, `reset()`, `next() -> f64`, `value()`, `target()`, `settled()` | `new Smoother(seconds)`, `setSampleRate`, `setTime`, `setTarget`, `jump`, `reset`, `next`, `value`, `target`, `settled` |
| `Oscillator`: sine, and band-limited saw, square and triangle (polyBLEP and polyBLAMP) | `Oscillator::new()`, `set_sample_rate`, `set_frequency(hz)`, `set_wave(Wave::Saw)`, `reset(phase)`, `next()`, `phase()`, `frequency()`; `Wave::from_index(v)` | `new Oscillator()`, `setFrequency`, `setWave(Wave.Saw)` …; `waveFromIndex(v)` |
| `Filter`: a state-variable filter, cutoff and resonance smoothed | `Filter::new()`, `set_sample_rate`, `set_mode(FilterMode::Low)` (`Low`, `Band`, `High`, `Notch`), `set_cutoff(hz)`, `set_resonance(0..1)`, `set_smoothing(seconds)`, `reset()`, `process(x) -> f64`, `cutoff()`; `FilterMode::from_index(v)` | `new Filter()`, `setMode(FilterMode.Low)` …; `filterModeFromIndex(v)` |
| `Envelope`: ADSR | `Envelope::new()`, `set_sample_rate`, `set_adsr(a, d, s, r)` (or `set_attack` …, seconds; sustain 0..1), `start()`, `release()`, `reset()`, `next() -> f64`, `level()`, `stage()`, `is_active()`, `tail_frames()` | `new Envelope()`, `setAdsr`, `start`, `release`, `next`, `level`, `stage`, `isActive`, `tailFrames` |
| `Lfo`: free, or synced to the tempo | `Lfo::new()`, `set_sample_rate`, `set_rate(hz)`, `set_sync(beats)` (0: free), `set_tempo(bpm)` (from `io.transport.tempo`), `set_wave(Wave)`, `reset(phase)`, `next()` | `new Lfo()`, `setRate`, `setSync`, `setTempo`, `setWave`, `reset`, `next` |
| `Voices`: polyphony, oldest-note stealing, voices found by note id | `Voices::<MyVoice, 4>::new(MyVoice::new)` with `impl Voice for MyVoice { fn release(&mut self) … }`; `start(io, &note) -> i`, `release(&note)`, `choke(io, &note)`, `end(i, io, n)`, `is_on(i)`, `voice(i)`, `voice_mut(i)`, `note(i)`, `len()`, `reset()` | `new Voices<MyVoice>(4)` (`MyVoice extends Voice`, a constructor without arguments); `start`, `release`, `choke`, `end`, `isOn`, `voice(i)` |
| `DelayLine`: a fractional delay | `DelayLine::new()`, `allocate(max_frames) -> bool` (in `activate`), `write(x)`, `read(delay_frames) -> f64`, `clear()`, `capacity()` | `new DelayLine()`, `allocate`, `write`, `read`, `clear`, `capacity` |
| `Biquad`: the RBJ cookbook's peak, low shelf, high shelf, low pass and high pass | `Biquad::new()`, `set(BiquadKind::Peak, freq, q, gain_db, sample_rate)`, `process(x)`, `reset()`, `response_db(freq, sample_rate)`; `coefficients(kind, freq, q, gain_db, sample_rate) -> Coefficients`, `response_db(&c, freq, sample_rate)`; `BiquadKind::from_index(v)` | `new Biquad()`, `set(BiquadKind.Peak, …)`, `process`, `reset`, `responseDb`; `coefficientsInto(out, kind, …)`, `responseDb(c, …)`; `biquadKindFromIndex(v)` |
| Conversions and maths | `est::math`: `db_to_gain`, `gain_to_db`, `key_to_hz`, `exp`, `ln`, `exp2`, `log2`, `sin_turns`, `cos_turns`, `tan_half_turns`, `one_pole`, `clamp`, `floor`, `round` | `dbToGain`, `gainToDb`, `keyToHz`, `exp`, `ln`, `exp2`, `log2`, `sinTurns`, `cosTurns`, `tanHalfTurns`, `onePole`, `clamp`, `floor`, `round` from `"est"` |

### `Filter`: the cost of smoothing

While a `Filter`'s cutoff or resonance glides, it recomputes its coefficients (a tangent and a few divisions) **every sample**, for each filter; settled, it recomputes nothing. A glide's time constant is 5 ms by default, but it runs until the value is within 1e-9 of its target, about 20 time constants: some 0.1 s of per-sample updates after each change. Automation that moves every block keeps every filter recomputing every sample: with many voices of filters, that is most of a block's cost.

For a modulated cutoff (an envelope or an LFO on many voices, a sweep), update at control rate instead: turn the filter's own smoothing off and smooth the value yourself, setting the filter every 16 or 32 samples:

```rust
// in activate: f.set_smoothing(0.0); self.cut.set_sample_rate(sr); (self.cut: a Smoother)
fn render(&mut self, io: &mut Io, from: usize, to: usize) {
    for n in from..to {
        let c = self.cut.next();
        if (n & 31) == 0 { self.filter.set_cutoff(c) }   // one coefficient update per 32 samples
        // … self.filter.process(x) …
    }
}
```

With `set_smoothing(0.0)` a new cutoff costs one update, on the next sample. (`set_smoothing` takes seconds; AssemblyScript: `setSmoothing(0)`.) The same holds for `Biquad`: `set` computes coefficients, so call it when a value changes or at control rate, never every sample.

## Where the two languages differ

From the header of the AssemblyScript library's `index.ts` (`est/index.ts` in an AssemblyScript plugin's folder), which is the full list:

- a `Param`'s fields carry a suffix in AssemblyScript (`defaultValue`, `unitText`, `decimalCount`, `labelList`, `modulePath`); the builder's methods keep Rust's names;
- parameters are a function's list passed to `setup` (Rust: the `PARAMS` constant), and the identity a `Descriptor` (Rust: `export_effect!`'s arguments); the first feature decides the kind;
- `Plugin` is one base class with every hook, which `Effect` and `Instrument` extend (Rust: two traits); an effect's note hooks are never called;
- an `Event` from `events.get(k)` is one reused object, valid until the next `get` (Rust returns a copy); `Event.midi` is a `StaticArray<u8>` of three;
- enums have no methods: `waveFromIndex`, `filterModeFromIndex`, `biquadKindFromIndex` (Rust: `Wave::from_index` …);
- `coefficientsInto(out, …)` writes a biquad's coefficients (Rust: `coefficients(…)` returns them);
- `new Voices<T>(n)` makes its voices with `instantiate<T>()`, so a voice class has a constructor without arguments (Rust: `Voices::<T, N>::new(make)`); `voices.voice(i)` is the voice itself (Rust: `voice` and `voice_mut`);
- `Io` gives `setParam` and `lastSet` to the glue (Rust keeps them private);
- one instance per module, and allocation only in `setup` (the SDK's), the constructors and field initialisers, and `activate` (the runtime is a bump allocator that never frees).

## Where to look

- An effect: `est new effect-rust …` or `effect-as` (a smoothed gain into a resonant filter).
- An instrument: `est new instrument-rust …` or `instrument-as` (four voices of saw into a filter, each with an ADSR).
- A custom UI for either: `est new … --ui` ([the UI library](ui.md)).
