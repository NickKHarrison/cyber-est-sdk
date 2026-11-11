# The EST developer kit

EST is how a plugin runs in [Cyber](https://cyber-audio.fly.dev): its DSP is a WebAssembly module in a sandbox, and its UI, if it has one, is a web page in a sandboxed frame on a second origin. A plugin is one file, a `.est` bundle. This kit takes you from an empty folder to a bundle that validates and that Cyber installs.

Everything here is MIT. It is packaged for npm as `@cyber-est/cli`, `@cyber-est/tools` and `@cyber-est/ui` (D-50, 1.319), and its source is public in [NickKHarrison/cyber-est-sdk](https://github.com/NickKHarrison/cyber-est-sdk), a mirror of Cyber's repository (1.403), from which the packages are published with npm provenance.

**Install from npm** (Node 20 or newer). This is the way in:

```
npx @cyber-est/cli new effect-as my-chorus --id com.example.my-chorus --name "My Chorus"
cd my-chorus && npm install --save-dev --save-exact @cyber-est/cli
npx est doctor
```

(The first release, 0.1.0, is built and checked; until the owner publishes it, `npx @cyber-est/cli` finds nothing and the clone below is the way.) In a folder with the kit installed `npx est` is the command; anywhere else write `npx @cyber-est/cli`, because a bare `npx est` fetches npm's unrelated package called `est`. `est validate <dir>` runs that folder's own build (`cargo`, or its `node_modules/.bin/asc`) before it checks anything, so validating a cloned repository runs its build: validate only folders you trust (Cyber and its server check only `.est` bytes).

**Or from a clone**, to work on the kit itself or before the first release, once, at the clone's root (the public repository, or Cyber's own: the paths are the same):

```
git clone https://github.com/NickKHarrison/cyber-est-sdk && cd cyber-est-sdk
npm ci
alias est="node $PWD/sdk/packages/cli/bin/est.mjs"
```

Then `est` works in any folder, including a plugin's outside the clone (`npm run est -- <command>` at the root is the same command). Nothing else is installed: a plugin's folder holds its own copy of the DSP library, Rust needs `rustup target add wasm32-unknown-unknown`, and C++ a clang with the wasm32 target and `wasm-ld` (`est doctor` says what is missing).

How the packages are built, checked, mirrored and (by the owner, from the public repository's CI only) published: `scripts/sdk-build.mjs`, `scripts/sdk-smoke.sh`, `scripts/sdk-export.mjs`, `scripts/sdk-publish.mjs`, and `Cyber_Deploy_Web_Runbook.md` §6e.

## What is in it

| Part | Where | What it does |
|---|---|---|
| The `est` command (`@cyber-est/cli`) | `sdk/packages/cli` | `est new`, `est validate`, `est pack`, `est test`, `est doctor`, `est inspect`, `est dev`, `est compare` |
| The validator | `sdk/packages/tools` (`@cyber-est/tools`) | the same code as Cyber's install check, with a stable id for every rule |
| The templates | `sdk/templates/` | `effect-rust`, `instrument-rust` (the default), `effect-as`, `instrument-as` (AssemblyScript: no native toolchain), `cpp-clap` (a CLAP plugin in C++, for porting); since 1.321 `sampler-*`, `midi-effect-*` and `visualiser-*` in both languages ([which to start from](docs/templates.md)) |
| The cookbook | `sdk/cookbook/` | ten short tested AssemblyScript plugins, one idea each, with a prompt to take it further ([the cookbook](docs/cookbook.md)); `est new <recipe> <dir>` starts from one |
| The C and C++ kit | `sdk/cpp` | the build `est` runs for C and C++ (clang to wasm32), the CLAP 1.2.2 headers and the freestanding runtime `<est/runtime.hpp>` |
| The porting kits | `sdk/kits/` | `juce-shared-dsp`: one source tree building a JUCE plugin and an EST plugin from one DSP header |
| `llms.txt` | `sdk/llms.txt` | the kit's index for a coding agent: the docs, the templates and the recipes |
| The DSP library | `sdk/rust/est`, `sdk/as/est` | smoothers, oscillators, filters, envelopes, LFOs, voices, delay lines, biquads, in both languages |
| `@cyber-est/ui` | `sdk/packages/ui` | the library for a plugin's own UI: the frame protocol, `bind()`, `<est-knob>`, `<est-slider>` |
| The dev host | `sdk/devhost` (`est dev`) | a page that plays your plugin in Cyber's own runtime while you build it |
| The docs | `sdk/docs/` | this set |

## Start here

New to plugins, or working with a chat assistant? **[Build an EST plugin](docs/BUILD_AN_EST_PLUGIN.md)** goes from nothing to a working effect with npm alone, the code inline, and a block to paste into your assistant. Then the **[prompt kit](docs/PROMPT_KIT.md)** has a ready-to-paste prompt for every template and recipe and the usual follow-ups, and **[Sharing](docs/SHARING.md)** says how to hear your plugin in Cyber, put it in a song and post a listen link.

1. [Getting started](docs/getting-started.md): ten minutes to a running gain, in Rust or AssemblyScript.
2. [Which template to start from](docs/templates.md), and [the cookbook](docs/cookbook.md): ten tested recipes.
3. [Concepts](docs/concepts.md): blocks, events, parameters, state, and the sandbox and why.
4. [The dev host](docs/dev-host.md): `est dev`, and `est dev --json` for an agent without a screen.
5. [The UI library](docs/ui.md): `@cyber-est/ui` for a plugin's own interface.
6. [The DSP library](docs/dsp-library.md): the blocks, in Rust and in AssemblyScript.
7. [The manifest](docs/manifest.md) (generated from the schema) and [the validator's rules](docs/validator-rules.md) (generated from the rules table).
8. [Porting a CLAP plugin](docs/porting-clap.md): what EST adds and what it refuses. [Porting a C++ plugin](docs/porting-cpp.md): `cpp-clap`, the toolchain, what breaks, and `est compare`. [Porting a JUCE plugin](docs/porting-juce.md): one source tree, two builds.
9. [For coding agents](docs/for-agents.md): the loop, the files, the limits.
10. [Vibe coding a plugin](docs/vibe-coding-guide.md): the whole path for a first-time or agent-assisted developer, and for porting a VST, AU, JUCE or CLAP plugin.
11. [Publishing](docs/publishing.md): developer accounts, your key, `est login` and `est publish`.
12. [The Plugin Studio](docs/plugin-studio.md): Cyber's browser-only path from a description to an installed plugin (built, not open yet).

## The loop

```
est new effect-rust ~/plugins/my-chorus --id org.example.my-chorus --name "My Chorus"   # --ui: with a custom UI
cd ~/plugins/my-chorus
est dev            # play it at http://localhost:4430 while you edit; it rebuilds on save
est validate       # builds, packs, runs every check Cyber's install runs; writes dist/validation.json
est test           # the golden render in test/ and the conformance run
est pack           # dist/org.example.my-chorus-1.0.0.est
est compare old.est dist/org.example.my-chorus-1.0.0.est   # what changed in the sound
```

Then, in Cyber: **Settings → Plugins**, turn on **Developer mode**, then **Load a bundle file…** and pick the `.est`. Developer mode is an admin's and a verified developer's while developer accounts are open (1.325); every signed-in account installs Cyber's curated plugins. Cyber runs the same checks; a refusal names the same rule id (`EST-…`) as `validation.json`. Developer mode's **Follow `est dev`** (1.287, with `est dev --cyber`) plays the plugin `est dev` is building in your own project and swaps each rebuild in while it plays ([the dev host](docs/dev-host.md#following-from-cyber-est-dev---cyber)).

`est help` lists the commands you run; `keygen`, `sign` without `--developer` and `publish` without a file are Cyber's own registry's (the owner's key, from a clone), listed apart.

## What is not here yet

Cyber's own registry (1.305, Phase 5b) is signed and published by Cyber with `est keygen`, `est sign` and `est publish` (the owner's key; `docs/est/EST_REGISTRY_RUNBOOK.md`). Publishing your own plugins (`est login`, `est publish <file.est>`, `est yank`; [publishing](docs/publishing.md)) is built (1.322) but waits for developer accounts and Community to open on Cyber. The UI protocol is version 3 (1.327: parameters and gestures; the sample rate, the host's theme, meters and resizing; a coarse spectrum for a bundle with `ui.audio`). C++ is here since 1.326 (`cpp-clap`, `sdk/kits/juce-shared-dsp`); Faust and Cmajor templates come later (D-39).
