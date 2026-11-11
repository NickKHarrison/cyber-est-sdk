# For coding agents

You can make an EST plugin from start to finish with the `est` command and the files below; nothing needs a screen and nothing needs Cyber's source. Each template's `AGENTS.md` says the same for that template. A first plugin from npm alone, start to finish, with the code inline: [Build an EST plugin](BUILD_AN_EST_PLUGIN.md).

`est` is the npm package `@cyber-est/cli` (D-50; 0.1.0 is built but not yet published): in a plugin folder, `npm install --save-dev --save-exact @cyber-est/cli@0.1.0` once, then `npx est <command>`; outside such a folder `npx @cyber-est/cli <command>`. **Never a bare `npx est` where the kit is not installed: it fetches npm's unrelated `est` package.** `est validate <dir>` runs that folder's own build (its `cargo`, or its `node_modules/.bin/asc`) before checking anything, so validate only folders whose build you trust; Cyber and its server check only `.est` bytes. From a clone of Cyber's repository instead: `node <cyber>/sdk/packages/cli/bin/est.mjs <command>` from any folder, or `npm run est -- <command>` at the clone's root, after `npm ci` there once. An alias saves typing: at the clone's root, `alias est="node $PWD/sdk/packages/cli/bin/est.mjs"`. Work in a folder of your own, outside the clone: `est new` copies the SDK's library into it (`est/`), so it builds on its own.

## The loop

1. `est new <template> <dir> --id <reverse.dns.id> --name "<Name>"` (templates: `effect-rust`, `instrument-rust`, `effect-as`, `instrument-as`, and since 1.321 `sampler-*`, `midi-effect-*` and `visualiser-*` in both languages, [templates.md](templates.md); or a cookbook recipe by its name, [cookbook.md](cookbook.md); add `--ui` for a custom UI to start from). Use Rust unless there is no Rust toolchain (`est doctor` says), then AssemblyScript. To port C++, `cpp-clap` ([porting-cpp.md](porting-cpp.md); `est compare` checks a port against the original). The folder holds everything you need to read: its `AGENTS.md`, `llms.txt`, the library's source in `est/`, the schema, the rules table and the ABI as JSON.
2. Write the DSP: declare the parameters, size buffers in `activate`, process in `render`. Keep the parameters' ids, names and units in `est.json`'s `parameters` in step with the DSP, and `test/golden.json`'s events (they name parameters by id) in step with the parameters.
3. `est validate --json` (or `est validate`): it builds and packs first, then runs every check Cyber's install runs. Read **`dist/validation.json`**. Every failed check has `rule`, `message`, `fix` and `where`; look the rule up in [validator-rules.md](validator-rules.md). Fix, and repeat until `"ok": true`.
4. Listen and look (Playwright's Chromium, an optional peer: `npm install --save-dev --save-exact @playwright/test@1.64.1 && npx playwright install chromium` in the plugin folder, or once at the clone's root; `est doctor` says): `est dev --json --play 60,64,67` (an instrument) or `est dev --json --seconds 3 < /dev/null` (an effect, a sine in) prints meters and events as JSON lines. Pipe commands in, one JSON object a line: they run in order, each after the one before has finished (`{"cmd":"param","id":…,"value":…}`, `{"cmd":"wait","ms":500}`, `{"cmd":"state"}` …), and without `--seconds` the run ends a second after the last ([dev-host.md](dev-host.md)). A plugin that validates but whose meters stay `null` is silent: check the output and the gain staging. If a port is taken, add `--port 0 --files-port 0`.
5. A UI: a page in `ui/` using `@cyber-est/ui` ([ui.md](ui.md), or `est new … --ui`; a whole web app as the window, with its state in hidden and read-only parameters, is the section "A whole app as the window" there); `est dev --json` prints `ui` lines for it: its load, `est:ready`, every message the host refused and why, its console errors, uncaught errors and files that did not load (or `est dev --ui-preview params.json` before the DSP works).
6. `est test`: the golden render in `test/` and the conformance run again; it exits 1 if any check fails. After changing the sound on purpose, `est test --update`, then listen.
   When `est validate` warns `EST-P001` (a block over the budget), run `est profile --json` before changing anything: it lists the functions by their fuel, share of the block and calls a block ([dev-host.md](dev-host.md#profiling-est-profile)); fix the top function first.
7. `est pack` (or the last `est validate`): `dist/<id>-<version>.est`, the file Cyber's developer mode loads (**Settings → Plugins → Developer mode → Load a bundle file…**).

## The files to read

| File | What it tells you |
|---|---|
| the template's `AGENTS.md` | its layout, its commands, its rules |
| `est/` in your folder | the library's source: the exact signatures ([dsp-library.md](dsp-library.md) is the map) |
| `validation.json` | what failed, why, and the fix |
| [manifest.md](manifest.md), `est-manifest-1.schema.json` | every `est.json` field |
| [validator-rules.md](validator-rules.md), `est-validator-rules.json` | every rule id |
| [dsp-library.md](dsp-library.md) | the blocks |
| `est-abi-1.0.json` and `est-abi-1.1.json` in your folder | the ABI's struct layout, for EST 1.0 and 1.1 (only for a plugin written without the SDK's runtime) |
| `est-ui.d.ts` in your folder | the UI library's types |

## The limits

- **No allocation in `render`, `process`, the parameter hook or the note handlers.** Rust: heap memory only in `activate` (`new` builds the plugin by value); AssemblyScript: only in the constructor and field initialisers, or `activate`.
- **Deterministic**: no clock and no random numbers in `process`.
- **Memory**: the module's declared maximum must not exceed `limits.memoryPagesMax` in `est.json` (64 KiB pages; at most 2048).
- **One thread**, and the WebAssembly features listed in [porting-clap.md](porting-clap.md#what-est-refuses).
- **A block is 128 frames**; a block's mean cost is reported (`EST-P` rules) and is a warning only for now.
- **The UI**: files in the bundle only, scripts as files (no inline script), the frame protocol version 2 (parameters and gestures; the sample rate, Cyber's theme, the strip's meters, and a resize when `ui.resizable`; version 1 to an older host).
- **A shipped version never changes**: bump `version` for every change you hand to anyone.

## Things that are easy to get wrong

- the parameter ids in the DSP, in `est.json`, in `test/golden.json`'s events and in the UI must be the same numbers;
- the descriptor's id must be `est.json`'s `id` exactly (`EST-C001`); the other identity fields are not compared ([concepts](concepts.md#identity-what-must-match-estjson));
- the state magic is part of every saved state: never change it once a version has shipped ([concepts](concepts.md#state));
- validate's `peak` is the stress run's worst case, not the sound at the defaults ([getting started](getting-started.md#4-validate));
- an instrument needs `"notes": { "inputs": 1 }` and `"features": ["instrument", …]`; an effect's first feature is `"audio-effect"`;
- a state that does not load back into the same parameters fails the round trip (`EST-C…`): save every parameter (the default does) and version your blob;
- a UI page's `<script src>` names files in `ui/`; `est-ui.js` is copied in by `est pack`, so do not add it to the folder.
