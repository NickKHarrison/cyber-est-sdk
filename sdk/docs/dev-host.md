# The dev host: `est dev`

```
est dev [folder | file.est] [--port 4430] [--files-port 4431] [--no-watch] [--open]
est dev [folder | file.est] --json [--seconds N] [--play 60,64,67]
est dev <folder with ui/> --ui-preview params.json
```

`est` is `node <cyber>/sdk/packages/cli/bin/est.mjs` (see [getting started](getting-started.md#0-check-your-tools)); `est dev --help` lists every option.

The dev host is a page for playing a plugin while you build it, on **Cyber's own runtime**: the page is built from Cyber's own EST code, so the bundle goes through the compiling Worker exactly as an install does (Cyber's reader, the meter, the compile and the conformance run), and the metered module runs in Cyber's `est-plugin` audio processor. What works here works in Cyber.

## What it serves

- `http://localhost:4430`: the page and its API;
- `http://localhost:4431`: the bundle's files under `/est/b/<hash>/…`, answered by Cyber's plugin-origin server code with production's headers and policy (framed only by the dev host). The custom UI's frame is therefore on another origin, sandboxed with an opaque origin, as in Cyber. (Production's two origins are also different sites; on localhost they are the same site, which changes nothing a page can see.)

**Ports.** Both ports must be free. When one is taken (another `est dev` is running, say), `est dev` stops with `EADDRINUSE … the port is taken` and does nothing else: pass `--port` and `--files-port` with two free ports, or `--port 0 --files-port 0` to take any free ones (the `host` line, or the console, says which). Two `est dev` at once need different ports.

The target is a plugin's **folder** (`est.json` and a `Cargo.toml` or `asconfig.json`: built as `est pack` builds it, packed, and rebuilt on every saved change), a **`.est` file**, or a **folder holding `bundle.est`**. Each new bundle is read with Cyber's reader before it is served; a refusal or a build error shows on the page with the build's output. A folder's packed bundle is kept at `dist/dev.est`.

## The page

- **Plugin**: the install check's result and **Start audio** (an AudioContext waits for a click). **Rebuild** for a folder.
- **Transport**: play, stop and the tempo. While it plays, the instance gets the same transport events Cyber's sends (tempo, beats, seconds, the bar, 4/4), one per scheduler window.
- **Keyboard** (an instrument): two octaves on screen, the computer keys (A to K and the row above; Z and X for the octave; not while a field or a control has the focus), and Web MIDI after **Use MIDI** (notes, bend, the wheel, sustain, any CC). Notes go through Cyber's own note mapping, with ids.
- **Input** (an effect): a test signal (a 220 Hz sine at −12 dBFS, noise, tone bursts) or an audio file, looped.
- **Generated UI and custom UI** side by side: the generated knobs (made with `@cyber-est/ui`), and the plugin's page in Cyber's own frame component. A change in either reaches the other and the instance. Under the page, the frame protocol version it speaks (from its `est:ready`) and, in version 2, the sample rate it was given and the output meters it is sent (`est:meter`, at most 30 a second, only when they change).
- **Parameters**: every parameter the instance reports (id, name, module, range, default, flags) with a value to type; a range marks `(log)` when est.json gives the parameter `"scale": "log"` (since EST 1.286), and the generated knobs, the custom UI's `est:init` (its `scale` key) and the processor's mapping of a lane's 0…1 follow it, as in Cyber.
- **Output**: peak and RMS of each channel in dBFS.
- **State**: **Save and load the state** saves it, loads it back and compares the parameters and the bytes (after the parameter changes before it have reached the plugin); the bundle's presets load from the list.
- **Validation**: the install check (Cyber's pipeline: metering points, determinism, the cost of a block) and the last `validation.json`.
- **Event log**: everything above, what the custom UI does (`ui` lines, below), and what the instance says (its errors, its own parameter changes, block statistics).

After a rebuild the page re-checks the new bundle and, if the audio was running, makes the new instance from the old one's state.

## `--json`: for an agent without a screen

`est dev --json` runs the page in Playwright's Chromium, headless (an optional peer of `@cyber-est/cli`: `npm install --save-dev --save-exact @playwright/test@1.64.1 && npx playwright install chromium` in the plugin's folder, or `npx playwright install chromium` once at the clone's root; `est doctor` reports it), starts the audio and prints one JSON object a line:

```
{"type":"build","n":1,"ok":true,"via":"@cyber-est/tools (rust)","message":"ready: My Gain 1.0.0 (3f2a…)","hash":"3f2a…"}
{"type":"host","url":"http://localhost:4430","files":"http://localhost:4431"}
{"n":1,"t":1569,"type":"install","ok":true,"points":93,"blockUs":7.6,"deterministic":true}
{"n":2,"t":1641,"type":"ready","params":1,"latency":0,"tail":0,"metered":true,"audioIn":2,"audioOut":2,"notePorts":0}
{"type":"meter","t":2146,"peak":[-12,-12],"rms":[-15,-15]}
{"n":4,"t":1670,"type":"command","command":{"cmd":"param","id":0,"value":-6}}
{"n":5,"t":1670,"type":"param","id":0,"value":-6,"origin":"command"}
{"n":6,"t":1671,"type":"done","cmd":"param","seq":1}
{"n":7,"t":1690,"type":"command","command":{"cmd":"state"}}
{"n":8,"t":1712,"type":"state","bytes":24,"paramsEqual":true,"bytesEqual":true,"differing":[]}
{"n":9,"t":1713,"type":"done","cmd":"state","seq":2}
```

`t` is milliseconds on the page's clock. Meters come four times a second, in dBFS (`null` is silence). `install` with `"ok":false` carries `code`, `rule` (the validator's rule id, as Cyber's refusal names it) and `message`: the refusal, as Cyber would word it. `stats` lines (twice a second) carry the live instance's `blocks`, `meanUs` and `maxUs` (see [the cost of a block](#the-cost-of-a-block)).

### Commands

It reads commands on stdin, one JSON object a line:

| Command | Does |
|---|---|
| `{"cmd":"note","key":60,"velocity":100,"ms":500}` | a note, released after `ms`; it does not hold the queue (notes sent together are a chord: put a `wait` between them for a melody). `velocity` is MIDI's 0–127 (default 100), as `--play` sends it; the plugin receives it as CLAP's 0…1 (`velocity / 127`) |
| `{"cmd":"noteOn","key":60}`, `{"cmd":"noteOff","key":60}` | a held note |
| `{"cmd":"param","id":0,"value":-6}` | a parameter, in plain units (Hz, dB …), clamped to its range |
| `{"cmd":"play"}`, `{"cmd":"stop"}`, `{"cmd":"tempo","bpm":128}` | the transport |
| `{"cmd":"signal","kind":"sine"}` | an effect's input: `sine`, `noise`, `pulse`, `off` |
| `{"cmd":"state"}` | the state round trip, once every earlier parameter change has reached the plugin |
| `{"cmd":"preset","id":"presets/warm.bin"}` | a bundle preset |
| `{"cmd":"params"}` | prints every parameter with its value |
| `{"cmd":"ui-param","id":0,"value":-6}` | the custom UI's page writes the parameter **itself**: its own `@cyber-est/ui` connection (`EstUI.currentConnection()`) sends a gesture's begin, the value and its end, as a knob's drag does, so the host's `param` line with `"origin":"frame"` that follows proves the UI → host path. Its `done` carries the value the page holds and `changed`. An `error` line when the plugin has no UI, the page does not load `est-ui.js` or never connects (it waits up to 3 s for the page to come up), or there is no such parameter |
| `{"cmd":"wait","ms":500}` | holds the queue for `ms` (at most 600000) |
| `{"cmd":"quit"}` | stops, when its turn comes |

The commands run **one at a time, in the order read, and no sooner than they arrived**: each starts when the one before it has finished (the page prints `command` when one starts and `done`, with its `seq`, when it has finished), and two lines written a second apart run a second apart. Commands read before the instance runs wait for it, keeping their spacing; but while the dev host starts (it builds and checks first) it may read several lines late and at once, so where timing matters use `wait`, or write after the `ready` line. A command that does not finish in 30 seconds is reported as an `error` and the queue goes on. A line that is not a JSON object is an `error` line, and skipped.

### How long it runs

One rule: **`--seconds N` stops it N seconds after the instance started**, whatever is still queued. **Without `--seconds`, it stops one second after the last of its work**: with `--play`, after the notes (each held 400 ms, one every 500 ms, ahead of any stdin command) and the commands read by then; without `--play`, after stdin closes and its last command has finished. `quit` stops it in its turn either way. So `printf … | est dev --json` runs exactly as long as its commands; with a terminal on stdin and neither option, it runs until Ctrl+D (or Ctrl+C).

It exits 0 when the build and the start went well, 1 otherwise. For example:

```
printf '{"cmd":"param","id":0,"value":-6}\n{"cmd":"state"}\n' | est dev --json
printf '{"cmd":"note","key":60,"ms":300}\n{"cmd":"wait","ms":400}\n{"cmd":"note","key":64,"ms":300}\n' | est dev --json
est dev --json --play 48,55,60
est dev --json --seconds 3 < /dev/null
```

`--play`'s notes are sent at velocity 100 of MIDI's 0–127; a `note` command's `velocity` is in the same scale. The plugin always sees CLAP's 0…1 (`velocity / 127`: 100 is about 0.79), as it does in Cyber.

### The custom UI, headless

A plugin with a `ui` shows it in the page (in Cyber's own frame component), and `--json` reports it as `ui` lines:

| Line | When |
|---|---|
| `{"type":"ui","event":"load","url":"…/ui/index.html"}` | the frame's page has loaded |
| `{"type":"ui","event":"init","params":4,"reason":"load"}` | the host sent `est:init` (on the load, and again for each `est:ready`: `"reason":"ready"`) |
| `{"type":"ui","event":"ready"}` | the page sent a valid `est:ready` (`EstUI.connect()` does) |
| `{"type":"ui","event":"rejected","count":1,"reason":"value 5 is outside Mix's range 0…1 …","message":"{…}"}` | the host refused a message from the page, and why (the same checks as Cyber's: the sender, the nonce, the keys, the size, the parameter, its range, 240 a second). The first 20 are printed, then one in a hundred, with the running `count` |
| `{"type":"ui","event":"console","level":"error","text":"…","url":"…"}` | the page's console errors and warnings, including the browser's own (a load the policy refused: `Refused to load …`) |
| `{"type":"ui","event":"error","message":"…","url":"…/ui/ui.js"}` | an uncaught error in the page |
| `{"type":"ui","event":"http","status":404,"url":"…"}` | a file of the page that did not load (`status` null with `failure` when the request failed, as for a file that is not in the bundle) |

The lines come in the order the events happen, which is not fixed: a page whose script calls `EstUI.connect()` while the page is still loading usually shows `ready` (and its `init`, `"reason":"ready"`) before `load` (and its `init`, `"reason":"load"`); a page that connects later shows `load` first. Count on the set, not the order: `load` once, `ready` once for a page that connects, and an `init` after each.

A parameter the page writes is a `param` line with `"origin":"frame"` (and `patch`: the ids and values written). A page that never sends `est:ready` still gets `est:init` on its load; a page with no `ready` line and no `rejected` line has sent nothing. To make the page write without a pointer, send `{"cmd":"ui-param","id":n,"value":v}` (the table above): the write leaves the frame as a control's would, and the `param` line that follows is the host taking it.

### The cost of a block

Two numbers measure the DSP's cost, and they are not the same measurement:

- **`est validate`'s `block … µs`** (and `blockUs` on the `install` line): the mean wall time of one 128-frame `process()` call over the 10-second conformance run, timed with a microsecond clock, on the machine that validates, the host's own work around the call included. This is the number the budget (`EST-P001`, 100 µs) is checked against; compare plugins with it.
- **The `stats` lines' `meanUs` and `maxUs`**: the live instance in the audio thread, over the last half second. An audio worklet has only a millisecond clock, so each block is timed as 0 or 1000 µs: `meanUs` is an estimate that averages out over many blocks (and is often 0 for a light plugin), and `maxUs` is 0 or a whole number of milliseconds. Use them to see that the live instance runs and is not far over budget, not to measure it.

## Profiling: `est profile`

When `est validate` says a block costs too much (`EST-P001`), `est profile` says where the cost goes, function by function, instead of leaving you to guess:

```
est profile                      # this folder: built and packed first, the 10-second conformance run
est profile dist/x.est --top 20  # a bundle; list twenty functions
est profile --golden             # the folder's test/golden.json instead of the conformance signal
est profile --notes              # an effect that takes notes: the conformance run's notes into it too
est profile --json               # the whole table
```

It renders the conformance run's signal (an effect: tones, noise bursts, silence and clicks with every parameter swept; an instrument: the bursts of notes and the held note) on a **profiling build** of the metered module: the same meter Cyber installs with, rewriting the same points with the same charges, plus a fuel counter and a call counter for each function. The counters cost no fuel, so the profiled build spends exactly the fuel of the module Cyber installs, and the table adds up to it. The profiling build is made in `est profile` and never anywhere else: Cyber never installs one (its meter refuses a module carrying the counters).

For each function, the most first:

- **fuel/block**: the fuel the function spent a block, its own work only (a function entry or a loop header charges its body's weighted instructions; what it calls is counted on the callee);
- **share**: its part of all the fuel the blocks spent;
- **calls/block**: how often it was entered a block (`1.00` is `process`; a function called once a sample shows 128);
- **~µs**: its share of the block's measured time on this machine, an estimate (fuel over-estimates time: the branch not taken is charged too).

The head of the report gives the block's mean fuel, its mean time on this machine (`est validate`'s number, measured on the plain module) and the budget, and the end says what the numbers mean in `EST-P001`'s words.

**Names.** A function shows by the name the build kept in the module's name section, else as `function <index>` (its index in the module, imports first). A release build usually strips the names: for a profiling build keep them (AssemblyScript: `asc --debug`; Rust: `strip = false` in `[profile.release]`; clang: `-g`). Rust's symbols are demangled (`est::instrument::iglue::process::<est_synth::Synth>`). Profile the build you ship, too: the numbers are the same code either way, only the names differ.

On EST Synth, the reference instrument, the per-sample loop over the voices (`Synth::process`, inlined into the glue's `process`) is about 92 % of the block, called once a block; the voices' filter coefficients (`Synth::control`, about 30 calls a block) and `exp` share most of the rest. That is the shape to look for: one hot loop, and what it calls more often than it needs to.

## `--ui-preview`: a UI before its DSP

`est dev <folder> --ui-preview params.json` serves the folder's `ui/` (with `est-ui.js` copied in when the page names it) against the parameters in the file, a list of `{ id, name, module, min, max, def, flags, value }` as `est:init` carries them (add `"scale": "log"` to a parameter to preview a log knob). No module runs; the generated UI, the parameter list, the custom UI and its `ui` lines all work. The frame's size comes from the folder's `est.json` if it has one (else 660 × 480).

## Following from Cyber: `est dev --cyber`

`est dev --cyber` lets **Cyber itself** follow your build, so you hear each rebuild in a real project while it plays. Who may: an admin of the Cyber you use, or a **verified developer**: a Cyber developer account (Settings → Plugins → Become a developer) with a registered key and at least one published plugin (see [publishing](publishing.md)). Until the owner of a Cyber opens developer accounts there, only its admins can.

```sh
est dev --cyber                         # Cyber's live site may follow
est dev --cyber http://localhost:5174   # a local Cyber (give --cyber again for both)
```

It prints the steps and a link:

1. Sign in to Cyber as an admin or a verified developer.
2. Open **your own** project. Follow never reloads into a live session or a project someone else shared with you: a build is installed there but waits (*Held*) until you are back in a project of yours.
3. Settings → Plugins → **Developer tools**: turn on Developer mode, then **Follow est dev**, with the files origin `est dev` printed (`http://localhost:4431` by default). Only `http://localhost:<port>` or `http://127.0.0.1:<port>` is accepted. The page reloads once: Cyber's page policy names that origin for your account only, from the next page on, and only while Follow is on.

The link (`https://cyber-audio.fly.dev/?est-follow=http%3A%2F%2Flocalhost%3A4431`) opens that page with the address filled in; it never turns Follow on by itself.

Then, on every good build:

- Cyber fetches the bundle from `est dev` and **installs it through its own pipeline**: read, checked against the hash `est dev` named, metered, validated and compiled, exactly as any install. A build it refuses shows the rule it broke, and the last good build keeps playing.
- Every insert and instrument on that plugin id moves to the new build **while the project plays**: an insert's old instance keeps sounding until the new one is ready (made from the state saved for it), the new one runs unheard for 50 ms, then they crossfade in 20 ms; in the release's test a held tone through the plugin never left its level over the swap (0 windows off by more than 0.75 dB, worst 0.01 dB; before 1.325 the insert played dry for about 35 ms). An instrument's held notes are released on the old instance (their own release) and ring out for at most 1.5 s; the notes you play next go to the new one. The plugin's own UI reloads in its window.
- The builds before it are removed once nothing in the song names them.

`est dev` says when Cyber attaches (`Cyber attached from https://cyber-audio.fly.dev (following the build stream).`); with `--json`, a line `{"type":"cyber","event":"attached","origin":"…","via":"events"}` (or `"poll"`).

**What a site can see.** `est dev --cyber` answers CORS only for the Cyber origins you named (`--cyber`, `--cyber <origin>`), so no other site can read your builds. A site in that list can see that `est dev` is running on your machine while it runs; stop `est dev` when you are done. In Cyber, the Developer tools also have a **State inspector**: what the song saved for each insert or instrument on one of your bundles, as hex, with its parameters.

## What it does not do

It plays one plugin at a time. It never reloads into a Cyber live session or another person's project (above). There is no JavaScript DSP path, not even for prototyping.
