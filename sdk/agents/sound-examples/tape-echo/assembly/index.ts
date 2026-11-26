import { Descriptor, Echo, Effect, Lfo, Param, alloc, beats, choice, drive, isReady, mix, param, start } from "sound1";

export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.tape-echo", "Tape Echo", "Me", "1.0.0"), parameters(), new TapeEcho());
  return alloc(size);
}

const TIME: u32 = 0;
const SYNC: u32 = 1;
const FEEDBACK: u32 = 2;
const TONE: u32 = 3;
const WOBBLE: u32 = 4;
const MIX: u32 = 5;

function parameters(): Param[] {
  return [
    new Param(TIME, "Time").range(0.02, 1.5).default(0.35).unit("s"),
    new Param(SYNC, "Sync").labels(["Free", "1/4", "1/8", "1/8 dotted", "1/16"]),
    new Param(FEEDBACK, "Feedback").range(0, 0.95).default(0.45),
    new Param(TONE, "Tone").range(0, 1).default(0.5),
    new Param(WOBBLE, "Wobble").range(0, 1).default(0.2),
    new Param(MIX, "Mix").range(0, 1).default(0.35),
  ];
}

class TapeEcho extends Effect {
  left: Echo = new Echo(2.0);       // up to 2 seconds
  right: Echo = new Echo(2.0);
  wow: Lfo = new Lfo();

  // Runs once a sample. The input is in this.l and this.r: leave the output there.
  tick(): void {
    const sync = choice(SYNC);
    let time = param(TIME);
    if (sync == 1) time = beats(1.0);
    else if (sync == 2) time = beats(0.5);
    else if (sync == 3) time = beats(0.75);
    else if (sync == 4) time = beats(0.25);
    time *= 1.0 + 0.004 * param(WOBBLE) * this.wow.sine(0.7);
    const fb = param(FEEDBACK), tone = param(TONE);
    // Echo returns the repeats alone; it keeps the feedback safe and tells Cyber how long it rings.
    const el = this.left.process(drive(this.l, 0.2), time, fb, tone);
    const er = this.right.process(drive(this.r, 0.2), time * 1.01, fb, tone);
    this.l = mix(this.l, el, param(MIX));
    this.r = mix(this.r, er, param(MIX));
  }
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
