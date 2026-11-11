// EST Effect Template (AS) (org.example.est-effect-template-as): an EST effect in AssemblyScript,
// made from the effect-as template, which starts as a smoothed gain into a state-variable filter.
// Write your DSP in `render`, keep est.json's identity and parameters in step with `describe()` and
// `parameters()`, then (see AGENTS.md):
//
//     est pack        # asc (asconfig.json's release target), then the bundle in dist/
//     est validate    # the checks Cyber's install runs; read dist/validation.json
//     est test        # the golden render in test/ plus the conformance run
//
// The rules: declare every parameter once in `parameters()` (and list it in est.json); allocate
// (`new`, arrays, strings) only in the constructor, field initialisers and `activate`; nothing
// allocates in `render`, `process` or `paramChanged`; no top-level code but constants (an EST
// module may have no start function).

import {
  Descriptor, Effect, Filter, Io, Param, Plugin, Smoother,
  alloc, dbToGain, filterModeFromIndex, isReady, setup,
} from "est";

// --- The export block every EST plugin in AssemblyScript carries: `clap_entry`, `free`, and a
// `malloc` that writes the plugin's structs before its first allocation.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-effect-template-as", "EST Effect Template (AS)", "Example", "1.0.0",
    "A smoothed gain into a resonant filter: the starting point for an EST effect in AssemblyScript.",
    ["audio-effect", "filter", "stereo"], "TMPE", 1);
}

const GAIN: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const MODE: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(GAIN, "Gain").range(-60, 12).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(20000).hertz().module("Filter"),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0).module("Filter"),
    new Param(MODE, "Mode").labels(["Low-pass", "Band-pass", "High-pass", "Notch"]).module("Filter"),
  ];
}

class Template extends Effect {
  gain: Smoother = new Smoother(0.005);
  left: Filter = new Filter();
  right: Filter = new Filter();
  sampleRate: f64 = 48000;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.gain.setSampleRate(sampleRate);
    this.left.setSampleRate(sampleRate);
    this.right.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void {
    this.gain.reset();
    this.left.reset();
    this.right.reset();
  }

  paramChanged(id: u32, value: f64): void {
    if (id == GAIN) this.gain.setTarget(dbToGain(value));
    else if (id == CUTOFF) { this.left.setCutoff(value); this.right.setCutoff(value); }
    else if (id == RESONANCE) { this.left.setResonance(value); this.right.setResonance(value); }
    else if (id == MODE) { this.left.setMode(filterModeFromIndex(value)); this.right.setMode(filterModeFromIndex(value)); }
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const g = this.gain.next();
      if (io.channels > 0) io.output(0, n, <f32>(this.left.process(<f64>io.input(0, n)) * g));
      if (io.channels > 1) io.output(1, n, <f32>(this.right.process(<f64>io.input(1, n)) * g));
    }
  }

  /** A resonant filter rings on after its input stops: a second covers it. */
  tail(): u32 { return <u32>this.sampleRate; }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
