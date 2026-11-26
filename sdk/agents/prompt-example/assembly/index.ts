import { Descriptor, Effect, Filter, Param, alloc, choice, dbToGain, isReady, param, start } from "sound1";

// The export block: keep it as it is, with your plugin's id, name, version and class.
export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.glow-filter", "Glow Filter", "Me", "1.0.0"), parameters(), new GlowFilter());
  return alloc(size);
}

const GAIN: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const MODE: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(GAIN, "Gain").range(-60, 12).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(20000).hertz(),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0),
    new Param(MODE, "Mode").labels(["Low-pass", "Band-pass", "High-pass", "Notch"]),
  ];
}

class GlowFilter extends Effect {
  left: Filter = new Filter();
  right: Filter = new Filter();

  // Runs once a sample. The input is in this.l and this.r: leave the output there.
  tick(): void {
    const hz = param(CUTOFF), res = param(RESONANCE), mode = choice(MODE);
    if (mode == 0) { this.l = this.left.lowpass(this.l, hz, res); this.r = this.right.lowpass(this.r, hz, res); }
    else if (mode == 1) { this.l = this.left.bandpass(this.l, hz, res); this.r = this.right.bandpass(this.r, hz, res); }
    else if (mode == 2) { this.l = this.left.highpass(this.l, hz, res); this.r = this.right.highpass(this.r, hz, res); }
    else { this.l = this.left.notch(this.l, hz, res); this.r = this.right.notch(this.r, hz, res); }
    const gain = dbToGain(param(GAIN));
    this.l *= gain;
    this.r *= gain;
  }
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
