# The one prompt

For a chat assistant with no folder and no tools. Copy everything in the block below into the chat and replace `<one sentence>` with what the plugin should do.
The assistant answers with one code block that holds the whole plugin: a small `est.json`, the sound (`assembly/index.ts`) and the plugin's own window (`ui/index.html`, `ui/style.css`, `ui/ui.js`), each under a `=== file: <path> ===` line. Paste that whole answer into Cyber (Home → EST PLUGINS → Add a plugin file → Paste your AI's answer) or into the plugin playground: Cyber compiles it, packs it with its window and plays it. An assistant that can run code or create files also gives a file to download, `<name>.est`: the plugin's source (the same five files in a zip, nothing compiled), dropped in the same place. Only the `.est` Cyber builds from it (Save its .est file, on the plugin's page) is a built plugin to share; a source `.est` is refused everywhere else.

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

I will paste your whole answer into Cyber in one go, so: one code block only, no file left out, no "unchanged" or "..." placeholders, no build steps, and at most a line or two of talk outside the block. If I come back with errors, answer the same way, with every file again. Keep comments short so the answer is not cut off before the last file.

A FILE TO DOWNLOAD. If you can run code or create files, ALSO make the plugin as one file for me to download, named after the plugin (for example `glow-filter.est`): a zip of exactly the same five files at its top level, with nothing compiled in it. Give me the file and say "Drop this file on Cyber". Still show the code block above, in case the download does not work. In Python:

import re, zipfile
answer = r'''<the code block's text, exactly as you show it, from the first === line>'''
parts = re.split(r'^=== file: (.+?) ===[ \t]*\n', answer, flags=re.M)
with zipfile.ZipFile('glow-filter.est', 'w', zipfile.ZIP_DEFLATED) as z:
    for path, text in zip(parts[1::2], parts[2::2]):
        z.writestr(path.strip(), text.rstrip() + '\n')

THE SOUND (`assembly/index.ts`). It is AssemblyScript: TypeScript's syntax, stricter. Every number has a type (`f64`, `i32`) and is cast explicitly (`<f64>x`); no closures, no `any`, no union types, no optional chaining, no destructuring.
- You build the sound from blocks of Cyber's sound kit, "sound1". Start from the example of the same kind (effect or instrument) and change it. Keep the export block at the top (with your id, name and class) and the `abort` line at the bottom. No top-level code but constants.
- You write ONE method, `tick()`, which runs once per sample. In an effect the input is in `this.l` and `this.r`: leave the output there. In an instrument, your voice class's `tick()` returns one sample of ONE voice; the kit plays the notes (it starts, releases, steals and ends voices), applies the voice's loudness envelope `this.amp`, and mixes the voices.
- Do not write `activate`, `reset`, `render`, `process`, note handlers, `tail` or any sample-rate code: the kit does all of it. It also smooths every parameter, clears the blocks, reports how long the plugin rings, and keeps the output safe. Times are in seconds, frequencies in Hz.
- Make blocks only as fields (`osc: Osc = new Osc();`), never with `new` inside `tick()`. Call each block once per sample, and give each signal its own block (a stereo effect needs a left one and a right one; two oscillators need two `Osc`).
- An instrument must sound on every key at its default settings: a drum kit gives each drum a range of keys (`if (this.key < 48.0) …`), never single keys only.
- Import only from "sound1", and only what the kit list at the end names. If it is not listed, it does not exist: write the few lines yourself. No other import, no console, no `Math.random`, no `Date`.
- Each parameter is declared exactly as in the examples: `const NAME: u32 = <number>;` and `new Param(NAME, "Name")` with a range and a default. Ids start at 0 and never change. Read a parameter with `param(NAME)`, a switch with `choice(NAME)`.
- The id is `com.example.<name-in-kebab-case>` (lower case), the same in `new Descriptor(…)` and est.json; the version too.
- est.json may name the maker's email: `"contact": { "email": "…" }`. It is optional and recommended: feature requests people send about the plugin in Cyber are emailed there, and it is never shown. Add it only with an address the person gave you (ask for it once, as optional); never make one up.

THE WINDOW (`ui/index.html`, `ui/style.css`, `ui/ui.js`). Build it from Cyber's window kit: you place and style the elements below, and each one connects itself to its parameter (both ways: drag, keys, touch, presets, automation). Design a real panel for THIS plugin: a layout, a theme and colours of its own that suit what it does. Not the example's look. The window runs in a locked sandbox, so:
- Exactly these three text files (`ui/ui.js` may be one comment line when you draw nothing yourself). No images, no web fonts, nothing from the internet, no links. No code inside the HTML (no inline `<script>`, no `onclick=`), no `type="module"`, no `fetch`, no storage, no sound or notes from the window: an instrument's keys are Cyber's own.
- The page is laid out as the example's: one `<est-window name="…" theme="…">` holding everything, then `<script src="est-ui.js"></script>` and `<script src="ui.js"></script>`. Cyber supplies `est-ui.js`: never write it.
- `<est-window>` fills the window by itself at every size: it is a column of rows that share its height, and a row's children share its width. So never give a kit element a fixed pixel size or position. est.json's `ui.size` is the starting size (`w` 300 to 1000, `h` 200 to 700): allow about 110 px of height for each row of knobs and 100 px of width for each knob.
- `param="…"` is the parameter's name exactly as in the sound code's `new Param(NAME, "Name")`. EVERY parameter of the sound gets exactly one control. Units and a choice's labels are taken from the sound code: do not repeat them.
- The elements (all of them; nothing else exists):
  - `<est-knob param="Cutoff"></est-knob>`: a dial. `<est-slider param="Mix"></est-slider>`: a horizontal fader; add `vertical` for an upright one.
  - `<est-switch param="Drive On"></est-switch>`: on/off, for a parameter with two labels. `<est-select param="Mode"></est-select>`: one button per label, for a parameter with a few labels; add `menu` for a drop-down when there are many.
  - `<est-xy x="Cutoff" y="Resonance"></est-xy>`: a pad that moves two parameters. `<est-value param="Cutoff"></est-value>`: the value as text.
  - `<est-meter></est-meter>`: the output level. `<est-spectrum></est-spectrum>`: the live spectrum of the sound.
  - `<est-row>`: a row. `<est-panel label="Filter">`: a titled box holding rows and controls. `<est-all></est-all>`: a control for every parameter you have not placed.
  - Any control takes `label="…"` (a shorter caption). `<est-window>` takes `name` (the title), `meter` (a level meter beside the title) and `theme`: `studio` (dark slate, teal), `neon` (black, magenta, monospace), `paper` (cream, ink, serif), `ember` (warm dark, orange) or `moss` (pale green, rounded).
- Style it in `ui/style.css`: set variables on `est-window` (`--est-bg`, `--est-panel`, `--est-fg` text, `--est-dim` quiet text, `--est-accent`, `--est-track`, `--est-cap` a knob's body, `--est-radius`, `--est-font`), and add backgrounds, borders and shadows of your own to `est-window`, `est-panel`, `h1` and your own elements. Cyber keeps the text readable whatever colours you choose.
- A display you draw yourself (optional): put `<canvas id="curve"></canvas>` directly inside `<est-window>` and, in `ui/ui.js`, call `EstUI.display('#curve', function (g, w, h) { … })`: `g` is the canvas's 2D context, `w` and `h` its size; it is called again after every parameter change. Read a value with `est.get(ID)` from `var est = EstUI.connect();` (the same ids as the sound code; `undefined` before Cyber's first message, so return early then). That is the script's whole API.

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
import { Descriptor, Effect, Filter, Param, alloc, choice, dbToGain, isReady, param, start } from "sound1";

// The export block: keep it as it is, with your plugin's id, name, version and class.
export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.glow-filter", "Glow Filter", "Me", "1.0.0"), parameters(), new GlowFilter());
  return alloc(size);
}

const GAIN: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const MODE: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(GAIN, "Gain").range(-60, 12).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(20000).hertz(),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0),
    new Param(MODE, "Mode").labels(["Low-pass", "Band-pass", "High-pass", "Notch"]),
  ];
}

class GlowFilter extends Effect {
  left: Filter = new Filter();
  right: Filter = new Filter();

  // Runs once a sample. The input is in this.l and this.r: leave the output there.
  tick(): void {
    const hz = param(CUTOFF), res = param(RESONANCE), mode = choice(MODE);
    if (mode == 0) { this.l = this.left.lowpass(this.l, hz, res); this.r = this.right.lowpass(this.r, hz, res); }
    else if (mode == 1) { this.l = this.left.bandpass(this.l, hz, res); this.r = this.right.bandpass(this.r, hz, res); }
    else if (mode == 2) { this.l = this.left.highpass(this.l, hz, res); this.r = this.right.highpass(this.r, hz, res); }
    else { this.l = this.left.notch(this.l, hz, res); this.r = this.right.notch(this.r, hz, res); }
    const gain = dbToGain(param(GAIN));
    this.l *= gain;
    this.r *= gain;
  }
}

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
<est-window name="Glow Filter" theme="ember" meter>
  <canvas id="curve" aria-label="The filter's shape"></canvas>
  <est-row>
    <est-knob param="Cutoff" unit="Hz"></est-knob>
    <est-knob param="Resonance"></est-knob>
    <est-knob param="Gain" unit="dB"></est-knob>
    <est-select param="Mode" labels="Low, Band, High, Notch"></est-select>
  </est-row>
</est-window>
<script src="est-ui.js"></script>
<script src="ui.js"></script>
</body>
</html>

=== file: ui/style.css ===
/* The theme gives the colours; override any --est-* variable and add your own touches. */
est-window { --est-accent: #ff8a3d; background: radial-gradient(120% 90% at 50% 0%, #3a2418 0%, var(--est-bg) 70%); }
est-window h1 { letter-spacing: .4em; }
#curve { border: 1px solid var(--est-track); }
est-select { max-width: 150px; }

=== file: ui/ui.js ===
// Only the display is drawn here: every control in the page is wired by Cyber's kit.
var est = EstUI.connect();
var CUTOFF = 1, RESONANCE = 2, MODE = 3; // the same ids as the sound code

// Called after every change (this window, Cyber, automation) and on resize; w and h are CSS pixels.
EstUI.display('#curve', function (g, w, h) {
  if (est.get(CUTOFF) === undefined) return; // before Cyber's first message
  var mode = Math.round(est.get(MODE)), f0 = est.get(CUTOFF), q = 0.6 + est.get(RESONANCE) * 8;
  g.beginPath();
  for (var x = 0; x <= w; x++) {
    var r = 20 * Math.pow(1000, x / w) / f0; // 20 Hz to 20 kHz, as a ratio to the cutoff
    var d = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
    var mag = mode === 0 ? 1 / d : mode === 1 ? (r / q) / d : mode === 2 ? r * r / d : Math.abs(1 - r * r) / d;
    var y = h * 0.45 - Math.max(-36, Math.min(18, 20 * Math.log10(mag + 1e-6))) * (h / 60);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = '#ff8a3d'; g.lineWidth = 2; g.shadowColor = '#ff8a3d'; g.shadowBlur = 12; g.stroke();
});

THE SAME FOR AN INSTRUMENT (eight voices of two saws through a filter). Only its first two files are shown: its window is made the same way as the effect's. For an instrument, change this one into mine:

=== file: est.json ===
{
  "id": "com.example.saw-poly",
  "name": "Saw Poly",
  "version": "1.0.0",
  "kind": "instrument",
  "description": "Eight voices of two detuned saws through a resonant low-pass with its own envelope.",
  "ui": { "path": "ui/index.html", "size": { "w": 520, "h": 300 } }
}

=== file: assembly/index.ts ===
import { Adsr, Descriptor, Filter, Instrument, Osc, Param, Voice, alloc, dbToGain, isReady, param, start } from "sound1";

export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.saw-poly", "Saw Poly", "Me", "1.0.0"), parameters(), new SawPoly());
  return alloc(size);
}

const LEVEL: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const DETUNE: u32 = 7;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-40, 6).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(40, 16000).default(2400).hertz(),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.3),
    new Param(ATTACK, "Attack").range(0.001, 2).default(0.01).unit("s").decimals(3),
    new Param(DECAY, "Decay").range(0.01, 4).default(0.4).unit("s"),
    new Param(SUSTAIN, "Sustain").range(0, 1).default(0.6),
    new Param(RELEASE, "Release").range(0.01, 6).default(0.5).unit("s"),
    new Param(DETUNE, "Detune").range(0, 50).default(12).unit("ct").decimals(0),
  ];
}

// What ONE voice sounds like. The kit plays the notes: it starts, releases, steals and ends voices.
class SawVoice extends Voice {
  a: Osc = new Osc();
  b: Osc = new Osc();
  filter: Filter = new Filter();
  sweep: Adsr = new Adsr();

  // Runs once a sample while the voice sounds: return its sound, about -1 to 1.
  tick(): f64 {
    // this.amp is the voice's loudness envelope; the kit applies it and ends the voice when it has faded.
    this.amp.set(param(ATTACK), param(DECAY), param(SUSTAIN), param(RELEASE));
    this.sweep.set(0.005, param(DECAY), 0.3, param(RELEASE));
    const wide = this.hz * param(DETUNE) * 0.0006;           // cents to Hz, near enough
    const saws = (this.a.saw(this.hz - wide) + this.b.saw(this.hz + wide)) * 0.5;
    const cutoff = param(CUTOFF) * (0.4 + 1.6 * this.sweep.next() * this.velocity);
    return this.filter.lowpass(saws, cutoff, param(RESONANCE)) * dbToGain(param(LEVEL));
  }
}

class SawPoly extends Instrument<SawVoice> {
  constructor() { super(8); }      // eight voices
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }

THE "sound1" KIT (everything the sound code may import; numbers are `f64` unless a type is shown):

- **An effect**: `class X extends Effect { tick(): void { … } }` with `this.l` and `this.r` (in, then out).
- **An instrument**: `class V extends Voice { tick(): f64 { … } }` and `class I extends Instrument<V> { constructor() { super(8); } }` (the number of voices, 1 to 32; 1 is monophonic). In a voice: `this.hz` (the note's frequency), `this.key` (60 is middle C), `this.velocity` (0 to 1: multiply by it for touch), `this.seconds` (since the note began), `this.pan` (set it, -1 to 1), and `this.amp`, the loudness envelope the kit applies: `this.amp.set(attack, decay, sustain, release)`, or `this.amp.perc(attack, decay)` for a hit that fades by itself. Optional: `start(): void` in the voice (a note began); in the instrument, `tick(): void` on the mix of the voices (`this.l`, `this.r`) for an effect on the whole instrument, and `this.glide = 0.1;` in its constructor for a pitch glide between notes.
- **Parameters**: `param(ID)` is the value now, already smoothed. `choice(ID): i32` is a switch's position (0, 1, 2 …). `new Param(ID, "Name").range(min, max).default(v)`, then optionally `.unit("dB")`, `.decimals(n)`, `.hertz()`, or `.labels(["A", "B"])` for a switch.
- **`Osc`**: `sine(hz)`, `saw(hz)`, `square(hz)`, `pulse(hz, width)`, `triangle(hz)`: -1 to 1, free of aliasing. `sine(hz, fm)` adds `fm` (in turns) to the phase, for FM. One wave call per `Osc` per sample.
- **`Noise`**: `white()`, `pink()` (-1 to 1), `random()` (0 to 1). **`Lfo`**: `sine(hz)`, `triangle(hz)`, `saw(hz)`, `square(hz)`, `random(hz)` (-1 to 1).
- **`Wavetable`**: in the voice's constructor `this.wave.harmonic(n, level)` for each harmonic (n 1 to 32), then `this.wave.next(hz)`.
- **`Adsr`**: `set(attack, decay, sustain, release)` or `perc(attack, decay)`, then `next()` (0 to 1). In a voice it starts and releases with the note by itself; elsewhere call `start()` and `release()`.
- **`Filter`**: `lowpass(x, hz, resonance)`, `highpass(…)`, `bandpass(…)`, `notch(…)`; resonance 0 to 1. Always stable. **`OnePole`**: `lowpass(x, hz)`, `highpass(x, hz)` (gentle).
- **`Echo`**: `new Echo(maxSeconds)`; `process(x, seconds, feedback, tone)` returns the repeats alone (feedback 0 to 0.95; tone 0 dark to 1 bright). **`PingPong`**: `process(l, r, seconds, feedback)`, then its `.l` and `.r`. **`Delay`**: `new Delay(maxSeconds)`; `read(seconds)`, then `write(x)`.
- **`Reverb`**: `process(l, r, seconds, damping)`, then its `.l` and `.r` (the reverb alone; damping 0 to 1). **`Chorus`**: `process(l, r, rateHz, depth)`, then `.l` and `.r`. **`Flanger`**: `process(l, r, rateHz, depth, feedback)`, then `.l` and `.r`.
- **`Compressor`**: `gain(l, r, thresholdDb, ratio, attack, release)` returns the gain to multiply both sides by. **`Limiter`**: `gain(l, r, ceilingDb)`, the same way. **`Crusher`**: `process(x, bits, rateHz)`.
- **`Smooth`**: `next(target, seconds)` glides a value of your own. **`Steps`**: `next(stepsPerBeat)` is -1, except on the sample a step starts while the song plays, when it is the step's number in its bar; an instrument's optional `pattern(): void` runs every sample and may call `this.play(key, velocity, seconds)` to play a note of its own.
- **Functions**: `drive(x, amount)` (saturation, amount 0 to 1), `softClip(x)`, `mix(dry, wet, amount)`, `panLeft(pan)`, `panRight(pan)`, `dbToGain(db)`, `gainToDb(gain)`, `keyToHz(key)`, `clamp(x, lo, hi)`, `beats(n)` (n beats in seconds at the song's tempo), `tempo()`, `playing()`, `sampleRate()`.
- The language's `Math.sqrt`, `Math.abs`, `Math.pow`, `Math.sin`, `Math.exp`, `Math.floor`, `Math.min`, `Math.max` and `Math.PI` work. Never `Math.random` (use `Noise`).
````
