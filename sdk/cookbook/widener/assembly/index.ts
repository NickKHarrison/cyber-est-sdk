// Cookbook Stereo Widener (org.example.cookbook-widener), from the EST cookbook: mid and side, the side scaled. The recipe's
// page is README.md; `est new widener <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-widener", "Cookbook Stereo Widener", "Example", "1.0.0",
    "A stereo widener: the signal as mid and side, the side scaled by Width (0 % mono, 100 % unchanged, 200 % twice as wide).",
    ["audio-effect", "utility", "stereo"], "CKSW", 1);
}
const WIDTH: u32 = 0;

function parameters(): Param[] {
  return [new Param(WIDTH, "Width").range(0, 200).default(150).unit("%").decimals(0)];
}

class Template extends Effect {
  width: Smoother = new Smoother(0.02);

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.width.setSampleRate(sampleRate);
    this.width.reset();
    return true;
  }

  reset(): void { this.width.reset(); }

  paramChanged(id: u32, value: f64): void { if (id == WIDTH) this.width.setTarget(value / 100); }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const w = this.width.next();
      if (io.channels < 2) { io.output(0, n, io.input(0, n)); continue; } // mono: nothing to widen
      const l = <f64>io.input(0, n), r = <f64>io.input(1, n);
      const mid = (l + r) * 0.5, side = (l - r) * 0.5 * w;
      io.output(0, n, <f32>(mid + side));
      io.output(1, n, <f32>(mid - side));
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
