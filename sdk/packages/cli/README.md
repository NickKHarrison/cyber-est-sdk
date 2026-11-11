# @cyber-est/cli

`est`: make, validate, play and pack **EST plugins** for [Cyber](https://cyber-audio.fly.dev), the browser audio workstation. An EST plugin's DSP is a WebAssembly module in a sandbox; its UI, if it has one, is a web page in a sandboxed frame. A plugin is one file, a `.est` bundle.

Node 20 or newer. MIT.

New to this, or working with a chat assistant? `BUILD_AN_EST_PLUGIN.md` in this package goes from nothing to a working effect, the code inline, with a block to paste into your assistant.

## The loop

```
npx @cyber-est/cli new effect-as my-chorus --id com.example.my-chorus --name "My Chorus"
cd my-chorus
npm install --save-dev --save-exact @cyber-est/cli@0.1.0   # once: est and asc in this folder
npx est doctor     # what is missing, with the command that installs it
npx est dev        # play it at http://localhost:4430; it rebuilds on save
npx est validate   # builds, packs and runs every check Cyber's install runs: dist/validation.json
npx est pack       # dist/com.example.my-chorus-1.0.0.est
```

Run `npx est` only in a folder where `@cyber-est/cli` is installed (the `npm install` line above). Elsewhere, write `npx @cyber-est/cli <command>`: a bare `npx est` in a folder without it would fetch npm's unrelated package called `est`.

The templates: `effect-as` and `instrument-as` (AssemblyScript, nothing else to install), `effect-rust` and `instrument-rust` (Rust: `est doctor` names `rustup` and the `wasm32-unknown-unknown` target). Add `--ui` for a custom UI.

`est validate <dir>` runs that folder's own build (its `cargo` or its `node_modules/.bin/asc`) before it checks anything: validate only folders whose build you trust. Cyber itself checks only the `.est` bytes.

`est dev --json` (the dev host without a screen, for a coding agent) needs Playwright's Chromium, an optional peer: `npm install --save-dev --save-exact @playwright/test@1.64.1 && npx playwright install chromium`.

`est version` prints the oldest Cyber this kit's bundles are for.

## More

The developer kit's documentation (getting started, concepts, the dev host, the UI library, the DSP library, the manifest, the validator's rules, porting a CLAP plugin, for coding agents) is in `sdk/docs/` of Cyber's repository, and each new plugin folder carries an `AGENTS.md`.
