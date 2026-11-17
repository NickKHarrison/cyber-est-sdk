// The granular engine (1.711): the parts every granular instrument of the catalogue shares, written once
// so three synthesizers (and whatever follows) never write a grain scheduler, a window or a resampler by
// hand. Read README.md's "The granular engine". The rules it exists for:
//
// - **A source is read band-limited.** `GrainSource` holds the source at its own rate and a chain of
//   half-band mip levels (each half the length of the one before, low-passed under its Nyquist by a
//   23-tap windowed-sinc half-band filter), built once when it is loaded. A grain read faster than 1.0
//   level-0 frames a host frame reads the level where its step is at most 1 (`levelFor`), with a 4-point
//   Hermite interpolation, so a grain pitched up three octaves does not alias, and costs the same.
// - **Grains never click.** Every grain is windowed from 0 to 0 (`GrainWindows`: Hann, Tukey, trapezoid,
//   exponential, each a table read with linear interpolation). Hann at an overlap of exactly 2 sums to 1:
//   a playhead whose grains read at the speed it scans (`GrainScheduler.setOverlap(length, 2)` with the
//   grain's step equal to the scan's) plays its loop exactly as tape would, so one engine is both a tape
//   loop and a cloud of grains.
// - **Grains are sample-accurate.** A grain fired inside a block starts on its frame (`spawn`'s `delay`).
// - **CPU-safe caps.** The pool has a fixed number of grains, and each owner (a voice, a playhead) may
//   hold at most `ownerCap` of them: a grain past a cap is not started (`spawn` answers -1), never a
//   sounding grain stolen (that would click). A grain's length is bounded (`MAX_GRAIN_SECONDS`) and
//   its density too (`MAX_DENSITY`), so the worst case is a known number of grain-frames a block.
// - **Seeded by position, never by a counter of everything** (the toolkit's rule, `random.ts`): a free
//   scheduler numbers its grains from the note's start (a position in the note), a synced one by the
//   song's grid (`GrainScheduler.index`); spray and jitter take `chance`/`bipolar` of that index, the
//   owner, the key and a salt. A note sounds the same wherever it falls, a render matches live play.
// - **Playheads loop forward, backward or ping-pong** (`Playhead`) inside their region, by any speed,
//   0 included (a frozen playhead), and the region may move while it plays.
// - **Every state flushed.** A grain's output adds into the caller's buffers and ends at its window's 0;
//   nothing recursive lives here, the filters and smoothers the plugin adds are the toolkit's own.
//
// Allocate only where the SDK allows: `new GrainSource(maxFrames)`, `new GrainPool(n)`, `new
// GrainWindows()` as fields or in the constructor. `load*` builds the mip levels (a few points a frame,
// within a lifecycle call's fuel): call it from `activate` once (the levels do not depend on the rate).

import { cosTurns, exp, sinTurns } from "est";
import { chance } from "./random";
import { flush } from "./flush";

/** A raised cosine: 0.5 − 0.5 cos 2πp. Sums to 1 at an overlap of 2. */
export const WIN_HANN: i32 = 0;
/** Flat in the middle half, cosine ramps over a quarter each side (α = 0.5). */
export const WIN_TUKEY: i32 = 1;
/** Linear ramps over a tenth each side, flat between: the hardest-edged window that never clicks. */
export const WIN_TRAPEZOID: i32 = 2;
/** A 3 % rise then an exponential fall to −60 dB, eased to 0 at the end: a struck grain. */
export const WIN_EXPONENTIAL: i32 = 3;
export const WIN_COUNT: i32 = 4;
/** Points a window's table holds (and one more, so interpolation never reads past it). */
export const WIN_POINTS: i32 = 1024;

/** The mip levels a source has: level k is 2^k times shorter (5 levels: five octaves up stay band-limited). */
export const MIP_LEVELS: i32 = 6;
/** Frames of guard each level carries either side (the wrap-around copy the interpolator reads). */
const GUARD: i32 = 4;
/** The half-band filter's taps (odd; the centre at HB_TAPS / 2). */
const HB_TAPS: i32 = 23;

/** The longest grain, in seconds, a pool starts. */
export const MAX_GRAIN_SECONDS: f64 = 2.0;
/** The shortest grain, in seconds (a shorter one is a click, not a grain). */
export const MIN_GRAIN_SECONDS: f64 = 0.004;
/** The most grains a second one scheduler fires. */
export const MAX_DENSITY: f64 = 400.0;

/** The four windows as tables. */
export class GrainWindows {
  table: StaticArray<f32> = new StaticArray<f32>(WIN_COUNT * (WIN_POINTS + 1));

  constructor() {
    const n = WIN_POINTS;
    for (let i = 0; i <= n; i++) {
      const p = <f64>i / <f64>n;
      // Hann.
      unchecked(this.table[i] = <f32>(0.5 - 0.5 * cosTurns(p)));
      // Tukey, α = 0.5.
      let t: f64 = 1.0;
      if (p < 0.25) t = 0.5 - 0.5 * cosTurns(p * 2.0);
      else if (p > 0.75) t = 0.5 - 0.5 * cosTurns((1.0 - p) * 2.0);
      unchecked(this.table[(n + 1) + i] = <f32>t);
      // Trapezoid, a tenth each side.
      let z: f64 = 1.0;
      if (p < 0.1) z = p * 10.0; else if (p > 0.9) z = (1.0 - p) * 10.0;
      unchecked(this.table[2 * (n + 1) + i] = <f32>z);
      // Exponential: a 3 % linear rise, a fall of 60 dB over the rest, eased to 0 over the last 8 %.
      let e: f64;
      if (p < 0.03) e = p / 0.03;
      else {
        e = exp(-6.907755278982137 * (p - 0.03) / 0.97);
        if (p > 0.92) e *= 0.5 + 0.5 * cosTurns((p - 0.92) / 0.16);
      }
      unchecked(this.table[3 * (n + 1) + i] = <f32>(i == n ? 0.0 : e));
    }
    unchecked(this.table[0] = 0); unchecked(this.table[n] = 0);
    unchecked(this.table[n + 1] = 0); unchecked(this.table[2 * (n + 1) - 1] = 0);
    unchecked(this.table[2 * (n + 1)] = 0); unchecked(this.table[3 * (n + 1) - 1] = 0);
    unchecked(this.table[3 * (n + 1)] = 0);
  }

  /** The window `shape` at `phase` in [0, 1] (clamped), interpolated. */
  at(shape: i32, phase: f64): f64 {
    let s = shape; if (s < 0) s = 0; if (s >= WIN_COUNT) s = WIN_COUNT - 1;
    let p = phase; if (p < 0.0) p = 0.0; if (p > 1.0) p = 1.0;
    const x = p * <f64>WIN_POINTS;
    let i = <i32>x; if (i >= WIN_POINTS) i = WIN_POINTS - 1;
    const f = x - <f64>i;
    const o = s * (WIN_POINTS + 1) + i;
    const a = <f64>unchecked(this.table[o]);
    return a + (<f64>unchecked(this.table[o + 1]) - a) * f;
  }
}

/** A mono source and its half-band mip levels, read with a 4-point Hermite interpolation. */
export class GrainSource {
  buf: StaticArray<f32>;
  /** Level 0's frames (the source's own). */
  frames: i32 = 0;
  /** The source's own sample rate. */
  rate: f64 = 48000;
  /** Each level's first frame in `buf` and its length. */
  off: StaticArray<i32> = new StaticArray<i32>(MIP_LEVELS);
  len: StaticArray<i32> = new StaticArray<i32>(MIP_LEVELS);
  private hb: StaticArray<f64> = new StaticArray<f64>(HB_TAPS);
  private capacity: i32;
  // A load in steps: what is loading, the stage (-1 none, 0 level 0, l level l) and where in it.
  private pPtr: usize = 0;
  private pFrames: i32 = 0;
  private pRate: f64 = 48000;
  private pI16: bool = true;
  private stage: i32 = -1;
  private at: i32 = 0;

  /** Room for a source of up to `maxFrames` frames and its levels. */
  constructor(maxFrames: i32) {
    this.capacity = maxFrames;
    this.buf = new StaticArray<f32>(maxFrames * 2 + MIP_LEVELS * (2 * GUARD + 2) + 8);
    // A half-band low-pass (cutoff a quarter of the rate) by a Blackman-windowed sinc: every other tap 0.
    const c = HB_TAPS >> 1;
    let sum: f64 = 0;
    for (let k = 0; k < HB_TAPS; k++) {
      const m = k - c;
      let h: f64;
      if (m == 0) h = 0.5;
      else if ((m & 1) == 0) h = 0.0;
      else h = sinTurns(<f64>m * 0.25) / (3.141592653589793 * <f64>m);
      const w = 0.42 - 0.5 * cosTurns(<f64>k / <f64>(HB_TAPS - 1)) + 0.08 * cosTurns(2.0 * <f64>k / <f64>(HB_TAPS - 1));
      h *= w;
      unchecked(this.hb[k] = h);
      sum += h;
    }
    for (let k = 0; k < HB_TAPS; k++) unchecked(this.hb[k] = this.hb[k] / sum);
  }

  /** Load 16-bit frames (a module's embedded table) at `ptr`, `frames` of them at `rate` Hz, and build the levels, all at once (`activate`). */
  loadI16(ptr: usize, frames: i32, rate: f64): void { this.beginI16(ptr, frames, rate); this.work(0x7fffffff); }

  /** Load float frames at `ptr` (f32), and build the levels, all at once. */
  loadF32(ptr: usize, frames: i32, rate: f64): void { this.beginF32(ptr, frames, rate); this.work(0x7fffffff); }

  /**
   * Start loading 16-bit frames in steps (`work`), so a source changed while playing never overruns a
   * block: until it is done the source is silent (`frames` 0, every read 0, `spawn` refuses).
   */
  beginI16(ptr: usize, frames: i32, rate: f64): void { this.begin(ptr, frames, rate, true); }
  /** The same for float frames. */
  beginF32(ptr: usize, frames: i32, rate: f64): void { this.begin(ptr, frames, rate, false); }

  /** Still loading (`beginI16`/`beginF32` until `work` has finished). */
  get loading(): bool { return this.stage >= 0; }

  /**
   * Do up to `units` of the load (a frame converted is 1, a mip frame filtered is 4: about 60 meter points a
   * unit at most). Returns true once the source is ready. 32768 units a block finish a 64 000-frame source
   * in 10 blocks.
   */
  work(units: i32): bool {
    let left = units;
    while (this.stage >= 0 && left > 0) {
      if (this.stage == 0) {
        // Level 0: the frames, converted.
        const n = this.pFrames;
        let to = this.at + left; if (to > n) to = n;
        if (this.pI16) for (let i = this.at; i < to; i++) unchecked(this.buf[GUARD + i] = <f32>(<f64>load<i16>(this.pPtr + (<usize>i << 1)) * 3.0517578125e-5));
        else for (let i = this.at; i < to; i++) unchecked(this.buf[GUARD + i] = load<f32>(this.pPtr + (<usize>i << 2)));
        left -= to - this.at;
        this.at = to;
        if (to >= n) {
          unchecked(this.off[0] = GUARD); unchecked(this.len[0] = n);
          this.guard(0);
          this.stage = 1; this.at = 0;
          unchecked(this.off[1] = GUARD + n + 2 * GUARD); unchecked(this.len[1] = n >> 1);
        }
      } else {
        // Level `stage`: half the one before, through the half-band filter (the level before read as a loop).
        const l = this.stage;
        const src = unchecked(this.off[l - 1]), srcLen = unchecked(this.len[l - 1]);
        const dst = unchecked(this.off[l]), m = unchecked(this.len[l]);
        const c = HB_TAPS >> 1;
        let to = this.at + (left >> 2) + 1; if (to > m) to = m;
        for (let i = this.at; i < to; i++) {
          let acc = <f64>unchecked(this.buf[src + 2 * i]) * unchecked(this.hb[c]);
          for (let k = 1; k <= c; k += 2) {
            let a = 2 * i - k, b = 2 * i + k;
            if (a < 0) a += srcLen;
            if (b >= srcLen) b -= srcLen;
            acc += unchecked(this.hb[c + k]) * (<f64>unchecked(this.buf[src + a]) + <f64>unchecked(this.buf[src + b]));
          }
          // (1.713) Flushed below 1e-20: each level filters the last, so a quiet stretch's tiny values, times the
          // window's near-zero edge taps, would sink into subnormal f32 values that every later read multiplies.
          unchecked(this.buf[dst + i] = <f32>flush(acc));
        }
        left -= ((to - this.at) << 2) + 1;
        this.at = to;
        if (to >= m) {
          this.guard(l);
          if (l + 1 < MIP_LEVELS) {
            unchecked(this.off[l + 1] = dst + m + 2 * GUARD); unchecked(this.len[l + 1] = m >> 1);
            this.stage = l + 1; this.at = 0;
          } else {
            this.stage = -1;
            this.frames = this.pFrames;
            this.rate = this.pRate;
          }
        }
      }
    }
    return this.stage < 0;
  }

  /** Empty (silence; every read is 0). */
  clear(): void {
    this.frames = 0; this.stage = -1;
    for (let l = 0; l < MIP_LEVELS; l++) { unchecked(this.off[l] = GUARD); unchecked(this.len[l] = 0); }
    for (let i = 0; i < this.buf.length; i++) unchecked(this.buf[i] = 0);
  }

  private begin(ptr: usize, frames: i32, rate: f64, i16: bool): void {
    let n = frames; if (n > this.capacity) n = this.capacity; if (n < 2) n = 0;
    this.frames = 0;
    this.pPtr = ptr; this.pFrames = n; this.pRate = rate > 1.0 ? rate : 48000.0; this.pI16 = i16;
    this.stage = 0; this.at = 0;
    if (n == 0) { this.clear(); }
  }

  /** The guard frames of level `l`: the loop's end before its start and its start after its end. */
  private guard(l: i32): void {
    const o = unchecked(this.off[l]), n = unchecked(this.len[l]);
    for (let g = 1; g <= GUARD; g++) {
      unchecked(this.buf[o - g] = n > 0 ? unchecked(this.buf[o + ((n - (g % n)) % n)]) : 0);
      unchecked(this.buf[o + n - 1 + g] = n > 0 ? unchecked(this.buf[o + ((g - 1) % n)]) : 0);
    }
  }

  /** The level a read stepping `step` level-0 frames a host frame takes (its step there at most 1). */
  levelFor(step: f64): i32 {
    let s = abs<f64>(step), l = 0;
    while (s > 1.0 && l < MIP_LEVELS - 1) { s *= 0.5; l++; }
    return l;
  }

  /** The value at level-0 position `pos` (wrapped into the source) read at level `level`: Hermite. */
  read(level: i32, pos: f64): f64 {
    const n0 = this.frames;
    if (n0 <= 0) return 0;
    let p = pos;
    if (p >= <f64>n0 || p < 0.0) { p = p - <f64>n0 * Math.floor(p / <f64>n0); }
    return this.readAt(unchecked(this.off[level]), unchecked(this.len[level]), p * this.levelScale(level));
  }

  /** 2^-level. */
  // @ts-ignore: decorator
  @inline levelScale(level: i32): f64 { return 1.0 / <f64>(1 << level); }

  /** Hermite at position `x` (in the level's frames, inside [0, n)) of the level at `o`. */
  // @ts-ignore: decorator
  @inline readAt(o: i32, n: i32, x: f64): f64 {
    let i = <i32>x;
    if (i >= n) i = n - 1;
    const f = x - <f64>i;
    const b = o + i;
    const y0 = <f64>unchecked(this.buf[b - 1]), y1 = <f64>unchecked(this.buf[b]);
    const y2 = <f64>unchecked(this.buf[b + 1]), y3 = <f64>unchecked(this.buf[b + 2]);
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }
}

/** One grain: where it reads, how fast, its window and its pan. */
export class Grain {
  active: bool = false;
  owner: i32 = -1;
  /** Level-0 frames of the source. */
  pos: f64 = 0;
  /** Level-0 frames a host frame (negative: reversed). */
  step: f64 = 1;
  level: i32 = 0;
  phase: f64 = 0;
  dphase: f64 = 0;
  shape: i32 = WIN_HANN;
  gainL: f64 = 0;
  gainR: f64 = 0;
  /** Frames of the block to wait before it starts (its fire time inside the block). */
  delay: i32 = 0;
}

/** Equal-power gains for `pan` in [-1, 1]: left in `.x`, right in the return. Writes into the grain. */
// @ts-ignore: decorator
@inline function panInto(g: Grain, pan: f64, gain: f64): void {
  let p = pan; if (p < -1.0) p = -1.0; if (p > 1.0) p = 1.0;
  const t = (p + 1.0) * 0.125; // a quarter turn across
  g.gainL = cosTurns(t) * gain;
  g.gainR = sinTurns(t) * gain;
}

/** A fixed pool of grains, each owned by a voice or playhead, rendered into the caller's buffers. */
export class GrainPool {
  grains: StaticArray<Grain>;
  /** The most grains one owner holds at once. */
  ownerCap: i32;
  /** Grains not started because a cap was reached (since `reset`): a readout, never a decision. */
  refused: i32 = 0;
  /** With owners numbered 0 … owners − 1 (`owners` given): each owner's grains sounding, kept as they start and end. */
  ownerCount: StaticArray<i32>;
  /** Grains sounding in all. */
  sounding: i32 = 0;

  /**
   * `count` grains; at most `ownerCap` an owner. `owners` (optional): owners are numbered 0 … owners − 1, so the
   * pool keeps each one's count (`activeOf`, a cap checked without a walk) and `renderInto` renders them all in one
   * pass, each into its own buffers.
   */
  constructor(count: i32, ownerCap: i32 = 0, owners: i32 = 0) {
    this.grains = new StaticArray<Grain>(count);
    this.ownerCount = new StaticArray<i32>(owners > 0 ? owners : 0);
    for (let i = 0; i < count; i++) unchecked(this.grains[i] = new Grain());
    this.ownerCap = ownerCap > 0 ? ownerCap : count;
  }

  /** An owner's grains sounding (owners numbered, else a walk). */
  activeOf(owner: i32): i32 {
    if (owner >= 0 && owner < this.ownerCount.length) return unchecked(this.ownerCount[owner]);
    return this.active(owner);
  }

  // @ts-ignore: decorator
  @inline private ended(g: Grain): void {
    g.active = false;
    this.sounding--;
    const o = g.owner;
    if (o >= 0 && o < this.ownerCount.length) unchecked(this.ownerCount[o] = unchecked(this.ownerCount[o]) - 1);
  }

  get count(): i32 { return this.grains.length; }

  reset(): void {
    for (let i = 0; i < this.grains.length; i++) unchecked(this.grains[i]).active = false;
    for (let i = 0; i < this.ownerCount.length; i++) unchecked(this.ownerCount[i] = 0);
    this.sounding = 0;
    this.refused = 0;
  }

  /** Grains sounding (all, or `owner`'s): counted, never kept. */
  active(owner: i32 = -1): i32 {
    if (owner < 0) return this.sounding;
    let c = 0;
    for (let i = 0; i < this.grains.length; i++) {
      const g = unchecked(this.grains[i]);
      if (g.active && (owner < 0 || g.owner == owner)) c++;
    }
    return c;
  }

  /**
   * Start a grain for `owner`: at source position `pos` (level-0 frames), reading `step` frames a host
   * frame (negative: backward), `frames` host frames long (bounded by MIN/MAX_GRAIN_SECONDS at `sampleRate`),
   * window `shape`, `pan` in [-1, 1], `gain`, starting `delay` frames into the next render. The grain's
   * level is chosen from its step against `src`. Returns its index, or -1 when a cap refused it.
   */
  spawn(src: GrainSource, owner: i32, pos: f64, step: f64, frames: f64, shape: i32, pan: f64, gain: f64, delay: i32, sampleRate: f64): i32 {
    const counted = owner >= 0 && owner < this.ownerCount.length;
    let free = -1, mine = counted ? unchecked(this.ownerCount[owner]) : 0;
    if (this.sounding < this.grains.length && mine < this.ownerCap) {
      for (let i = 0; i < this.grains.length; i++) {
        const g = unchecked(this.grains[i]);
        if (!g.active) { free = i; break; }
      }
      if (!counted) mine = this.active(owner);
    }
    if (free < 0 || mine >= this.ownerCap || src.frames <= 0) { this.refused++; return -1; }
    let len = frames;
    const lo = MIN_GRAIN_SECONDS * sampleRate, hi = MAX_GRAIN_SECONDS * sampleRate;
    if (len < lo) len = lo; if (len > hi) len = hi;
    const g = unchecked(this.grains[free]);
    g.active = true; g.owner = owner; g.step = step; g.level = src.levelFor(step);
    const n = <f64>src.frames;
    let p = pos; if (p >= n || p < 0.0) p = p - n * Math.floor(p / n);
    g.pos = p; g.phase = 0; g.dphase = 1.0 / len;
    g.shape = shape < 0 ? 0 : shape >= WIN_COUNT ? WIN_COUNT - 1 : shape;
    g.delay = delay < 0 ? 0 : delay;
    panInto(g, pan, gain);
    this.sounding++;
    if (counted) unchecked(this.ownerCount[owner] = mine + 1);
    return free;
  }

  /** End every grain of `owner` (all with -1) at once: only for a voice already silent (its envelope at 0). */
  stop(owner: i32): void {
    if (owner >= 0 && owner < this.ownerCount.length && unchecked(this.ownerCount[owner]) == 0) return;
    for (let i = 0; i < this.grains.length; i++) {
      const g = unchecked(this.grains[i]);
      if (g.active && (owner < 0 || g.owner == owner)) this.ended(g);
    }
  }

  /**
   * Add `owner`'s grains (every grain with -1) to `outL`/`outR` over frames [0, frames). A grain ends
   * when its window does. Returns how many grains it rendered.
   */
  render(src: GrainSource, win: GrainWindows, owner: i32, outL: StaticArray<f64>, outR: StaticArray<f64>, frames: i32): i32 {
    let rendered = 0;
    if (src.frames <= 0) { if (owner < 0) this.reset(); else this.stop(owner); return 0; }
    if (owner >= 0 && owner < this.ownerCount.length && unchecked(this.ownerCount[owner]) == 0) return 0;
    for (let gi = 0; gi < this.grains.length; gi++) {
      const g = unchecked(this.grains[gi]);
      if (!g.active || (owner >= 0 && g.owner != owner)) continue;
      rendered++;
      this.one(src, win, g, outL, outR, frames);
    }
    return rendered;
  }

  /**
   * Every grain in one pass, each into its owner's buffers (`outL[owner]`, `outR[owner]`; owners numbered, the
   * pool made with `owners`): one walk of the pool a block however many owners sound. The caller clears the
   * buffers of the owners it reads. Returns how many grains it rendered.
   */
  renderInto(src: GrainSource, win: GrainWindows, outL: StaticArray<StaticArray<f64>>, outR: StaticArray<StaticArray<f64>>, frames: i32): i32 {
    if (src.frames <= 0) { this.reset(); return 0; }
    if (this.sounding == 0) return 0;
    let rendered = 0;
    const owners = outL.length < outR.length ? outL.length : outR.length;
    for (let gi = 0; gi < this.grains.length; gi++) {
      const g = unchecked(this.grains[gi]);
      if (!g.active) continue;
      const o = g.owner;
      if (o < 0 || o >= owners) { this.ended(g); continue; }
      rendered++;
      this.one(src, win, g, unchecked(outL[o]), unchecked(outR[o]), frames);
    }
    return rendered;
  }

  /** One grain over [its delay, frames), added into L and R; ended when its window is. */
  private one(src: GrainSource, win: GrainWindows, g: Grain, outL: StaticArray<f64>, outR: StaticArray<f64>, frames: i32): void {
    const start = g.delay;
    if (start >= frames) { g.delay = start - frames; return; }
    g.delay = 0;
    const n0 = <f64>src.frames;
    const wt = win.table;
    const o = unchecked(src.off[g.level]);
    const ln = unchecked(src.len[g.level]);
    const sc = src.levelScale(g.level);
    const wo = g.shape * (WIN_POINTS + 1);
    const wp = <f64>WIN_POINTS;
    let pos = g.pos, ph = g.phase;
    const step = g.step, dph = g.dphase, gl = g.gainL, gr = g.gainR;
    let done = false;
    for (let n = start; n < frames; n++) {
      // The window.
      const wx = ph * wp;
      let wi = <i32>wx; if (wi >= WIN_POINTS) wi = WIN_POINTS - 1;
      const wa = <f64>unchecked(wt[wo + wi]);
      const w = wa + (<f64>unchecked(wt[wo + wi + 1]) - wa) * (wx - <f64>wi);
      // The source.
      const s = src.readAt(o, ln, pos * sc) * w;
      unchecked(outL[n] += s * gl);
      unchecked(outR[n] += s * gr);
      pos += step;
      if (pos >= n0) pos -= n0; else if (pos < 0.0) pos += n0;
      ph += dph;
      if (ph >= 1.0) { done = true; break; }
    }
    g.pos = pos; g.phase = ph;
    if (done) this.ended(g);
  }
}

/** Playhead directions. */
export const PH_FORWARD: i32 = 0;
export const PH_REVERSE: i32 = 1;
export const PH_PINGPONG: i32 = 2;

/** A position scanning a region of the source: forward, backward or ping-pong, at any speed (0 holds it). */
export class Playhead {
  /** Level-0 frames of the source. */
  pos: f64 = 0;
  /** The region: its first frame and its length (frames). */
  start: f64 = 0;
  length: f64 = 1;
  mode: i32 = PH_FORWARD;
  /** +1 or −1: ping-pong's way now. */
  way: f64 = 1;

  /** Set the region (clamped into a source of `frames`; at least 16 frames long). */
  setRegion(start: f64, length: f64, frames: i32): void {
    const n = <f64>(frames > 1 ? frames : 1);
    let s = start; if (s < 0.0) s = 0.0; if (s > n - 1.0) s = n - 1.0;
    let l = length; if (l < 16.0) l = 16.0; if (l > n) l = n;
    this.start = s; this.length = l;
  }

  /** Go to the region's start (forward, ping-pong) or end (reverse). */
  restart(): void {
    this.way = 1;
    this.pos = this.mode == PH_REVERSE ? this.start + this.length - 1.0 : this.start;
  }

  /** The direction the playhead reads now: +1 or −1. */
  get dir(): f64 { return this.mode == PH_REVERSE ? -1.0 : this.mode == PH_PINGPONG ? this.way : 1.0; }

  /**
   * Move `frames` level-0 frames (≥ 0: the distance; the direction is the mode's), folding into the
   * region (a region that moved under it takes the playhead with it). The position may pass the
   * source's end inside a region that wraps: a reader wraps it.
   */
  advance(frames: f64): void {
    const a = this.start, l = this.length;
    let rel = this.pos - a;
    if (rel < 0.0 || rel >= l) rel = rel - l * Math.floor(rel / l);
    if (this.mode == PH_PINGPONG) {
      // Fold over a doubled region: 0..l forward, l..2l back.
      let u = (this.way > 0.0 ? rel : 2.0 * l - rel) + frames;
      const p2 = 2.0 * l;
      if (u >= p2 || u < 0.0) u = u - p2 * Math.floor(u / p2);
      if (u < l) { this.way = 1; rel = u; } else { this.way = -1; rel = p2 - u; if (rel >= l) rel = l - 1e-9; }
    } else {
      rel += this.mode == PH_REVERSE ? -frames : frames;
      if (rel >= l || rel < 0.0) rel = rel - l * Math.floor(rel / l);
    }
    this.pos = a + rel;
  }
}

/**
 * When grains fire: free (a density in grains a second, or an overlap of a grain's length) or synced
 * to the host's beat grid (a fraction of a beat). Each grain is numbered (`index`): in free time from
 * the start (a position in the note), synced by the song's grid, so its dice are seeded by position.
 */
export class GrainScheduler {
  /** Frames from one grain to the next (free). */
  period: f64 = 4800;
  /** Frames until the next grain (free). */
  countdown: f64 = 0;
  /** The number of the grain fired last (free: from `start`; synced: its grid step). */
  index: i64 = -1;
  /** Timing jitter, 0..1 of a period, seeded per grain. */
  jitter: f64 = 0;
  /** Seeds: the owner, the key, a salt (which playhead). */
  voice: i32 = 0;
  key: i32 = 0;
  salt: i32 = 0;
  // Synced.
  synced: bool = false;
  /** Beats from one grain to the next (synced). */
  beatsPerGrain: f64 = 0.25;
  private beat0: f64 = 0;
  private beatsPerFrame: f64 = 0;
  private lastGrid: i64 = -9223372036854775807;
  private pending: f64 = 0;

  /** The next grain fires at once, numbered 0. */
  start(): void { this.countdown = 0; this.index = -1; this.pending = 0; this.lastGrid = -9223372036854775807; }

  /** Free: `hz` grains a second (bounded by MAX_DENSITY) at `sampleRate`. */
  setDensity(hz: f64, sampleRate: f64): void {
    let h = hz; if (h > MAX_DENSITY) h = MAX_DENSITY; if (h < 0.05) h = 0.05;
    this.period = sampleRate / h;
  }

  /** Free: one grain every `lengthFrames / overlap` frames (an overlap of 2 with Hann plays as tape). */
  setOverlap(lengthFrames: f64, overlap: f64, sampleRate: f64): void {
    const o = overlap > 0.05 ? overlap : 0.05;
    let p = lengthFrames / o;
    const lo = sampleRate / MAX_DENSITY;
    if (p < lo) p = lo;
    this.period = p;
  }

  /** Synced for this block: the song's beat at its first frame and its tempo (`playing` false: free time). */
  setTransport(playing: bool, beat: f64, bpm: f64, sampleRate: f64): void {
    this.synced = playing && bpm > 0.0;
    this.beat0 = beat;
    this.beatsPerFrame = bpm / (60.0 * sampleRate);
  }

  /**
   * The frame in [from, frames) where the next grain fires in this block, or -1: call in a loop from 0
   * (each answer is consumed; pass the answer + 1 as `from` next). Sets `index`.
   */
  next(from: i32, frames: i32): i32 {
    if (this.synced) {
      const step = this.beatsPerGrain > 1e-4 ? this.beatsPerGrain : 1e-4;
      const bpf = this.beatsPerFrame;
      if (bpf <= 0.0) return -1;
      const b = this.beat0 + <f64>from * bpf;
      let k = <i64>Math.ceil(b / step - 1e-9);
      // The song went back past the grain fired last: re-lay from here. Else never fire a step twice.
      if (k <= this.lastGrid && <f64>this.lastGrid * step <= b + step) k = this.lastGrid + 1;
      const kb = <f64>k * step;
      let at = (kb - this.beat0) / bpf;
      // A jump back (the song went back), or a far jump: re-lay from here (never fire what was skipped).
      if (at < <f64>from - 0.5) at = <f64>from;
      // Jitter delays a grid grain by up to half a step, seeded by its grid index.
      at += this.jitter * 0.5 * step / bpf * chance(k, this.voice, this.key, this.salt ^ 0x51);
      // A grid point a hair before a frame (the beat's rounding) is that frame.
      at += 1e-4;
      if (at >= <f64>frames) return -1;
      this.lastGrid = k;
      this.index = k;
      const f = <i32>at;
      return f < from ? from : f;
    }
    // Free.
    let at = <f64>from + this.countdown;
    if (at >= <f64>frames) { this.countdown -= <f64>(frames - from); return -1; }
    const f = <i32>at;
    this.index++;
    // The next period, jittered (seeded by the grain's number from the start).
    const j = this.jitter > 0.0 ? 1.0 + this.jitter * (chance(this.index, this.voice, this.key, this.salt ^ 0x3d) - 0.5) : 1.0;
    this.countdown = (at - <f64>f) + this.period * j - 1.0;
    if (this.countdown < 0.0) this.countdown = 0.0;
    return f;
  }

  /** A seeded value in [0, 1) for the grain fired last: `salt` says which choice (position, pitch, pan …). */
  // @ts-ignore: decorator
  @inline dice(salt: i32): f64 { return chance(this.index, this.voice, this.key, (this.salt << 8) ^ salt); }
  /** The same in [-1, 1). */
  // @ts-ignore: decorator
  @inline spray(salt: i32): f64 { return this.dice(salt) * 2.0 - 1.0; }
}

/** A frequency ratio for `semitones` (exp2(s/12)). */
// @ts-ignore: decorator
@inline export function semitoneRatio(semitones: f64): f64 { return exp(semitones * 0.057762265046662105); }
