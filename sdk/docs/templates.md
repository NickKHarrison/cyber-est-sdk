# Which template to start from

`est new <template> <folder>` copies a template, renamed to your id and name, with the SDK's code it uses, so the folder stands alone. There are five kinds, each in Rust and in AssemblyScript (`-as`: TypeScript's syntax, no native toolchain). The two languages render the same samples: the SDK's tests compare each pair.

| You want | Start from | It starts as |
|---|---|---|
| An audio effect | `effect-rust`, `effect-as` | a smoothed gain into a resonant filter |
| A synthesizer | `instrument-rust` (the default), `instrument-as` | four voices of a saw through a low-pass and an ADSR |
| A sampler or a drum kit from your own sounds | `sampler-rust`, `sampler-as` | WAVs in `assets/`, mapped in `samples.json` to keys and velocity layers, one-shot or looped, with an ADSR |
| Something that plays notes (an arpeggiator, a chord tool, a sequencer) | `midi-effect-rust`, `midi-effect-as` | an arpeggiator synced to the tempo, and a chord memory |
| A meter or a visualiser: a plugin whose point is its page | `visualiser-rust`, `visualiser-as` | audio through, and a canvas drawing the level after it from the host's meters |

Smaller starting points for one idea each (a compressor, a chorus, a reverb, a drum synth …) are in [the cookbook](cookbook.md); `est new` takes their names too.

## What each new kind shows

**The sampler: samples in the module.** An EST module imports nothing and reads no file at run time, so a sampler's samples travel inside `module.wasm` as data; nothing is fetched while it plays. Put 16-bit PCM mono WAVs in `assets/`, map them in `samples.json` (root key, key range, velocity range, loop points), and run `node tools/embed-samples.mjs`, which writes the table into the source (`assembly/samples.ts` or `src/samples.rs`). The template's test fails while that file is out of date. The samples count against `limits.memoryPagesMax`.

**The note effect: notes in, notes out.** `"notes": { "inputs": 1, "outputs": 1 }`, `"note-effect"` among the features, and in the code `Descriptor(…).noteEffect()` (AssemblyScript) or `est::export_note_effect!` (Rust); it sends notes with `io.sendNoteOn`/`sendNoteOff` (`send_note_on`/`send_note_off`) and must end every note it starts. `est test` compares the notes it sends with `test/golden-notes.json`; `est dev` shows a keyboard and logs them (`plugin-notes`). Cyber runs it as an insert and reports its notes, but **does not route them to the next plugin on the track yet**: that is EST 1.1.

**The visualiser: a UI that reacts to sound without seeing samples.** UI protocol 2's `est:meter` brings the strip's peaks at most 30 times a second; the page keeps their history and draws it in one animation frame loop. A spectrum computed from the samples needs the protocol's audio tap, planned for EST 1.1: in 1.0 a plugin's DSP has no way to send its own analysis to its page.

## Every template has

`AGENTS.md` (the layout, the commands, the rules and the loop, for you and a coding agent; `CLAUDE.md` points at it), `llms.txt`, `est.json` with its `$schema`, a golden render in `test/`, and the build block `est` reads (`Cargo.toml`'s `[package.metadata.est]` or `asconfig.json`'s `"est"`). `est new … --ui` adds a custom UI to the effect and instrument templates; the visualiser has its own. `est new … --app` (1.335) makes the effect's or instrument's window an app instead: `ui-app/`, a Vite build with a bridge to the host and a small example app, whose `npm run build:ui` writes `ui/` ([ui.md](ui.md#a-whole-app-as-the-window); the template's `AGENTS.md`, "The window as an app").
