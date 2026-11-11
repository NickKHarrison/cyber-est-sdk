// Cookbook Chorus (org.example.cookbook-chorus), from the EST cookbook: two modulated delay lines, a quarter-turn apart. The recipe's
// page is README.md; `est new chorus <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { DelayLine, Descriptor, Effect, Io, Lfo, Param, Plugin, Smoother, Wave, alloc, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-chorus", "Cookbook Chorus", "Example", "1.0.0",
    "A stereo chorus: a modulated delay per channel, the two LFOs a quarter-turn apart, mixed with the dry signal.",
    ["audio-effect", "chorus", "stereo"], "CKCH", 1);
}
const RATE: u32 = 0;
const DEPTH: u32 = 1;
const DELAY: u32 = 2;
const MIX: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(RATE, "Rate").range(0.05, 5).default(0.8).unit("Hz").decimals(2),
    new Param(DEPTH, "Depth").range(0, 10).default(3).unit("ms").decimals(1),
    new Param(DELAY, "Delay").range(5, 30).default(12).unit("ms").decimals(1),
    new Param(MIX, "Mix").range(0, 100).default(50).unit("%").decimals(0),
  ];
}

class Template extends Effect {
  sampleRate: f64 = 48000;
  lines: StaticArray<DelayLine> = [new DelayLine(), new DelayLine()];
  lfos: StaticArray<Lfo> = [new Lfo(), new Lfo()];
  depth: Smoother = new Smoother(0.05);
  delay: Smoother = new Smoother(0.05);
  mix: Smoother = new Smoother(0.02);

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    for (let c = 0; c < 2; c++) {
      if (!this.lines[c].allocate(<i32>(sampleRate * 0.05) + 2)) return false; // 50 ms: Delay + Depth at most
      this.lfos[c].setSampleRate(sampleRate);
      this.lfos[c].setWave(Wave.Sine);
    }
    this.depth.setSampleRate(sampleRate);
    this.delay.setSampleRate(sampleRate);
    this.mix.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void {
    for (let c = 0; c < 2; c++) { this.lines[c].clear(); this.lfos[c].reset(<f64>c * 0.25); }
    this.depth.reset(); this.delay.reset(); this.mix.reset();
  }

  paramChanged(id: u32, value: f64): void {
    if (id == RATE) { this.lfos[0].setRate(value); this.lfos[1].setRate(value); }
    else if (id == DEPTH) this.depth.setTarget(value);
    else if (id == DELAY) this.delay.setTarget(value);
    else if (id == MIX) this.mix.setTarget(value / 100);
  }

  render(io: Io, from: i32, to: i32): void {
    const msToFrames = this.sampleRate / 1000.0;
    for (let n = from; n < to; n++) {
      const depth = this.depth.next(), delay = this.delay.next(), mix = this.mix.next();
      for (let c = 0; c < 2; c++) {
        const m = this.lfos[c].next(); // -1…1, both advanced even for a mono input
        if (c >= io.channels) continue;
        const x = <f64>io.input(c, n);
        const line = this.lines[c];
        line.write(x);
        const wet = line.read((delay + depth * 0.5 * (1.0 + m)) * msToFrames);
        io.output(c, n, <f32>(x * (1.0 - mix) + wet * mix));
      }
    }
  }

  tail(): u32 { return <u32>(this.sampleRate * 0.05); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
