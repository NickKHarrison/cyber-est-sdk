/**
 * EST Phase 4 (docs/est/EST_Phase4_Work_Order.md §1, stream 4-A): the validator's rules, **the one
 * table**. Every check the install pipeline makes (the bundle reader `bundle.ts`, the meter
 * `estMeter.ts`, the conformance run `conformance.ts`) and every check only the SDK's validator
 * makes (`@cyber-est/tools`: determinism, the UI probe, the block cost) has a stable id here, a one-line
 * title, a paragraph that explains it and the fix. A refusal carries its rule (`EstBundleError.rule`,
 * `ConformanceReport.rule`, the Worker's `refused` reply, `EstInstallError.rule`), so Cyber's
 * install notice and `est validate` name the same rule for the same fault.
 *
 * Pure: no imports (scripts/est-rules.mjs transpiles this file alone to write
 * `src/audio/est/abi/est-validator-rules.json`; `node scripts/est-rules.mjs --check` in the suite).
 * An id is never reused or renumbered: a retired rule keeps its row. Add a row at the end of its
 * prefix and bump `EST_RULES_VERSION`'s minor.
 *
 * Prefixes: `EST-M` the manifest, `EST-B` the bundle and its archive, `EST-W` the module,
 * `EST-C` conformance, `EST-U` the UI, `EST-P` performance (a warning only in Phase 4).
 *
 * `step` is where in the pipeline the check runs (in order: `archive`, `manifest`, `files`,
 * `module`, `presets`, `expect`, `meter`, `conformance`, then the validator's own `determinism`,
 * `ui`, `performance`); `install` says whether Cyber's install refuses on it (a validator-only rule
 * is stricter than the install, never looser).
 */

export const EST_RULES_VERSION = '1.6.1';

export type EstRuleSeverity = 'error' | 'warning';
export type EstRuleStep = 'archive' | 'manifest' | 'files' | 'module' | 'presets' | 'expect' | 'meter' | 'conformance' | 'determinism' | 'ui' | 'performance';

/** The steps in the order the validator runs them. */
export const EST_RULE_STEPS: readonly EstRuleStep[] = ['archive', 'manifest', 'files', 'module', 'presets', 'expect', 'meter', 'conformance', 'determinism', 'ui', 'performance'];

export interface EstRule {
  id: string;
  title: string;
  explain: string;
  fix: string;
  severity: EstRuleSeverity;
  step: EstRuleStep;
  install: boolean;
}

/** The block-cost budget `EST-P001` measures against (µs per 128-frame block at 48 kHz, this machine). */
export const EST_BLOCK_BUDGET_US = 100;
/** The most a UI's files may total before `EST-U004` warns. */
export const EST_UI_MAX_BYTES = 4 * 1024 * 1024;

const r = (id: string, step: EstRuleStep, title: string, explain: string, fix: string, severity: EstRuleSeverity = 'error', install = true): EstRule =>
  ({ id, title, explain, fix, severity, step, install });

export const EST_RULES: readonly EstRule[] = [
  // --- EST-B: the bundle and its archive -----------------------------------------------------
  r('EST-B001', 'archive', 'Not a canonical EST archive',
    'A .est bundle is a ZIP archive in one exact shape (spec §2): its entries from byte 0, the central directory and its end record straight after, no archive comment, no ZIP64, one disk. Anything else could hide data a reader would skip, so the host refuses it before reading a file.',
    'Pack the bundle with `est pack` (or @cyber-est/tools\' `pack`), never with a general ZIP tool, and do not edit the .est afterwards.'),
  r('EST-B002', 'archive', 'An entry is not stored plainly',
    'Every entry is stored uncompressed, unencrypted and without a data descriptor, with its sizes in its own header; a directory entry has no data. This keeps one set of files to one archive and lets the plugin origin serve the files as they are.',
    'Pack with `est pack`, which stores every file plainly.'),
  r('EST-B003', 'archive', 'Damaged archive records',
    'A local header disagrees with its central directory record, or a record runs past the archive\'s data: the bundle is damaged or was altered after packing.',
    'Pack the bundle again with `est pack` and copy the new file whole.'),
  r('EST-B004', 'archive', 'The bundle is too large',
    'A bundle is at most 64 MiB and 512 entries, and its est.json at most 256 KiB, so an install cannot exhaust the device.',
    'Remove files the plugin does not need (build output, sources, large samples), or shrink them.'),
  r('EST-B005', 'archive', 'A path EST does not allow',
    'Paths inside a bundle are relative, `/`-separated segments of `[A-Za-z0-9._-]` in UTF-8: no absolute path, no `..` or `.`, no backslash, at most 255 characters. The host serves the files under the bundle\'s hash, and a path outside these rules could escape it or mean different files on different systems.',
    'Rename the file (letters, digits, `.`, `_` and `-` only) and pack again.'),
  r('EST-B006', 'archive', 'A symbolic link in the bundle',
    'An entry is marked as a symbolic link. A bundle holds files only: a link could point outside the bundle when it is unpacked.',
    'Replace the link with the file itself (copy it) and pack again.'),
  r('EST-B007', 'archive', 'A path is in the bundle twice',
    'Two entries have the same path, or paths that differ only in case (which name one file on Windows and macOS).',
    'Rename one of the files so every path is unique ignoring case.'),
  r('EST-B008', 'archive', 'est.json is not the first entry',
    'The manifest is the archive\'s first entry, so a reader finds it without scanning the bundle.',
    'Pack with `est pack`, which writes est.json first.'),
  r('EST-B009', 'archive', 'A file does not match its CRC-32',
    'An entry\'s data does not match the CRC-32 its header records: the bundle was damaged in transfer or altered after packing.',
    'Copy the bundle again, or pack it again with `est pack`.'),
  r('EST-B010', 'archive', 'No est.json, or est.json is not JSON',
    'Every bundle has a manifest, est.json, in UTF-8 JSON.',
    'Add est.json at the plugin\'s root (start from a template\'s), check it parses, and pack again.'),
  r('EST-B011', 'files', 'A file is in the bundle but not in est.json',
    'Every file in the bundle is listed and hashed in est.json (the module, the UI page or an asset), so nothing unlisted can ride along.',
    'Pack with `est pack`, which lists and hashes every file; or remove the stray file.'),
  r('EST-B012', 'files', 'est.json lists a file the bundle lacks, or lists one twice',
    'est.json names a file (the module, the UI page, an asset or the preset index) that is not in the archive, or names one path twice.',
    'Check the paths in est.json against the plugin folder, then pack again with `est pack`.'),
  r('EST-B013', 'files', 'A file does not match its SHA-256 in est.json',
    'A file\'s SHA-256 (or the module\'s size) differs from what est.json records: est.json was written for other files, or a file changed after packing.',
    'Pack again with `est pack`, which fills every hash from the files as they are.'),
  r('EST-B014', 'presets', 'The preset index is not valid',
    'The preset index named by est.json\'s `presets` (spec §6) is a JSON file of at most 64 KiB, `{ "presets": [{ "name", "path", "tags", "stateVersion" }] }`, at most 128 presets, each a state file in the bundle of 1 byte to the inline state limit, with a state version no newer than the manifest\'s.',
    'Fix the entry the message names in the preset index (write the presets with the template\'s preset script), and pack again.'),
  r('EST-B015', 'expect', 'Not the bundle asked for',
    'The bundle\'s content hash (the SHA-256 of the archive) differs from the hash the host asked for: a different build, or an altered copy.',
    'Install the bundle by its published hash, or install the file itself in developer mode.'),
  r('EST-B016', 'presets', 'A preset\'s picture or author is not valid',
    'In EST 1.1 a preset in the index may name an `image`, a WebP file in the bundle of at most 64 KiB and 1024 × 1024 pixels (the Presets tab shows it), and an `author` in plain text (60 characters). A 1.0 bundle\'s presets have neither.',
    'Save the picture as `.webp` (at most 64 KiB, e.g. 256 × 256), put it in `presets/`, and name it by its path; or remove `image`.'),

  // --- EST-M: the manifest ------------------------------------------------------------------
  r('EST-M001', 'manifest', 'est.json is not an EST 1 manifest',
    'est.json is a JSON object with `"est": 1`, the manifest schema this host reads (est-manifest-1.schema.json).',
    'Start from a template\'s est.json, keep `"est": 1`, and point `$schema` at est-manifest-1.schema.json for your editor\'s completions.'),
  r('EST-M002', 'manifest', 'The id is not a reverse-DNS id',
    'A plugin\'s id is a reverse-DNS name of lower-case letters, digits, `.` and `-` (for example `com.example.my-verb`), unique to the plugin and never changed: projects name the plugin by it.',
    'Set `id` to a reverse-DNS name you own, the same in est.json and in the DSP\'s descriptor.'),
  r('EST-M003', 'manifest', 'The version is not a semantic version',
    'A plugin\'s version is a semantic version (`1.0.0`, `1.2.3-beta.1`).',
    'Set `version` to `MAJOR.MINOR.PATCH`.'),
  r('EST-M004', 'manifest', 'A text field is missing or not plain text',
    '`name` (60 characters), `vendor` (60), `license` (64) and the optional `description` (400) are plain text without control characters; the optional `url` is an https address.',
    'Fill the field the message names with plain text within its length, or remove the optional one.'),
  r('EST-M005', 'manifest', 'The kind is neither effect nor instrument',
    'EST 1.0 has two kinds of plugin: `"effect"` (audio in, audio out) and `"instrument"` (notes in, audio out).',
    'Set `kind` to `"effect"` or `"instrument"`.'),
  r('EST-M006', 'manifest', 'The features list is not valid',
    '`features` is a list of 1 to 32 CLAP feature names whose first is `"audio-effect"` for an effect and `"instrument"` for an instrument.',
    'Start `features` with the kind\'s feature, then add CLAP\'s other feature names (`"utility"`, `"stereo"`, `"synthesizer"` …).'),
  r('EST-M007', 'manifest', 'The ABI editions are not valid',
    '`abi.est` is an EST 1.x edition (`"1.0"`, or since 1.327 `"1.1"`) and `abi.clap` a CLAP 1.x version (`"1.2"`).',
    'Set `"abi": { "est": "1.0", "clap": "1.2" }`.'),
  r('EST-M008', 'manifest', 'The module entry is not valid',
    '`module` names the WebAssembly module: a `path` in the bundle, and (filled by the packer) its `sha256` and `bytes`.',
    'Set `"module": { "path": "module.wasm" }` and let `est pack` fill the rest.'),
  r('EST-M009', 'manifest', 'The UI entry is not valid',
    'An optional `ui` names an `.html` page in the bundle (its `sha256` filled by the packer) and its `size` (`w` 120 to 2000, `h` 80 to 1400), and may say `resizable`.',
    'Set `"ui": { "path": "ui/index.html", "size": { "w": 420, "h": 240 } }`, or remove `ui` for the generated UI.'),
  r('EST-M010', 'manifest', 'The assets list is not valid',
    '`assets` lists every other file in the bundle with its path and SHA-256 (filled by the packer).',
    'Remove `assets` from your source est.json: `est pack` writes it.'),
  r('EST-M011', 'manifest', 'The audio ports are not valid',
    '`audio.inputs` and `audio.outputs` each list at most one main port of 1 or 2 channels; an effect needs both. EST 1.1 allows up to 8 channels on a main port and a second input, the sidechain (EST-M021).',
    'Set `"audio": { "inputs": [{ "channels": 2 }], "outputs": [{ "channels": 2 }] }` (an instrument: no inputs).'),
  r('EST-M012', 'manifest', 'The note ports are not valid',
    '`notes.inputs` and `notes.outputs` are 0 or 1; an instrument needs a note input.',
    'For an instrument set `"notes": { "inputs": 1, "outputs": 0 }`.'),
  r('EST-M013', 'manifest', 'The limits are not valid',
    '`limits.maxLatencyFrames` (0 to 192000), `limits.memoryPagesMax` (1 to 2048 pages of 64 KiB; default 256) and `limits.tailSeconds` (0 to 60) are whole numbers. They are the most the plugin may use: the host holds it to them.',
    'Set each limit to a whole number in its range, at least what the plugin uses.'),
  r('EST-M014', 'manifest', 'Permissions asked for',
    'EST 1.0 grants a plugin no permissions (no network, files, devices or clock beyond its own): `permissions` is empty or absent.',
    'Set `"permissions": []` and do the work inside the plugin, or with the host\'s parameters and state.'),
  r('EST-M015', 'manifest', 'The parameters list is not valid',
    '`parameters` mirrors the module\'s parameters, at most 512, each `{ "id", "name", "unit" }` with a whole-number id and a plain-text name (255) and unit (16), and optionally `"scale"`: `"linear"` (the default) or `"log"` (spec §1).',
    'List each parameter the DSP declares, with the same id and name; a `scale` is `"linear"` or `"log"`.'),
  r('EST-M016', 'manifest', 'The state version is not valid',
    '`stateVersion` is a whole number from 1: the version of the state the plugin saves (a preset names the version it was saved with).',
    'Set `"stateVersion": 1`, and raise it when the saved state\'s layout changes.'),
  r('EST-M017', 'manifest', 'The presets entry is not valid',
    '`presets` names the bundle\'s preset index, a `.json` path in the bundle, listed in est.json like every file.',
    'Set `"presets": "presets/index.json"` and keep the index in the plugin\'s `presets/` folder, or remove `presets`.'),
  r('EST-M018', 'manifest', 'A zero-width or direction character in a text field',
    'A text field (the name, vendor, description, a parameter or preset name, a tag) holds a zero-width (U+200B–U+200F) or bidirectional control character (U+202A–U+202E, U+2066–U+2069), which can make one name look like another (1.314, EST-14).',
    'Remove the character; write the name as it reads.'),
  // EST 1.1 (1.327, DEV-H, D-56).
  r('EST-M019', 'manifest', 'An EST edition this host does not run',
    '`abi.est` names an EST edition newer than this host runs (Cyber runs EST 1.0 and 1.1). A newer edition can mean things an older host would misread, so the bundle is refused rather than run as if it were 1.0.',
    'Update Cyber, or set `"abi": { "est": "1.1" }` (or `"1.0"`) and keep to that edition\'s fields.'),
  r('EST-M020', 'manifest', 'An EST 1.1 field in an EST 1.0 manifest',
    'The manifest uses a field EST 1.1 added (a sidechain input, more than two channels, `modulatable`, `ui.audio`, a preset\'s `image` or `author`) but says `"abi": { "est": "1.0" }`. A 1.0 bundle keeps 1.0\'s meaning exactly, so its new fields are refused rather than ignored.',
    'Set `"abi": { "est": "1.1", "clap": "1.2" }`, or remove the field.'),
  r('EST-M021', 'manifest', 'The sidechain input is not valid',
    'In EST 1.1 an effect may list a second input port after its main one, `{ "role": "sidechain", "channels": 1 }` (or 2): the key Cyber feeds from a track or a return, as it keys its own Compressor. The first port is the main one; only one sidechain, and it follows a main input.',
    'Write `"inputs": [{ "channels": 2 }, { "role": "sidechain", "channels": 2 }]` on an effect.'),
  // 1.337 (R-F): the work order named this rule EST-M021, which the sidechain already held (1.327); an id is never reused.
  r('EST-M022', 'manifest', 'The migrate list is not valid',
    'A version may say what it does with its earlier versions\' settings: `migrate` is a list of at most 32 entries `{ from: "<range>", params: { "<old id>": "<new id>" | null }, state: "keep" | "drop" }`. `from` is a version range (comparators separated by spaces, `>=1.0.0 <1.2.0`, a single version, or `*`); every id is a CLAP id as a decimal string and every new id is one the manifest\'s `parameters` list names (so a manifest with `migrate` lists its parameters); `state` is `keep` (the default) or `drop`. When a project moves a slot to this version, Cyber applies the first entry whose range takes the version moved from: renamed values move, `null` drops, an old id the new version does not know is dropped with a note, and `drop` leaves the saved state behind.',
    'Fix the entry the message names: a range such as `">=1.0.0 <1.2.0"`, ids as strings (`"3": "7"`), a new id that `parameters` lists, and `"state": "keep"` or `"drop"`.'),

  // --- EST-W: the module --------------------------------------------------------------------
  r('EST-W001', 'module', 'Not a WebAssembly 1.0 module',
    'The module is a core WebAssembly binary, version 1 (not a component, not text, not another format).',
    'Build for `wasm32-unknown-unknown` (Rust) or with `asc … --target release` (AssemblyScript), and point est.json\'s `module.path` at the `.wasm` it writes.'),
  r('EST-W002', 'module', 'A malformed module',
    'The module\'s sections could not be read (truncated numbers or names, sections out of order, an unknown section or import kind).',
    'Rebuild the module with the template\'s build; do not post-process it with tools that rewrite sections.'),
  r('EST-W003', 'module', 'A required export is missing',
    'An EST module exports `clap_entry` (a global: the address of its CLAP entry), `malloc` and `free` (functions the host allocates with) and its `memory` (spec §3.1).',
    'Keep the SDK\'s glue (it exports all four); in AssemblyScript keep `export { clap_entry, free } from "…/est"` and the runtime\'s `malloc`.'),
  r('EST-W004', 'module', 'The module imports something EST does not allow',
    'A module may import only the WASI functions the host provides (`clock_time_get`, `random_get`, `fd_write`, `proc_exit`, `args_get`, `args_sizes_get`, `environ_get`, `environ_sizes_get` from `wasi_snapshot_preview1`), and nothing else: no `env` functions, no imported memory, table or global.',
    'Remove the code that needs the import (in Rust: `std` I/O, threads, `getrandom`\'s JS backend; in AssemblyScript: `Math.random`, which imports `env.seed` (use an xorshift seeded from a constant), `console` and `trace`, `Date`, host bindings, and the runtime\'s `env.abort` unless it is overridden as the template\'s asconfig.json does), or build with `#![no_std]` as the template does.'),
  r('EST-W005', 'module', 'Not exactly one table',
    'The module has and exports exactly one function table (growable: the host adds its callbacks to it).',
    'Link with `--export-table --growable-table` (the template\'s `.cargo/config.toml`; AssemblyScript: `"exportTable": true`).'),
  r('EST-W006', 'module', 'An export uses a name the host reserves',
    'The module exports `refuel` or `fuel_left`, names the host\'s metering adds.',
    'Rename that export.'),
  r('EST-W007', 'module', 'No memory of its own',
    'The module defines and exports its own linear memory; it may not import one.',
    'Do not link with `--import-memory`; keep the template\'s link flags.'),
  r('EST-W008', 'module', 'A memory EST 1.0 does not run',
    'EST 1.0 modules have one 32-bit, unshared memory: no memory64, no shared memory (threads), no second memory.',
    'Build for wasm32 without threads or atomics, with one memory.'),
  r('EST-W009', 'module', 'The module\'s memory is over est.json\'s limit',
    'The memory\'s initial size, and its declared maximum, are within est.json\'s `limits.memoryPagesMax` (and the hard cap of 2048 pages, 128 MiB): the host never lets a module grow past the limit it declared.',
    'Raise `limits.memoryPagesMax` to the module\'s maximum, or lower the module\'s (`--max-memory=<bytes>`, AssemblyScript\'s `maximumMemory`).'),
  r('EST-W010', 'module', 'No memory maximum',
    'The module declares a maximum for its memory, within its limit, so the host can bound it.',
    'Link with `--max-memory=<bytes>` (AssemblyScript: `"maximumMemory": <pages>`), at most `limits.memoryPagesMax` pages.'),
  r('EST-W011', 'meter', 'A WebAssembly feature EST does not run',
    'The host meters every module (it counts its work so a runaway loop becomes a trap) and runs only the features the meter knows: the MVP, mutable globals, bulk memory, sign extension, non-trapping conversions, multi-value, reference types and fixed-width SIMD. Relaxed SIMD (its results differ between machines), threads and atomics, exceptions, GC, tail calls, memory64 and multi-memory are refused.',
    'Turn the feature off in the build (Rust: no `+relaxed-simd`, `+atomics`, `+exception-handling` target features; AssemblyScript: the template\'s `"disable"` list).'),
  r('EST-W012', 'meter', 'The module imports env.log_execution',
    'The meter places its counting points through an import of that name; a module that already has it cannot be metered.',
    'Remove the `env.log_execution` import.'),
  r('EST-W013', 'meter', 'An instruction the meter does not know',
    'The meter rewrites every function and refuses any expression kind it would otherwise leave unmetered (table and reference instructions among them), rather than run code it cannot bound.',
    'Avoid table and reference instructions (`table.get`, `table.set`, `ref.func` in code …); keep to the SDK\'s glue for the function table.'),
  r('EST-W014', 'meter', 'The module could not be metered or compiled',
    'The meter could not read or rewrite the module, or the metered module did not compile or lost its fuel exports.',
    'Rebuild with the template\'s settings; if it persists, report the module (with `est inspect`\'s output) to the SDK.'),
  r('EST-W015', 'conformance', 'A start function',
    'The module has a start function. A start function runs when the module is instantiated, before the host can give the metered module any fuel, so it traps. Set-up work belongs in an exported `_initialize()` (the WASI reactor convention, spec §3.1), which the host calls once with fuel before `clap_entry`, or in the plugin\'s `init` or `activate` (or on the first `malloc`).',
    'Remove the start function and export its work as `_initialize()` instead (Rust: no `#[start]` or constructors; AssemblyScript: no top-level statements with effects, keep `"exportStart"` unset and globals constant, or `"exportStart": "_initialize"`).'),

  r('EST-W016', 'conformance', 'The module\'s _initialize trapped or ran out of fuel',
    'A module may export `_initialize()` (the WASI reactor convention, spec §3.1): the host calls it once, right after instantiation and before `clap_entry`, with a block\'s worth of fuel. It trapped (an `unreachable`, an out-of-bounds access) or did not finish within that fuel, so the plugin cannot start.',
    'Keep `_initialize` to bounded set-up work (tables, constants), move anything long to `activate`, and check it for out-of-bounds writes; run `est test` to see the message.'),

  r('EST-W017', 'module', 'A WASI import with the wrong type',
    'The module imports one of the WASI functions EST allows (`random_get`, `fd_write`, `clock_time_get` …) with a type that is not WASI preview 1\'s. The host reads an import\'s arguments by its own types, so a `random_get(f64, f64)` would hand it a length of any size: the import is refused before anything runs (1.314, LR-8b).',
    'Import the function with its preview-1 type (`random_get(i32 buf, i32 len) -> i32`; the SDK\'s templates and Rust\'s `wasi` crate do), or do not import it.'),

  // --- EST-C: conformance -------------------------------------------------------------------
  r('EST-C001', 'conformance', 'The plugin does not start',
    'The host could not instantiate the module and create, initialise and activate the plugin through its CLAP entry and factory (the lifecycle order clap-validator checks), or the module trapped while doing so.',
    'Check that est.json\'s `id` is the descriptor\'s id, that `init` and `activate` return true, and that nothing traps before the first block (run `est test` and read the phase in the message).'),
  r('EST-C002', 'conformance', 'The module is not metered',
    'The host runs only metered modules (D-30). The install meters every module itself, so this fails only when a module was run without it.',
    'Install the bundle through the host (or `est validate`), which meters it.'),
  r('EST-C003', 'conformance', 'The audio ports differ from est.json',
    'The ports the plugin reports (clap.audio-ports) match est.json\'s `audio`: an effect has a main input and output, an instrument a main output, each with the channel count est.json gives.',
    'Make the DSP\'s audio ports and est.json\'s `audio` agree.'),
  r('EST-C004', 'conformance', 'The note ports differ from est.json',
    'An instrument reports a note input port (clap.note-ports), as many as est.json\'s `notes.inputs`; any plugin reports as many note outputs as `notes.outputs`, and an effect as many note inputs as `notes.inputs` (a note effect has one of each).',
    'Declare the note ports in the DSP (the SDK\'s instrument glue declares an input; a note effect\'s, `export_note_effect!` or `Descriptor.noteEffect()`, one each way) and set `"notes"` to match: `{ "inputs": 1, "outputs": 0 }` for an instrument, `{ "inputs": 1, "outputs": 1 }` for a note effect.'),
  r('EST-C005', 'conformance', 'A latency over est.json\'s limit',
    'The latency the plugin reports (clap.latency) is at most `limits.maxLatencyFrames`.',
    'Raise `limits.maxLatencyFrames` to the latency the plugin reports, or report less.'),
  r('EST-C006', 'conformance', 'A tail over est.json\'s limit',
    'The tail the plugin reports (clap.tail) is at most `limits.tailSeconds` (one second of grace).',
    'Raise `limits.tailSeconds`, or report the tail the DSP actually has.'),
  r('EST-C007', 'conformance', 'The parameters are not sane',
    'At most 512 parameters, each id once, each with a finite range (`min` ≤ `default` ≤ `max`).',
    'Fix the parameter the message names in the DSP\'s parameter declaration.'),
  r('EST-C008', 'conformance', 'The parameters differ from est.json',
    'The ids the plugin reports (clap.params) are exactly the ids est.json\'s `parameters` lists.',
    'List every parameter the DSP declares in est.json (same ids), and none it does not.'),
  r('EST-C009', 'conformance', 'The state is too large',
    'A plugin\'s saved state is at most 4 MiB (spec §6). The runtime refuses a save past 4 MiB as it is written and answers that the state is too large, which the install names as this rule (and it checks the bytes a save hands back against the same cap).',
    'Save settings, not buffers or caches; rebuild those on load.'),
  r('EST-C010', 'conformance', 'The state does not round-trip',
    'Saving the state, loading it and saving again gives the same bytes, and the plugin accepts its own state (clap-validator\'s state round trip). A project reopens the plugin from its state, so anything else changes the sound or loses settings.',
    'Make `saveState` write only what `loadState` reads back (no counters, time or addresses), and `loadState` accept every state `saveState` writes.'),
  r('EST-C011', 'conformance', 'The plugin stopped while saving its state',
    'The module trapped, or ran out of fuel, inside clap.state\'s `save` (the install\'s state check asks once and reads everything the instance posts).',
    'Check the state code for out-of-bounds writes and loops that never end.'),
  r('EST-C012', 'conformance', 'A bundle preset does not load',
    'Each preset in the bundle is a state the plugin accepts (clap.state `load` returns true).',
    'Write the presets with the plugin\'s own `saveState` (the template\'s preset script), at the current state version or one `loadState` migrates.'),
  r('EST-C013', 'conformance', 'The plugin stopped while processing',
    'The module trapped (an `unreachable`, an out-of-bounds access, a division by zero, a stack overflow) or ran out of fuel (a loop that does not end in time) during the test signal: tones, noise, silence, clicks and every parameter swept by events.',
    'The most common cause in a first plugin is allocating in `render()`: the SDK\'s heap never gives memory back, so a `new`, an array or a string made each block runs it out. Allocate in the constructor, field initialisers or `activate`, keep every loop bounded by the block, then run `est test` and find the block and the phase in the message.'),
  r('EST-C014', 'conformance', 'The output is not finite',
    'The plugin wrote NaN or infinity. One NaN in a feedback path silences or destroys a whole mix.',
    'Guard divisions and `log`/`sqrt` against zero and negatives, flush denormals, and clamp feedback below 1.'),
  r('EST-C015', 'conformance', 'The output is too loud',
    'The output passed +18 dBFS under the test signal (full-scale clicks with every parameter at its extremes). In a project the host clamps every sample it sends to the graph to ±4 (+12 dBFS) and counts what it limited (1.314, "Output limited" on the card), so a loud plugin is bounded; one this loud is refused.',
    'Bound the gain stages (clamp feedback and resonance, limit the output) at every parameter\'s extremes.'),
  r('EST-C016', 'conformance', 'An instrument made no sound for a held note',
    'A held note (key 60, velocity 0.8) must reach at least −80 dBFS.',
    'Check note-on handling (the note port, the voice start, the envelope\'s attack) and that the output is written.'),
  r('EST-C017', 'conformance', 'An instrument sounds past its reported tail',
    'After a note\'s release, the output falls below −60 dBFS within the tail the plugin reports (clap.tail): the host stops processing a silent instrument after its tail.',
    'Report a tail at least the longest release, or make the release end within the tail.'),
  r('EST-C018', 'determinism', 'Two renders differ',
    'Two runs of the same input and events are bit-identical. A project renders the same everywhere (offline export, two peers in a live room) only if the plugin is deterministic; reading `random_get` or the clock in `process` breaks it.',
    'Seed any randomness from a constant (or the state) at `activate`, never from `random_get` or the clock, and keep no state between instances.', 'error', false),
  r('EST-C019', 'determinism', 'A preset does not save back its own bytes',
    'A bundle preset, loaded and saved again, gives other bytes. It loads, but a project saved with it differs from the preset.',
    'Write the presets with the plugin\'s own `saveState` at the current state version.', 'warning', false),
  r('EST-C020', 'conformance', 'The state could not be saved',
    'Asked for its state, the plugin refused: clap.state\'s `save` returned false, or the plugin has no clap.state. A project saves every plugin\'s state; one that cannot be saved loses its settings, so the install refuses it (a trap in the save is EST-C011, a state over 4 MiB EST-C009).',
    'Implement clap.state (the SDK\'s glue does) and make `saveState` return true.'),
  r('EST-C021', 'conformance', 'A log parameter\'s range does not stay above 0',
    'est.json marks the parameter `"scale": "log"`, so knobs, sliders and automation move over its range geometrically (a lane\'s midpoint is the geometric middle). That needs a continuous range above 0: the range the plugin reports (clap.params) starts at 0 or below, or the parameter is stepped. Only the module knows the range, so the conformance run checks it.',
    'Start the range above 0 (a frequency from 20 Hz, a time from 1 ms), or remove `"scale": "log"` from that parameter in est.json (in the DSP, `.log()` on the builder checks the same).'),
  r('EST-C022', 'conformance', 'A modulatable parameter is not modulatable in the DSP',
    'est.json marks the parameter `"modulatable": true`, so Cyber\'s modulators (LFOs, clip envelopes) send it `CLAP_EVENT_PARAM_MOD` events, but the DSP does not flag it `CLAP_PARAM_IS_MODULATABLE` (clap.params): the plugin would ignore them. EST 1.1 (1.327).',
    'Flag the parameter modulatable in the DSP (`.modulatable()` on the builder), or remove `"modulatable": true` from est.json.'),
  r('EST-C023', 'conformance', 'The note output differs from est.json',
    'est.json says `"notes": { "outputs": 1 }` on an EST 1.1 plugin, so Cyber routes its notes to the next plugin on the track and records them, but the plugin reports no note output port (clap.note-ports), or reports one est.json does not declare.',
    'Declare a note output port in the DSP and set `"notes": { "outputs": 1 }`, or remove both.'),

  // --- EST-U: the UI ------------------------------------------------------------------------
  r('EST-U001', 'ui', 'The UI page is not readable HTML',
    'The page est.json\'s `ui.path` names is UTF-8 HTML.',
    'Save the page as UTF-8 with an `<html>` element (start from a template\'s `ui/index.html`).', 'error', false),
  r('EST-U002', 'ui', 'The UI reaches an external host',
    'A plugin UI runs in a sandboxed frame on the plugin origin and may load only files from its own bundle: a URL to another host (`http:`, `https:`, `//host`, `ws:`) in its HTML, scripts or styles would not load, and is refused so a UI cannot phone home.',
    'Copy the file into the bundle (in `ui/`) and refer to it by a relative path; for @cyber-est/ui use the `ui/est-ui.js` that `est pack` copies.', 'error', false),
  r('EST-U003', 'ui', 'A UI URL outside the bundle',
    'Every URL in the UI\'s HTML, scripts and styles is relative and names a file in the bundle: a root-relative (`/x`) or escaping (`../../x`) URL, or one to a missing file, does not resolve inside the bundle\'s folder on the plugin origin.',
    'Use a relative path to a file inside the bundle (`ui.js`, `img/knob.png`), and check the file is packed.', 'error', false),
  r('EST-U004', 'ui', 'The UI is large',
    'The UI\'s files total more than 4 MiB; every install downloads and stores them.',
    'Compress images, drop unused fonts and source maps, and minify scripts.', 'warning', false),
  r('EST-U005', 'ui', 'The UI page loads a module script',
    'A UI page with a `<script type="module">`, a `crossorigin` attribute on any element or a `<link rel="modulepreload">` shows a blank frame: the frame\'s origin is opaque (`sandbox="allow-scripts"`), so a module script, a module preload and a `crossorigin` load are CORS requests, which the plugin origin does not answer. A bundler\'s default page (Vite\'s) has all three. (1.335)',
    'Load a classic script: build the app into one `iife` bundle and load it with `<script defer src="assets/app.js">`, with no `type="module"`, no `crossorigin` and no `modulepreload` (see ui.md, "A whole app as the window"; `est new … --app` scaffolds a Vite build that does this).', 'error', false),

  // --- EST-P: performance --------------------------------------------------------------------
  r('EST-P001', 'performance', 'A block costs more than the budget',
    'The mean cost of one 128-frame block in the conformance run, metered, on the validating machine, against a budget of 100 µs (about 4 % of the block\'s real time at 48 kHz). A warning only in Phase 4: the budget is recorded, not enforced, and the number depends on the machine.',
    'Profile `process`: avoid per-sample divisions, `pow` and `exp` (smooth instead), and recomputing coefficients that have not changed.', 'warning', false),
];

/** The rule with this id (throws on an unknown id: ids are fixed). */
export function estRule(id: string): EstRule {
  const found = EST_RULES.find(x => x.id === id);
  if (!found) throw new Error(`unknown EST rule ${id}`);
  return found;
}

/** What the rules JSON holds (est-validator-rules.json): the table without the private fields' types. */
export function estRulesJson(): { id: string; title: string; explain: string; fix: string; severity: EstRuleSeverity; step: EstRuleStep; install: boolean }[] {
  return EST_RULES.map(x => ({ id: x.id, title: x.title, explain: x.explain, fix: x.fix, severity: x.severity, step: x.step, install: x.install }));
}
