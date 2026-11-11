// Cookbook Auto-Wah (org.example.cookbook-auto-wah), from the EST cookbook: an envelope follower sweeping a band-pass. The recipe's
// page is README.md; `est new auto-wah <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Filter, FilterMode, Io, Param, Plugin, alloc, dbToGain, exp2, isReady, onePole, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-auto-wah", "Cookbook Auto-Wah", "Example", "1.0.0",
    "An auto-wah: an envelope follower on the input sweeps a resonant band-pass filter up from Base by up to Range octaves.",
    ["audio-effect", "filter", "stereo"], "CKAW", 1);
}
const SENSITIVITY: u32 = 0;
const BASE: u32 = 1;
const RANGE: u32 = 2;
const RESONANCE: u32 = 3;
const MIX: u32 = 4;

function parameters(): Param[] {
  return [
    new Param(SENSITIVITY, "Sensitivity").range(0, 24).default(6).unit("dB").decimals(1),
    new Param(BASE, "Base").range(100, 2000).default(300).hertz(),
    new Param(RANGE, "Range").range(0, 4).default(3).unit("oct").decimals(1),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.7).decimals(2),
    new Param(MIX, "Mix").range(0, 100).default(100).unit("%").decimals(0),
  ];
}

class Template extends Effect {
  filters: StaticArray<Filter> = [new Filter(), new Filter()];
  env: f64 = 0;
  up: f64 = 1;
  down: f64 = 1;
  gain: f64 = 2;
  base: f64 = 300;
  range: f64 = 3;
  mix: f64 = 1;

  constructor() { super(); for (let c = 0; c < 2; c++) this.filters[c].setMode(FilterMode.Band); }

  activate(sampleRate: f64, maxFrames: u32): bool {
    for (let c = 0; c < 2; c++) { this.filters[c].setSampleRate(sampleRate); this.filters[c].setSmoothing(0.002); }
    this.up = onePole(0.002, sampleRate);   // the follower rises in 2 ms
    this.down = onePole(0.08, sampleRate);  // and falls in 80 ms
    this.reset();
    return true;
  }

  reset(): void { this.env = 0; for (let c = 0; c < 2; c++) this.filters[c].reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == SENSITIVITY) this.gain = dbToGain(value);
    else if (id == BASE) this.base = value;
    else if (id == RANGE) this.range = value;
    else if (id == RESONANCE) for (let c = 0; c < 2; c++) this.filters[c].setResonance(value);
    else if (id == MIX) this.mix = value / 100;
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const l = <f64>io.input(0, n), r = io.channels > 1 ? <f64>io.input(1, n) : l;
      const level = (abs<f64>(l) + abs<f64>(r)) * 0.5 * this.gain;
      this.env += (level - this.env) * (level > this.env ? this.up : this.down);
      const cutoff = this.base * exp2(this.range * min<f64>(this.env, 1.0));
      for (let c = 0; c < io.channels; c++) {
        const f = this.filters[c];
        f.setCutoff(cutoff);
        const x = <f64>io.input(c, n);
        io.output(c, n, <f32>(x * (1.0 - this.mix) + f.process(x) * this.mix));
      }
    }
  }

  tail(): u32 { return 4800; }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
