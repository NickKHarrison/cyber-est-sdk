// Cookbook Bitcrusher (org.example.cookbook-bitcrusher), from the EST cookbook: fewer bits and a lower sample rate. The recipe's
// page is README.md; `est new bitcrusher <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Io, Param, Plugin, alloc, exp2, floor, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-bitcrusher", "Cookbook Bitcrusher", "Example", "1.0.0",
    "A bitcrusher: the signal quantised to fewer bits and held for several samples, mixed with the dry signal.",
    ["audio-effect", "distortion", "stereo"], "CKBC", 1);
}
const BITS: u32 = 0;
const DOWNSAMPLE: u32 = 1;
const MIX: u32 = 2;

function parameters(): Param[] {
  return [
    new Param(BITS, "Bits").range(1, 16).default(8).decimals(1),
    new Param(DOWNSAMPLE, "Downsample").range(1, 32).default(4).decimals(0),
    new Param(MIX, "Mix").range(0, 100).default(100).unit("%").decimals(0),
  ];
}

class Template extends Effect {
  steps: f64 = 128;
  hold: i32 = 4;
  mix: f64 = 1;
  count: i32 = 0;
  held: StaticArray<f64> = new StaticArray<f64>(2);

  reset(): void { this.count = 0; this.held[0] = 0; this.held[1] = 0; }

  paramChanged(id: u32, value: f64): void {
    if (id == BITS) this.steps = exp2(value - 1); // levels each side of zero
    else if (id == DOWNSAMPLE) this.hold = <i32>floor(value + 0.5);
    else if (id == MIX) this.mix = value / 100;
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const take = this.count == 0;
      this.count++;
      if (this.count >= this.hold) this.count = 0;
      for (let c = 0; c < io.channels; c++) {
        const x = <f64>io.input(c, n);
        if (take) this.held[c] = floor(x * this.steps + 0.5) / this.steps; // a new sample, quantised
        io.output(c, n, <f32>(x * (1.0 - this.mix) + this.held[c] * this.mix));
      }
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
