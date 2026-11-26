import { Adsr, Descriptor, Filter, Instrument, Noise, Osc, Param, Voice, alloc, drive, isReady, param, start } from "sound1";

export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.drum-box", "Drum Box", "Me", "1.0.0"), parameters(), new DrumBox());
  return alloc(size);
}

const TUNE: u32 = 0;
const DECAY: u32 = 1;
const PUNCH: u32 = 2;
const SNAP: u32 = 3;
const DRIVE: u32 = 4;

function parameters(): Param[] {
  return [
    new Param(TUNE, "Tune").range(-12, 12).default(0).unit("st").decimals(1),
    new Param(DECAY, "Decay").range(0.2, 3).default(1),
    new Param(PUNCH, "Punch").range(0, 1).default(0.6),
    new Param(SNAP, "Snap").range(0, 1).default(0.5),
    new Param(DRIVE, "Drive").range(0, 1).default(0.2),
  ];
}

// One drum hit. Keys below 48 are kicks, 48 to 59 snares, 60 and up hats.
class Hit extends Voice {
  tone: Osc = new Osc();
  noise: Noise = new Noise();
  filter: Filter = new Filter();
  drop: Adsr = new Adsr();          // the pitch drop at the start of a hit

  tick(): f64 {
    const key = this.key, long = param(DECAY);
    const tune = Math.pow(2.0, param(TUNE) / 12.0);
    let out = 0.0;
    if (key < 48.0) {
      // Kick: a sine that drops in pitch, plus a click.
      this.amp.perc(0.001, 0.45 * long);          // perc: it fades by itself, key held or not
      this.drop.perc(0.001, 0.06);
      const hz = (45.0 + key * 0.5) * tune * (1.0 + 4.0 * param(PUNCH) * this.drop.next());
      out = this.tone.sine(hz) + 0.3 * param(SNAP) * this.drop.next() * this.noise.white();
    } else if (key < 60.0) {
      // Snare: a short tone under filtered noise.
      this.amp.perc(0.001, 0.25 * long);
      this.drop.perc(0.001, 0.03);
      const body = this.tone.triangle(180.0 * tune * (1.0 + param(PUNCH) * this.drop.next()));
      const rattle = this.filter.highpass(this.noise.white(), 1500.0 + 4000.0 * param(SNAP), 0.2);
      out = 0.6 * body + 0.8 * rattle;
    } else {
      // Hat: bright noise, longer for higher keys.
      this.amp.perc(0.001, (0.05 + (key - 60.0) * 0.03) * long);
      out = this.filter.highpass(this.noise.white(), 6000.0 * tune, 0.3 + 0.5 * param(SNAP));
    }
    return drive(out * this.velocity, param(DRIVE));
  }
}

class DrumBox extends Instrument<Hit> {
  constructor() { super(12); }
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
