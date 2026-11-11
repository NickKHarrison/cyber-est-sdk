# Porting a CLAP plugin

EST is CLAP 1.2 in WebAssembly's shape (the WCLAP module layout): a module that exports `clap_entry` and a growable function table, built for `wasm32-unknown-unknown`. A CLAP plugin's audio code ports almost unchanged; what changes is around it.

## What carries over

- the plugin factory, the descriptor, `init`, `activate` / `deactivate`, `start_processing` / `stop_processing`, `process`;
- events: notes with ids, note expressions, parameter values, MIDI, the transport, in the same structs (`clap/events.h`);
- extensions the host implements: parameters, state, audio ports, note ports, latency, tail, render (offline), and the host's thread check (one thread: see below);
- the pinned layout of every struct the host touches is `est-abi-1.0.json` (with `est-abi-1.1.json` for EST 1.1, both in every folder `est new` makes), generated from CLAP's own headers.

## What EST adds

- **`est.json`**, the manifest ([reference](manifest.md)), and the bundle format: one stored ZIP, content-hashed.
- **Metering**: Cyber rewrites the module at install to count fuel, so a call that never returns traps. Nothing to do on your side, but a loop with no exit is a crash, not a hang.
- **The conformance run** at install, and the same checks in `est validate` ([the rules](validator-rules.md)).
- **A UI as a web page** in a sandboxed frame, speaking the frame protocol ([`@cyber-est/ui`](ui.md)), instead of CLAP's GUI extension.

## What EST refuses

- **Threads**: one thread. Every CLAP "main-thread" call runs on the audio thread, between blocks; no `thread-pool`, no shared memory, no atomics (the meter refuses them).
- **Imports** beyond the host's callbacks and a small WASI subset: no file system, no sockets, no environment. Load samples from the bundle, through state or presets.
- **Your own GUI** (`clap.gui`): the UI is a page.
- **Memory without a maximum**, or a maximum above `limits.memoryPagesMax` (at most 2048 pages, 128 MiB).
- **WebAssembly features** the meter does not know: relaxed SIMD, atomics, exceptions, GC, tail calls. Fixed-width SIMD is fine.
- **A non-deterministic `process`** (reading the clock or random numbers): the validator renders twice.

## Building

From Rust with a CLAP crate: build for `wasm32-unknown-unknown` with the linker flags the template's `.cargo/config.toml` sets (`--export-table`, `--growable-table`, a 64 KiB stack, the memory's initial size and maximum). From C or C++: `est new cpp-clap` (since 1.326), a CLAP plugin in C++ that `est` builds with clang to wasm32 and the right flags, with a freestanding runtime (`<est/runtime.hpp>`: memory, `new`, the maths) instead of libc; [porting-cpp.md](porting-cpp.md) has the toolchain, the flags, what breaks and `est compare`, and [porting-juce.md](porting-juce.md) a JUCE plugin's route.

The quickest route is often to start from the template and move your DSP into it: the SDK's runtime writes the CLAP side for you.

## EST 1.1: what a CLAP port gains (Cyber 1.327)

With `"abi": { "est": "1.1", "clap": "1.2" }` more of a desktop CLAP plugin carries over as it is:

| CLAP | EST 1.1 |
|---|---|
| A second (aux) audio input port | A sidechain: `"inputs": [{ "channels": 2 }, { "role": "sidechain", "channels": 2 }]`; Cyber keys it from a track or a return |
| A main port of up to 8 channels (`clap.surround`'s channel map optional) | An instrument's pairs on output strips; an effect's past two summed into a stereo strip |
| A note output port, `out_events` notes and MIDI | Sent to the next plugin on the track with a note input (live) |
| `CLAP_PARAM_IS_MODULATABLE`, `CLAP_EVENT_PARAM_MOD` | `"modulatable": true` in est.json; a clip envelope's modulation (non-destructive, 0 on Stop) |
| Presets with artwork | `presets/index.json`'s `image` (WebP, 64 KiB) and `author` |

Still not in 1.1: per-note and per-key modulation (`CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID` is in the table, but Cyber sends `note_id` −1), more than one sidechain, more than one main output port, and recording a note output as MIDI.

