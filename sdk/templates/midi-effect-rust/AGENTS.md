# An EST note effect in Rust

This folder is an EST plugin: a WebAssembly note effect (notes in, notes out) that Cyber (and any EST host) installs from a `.est`
bundle. It starts as an arpeggiator whose rate follows the transport's tempo (and its beat grid while the transport plays) and a chord memory that plays a learned chord from each key; the audio passes through. You change the template into your plugin, then build, validate and pack it with the `est` command. This file is for you and for any coding agent working on the plugin; `CLAUDE.md` points here.

## This template: notes in, notes out

A note effect is an effect (`"kind": "effect"`, an audio input and output that it passes through)
with a note input and a **note output**: `"notes": { "inputs": 1, "outputs": 1 }` in `est.json`,
`"note-effect"` in its features, and `est::export_note_effect!` in the code. Notes arrive at their sample (`event`, `EventKind::NoteOn` and the rest);
it sends notes with `io.send_note_on(id, channel, key, velocity, n)` and `io.send_note_off(…)`, each at a sample of the block. The rules:

- **Every note it starts it ends**: when the key is let go, when the mode changes, on a choke.
  The golden test counts them.
- Allocate nothing while processing: the held keys and the chords are fixed arrays.
- The tempo and the position come from `io.transport` (and a transport event mid-block moves them:
  the template keeps where it was set, `trAt`).

`est dev` shows a keyboard for a note effect; the notes it sends are `plugin-notes` lines in the
log (`est dev --json`), and `est test` compares them with `test/golden-notes.json`.

**What Cyber does with the notes today:** it installs and runs a note effect as an insert (the
audio passes through) and reports the notes it sends, but does not yet route them to the next
plugin on the track or record them (that is EST 1.1, planned). Build and test it now; it plays on
the track once the host routes note outputs.

## The files

| File | What |
|---|---|
| `test/golden-notes.json` | The notes the golden render must send, compared exactly by `est test`. |
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. `$schema` gives your editor completions. |
| `src/lib.rs` | The plugin: one `impl Effect` and one `est::export_note_effect!`. |
| `Cargo.toml` | The crate. `[package.metadata.est]` tells `est` how to build it and where the module lands. |
| `.cargo/config.toml` | The target (`wasm32-unknown-unknown`) and the link flags EST needs. Leave them. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
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
est dev         # the dev host: play the plugin while you build it
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
| `EST-C` | conformance: lifecycle, ports, parameters, state round trip, process, determinism, level |
| `EST-U` | the custom UI, when there is one |
| `EST-P` | performance (a warning only) |

The full list, with each rule's explanation and fix, is `est-validator-rules.json` in this folder
(as a page: `sdk/docs/validator-rules.md` in the kit).

## How the plugin is written

- **Parameters are declared once**, in `PARAMS`, with the builder:
  `Param::new(ID, "Name").range(min, max).default(v).unit("dB").decimals(1)`,
  `.hertz()` for a frequency, `.labels(&["A", "B"])` for a switch, `.module("Group")` to group
  them. List each id in `est.json`'s `parameters` too. Ids are stable for the plugin's life: never
  reuse or renumber one.
- The glue stores every value and calls `param_changed(id, value)` with each new one (already
  clamped and stepped), at its own sample. Every default arrives here first, before `activate`
  (so call your blocks' `reset()` in `activate`, after their sample rate, as the template does).
- `activate(sample_rate, max_frames)` is the only place to allocate: size delay lines there
  (`DelayLine::allocate`), set every block's sample rate.
- `render(io, from, to)` writes frames `from..to`: `io.input(c, n)`, `io.output(c, n, v)`,
  `io.channels`. The default `process` calls it between events, so automation is sample accurate.
  `io.transport` has the tempo, the position in beats and the time signature.
- The state is every parameter plus `save_state`/`load_state`'s bytes. Raise `STATE_VERSION`
  when those bytes change and keep loading the old ones.
- `tail()` is how long the output may go on after the input stops; `latency()` is 0 unless the
  effect really delays (and `est.json`'s `limits` must cover both).
- **Identity**: `est::export_effect!`'s `id` must be `est.json`'s `id` exactly (else the plugin
  does not start: `EST-C001`); the kind comes from the macro (`export_effect!` or
  `export_instrument!`) and must match `est.json`'s `kind` and ports (`EST-C003`, `EST-C004`); the
  parameter ids must be `est.json`'s (`EST-C008`). The name, vendor, version, description and
  features are not compared (Cyber shows `est.json`'s): keep them the same anyway.
- **The state magic** (`STATE_MAGIC`, four bytes: `u32::from_le_bytes(*b"TMPE")`) starts every
  saved state; a state with another magic is refused on load. Any four bytes will do; choose yours
  before you ship and **never change it afterwards**, or every saved state and preset of the
  earlier versions stops loading. Raise `STATE_VERSION` instead when your own bytes change.

### The rules the validator holds you to

- **Allocate nothing in `render`, `process`, `param_changed` or the note handlers**: no `Vec`,
  no `Box`, no growing anything. Heap memory (`DelayLine::allocate`) only in `activate`, sized
  from its maximum; `new` builds the plugin by value (its filters, smoothers and voices are plain
  values inside it) and allocates nothing.
- **Be deterministic**: the same input and events give the same output, bit for bit, every run.
  Use `est::math` (not a library that calls the host), and no randomness in `process`.
- **Import nothing**: the module exports `clap_entry`, `malloc`, `free`, its table and memory, and
  imports nothing. The crate does this for you; do not add dependencies that need `std` or WASI.
- **Stay within the manifest**: the memory maximum in `.cargo/config.toml` (bytes) must not pass
  `limits.memoryPagesMax` (64 KiB pages); no output above +18 dBFS; no NaN.
- `no_std`: `core` has no float maths, so use `est::math` (`exp`, `ln`, `sin_turns`, `db_to_gain`…).

## The DSP library (`est::dsp`)

`Smoother`, `Oscillator` (sine and band-limited saw, square, triangle), `Filter` (state-variable:
low, band, high, notch), `Envelope` (ADSR, with `tail_frames`), `Lfo` (free or synced to the
tempo), `Voices` (polyphony), `DelayLine`, `Biquad` (the RBJ cookbook), `db_to_gain` and
`gain_to_db`. Each takes `set_sample_rate` in `activate` and allocates nothing after it. The
AssemblyScript library has the same blocks, sample for sample.

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

`test/golden.json` says what to play (`input`, `events`, the length) and `test/golden.f32` is what came out.
`est test` plays it again and compares, then runs the conformance checks; it exits 1 if anything
fails. **The events name parameters by their id** (`{ "type": "param", "id": 1, "value": 800 }`,
plain units), so when you add, remove, renumber or re-range a parameter, change the events to
match. After changing the sound on purpose, render it again (`est test --update`), listen, and
commit both files.
