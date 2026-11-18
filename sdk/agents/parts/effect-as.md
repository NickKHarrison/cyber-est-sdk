<!--
title: an EST effect in AssemblyScript
lang: as
kinds: effect
source: assembly/index.ts
-->
# An EST effect in AssemblyScript

This folder is an EST plugin: a WebAssembly audio effect that Cyber installs from a `.est` bundle. It starts as a smoothed gain into a resonant filter; you change it into the plugin described under **What to build**. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly, with no other toolchain.

<!-- include: idea -->

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()` and one class extending `Effect`. |
| `asconfig.json` | The compiler's options and how `est` builds it. Change only `maximumMemory`, with `est.json`'s limit. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `est/` | The kit's library, copied in: read it for exact signatures, do not edit it. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

<!-- include: loop -->

<!-- include: rules -->

<!-- include: write-as -->

<!-- include: library-as -->

<!-- include: costs -->

<!-- include: song -->

<!-- include: ringing -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: window-short -->

<!-- include: install -->
