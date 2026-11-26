// The fuel test's instrument: sixteen voices of typical blocks (two oscillators, a noise source, a
// filter swept by its own envelope and an LFO) into a chorus and a reverb on the mix. Built and
// measured by sdk/tests/soundKit.examples.test.ts; not an example to copy.
import { Adsr, Chorus, Descriptor, Filter, Instrument, Lfo, Noise, Osc, Param, Reverb, Voice, alloc, isReady, mix, param, start } from "sound1";

export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.sixteen", "Sixteen", "Test", "1.0.0"), parameters(), new Sixteen());
  return alloc(size);
}

const CUTOFF: u32 = 0;
const RESONANCE: u32 = 1;
const RELEASE: u32 = 2;
const SPACE: u32 = 3;

function parameters(): Param[] {
  return [
    new Param(CUTOFF, "Cutoff").range(40, 16000).default(3000).hertz(),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.4),
    new Param(RELEASE, "Release").range(0.01, 4).default(0.8),
    new Param(SPACE, "Space").range(0, 1).default(0.4),
  ];
}

class V extends Voice {
  a: Osc = new Osc();
  b: Osc = new Osc();
  n: Noise = new Noise();
  f: Filter = new Filter();
  e: Adsr = new Adsr();
  l: Lfo = new Lfo();
  tick(): f64 {
    this.amp.set(0.01, 0.3, 0.7, param(RELEASE));
    this.e.set(0.01, 0.4, 0.3, param(RELEASE));
    const x = 0.5 * this.a.saw(this.hz * 0.997) + 0.5 * this.b.pulse(this.hz * 1.003, 0.3) + 0.05 * this.n.white();
    const hz = param(CUTOFF) * (0.5 + this.e.next()) * (1.0 + 0.2 * this.l.sine(5.0));
    return this.f.lowpass(x, hz, param(RESONANCE)) * this.velocity;
  }
}

class Sixteen extends Instrument<V> {
  chorus: Chorus = new Chorus();
  reverb: Reverb = new Reverb();
  constructor() { super(16); }
  tick(): void {
    this.chorus.process(this.l, this.r, 0.8, 0.5);
    const l = mix(this.l, this.chorus.l, 0.4), r = mix(this.r, this.chorus.r, 0.4);
    this.reverb.process(l, r, 3.0, 0.5);
    this.l = l + this.reverb.l * param(SPACE);
    this.r = r + this.reverb.r * param(SPACE);
  }
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
