// Cookbook Schroeder Reverb (org.example.cookbook-schroeder-reverb), from the EST cookbook: four combs and two all-passes per channel. The recipe's
// page is README.md; `est new schroeder-reverb <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { DelayLine, Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-schroeder-reverb", "Cookbook Schroeder Reverb", "Example", "1.0.0",
    "A Schroeder reverb: four damped feedback combs in parallel, then two all-passes, per channel, the right a little longer for width.",
    ["audio-effect", "reverb", "stereo"], "CKRV", 1);
}
const SIZE: u32 = 0;
const DAMPING: u32 = 1;
const MIX: u32 = 2;
const COMBS = 4;
const ALLPASSES = 2;
/** The classic delays, in frames at 44.1 kHz (scaled to the rate); the right channel adds SPREAD. */
const COMB_FRAMES: StaticArray<i32> = [1557, 1617, 1491, 1422];
const ALLPASS_FRAMES: StaticArray<i32> = [225, 556];
const SPREAD = 23;

function parameters(): Param[] {
  return [
    new Param(SIZE, "Size").range(0, 1).default(0.6).decimals(2),
    new Param(DAMPING, "Damping").range(0, 1).default(0.4).decimals(2),
    new Param(MIX, "Mix").range(0, 100).default(30).unit("%").decimals(0),
  ];
}

class Template extends Effect {
  combs: StaticArray<DelayLine> = new StaticArray<DelayLine>(2 * COMBS);
  allpasses: StaticArray<DelayLine> = new StaticArray<DelayLine>(2 * ALLPASSES);
  combDelay: StaticArray<f64> = new StaticArray<f64>(2 * COMBS);
  allpassDelay: StaticArray<f64> = new StaticArray<f64>(2 * ALLPASSES);
  damped: StaticArray<f64> = new StaticArray<f64>(2 * COMBS);
  feedback: f64 = 0.85;
  damping: f64 = 0.4;
  mix: Smoother = new Smoother(0.02);
  sampleRate: f64 = 48000;

  constructor() {
    super();
    for (let i = 0; i < 2 * COMBS; i++) this.combs[i] = new DelayLine();
    for (let i = 0; i < 2 * ALLPASSES; i++) this.allpasses[i] = new DelayLine();
  }

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    const scale = sampleRate / 44100.0;
    for (let c = 0; c < 2; c++) {
      for (let k = 0; k < COMBS; k++) {
        const d = <f64>(COMB_FRAMES[k] + c * SPREAD) * scale;
        this.combDelay[c * COMBS + k] = d;
        if (!this.combs[c * COMBS + k].allocate(<i32>d + 2)) return false;
      }
      for (let k = 0; k < ALLPASSES; k++) {
        const d = <f64>(ALLPASS_FRAMES[k] + c * SPREAD) * scale;
        this.allpassDelay[c * ALLPASSES + k] = d;
        if (!this.allpasses[c * ALLPASSES + k].allocate(<i32>d + 2)) return false;
      }
    }
    this.mix.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void {
    for (let i = 0; i < 2 * COMBS; i++) { this.combs[i].clear(); this.damped[i] = 0; }
    for (let i = 0; i < 2 * ALLPASSES; i++) this.allpasses[i].clear();
    this.mix.reset();
  }

  paramChanged(id: u32, value: f64): void {
    if (id == SIZE) this.feedback = 0.7 + 0.25 * value;
    else if (id == DAMPING) this.damping = value * 0.9;
    else if (id == MIX) this.mix.setTarget(value / 100);
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const mix = this.mix.next();
      const l = <f64>io.input(0, n), r = io.channels > 1 ? <f64>io.input(1, n) : l;
      const x = (l + r) * 0.5 * 0.5; // one input for both channels' tanks, at half level
      for (let c = 0; c < io.channels; c++) {
        let wet = 0.0;
        for (let k = 0; k < COMBS; k++) {
          const i = c * COMBS + k, line = this.combs[i];
          const y = line.read(this.combDelay[i]);
          this.damped[i] = y * (1.0 - this.damping) + this.damped[i] * this.damping; // a low-pass in the loop
          line.write(x + this.damped[i] * this.feedback);
          wet += y;
        }
        wet *= 0.25;
        for (let k = 0; k < ALLPASSES; k++) {
          const i = c * ALLPASSES + k, line = this.allpasses[i];
          const b = line.read(this.allpassDelay[i]);
          line.write(wet + b * 0.5);
          wet = b - wet;
        }
        const dry = <f64>io.input(c, n);
        io.output(c, n, <f32>(dry * (1.0 - mix) + wet * mix));
      }
    }
  }

  /** At Size 1 the combs fall 60 dB in about 4.5 s. */
  tail(): u32 { return <u32>(this.sampleRate * 5.0); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
