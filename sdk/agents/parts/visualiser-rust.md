<!--
title: an EST plugin with a window that draws, in Rust
lang: rust
kinds: effect
source: src/lib.rs
-->
# An EST plugin with a window that draws, in Rust

This folder is an EST plugin: a WebAssembly audio effect with its own page that Cyber installs from a `.est` bundle. It starts as a pass-through with a smoothed trim, and a page (`ui/`) that draws the level after it on a canvas; you change it into the plugin described under **What to build**.

<!-- include: idea -->

## This template: a window that reacts to sound

The page never sees samples. The host sends `est:meter { in, out }` at most 30 times a second while the window is open: the strip's levels, linear peaks `[left, right]`. `ui/ui.js` keeps their history and draws it in one `requestAnimationFrame` loop; `est.meters` is false on a host that sends none, and the page says so. History is a parameter only so that it saves with the project.

- `ui/index.html` loads `est-ui.js` (copied in by `npx est pack`: do not add it) and then `ui.js`, both as files; `est.json`'s `"ui"` names the page and its fixed size.
- A page may load scripts, CSS, images and fonts that are files of the bundle: no inline script, nothing from another host, no `fetch` (the `EST-U` rules).
- `npx est dev` shows the page beside the generated knobs, with live meters.
- **It cannot draw a spectrum from the plugin's own analysis**: the DSP has no channel to the page. Only what the host sends reaches it.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `src/lib.rs` | The plugin: one `impl Effect` and one `est::export_effect!`. |
| `ui/index.html`, `ui/ui.js`, `ui/style.css` | The page: a canvas, a readout and two knobs; the script draws from `est.onMeter`. |
| `Cargo.toml` | The crate; `[package.metadata.est]` tells `est` how to build it. |
| `.cargo/config.toml` | The target (`wasm32-unknown-unknown`) and the link flags. Change only `--max-memory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `est/` | The kit's crate `est`, copied in (a path dependency): read it for exact signatures, do not edit it. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

<!-- include: loop -->

<!-- include: rules -->

<!-- include: write-rust -->

<!-- include: library-rust -->

<!-- include: costs -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: install -->
