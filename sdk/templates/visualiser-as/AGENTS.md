# An EST plugin with a visual UI in AssemblyScript

This folder is an EST plugin: a WebAssembly audio effect with its own page that Cyber (and any EST host) installs from a `.est`
bundle. It starts as a pass-through with a smoothed trim, and a page (`ui/`) that draws the level after it on a canvas: each channel's peak over the last seconds, its average and its hold. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly by `asc`, with no native toolchain. You change the template into your plugin, then build, validate and pack it with the `est` command. This file is for you and for any coding agent working on the plugin; `CLAUDE.md` points here.

## This template: a UI that reacts to sound

The page never sees samples. In UI protocol 2 the host sends `est:meter { in, out }` at most 30
times a second while the window is open: the strip's levels, linear peaks `[left, right]` (after
the plugin; `in` may be null). `ui.js` keeps their history and draws it in one
`requestAnimationFrame` loop. `est.meters` is false on a host that sends none (protocol 1): the
page says so. History is a parameter only so that it saves with the project (the DSP ignores it).

What a page may load: scripts, CSS, images and fonts that are files of the bundle; no inline
script, nothing from another host, no `fetch` (`EST-U` rules). `est dev` shows the page beside the
generated knobs with live meters.

**What it cannot draw yet:** a spectrum or anything else computed from the samples. The plugin's
DSP has no channel to send its own analysis to the page in EST 1.0 (the meters are the host's), so
a spectrum waits for the UI protocol's audio tap (EST 1.1, planned: magnitudes and RMS from the
host's analyser, never raw samples).

## The files

| File | What |
|---|---|
| `ui/index.html`, `ui/ui.js`, `ui/style.css` | The page: a canvas, a readout and two knobs; `ui.js` draws from `est.onMeter`. |
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. `$schema` gives your editor completions. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()` and one class extending `Effect`. |
| `asconfig.json` | The compiler's options (leave them) and an `"est"` block telling `est` how to build it and where the module lands. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `est/` | The SDK's library (copied in by `est new`): read it for the exact signatures, do not edit it. |
| `est-manifest-1.schema.json` | The manifest's schema (copied in by `est new`). |
| `llms.txt` | Where everything is, for a coding agent. |
| `est-validator-rules.json` | Every validator rule: id, title, explanation, fix (copied in by `est new`). |
| `est-abi-1.0.json` | The ABI: every CLAP struct's layout on wasm32 (only for code written without the SDK's runtime). |
| `est-ui.d.ts` | The UI library's types, for a custom UI in TypeScript. |

The SDK library is imported as `"est"`: `est/` in this folder, the copy `est new` made (asconfig.json's `"path"` and `"runtime"` point at it; in the SDK's own template they lead to the library in the SDK).

## The commands

```sh
est doctor      # Node and asc: what is missing and the command to fix it
est pack        # asc (the release target), then dist/<id>-<version>.est
est validate    # every check Cyber's install runs; a readable report, and validation.json next to the bundle
est test        # the golden render in test/ and the conformance run
est inspect dist/<id>-<version>.est
est dev         # the dev host: play the plugin while you build it
```

`est` is the kit's command, run from a clone of Cyber's repository (it is not on npm yet): `node <cyber>/sdk/packages/cli/bin/est.mjs <command>`, or `npm run est -- <command>` at the clone's root. Give it a short name once, at the clone's root (`npm ci` first): `alias est="node $PWD/sdk/packages/cli/bin/est.mjs"`. `est help <command>` shows a command's options.

## The loop

1. Change `assembly/index.ts` (and `est.json` when the parameters or the identity change).
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

- **The export block** at the top of `assembly/index.ts` stays as it is: it exports
  `clap_entry`, `free` and a `malloc` that calls `setup(describe(), parameters(), make)` first.
  `describe()` is the identity (it must match `est.json`) and the state's four-letter magic.
- **Parameters are declared once**, in `parameters()`, with the builder:
  `new Param(ID, "Name").range(min, max).default(v).unit("dB").decimals(1)`, `.hertz()`,
  `.labels(["A", "B"])`, `.module("Group")`. List each id in `est.json` too. Ids never change.
- The glue stores every value and calls `paramChanged(id, value)` with each new one (clamped and
  stepped), at its own sample. Every default arrives here first, before `activate`
  (so call your blocks' `reset()` in `activate`, after their sample rate, as the template does).
- `activate(sampleRate, maxFrames)` sets every block's sample rate and sizes delay lines
  (`DelayLine.allocate`).
- `render(io, from, to)` writes frames `from`…`to`: `io.input(c, n)`, `io.output(c, n, v)`,
  `io.channels`. `io.transport` has the tempo, the position in beats and the time signature.
- `saveState(w)`/`loadState(r, version)` add the plugin's own bytes after the parameters (the
  glue saves those).
- **Identity**: the `Descriptor`'s id (its first argument) must be `est.json`'s `id` exactly
  (else the plugin does not start: `EST-C001`); its first feature (`"audio-effect"` or
  `"instrument"`) decides the kind, which must match `est.json`'s `kind` and ports (`EST-C003`,
  `EST-C004`); the parameter ids must be `est.json`'s (`EST-C008`). The name, vendor, version,
  description and other features are not compared (Cyber shows `est.json`'s): keep them the same
  anyway.
- **The state magic** (the `Descriptor`'s four characters, `"TMPE"`) starts every saved state; a
  state with another magic is refused on load. Any four characters will do; choose yours before
  you ship and **never change it afterwards**, or every saved state and preset of the earlier
  versions stops loading. Raise the `Descriptor`'s `stateVersion` instead when your own bytes
  change.

### The rules the validator holds you to

- **No top-level code but constants.** AssemblyScript runs top-level code in a WebAssembly start
  function, and an EST host meters every module and gives it no fuel before its first call: a
  start function traps (`EST-W`). Create objects in constructors, `setup` or `activate`.
- **Allocate nothing in `render`, `process`, `paramChanged` or the note handlers**: no `new`, no
  array literals, no string building, no closures. Allocate only in the plugin's constructor and
  field initialisers, or in `activate` (a `DelayLine`'s buffer). The runtime is a bump allocator
  that never frees.
- **Be deterministic**: the same input and events give the same output, bit for bit. The SDK's
  maths (`exp`, `sinTurns`, `dbToGain`…) is what the blocks use.
- **Import nothing** (the `abort` at the bottom traps instead of importing one); stay within
  `limits.memoryPagesMax` (asconfig's `maximumMemory`, in pages); no output above +18 dBFS; no NaN.

## The DSP library

`Smoother`, `Oscillator` (sine and band-limited saw, square, triangle), `Filter` (state-variable:
low, band, high, notch), `Envelope` (ADSR, with `tailFrames`), `Lfo` (free or synced to the
tempo), `Voices` (polyphony), `DelayLine`, `Biquad` (the RBJ cookbook), `dbToGain` and `gainToDb`.
They are the Rust crate's blocks with camelCase names and render the same samples; where
AssemblyScript forces a difference, the library's `index.ts` lists it.

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
