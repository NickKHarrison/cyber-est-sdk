// sound1's step clock: steps on the song's own grid, counted from the host's bar start (the catalogue
// toolkit's `StepClock`: after a meter change a pattern still starts on the bar, a jump never fires
// the steps it skipped, and a step fires once).

import { Block, barStart, beat, meterDen, meterNum, playing, sampleRate, tempo } from "./core";
import { StepClock } from "./dsp/clock";

/**
 * A step clock on the song. Once a sample: `const s = this.steps.next(4);` (4 steps a beat:
 * sixteenths). It is -1, except on the sample a step starts, when it is the step's place in its bar
 * (0 at the bar line, 1, 2 …). Silent while the song is stopped.
 */
export class Steps extends Block {
  private clock: StepClock = new StepClock();
  /** The last step's place on the whole song's grid (seed a random choice by it, so a pattern repeats exactly). */
  index: i64 = 0;
  constructor() { super(); }
  reset(): void { this.clock.reset(); }
  noteOn(): void {}
  next(stepsPerBeat: f64, swing: f64 = 0.0): i32 {
    if (!playing()) { this.clock.reset(); return -1; }
    const c = this.clock;
    c.setStep(1.0 / (stepsPerBeat > 0.01 ? stepsPerBeat : 0.01));
    c.swing = swing > 0.0 ? (swing < 0.9 ? swing : 0.9) : 0.0;
    c.landing = true;
    if (!c.advance(beat(), tempo() / (60.0 * sampleRate()), barStart(), meterNum(), meterDen())) return -1;
    this.index = c.index;
    return c.inBar;
  }
}
