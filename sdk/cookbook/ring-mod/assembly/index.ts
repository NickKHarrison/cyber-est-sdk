// Cookbook Ring Modulator (org.example.cookbook-ring-mod), from the EST cookbook: the input times a sine. The recipe's
// page is README.md; `est new ring-mod <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Io, Oscillator, Param, Plugin, Smoother, Wave, alloc, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-ring-mod", "Cookbook Ring Modulator", "Example", "1.0.0",
    "A ring modulator: the input multiplied by a sine carrier, mixed with the dry signal.",
    ["audio-effect", "stereo"], "CKRM", 1);
}
const FREQUENCY: u32 = 0;
const MIX: u32 = 1;

function parameters(): Param[] {
  return [
    new Param(FREQUENCY, "Frequency").range(1, 5000).default(440).hertz(),
    new Param(MIX, "Mix").range(0, 100).default(100).unit("%").decimals(0),
  ];
}

class Template extends Effect {
  carrier: Oscillator = new Oscillator();
  mix: Smoother = new Smoother(0.02);

  constructor() { super(); this.carrier.setWave(Wave.Sine); }

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.carrier.setSampleRate(sampleRate);
    this.mix.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void { this.carrier.reset(0); this.mix.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == FREQUENCY) this.carrier.setFrequency(value);
    else if (id == MIX) this.mix.setTarget(value / 100);
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const m = this.carrier.next(), mix = this.mix.next();
      for (let c = 0; c < io.channels; c++) {
        const x = <f64>io.input(c, n);
        io.output(c, n, <f32>(x * (1.0 - mix) + x * m * mix));
      }
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
