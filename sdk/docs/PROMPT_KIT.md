# The prompt kit

Prompts to paste into an AI coding assistant (one that can run commands in a folder on your computer) to make an EST plugin for Cyber. Each starts from a template or a cookbook recipe, states the rules the sandbox holds every plugin to, asks for a golden test and a clean `est validate` and `est test`, and ends with the packed `.est`. Then [SHARING.md](SHARING.md) says what to do with it.

New to all this? Read [Build an EST plugin](BUILD_AN_EST_PLUGIN.md) first: it is the same path by hand, with the code inline.

## How to use it

Every prompt starts with `npx @cyber-est/cli`, Cyber's plugin kit on npm.

1. You need Node 20 or newer. Make an empty folder for your plugins and open your assistant there.
2. Pick the prompt below closest to what you want, replace the `<…>` parts, and paste it.
3. When it says it is done, run `npx est dev` in the plugin's folder yourself and listen.
4. Then the follow-ups at the end: presets, a look, a click, a refusal.

Every prompt names the id `com.example.<name>`. That is fine while you try things out; before you share a plugin, give it an id that is yours (a reversed domain you own, or, as a developer on Cyber, the `dev.<10 hex>` namespace Cyber assigns you) and never change it afterwards.

The rules paragraph in each prompt is the same on purpose: an assistant that skips one gets a refusal from `est validate` naming a rule id (`EST-…`) and its fix. Every rule is in [validator-rules.md](validator-rules.md).

## Templates

There are five template families in AssemblyScript (`-as`, nothing else to install) and Rust (`-rust`, needs rustup and the wasm32 target), plus `cpp-clap`. The prompts use `-as`; for Rust, change the template name and the word "AssemblyScript" (and `npx est doctor` says what Rust needs). [templates.md](templates.md) compares them.

### Effect (`effect-as`, `effect-rust`)

```
Make an EST audio effect for Cyber in AssemblyScript.
Start with: npx @cyber-est/cli new effect-as my-effect --id com.example.my-effect --name "My Effect"
then, in my-effect: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-effect/AGENTS.md before changing anything. From then on use `npx est <command>` in that folder.

What it should do: <describe the sound, and the 2 to 8 knobs you want>

Rules (the validator enforces them):
- No allocation in render() or paramChanged(): `new`, arrays and strings only in field initialisers,
  the constructor or activate().
- No randomness or clock from the host: no Math.random, no Date. For noise, a seeded xorshift of your own.
- Size every buffer and time in seconds from the sample rate activate() receives; never assume 44.1 or 48 kHz.
- Every parameter has a range, a default inside it and a unit; keep est.json's parameters (ids, names,
  units) the same as parameters() in the code, and never renumber an id. Smooth every gain or cutoff
  change with the kit's Smoother so a moving knob does not click.
- No imports and no top-level code but constants; keep the export block and the abort function.
- Presets come later; leave est.json's "presets" as it is.

Tests: set test/golden.json's events to move every parameter at least once. Render it with
`npx est test --update` once the sound is right, then `npx est validate` and `npx est test` must both pass
with no failure (read dist/validation.json: each failed check has rule, message and fix).
Finally `npx est pack` and tell me the path of the .est in dist/.
```

### Instrument (`instrument-as`, `instrument-rust`)

```
Make an EST instrument (a synthesizer) for Cyber in AssemblyScript.
Start with: npx @cyber-est/cli new instrument-as my-synth --id com.example.my-synth --name "My Synth"
then, in my-synth: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-synth/AGENTS.md before changing anything. From then on use `npx est <command>` in that folder.

What it should sound like: <describe the voice, the number of voices, the knobs>

Rules (the validator enforces them):
- No allocation in render(), noteOn() or paramChanged(): the voices are made once, in the constructor
  or activate(); a new note steals a voice, it never makes one.
- No randomness or clock from the host: no Math.random, no Date. For noise or drift, a seeded xorshift of your own.
- Size every buffer and time in seconds from the sample rate activate() receives; never assume 44.1 or 48 kHz.
- Every parameter has a range, a default inside it and a unit; keep est.json's parameters the same as
  parameters() in the code, and never renumber an id. Smooth level and cutoff changes so nothing clicks.
- Every note sounds while held and ends within the reported tail after its release.
- No imports and no top-level code but constants; keep the export block and the abort function.
- Presets come later; leave est.json's "presets" as it is.

Tests: set test/golden.json's notes and events to play a chord, move every parameter and release.
Render it with `npx est test --update` once the sound is right, then `npx est validate` and
`npx est test` must both pass (read dist/validation.json for each failure's rule and fix).
Finally `npx est pack` and tell me the path of the .est in dist/.
```

### Sampler (`sampler-as`, `sampler-rust`)

```
Make an EST sampler for Cyber in AssemblyScript from my own sounds.
Start with: npx @cyber-est/cli new sampler-as my-sampler --id com.example.my-sampler --name "My Sampler"
then, in my-sampler: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-sampler/AGENTS.md before changing anything. From then on use `npx est <command>` in that folder.

My samples are in <folder>: <say which key and velocity each should play, and which loop>.
Convert them to 16-bit PCM mono WAVs in assets/, map them in samples.json, then run
`node tools/embed-samples.mjs` (the module reads no file: the samples are compiled in).
Raise limits.memoryPagesMax in est.json and maximumMemory in asconfig.json only as far as they need.

Rules (the validator enforces them):
- No allocation in render(), noteOn() or paramChanged(): voices and buffers are made once.
- No randomness or clock from the host: no Math.random, no Date. Round robins from a seeded xorshift of your own.
- Every time (attack, release, a glide) in seconds from the sample rate activate() receives; play a
  sample recorded at another rate at the right pitch.
- Every parameter has a range, a default inside it and a unit; keep est.json's parameters the same as
  the code's, and never renumber an id.
- No imports and no top-level code but constants; keep the export block and the abort function.

Tests: set test/golden.json's notes to play every sample at least once. Render it with
`npx est test --update` once it sounds right; then `npx est validate` and `npx est test` must pass.
Finally `npx est pack` and tell me the path of the .est in dist/ and how large it is.
```

### Note effect (`midi-effect-as`, `midi-effect-rust`)

```
Make an EST note effect (notes in, notes out) for Cyber in AssemblyScript.
Start with: npx @cyber-est/cli new midi-effect-as my-notes --id com.example.my-notes --name "My Notes"
then, in my-notes: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-notes/AGENTS.md before changing anything. From then on use `npx est <command>` in that folder.

What it should do with the notes I play: <describe it: an arpeggio, a chord, a harmony, a repeat>

Rules (the validator enforces them):
- Every note it starts it ends: on the key's release, on a mode change, on a choke.
- No allocation while processing: held keys and chords live in fixed arrays made in the constructor.
- No randomness or clock from the host: no Math.random, no Date. Any random choice from a seeded xorshift.
- The tempo and position come from io.transport only; times in seconds or beats, turned into samples
  with the sample rate activate() receives, never a fixed number of samples.
- Every parameter has a range, a default inside it and a unit; keep est.json's "notes" ports,
  "note-effect" feature and parameters the same as the code's, and never renumber an id.
- No imports and no top-level code but constants; keep the export block and the abort function.

Tests: set test/golden.json to play a few keys with releases and move every parameter; render with
`npx est test --update` (it writes the notes too, test/golden-notes.json), check the notes make sense,
then `npx est validate` and `npx est test` must pass. Finally `npx est pack` and tell me the .est's path.
```

### Visualiser (`visualiser-as`, `visualiser-rust`)

```
Make an EST plugin whose point is its window, for Cyber, in AssemblyScript.
Start with: npx @cyber-est/cli new visualiser-as my-scope --id com.example.my-scope --name "My Scope"
then, in my-scope: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-scope/AGENTS.md and the kit's ui.md before changing anything. Use `npx est <command>` in that folder.

What the window should draw: <describe it, from the host's levels>

Rules (the validator enforces them):
- The page never receives samples: it draws from the host's meters (est:meter), and with EST 1.1 and
  "ui": { "audio": true } from est.audio()'s spectrum. Draw in one requestAnimationFrame loop.
- The page loads only files of the bundle: no other host, no fetch, no inline script, no module
  script, no crossorigin attribute.
- No allocation in render(); the DSP passes the audio through: no Math.random or Date (a seeded
  xorshift if it needs noise), sizes in seconds from the sample rate activate() receives, every
  parameter with a range, a default and a unit, and est.json's parameters the same as the code's.
- No imports and no top-level code but constants; keep the export block and the abort function.

Tests: keep test/golden.json passing (`npx est test --update` only after a deliberate DSP change);
`npx est validate` and `npx est test` must pass, then `npx est dev` shows the page beside the knobs.
Finally `npx est pack` and tell me the .est's path.
```

### A C++ CLAP plugin (`cpp-clap`)

```
Port my C++ audio code to an EST plugin for Cyber.
Start with: npx @cyber-est/cli new cpp-clap my-port --id com.example.my-port --name "My Port"
then, in my-port: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Read my-port/AGENTS.md and the kit's porting-cpp.md first. Run `npx est doctor`: it needs clang with
the wasm32 target and wasm-ld.

The code to port: <path>. Keep its sound; take only the DSP, not its UI or file handling.

Rules (the validator enforces them):
- No allocation in process(): no new, malloc, std::vector growth or std::string there; size everything in activate().
- No randomness or clock from the host: no rand(), random_device, time() or chrono. A seeded xorshift.
- Sizes in seconds from the sample rate activate() receives; never assume 44.1 or 48 kHz.
- No exceptions, threads, files or console; the runtime is freestanding (<est/runtime.hpp>).
- Every parameter has a range, a default and a unit; est.json's parameters match the plugin's, ids never renumbered.

Tests: set test/golden.json's events to move every parameter; render with `npx est test --update`
once it matches the original (`npx est compare` measures two renders), then `npx est validate` and
`npx est test` must pass. Finally `npx est pack` and tell me the .est's path.
```

## Cookbook recipes

Each recipe is a small, tested plugin to start from ([cookbook.md](cookbook.md) says what each does). The same rules hold; these prompts are shorter because the recipe already follows them. Each one makes the folder, changes one thing, and packs.

The common part, pasted after each recipe's first lines:

```
Read the folder's README.md and assembly/index.ts first; use `npx est <command>` in the folder.
Rules: no allocation in render(); no Math.random or Date (a seeded xorshift); sizes in seconds from
activate()'s sample rate; every parameter with a range, a default and a unit, est.json the same as
parameters(), ids never renumbered; smooth every knob; no imports or top-level code.
Add events to test/golden.json for anything new, render with `npx est test --update` once it sounds
right, then `npx est validate` and `npx est test` must pass. Finally `npx est pack`; tell me the .est's path.
```

### compressor

```
Start with: npx @cyber-est/cli new compressor my-comp --id com.example.my-comp --name "My Comp"
then, in my-comp: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a soft Knee knob (0 to 12 dB) and a Mix knob (0 to 100 %) for parallel compression.
```

### chorus

```
Start with: npx @cyber-est/cli new chorus my-chorus --id com.example.my-chorus --name "My Chorus"
then, in my-chorus: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Feedback knob (0 to 70 %) and a third voice, its LFO a third of a turn from the others.
```

### bitcrusher

```
Start with: npx @cyber-est/cli new bitcrusher my-crush --id com.example.my-crush --name "My Crush"
then, in my-crush: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Drive knob before the crush and a one-pole low-pass Tone after it.
```

### wavetable

```
Start with: npx @cyber-est/cli new wavetable my-wavetable --id com.example.my-wavetable --name "My Wavetable"
then, in my-wavetable: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add an LFO on Position (Rate in Hz, Depth in %) and a resonant low-pass with its own envelope.
```

### drum-synth

```
Start with: npx @cyber-est/cli new drum-synth my-drums --id com.example.my-drums --name "My Drums"
then, in my-drums: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a clap on key 39 (three short noise bursts, then a tail) using the recipe's own xorshift.
```

### ring-mod

```
Start with: npx @cyber-est/cli new ring-mod my-ring --id com.example.my-ring --name "My Ring"
then, in my-ring: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add an LFO on the carrier's frequency (Rate, Depth in semitones) and a carrier Shape (sine to square).
```

### widener

```
Start with: npx @cyber-est/cli new widener my-width --id com.example.my-width --name "My Width"
then, in my-width: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Bass Mono knob (a crossover from 20 to 500 Hz below which the side is removed).
```

### auto-wah

```
Start with: npx @cyber-est/cli new auto-wah my-wah --id com.example.my-wah --name "My Wah"
then, in my-wah: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Mode switch (band-pass, low-pass) and a Sensitivity knob in dB before the follower.
```

### schroeder-reverb

```
Start with: npx @cyber-est/cli new schroeder-reverb my-verb --id com.example.my-verb --name "My Verb"
then, in my-verb: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Pre-delay knob (0 to 200 ms, its buffer sized in activate() from the sample rate).
```

### step-sequencer

```
Start with: npx @cyber-est/cli new step-sequencer my-steps --id com.example.my-steps --name "My Steps"
then, in my-steps: npm install --save-dev --save-exact @cyber-est/cli@0.1.0
Change: add a Gate knob (10 to 100 % of a step) and a per-step on/off; every note it starts it ends.
```

## Follow-ups

Paste these into the same conversation, in the plugin's folder.

### Add 8 presets

```
Add 8 factory presets to this plugin, each a useful starting sound with a short name and one or two tags.
A preset is a state file: write a small Node script, tools/make-presets.mjs, that writes presets/<n>.state
in exactly the bytes the plugin's own state save writes (for AssemblyScript, est/glue.ts' state_save:
little-endian u32 state magic, u32 stateVersion, u32 parameter count, then u32 id and f64 value for every
parameter in parameters() order, then the plugin's own saveState bytes), every value inside its range.
Write presets/index.json as { "presets": [{ "name", "path", "tags", "stateVersion" }] } and set
est.json's "presets" to "presets/index.json". Then `npx est validate` must pass: each preset must load
and save back its own bytes (EST-C012, EST-C019; EST-B014 if the index is wrong). Then `npx est pack`.
```

(Presets you save in Cyber's own plugin window are yours alone and need none of this.)

### Make the UI look like X

```
Give this plugin its own window that looks like <X: describe colours, layout, the controls>.
Read the kit's ui.md. If the folder has no ui/ yet, make one the way `est new … --ui` does (or, for an
app with a build step, `--app`), and add est.json's "ui" entry. Use @cyber-est/ui's bind() and its
<est-knob> and <est-slider> for every parameter, so the host's automation and undo work.
The page may load only files of the bundle: no web fonts or images from another host, no fetch,
no inline script, no module script (EST-U002, EST-U003, EST-U005). Then `npx est validate` must pass
and `npx est dev` shows it beside the generated knobs. Then `npx est pack`.
```

### It clicks when I move the knob

```
The plugin clicks or zips when I move <knob>. Smooth that parameter: in paramChanged() set a Smoother's
target (about 10 to 30 ms, its sample rate set in activate()) and read smoother.next() once per sample in
render(), for gains in linear gain, for cutoffs per sample or every few samples. For a switch, crossfade
over a few milliseconds instead of jumping. Add a fast change of that parameter to test/golden.json,
listen in `npx est dev`, then `npx est test --update`, `npx est validate` and `npx est test`.
```

### est validate says EST-W004

```
`npx est validate` fails with EST-W004 (the module imports something EST does not allow); the message
names the import. Remove it, never stub it: env.seed is AssemblyScript's Math.random (replace it with an
xorshift seeded from a constant), env.abort means the abort function at the bottom or asconfig.json's
"use" line was removed (put them back), env.console.* or env.trace is logging (remove it), env.Date.now
is the clock (count samples instead). Then `npx est validate` again until it passes.
```

### Other refusals

- **EST-C013** (the plugin stopped while processing): `Probably allocating in render() …` Ask: "Move every allocation out of render() into the constructor or activate(), and make every loop end within the block."
- **EST-C015** (the output is too loud) or **EST-C014** (not finite): "Keep the output finite and under +18 dBFS at every parameter's extreme: guard divisions, clamp feedback below 1, and soft-clip the output."
- **EST-C008** (the parameters differ from est.json): "Make est.json's parameters list exactly the ids, names and units of parameters()."
- **EST-C018** (two renders differ): "Something depends on more than the input: find the uninitialised buffer or the random number and make it seeded."
- **EST-P001** (a block costs more than the budget, a warning): run `npx est profile --debug` and paste its table with "make the top functions cheaper without changing the sound".
