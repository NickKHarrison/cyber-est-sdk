<!--
title: an EST instrument in Rust
lang: rust
kinds: instrument,notes
source: src/lib.rs
-->
# An EST instrument in Rust

This folder is an EST plugin: a WebAssembly instrument that Cyber installs from a `.est` bundle. It starts as four voices of a band-limited saw into a resonant low-pass, each shaped by an ADSR; you change it into the plugin described under **What to build**.

<!-- include: idea -->

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `src/lib.rs` | The plugin: one `impl Instrument`, a voice and one `est::export_instrument!`. |
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

<!-- include: window-short -->

<!-- include: install -->
