// Cookbook Compressor (org.example.cookbook-compressor), from the EST cookbook: a feed-forward compressor, its two channels linked. The recipe's
// page is README.md; `est new compressor <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, dbToGain, gainToDb, isReady, onePole, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-compressor", "Cookbook Compressor", "Example", "1.0.0",
    "A peak compressor with threshold, ratio, attack, release and make-up gain, its channels linked.",
    ["audio-effect", "compressor", "stereo"], "CKCP", 1);
}
const THRESHOLD: u32 = 0;
const RATIO: u32 = 1;
const ATTACK: u32 = 2;
const RELEASE: u32 = 3;
const MAKEUP: u32 = 4;

function parameters(): Param[] {
  return [
    new Param(THRESHOLD, "Threshold").range(-60, 0).default(-18).unit("dB").decimals(1),
    new Param(RATIO, "Ratio").range(1, 20).default(4).decimals(1),
    new Param(ATTACK, "Attack").range(0.1, 100).default(5).unit("ms").decimals(1),
    new Param(RELEASE, "Release").range(5, 1000).default(100).unit("ms").decimals(0),
    new Param(MAKEUP, "Makeup").range(0, 12).default(0).unit("dB").decimals(1),
  ];
}

class Template extends Effect {
  sampleRate: f64 = 48000;
  threshold: f64 = -18;
  ratio: f64 = 4;
  attack: f64 = 0.005;
  release: f64 = 0.1;
  atk: f64 = 1;
  rel: f64 = 1;
  /** The detector: the louder channel's peak, followed fast up and slowly down. */
  env: f64 = 0;
  makeup: Smoother = new Smoother(0.01);

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.makeup.setSampleRate(sampleRate);
    this.makeup.reset();
    this.coefficients();
    this.env = 0;
    return true;
  }

  reset(): void { this.env = 0; this.makeup.reset(); }

  coefficients(): void {
    this.atk = onePole(this.attack, this.sampleRate);
    this.rel = onePole(this.release, this.sampleRate);
  }

  paramChanged(id: u32, value: f64): void {
    if (id == THRESHOLD) this.threshold = value;
    else if (id == RATIO) this.ratio = value;
    else if (id == ATTACK) { this.attack = value / 1000; this.coefficients(); }
    else if (id == RELEASE) { this.release = value / 1000; this.coefficients(); }
    else if (id == MAKEUP) this.makeup.setTarget(dbToGain(value));
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const l = <f64>io.input(0, n), r = io.channels > 1 ? <f64>io.input(1, n) : l;
      const peak = max<f64>(abs<f64>(l), abs<f64>(r));
      this.env += (peak - this.env) * (peak > this.env ? this.atk : this.rel);
      // The gain computer, in dB: above the threshold, the level rises 1/ratio as fast.
      const level = this.env > 1e-6 ? gainToDb(this.env) : -120.0;
      const over = level - this.threshold;
      const reduction = over > 0 ? over * (1.0 - 1.0 / this.ratio) : 0.0;
      const g = dbToGain(-reduction) * this.makeup.next();
      for (let c = 0; c < io.channels; c++) io.output(c, n, <f32>(<f64>io.input(c, n) * g));
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
