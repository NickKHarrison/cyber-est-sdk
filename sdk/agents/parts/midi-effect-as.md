<!--
title: an EST note effect in AssemblyScript
lang: as
kinds: effect,notes
source: assembly/index.ts
-->
# An EST note effect in AssemblyScript

This folder is an EST plugin: a WebAssembly note effect (notes in, notes out) that Cyber installs from a `.est` bundle. It starts as an arpeggiator that follows the song's tempo and a chord memory that plays a learned chord from each key; you change it into the plugin described under **What to build**. AssemblyScript is TypeScript's syntax compiled straight to WebAssembly, with no other toolchain.

<!-- include: idea -->

## This template: notes in, notes out

A note effect is an effect (`"kind": "effect"`, audio passed through) with a note input and a **note output**: `"notes": { "inputs": 1, "outputs": 1 }` in `est.json`, `"note-effect"` in its features, and `Descriptor(…).noteEffect()` in the code. Notes arrive at their sample; it sends notes with `io.sendNoteOn(id, channel, key, velocity, n)` and `io.sendNoteOff`, each at a sample of the block.

- **Every note it starts it ends**: when the key is let go, when the mode changes, on a choke. The golden test counts them.
- The held keys and the chords are fixed arrays: nothing allocates while playing.
- `npx est dev` shows a keyboard; `npx est test` compares the notes it sends with `test/golden-notes.json`.

**What Cyber does with the notes today:** it runs a note effect as an insert (the audio passes through) and reports the notes it sends; whether they reach the next plugin on the track depends on the host's EST version. Build and test it now.

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. |
| `assembly/index.ts` | The plugin: the export block, `describe()`, `parameters()` and one class extending `Effect`. |
| `test/golden-notes.json` | The notes the golden render must send, compared exactly. |
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

<!-- include: song -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: window-none -->

<!-- include: install -->
