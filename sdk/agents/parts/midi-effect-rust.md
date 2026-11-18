<!--
title: an EST note effect in Rust
lang: rust
kinds: effect,notes
source: src/lib.rs
-->
# An EST note effect in Rust

This folder is an EST plugin: a WebAssembly note effect (notes in, notes out) that Cyber installs from a `.est` bundle. It starts as an arpeggiator that follows the song's tempo and a chord memory that plays a learned chord from each key; you change it into the plugin described under **What to build**.

<!-- include: idea -->

## This template: notes in, notes out

A note effect is an effect (`"kind": "effect"`, audio passed through) with a note input and a **note output**: `"notes": { "inputs": 1, "outputs": 1 }` in `est.json`, `"note-effect"` in its features, and est::export_note_effect! in the code. Notes arrive at their sample; it sends notes with `io.send_note_on(id, channel, key, velocity, n)` and `io.send_note_off`, each at a sample of the block.

- **Every note it starts it ends**: when the key is let go, when the mode changes, on a choke. The golden test counts them.
- The held keys and the chords are fixed arrays: nothing allocates while playing.
- `npx est dev` shows a keyboard; `npx est test` compares the notes it sends with `test/golden-notes.json`.

**What Cyber does with the notes today:** it runs a note effect as an insert (the audio passes through) and reports the notes it sends; whether they reach the next plugin on the track depends on the host's EST version. Build and test it now.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `src/lib.rs` | The plugin: one `impl Effect` and one `est::export_note_effect!`. |
| `test/golden-notes.json` | The notes the golden render must send, compared exactly. |
| `Cargo.toml` | The crate; `[package.metadata.est]` tells `est` how to build it. |
| `.cargo/config.toml` | The target (`wasm32-unknown-unknown`) and the link flags. Change only `--max-memory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The kit's crate `est`, copied in (a path dependency): read it for exact signatures, do not edit it. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

<!-- include: loop -->

<!-- include: rules -->

<!-- include: write-rust -->

<!-- include: library-rust -->

<!-- include: costs -->

<!-- include: song -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: window-none -->

<!-- include: install -->
