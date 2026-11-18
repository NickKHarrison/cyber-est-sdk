<!--
title: an EST effect in C++ (CLAP)
lang: cpp
kinds: effect
source: src/plugin.cpp
-->
# An EST effect in C++ (CLAP)

This folder is an EST plugin written as a CLAP plugin in C++: a WebAssembly audio effect that Cyber installs from a `.est` bundle. It starts as a smoothed gain; you change it into the plugin described under **What to build**. It is also the starting point for porting a C++ plugin (a CLAP one, or the DSP of one in another format).

<!-- include: idea -->

## The files

| File | What |
|---|---|
| `est.json` | The manifest: id, name, version, kind, ports, limits and the parameter list. The **only** file that names the plugin. |
| `src/gain.hpp` | The DSP: plain C++. Replace it with yours. |
| `src/plugin.cpp` | The CLAP side: entry, factory, descriptor, `kParams`, process, parameters, state, ports. |
| `est-build.json` | How `est` builds it: sources, include folders, defines, the C++ standard. |
| `test/golden.json`, `test/golden.f32` | The golden render: an input and events, and what the plugin must output. |
| `package.json` | The kit, pinned, and `npm run validate`, `test`, `dev` and `pack`. |
| `est-validator-rules.json`, `est-manifest-1.schema.json`, `est-abi-1.*.json`, `est-ui.d.ts` | The rules, the schema, the ABI and the window library's types. |

<!-- include: loop -->

<!-- include: rules -->

<!-- include: write-cpp -->

<!-- include: library-cpp -->

<!-- include: costs -->

<!-- include: song -->

<!-- include: ringing -->

<!-- include: traps -->

<!-- include: hear -->

<!-- include: window-none -->

<!-- include: install -->
