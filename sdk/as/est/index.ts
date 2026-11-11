// est: the EST SDK for AssemblyScript, the twin of the Rust crate (sdk/rust/est). An EST module is
// a wasm32 CLAP 1.2 plugin with WCLAP's shape (the specification draft §3): it exports
// `clap_entry`, `malloc`, `free`, one growable function table and its memory, and imports
// nothing. A plugin extends `Effect` or `Instrument`, declares its parameters once (`Param`), and
// carries the export block (the plugin's own assembly/index.ts; every template has it):
//
//     export { clap_entry, free } from "est";
//     export function malloc(size: usize): usize {
//       if (!isReady()) setup(describe(), parameters(), make);
//       return alloc(size);
//     }
//
// Build with asconfig.json's options: `"path"` naming the folder that holds this `est` folder (so
// `import … from "est"` finds it through its package.json), `"runtime"` naming this folder's
// `runtime` (`<that folder>/est/runtime`), `"exportTable": true`, a `maximumMemory` within
// est.json's `limits.memoryPagesMax`, `"use": ["abort=assembly/index/abort"]` (an `abort` that
// traps: EST modules import nothing), and GC, exceptions, relaxed SIMD, threads and tail calls
// disabled.
//
// The names are the Rust crate's in camelCase (`param_changed` → `paramChanged`). Where
// AssemblyScript cannot match Rust, it differs as follows:
// - a `Param`'s fields carry a suffix (`defaultValue`, `unitText`, `decimalCount`, `labelList`,
//   `modulePath`): a class's fields and methods share one namespace, and the builder's methods
//   (`range`, `default`, `unit`, `decimals`, `labels`, `module`, `hertz`, `bypass`) keep Rust's names;
// - parameters are a function's list passed to `setup` (Rust: the `PARAMS` constant), and the
//   identity a `Descriptor` (Rust: `export_effect!`'s arguments); the first feature decides the kind;
// - `Plugin` is one base class with every hook; `Effect` and `Instrument` extend it (Rust: two
//   traits); an effect's note hooks are simply never called;
// - an `Event` from `events.get(k)` is one reused object, valid until the next `get` (Rust returns
//   a copy); `Event.midi` is a `StaticArray<u8>` of three;
// - enums have no methods: `waveFromIndex`, `filterModeFromIndex`, `biquadKindFromIndex` (Rust:
//   `Wave::from_index` …);
// - `coefficientsInto(out, …)` writes a Biquad's coefficients (Rust: `coefficients(…)` returns them);
// - `new Voices<T>(n)` makes its voices with `instantiate<T>()`, so a voice class has a constructor
//   without arguments (Rust: `Voices::<T, N>::new(make)`); `voices.voice(i)` is the voice itself
//   (Rust: `voice` and `voice_mut`);
// - `Io` gives `setParam` and `lastSet` to the glue (Rust keeps them private);
// - one instance per module, and allocation only in `setup`, the constructors and `activate`
//   (the runtime is a bump allocator: ./runtime.ts).
// Licence: MIT.

export * from "./plugin";
export * from "./dsp/index";
export { clap_entry, alloc, free, isReady, setup } from "./glue";
export { clamp, cosTurns, exp, exp2, floor, ln, log2, onePole, round, sinTurns, tanHalfTurns } from "./math";
