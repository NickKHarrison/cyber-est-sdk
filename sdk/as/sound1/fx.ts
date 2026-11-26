// sound1's time effects: a delay line, an echo that knows its own tail, a ping-pong echo, a small
// reverb, a chorus and a flanger. Times are seconds; the buffers are sized by the kit.

import { clamp, exp, ln } from "est";
import { Block, sampleRate } from "./core";
import { quiet, sinPhase } from "./fast";

/** The rate buffers are sized for (so a later, higher sample rate needs no new memory: the EST runtime never frees). */
const SIZE_RATE: f64 = 96000.0;
/** All the kit's buffers together stay under this (bytes), inside est.json's default memory. */
const BUFFER_BUDGET: usize = 2621440;
let bufferBytes: usize = 0;

/** A ring of samples (not a block: the blocks below own theirs). */
class Ring {
  data: usize = 0;
  size: i32 = 0;
  at: i32 = 0;
  /** Room for `seconds` at any rate up to 96 kHz (less if the kit's memory is nearly spent). */
  make(seconds: f64): void {
    if (this.data != 0) return;
    let n = <i32>(seconds * SIZE_RATE) + 4;
    if (n < 16) n = 16;
    const left = bufferBytes < BUFFER_BUDGET ? <i32>((BUFFER_BUDGET - bufferBytes) >> 2) : 0;
    if (n > left) n = left > 16 ? left : 16;
    const bytes = <usize>n << 2;
    this.data = heap.alloc(bytes);
    memory.fill(this.data, 0, bytes);
    bufferBytes += bytes;
    this.size = n;
  }
  clear(): void { if (this.data != 0) memory.fill(this.data, 0, <usize>this.size << 2); this.at = 0; }
  // @ts-ignore: decorator
  @inline write(x: f64): void {
    store<f32>(this.data + (<usize>this.at << 2), <f32>x);
    const a = this.at + 1;
    this.at = a >= this.size ? 0 : a;
  }
  /** What was written `frames` ago (1 or more; a fraction is interpolated). Read before `write`. */
  // @ts-ignore: decorator
  @inline read(frames: f64): f64 {
    const size = this.size;
    let d = frames;
    const most = <f64>(size - 3);
    if (d > most) d = most;
    if (d < 1.0) d = 1.0;
    const whole = <i32>d;
    const f = d - <f64>whole;
    let i = this.at - whole;
    if (i < 0) i += size;
    let j = i - 1;
    if (j < 0) j += size;
    const a = <f64>load<f32>(this.data + (<usize>i << 2));
    const b = <f64>load<f32>(this.data + (<usize>j << 2));
    return a + (b - a) * f;
  }
  /** The longest delay it can give at the current rate, in seconds. */
  most(): f64 { return <f64>(this.size - 3) / sampleRate(); }
}

/**
 * A plain delay line, up to `maxSeconds` (4 at most). Each sample: `read(seconds)` BEFORE `write(x)`.
 * For repeats use `Echo` instead: it keeps the feedback safe and knows how long it rings.
 */
export class Delay extends Block {
  private ring: Ring = new Ring();
  private max: f64;
  private longest: f64 = 0.0;
  constructor(maxSeconds: f64 = 1.0) { super(); this.max = clamp(maxSeconds, 0.001, 4.0); }
  prepare(): void { this.ring.make(this.max); }
  reset(): void { this.ring.clear(); }
  read(seconds: f64): f64 {
    if (this.ring.data == 0) return 0.0;
    // Never longer than `maxSeconds`, whatever the rate (the ring is sized for 96 kHz, so it holds more at 48).
    const t = seconds < this.max ? seconds : this.max;
    if (t > this.longest) this.longest = t;
    return this.ring.read(t * sampleRate());
  }
  write(x: f64): void { if (this.ring.data != 0) this.ring.write(quiet(x)); }
  tail(): f64 { return this.longest; }
}

/** How many repeats until an echo with this feedback is 60 dB down. */
function repeatsOf(feedback: f64): f64 { return feedback <= 0.001 ? 0.0 : 6.907755278982137 / -ln(feedback); }

/**
 * An echo: repeats that die away. `this.echo.process(x, seconds, feedback)` returns the echoes only
 * (add them to the dry sound yourself). `feedback` 0 to 0.95 is how much of each repeat comes back;
 * `tone` 0 to 1 darkens each repeat (1: bright). The time glides when it changes, like tape. It can
 * never run away, and the kit reports its tail for you.
 */
export class Echo extends Block {
  private ring: Ring = new Ring();
  private max: f64;
  private time: f64 = 0.25;
  private now: f64 = -1.0;
  private fb: f64 = 0.0;
  private lp: f64 = 0.0;
  private toneIn: f64 = -1.0;
  private toneC: f64 = 1.0;
  private glide: f64 = 0.001;
  constructor(maxSeconds: f64 = 2.0) { super(); this.max = clamp(maxSeconds, 0.01, 4.0); }
  prepare(): void { this.ring.make(this.max); this.glide = 1.0 - exp(-1.0 / (0.06 * sampleRate())); this.toneIn = -1.0; }
  reset(): void { this.ring.clear(); this.lp = 0.0; this.now = -1.0; }

  /** The feedback really used: under 0.95, and low enough that the repeats are gone in 40 seconds. */
  // @ts-ignore: decorator
  @inline private safeFeedback(feedback: f64, seconds: f64): f64 {
    let f = feedback > 0.0 ? (feedback < 0.95 ? feedback : 0.95) : 0.0;
    // 0.001^(seconds / 40): the feedback whose repeats take 40 s to fall 60 dB.
    if (f > 0.8) { const cap = exp(-6.907755278982137 * seconds / 40.0); if (f > cap) f = cap; }
    return f;
  }
  process(x: f64, seconds: f64, feedback: f64, tone: f64 = 1.0): f64 {
    const ring = this.ring;
    if (ring.data == 0) return 0.0;
    // The longest time is `maxSeconds` at every rate (the ring, sized for 96 kHz, holds more at 48).
    const room = ring.most();
    const most = room < this.max ? room : this.max;
    const t = seconds > 0.0005 ? (seconds < most ? seconds : most) : 0.0005;
    if (t != this.time || feedback != this.fb) { this.time = t; this.fb = feedback; }
    if (this.now < 0.0) this.now = t;
    else if (this.now != t) { const n = this.now + (t - this.now) * this.glide; this.now = abs<f64>(n - t) < 1e-7 ? t : n; }
    if (tone != this.toneIn) {
      this.toneIn = tone;
      const hz = 400.0 * exp(3.9 * clamp(tone, 0.0, 1.0));       // 400 Hz to about 20 kHz
      this.toneC = hz >= 0.45 * sampleRate() ? 1.0 : 1.0 - exp(-6.283185307179586 * hz / sampleRate());
    }
    const wet = ring.read(this.now * sampleRate());
    this.lp = quiet(this.lp + (wet - this.lp) * this.toneC);
    ring.write(quiet(x + this.lp * this.safeFeedback(feedback, t)));
    return wet;
  }
  tail(): f64 { return this.time * (1.0 + repeatsOf(this.safeFeedback(this.fb, this.time))) + 0.05; }
}

/**
 * A ping-pong echo: repeats that bounce left, right, left. `this.pong.process(l, r, seconds, feedback)`,
 * then read the echoes from `this.pong.l` and `this.pong.r`.
 */
export class PingPong extends Block {
  private a: Ring = new Ring();
  private b: Ring = new Ring();
  private max: f64;
  private time: f64 = 0.25;
  private now: f64 = -1.0;
  private fb: f64 = 0.0;
  private glide: f64 = 0.001;
  l: f64 = 0.0;
  r: f64 = 0.0;
  constructor(maxSeconds: f64 = 1.0) { super(); this.max = clamp(maxSeconds, 0.01, 2.0); }
  prepare(): void { this.a.make(this.max); this.b.make(this.max); this.glide = 1.0 - exp(-1.0 / (0.06 * sampleRate())); }
  reset(): void { this.a.clear(); this.b.clear(); this.now = -1.0; this.l = 0.0; this.r = 0.0; }
  // @ts-ignore: decorator
  @inline private safeFeedback(feedback: f64, seconds: f64): f64 {
    let f = feedback > 0.0 ? (feedback < 0.95 ? feedback : 0.95) : 0.0;
    if (f > 0.8) { const cap = exp(-6.907755278982137 * seconds / 40.0); if (f > cap) f = cap; }
    return f;
  }
  process(l: f64, r: f64, seconds: f64, feedback: f64): void {
    if (this.a.data == 0) { this.l = 0.0; this.r = 0.0; return; }
    const room = this.a.most();
    const most = room < this.max ? room : this.max;
    const t = seconds > 0.0005 ? (seconds < most ? seconds : most) : 0.0005;
    this.time = t; this.fb = feedback;
    if (this.now < 0.0) this.now = t;
    else if (this.now != t) { const n = this.now + (t - this.now) * this.glide; this.now = abs<f64>(n - t) < 1e-7 ? t : n; }
    const d = this.now * sampleRate();
    const f = this.safeFeedback(feedback, t);
    const wl = this.a.read(d), wr = this.b.read(d);
    // The input goes in on the left; each side feeds the other.
    this.a.write(quiet((l + r) * 0.5 + wr * f));
    this.b.write(quiet(wl * f));
    this.l = wl;
    this.r = wr;
  }
  tail(): f64 { return this.time * (2.0 + repeatsOf(this.safeFeedback(this.fb, this.time))) + 0.05; }
}

// The reverb's eight delay lengths in seconds (mutually prime at 48 kHz) and its two input diffusers'.
const R0: f64 = 0.029646; const R1: f64 = 0.033354; const R2: f64 = 0.037146; const R3: f64 = 0.040604;
const R4: f64 = 0.044396; const R5: f64 = 0.048104; const R6: f64 = 0.052146; const R7: f64 = 0.055979;

/**
 * A small reverb (eight delay lines feeding each other). `this.reverb.process(l, r, seconds, damping)`:
 * `seconds` is how long it rings (0.2 to 20), `damping` 0 to 1 how fast the highs die. Then read the
 * reverb alone from `this.reverb.l` and `this.reverb.r` and add it to the dry sound.
 */
export class Reverb extends Block {
  private lines: StaticArray<Ring> = new StaticArray<Ring>(8);
  private times: StaticArray<f64> = new StaticArray<f64>(8);
  private gains: StaticArray<f64> = new StaticArray<f64>(8);
  private lps: StaticArray<f64> = new StaticArray<f64>(8);
  private apL: Ring = new Ring();
  private apR: Ring = new Ring();
  private seconds: f64 = -1.0;
  private rt: f64 = 2.0;
  private dampIn: f64 = -1.0;
  private dampC: f64 = 1.0;
  l: f64 = 0.0;
  r: f64 = 0.0;
  constructor() {
    super();
    for (let i = 0; i < 8; i++) unchecked(this.lines[i] = new Ring());
    const t = this.times;
    unchecked(t[0] = R0); unchecked(t[1] = R1); unchecked(t[2] = R2); unchecked(t[3] = R3);
    unchecked(t[4] = R4); unchecked(t[5] = R5); unchecked(t[6] = R6); unchecked(t[7] = R7);
  }
  prepare(): void {
    for (let i = 0; i < 8; i++) unchecked(this.lines[i]).make(unchecked(this.times[i]) + 0.001);
    this.apL.make(0.008);
    this.apR.make(0.008);
    this.seconds = -1.0;
    this.dampIn = -1.0;
  }
  reset(): void {
    for (let i = 0; i < 8; i++) { unchecked(this.lines[i]).clear(); unchecked(this.lps[i] = 0.0); }
    this.apL.clear();
    this.apR.clear();
    this.l = 0.0;
    this.r = 0.0;
  }
  process(l: f64, r: f64, seconds: f64 = 2.0, damping: f64 = 0.5): void {
    if (this.apL.data == 0) { this.l = 0.0; this.r = 0.0; return; }
    const sr = sampleRate();
    if (seconds != this.seconds) {
      this.seconds = seconds;
      this.rt = seconds > 0.2 ? (seconds < 20.0 ? seconds : 20.0) : 0.2;
      // Each line loses 60 dB over `rt` seconds of going round.
      for (let i = 0; i < 8; i++) unchecked(this.gains[i] = exp(-6.907755278982137 * unchecked(this.times[i]) / this.rt));
    }
    if (damping != this.dampIn) {
      this.dampIn = damping;
      const hz = 18000.0 * exp(-2.9 * clamp(damping, 0.0, 1.0));   // 18 kHz down to 1 kHz
      this.dampC = hz >= 0.45 * sr ? 1.0 : 1.0 - exp(-6.283185307179586 * hz / sr);
    }
    // Two all-pass diffusers smear the input so single echoes are not heard.
    const dl = this.apL.read(0.0047 * sr), dr = this.apR.read(0.0061 * sr);
    const vl = l * 0.5 - 0.6 * dl, vr = r * 0.5 - 0.6 * dr;
    this.apL.write(quiet(vl));
    this.apR.write(quiet(vr));
    const inL = dl + 0.6 * vl, inR = dr + 0.6 * vr;
    // Read the eight lines, damp them, mix them (a Householder reflection: energy-preserving), write back.
    const lines = this.lines, lps = this.lps, gains = this.gains, times = this.times;
    let sum = 0.0, outL = 0.0, outR = 0.0;
    for (let i = 0; i < 8; i++) {
      const x = unchecked(lines[i]).read(unchecked(times[i]) * sr);
      const y = quiet(unchecked(lps[i]) + (x - unchecked(lps[i])) * this.dampC);
      unchecked(lps[i] = y);
      sum += y;
      if ((i & 1) == 0) outL += (i & 2) == 0 ? y : -y; else outR += (i & 2) == 0 ? y : -y;
    }
    sum *= 0.25;
    for (let i = 0; i < 8; i++) {
      const fed = (unchecked(lps[i]) - sum) * unchecked(gains[i]) + ((i & 1) == 0 ? inL : inR);
      unchecked(lines[i]).write(quiet(fed));
    }
    this.l = outL * 0.35;
    this.r = outR * 0.35;
  }
  tail(): f64 { return this.rt * 1.25 + 0.3; }
}

/** A swept short delay on each side: the chorus's and the flanger's core. */
abstract class Sweep extends Block {
  private a: Ring = new Ring();
  private b: Ring = new Ring();
  private phase: f64 = 0.0;
  protected fb: f64 = 0.0;
  l: f64 = 0.0;
  r: f64 = 0.0;
  constructor(private centre: f64, private width: f64) { super(); }
  prepare(): void { this.a.make(0.04); this.b.make(0.04); }
  reset(): void { this.a.clear(); this.b.clear(); this.phase = 0.0; this.l = 0.0; this.r = 0.0; }
  protected run(l: f64, r: f64, rateHz: f64, depth: f64, feedback: f64): void {
    if (this.a.data == 0) { this.l = 0.0; this.r = 0.0; return; }
    const sr = sampleRate();
    const p = this.phase;
    let q = p + clamp(rateHz, 0.0, 20.0) / sr;
    if (q >= 1.0) q -= 1.0;
    this.phase = q;
    let p2 = p + 0.25;
    if (p2 >= 1.0) p2 -= 1.0;
    const d = clamp(depth, 0.0, 1.0) * this.width;
    const wl = this.a.read((this.centre + d * sinPhase(p)) * sr), wr = this.b.read((this.centre + d * sinPhase(p2)) * sr);
    this.fb = feedback;
    this.a.write(quiet(l + wl * feedback));
    this.b.write(quiet(r + wr * feedback));
    this.l = wl;
    this.r = wr;
  }
}

/**
 * A chorus: copies of the sound, slightly detuned by a slow sweep, for width. `this.chorus.process(l,
 * r, rateHz, depth)` (rate about 0.1 to 5, depth 0 to 1), then read the chorus alone from
 * `this.chorus.l` and `this.chorus.r` and mix it with the dry sound.
 */
export class Chorus extends Sweep {
  constructor() { super(0.015, 0.006); }
  process(l: f64, r: f64, rateHz: f64 = 0.8, depth: f64 = 0.5): void { this.run(l, r, rateHz, depth, 0.0); }
  tail(): f64 { return 0.05; }
}

/**
 * A flanger: a very short swept delay fed back on itself (the jet-plane sweep). `this.flanger.process(l,
 * r, rateHz, depth, feedback)` (feedback 0 to 0.9), then mix `this.flanger.l` and `.r` with the dry sound.
 */
export class Flanger extends Sweep {
  constructor() { super(0.0035, 0.003); }
  process(l: f64, r: f64, rateHz: f64 = 0.3, depth: f64 = 0.7, feedback: f64 = 0.5): void { this.run(l, r, rateHz, depth, clamp(feedback, 0.0, 0.9)); }
  tail(): f64 { return 0.0065 * (1.0 + repeatsOf(this.fb)) + 0.05; }
}
