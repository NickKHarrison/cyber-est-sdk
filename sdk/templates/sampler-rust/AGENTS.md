# An EST sampler in Rust

This folder is an EST plugin: a WebAssembly instrument that Cyber (and any EST host) installs from a `.est`
bundle. It starts as three samples (two velocity layers of a pluck on the upper keys, a looped drone on the lower ones), played from notes with pitch, a one-shot or loop mode and an ADSR, eight voices. You change the template into your plugin, then build, validate and pack it with the `est` command. This file is for you and for any coding agent working on the plugin; `CLAUDE.md` points here.

## This template: samples in the module

An EST module imports nothing and reads no file at run time (that is the sandbox), so a sampler's
samples travel **inside `module.wasm`**, as data, and nothing is fetched while it plays. The path:

1. Put 16-bit PCM mono WAVs in `assets/` (export them as that from any editor).
2. Map them in `samples.json`: `{ "file": "assets/kick.wav", "root": 36, "keys": [36, 36], "velocity": [0, 1] }`;
   two entries on the same keys with different `velocity` ranges are velocity layers; `"loop": [start, end]`
   (frames) is what the Loop mode repeats. The first entry that matches a note plays it.
3. `node tools/embed-samples.mjs` writes `src/samples.rs`; then `est validate` as always. The folder's test
   (and `--check`) fails while the generated file is out of date.

Keep the samples small: they count against `limits.memoryPagesMax` (64 KiB a page; raise it, and
`.cargo/config.toml`'s `--max-memory`, for more than about 600 KB of samples; the tool refuses more than a million frames).
A note with no matching sample ends at once (its NOTE_END is sent). Pitch is
`2^((key + Tune - root) / 12)` × the WAV's rate ÷ the host's, with linear interpolation.

## The files

| File | What |
|---|---|
| `samples.json` | Which WAV plays which notes: each entry's file, root key, key range, velocity range and loop points. |
| `assets/*.wav` | The samples: 16-bit PCM mono WAVs, at any rate (the plugin resamples to the host's). |
| `tools/embed-samples.mjs` | Writes the samples into the source (`src/samples.rs`): run it after changing `samples.json` or a WAV (`--check` says whether it is up to date). |
| `src/samples.rs` | Generated: the sample table (`INFO`) and every frame (`DATA`). Do not edit it. |
| `est.json` | The manifest: id, name, version, kind (`instrument`), one note input, the limits and the parameter list. `$schema` gives your editor completions. |
| `src/lib.rs` | The plugin: one `impl Instrument` and one `est::export_instrument!`. |
| `Cargo.toml` | The crate. `[package.metadata.est]` tells `est` how to build it and where the module lands. |
| `.cargo/config.toml` | The target (`wasm32-unknown-unknown`) and the link flags EST needs. Leave them. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The SDK's library (copied in by `est new`): read it for the exact signatures, do not edit it. |
| `est-manifest-1.schema.json` | The manifest's schema (copied in by `est new`). |
| `llms.txt` | Where everything is, for a coding agent. |
| `est-validator-rules.json` | Every validator rule: id, title, explanation, fix (copied in by `est new`). |
| `est-abi-1.0.json` | The ABI: every CLAP struct's layout on wasm32 (only for code written without the SDK's runtime). |
| `est-ui.d.ts` | The UI library's types, for a custom UI in TypeScript. |

The SDK crate `est` is a path dependency: `est/` in this folder, the copy `est new` made (`est = { path = "est" }`; in the SDK's own template the path leads to the crate in the SDK). Its blocks are in `est::dsp`; `use est::prelude::*;` brings everything.

## The commands

```sh
est doctor      # Rust, the wasm32-unknown-unknown target, Node: what is missing and the command to fix it
est pack        # cargo build --release, then dist/<id>-<version>.est
est validate    # every check Cyber's install runs; a readable report, and validation.json next to the bundle
est test        # the golden render in test/ and the conformance run
est inspect dist/<id>-<version>.est
est dev         # the dev host: play the plugin from a keyboard while you build it
```

`est` is the kit's command, run from a clone of Cyber's repository (it is not on npm yet): `node <cyber>/sdk/packages/cli/bin/est.mjs <command>`, or `npm run est -- <command>` at the clone's root. Give it a short name once, at the clone's root (`npm ci` first): `alias est="node $PWD/sdk/packages/cli/bin/est.mjs"`. `est help <command>` shows a command's options.

## The loop

1. Change `src/lib.rs` (and `est.json` when the parameters or the identity change).
2. `est validate`: it builds, packs (`dist/<id>-<version>.est`) and runs every check Cyber's install
   runs. Read `dist/validation.json`: every failed check has a `rule`, a `message`, a `fix` and a
   `where` (`--json` prints the same report).
3. Fix what it names and go back to 2. When it is green, `est test` (the golden render; after
   changing the sound on purpose, `est test --update`).
4. Listen: `est dev` (a page on http://localhost:4430), or without a screen
   `est dev --json --seconds 3 < /dev/null`: JSON lines of meters and events. Pipe commands in, one
   JSON object a line (`{"cmd":"param","id":0,"value":-6}`, `{"cmd":"wait","ms":500}`,
   `{"cmd":"state"}`, `{"cmd":"note","key":60,"ms":300}` …): they run in order, each after the one
   before has finished, and without `--seconds` the run ends a second after the last. A port in
   use stops it: add `--port 0 --files-port 0`. (`sdk/docs/dev-host.md` in the kit has it all.)
5. Install: in Cyber (an admin account), **Settings → Plugins**, turn on **Developer mode**, then
   **Load a bundle file…** and pick `dist/<id>-<version>.est`. Cyber runs the same checks; a refusal
   names the same rule id.

The rule ids are stable. Their prefix says where to look:

| Prefix | What it checks |
|---|---|
| `EST-M` | the manifest (`est.json`) |
| `EST-B` | the bundle and its archive |
| `EST-W` | the WebAssembly module: imports, exports, memory, features, no start function |
| `EST-C` | conformance: lifecycle, ports, parameters, state round trip, notes, tail, determinism, level |
| `EST-U` | the custom UI, when there is one |
| `EST-P` | performance (a warning only) |

The full list, with each rule's explanation and fix, is `est-validator-rules.json` in this folder
(as a page: `sdk/docs/validator-rules.md` in the kit).

## How the instrument is written

- **Parameters are declared once**, in `PARAMS` (`Param::new(ID, "Name").range(…).default(…)`,
  `.unit("ms")`, `.hertz()`, `.labels(&[…])`, `.module("Envelope")`), and listed in `est.json`.
  Ids never change. The glue stores the values and calls `param_changed(id, value)` with each new
  one, at its own sample; every default arrives here first, before `activate` (so `activate`
  resets the blocks, as the template does).
- **Notes arrive at their sample**: `note_on(io, note)`, `note_off`, `choke`,
  `note_expression`, `midi`; `note.time` is the frame in the block, `note.key`,
  `note.velocity` (0…1) and `note.note_id` say which.
- **`Voices<T, N>` does the bookkeeping**: `let i = self.voices.start(io, note)` gives a free
  voice or steals the oldest (ending its note); `self.voices.release(note)` calls your voice's
  `release()`; `self.voices.choke(io, note)` ends voices at once; in `render`, call
  `self.voices.end(i, io, n)` the moment a voice falls silent. A voice implements `Voice`
  (`release`, and `stop`, called when its note ends).
- `render(io, from, to)` **adds** the voices into frames `from..to` (`io.add(c, n, v)`); the
  outputs start each block at zero.
- `tail()` is the longest a released note sounds (an `Envelope`'s `tail_frames()`); it must be
  true, and `est.json`'s `limits.tailSeconds` must cover its largest value.
- **Identity**: `est::export_instrument!`'s `id` must be `est.json`'s `id` exactly (else the plugin
  does not start: `EST-C001`); the kind comes from the macro (`export_effect!` or
  `export_instrument!`) and must match `est.json`'s `kind` and ports (`EST-C003`, `EST-C004`); the
  parameter ids must be `est.json`'s (`EST-C008`). The name, vendor, version, description and
  features are not compared (Cyber shows `est.json`'s): keep them the same anyway.
- **The state magic** (`STATE_MAGIC`, four bytes: `u32::from_le_bytes(*b"TMPI")`) starts every
  saved state; a state with another magic is refused on load. Any four bytes will do; choose yours
  before you ship and **never change it afterwards**, or every saved state and preset of the
  earlier versions stops loading. Raise `STATE_VERSION` instead when your own bytes change.

### The rules the validator holds you to

- **Every note you start ends**: a NOTE_END for each, when its voice stops sounding (released,
  choked or stolen). `Voices` sends it if you call `end` when a voice falls silent.
- **A choke stops at once**, a held note sounds, and after the tail the output is silent.
- **Allocate nothing in `render`, `process`, `param_changed` or the note handlers**: no `Vec`,
  no `Box`, no growing anything. Heap memory (`DelayLine::allocate`) only in `activate`, sized
  from its maximum; `new` builds the plugin by value (its filters, smoothers and voices are plain
  values inside it) and allocates nothing.
- **Be deterministic**: the same notes give the same output, bit for bit. Use `est::math`, no
  randomness in `process`.
- **Import nothing**; stay within `limits.memoryPagesMax`; no output above +18 dBFS; no NaN.

## The DSP library (`est::dsp`)

`Smoother`, `Oscillator` (sine and band-limited saw, square, triangle), `Filter` (state-variable:
low, band, high, notch), `Envelope` (ADSR, with `tail_frames`), `Lfo` (free, or synced: feed it
`io.transport.tempo`), `Voices`, `DelayLine`, `Biquad`, `key_to_hz`, `db_to_gain`, `gain_to_db`.
Each takes `set_sample_rate` in `activate` and allocates nothing after it. The AssemblyScript
library has the same blocks, sample for sample.

## A custom UI

Made with `est new … --ui`, this folder has one in `ui/` (`ui/index.html`, `ui/ui.js` and
`ui/style.css`: an `<est-knob>` per parameter, bound to the template's parameters, and `est.json`'s
`"ui"` entry): change the page to match your parameters. Made without `--ui`, it has none and Cyber
generates knobs from the parameters; add a UI by hand with these files:

- `ui/index.html` loads `<script src="est-ui.js"></script>` and then your script, both files.
  `est pack` copies `est-ui.js` (the UI library) into the bundle: do not add it yourself. It gives
  `EstUI.connect()`, `EstUI.bind(el, id)` and the `<est-knob param="ID">` and `<est-slider>`
  elements; `est-ui.d.ts` in this folder has its types.
- `est.json`: `"ui": { "path": "ui/index.html", "size": { "w": 440, "h": 180 } }`. Cyber draws the
  frame at exactly that size (CSS pixels) and never scales it.
- What loads: scripts, CSS and `.png`, `.webp`, `.svg` images and `.woff2` fonts that are files of
  the bundle (inline `<style>` and `style=""` too; no inline script, no `.jpg` or `.gif`, nothing
  from another host, no `fetch`). `EST-U` rules check it.
- `est dev --json` reports the page as `ui` lines: its load, `est:ready`, each message the host
  refused and why, console errors, uncaught errors and files that did not load.
  `{"cmd":"ui-param","id":0,"value":0.5}` on its stdin makes the page itself write a parameter
  (through its `@est/ui` connection); the `param` line with `"origin":"frame"` after it proves the
  UI reaches the host.

The guide, with a complete example and the plugin origin's exact policy, is `sdk/docs/ui.md` in the
kit.

## The golden render

`test/golden.json` says what to play (notes and `events`, the length) and `test/golden.f32` is what came out.
`est test` plays it again and compares, then runs the conformance checks; it exits 1 if anything
fails. **The events name parameters by their id** (`{ "type": "param", "id": 1, "value": 800 }`,
plain units), so when you add, remove, renumber or re-range a parameter, change the events to
match. After changing the sound on purpose, render it again (`est test --update`), listen, and
commit both files.
