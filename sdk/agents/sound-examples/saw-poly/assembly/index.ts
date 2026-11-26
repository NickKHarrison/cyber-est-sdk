import { Adsr, Descriptor, Filter, Instrument, Osc, Param, Voice, alloc, dbToGain, isReady, param, start } from "sound1";

export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.saw-poly", "Saw Poly", "Me", "1.0.0"), parameters(), new SawPoly());
  return alloc(size);
}

const LEVEL: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const DETUNE: u32 = 7;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-40, 6).default(0).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(40, 16000).default(2400).hertz(),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.3),
    new Param(ATTACK, "Attack").range(0.001, 2).default(0.01).unit("s").decimals(3),
    new Param(DECAY, "Decay").range(0.01, 4).default(0.4).unit("s"),
    new Param(SUSTAIN, "Sustain").range(0, 1).default(0.6),
    new Param(RELEASE, "Release").range(0.01, 6).default(0.5).unit("s"),
    new Param(DETUNE, "Detune").range(0, 50).default(12).unit("ct").decimals(0),
  ];
}

// What ONE voice sounds like. The kit plays the notes: it starts, releases, steals and ends voices.
class SawVoice extends Voice {
  a: Osc = new Osc();
  b: Osc = new Osc();
  filter: Filter = new Filter();
  sweep: Adsr = new Adsr();

  // Runs once a sample while the voice sounds: return its sound, about -1 to 1.
  tick(): f64 {
    // this.amp is the voice's loudness envelope; the kit applies it and ends the voice when it has faded.
    this.amp.set(param(ATTACK), param(DECAY), param(SUSTAIN), param(RELEASE));
    this.sweep.set(0.005, param(DECAY), 0.3, param(RELEASE));
    const wide = this.hz * param(DETUNE) * 0.0006;           // cents to Hz, near enough
    const saws = (this.a.saw(this.hz - wide) + this.b.saw(this.hz + wide)) * 0.5;
    const cutoff = param(CUTOFF) * (0.4 + 1.6 * this.sweep.next() * this.velocity);
    return this.filter.lowpass(saws, cutoff, param(RESONANCE)) * dbToGain(param(LEVEL));
  }
}

class SawPoly extends Instrument<SawVoice> {
  constructor() { super(8); }      // eight voices
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
