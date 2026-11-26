// The transport step clock: steps of a fixed length (in beats) on the host's song position, counted
// from the host's bar start. The rules it exists for:
//
// - **On the host's bars.** Steps are laid from the last bar line (the transport's `barStart`, then
//   every bar of `num`/`den` after it), so after a meter change the pattern starts on the bar
//   (review 2 D2-07: a break counted from beat 0 landed mid-bar after 4/4 → 3/4). A change of bar
//   start or meter re-lays the grid after the last step fired: it never stalls and never repeats.
// - **Forward only.** A step fires once, in order. Swing moves the off steps (the odd steps of the
//   bar) later by `swing` of a step; changing it never fires a step again (review n572 D-05, review 2
//   D2-02, D2-06, D2-11: Swing raised after an off step replayed the pair).
// - **Re-sync on any jump.** The beat going back, or forward by more than two frames, re-lays the
//   clock at the new position: the skipped steps never fire (review n572 D-12: a 32-beat jump fired
//   128 hits in 3 ms), and the step it lands on fires only if the position is on it to within a
//   frame (`landing`: the step it lands in fires at once, unless it is the step last fired).
// - **Ids by position.** A step's `index` is its place on the song's step grid (its unswung beat
//   over the step length, rounded; on a grid re-laid off the old lattice, one more than the last,
//   so it never goes back while playing on), its `inBar` its place in the bar: seed randomness by
//   them (`random.ts`), never by a count of steps since activate.
//
// Call `advance` once a sample with the song beat at that sample (and the frame's length in beats);
// it returns true on the sample a step fires, with `index`, `inBar`, `bar` and `grid` set.

import { floor } from "est";

export class StepClock {
  /** The step's length in beats (0.25: sixteenths in 4/4). */
  step: f64 = 0.25;
  /** How late an off step is, as a fraction of a step (0 straight, 1/3 a triplet feel), kept under 1. */
  swing: f64 = 0;
  /** A re-sync fires the step it lands in (once), not only a step it lands on. */
  landing: bool = false;

  // The last step fired.
  /** Its place on the song's step grid. */
  index: i64 = 0;
  /** Its place in its bar (0 at the bar line). */
  inBar: i32 = 0;
  /** Its bar's start (beats). */
  bar: f64 = 0;
  /** Its unswung beat. */
  grid: f64 = 0;
  /** The last `advance` re-synced (a jump, a start, a reset): a plugin re-derives what it keeps by position. */
  jumped: bool = false;

  private anchor: f64 = 0;
  private barBeats: f64 = 4;
  private synced: bool = false;
  private fired: bool = false;
  private lastBeat: f64 = 0;
  // The pending step.
  private pGrid: f64 = 0;
  private pBar: f64 = 0;
  private pIn: i32 = 0;

  /** Forget the position: the next `advance` re-syncs. */
  reset(): void { this.synced = false; this.fired = false; }

  /** Set the step length; the grid is re-laid after the last step fired. */
  setStep(beats: f64): void {
    if (beats == this.step) return;
    this.step = beats > 1e-6 ? beats : 1e-6;
    this.relay();
  }

  setSwing(fraction: f64): void { this.swing = fraction < 0.0 ? 0.0 : fraction > 0.95 ? 0.95 : fraction; }

  /** The bar line at or before `beat`. */
  barAt(beat: f64): f64 {
    const bb = this.barBeats;
    return this.anchor + floor((beat - this.anchor) / bb) * bb;
  }

  /** When the pending step fires (its swung beat). */
  get due(): f64 { return this.swungOf(this.pGrid, this.pIn); }

  // @ts-ignore: decorator
  @inline private swungOf(g: f64, inBar: i32): f64 { return (inBar & 1) != 0 && this.swing > 0.0 ? g + this.swing * this.step : g; }

  /** Pend the first grid step at or after `t` (`strict`: after it). */
  private pendFrom(t: f64, strict: bool): void {
    const st = this.step;
    let b = this.barAt(t);
    const bb = this.barBeats;
    let i = <i32>floor((t - b) / st);
    let g = b + <f64>i * st;
    while (strict ? g <= t : g < t) { i++; g = b + <f64>i * st; }
    if (g >= b + bb) { b += bb; i = 0; g = b; }
    this.pGrid = g; this.pBar = b; this.pIn = i;
  }

  /** Re-lay the grid after the last step fired (a bar start, meter or step change). */
  private relay(): void {
    if (!this.synced) return;
    // The first step of the new grid after both the last step fired and the last sample: a step whose
    // time went by before the change is not fired late (one in this sample's frame still fires).
    if (this.fired && this.grid >= this.lastBeat) this.pendFrom(this.grid, true);
    else this.pendFrom(this.lastBeat, true);
  }

  private resync(beat: f64, frame: f64): bool {
    this.synced = true;
    this.jumped = true;
    this.lastBeat = beat;
    // The grid step the position is at or after.
    const st = this.step;
    const b = this.barAt(beat);
    const i = <i32>floor((beat - b) / st);
    const g = b + <f64>i * st;
    if (this.swungOf(g, i) > beat) {
      // A swung off step not reached yet: the position is in the step before (always in this bar), which
      // fires only with `landing`; the off step fires when it is due.
      if (this.landing && !(this.fired && this.indexOf(g - st) == this.index)) {
        this.index = this.indexOf(g - st); this.inBar = i - 1; this.bar = b; this.grid = g - st; this.fired = true;
        this.pGrid = g; this.pBar = b; this.pIn = i;
        return true;
      }
      this.pGrid = g; this.pBar = b; this.pIn = i;
      return false;
    }
    this.pGrid = g; this.pBar = b; this.pIn = i;
    // In that step's time: on it (to within a frame), or `landing`, it fires once; else the next one waits.
    const on = beat - this.swungOf(g, i) < frame;
    const same = this.fired && this.indexOf(g) == this.index;
    if ((on || this.landing) && !same) return this.fire(true);
    this.pendFrom(g, true);
    return false;
  }

  // @ts-ignore: decorator
  @inline private indexOf(g: f64): i64 { return <i64>floor(g / this.step + 0.5); }

  private fire(resynced: bool = false): bool {
    // On a grid re-laid off the old one's lattice two positions can round to one number: playing on, never go back.
    const k = this.indexOf(this.pGrid);
    this.index = !resynced && this.fired && k <= this.index ? this.index + 1 : k;
    this.inBar = this.pIn;
    this.bar = this.pBar;
    this.grid = this.pGrid;
    this.fired = true;
    this.pendFrom(this.pGrid, true);
    return true;
  }

  /**
   * One sample at song beat `beat` (`frame`: one sample's length in beats; `barStart`, `num`, `den`:
   * the host's transport). True when a step fires at this sample.
   */
  advance(beat: f64, frame: f64, barStart: f64, num: i32, den: i32): bool {
    this.jumped = false;
    const bb = <f64>(num > 0 ? num : 4) * 4.0 / <f64>(den > 0 ? den : 4);
    if (bb != this.barBeats || barStart != this.anchor) {
      // A new bar start on the same grid moves nothing; a meter change re-lays it after the last step.
      const same = bb == this.barBeats && this.synced && floor((barStart - this.anchor) / bb) * bb == barStart - this.anchor;
      this.barBeats = bb > 1e-6 ? bb : 4.0;
      this.anchor = barStart;
      if (!same) this.relay();
    }
    if (!this.synced) return this.resync(beat, frame);
    const last = this.lastBeat;
    if (beat < last || beat - last > 2.0 * frame + 1e-9) return this.resync(beat, frame);
    this.lastBeat = beat;
    if (beat < this.swungOf(this.pGrid, this.pIn)) return false;
    const fired = this.fire();
    // More than one step due at one sample is a jump the beat test missed (a step under two frames).
    if (beat >= this.swungOf(this.pGrid, this.pIn)) this.pendFrom(beat, true);
    return fired;
  }
}
