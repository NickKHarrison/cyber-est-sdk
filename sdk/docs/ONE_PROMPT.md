# The one prompt

For a chat assistant with no folder and no tools. Copy everything in the block below into the chat and replace `<one sentence>` with what the plugin should do.
The assistant answers with one code block that holds the whole plugin: a small `est.json`, the sound (`assembly/index.ts`) and the plugin's own window (`ui/index.html`, `ui/style.css`, `ui/ui.js`), each under a `=== file: <path> ===` line. Paste that whole answer into Cyber (Home → EST PLUGINS → Add a plugin file → Paste your AI's answer) or into the plugin playground: Cyber compiles it, packs it with its window and plays it. A zip of the same files can be dropped in the same place.

This page is generated from [for-agents.md](for-agents.md), `sdk/agents/prompt-example/` and the `effect-as` and `instrument-as` templates by `node sdk/agents/generate.mjs`: change those, never this.

````text
I want an audio plugin for Cyber (an "EST plugin") with its own designed window. You write its source files; Cyber compiles them and runs the plugin in a sandbox.

What I want it to do: <one sentence>

HOW TO ANSWER. Give me the whole plugin in ONE code block: five files, each complete, each under its own marker line, in this order:

=== file: est.json ===           (a few facts; Cyber fills in the rest)
=== file: assembly/index.ts ===  (the sound, in AssemblyScript)
=== file: ui/index.html ===      (the window)
=== file: ui/style.css ===
=== file: ui/ui.js ===

I will paste your whole answer into Cyber in one go, so: one code block only, no file left out, no "unchanged" or "..." placeholders, no build steps, and at most a line or two of talk outside the block. (If you can attach files, one .zip holding exactly these five files also works.) If I come back with errors, answer the same way, with every file again. Keep comments short so the answer is not cut off before the last file.

THE SOUND (`assembly/index.ts`). It is AssemblyScript, not TypeScript: no closures, no `any`, no union types, no optional chaining, no destructuring; every number has a type (`f64`, `i32`, `u32`) and is cast explicitly (`<f64>x`).
- Start from the example of the same kind (effect or instrument) and change it. Keep the export block at the top and the `abort` function at the bottom exactly as they are. No top-level code but constants.
- Import only from "est", and only what the library list at the end names. If a function is not listed, it does not exist: write the few lines yourself. No other import, no console, no `Math.random`, no `Date`. For noise, step a seed of your own on a `u32` (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), set from a constant in `reset()`.
- No allocation while playing: `new`, arrays and strings only in field initialisers, the constructor or `activate()`. Never in `render()`, `paramChanged()` or a note handler.
- Size every buffer and every time from the sample rate `activate()` receives.
- Each parameter is declared exactly as in the examples: `const NAME: u32 = <number>;` and `new Param(NAME, "Name")` with a range and a default inside it. Ids start at 0 and never change. Cyber reads this list from the code.
- The descriptor's id is `com.example.<name-in-kebab-case>` (lower case), the same as est.json's "id"; its version the same as est.json's.
- Smooth every level or cutoff change (`Smoother`) so a moving knob does not click. Keep the output between -1 and 1.
- A delay, echo or reverb must die away, and `tail()` must report (in frames, from the current settings) how long it still sounds after the input stops: until its repeats are 60 dB down. For an echo that is `delaySeconds * (1 + 7 / (1 - feedback))`, so cap feedback at 0.85 and the delay at 1 second (48 seconds at most); never report less than it really rings. Set est.json's `limits.tailSeconds` to the longest tail it can report (60 at most), and set any feedback value below 1e-20 to 0.
- An instrument extends `Instrument`, must sound when a note is held, and must end each voice (`this.voices.end(i, io, n)`) when its envelope finishes, as the example does. A note's fields are `key`, `velocity`, `noteId`, `channel`, `port`, `time`. There is no `note.id`. `key` is an `i16`: write `<f64>note.key` before maths.

THE WINDOW (`ui/index.html`, `ui/style.css`, `ui/ui.js`). Design a real panel for THIS plugin: its own layout, colours, lettering and character that suit what it does, with a display that moves (a curve, a scope shape, a level, an animation drawn from the parameters). Not a plain row of default sliders. The window runs in a locked sandbox, so:
- Exactly these three text files. No image files (draw with CSS, inline SVG or a canvas), no web fonts (system fonts only), nothing from the internet, no links.
- No JavaScript inside the HTML: no `<script>` with code in it, no `onclick=` attributes. All code goes in `ui/ui.js`, loaded as in the example: `<script src="est-ui.js"></script>` then `<script src="ui.js"></script>` at the end of `<body>`. Cyber supplies `est-ui.js`: never write it. No `type="module"`, no `import`.
- No `fetch`, no storage (`localStorage`), no audio or MIDI in the window: it makes no sound and plays no notes. It only reads and writes the plugin's parameters, by the same ids as the sound code. An instrument's keys are Cyber's own.
- est.json's `ui.size` is the window's exact size in CSS pixels (`w` 300 to 1000, `h` 200 to 700). Lay the page out to fill exactly that, with `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }`. Nothing outside that box is ever seen, so add up your rows' heights and choose a size every control fits in (a knob with its label and value is about its `size` + 40 px tall).
- Every parameter of the sound has a control in the window.
- Ready-made controls (accessible, draggable, keyboard and reset built in): `<est-knob param="1" label="Cutoff" unit="Hz" scale="log" size="64"></est-knob>` and `<est-slider param="0" label="Level" unit="dB"></est-slider>`; `param` is the parameter's id; `scale="log"` for a frequency; `labels="A, B, C"` for a switch. A knob is round; a slider is a horizontal bar that fills its container's width (for a vertical fader, build your own control). They take their colours from the CSS variables `--est-bg`, `--est-fg`, `--est-dim`, `--est-accent`, `--est-track`.
- The script's whole API, from `const est = EstUI.connect();`: `est.ready` (a promise: wait for it before reading), `est.get(id)` (the value), `est.param(id)` (`{ name, min, max, def }`), `est.set(id, value)`, `est.begin(id)` and `est.end(id)` (around the `set` calls of one drag or click of a control you build yourself), `est.subscribe(fn)` (called after every change, whoever made it: redraw there), `est.onMeter(fn)` (about 30 times a second: `fn({ out: [left, right] })`, linear peaks 0 to 1). Nothing else exists.

A WHOLE WORKING EXAMPLE, exactly as an answer looks (an effect: a gain into a filter, with its window). Change it into my plugin; do not copy its look:

=== file: est.json ===
{
  "id": "com.example.glow-filter",
  "name": "Glow Filter",
  "version": "1.0.0",
  "kind": "effect",
  "description": "A smoothed gain into a resonant filter with four shapes.",
  "limits": { "memoryPagesMax": 64, "tailSeconds": 1 },
  "ui": { "path": "ui/index.html", "size": { "w": 520, "h": 300 } }
}

=== file: assembly/index.ts ===
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
  return new Descriptor("com.example.glow-filter", "Glow Filter", "Me", "1.0.0",
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

// No imports: a trap instead of the runtime's `env.abort`.
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

=== file: ui/index.html ===
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Glow Filter</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header><h1>GLOW <span>FILTER</span></h1><div class="meter" aria-hidden="true"><i id="meter"></i></div></header>
<canvas id="curve" width="488" height="120" role="img" aria-label="The filter's shape"></canvas>
<main>
  <est-knob param="1" label="Cutoff" unit="Hz" scale="log" size="64"></est-knob>
  <est-knob param="2" label="Resonance" size="64"></est-knob>
  <est-knob param="0" label="Gain" unit="dB" size="64"></est-knob>
  <div class="modes" role="radiogroup" aria-label="Mode">
    <button type="button" role="radio" data-mode="0">Low</button>
    <button type="button" role="radio" data-mode="1">Band</button>
    <button type="button" role="radio" data-mode="2">High</button>
    <button type="button" role="radio" data-mode="3">Notch</button>
  </div>
</main>
<script src="est-ui.js"></script>
<script src="ui.js"></script>
</body>
</html>

=== file: ui/style.css ===
:root { --est-bg: #17121f; --est-fg: #f4ecff; --est-dim: #b7a9cf; --est-accent: #ff8a3d; --est-track: #3a2d52; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; color: var(--est-fg);
  background: radial-gradient(120% 90% at 50% 0%, #2a1f3d 0%, #17121f 70%); font: 12px/1.3 system-ui, sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; }
h1 { margin: 0; font-size: 15px; letter-spacing: .32em; font-weight: 800; }
h1 span { color: var(--est-accent); }
.meter { width: 120px; height: 6px; border-radius: 3px; background: var(--est-track); overflow: hidden; }
.meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #5ad1c3, var(--est-accent)); }
canvas { width: 488px; height: 120px; border-radius: 10px; background: #0f0b16; border: 1px solid var(--est-track); }
main { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.modes button { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--est-track); background: #221a31;
  color: var(--est-dim); font: inherit; cursor: pointer; }
.modes button[aria-checked="true"] { background: var(--est-accent); border-color: var(--est-accent); color: #1b1020; font-weight: 700; }
.modes button:focus-visible { outline: 2px solid var(--est-fg); outline-offset: 2px; }

=== file: ui/ui.js ===
// The window only reads and writes parameters (by the same ids as the sound code); it makes no sound.
const est = EstUI.connect();
const CUTOFF = 1, RESONANCE = 2, MODE = 3;
const canvas = document.getElementById('curve');
const g = canvas.getContext('2d');
const buttons = Array.from(document.querySelectorAll('.modes button'));

// A control of my own: one click is one gesture (begin, set, end), so it is one undo step in Cyber.
buttons.forEach(function (b) {
  b.addEventListener('click', function () {
    est.begin(MODE); est.set(MODE, Number(b.dataset.mode)); est.end(MODE);
  });
});

// Draw from the parameters' values: called on every change, whoever made it (this window, Cyber, automation).
function draw() {
  const mode = Math.round(est.get(MODE)), f0 = est.get(CUTOFF), q = 0.6 + est.get(RESONANCE) * 8;
  buttons.forEach(function (b) { b.setAttribute('aria-checked', String(Number(b.dataset.mode) === mode)); });
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.beginPath();
  for (let x = 0; x <= w; x++) {
    const r = 20 * Math.pow(1000, x / w) / f0;            // 20 Hz to 20 kHz, as a ratio to the cutoff
    const d = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
    const mag = mode === 0 ? 1 / d : mode === 1 ? (r / q) / d : mode === 2 ? r * r / d : Math.abs(1 - r * r) / d;
    const y = h * 0.45 - Math.max(-36, Math.min(18, 20 * Math.log10(mag + 1e-6))) * (h / 60);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = '#ff8a3d'; g.lineWidth = 2; g.shadowColor = '#ff8a3d'; g.shadowBlur = 12; g.stroke();
}

est.ready.then(function () { est.subscribe(draw); draw(); });
// The output level, about 30 times a second: linear peaks [left, right].
est.onMeter(function (m) { document.getElementById('meter').style.width = Math.min(100, Math.max(m.out[0], m.out[1]) * 100) + '%'; });

THE SAME FOR AN INSTRUMENT (four voices of a saw through a filter, each shaped by an envelope). Only its first two files are shown: its window is made the same way as the effect's. For an instrument, change this one into mine:

=== file: est.json ===
{
  "id": "com.example.saw-poly",
  "name": "Saw Poly",
  "version": "1.0.0",
  "kind": "instrument",
  "description": "Four voices of a saw through a resonant low-pass, each shaped by an envelope.",
  "limits": {
    "memoryPagesMax": 64,
    "tailSeconds": 5
  },
  "ui": {
    "path": "ui/index.html",
    "size": {
      "w": 520,
      "h": 300
    }
  }
}

=== file: assembly/index.ts ===
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
  return new Descriptor("com.example.saw-poly", "Saw Poly", "Me", "1.0.0",
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

// No imports: a trap instead of the runtime's `env.abort`.
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

THE "est" LIBRARY (everything the sound code may import):

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
