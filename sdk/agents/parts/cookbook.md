<!--
title: an EST plugin from the cookbook (AssemblyScript)
lang: as
kinds: effect,instrument,notes
source: assembly/index.ts
-->
# An EST plugin from the cookbook (AssemblyScript)

This folder was made by `est new <recipe>` from one of the kit's cookbook recipes: a small, tested EST plugin in AssemblyScript that Cyber installs from a `.est` bundle. `README.md` says what this recipe does and how it works. You change it into the plugin described under **What to build**.

<!-- include: idea -->

## The files

| File | What |
|---|---|
| `README.md` | The recipe: what it does, how, and what to try next. |
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `assembly/index.ts` | The plugin. |
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

<!-- include: window-none -->

<!-- include: install -->
