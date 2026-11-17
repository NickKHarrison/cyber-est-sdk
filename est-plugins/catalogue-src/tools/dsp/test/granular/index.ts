// The granular engine's probe (not a plugin): its parts behind plain exports, so
// sdk/tests/dspGranular.test.ts can drive them and read what they do.

import { GrainPool, GrainScheduler, GrainSource, GrainWindows, Playhead, semitoneRatio } from "../../granular";
import { sinTurns } from "est";

const MAX = 1 << 18;
const OUT = memory.data(MAX * 8, 16);
const SRC = memory.data(MAX * 4, 16);
// @ts-ignore: decorator
@inline function out(i: i32, v: f64): void { store<f64>(OUT + (<usize>i << 3), v); }
export function output_ptr(): usize { return OUT; }

const win = new GrainWindows();
const src = new GrainSource(MAX);
const pool = new GrainPool(64, 8);
const L = new StaticArray<f64>(128);
const R = new StaticArray<f64>(128);

export function window_at(shape: i32, phase: f64): f64 { return win.at(shape, phase); }

/** A source of `frames` frames at `rate`: a sine of `cycles` cycles a frame (plus `cycles2` at half the amplitude when > 0). */
export function src_sine(frames: i32, rate: f64, cycles: f64, cycles2: f64): void {
  for (let i = 0; i < frames; i++) {
    let v = 0.5 * sinTurns(cycles * <f64>i);
    if (cycles2 > 0.0) v += 0.25 * sinTurns(cycles2 * <f64>i);
    store<f32>(SRC + (<usize>i << 2), <f32>v);
  }
  src.loadF32(SRC, frames, rate);
}
/** A source from 16-bit frames: a ramp (frame i is i − frames/2, in 16-bit steps). */
export function src_ramp_i16(frames: i32): void {
  for (let i = 0; i < frames; i++) store<i16>(SRC + (<usize>i << 1), <i16>(i - (frames >> 1)));
  src.loadI16(SRC, frames, 48000);
}
/** The same sine loaded in steps of `units`: how many `work` calls it took (frames read 0 until done). */
export function src_sine_steps(frames: i32, rate: f64, cycles: f64, units: i32): i32 {
  for (let i = 0; i < frames; i++) store<f32>(SRC + (<usize>i << 2), <f32>(0.5 * sinTurns(cycles * <f64>i)));
  src.beginF32(SRC, frames, rate);
  let calls = 0;
  while (!src.work(units)) { calls++; if (src.frames != 0 || src.read(0, 10) != 0.0 || !src.loading) return -1; }
  return calls + 1;
}
export function src_frames(): i32 { return src.frames; }
export function src_level_len(l: i32): i32 { return unchecked(src.len[l]); }
export function src_level_for(step: f64): i32 { return src.levelFor(step); }
export function src_read(level: i32, pos: f64): f64 { return src.read(level, pos); }
export function src_clear(): void { src.clear(); }

/** One grain alone, rendered `frames` frames in 128-frame blocks: L then R in the output; returns the frame it ended (or -1). */
export function one_grain(pos: f64, step: f64, len: f64, shape: i32, pan: f64, gain: f64, delay: i32, frames: i32, sr: f64): i32 {
  pool.reset();
  if (pool.spawn(src, 0, pos, step, len, shape, pan, gain, delay, sr) < 0) return -2;
  let ended = -1;
  for (let b = 0; b < frames; b += 128) {
    for (let i = 0; i < 128; i++) { unchecked(L[i] = 0); unchecked(R[i] = 0); }
    pool.render(src, win, -1, L, R, 128);
    for (let i = 0; i < 128 && b + i < frames; i++) { out(b + i, unchecked(L[i])); out(MAX / 2 + b + i, unchecked(R[i])); }
    if (ended < 0 && pool.active() == 0) ended = b;
  }
  return ended;
}

/** Spawn `n` grains for `owner` at once: how many were refused. */
export function spawn_many(owner: i32, n: i32, sr: f64): i32 {
  const before = pool.refused;
  for (let i = 0; i < n; i++) pool.spawn(src, owner, 0, 1, 4800, 0, 0, 1, 0, sr);
  return pool.refused - before;
}
const poolN = new GrainPool(64, 8, 4);
const bufL = new StaticArray<StaticArray<f64>>(4);
const bufR = new StaticArray<StaticArray<f64>>(4);
for (let i = 0; i < 4; i++) { unchecked(bufL[i] = new StaticArray<f64>(128)); unchecked(bufR[i] = new StaticArray<f64>(128)); }
/**
 * The same grains for owners 0..3 (three each, `steps` blocks) rendered by `renderInto` (pool with numbered owners)
 * and by `render(owner)` (a plain pool): the largest difference between the two, owner by owner.
 */
export function render_into_vs_owner(blocks: i32, sr: f64): f64 {
  pool.reset(); poolN.reset();
  for (let o = 0; o < 4; o++) for (let k = 0; k < 3; k++) {
    const pos = <f64>(1000 + 700 * o + 300 * k), step = 0.5 + 0.3 * <f64>k, len = <f64>(900 + 400 * o), pan = <f64>(o - 2) * 0.4;
    pool.spawn(src, o, pos, step, len, k, pan, 1.0, 37 * k, sr);
    poolN.spawn(src, o, pos, step, len, k, pan, 1.0, 37 * k, sr);
  }
  if (poolN.activeOf(2) != 3 || poolN.active() != 12) return -1;
  let worst = 0.0;
  for (let b = 0; b < blocks; b++) {
    for (let o = 0; o < 4; o++) for (let i = 0; i < 128; i++) { unchecked(bufL[o][i] = 0); unchecked(bufR[o][i] = 0); }
    poolN.renderInto(src, win, bufL, bufR, 128);
    for (let o = 0; o < 4; o++) {
      for (let i = 0; i < 128; i++) { unchecked(L[i] = 0); unchecked(R[i] = 0); }
      pool.render(src, win, o, L, R, 128);
      for (let i = 0; i < 128; i++) {
        const d = abs<f64>(unchecked(L[i]) - unchecked(bufL[o][i])) + abs<f64>(unchecked(R[i]) - unchecked(bufR[o][i]));
        if (d > worst) worst = d;
      }
      if (poolN.activeOf(o) != pool.active(o)) return -2;
    }
  }
  return worst;
}
export function poolN_active(owner: i32): i32 { return poolN.activeOf(owner); }
export function pool_reset(): void { pool.reset(); }
export function pool_active(owner: i32): i32 { return pool.active(owner); }

const ph = new Playhead();
const sch = new GrainScheduler();

/**
 * Tape: a playhead over the region [start, start+length) at `speed`, its grains Hann at an overlap of 2,
 * `grain` frames long, read at the speed it scans. `frames` frames out (mono, the left), 128 at a time.
 */
export function tape(start: f64, length: f64, speed: f64, mode: i32, grain: f64, frames: i32, sr: f64): i32 {
  pool.reset();
  ph.mode = mode; ph.setRegion(start, length, src.frames); ph.restart();
  sch.start(); sch.jitter = 0; sch.setOverlap(grain, 2.0, sr);
  let spawned = 0;
  for (let b = 0; b < frames; b += 128) {
    for (let i = 0; i < 128; i++) { unchecked(L[i] = 0); unchecked(R[i] = 0); }
    let from = 0;
    let moved: f64 = 0;
    for (let k = sch.next(0, 128); k >= 0; k = sch.next(from, 128)) {
      const d = <f64>k - moved;
      ph.advance(d * speed); moved = <f64>k;
      if (pool.spawn(src, 0, ph.pos, ph.dir * speed, grain, 0, -1.0, 1.0, k, sr) >= 0) spawned++;
      from = k + 1;
    }
    ph.advance((128.0 - moved) * speed);
    pool.render(src, win, -1, L, R, 128);
    for (let i = 0; i < 128 && b + i < frames; i++) out(b + i, unchecked(L[i]));
  }
  return spawned;
}

/** A free scheduler at `hz` with `jitter`: the frames it fires over `frames` frames (blocks of `block`) into the output; returns the count. */
export function sched_free(hz: f64, jitter: f64, frames: i32, block: i32, sr: f64, voice: i32, key: i32): i32 {
  sch.start(); sch.jitter = jitter; sch.voice = voice; sch.key = key; sch.salt = 1; sch.setDensity(hz, sr);
  let c = 0;
  for (let b = 0; b < frames; b += block) {
    let from = 0;
    for (let k = sch.next(0, block); k >= 0; k = sch.next(from, block)) { out(c++, <f64>(b + k)); from = k + 1; }
  }
  return c;
}

/** A synced scheduler: the song from `beat0` at `bpm`, a grain every `bpg` beats; out: frame, index pairs. Blocks jump to `jumpTo` at frame `jumpAt` (when ≥ 0). */
export function sched_sync(beat0: f64, bpm: f64, bpg: f64, frames: i32, block: i32, sr: f64, jumpAt: i32, jumpTo: f64): i32 {
  sch.start(); sch.jitter = 0; sch.beatsPerGrain = bpg;
  let c = 0;
  let beat = beat0;
  const bpf = bpm / (60.0 * sr);
  for (let b = 0; b < frames; b += block) {
    if (jumpAt >= 0 && b == jumpAt) beat = jumpTo;
    sch.setTransport(true, beat, bpm, sr);
    let from = 0;
    for (let k = sch.next(0, block); k >= 0; k = sch.next(from, block)) { out(2 * c, <f64>(b + k)); out(2 * c + 1, <f64>sch.index); c++; from = k + 1; }
    beat += bpf * <f64>block;
  }
  return c;
}

/** A playhead: `steps` moves of `delta`, its position after each into the output. */
export function playhead_run(mode: i32, start: f64, length: f64, frames: i32, delta: f64, steps: i32): void {
  ph.mode = mode; ph.setRegion(start, length, frames); ph.restart();
  for (let i = 0; i < steps; i++) { ph.advance(delta); out(i, ph.pos); }
}

export function ratio(semitones: f64): f64 { return semitoneRatio(semitones); }

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
