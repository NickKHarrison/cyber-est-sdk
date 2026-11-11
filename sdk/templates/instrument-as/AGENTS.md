# An EST instrument in AssemblyScript

This folder is an EST plugin: a WebAssembly instrument that Cyber (and any EST host) installs from
a `.est` bundle. It starts as four voices of a band-limited saw into a resonant low-pass, each
shaped by an ADSR. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly by
`asc`, with no native toolchain. You change the template into your instrument, then build,
validate and pack it with the `est` command. This file is for you and for any coding agent working
on the plugin; `CLAUDE.md` points here.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind (`instrument`), one note input, the limits and the parameter list. `$schema` gives your editor completions. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()`, a voice class and one class extending `Instrument`. |
| `asconfig.json` | The compiler's options (leave them) and an `"est"` block telling `est` how to build it and where the module lands. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The SDK's library (copied in by `est new`): read it for the exact signatures, do not edit it. |
| `est-manifest-1.schema.json` | The manifest's schema (copied in by `est new`). |
| `llms.txt` | Where everything is, for a coding agent. |
| `est-validator-rules.json` | Every validator rule: id, title, explanation, fix (copied in by `est new`). |
| `est-abi-1.0.json`, `est-abi-1.1.json` | The ABI: every CLAP struct's layout on wasm32, for EST 1.0 and for 1.1 (only for code written without the SDK's runtime). |
| `est-ui.d.ts` | The UI library's types, for a custom UI in TypeScript. |

The SDK library is imported as `"est"`: `est/` in this folder, the copy `est new` made (asconfig.json's `"path"` and `"runtime"` point at it; in the SDK's own template they lead to the library in the SDK).

## The commands

```sh
est doctor      # Node and asc: what is missing and the command to fix it
est pack        # asc (the release target), then dist/<id>-<version>.est
est validate    # every check Cyber's install runs; a readable report, and validation.json next to the bundle
est test        # the golden render in test/ and the conformance run
est inspect dist/<id>-<version>.est
est dev         # the dev host: play the plugin from a keyboard while you build it
```

`est` is the kit's command, the npm package `@cyber-est/cli`: in this folder `npm install --save-dev --save-exact @cyber-est/cli@0.1.0` once, then `npx est <command>` (never a bare `npx est` in a folder without it: that fetches npm's unrelated `est` package; elsewhere write `npx @cyber-est/cli <command>`). From a clone of Cyber's repository instead: `node <cyber>/sdk/packages/cli/bin/est.mjs <command>`, or `npm run est -- <command>` at the clone's root; a short name once, at the clone's root (`npm ci` first): `alias est="node $PWD/sdk/packages/cli/bin/est.mjs"`. `est validate` runs this folder's own build before it checks anything. `est help <command>` shows a command's options.

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
| `EST-C` | conformance: lifecycle, ports, parameters, state round trip, notes, tail, determinism, level |
| `EST-U` | the custom UI, when there is one |
| `EST-P` | performance (a warning only) |

The full list, with each rule's explanation and fix, is `est-validator-rules.json` in this folder
(as a page: `sdk/docs/validator-rules.md` in the kit).

## How the instrument is written

- **The export block** at the top of `assembly/index.ts` stays as it is: `clap_entry`, `free`,
  and a `malloc` that calls `setup(describe(), parameters(), make)` first. `describe()`'s first
  feature is `"instrument"`.
- **Parameters are declared once**, in `parameters()` (`new Param(ID, "Name").range(…).default(…)`,
  `.unit("ms")`, `.hertz()`, `.labels([…])`, `.module("Envelope")`), and listed in `est.json`. Ids
  never change. The glue calls `paramChanged(id, value)` with each new value, at its own sample;
  every default arrives first, before `activate`.
- **Notes arrive at their sample**: `noteOn(io, note)`, `noteOff`, `choke`, `noteExpression`,
  `midi`; `note.time` is the frame in the block, `note.key`, `note.velocity` (0…1) and
  `note.noteId` say which.
- **`Voices<T>` does the bookkeeping**: `new Voices<MyVoice>(n)` in a field initialiser makes the
  voices (a voice class extends `Voice`, has a constructor without arguments, and overrides
  `release()` and `stop()`); `this.voices.start(io, note)` gives a free voice or steals the oldest
  (ending its note); `this.voices.release(note)`, `this.voices.choke(io, note)`; in `render`, call
  `this.voices.end(i, io, n)` the moment a voice falls silent.
- `render(io, from, to)` **adds** the voices into frames `from`…`to` (`io.add(c, n, v)`).
- `tail()` is the longest a released note sounds (an `Envelope`'s `tailFrames()`); it must be
  true, and `est.json`'s `limits.tailSeconds` must cover its largest value.
- **Identity**: the `Descriptor`'s id (its first argument) must be `est.json`'s `id` exactly
  (else the plugin does not start: `EST-C001`); its first feature (`"audio-effect"` or
  `"instrument"`) decides the kind, which must match `est.json`'s `kind` and ports (`EST-C003`,
  `EST-C004`); the parameter ids must be `est.json`'s (`EST-C008`). The name, vendor, version,
  description and other features are not compared (Cyber shows `est.json`'s): keep them the same
  anyway.
- **The state magic** (the `Descriptor`'s four characters, `"TMPI"`) starts every saved state; a
  state with another magic is refused on load. Any four characters will do; choose yours before
  you ship and **never change it afterwards**, or every saved state and preset of the earlier
  versions stops loading. Raise the `Descriptor`'s `stateVersion` instead when your own bytes
  change.

### The rules the validator holds you to

- **Every note you start ends**: a NOTE_END for each when its voice stops sounding. `Voices` sends
  it if you call `end` when a voice falls silent.
- **A choke stops at once**, a held note sounds, and after the tail the output is silent.
- **No top-level code but constants** (AssemblyScript would put it in a start function, which an
  EST host's meter traps: `EST-W`).
- **Allocate nothing in `render`, `process`, `paramChanged` or the note handlers**: no `new`, no
  array literals, no string building, no closures. Allocate only in the plugin's constructor and
  field initialisers, or in `activate` (a `DelayLine`'s buffer). The runtime is a bump allocator
  that never frees.
- **Be deterministic**; **import nothing**; stay within `limits.memoryPagesMax`; no output above
  +18 dBFS; no NaN.

## The DSP library

`Smoother`, `Oscillator`, `Filter`, `Envelope`, `Lfo`, `Voices`, `DelayLine`, `Biquad`, `keyToHz`,
`dbToGain`, `gainToDb`: the Rust crate's blocks with camelCase names, rendering the same samples.
Where AssemblyScript forces a difference, the library's `index.ts` lists it.

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
  (through its `@cyber-est/ui` connection); the `param` line with `"origin":"frame"` after it proves the
  UI reaches the host.

The guide, with a complete example and the plugin origin's exact policy, is `sdk/docs/ui.md` in the
kit.

## The window as an app

Made with `est new … --app` (1.335), this folder's window is an app: `ui-app/` is its source, and
`npm run build:ui` builds it into `ui/`, the page `est.json`'s `"ui"` names (`ui/index.html`,
`ui/assets/app.js`, `ui/assets/style.css`). Change the app in `ui-app/`, never in `ui/`: the build
empties `ui/` each time. Then `est validate` and `est dev` as usual.

| File | What |
|---|---|
| `package.json` | `npm run build:ui` (and `npm run dev:ui`, the app in a plain browser with the stand-in engine); Vite, pinned |
| `ui-app/vite.config.ts` | The build: one classic `iife` script, relative URLs, no public folder, the engine swap, fonts from the script, external hosts cut out |
| `ui-app/index.html` | The page: `est-ui.js` (copied in by `est pack`), then the app; its `est-ui-size` gave `est.json`'s `ui.size` |
| `ui-app/main.ts` | The example app, no framework: a slider per parameter and the readout. Replace it with yours |
| `ui-app/store.ts` | The app's state: parameter values and the readout; the app reads and writes only this |
| `ui-app/bridge.ts` | The engine in the window: connect, `applyHost` (the host's values into the store), `pushStore` (the app's changes to the host, a drag as one gesture), `decodeReadout` (the read-only parameters the DSP sets) |
| `ui-app/engine.ts` | The stand-in engine for `npm run dev:ui`; the build swaps it for `bridge.ts` |
| `ui-app/bits.ts` | `packFields` and `unpackFields`: the app's own data (patterns, steps) in hidden parameters, whole numbers below 2^53 |
| `ui-app/fonts.ts` | `registerFonts`: a font imported as `./fonts/x.woff2?base64` and registered from its bytes |

Building needs a Vite 8, either way:

- `npm install` once (it fetches Vite from the npm registry), then `npm run build:ui`;
- or, with no network, the Vite of a Cyber clone (after `npm ci` there):
  `<cyber>/node_modules/.bin/vite build --config ui-app/vite.config.ts`, run in this folder. The
  config imports only Vite's types, so any Vite 8 builds it.

What the frame needs, which the build does and `est validate` checks:

- **One classic script.** The frame's origin is opaque, so a `<script type="module">`, a
  `crossorigin` attribute or a `<link rel="modulepreload">` is a CORS request the plugin origin never
  answers, and the frame stays blank (`EST-U005`). The build bundles the app into one `iife` script
  and rewrites Vite's tag to `<script defer src="./assets/app.js">`.
- **Nothing from another host** (`EST-U002`): the build cuts any URL at the start of a string in the
  built script and styles (React's error links, a CSS banner) and says so; XML namespace names stay.
  Never `fetch` anything: put data the app needs in the script.
- **Fonts in the script**: import each as `?base64` and call `registerFonts` (`fonts.ts`); the build
  drops `@font-face` rules and font files.
- **The host plays.** The plugin's sound, the transport, the keys, MIDI, tempo and files are
  Cyber's: no play button, keyboard or export in the app. Keep `./engine` the one import that
  reaches the host (`bridge.ts` in the build).
- **Every piece of state is a parameter** (the SDK allows 512): the knobs are ordinary parameters,
  the app's own data `hidden()` ones (packed with `bits.ts`), what the plugin is playing
  `hidden().readOnly()` ones the DSP sets about 30 times a second (`decodeReadout`).
- **The size is fixed**: Cyber draws the frame at `ui.size` and never scales it; change the
  `est-ui-size` meta and `est.json`'s `ui.size` together.

The whole guide is "A whole app as the window" in `sdk/docs/ui.md` in the kit.

## The golden render

`test/golden.json` says what to play (notes and `events`, the length) and `test/golden.f32` is what came out.
`est test` plays it again and compares, then runs the conformance checks; it exits 1 if anything
fails. **The events name parameters by their id** (`{ "type": "param", "id": 1, "value": 800 }`,
plain units), so when you add, remove, renumber or re-range a parameter, change the events to
match. After changing the sound on purpose, render it again (`est test --update`), listen, and
commit both files.
