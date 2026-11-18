<!--
title: an EST sampler in AssemblyScript
lang: as
kinds: instrument,notes
source: assembly/index.ts
-->
# An EST sampler in AssemblyScript

This folder is an EST plugin: a WebAssembly instrument that Cyber installs from a `.est` bundle. It starts as three samples (two velocity layers of a pluck, a looped drone) played from notes with pitch, a one-shot or loop mode and an ADSR, eight voices; you change it into the plugin described under **What to build**. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly, with no other toolchain.

<!-- include: idea -->

## This template: samples in the module

An EST module reads no file while it plays, so a sampler's samples travel **inside the module**, as data:

1. Put 16-bit PCM mono WAVs in `assets/`.
2. Map them in `samples.json`: `{ "file": "assets/kick.wav", "root": 36, "keys": [36, 36], "velocity": [0, 1] }`. Two entries on the same keys with different `velocity` ranges are velocity layers; `"loop": [start, end]` (frames) is what the Loop mode repeats. The first entry that matches a note plays it.
3. `node tools/embed-samples.mjs` writes `assembly/samples.ts`; then validate as always (`--check` says whether it is up to date).

Keep the samples small: they count against `limits.memoryPagesMax` (raise it, and `asconfig.json`'s `maximumMemory`, past about 600 KB of samples). A note with no matching sample ends at once.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()`, a voice class and one class extending `Instrument`. |
| `samples.json` | Which WAV plays which notes: file, root key, key range, velocity range, loop points. |
| `assets/*.wav` | The samples: 16-bit PCM mono, at any rate. |
| `tools/embed-samples.mjs` | Writes the samples into the source (`assembly/samples.ts`): run it after changing `samples.json` or a WAV. |
| `assembly/samples.ts` | Generated: do not edit it. |
| `asconfig.json` | The compiler's options and how `est` builds it. Change only `maximumMemory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: notes and events, and what the plugin must output. |
| `est/` | The kit's library, copied in: read it for exact signatures, do not edit it. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

<!-- include: loop -->

<!-- include: rules -->

<!-- include: write-as -->

<!-- include: library-as -->

<!-- include: costs -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: window-none -->

<!-- include: install -->
