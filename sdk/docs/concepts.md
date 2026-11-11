# Concepts

An EST plugin is CLAP's model (the plugin interface most hosts speak) in WebAssembly's shape: a module that exports `clap_entry` and a growable function table, run by a host-written audio worklet inside the browser. The SDK's runtime writes the CLAP side for you from declarations; this page is what it does and why.

## Blocks

Audio arrives in **blocks** of 128 frames (Web Audio's render quantum), one call of `process` per block, at the context's sample rate (44.1 or 48 kHz, whatever the device runs at: never assume one). `activate(sampleRate, maxFrames)` is called once before the first block, and again if the rate changes; it is where you size buffers. `process` runs on the audio thread and must:

- **allocate nothing.** Nothing allocates in `render`, `process`, the parameter hook or the note handlers. Rust: heap memory (a delay line's buffer) only in `activate`, sized from its maximum, and `new` builds the plugin by value; AssemblyScript: allocate only in the plugin's constructor and field initialisers, or in `activate`. The library's blocks follow this rule ([the DSP library](dsp-library.md) has it in full);
- **return in time.** A block's budget is a fraction of 2.7 ms. The module is **metered** at install (fuel counted at every function entry, loop and return), so a loop that never ends traps instead of hanging the audio thread; a trap ends the instance, which fades out and shows as crashed;
- **be deterministic.** The same input, events and state give the same samples. The validator renders twice and compares, and Cyber relies on it for offline renders and for collaborators to hear the same thing. `random_get` is there for seeding at `activate`, not for `process`.

An effect has one stereo (or mono) input and output; an instrument has an output and a note input.

## Events

Everything that happens at a sample arrives as an **event** in the block it falls in, with its frame offset, in time order:

- **parameter values** (a knob, automation at 10 ms steps or finer, a preset, a collaborator);
- **notes** (instruments): note-on and note-off with a **note id**, the key, the channel and the velocity; a choke ends a note at once (Panic). Each note-on has its own id, so two notes of the same key are two notes. The velocity is CLAP's **0…1** (`note.velocity` in the SDK): Cyber's keys, MIDI and clips carry MIDI's 0–127 and the host divides by 127 before the event reaches the plugin (a MIDI velocity of 100 arrives as about 0.79; the dev host's `--play` and `note` commands take 0–127 too);
- **note expressions**: tuning (semitones), volume, pan, vibrato, expression, brightness, pressure, on one note by its id (MPE, poly aftertouch);
- **MIDI**: three-byte messages for a plugin that reads controllers (the wheel, sustain, any CC);
- **the transport**: tempo (and a ramp's end), the position in beats and seconds, the time signature, the bar, the loop, playing or not. Cyber sends one per scheduler window while it plays, and one with `playing: false` when it stops.

Split the block at each event's offset and process the frames between, so a change lands on its sample. The SDK's event iteration allocates nothing.

## Sample rates

The same plugin runs at 44.1 kHz on one person's machine and 48 kHz on their collaborator's, and an export renders at the project's rate, so a plugin must sound the same at any rate. The rule: **everything is in seconds (or Hz), turned into frames from the rate `activate` gives, never a constant of frames.**

- **Times and lengths:** a delay, a hold, a pre-delay or a buffer is `seconds × sampleRate` frames, worked out in `activate` (and again if it is called again at another rate). A delay of `4800` frames is 100 ms at 48 kHz and 108.8 ms at 44.1; `0.1 * sampleRate` is 100 ms at both. Size buffers from the longest time at the highest rate you accept.
- **Smoothing, envelopes and followers:** a one-pole's coefficient is `1 - exp(-1 / (seconds × sampleRate))` (`onePole(seconds, sampleRate)`, `Smoother(seconds)` with `setSampleRate`), never a fixed `0.3`: a fixed coefficient is a frequency in disguise, 9 % higher at 48 kHz than at 44.1. The same for an attack, a release or a decay.
- **Frequencies:** an oscillator's increment is `hz / sampleRate`; a filter's coefficients come from its corner in Hz and the rate (the SDK's `Biquad`, `Filter` and `Oscillator` take Hz and are told the rate).
- **Reporting:** `latency` and `tail` are frames *at the current rate* (`seconds × sampleRate`), not a number written for 48 kHz.
- **Control rates** (updating coefficients every N frames to save work) are fine: they move a glide's steps by under a millisecond, not the sound.
- **On purpose:** a parameter that is deliberately a fraction of the device's rate (a bitcrusher's "Downsample", which holds each sample for that many frames) says so in its name and description; it will differ between rates, as early samplers did.

Cyber checks this: `src/audio/est/install/parity.test.ts` renders every reference plugin and the cookbook's recipes at 44.1 and 48 kHz and compares them (and live against offline), with a tolerance per plugin and the arithmetic for each in `parity.json`. Check your own the same way: `est test`'s golden spec takes a `sampleRate` (keep one at 44100 beside the 48000 one), and `est compare` takes `--sample-rate`; render at both and listen for anything that moves.

## Identity: what must match `est.json`

The plugin says who it is twice: in its code (Rust: `est::export_effect!`/`export_instrument!`'s arguments; AssemblyScript: the `Descriptor` that `describe()` returns) and in `est.json`. The host checks exactly these:

| What | Checked | Rule |
|---|---|---|
| the descriptor's `id` and `est.json`'s `id` | identical: the host creates the plugin by est.json's id, and a factory without it fails to start | `EST-C001` ("the factory has no plugin …") |
| the kind | an effect has an audio input and output, an instrument a note input and an audio output (Rust: `export_effect!` or `export_instrument!`; AssemblyScript: the `Descriptor`'s first feature, `"audio-effect"` or `"instrument"`) | `EST-C003`, `EST-C004` |
| est.json's `kind` and `features[0]` | `effect` with `"audio-effect"` first, `instrument` with `"instrument"` first | `EST-M006` |
| the audio channel counts and note ports | the module's equal `audio` and `notes.inputs` | `EST-C003`, `EST-C004` |
| the parameter ids | the module's set of ids equals `est.json`'s `parameters` ids (when the list is not empty); names and units are not compared | `EST-C008` |
| latency and tail | within `limits` | `EST-C005`, `EST-C006` |

**Not checked:** the descriptor's `name`, `vendor`, `version`, `description` and the rest of `features`. Cyber shows `est.json`'s. Keep them the same anyway (`est new` writes both, and other EST hosts may read the descriptor).

## Parameters

A parameter is declared once, in the DSP: a CLAP id (a `u32` that never changes once released), a name, a module path for grouping (`"Filter"`, `"Band 2"`), a range in **plain values** (Hz, dB, ms, not 0–1), a default, flags (stepped, periodic, hidden, read-only, bypass, automatable) and text conversion. The host shows them as the **generated UI** (knobs grouped by module) when the plugin has no UI of its own, automates them, and saves them. List the same ids, names and units in `est.json`'s `parameters` so the host can label them before the module runs.

Smooth what clicks when it jumps (a gain, a cutoff) with a `Smoother`; leave stepped values stepped.

## State

A plugin saves and loads its **state**: the SDK writes a header, every parameter, then a blob of the plugin's own (a sample's settings, a sequence; never a buffer it can rebuild). Cyber saves it in the project, inline up to a size and as a file past it, and loads it before the instance's first block.

The SDK's format, little-endian: the **state magic** (4 bytes), the state version (u32), the parameter count (u32), then each parameter's id (u32) and value (f64), then the plugin's own bytes (`save_state`/`saveState`). On load, a state whose magic is not the plugin's, or whose version is 0 or newer than the plugin's, is refused; an unknown parameter id is skipped, a missing one keeps its value.

**The state magic** marks the state as this plugin's. Rust: `const STATE_MAGIC: u32 = u32::from_le_bytes(*b"ABCD");`; AssemblyScript: the `Descriptor`'s four-character `stateMagic` (`"ABCD"`, character codes below 256). It is free-form: any four bytes (four letters by convention); the host does not read it, only your plugin does. The templates use `TMPE` and `TMPI`, which a plugin made from a template keeps until you change it; that is harmless, since a state belongs to one plugin id. **Choose it before you ship and never change it afterwards**: every state saved by an earlier version (in every project that uses the plugin) and every preset would be refused on load. To change the format, raise the state version instead.

Three rules:

- **round trip**: loading what you saved gives the same parameters and the same state (the validator checks; the dev host has a button);
- **versions**: `stateVersion` in `est.json` is your format's version; load every older version you shipped (state v1 into v2);
- **presets** are states: a bundle may carry them (`presets/index.json`), each no newer than `stateVersion`.

## The sandbox, and why

A Cyber project is shared: a collaborator's browser runs the plugins you put in it. So a plugin gets nothing it could use against the person whose browser it runs in:

- **The DSP is WebAssembly** with no JavaScript: it can touch only its own memory (capped by `limits.memoryPagesMax`, at most 128 MiB) and the host's callbacks. Its imports are checked against an allowlist before it runs: the host's CLAP callbacks and a small WASI subset (clocks, random numbers, writing to stderr, exit; arguments and environment are empty). No file system, no network, no threads.
- **Metering** (fuel) makes every call return; **the conformance run** at install plays it before anyone hears it.
- **The UI is a page in a sandboxed frame** (`sandbox="allow-scripts"`) on a second origin, the plugin origin: its origin is opaque, so it has no cookies, no storage, no network (`connect-src 'none'`), no other frame, and it loads only the files of its own bundle. It talks to the host only by `postMessage`, in the frame protocol (version 1: `est:ready`, `est:init`, `est:param`, `est:gesture`), every message checked for its nonce, its shape, its size and the parameter's range, and rate-limited. [`@cyber-est/ui`](ui.md) speaks it for you.
- **The bundle is content-addressed**: its SHA-256 names it everywhere, a project pins the exact bytes, and every file in it is listed with its hash.

What this costs you: no JavaScript DSP (not even "for convenience"), no fetching samples at run time (put them in the bundle), no shared memory with the UI (the UI sees parameters, not audio, until protocol version 2).

## Notes

An instrument's notes come with ids (see Events). The SDK gives a `Voices<T>` helper (polyphony with oldest-note stealing, voices found by note id), and reports each voice's release so the host knows the **tail**: how long the instrument rings after its last note-off. Declare the longest in `limits.tailSeconds`; the host renders that much past a song's last note.

### Note effects (since 1.321)

A **note effect** is an effect with a note input and a note output: `"notes": { "inputs": 1, "outputs": 1 }`, `"note-effect"` among its features, and in the code `Descriptor(…).noteEffect()` (AssemblyScript) or `est::export_note_effect!` (Rust). It receives notes as an instrument does and sends notes with `io.sendNoteOn`/`io.sendNoteOff` (`send_note_on`/`send_note_off` in Rust), each at a sample of the block; its audio passes through `render`. It must end every note it starts. The conformance run holds both note ports to est.json (`EST-C004`). Cyber's processor reports the notes it sends (`est dev` logs them as `plugin-notes`; `est test` compares them with `test/golden-notes.json`), but Cyber does not yet route them to the next plugin on a track or record them: that is EST 1.1. The `midi-effect-*` templates and the cookbook's step sequencer are note effects.

## EST 1.1 (Cyber 1.327)

EST 1.1 adds six things, each opt-in with `"abi": { "est": "1.1", "clap": "1.2" }` (a 1.0 bundle runs exactly as before; a 1.1 field in a 1.0 manifest is refused, EST-M020, and an edition newer than the host's is refused in words, EST-M019). The ABI table is `est-abi-1.1.json`, beside 1.0's: every 1.0 offset unchanged.

- **Sidechain:** an effect's second input, `{ "role": "sidechain", "channels": 1 }` (or 2), arrives as the second buffer of `audio_inputs` (`audio_inputs_count` 2), silent until the user picks a key track on the card. Report it as your audio input port 1.
- **More than stereo:** up to 8 channels on a main port. An instrument's pairs past the first play on output strips the user adds; an effect's channels past two are summed into its stereo strip.
- **Note out:** with `"notes": { "outputs": 1 }` and a note output port, push `NOTE_ON`, `NOTE_OFF`, `NOTE_CHOKE` or `MIDI` to `out_events` in `process`; Cyber sends them to the next plugin on the track that takes notes, a block or two later. Live only: an export does not route them.
- **Modulation:** mark a parameter `"modulatable": true` and flag it `CLAP_PARAM_IS_MODULATABLE`; a clip envelope on it sends `CLAP_EVENT_PARAM_MOD` at 10 ms steps, `amount` in plain units added to the value while it holds (0 on Stop). Keep the modulated value separate from the set one, and smooth both.
- **Presets with pictures:** `presets/index.json` entries may add `"image"` (a WebP of at most 64 KiB in the bundle) and `"author"`.
- **The UI sees audio:** `"ui": { …, "audio": true }` and frame protocol 3 ([the UI library](ui.md#protocol-version-3-the-ui-sees-audio-est-11)).

