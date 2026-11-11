# Vibe coding an EST plugin for Cyber

A guide for anyone who wants to make an effect or an instrument that runs inside [Cyber](https://cyber-audio.fly.dev), whether this is your first plugin and you'll build it by talking to a coding agent, or you've shipped VSTs for years and want to port one. You don't need to know Cyber's internals, and you don't need to have written WebAssembly before.

If you only read one paragraph: an EST plugin is a folder with a manifest (`est.json`), some audio code (Rust or AssemblyScript, compiled to WebAssembly) and, if you want one, a web page as its interface. The `est` command makes the folder, plays it while you edit, checks it the way Cyber will, and packs it into one `.est` file. Cyber loads that file. Everything in the folder is readable by a coding agent, and every folder ships with instructions for one.

---

## 1. What you're making

| Term | What it means |
|---|---|
| **EST** | Cyber's plugin format: CLAP's plugin model, compiled to WebAssembly, run in a sandbox in the browser. "Effect, Synth, Tool." |
| **Effect** | Audio in, audio out: an EQ, a delay, a distortion. |
| **Instrument** | Notes in, audio out: a synth, a sampler, a drum machine. |
| **Bundle** | One `.est` file: your compiled code, your manifest, your UI files and any sounds you ship. Content-addressed, so a shipped bundle never changes. |
| **Manifest** | `est.json`: who the plugin is, what ports it has, its parameters, its limits. |
| **The dev host** | `est dev`: a local page that runs your plugin in Cyber's own audio runtime while you edit. |
| **The validator** | `est validate`: every check Cyber's install runs, with a stable rule id and a fix for each failure. |

Two things make EST different from a desktop plugin, and both work in your favour:

- **It runs in a sandbox.** Your audio code can only touch its own memory. Your UI is a web page that can't reach the network or the user's files. So a teacher can put your plugin in a shared project and every student's browser runs it safely. The cost is a few rules (no allocation in the audio loop, no clock, no randomness in `process`), and the validator tells you exactly when you break one.
- **The checks are the same everywhere.** `est validate` on your machine runs the same code as Cyber's install. If it passes locally, it installs.

---

## 2. Set up once (five minutes)

You need Node 20 or newer. From npm (Node 20 or newer; the kit's first release, 0.1.0, is built and checked but not yet published):

```bash
npx @cyber-est/cli new effect-as my-plugin --id com.example.my-plugin --name "My Plugin"
cd my-plugin
npm install --save-dev --save-exact @cyber-est/cli@0.1.0
npx est doctor
```

In that folder `npx est …` is the kit. Anywhere else write `npx @cyber-est/cli …`: a bare `npx est` where the kit isn't installed fetches an unrelated npm package of that name.

Until the first release, or to work on the kit itself, run it from a clone of the kit's public repository (Cyber's own clone works the same):

```bash
git clone https://github.com/NickKHarrison/cyber-est-sdk
cd cyber-est-sdk
npm ci
alias est="node $PWD/sdk/packages/cli/bin/est.mjs"
```

Put the alias in your shell profile to keep it. On Windows, `node <clone>\sdk\packages\cli\bin\est.mjs` is the same command.

Then pick a language:

- **AssemblyScript** (recommended for a first plugin): TypeScript syntax, compiles in about a second, nothing else to install. If you can read JavaScript, you can read it.
- **Rust**: faster DSP and the richer toolchain. Needs `rustup` and `rustup target add wasm32-unknown-unknown`.

Check your tools:

```bash
est doctor
```

It prints the exact command for anything missing. It never installs anything itself.

---

## 3. The loop

This is the whole workflow. Everything else in this guide is detail.

```bash
est new effect-as ~/plugins/my-delay --id com.yourname.my-delay --name "My Delay"
cd ~/plugins/my-delay
est dev          # http://localhost:4430: plays your plugin, rebuilds on save
est validate     # every check Cyber's install runs; read dist/validation.json
est test         # the golden render in test/ plus the conformance run
est pack         # dist/com.yourname.my-delay-1.0.0.est
```

Templates: `effect-as`, `instrument-as`, `effect-rust`, `instrument-rust`. Add `--ui` to start with a custom interface.

The folder you get is already a working plugin (a smoothed gain into a filter, or a polyphonic synth). You change it rather than start from nothing.

**Loading it into Cyber.** While adding your own plugins is open on Cyber: on Home, **EST PLUGINS → Add a plugin** and drop the `.est` on it (no key needed); a developer with a registered signing key can also use **Settings → Plugins → Developer tools → Load a bundle file…**. Cyber runs the same checks and tells you the same rule id if something fails. What you load is yours alone, on your own account. Cyber's own catalogue is open to every signed-in account; publishing to its Community tier comes later (see §9).

---

## 4. Vibe coding it: working with an agent

Every folder `est new` makes contains `AGENTS.md`, `CLAUDE.md` and `llms.txt`, which say the same thing in the forms different agents read. Point your agent (Claude Code, Cursor, Codex, whatever you use) at the folder and it has what it needs: the layout, the commands, the rules and where to look things up.

A session that works well looks like this:

**1. Say what you want in sound terms, not code terms.**

> Make this a tape-style delay. One delay time in ms (10 to 2000, default 350), feedback 0 to 95 %, a low-pass in the feedback path (500 Hz to 12 kHz), and a mix knob. The repeats should get darker each time round.

**2. Tell the agent to validate after every change and read the report.**

> After each change run `est validate --json` and read `dist/validation.json`. Fix every failed rule before moving on; the report names the rule, the reason and the fix.

The validator is your reviewer. Its output is JSON designed for agents: every failure has `rule`, `message`, `fix` and `where`. An agent that reads it fixes its own mistakes.

**3. Let the agent listen.**

```bash
est dev --json --seconds 3 < /dev/null                 # an effect: a sine goes through it, meters print
est dev --json --play 48,55,60                          # an instrument: plays three notes
printf '{"cmd":"param","id":0,"value":-6}\n' | est dev --json   # change a parameter, print what happened
```

`est dev --json` runs the plugin in headless Chromium and prints one JSON line per event: meters, parameter changes, the UI's messages, console errors. An agent with no screen can still hear whether the sound is there, peaks, or is silent.

**4. When the sound is right, freeze it.**

```bash
est test --update     # re-records the golden render
```

From then on `est test` fails if the sound changes by accident.

**5. Ask for a UI last.**

> Give it a custom UI: four knobs in a row, dark, the delay time knob larger. Use `@cyber-est/ui`'s `<est-knob>` elements.

The agent reads `est-ui.d.ts` and `docs/ui.md` in the folder. A plugin with no custom UI gets a generated one (knobs for every parameter, grouped), so a UI is optional.

### Prompts that work

- "Build an EST **effect** in AssemblyScript that does X. Keep to the rules in AGENTS.md. Validate after every change."
- "Port this DSP (paste a `process` function from anywhere) into `render` in `assembly/index.ts`. Declare its parameters in `parameters()` and in `est.json`. Don't allocate in `render`."
- "The validator failed `EST-C018` (not deterministic). Find what reads a clock or random numbers in `process` and remove it."
- "Add a `Smoother` to the cutoff so it doesn't click."
- "The block cost is 180 µs, over the 100 µs budget. Find the hot loop and reduce its work without changing the sound; `est test` must still pass."

### The rules the agent must keep (and the validator enforces)

- **No allocation in the audio loop.** Buffers are sized in `activate`; nothing calls `new` in `render`, `process`, the parameter hook or the note handlers.
- **Deterministic.** The same input and events give the same samples. No clock, no `Math.random()` in `process`. (The validator renders twice and compares.)
- **Parameter ids match everywhere:** the DSP, `est.json`, `test/golden.json` and the UI use the same numbers.
- **The descriptor's `id` equals `est.json`'s `id`.**
- **Every shipped change is a new version.** Projects pin a plugin by its content hash. Bump `version` in `est.json` before handing a bundle to anyone.
- **The state magic never changes** once a version has shipped.

---

## 5. The manifest, briefly

`est.json` is short. The template's, with the parts you'll touch:

```json
{
  "est": 1,
  "id": "com.yourname.my-delay",
  "version": "1.0.0",
  "name": "My Delay",
  "vendor": "Your Name",
  "description": "A tape-style delay with darkening repeats.",
  "license": "MIT",
  "kind": "effect",
  "features": ["audio-effect", "delay", "stereo"],
  "module": { "path": "module.wasm" },
  "audio": { "inputs": [{ "channels": 2 }], "outputs": [{ "channels": 2 }], "sampleRates": "any" },
  "notes": { "inputs": 0, "outputs": 0 },
  "limits": { "maxLatencyFrames": 0, "memoryPagesMax": 16, "tailSeconds": 2 },
  "parameters": [
    { "id": 0, "name": "Time", "unit": "ms" },
    { "id": 1, "name": "Feedback", "unit": "%" },
    { "id": 2, "name": "Tone", "unit": "Hz" },
    { "id": 3, "name": "Mix", "unit": "%" }
  ],
  "stateVersion": 1
}
```

- An instrument has `"kind": "instrument"`, `"features": ["instrument", …]` and `"notes": { "inputs": 1 }`.
- `tailSeconds` is how long the plugin rings after input stops (a delay's feedback, a reverb's decay), so Cyber knows when it can sleep the node.
- `memoryPagesMax` caps memory in 64 KiB pages (a delay line of 2 s at 48 kHz stereo is about 12 pages).
- `"ui": { "path": "ui/index.html", "size": { "w": 440, "h": 180 } }` adds a custom interface.

The full reference is `docs/manifest.md`, and the schema is in your folder, so an editor or agent can check it as you type.

---

## 6. The audio code, briefly

AssemblyScript's shape (Rust's is the same with Rust's words):

```ts
function parameters(): Param[] {
  return [
    new Param(TIME, "Time").range(10, 2000).default(350).unit("ms"),
    new Param(FEEDBACK, "Feedback").range(0, 95).default(40).unit("%"),
    new Param(TONE, "Tone").range(500, 12000).default(4000).hertz(),
    new Param(MIX, "Mix").range(0, 100).default(35).unit("%"),
  ];
}

class MyDelay extends Effect {
  line: DelayLine = new DelayLine(96000 * 2);   // sized once, at the maximum
  filter: Filter = new Filter();
  mix: Smoother = new Smoother(0.01);

  activate(sampleRate: f64, maxFrames: u32): bool { /* set rates, reset */ return true; }
  paramChanged(id: u32, value: f64): void { /* store, smooth, convert units */ }
  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) { /* read, filter, write back, mix */ }
  }
}
```

The SDK library (`est/` in your folder) has what most plugins need: smoothers, oscillators, state-variable and biquad filters, envelopes, LFOs, delay lines, a polyphonic `Voices` helper for instruments. `docs/dsp-library.md` lists them.

Events (parameter changes, notes, MIDI, the transport) arrive per block with sample offsets. The SDK splits the block at each event for you: `render(io, from, to)` is called for each stretch between events, so a change lands on its sample.

---

## 7. A custom UI, briefly

A UI is a web page in `ui/`, shown in a sandboxed frame. It talks to the plugin through `@cyber-est/ui`:

```html
<est-knob param="0" label="Time" unit="ms" scale="log"></est-knob>
<est-knob param="1" label="Feedback" unit="%"></est-knob>
<script src="est-ui.js"></script>
<script src="ui.js"></script>
```

```js
const est = EstUI.connect();
est.ready.then(() => { /* every parameter and its value is known */ });
est.subscribe((id, source) => { /* redraw when one changes */ });
```

What the page may do: load scripts, styles, images (`.png`, `.webp`, `.svg`) and fonts (`.woff2`) from the bundle; draw on a canvas; use `data:` and `blob:` URLs. What it may not do: fetch anything, use storage, run inline scripts, embed another page. The validator's `EST-U` rules check all of this, and `est dev` shows the page exactly as Cyber will. `docs/ui.md` has the full policy and the library.

---

## 8. Porting an existing plugin

If you have a VST, AU or CLAP plugin, the DSP is what you keep. The rest is replaced by EST's shape.

**From CLAP** (the easiest): EST is CLAP 1.2 compiled for `wasm32-unknown-unknown`. The factory, descriptor, `activate`, `process`, events and the parameter and state extensions carry over. What changes: the GUI becomes a web page, there is one thread (no `thread-pool`), no file or network access, memory has a declared maximum, and `process` must be deterministic. `docs/porting-clap.md` has the list.

**From C++ (CLAP, or the DSP of a VST3 or AU)**: `est new cpp-clap …` is a CLAP plugin in C++ built with clang to wasm32, shaped like the CLAP SDK's own plugin template; put your DSP class where its `gain.hpp` is. The toolchain, the flags and what breaks (libc, exceptions, threads, files) are in `docs/porting-cpp.md`. Or, for a small plugin, move your `process` body into the Rust template's `render`. Your SIMD code is fine (fixed-width SIMD is supported). Your lookup tables are fine (build them in `activate`). Your sample libraries ship inside the bundle (`assets` in the manifest), not fetched at run time.

**From JUCE**: keep JUCE for your desktop build and share the DSP source between the two: `docs/porting-juce.md`, and the example in `sdk/kits/juce-shared-dsp/` (one header both builds compile, a CMake file for both, a native renderer to compare them). JUCE's `prepareToPlay` maps to `activate`, `processBlock` to `process` between events, `AudioProcessorValueTreeState` to the parameter list plus the state.

**Check the port with `est compare`**: it renders the same input and events through two bundles, or a bundle and a WAV your desktop build rendered from the same input (`--write-input` writes one), and reports the level and band differences and the first sample where they part; exit 1 past `--tolerance`. A port of the same DSP should match to the last bit, or nearly.

### The "from VST" checklist

Go through it once, in this order:

- [ ] **Parameters, normalised to plain.** VST3 and AU hosts hand you 0–1; EST hands your plugin plain values in the range you declare (dB, Hz, ms). Declare each parameter's real range and default, drop the normalise and denormalise calls, and put a frequency or time control on `"scale": "log"` in est.json rather than a skew in code. Ids are numbers, stable for the plugin's life: write down the mapping from your old string or tag ids once.
- [ ] **Stepped and enumerated parameters.** A switch is a stepped parameter with labels (`.labels(…)` in Rust, `CLAP_PARAM_IS_STEPPED` and `value_to_text` in C++), never a float you round.
- [ ] **Sample rate changes.** Anything computed from the rate (coefficients, delay lengths, smoothing times) is set in `activate`, which runs again at a new rate: never cache the rate in a constructor. Test at 44100 and 96000 (`est compare --sample-rate 96000`).
- [ ] **Block size.** EST calls `process` with any number of frames up to the maximum in `activate` and splits blocks at every event. Code that assumes a fixed block (an FFT hop, a lookahead) buffers internally.
- [ ] **Latency.** Report it with `clap.latency` (C++) or `latency()` (Rust), and declare at most that in est.json's `limits.maxLatencyFrames`. A lookahead limiter that reports 0 is a bug `est compare` shows as a first divergence at the latency.
- [ ] **Tail.** A reverb or delay reports how long it rings (`tail`, `limits.tailSeconds`), or its end is cut.
- [ ] **Bypass.** Cyber bypasses an insert itself, with a crossfade. Drop your own bypass parameter unless it does something the host cannot (a "soft" bypass that keeps a delay's tail).
- [ ] **State and its migration.** Your old preset and session format is not EST's. Write the EST state as a magic, a version and your fields; raise the version when the bytes change and keep loading the old versions. If users have desktop presets, convert them once into the bundle's `presets/` (each a state blob).
- [ ] **Presets.** Factory presets ship in the bundle (`presets/index.json` and a state file each); a preset folder on disk does not exist in the browser.
- [ ] **Determinism.** No `rand()`, no clock, no uninitialised memory in `process`: the validator renders twice and compares (`EST-C018`).
- [ ] **Denormals.** WebAssembly has no flush-to-zero: add a tiny offset or flush feedback paths that decay forever.

Things that don't port and need a rethink: anything that reads files at run time, anything with a background thread, anything that opens a native window, any `rand()` in the audio loop (seed a PRNG from state instead, so it's deterministic).

---

## 9. Shipping it

**Today:** Cyber's catalogue is live on the plugin origin, signed, and every signed-in account installs from it; what is in it is Cyber's. Your own `.est` loads on your own account through **Add a plugin** while adding your own plugins is open (above), and nobody else is offered it. [SHARING.md](SHARING.md) says how to put it in a song and share a listen link.

**Then:** Community publishing. You sign your bundle with your own key (`est sign`), publish it (`est publish`), and it appears in the catalogue's Community tier after automated validation, with an "early" flag until reviewed. Updates are validated and staged the same way. `docs/est/EST_REGISTRY_ARCHITECTURE.md` in Cyber's repository describes the protocol, the tiers and what gets blocked.

Until then, the best thing you can do is build and validate. A bundle that passes `est validate` today will publish unchanged when Community publishing opens.

---

## 10. Where to look things up

All in `sdk/docs/` of the Cyber clone, and most copied into your plugin's folder by `est new`:

| Question | Read |
|---|---|
| Ten minutes to a running plugin | `getting-started.md` |
| Blocks, events, parameters, state, the sandbox | `concepts.md` |
| Every `est.json` field | `manifest.md` |
| What a rule id means and how to fix it | `validator-rules.md`, or `dist/validation.json` after a run |
| The DSP helpers | `dsp-library.md` |
| The UI library and the frame's policy | `ui.md` |
| `est dev` and its JSON mode | `dev-host.md` |
| Porting from CLAP | `porting-clap.md` |
| What to tell an agent | `for-agents.md`, and the `AGENTS.md` in your folder |

If something in the docs disagrees with what the validator says, the validator is right. Tell us and we'll fix the docs.
