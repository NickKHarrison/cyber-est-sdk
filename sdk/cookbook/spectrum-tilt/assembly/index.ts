// Cookbook Spectrum Tilt (org.example.cookbook-spectrum-tilt), from the EST cookbook: a tilt EQ whose
// own window draws the plugin's output spectrum. The recipe's page is README.md; `est new
// spectrum-tilt <folder>` copies it to start from. Allocate only in field initialisers, the
// constructor and `activate`; no top-level code but constants.
//
// The DSP knows nothing of the window: the page (ui/ui.js) asks the host for an analysis of this
// plugin's output (EST 1.1's `est:audio`, est.json's `"ui": { "audio": true }`) and draws the bins
// it gets back (`est:spectrum`: magnitudes in whole dB and each channel's RMS). The page never
// receives samples.

import { Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, dbToGain, isReady, onePole, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-spectrum-tilt", "Cookbook Spectrum Tilt", "Example", "1.0.0",
    "A tilt EQ (lows down as highs go up around a pivot) whose own window draws its output's spectrum from the host's analysis, never from samples.",
    ["audio-effect", "equalizer", "stereo"], "CKST", 1);
}
const TILT: u32 = 0;
const PIVOT: u32 = 1;
const OUTPUT: u32 = 2;
const TWO_PI: f64 = 6.283185307179586;
/** A recursive state below this is set to 0, so silence never runs on denormal numbers. */
const DENORMAL: f64 = 1e-20;

function parameters(): Param[] {
  return [
    new Param(TILT, "Tilt").range(-12, 12).default(0).unit("dB").decimals(1),
    new Param(PIVOT, "Pivot").range(100, 5000).default(800).hertz().log(),
    new Param(OUTPUT, "Output").range(-12, 12).default(0).unit("dB").decimals(1),
  ];
}

class Template extends Effect {
  sampleRate: f64 = 48000;
  pivot: f64 = 800;
  /** The one-pole low-pass at the pivot: below it the "low" half, the rest the "high" half. */
  coef: f64 = 0;
  lowL: f64 = 0;
  lowR: f64 = 0;
  /** The halves' gains: Tilt / 2 up on the highs and down on the lows (so the pivot stays put), then Output. */
  low: Smoother = new Smoother(0.02);
  high: Smoother = new Smoother(0.02);
  tilt: f64 = 0;
  out: f64 = 0;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.low.setSampleRate(sampleRate);
    this.high.setSampleRate(sampleRate);
    this.coefficient();
    this.gains();
    this.low.reset();
    this.high.reset();
    this.lowL = 0;
    this.lowR = 0;
    return true;
  }

  reset(): void { this.lowL = 0; this.lowR = 0; this.low.reset(); this.high.reset(); }

  coefficient(): void { this.coef = onePole(1.0 / (TWO_PI * this.pivot), this.sampleRate); }

  gains(): void {
    this.low.setTarget(dbToGain(this.out - this.tilt * 0.5));
    this.high.setTarget(dbToGain(this.out + this.tilt * 0.5));
  }

  paramChanged(id: u32, value: f64): void {
    if (id == TILT) { this.tilt = value; this.gains(); }
    else if (id == PIVOT) { this.pivot = value; this.coefficient(); }
    else if (id == OUTPUT) { this.out = value; this.gains(); }
  }

  render(io: Io, from: i32, to: i32): void {
    const a = this.coef;
    for (let n = from; n < to; n++) {
      const gl = this.low.next(), gh = this.high.next();
      const l = <f64>io.input(0, n);
      this.lowL += (l - this.lowL) * a;
      if (abs<f64>(this.lowL) < DENORMAL) this.lowL = 0;
      io.output(0, n, <f32>(this.lowL * gl + (l - this.lowL) * gh));
      if (io.channels < 2) continue;
      const r = <f64>io.input(1, n);
      this.lowR += (r - this.lowR) * a;
      if (abs<f64>(this.lowR) < DENORMAL) this.lowR = 0;
      io.output(1, n, <f32>(this.lowR * gl + (r - this.lowR) * gh));
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
