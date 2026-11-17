/**
 * 1.711: the DSP toolkit's granular engine (est-plugins/catalogue-src/tools/dsp/granular.ts). Each rule it
 * exists for, held on its probe (tools/dsp/test/granular), built with asc at the start of the file:
 * windows from 0 to 0 (Hann's overlap of 2 summing to 1), band-limited reads through the half-band mip
 * levels, sample-accurate grains, the pool's caps, a tape playhead equal to the source, the schedulers'
 * determinism (free and synced to the song's grid, any block size, a jump never firing what it skipped)
 * and the playheads' three directions.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findAsc } from '../packages/tools/src/index';
import { repo } from './helpers';

const DIR = 'est-plugins/catalogue-src/tools/dsp/test/granular';
const SR = 48000;
const HALF = (1 << 18) / 2;
const tmp = mkdtempSync(join(tmpdir(), 'est-dsp-granular-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Fn = (...a: number[]) => number;
let P: Record<string, Fn>;
let mem: WebAssembly.Memory;

beforeAll(() => {
  const asc = findAsc(repo(DIR));
  expect(asc, 'asc (the assemblyscript dev dependency)').toBeTruthy();
  const out = join(tmp, 'granular.wasm');
  const r = spawnSync(asc!, ['index.ts', '--config', 'asconfig.json', '--target', 'release', '--outFile', out], { cwd: repo(DIR), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  const module = new WebAssembly.Module(new Uint8Array(readFileSync(out)) as BufferSource);
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  const inst = new WebAssembly.Instance(module, {});
  P = inst.exports as unknown as Record<string, Fn>;
  mem = inst.exports.memory as WebAssembly.Memory;
}, 120_000);

const outOf = (n: number, at = 0) => new Float64Array(mem.buffer, P.output_ptr!() + at * 8, n).slice();
const rms = (a: ArrayLike<number>, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]! * a[i]!; return Math.sqrt(s / Math.max(1, to - from)); };
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

describe('windows', () => {
  it('every window starts and ends at 0 and peaks at 1', () => {
    for (let s = 0; s < 4; s++) {
      expect(P.window_at!(s, 0)).toBe(0);
      expect(P.window_at!(s, 1)).toBe(0);
      let peak = 0;
      for (let i = 0; i <= 1000; i++) peak = Math.max(peak, P.window_at!(s, i / 1000));
      expect(peak).toBeGreaterThan(0.99);
      expect(peak).toBeLessThanOrEqual(1.0000001);
    }
  });
  it('Hann at an overlap of 2 sums to 1 (tape)', () => {
    for (let i = 0; i <= 500; i++) {
      const p = i / 1000;
      expect(P.window_at!(0, p) + P.window_at!(0, p + 0.5)).toBeCloseTo(1, 5);
    }
  });
  it('the exponential window is a struck grain: high early, under −50 dB near its end', () => {
    expect(P.window_at!(3, 0.05)).toBeGreaterThan(0.85);
    expect(db(P.window_at!(3, 0.9))).toBeLessThan(-50);
  });
});

describe('the source and its mip levels', () => {
  it('each level is half the one before, and a step picks the level where it is at most 1', () => {
    P.src_sine!(20000, SR, 0.01, 0);
    expect(P.src_frames!()).toBe(20000);
    for (let l = 0; l < 6; l++) expect(P.src_level_len!(l)).toBe(20000 >> l);
    expect(P.src_level_for!(0.5)).toBe(0);
    expect(P.src_level_for!(1)).toBe(0);
    expect(P.src_level_for!(1.5)).toBe(1);
    expect(P.src_level_for!(-3.9)).toBe(2);
    expect(P.src_level_for!(1000)).toBe(5);
  });
  it('reads exactly at whole frames of level 0 and wraps the source', () => {
    P.src_sine!(1000, SR, 0.013, 0);
    for (const i of [0, 1, 10, 999]) expect(P.src_read!(0, i)).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * 0.013 * i), 5);
    expect(P.src_read!(0, 1010)).toBeCloseTo(P.src_read!(0, 10), 9);
    expect(P.src_read!(0, -3)).toBeCloseTo(P.src_read!(0, 997), 9);
  });
  it('a load in steps is silent until done, then equal to a load at once (a source changed while playing never overruns a block)', () => {
    P.src_sine!(20000, SR, 0.37, 0);
    const once = [0, 1, 2, 3, 4, 5].map((l) => [P.src_read!(l, 777.3), P.src_read!(l, 19000)]);
    const calls = P.src_sine_steps!(20000, SR, 0.37, 4096);
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThan(40);
    expect(P.src_frames!()).toBe(20000);
    expect([0, 1, 2, 3, 4, 5].map((l) => [P.src_read!(l, 777.3), P.src_read!(l, 19000)])).toEqual(once);
  });
  it('16-bit frames load at 1/32768', () => {
    P.src_ramp_i16!(64);
    expect(P.src_read!(0, 0)).toBeCloseTo(-32 / 32768, 9);
    expect(P.src_read!(0, 40)).toBeCloseTo(8 / 32768, 9);
  });
  it('a grain pitched up reads band-limited: a tone over the level\'s Nyquist is gone, a low one kept', () => {
    // 0.4 cycles a frame: an octave up it would alias at level 0. Read at a step of 2.5 (level 2).
    P.src_sine!(48000, SR, 0.4, 0);
    P.one_grain!(1000, 2.5, 24000, 1, 0, 1, 0, 24000, SR);
    const high = rms(outOf(24000), 6000, 18000);
    P.one_grain!(1000, 0.5, 24000, 1, 0, 1, 0, 24000, SR);
    const ref = rms(outOf(24000), 6000, 18000);
    expect(db(high / ref)).toBeLessThan(-40);
    // A low tone (0.01 cycles a frame) read three octaves up keeps its level within 0.5 dB.
    P.src_sine!(48000, SR, 0.01, 0);
    P.one_grain!(1000, 8, 24000, 1, 0, 1, 0, 24000, SR);
    const low = rms(outOf(24000), 6000, 18000);
    P.one_grain!(1000, 1, 24000, 1, 0, 1, 0, 24000, SR);
    const lowRef = rms(outOf(24000), 6000, 18000);
    expect(Math.abs(db(low / lowRef))).toBeLessThan(0.5);
  });
});

describe('grains', () => {
  it('a grain starts on its frame, rises from 0, ends at 0 and stops', () => {
    P.src_sine!(48000, SR, 0.02, 0);
    const ended = P.one_grain!(0, 1, 2400, 0, 0, 1, 50, 4096, SR);
    const L = outOf(4096);
    for (let i = 0; i <= 50; i++) expect(L[i]).toBe(0);
    expect(Math.abs(L[51]!)).toBeLessThan(1e-4);
    for (let i = 2451; i < 4096; i++) expect(L[i]).toBe(0);
    expect(ended).toBeGreaterThan(0);
    let step = 0; for (let i = 1; i < 4096; i++) step = Math.max(step, Math.abs(L[i]! - L[i - 1]!));
    expect(step).toBeLessThan(0.08); // the sine's own slope (0.5·2π·0.02 = 0.063) plus nothing
  });
  it('pans with equal power, and reverses', () => {
    P.src_sine!(48000, SR, 0.02, 0);
    P.one_grain!(5000, 1, 4800, 1, -1, 1, 0, 4800, SR);
    expect(rms(outOf(4800, HALF))).toBeLessThan(1e-9);
    P.one_grain!(5000, 1, 4800, 1, 0, 1, 0, 4800, SR);
    const l = rms(outOf(4800)), r = rms(outOf(4800, HALF));
    expect(l).toBeCloseTo(r, 9);
    expect(l * l + r * r).toBeGreaterThan(0);
    P.one_grain!(5000, -1, 4800, 1, 1, 1, 0, 4800, SR);
    const R = outOf(4800, HALF);
    expect(R[1200]).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * 0.02 * (5000 - 1200)), 3);
  });
  it('the caps refuse a grain past them, never take a sounding one', () => {
    P.src_sine!(4800, SR, 0.02, 0);
    P.pool_reset!();
    expect(P.spawn_many!(1, 10, SR)).toBe(2); // 8 an owner
    expect(P.pool_active!(1)).toBe(8);
    for (let o = 2; o < 9; o++) P.spawn_many!(o, 8, SR);
    expect(P.pool_active!(-1)).toBe(64);
    expect(P.spawn_many!(20, 1, SR)).toBe(1); // 64 in all
  });
  it('renders every owner in one pass (renderInto) exactly as owner by owner, its counts kept as grains start and end', () => {
    P.src_sine!(48000, SR, 0.013, 0.051);
    expect(P.render_into_vs_owner!(40, SR)).toBe(0);
    for (let o = 0; o < 4; o++) expect(P.poolN_active!(o)).toBe(0); // every grain ended within 40 blocks
  });
  it('an empty source renders nothing and refuses grains', () => {
    P.src_clear!();
    expect(P.one_grain!(0, 1, 4800, 0, 0, 1, 0, 256, SR)).toBe(-2);
  });
});

describe('a tape playhead', () => {
  it('Hann grains at an overlap of 2, read at the scan speed, play the source exactly', () => {
    P.src_sine!(30000, SR, 0.0071, 0.031);
    for (const speed of [1, 0.5, 1.5]) {
      P.tape!(0, 30000, speed, 0, 3000, 20000, SR);
      const L = outOf(20000);
      let err = 0;
      for (let n = 3000; n < 20000; n++) err = Math.max(err, Math.abs(L[n]! - P.src_read!(0, n * speed)));
      expect(err, `speed ${speed}`).toBeLessThan(2e-3);
    }
  });
  it('loops its region with no click at the seam', () => {
    P.src_sine!(30000, SR, 0.0071, 0);
    P.tape!(5000, 7000, 1, 0, 2400, 40000, SR);
    const L = outOf(40000);
    let step = 0; for (let i = 2401; i < 40000; i++) step = Math.max(step, Math.abs(L[i]! - L[i - 1]!));
    expect(step).toBeLessThan(0.05); // the sine's slope is 0.022; a seam's jump would be up to 1
  });
});

describe('schedulers', () => {
  it('free: the density, the same frames whatever the block size, jitter seeded by the grain\'s number', () => {
    const a = P.sched_free!(100, 0, SR, 128, SR, 3, 60);
    expect(a).toBe(100);
    const fa = outOf(a);
    expect(fa[1]! - fa[0]!).toBe(480);
    const j1 = P.sched_free!(100, 0.8, SR, 128, SR, 3, 60); const f1 = outOf(j1);
    const j2 = P.sched_free!(100, 0.8, SR, 37, SR, 3, 60); const f2 = outOf(j2);
    expect(j1).toBe(j2);
    expect(Array.from(f1)).toEqual(Array.from(f2));
    const j3 = P.sched_free!(100, 0.8, SR, 128, SR, 4, 60); const f3 = outOf(j3);
    expect(Array.from(f3)).not.toEqual(Array.from(f1));
    expect(Math.abs(j1 - 100)).toBeLessThan(10);
  });
  it('synced: grains on the song\'s grid, numbered by it, any block size', () => {
    const n = P.sched_sync!(0, 120, 0.25, SR, 128, SR, -1, 0);
    expect(n).toBe(8); // 1 s at 120 BPM: 2 beats, a grain every quarter beat
    const v = outOf(2 * n);
    for (let i = 0; i < n; i++) { expect(v[2 * i + 1]).toBe(i); expect(Math.abs(v[2 * i]! - i * 6000)).toBeLessThanOrEqual(1); }
    const m = P.sched_sync!(0, 120, 0.25, SR, 100, SR, -1, 0);
    expect(Array.from(outOf(2 * m))).toEqual(Array.from(v));
    // From beat 9.1: the first grain is grid step 37 (9.25 beats).
    P.sched_sync!(9.1, 120, 0.25, 6400, 128, SR, -1, 0);
    expect(outOf(2)[1]).toBe(37);
  });
  it('synced: a jump forward fires none of the skipped steps; a jump back re-lays from there', () => {
    const n = P.sched_sync!(0, 120, 0.25, 24064, 128, SR, 12032, 32);
    const v = outOf(2 * n);
    const idx = Array.from({ length: n }, (_, i) => v[2 * i + 1]!);
    expect(idx.slice(0, 3)).toEqual([0, 1, 2]);
    expect(idx).toContain(128);
    expect(idx.filter((k) => k > 2 && k < 128)).toEqual([]);
    const b = P.sched_sync!(8, 120, 0.25, 24064, 128, SR, 12032, 2);
    const w = outOf(2 * b);
    const back = Array.from({ length: b }, (_, i) => w[2 * i + 1]!);
    expect(back.slice(0, 3)).toEqual([32, 33, 34]);
    expect(back).toContain(8);
  });
});

describe('playheads', () => {
  it('forward wraps, reverse runs back, ping-pong turns at both ends and stays inside', () => {
    P.playhead_run!(0, 100, 50, 1000, 20, 5);
    expect(Array.from(outOf(5))).toEqual([120, 140, 110, 130, 100]);
    P.playhead_run!(1, 100, 50, 1000, 20, 3);
    expect(Array.from(outOf(3)).map((x) => Math.round(x))).toEqual([129, 109, 139]);
    P.playhead_run!(2, 100, 50, 1000, 20, 6);
    const p = Array.from(outOf(6)).map((x) => Math.round(x * 1000) / 1000);
    expect(p).toEqual([120, 140, 140, 120, 100, 120]);
    P.playhead_run!(2, 0, 64, 1000, 7.3, 400);
    for (const x of outOf(400)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(64); }
  });
  it('a semitone ratio is exp2(s / 12)', () => {
    for (const s of [-24, -7, 0, 0.5, 12, 19]) expect(P.ratio!(s)).toBeCloseTo(2 ** (s / 12), 9);
  });
});
