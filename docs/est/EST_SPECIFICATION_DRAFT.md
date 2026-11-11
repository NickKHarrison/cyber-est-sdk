# EST 1.0 specification draft (with EST 1.1, §13)

Part of the EST planning set. Index: [EST_MASTER_PLAN.md](EST_MASTER_PLAN.md). **Status: architectural proposal, not a standard.** Every "MUST" below is what the Cyber host would enforce in EST 1.0; the wording follows RFC 2119 so that a later normative edition can start from this text. The processing model is CLAP's (see [EST_TECHNOLOGY_RESEARCH.md](EST_TECHNOLOGY_RESEARCH.md) §4); this document does not restate CLAP's headers, it states what EST pins, adds and forbids.

## 0. Terms

- **Plugin:** an EST bundle, identified by a plugin id, published in versions.
- **Bundle:** the set of files that make up one version of a plugin (§2).
- **Module:** the bundle's `module.wasm`, a WebAssembly module on the EST ABI (§3).
- **Instance:** one running plugin inside one host context (live or offline).
- **Host:** software that loads bundles and runs instances; Cyber's host is `@est/host`.
- **UI:** the bundle's optional web page, run by the host in an isolated frame (§8).
- **Registry:** a service that lists plugins and serves bundles (see [EST_REGISTRY_ARCHITECTURE.md](EST_REGISTRY_ARCHITECTURE.md)); EST does not require any particular registry.

## 1. Identity and metadata: `est.json`

Every bundle MUST contain `est.json` at its root, UTF-8 JSON validated against the EST manifest schema (`est-manifest-1.schema.json`, shipped with the SDK). Fields:

```jsonc
{
  "est": 1,                                   // manifest schema major version
  "id": "com.example.gentle-verb",            // reverse-DNS, [a-z0-9.-], 3–120 chars, lower case; stable for life
  "version": "1.2.0",                         // semver 2.0.0; the bundle's own version
  "name": "Gentle Verb",                      // ≤ 60 chars
  "vendor": "Example Audio",                  // ≤ 60 chars
  "description": "A plate-style reverb with a soft top end.",   // ≤ 400 chars, plain text
  "url": "https://example.com/gentle-verb",   // optional, https only
  "license": "MIT",                           // SPDX identifier or "proprietary"
  "kind": "effect",                           // "effect" | "instrument"   (EST 1.0 only these two)
  "features": ["audio-effect", "reverb", "stereo"],   // CLAP feature strings; the first MUST match kind
  "abi": { "est": "1.0", "clap": "1.2" },     // the EST ABI edition and the CLAP version the module targets
  "module": { "path": "module.wasm", "sha256": "…64 hex…", "bytes": 418233 },
  "ui": { "path": "ui/index.html", "sha256": "…", "size": { "w": 520, "h": 320 }, "resizable": false },  // optional
  "assets": [ { "path": "ui/knob.png", "sha256": "…" } ],   // every other file in the bundle, each hashed
  "audio": { "inputs": [ { "channels": 2 } ], "outputs": [ { "channels": 2 } ], "sampleRates": "any" },
  "notes": { "inputs": 1, "outputs": 0 },     // note ports the module declares; instruments MUST have ≥ 1 input
  "limits": { "maxLatencyFrames": 4096, "memoryPagesMax": 512, "tailSeconds": 8 },
  "permissions": [],                          // §9; EST 1.0 allows only the empty list for community plugins
  "compat": { "host": ">=1.0.0 <2" },         // EST host versions this bundle is built for
  "presets": "presets/index.json",            // optional, §7
  "signature": "signature.json"               // §10
}
```

Rules:
- `id` MUST be globally unique and MUST NOT change across versions; a renamed plugin is a new plugin with a `supersedes` field pointing at the old id.
- `features` MUST use CLAP's feature identifiers; custom features use `vendor:feature`.
- `module.sha256` and every `assets[].sha256` MUST match the bytes; the host MUST refuse a bundle with any mismatch before executing anything.
- Hosts MUST ignore unknown top-level keys and MUST refuse a manifest whose `est` major is unknown.

## 2. Bundle format

A bundle is a directory tree, distributed as a `.est` file: a ZIP archive with **stored (uncompressed) entries only**, no absolute paths, no `..`, no symlinks, at most 512 entries and 64 MiB total, `est.json` as its first entry. Required: `est.json`, `module.wasm`. Optional: `ui/` (the UI page and its assets), `presets/`, `README.md`, `LICENSE`. The bundle's **content hash** is the SHA-256 of the canonical archive bytes; hosts and registries address bundles by `id@version` and verify by content hash.

Rationale: stored ZIP keeps the format readable by every tool; the size limits bound install time and storage; the first-entry rule lets a host read the manifest before fetching the rest.

## 3. The processing ABI

### 3.1 Module shape (pinned from WCLAP)

The module MUST:
- export `clap_entry` as an `i32` global holding the address of a `clap_plugin_entry` struct in its memory (wasm32 only in EST 1.0; a wasm64 module is refused);
- export `malloc(size: i32) -> i32` and `free(ptr: i32)` with C semantics (the host allocates its structures in the plugin's memory through them);
- export exactly one `funcref` table (the host calls plugin function pointers through it) and export `memory` (the host does not supply shared memory in EST 1.0; threads are not available, §3.6);
- import nothing except, optionally, functions from the modules `wasi_snapshot_preview1` (restricted to `clock_time_get`, `random_get`, `fd_write` on fds 1 and 2, `proc_exit`, `args_*` and `environ_*` returning empty) and `est_host` (the host-callback shims the host provides, §3.4).

The module MAY export `_initialize()` (no parameters, no results: the WASI reactor convention) for set-up work such as constructors and tables. The host MUST call it exactly once per instance, right after instantiation and before it reads `clap_entry` or calls anything else, with a block's worth of fuel (the same budget as one `process` call); a trap there, or running out of fuel, fails the instance, and the install refuses the module (`EST-W016`). The module MUST NOT have a start function (a start section runs at instantiation, before the host can give any fuel, so it traps: `EST-W015`); set-up work belongs in `_initialize`. (EST tidy, 1.286, D-43.)

Any other import MUST cause the host to refuse the module at validation time. The host MUST set `maximumMemoryPages` from `limits.memoryPagesMax` (default 256 pages = 16 MiB, hard cap 2048) when instantiating, and MUST refuse a module whose declared minimum exceeds it.

### 3.2 Struct layout

EST 1.0 pins the wasm32 layout of every CLAP struct the host touches, generated from CLAP 1.2 headers with ILP32 rules (4-byte pointers, natural alignment, `int64_t` 8-aligned). The SDK ships the layouts as `est-abi-1.0.json` (offsets and sizes per struct and field) and the host validates the generated mirror against it at build time. The pinned set: `clap_version`, `clap_plugin_entry`, `clap_plugin_factory`, `clap_plugin_descriptor`, `clap_plugin`, `clap_host`, `clap_process`, `clap_audio_buffer`, `clap_event_header` and every event struct, `clap_input_events`, `clap_output_events`, `clap_event_transport`, the `params`, `state`, `audio-ports`, `note-ports`, `latency`, `tail`, `render`, `gui` (webview only) and `voice-info` extension structs, `clap_istream`, `clap_ostream`. A plugin using an extension outside this set simply gets `NULL` from `get_extension`.

### 3.3 Lifecycle

The host drives CLAP's lifecycle exactly: `clap_entry.init("/")` once per instance; `get_factory("clap.plugin-factory")`; `get_plugin_count/descriptor`; `create_plugin(host, id)` where `id` MUST equal `est.json`'s `id`; `plugin.init`; `get_extension` for each pinned extension; `activate(sampleRate, minFrames, maxFrames)` with `minFrames = maxFrames = renderQuantumSize` (128 unless the host chose a larger quantum); `start_processing` on the audio thread; `process` per block; `stop_processing`, `deactivate`, `destroy`. All "main-thread" methods are called from the host's worklet processor outside `process()` (the worklet thread is both CLAP threads; EST calls this the **single-thread model** and plugins MUST NOT assume parallelism). `request_callback` runs the callback after the current block.

### 3.4 Host callbacks

The host provides `clap_host` with name "EST host", vendor and version strings, and `get_extension` answering `clap.params` (`rescan`, `clear`, `request_flush`), `clap.state` (`mark_dirty`), `clap.latency` (`changed`: honoured at the next activation), `clap.tail` (`changed`), `clap.log` (lines capped, rate-limited, forwarded to the host's console with the plugin id), `clap.thread-check` (both `is_main_thread` and `is_audio_thread` answer true), `clap.gui` (webview only: `request_resize`, `closed`), `clap.render` (none needed). `request_restart` schedules deactivate/activate between blocks; `request_process` is a no-op (always processing).

### 3.5 Audio processing

- Blocks: the host calls `process` with `frames_count` equal to the render quantum; buffers are `data32` only; `constant_mask` is set when the host knows a channel is silent. `latency` in the buffer struct is 0.
- Channel configurations: EST 1.0 hosts support mono and stereo main ports; a plugin MUST declare its main in/out ports with `channel_count` 1 or 2 and the host adapts (mono in a stereo strip is upmixed; stereo into mono is summed). Sidechain (aux) inputs are allowed and carry the strip's key source when the host has one.
- Sample rate: any; the host passes the context's rate at activation and never changes it without a full deactivate/activate.
- Return codes: `CLAP_PROCESS_ERROR` makes the host silence the instance and report; `SLEEP` and `CONTINUE_IF_NOT_QUIET` let the host skip blocks while the input is silent and the tail has elapsed.
- Timing: the host MUST deliver every event with a `time` within the block, sorted; events for the future are held by the host.

### 3.6 Forbidden and unavailable

No threads, no `SharedArrayBuffer`, no WASI filesystem, sockets or environment, no dynamic memory beyond the pinned maximum, no `wasm64`, no exceptions-handling or relaxed-SIMD requirement (modules MAY use fixed-width SIMD; relaxed SIMD is refused in 1.0 because Safari lacks it). The host rejects at validation a module that imports anything outside §3.1.

## 4. Musical events

Instruments and note effects receive CLAP note events: `NOTE_ON` (key, channel, velocity 0..1, note id), `NOTE_OFF`, `NOTE_CHOKE`, `NOTE_EXPRESSION` (volume, pan, tuning, vibrato, expression, brightness, pressure), and MIDI 1.0 events for controllers the host maps (mod wheel CC1, sustain CC64, pitch bend, channel pressure). The host prefers the CLAP dialect; a plugin declaring only the MIDI dialect receives MIDI note messages instead. Note ids are assigned by the host and are stable for the note's life, so per-note modulation works. `NOTE_END` from the plugin releases the id. The transport event (§3.5) carries tempo and `tempo_inc`, the song position in beats and seconds, the bar start, time signature, loop points and the playing/recording flags; the host sends it at the start of every block whose transport differs from the last, and always after a jump.

## 5. Parameters and automation

- Parameters are CLAP parameters: stable `id` (u32), `name`, `module` path, `min`/`max`/`default` **plain values**, flags. EST adds a manifest mirror: `est.json` MAY list `parameters` (id, name, unit, hint) so a browser can show a plugin's parameters without loading it; when present the host checks it against the module at validation.
- A `parameters` entry MAY carry `"scale"`: `"linear"` (the default) or `"log"`, the one hint CLAP lacks. A host moves a `"log"` parameter's generated knob, its sliders and its automation geometrically over the plain range, so 0…1 maps to `min · (max / min)^u` and a lane's midpoint is the geometric middle √(min · max); the value sent to the plugin is still the plain value. A `"log"` parameter's range as the module reports it MUST be continuous (not stepped) with `min > 0`; otherwise the host refuses the bundle at validation (`EST-C021`). A UI's `est:init` carries `scale: "log"` on exactly those parameters and on no other. (EST tidy, 1.286, D-44.)
- The host keeps a plain-value cache per instance (`params`), updated from `PARAM_VALUE` events it sends and from the plugin's output events; this cache is what projects store beside the opaque state so that a missing plugin's automation and UI stay meaningful.
- Automation: the host converts its lanes to `PARAM_VALUE` events with sample offsets, one per 10 ms step or change (the same density Cyber uses for its own synths), and `PARAM_GESTURE_BEGIN/END` around user touches. Modulation (`PARAM_MOD`) is supported in the ABI but no Cyber source emits it in 1.0.
- Smoothing is the plugin's job; the host documents the step density so authors can smooth accordingly.
- Text: `value_to_text`/`text_to_value` are called outside `process()` for the generated UI and for "Type a value…".

## 6. State and presets

- State is the CLAP state stream, opaque bytes. The host calls `save` after a gesture ends (debounced 300 ms), on explicit save, and before an offline render; `load` on instance creation and on undo/redo. A state larger than 64 KB is stored out of line by the host; a state larger than 4 MiB is refused (`clap_host_state.mark_dirty` still works).
- Versioning: a plugin MUST load the state its earlier versions saved (CLAP's rule); EST adds `stateVersion` to the manifest, a monotonically increasing integer, so hosts can warn before downgrading a plugin below the version that wrote a state.
- Presets (`presets/index.json`): `{ "presets": [ { "name", "path", "tags": [], "stateVersion" } ] }` where each path is a state stream file in the bundle. Hosts MAY also save user presets as state streams keyed by plugin id. The CLAP preset-discovery factory is not used in 1.0 (no filesystem).

## 7. Compatibility negotiation

- `abi.est` names the EST ABI edition. **Amended by EST 1.1 (Cyber 1.327, D-56):** a host runs the editions it knows and MUST refuse a newer one in words ("this bundle needs EST 1.2; this host runs 1.0 and 1.1: update"), never read it as an older edition; a field an edition added MUST be refused in a bundle that names an earlier edition, so an edition's meaning never changes. (The first wording, "a host supporting 1.x MUST load any 1.y bundle", is what the 1.0 hosts already shipped do: they accept `"1.1"` and ignore its new keys, or refuse its new port shapes with their 1.0 port rule. §13.7.)
- `compat.host` is a semver range against the host's EST host version; a bundle outside the range installs with a warning and runs.
- Capability discovery is CLAP's `get_extension` on both sides; a plugin MUST tolerate `NULL` for any host extension.
- A host advertises its EST edition, its render quantum, its available extensions and the permissions it grants in a `clap_host` extension `est.host-info/1` (JSON string getter), so a plugin can adapt.

## 8. User interfaces

Two UI modes, both always available to the user:

1. **Generated UI** (host-made): the host renders every non-hidden parameter as a control from the parameter info, grouped by `module`, with text conversion, automation and MIDI learn. This is the only UI for a bundle without `ui`, and the fallback when the custom UI fails or is blocked.
2. **Custom UI** (`ui/index.html`): a self-contained web page in the bundle. The host loads it in an isolated frame (sandboxed, opaque origin, on the plugin origin, with the frame's CSP forbidding network, forms, popups and top navigation) and connects it to the instance through `postMessage` only. The protocol is the `clap.webview/3` shape (`receive`/`send` of `ArrayBuffer` messages) plus EST's typed JSON messages: `est:init { manifest, params, state, size }`, `est:param { id, value }` both ways, `est:gesture`, `est:state`, `est:resize { w, h }` (within manifest limits), `est:meter` (host → UI at most 30 Hz), `est:close`. A UI MUST NOT assume it is the only client of the instance; the host may replay parameter changes from automation or another collaborator.

Keys (Cyber 1.346): the host's computer keyboard (notes, octave, velocity, the transport) keeps working while a custom UI has the focus: the host's frame guard hands back each printable key the page did not take with `preventDefault` and that is not typed into a text field. A custom UI SHOULD take only the keys it needs.

Accessibility: a custom UI MUST keep every control reachable by keyboard and labelled; the host exposes the generated UI as the accessible alternative and lets the user default to it per plugin.

## 9. Permissions

`permissions` lists capabilities beyond audio processing and UI messaging. EST 1.0 defines the names but the Cyber host grants **none** to community plugins: `network:<origin>` (fetch from a named origin), `storage` (a small per-plugin key-value store the host persists), `clipboard`, `files:read` (user-picked files). A manifest listing any permission is accepted by the registry only for curated plugins and shows in the browser as a labelled requirement. Nothing in a bundle can obtain a capability the host did not grant: the frame's CSP and the Wasm import set are the enforcement, not the manifest.

## 10. Signing

`signature.json` holds `{ "alg": "Ed25519", "keyId", "signed": { "id", "version", "contentHash", "publishedAt" }, "sig": "base64" }` from the author, and registries append their own countersignature. Hosts verify with WebCrypto (`Ed25519`, available in Chrome 137, Firefox 130 and Safari 17; a `@noble/curves` fallback for older browsers). An unsigned bundle may be installed only in developer mode.

## 11. Example manifests

**A minimal effect, no UI:**
```json
{ "est": 1, "id": "org.estdev.gain", "version": "1.0.0", "name": "EST Gain", "vendor": "EST reference",
  "description": "A gain stage with smoothing and bypass.", "license": "MIT", "kind": "effect",
  "features": ["audio-effect", "utility", "stereo"], "abi": { "est": "1.0", "clap": "1.2" },
  "module": { "path": "module.wasm", "sha256": "…", "bytes": 9120 }, "assets": [],
  "audio": { "inputs": [{ "channels": 2 }], "outputs": [{ "channels": 2 }], "sampleRates": "any" },
  "notes": { "inputs": 0, "outputs": 0 }, "limits": { "maxLatencyFrames": 0, "memoryPagesMax": 16, "tailSeconds": 0 },
  "permissions": [], "compat": { "host": ">=1.0.0 <2" }, "signature": "signature.json" }
```

**An instrument with a UI and presets:**
```json
{ "est": 1, "id": "org.estdev.synth", "version": "1.0.0", "name": "EST Synth", "vendor": "EST reference",
  "description": "Three oscillators, a multimode filter, ADSR envelopes, an LFO.", "license": "MIT", "kind": "instrument",
  "features": ["instrument", "synthesizer", "stereo"], "abi": { "est": "1.0", "clap": "1.2" },
  "module": { "path": "module.wasm", "sha256": "…", "bytes": 182004 },
  "ui": { "path": "ui/index.html", "sha256": "…", "size": { "w": 720, "h": 420 }, "resizable": true },
  "assets": [{ "path": "ui/app.js", "sha256": "…" }, { "path": "ui/style.css", "sha256": "…" }],
  "audio": { "inputs": [], "outputs": [{ "channels": 2 }], "sampleRates": "any" },
  "notes": { "inputs": 1, "outputs": 0 }, "limits": { "maxLatencyFrames": 0, "memoryPagesMax": 128, "tailSeconds": 10 },
  "stateVersion": 1, "presets": "presets/index.json", "permissions": [], "compat": { "host": ">=1.0.0 <2" },
  "signature": "signature.json" }
```

## 12. The host library contract (`@est/host`)

The TypeScript library a host embeds (MIT), so that Cyber's integration code is small and other browser DAWs can reuse it:

```ts
loadBundle(bytes: ArrayBuffer, opts: { trust: 'registry' | 'developer' }): Promise<EstBundle>   // verifies, validates, compiles
createInstance(ctx: BaseAudioContext, bundle: EstBundle, init?: { state?: Uint8Array; params?: Record<number, number> }): Promise<EstInstance>
interface EstInstance {
  node: AudioWorkletNode;                       // connect like any node
  info: { params: EstParamInfo[]; latencyFrames: number; tailSeconds: number; notePorts: … };
  scheduleEvents(events: EstEvent[]): void;     // timestamped on the context clock, batched per window
  setParam(id, value, gesture?): void; getParams(): Record<number, number>;
  getState(): Promise<Uint8Array>; setState(bytes): Promise<void>;
  setRenderMode(mode: 'realtime' | 'offline'): void;
  on(event: 'param' | 'latency' | 'tail' | 'error' | 'meter', cb): () => void;
  openUI(frameHost: HTMLElement, mode: 'custom' | 'generated'): EstUIHandle;
  dispose(): void;
}
```

The library owns the worklet runtime module, the ABI mirror, the validator and the UI frame protocol; the host owns routing, persistence, presets and windows.

## 13. EST 1.1 (Cyber 1.327, D-56)

EST 1.1 is a minor edition: every 1.0 bundle is a valid 1.1-host bundle and runs exactly as before (the host makes its node, allocates its buffers and speaks to it as 1.0 did); a bundle opts in with `"abi": { "est": "1.1", "clap": "1.2" }`. The 1.1 ABI table is `est-abi-1.1.json`, generated beside 1.0's by `node scripts/est-abi.mjs` (`--check` covers both): 1.0's structs, constants and strings unchanged, plus `clap_plugin_surround`, `clap_host_surround`, the audio-port flags, `CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID`/`_PER_KEY`, the surround channel ids FL…FRC, `CLAP_EXT_SURROUND` and `CLAP_PORT_SURROUND` (its `adds` key lists them). Each item below is refused in a 1.0 manifest (EST-M020) and refused past this host's editions (EST-M019).

### 13.1 Sidechain input

An effect MAY list a second input port after its main one: `"inputs": [{ "channels": 2 }, { "role": "sidechain", "channels": 1 | 2 }]` (EST-M021: the first port is the main one, one sidechain, 1 or 2 channels, after a main input). The module reports it as its audio input port 1 (clap.audio-ports; EST-C003 when the channels differ). The host passes it as the second `clap_audio_buffer` of `audio_inputs` (`audio_inputs_count` 2), silent (`constant_mask` set) while no key is chosen. In Cyber the key is a track or a return, chosen on the card's Key menu exactly as a Compressor's sidechain (`keyTrackId`; the same loop rule: a track or return the strip plays into cannot be its key).

### 13.2 More than stereo

A main port MAY have up to 8 channels. An **instrument's** main output of more than 2 is a multi-out: its first pair plays on its own track's strip, and each further pair (3/4, 5/6, 7/8) on an **output strip**, an audio track the user adds from the instrument's window (Add output strips), live and in an export. An **effect's** output channels past 2 are summed into its stereo strip (channel c into c mod 2), and the card says so: Cyber's strips are stereo, and multichannel strips are out of scope for 1.1. `clap.surround` MAY be implemented; Cyber does not ask for a channel map.

### 13.3 Note output

`"notes": { "outputs": 1 }` (1.0 already accepted the key and ignored it) is honoured for a 1.1 bundle: the module declares a note output port (EST-C023 when it does not) and pushes `NOTE_ON`, `NOTE_OFF`, `NOTE_CHOKE` and `MIDI` to `out_events` during `process`. The host keeps up to 128 a block and delivers them to the **next plugin on the same strip that has a note input** (an instrument's to the first such EST insert on its track, an insert's to the first after it), one or two blocks late, in order. Live only: an offline render does not route notes, so an export of a note-out chain differs from what plays (Cyber says so in its notes). Recording a plugin's note output as MIDI is not in 1.1 (§13.7).

### 13.4 Parameter modulation

A `parameters` entry MAY say `"modulatable": true`; the module flags the parameter `CLAP_PARAM_IS_MODULATABLE` (EST-C022 when it does not). The host sends `CLAP_EVENT_PARAM_MOD` (`note_id`, `port_index`, `channel`, `key` all −1; `amount` in the parameter's plain units, added to its value while it holds) at 10 ms steps, as automation's `PARAM_VALUE`. In Cyber the source is a **clip envelope** on the parameter (the Envelopes box's control "<plugin>: <parameter>"; 0.5 no change, 0 and 1 the whole range down and up); on Stop the host sends an amount of 0. Cyber has no free-running LFO that modulates a strip, so clip envelopes are the one source in 1.1.

### 13.5 Presets with pictures

An entry of `presets/index.json` MAY add `"image"` (a `.webp` file in the bundle, at most 64 KiB, a WebP by its header) and `"author"` (plain text, 60 characters) beside `tags` (EST-B016). The host shows the chosen preset's picture, author and tags beside the preset picker. A preset is a state stream as before.

### 13.6 Frame protocol version 3: the UI sees audio

`"ui": { …, "audio": true }` lets the page ask for an analysis of the plugin's output. Version 3 adds, frame → host, `est:audio { fftSize, rate }` (`fftSize` 64…2048, a power of two; `rate` 1…30 a second; 0 stops) and, host → frame, `est:spectrum { bins, rms }` (`fftSize / 2` magnitudes in whole dB from −120 to 0, and the RMS `[l, r]`), from the host's own analysers on the plugin's output, only while the window is open and the page visible. `est:init` in version 3 adds `audio` (whether the host answers). **The frame never receives samples** (EST_SECURITY_ARCHITECTURE.md §4). A version-1 or version-2 page is answered in its own version, unchanged; a version-3 page on a host from before 1.327 is answered in version 1 (as a version-2 page was by a host from before 5a). `@est/ui`: `connection.audio({ fftSize, rate }, fn)` and `audioAvailable`.

### 13.7 What 1.1 leaves out, and why

- **Recording a note output as MIDI.** Recorded into the same track, the plugin's own output would play back through the plugin again (its note input), doubling every note; recording it needs a destination choice (another track), which is the owner's to decide.
- **Multichannel strips.** An effect's extra channels are summed until Cyber's mixer has them.
- **A 1.0 host's refusal.** The hosts shipped before 1.327 accept any `1.x` edition (§7's first wording). A 1.1 bundle with a sidechain or more than two channels fails their 1.0 port rule (EST-M011); one that uses only `modulatable`, `ui.audio` or preset pictures installs there and runs as a 1.0 plugin (the keys ignored). From 1.327 on, an edition newer than the host's is refused in words.


### §1 addendum: `migrate` (Cyber 1.337, R-F)

A manifest MAY carry `"migrate": [{ "from": "<range>", "params": { "<old id>": "<new id>" | null }, "state": "keep" | "drop" }]`: what this version does with the settings a project saved with an earlier version. `from` is a version range (comparators separated by spaces, `>=1.0.0 <1.2.0`, a single version, or `*`); ids are CLAP ids as decimal strings and every new id MUST be one the manifest's `parameters` list names (so a manifest with `migrate` lists its parameters); `state` defaults to `keep`. A host that moves a slot to this version applies the first entry whose range takes the version moved from: a renamed value moves, `null` drops, an old id the new version does not list is dropped with a note, `drop` leaves the saved state behind. Without an entry, settings cross by id as before. A host that does not know the field ignores it (an unknown top-level key). Malformed: EST-M022 (the work order named EST-M021, which the sidechain holds since 1.327; an id is never reused).
