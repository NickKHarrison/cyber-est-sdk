# The one prompt

For a chat assistant with no folder and no tools. Copy everything in the block below into the chat and replace `<one sentence>` with what the plugin should do.
The assistant answers with two files, `assembly/index.ts` and `est.json`: paste them into Cyber's plugin playground, or over the same two files in a folder made by `npx @cyber-est/cli new`.

This page is generated from [for-agents.md](for-agents.md) and the `effect-as` and `instrument-as` templates by `node sdk/agents/generate.mjs`: change those, never this.

````text
I want an audio plugin for Cyber (an "EST plugin"): AssemblyScript compiled to WebAssembly, run in a sandbox.
Write me TWO files, each whole, in its own code block: `assembly/index.ts` and `est.json`. I will paste them into Cyber's plugin playground, or into a folder made by the kit's `est new`, which compiles and plays them. No other files, no build steps.

What I want it to do: <one sentence>

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

A whole working effect (a gain into a filter). For an effect, change this one into mine:

--- assembly/index.ts ---
import {
  Descriptor, Effect, Filter, Io, Param, Plugin, Smoother,
  alloc, dbToGain, filterModeFromIndex, isReady, setup,
} from "est";

// --- The export block every EST plugin in AssemblyScript carries: `clap_entry`, `free`, and a
// `malloc` that writes the plugin's structs before its first allocation.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-effect-template-as", "EST Effect Template (AS)", "Example", "1.0.0",
    "A smoothed gain into a resonant filter: the starting point for an EST effect in AssemblyScript.",
    ["audio-effect", "filter", "stereo"], "TMPE", 1);
}

const GAIN: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const MODE: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(GAIN, "Gain").range(-60, 12).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(20000).hertz().module("Filter"),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0).module("Filter"),
    new Param(MODE, "Mode").labels(["Low-pass", "Band-pass", "High-pass", "Notch"]).module("Filter"),
  ];
}

class Template extends Effect {
  gain: Smoother = new Smoother(0.005);
  left: Filter = new Filter();
  right: Filter = new Filter();
  sampleRate: f64 = 48000;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.gain.setSampleRate(sampleRate);
    this.left.setSampleRate(sampleRate);
    this.right.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void {
    this.gain.reset();
    this.left.reset();
    this.right.reset();
  }

  paramChanged(id: u32, value: f64): void {
    if (id == GAIN) this.gain.setTarget(dbToGain(value));
    else if (id == CUTOFF) { this.left.setCutoff(value); this.right.setCutoff(value); }
    else if (id == RESONANCE) { this.left.setResonance(value); this.right.setResonance(value); }
    else if (id == MODE) { this.left.setMode(filterModeFromIndex(value)); this.right.setMode(filterModeFromIndex(value)); }
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const g = this.gain.next();
      if (io.channels > 0) io.output(0, n, <f32>(this.left.process(<f64>io.input(0, n)) * g));
      if (io.channels > 1) io.output(1, n, <f32>(this.right.process(<f64>io.input(1, n)) * g));
    }
  }

  /** A resonant filter rings on after its input stops: a second covers it. */
  tail(): u32 { return <u32>this.sampleRate; }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

--- est.json ---
{
  "est": 1,
  "id": "org.example.est-effect-template-as",
  "version": "1.0.0",
  "name": "EST Effect Template (AS)",
  "vendor": "Example",
  "description": "A smoothed gain into a resonant filter: the starting point for an EST effect in AssemblyScript.",
  "license": "MIT",
  "kind": "effect",
  "features": ["audio-effect", "filter", "stereo"],
  "abi": { "est": "1.0", "clap": "1.2" },
  "module": { "path": "module.wasm" },
  "assets": [],
  "audio": { "inputs": [{ "channels": 2 }], "outputs": [{ "channels": 2 }], "sampleRates": "any" },
  "notes": { "inputs": 0, "outputs": 0 },
  "limits": { "maxLatencyFrames": 0, "memoryPagesMax": 16, "tailSeconds": 1 },
  "parameters": [
    { "id": 0, "name": "Gain", "unit": "dB" },
    { "id": 1, "name": "Cutoff", "unit": "Hz" },
    { "id": 2, "name": "Resonance" },
    { "id": 3, "name": "Mode" }
  ],
  "stateVersion": 1,
  "permissions": [],
  "compat": { "host": ">=1.0.0 <2" }
}

A whole working instrument (four voices of a saw through a filter, each shaped by an envelope). For an instrument, change this one into mine:

--- assembly/index.ts ---
import {
  Descriptor, Envelope, Filter, Instrument, Io, Note, Oscillator, Param, Plugin, Smoother, Voice, Voices, Wave,
  alloc, dbToGain, isReady, keyToHz, setup,
} from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-instrument-template-as", "EST Instrument Template (AS)", "Example", "1.0.0",
    "Four voices of a saw through a resonant low-pass and an ADSR: the starting point for an EST instrument in AssemblyScript.",
    ["instrument", "synthesizer", "stereo"], "TMPI", 1);
}

const LEVEL: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const VOICES = 4;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-60, 0).default(-12).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(2000).hertz().module("Filter"),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.2).module("Filter"),
    new Param(ATTACK, "Attack").range(1, 2000).default(5).unit("ms").decimals(0).module("Envelope"),
    new Param(DECAY, "Decay").range(1, 2000).default(200).unit("ms").decimals(0).module("Envelope"),
    new Param(SUSTAIN, "Sustain").range(0, 100).default(70).unit("%").decimals(0).module("Envelope"),
    new Param(RELEASE, "Release").range(1, 4000).default(300).unit("ms").decimals(0).module("Envelope"),
  ];
}

class SynthVoice extends Voice {
  osc: Oscillator = new Oscillator();
  filter: Filter = new Filter();
  env: Envelope = new Envelope();
  velocity: f64 = 0;
  constructor() { super(); this.osc.setWave(Wave.Saw); }
  release(): void { this.env.release(); }
  stop(): void { this.env.reset(); }
}

class Template extends Instrument {
  voices: Voices<SynthVoice> = new Voices<SynthVoice>(VOICES);
  level: Smoother = new Smoother(0.005);
  sampleRate: f64 = 48000;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.level.setSampleRate(sampleRate);
    this.level.reset();
    for (let i = 0; i < VOICES; i++) {
      const v = this.voices.voice(i);
      v.osc.setSampleRate(sampleRate);
      v.filter.setSampleRate(sampleRate);
      v.env.setSampleRate(sampleRate);
    }
    return true;
  }

  reset(): void { this.voices.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == LEVEL) { this.level.setTarget(dbToGain(value)); return; }
    for (let i = 0; i < VOICES; i++) {
      const v = this.voices.voice(i);
      if (id == CUTOFF) v.filter.setCutoff(value);
      else if (id == RESONANCE) v.filter.setResonance(value);
      else if (id == ATTACK) v.env.setAttack(value / 1000);
      else if (id == DECAY) v.env.setDecay(value / 1000);
      else if (id == SUSTAIN) v.env.setSustain(value / 100);
      else if (id == RELEASE) v.env.setRelease(value / 1000);
    }
  }

  noteOn(io: Io, note: Note): void {
    const i = this.voices.start(io, note);
    const v = this.voices.voice(i);
    v.osc.setFrequency(keyToHz(<f64>note.key));
    v.osc.reset(0);
    v.filter.reset();
    v.env.start();
    v.velocity = note.velocity;
  }

  noteOff(io: Io, note: Note): void { this.voices.release(note); }

  choke(io: Io, note: Note): void { this.voices.choke(io, note); }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const level = this.level.next();
      let sum = 0.0;
      for (let i = 0; i < VOICES; i++) {
        if (!this.voices.isOn(i)) continue;
        const v = this.voices.voice(i);
        const e = v.env.next();
        if (!v.env.isActive()) { this.voices.end(i, io, n); continue; }
        sum += v.filter.process(v.osc.next()) * e * v.velocity;
      }
      const s = <f32>(sum * level);
      io.add(0, n, s);
      io.add(1, n, s);
    }
  }

  /** The longest a released voice sounds: its release. */
  tail(): u32 { return this.voices.voice(0).env.tailFrames(); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

--- est.json ---
{
  "est": 1,
  "id": "org.example.est-instrument-template-as",
  "version": "1.0.0",
  "name": "EST Instrument Template (AS)",
  "vendor": "Example",
  "description": "Four voices of a saw through a resonant low-pass and an ADSR: the starting point for an EST instrument in AssemblyScript.",
  "license": "MIT",
  "kind": "instrument",
  "features": ["instrument", "synthesizer", "stereo"],
  "abi": { "est": "1.0", "clap": "1.2" },
  "module": { "path": "module.wasm" },
  "assets": [],
  "audio": { "inputs": [], "outputs": [{ "channels": 2 }], "sampleRates": "any" },
  "notes": { "inputs": 1, "outputs": 0 },
  "limits": { "maxLatencyFrames": 0, "memoryPagesMax": 16, "tailSeconds": 5 },
  "parameters": [
    { "id": 0, "name": "Level", "unit": "dB" },
    { "id": 1, "name": "Cutoff", "unit": "Hz" },
    { "id": 2, "name": "Resonance" },
    { "id": 3, "name": "Attack", "unit": "ms" },
    { "id": 4, "name": "Decay", "unit": "ms" },
    { "id": 5, "name": "Sustain", "unit": "%" },
    { "id": 6, "name": "Release", "unit": "ms" }
  ],
  "stateVersion": 1,
  "permissions": [],
  "compat": { "host": ">=1.0.0 <2" }
}

The "est" library (everything you may import):

Import everything from `"est"`. Numbers are `f64` unless a type is shown. If a function is not listed here, it does not exist: write the few lines yourself.

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
````
