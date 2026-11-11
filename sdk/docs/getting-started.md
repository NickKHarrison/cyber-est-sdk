# Getting started: a running gain in ten minutes

You will make an effect with one parameter, a gain in dB, play it in the dev host, validate it, pack it and install it in Cyber. Pick a language:

- **Rust** (the default): the richest toolchain and the fastest DSP. Needs `rustup`.
- **AssemblyScript**: TypeScript syntax, compiled in a second, nothing native to install.

Both make the same kind of bundle, and the plugin interface has the same names in both ([the DSP library](dsp-library.md) lists the few differences).

## 0. Check your tools

The kit is the npm package `@cyber-est/cli` (decision D-50). From npm (Node 20 or newer; the kit's first release, 0.1.0, is built and checked but not yet published):

```
npx @cyber-est/cli new effect-as my-gain --id com.example.my-gain --name "My Gain"
cd my-gain
npm install --save-dev --save-exact @cyber-est/cli@0.1.0   # est and asc in this folder
```

From then on `npx est <command>` works in that folder. **Only there:** in a folder without `@cyber-est/cli` installed, write `npx @cyber-est/cli <command>`, because a bare `npx est` would fetch npm's unrelated package called `est`. Nothing else is fetched at run time; the package brings AssemblyScript's `asc` and Binaryen (the meter) with it.

From a clone instead (until the first release, and for work on the kit itself), once, in the clone of the kit's public repository or of Cyber's:

```
git clone https://github.com/NickKHarrison/cyber-est-sdk && cd cyber-est-sdk
npm ci
alias est="node $PWD/sdk/packages/cli/bin/est.mjs"
```

Then `est` works in any folder, your plugin's included (put the alias in your shell's profile to keep it; on Windows, `node <clone>\sdk\packages\cli\bin\est.mjs` is the same command). At the clone's root, `npm run est -- <command>` is the same again.

```
est doctor
```

It checks Node, and for Rust `rustup`, `cargo` and the `wasm32-unknown-unknown` target, and for AssemblyScript `asc` (it comes with `@cyber-est/cli`, or the clone's `npm ci`); it also reports Playwright's Chromium, which only `est dev --json` needs. For anything missing it prints the exact command to run; it never installs anything itself. For Rust the usual one is:

```
rustup target add wasm32-unknown-unknown
```

## 1. Make the plugin

```
est new effect-rust ~/plugins/my-gain --id org.example.my-gain --name "My Gain"
# or
est new effect-as ~/plugins/my-gain --id org.example.my-gain --name "My Gain"
```

The folder holds:

| File | What it is |
|---|---|
| `est.json` | the manifest: id, version, name, kind, ports, limits ([reference](manifest.md)) |
| `src/lib.rs` or `assembly/index.ts` | the DSP: parameters declared once, `activate`, `process` |
| `Cargo.toml` + `.cargo/config.toml`, or `asconfig.json` | the build, already set for EST (the target, the exported table, the memory cap) |
| `est/` | the SDK's library (Rust crate or AssemblyScript), copied in by `est new`, so the folder builds on its own |
| `test/golden.json`, `test/golden.f32` | the golden render `est test` compares with ([below](#the-golden-render)) |
| `est-manifest-1.schema.json` | the manifest's schema, which `est.json`'s `$schema` names |
| `est-validator-rules.json` | every validator rule: id, title, explanation, fix ([as a page](validator-rules.md)) |
| `est-abi-1.0.json`, `est-abi-1.1.json` | the ABI: every CLAP struct's layout on wasm32, for EST 1.0 and 1.1 (only for code written without the SDK's runtime) |
| `est-ui.d.ts` | the UI library's types, for a custom UI in TypeScript |
| `AGENTS.md`, `CLAUDE.md`, `llms.txt` | the same instructions for a coding agent |

`est new` names the plugin from `--id`: its name and id everywhere, the Rust crate (`my-gain`, so the module is `target/wasm32-unknown-unknown/release/my_gain.wasm`) and the plugin's type (`MyGain`). Add `--ui` for a custom UI to start from ([the UI library](ui.md)).

The template is already a working plugin: a smoothed gain and a filter.

## 2. Play it

```
cd ~/plugins/my-gain
est dev
```

Open <http://localhost:4430>. The dev host builds the plugin, checks it exactly as Cyber's install does (the reader, the meter, the conformance run), and shows **Start audio**. Press it: a 220 Hz sine goes through your effect, and the meters show its level. Turn the generated knob, or type a value in the parameter list. Save a file in the folder and the dev host rebuilds and reloads the instance, keeping its state. More in [the dev host](dev-host.md).

## 3. Change it

Change the gain's range in the DSP (and its name in `est.json`'s `parameters` list), save, and watch the dev host rebuild. Keep to the rules a plugin's audio code lives by:

- allocate nothing in `render`, `process`, `param_changed` or the note handlers. Rust: heap memory (a `DelayLine`'s buffer) only in `activate`, sized from its maximum; `new` builds the plugin by value. AssemblyScript: allocate only in the constructor and field initialisers, or in `activate`;
- read parameter changes from the events, at their sample offsets (`param_changed` gets each one; every default arrives there before `activate`);
- keep it deterministic: the same input and events give the same samples (the validator renders twice and compares).

## 4. Validate

```
est validate
```

It builds the plugin, packs it, runs every check Cyber's install runs, prints a readable report and writes `dist/validation.json` next to the bundle. Every check has a stable id (`EST-W004`, `EST-C010` …): look one up in [the validator's rules](validator-rules.md) (or `est-validator-rules.json` in your folder), which gives the explanation and the fix. The command exits 1 on any failure. A performance check (`EST-P…`) is a warning only for now.

The report's summary reads, for example, `block 10.9 µs (budget 100), peak 1.988, deterministic true`:

- **block**: the mean wall time of one 128-frame `process()` call in the conformance run, on this machine, metered (`EST-P001` warns over 100 µs). The dev host's live `meanUs` is a coarser number ([the cost of a block](dev-host.md#the-cost-of-a-block)).
- **peak**: the largest absolute sample on either output channel (1.0 is 0 dBFS) over the **conformance run**, a 10-second stress run, not the golden render and not the sound at the defaults. Every parameter is swept to its minimum, its maximum, the middle and back to its default; an effect gets tones, noise bursts and a full-scale click each second, an instrument bursts of up to 12 notes at once. So it is close to the worst case: the untouched instrument template reports **2.327** (+7.3 dBFS) because four saw voices overlap at full velocity while Level is at its 0 dB maximum and Resonance at 1, and the effect template reports about 2 (full-scale clicks through a resonant filter). It fails only above 7.94 (+18 dBFS, `EST-C015`) or at NaN (`EST-C014`); in a project the host clamps every sample to ±4 (+12 dBFS) and counts what it limited. How loud the plugin sounds in use is what the dev host's meters show.
- **deterministic**: the run, done twice, gave the same samples bit for bit (`EST-C018`).

### The golden render

Then `est test` plays the golden render and compares it with the stored one, and runs the conformance checks again. `test/golden.json` says what to play: an input (`noise` for an effect, `none` for an instrument), a length, and **events that name parameters by their id** (`{ "type": "param", "time": 0.04, "id": 2, "value": 0.6 }`, a value in the parameter's plain units) and notes. `test/golden.f32` is what came out. So **when you change the parameters, change the events to match**: an event for an id you removed does nothing, one for a renumbered id moves another parameter, and a value outside a new range is clamped, so the render no longer tests what it did. After any change to the sound you made on purpose, `est test --update` writes the new render; listen to it first, then keep both files. `est test` exits 1 when anything fails, the golden comparison or any conformance check, and 0 only when all pass.

## 5. Pack and install

```
est pack
```

builds the plugin and writes `dist/org.example.my-gain-1.0.0.est` (`est validate` does the same first, so after a green validate the bundle is already there). In Cyber, signed in as an admin: **Settings → Plugins**, turn on **Developer mode**, then **Load a bundle file…** and pick the `.est`. Add it to a track from the track's **+ Add effect** menu, under the plugins. Cyber runs the same checks as `est validate`; a refusal names the same rule id.

Every change you ship is a new version: a project pins a plugin by its bundle's content hash, so a bundle never changes once anyone uses it.

## Next

- A UI of your own: [the UI library](ui.md).
- An instrument: `est new instrument-rust …` (notes with ids, voices, envelopes; [concepts](concepts.md#notes)).
- A sampler from your own WAVs, a note effect (an arpeggiator, a chord tool) or a visualiser: [which template to start from](templates.md) (`sampler-*`, `midi-effect-*`, `visualiser-*`).
- One idea in a page of tested code (a compressor, a chorus, a bitcrusher, a wavetable synth, a drum synth, a ring modulator, a stereo widener, an auto-wah, a Schroeder reverb, a step sequencer): [the cookbook](cookbook.md); `est new chorus my-chorus` starts from one.
- Coming from CLAP: [porting a CLAP plugin](porting-clap.md).
