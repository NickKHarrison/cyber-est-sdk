// The DSP probe (AssemblyScript): each block of the est library behind a plain export, the twin of
// sdk/rust/probe/src/lib.rs line for line (change both or neither), so Cyber's suite can render a
// scenario through both builds and compare them (sdk/tests/dsp.test.ts). Not a plugin.
//
// It also carries the library's own tests in AssemblyScript (`selfTest`, run by the suite): each
// check that fails adds one to the count it returns.

import {
  Biquad, Coefficients, DelayLine, Envelope, Filter, Lfo, Note, Oscillator, Smoother, Stage, Voice, Voices,
  biquadKindFromIndex, coefficientsInto, dbToGain, detachedIo, filterModeFromIndex, gainToDb, keyToHz, responseDb, waveFromIndex,
  cosTurns, exp, exp2, floor, ln, log2, sinTurns, tanHalfTurns, Param,
} from "est";
import { textToValue, valueToText } from "est/text";

const MAX = 16384;
const IN = memory.data(MAX * 4, 16);
const OUT = memory.data(MAX * 2 * 8, 16);

// @ts-ignore: decorator
@inline function inp(i: i32): f64 { return <f64>load<f32>(IN + (<usize>i << 2)); }
// @ts-ignore: decorator
@inline function out(i: i32, v: f64): void { store<f64>(OUT + (<usize>i << 3), v); }
function lim(n: u32): i32 { return n < <u32>MAX ? <i32>n : MAX; }

export function input_ptr(): usize { return IN; }
export function output_ptr(): usize { return OUT; }

export function smoother(n: u32, seconds: f64, sr: f64, t1: f64, t2: f64, at: u32): void {
  const s = new Smoother(seconds);
  s.setSampleRate(sr);
  s.setTarget(t1);
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>at) s.setTarget(t2);
    out(i, s.next());
  }
}

export function oscillator(n: u32, wave: u32, hz: f64, sr: f64, hz2: f64, at: u32): void {
  const o = new Oscillator();
  o.setSampleRate(sr);
  o.setWave(waveFromIndex(<f64>wave));
  o.setFrequency(hz);
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>at) o.setFrequency(hz2);
    out(i, o.next());
  }
}

export function filter(n: u32, mode: u32, cutoff: f64, res: f64, sr: f64, cutoff2: f64, res2: f64, at: u32): void {
  const f = new Filter();
  f.setSampleRate(sr);
  f.setMode(filterModeFromIndex(<f64>mode));
  f.setCutoff(cutoff);
  f.setResonance(res);
  f.reset();
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>at) { f.setCutoff(cutoff2); f.setResonance(res2); }
    out(i, f.process(inp(i)));
  }
}

export function envelope(n: u32, a: f64, d: f64, s: f64, r: f64, sr: f64, offAt: u32, onAt: u32): u32 {
  const e = new Envelope();
  e.setSampleRate(sr);
  e.setAdsr(a, d, s, r);
  e.start();
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>offAt) e.release();
    if (i == <i32>onAt) e.start();
    out(i, e.next());
  }
  return e.tailFrames();
}

export function lfo(n: u32, wave: u32, rate: f64, sync: f64, tempo: f64, sr: f64, tempo2: f64, at: u32): void {
  const l = new Lfo();
  l.setSampleRate(sr);
  l.setWave(waveFromIndex(<f64>wave));
  l.setRate(rate);
  l.setSync(sync);
  l.setTempo(tempo);
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>at) l.setTempo(tempo2);
    out(i, l.next());
  }
}

export function delay(n: u32, max: u32, d1: f64, d2: f64, feedback: f64, at: u32): u32 {
  const line = new DelayLine();
  if (!line.allocate(<i32>max)) return 0;
  let d = d1;
  for (let i = 0; i < lim(n); i++) {
    if (i == <i32>at) d = d2;
    const y = line.read(d);
    line.write(inp(i) + feedback * y);
    out(i, y);
  }
  return <u32>line.capacity();
}

export function biquad(n: u32, kind: u32, freq: f64, q: f64, gainDb: f64, sr: f64): void {
  const b = new Biquad();
  b.set(biquadKindFromIndex(<f64>kind), freq, q, gainDb, sr);
  for (let i = 0; i < lim(n); i++) out(i, b.process(inp(i)));
}

export function biquad_response(kind: u32, freq: f64, q: f64, gainDb: f64, sr: f64, atHz: f64): f64 {
  const c = new Coefficients();
  coefficientsInto(c, biquadKindFromIndex(<f64>kind), freq, q, gainDb, sr);
  return responseDb(c, atHz, sr);
}

class Counted extends Voice {
  releases: u32 = 0;
  stops: u32 = 0;
  release(): void { this.releases++; }
  stop(): void { this.stops++; }
}

export function voices(ops: u32): void {
  const io = detachedIo(128);
  const v = new Voices<Counted>(4);
  const kMax = lim(ops * 3) / 3;
  const note = new Note();
  for (let k = 0; k < kMax; k++) {
    const op = <i32>inp(k * 3);
    const id = <i32>inp(k * 3 + 1);
    const key = <i32>inp(k * 3 + 2);
    note.time = 0;
    note.noteId = id;
    note.port = id == -1 && key == -1 ? -1 : 0;
    note.channel = id == -1 && key == -1 ? -1 : 0;
    note.key = <i16>key;
    note.velocity = 1;
    let took = -1.0;
    if (op == 0) took = <f64>v.start(io, note);
    else if (op == 1) v.release(note);
    else if (op == 2) v.choke(io, note);
    else if (op == 3) v.end(key, io, 0);
    let on = 0.0, rel = 0.0, counts = 0.0;
    for (let i = 0; i < 4; i++) {
      if (v.isOn(i)) on += exp2(<f64>i);
      if (v.isReleasing(i)) rel += exp2(<f64>i);
      counts += <f64>(v.voice(i).releases + v.voice(i).stops);
    }
    out(k * 4, took);
    out(k * 4 + 1, on);
    out(k * 4 + 2, rel);
    out(k * 4 + 3, counts);
  }
}

export function decibels(n: u32, from: f64, step: f64): void {
  for (let i = 0; i < lim(n); i++) {
    const db = from + <f64>i * step;
    const g = dbToGain(db);
    out(i * 2, g);
    out(i * 2 + 1, gainToDb(g));
  }
}

export function maths(n: u32, from: f64, step: f64): void {
  const m = lim(n) / 4;
  for (let i = 0; i < m; i++) {
    const x = from + <f64>i * step;
    const a = x < 0 ? -x : x;
    out(i * 8, exp(x));
    out(i * 8 + 1, ln(a + 0.001));
    out(i * 8 + 2, sinTurns(x));
    out(i * 8 + 3, cosTurns(x));
    out(i * 8 + 4, tanHalfTurns((a - floor(a)) * 0.49));
    out(i * 8 + 5, exp2(x));
    out(i * 8 + 6, log2(a + 0.001));
    out(i * 8 + 7, keyToHz(x * 10.0 + 60.0));
  }
}

let textParams: Param[] | null = null;
const TEXT = memory.data(256, 16);
function textParam(which: u32): Param {
  if (!textParams) textParams = [
    new Param(0, "Gain").range(-60, 12).unit("dB").decimals(1),
    new Param(1, "Freq").range(20, 20000).hertz(),
    new Param(2, "Mode").labels(["Low", "Band"]),
  ];
  return changetype<Param[]>(textParams)[<i32>(which % 3)];
}

export function text_ptr(): usize { return TEXT; }

export function value_text(which: u32, v: f64): u32 {
  valueToText(textParam(which), v, TEXT, 256);
  let n: u32 = 0;
  while (load<u8>(TEXT + n) != 0) n++;
  return n;
}

export function text_value(which: u32): f64 { return textToValue(textParam(which), TEXT); }

// --- The library's own tests, in AssemblyScript --------------------------------------------------

let failures = 0;
function check(ok: bool): void { if (!ok) failures++; }
function near(a: f64, b: f64, tol: f64): bool { return Math.abs(a - b) <= tol; }

/** Run the library's checks; the number that failed (0: all passed). */
export function selfTest(): i32 {
  failures = 0;
  // Smoother: 63 % in its time, then settled on the target.
  const s = new Smoother(0.01);
  s.setSampleRate(1000);
  s.setTarget(1);
  let v = 0.0;
  for (let i = 0; i < 10; i++) v = s.next();
  check(near(v, 0.6321, 0.02));
  for (let i = 0; i < 1000; i++) s.next();
  check(s.settled() && s.value() == 1);
  // Oscillator: every wave within ±1.1 and crossing zero at its frequency.
  for (let w = 0; w < 4; w++) {
    const o = new Oscillator();
    o.setSampleRate(48000);
    o.setFrequency(1000);
    o.setWave(waveFromIndex(<f64>w));
    let hi = 0.0, lo = 0.0, crossings = 0, last = 0.0;
    for (let n = 0; n < 48000; n++) {
      const y = o.next();
      if (y > hi) hi = y;
      if (y < lo) lo = y;
      if (n > 0 && last < 0 && y >= 0) crossings++;
      last = y;
    }
    check(hi < 1.1 && hi > 0.9 && lo > -1.1 && lo < -0.9);
    check(crossings >= 999 && crossings <= 1001);
  }
  // Filter: a low-pass passes 100 Hz and stops 10 kHz; a notch stops its cutoff.
  check(filterPeak(0, 100) > 0.95);
  check(filterPeak(0, 10000) < 0.02);
  check(filterPeak(3, 1000) < 0.05);
  check(near(filterPeak(1, 1000), 1, 0.05));
  // Envelope: attack, decay to sustain, a release within its tail.
  const e = new Envelope();
  e.setSampleRate(1000);
  e.setAdsr(0.01, 0.02, 0.5, 0.1);
  e.start();
  for (let i = 0; i < 11; i++) v = e.next();
  check(v == 1);
  for (let i = 0; i < 21; i++) v = e.next();
  check(near(v, 0.5, 1e-9) && e.stage() == Stage.Sustain);
  e.release();
  let n = 0;
  while (e.isActive()) { e.next(); n++; }
  check(n <= <i32>e.tailFrames() && n >= 99);
  // Lfo: a synced cycle lasts its beats at the tempo.
  const l = new Lfo();
  l.setSampleRate(1000);
  l.setWave(waveFromIndex(1));
  l.setSync(1);
  l.setTempo(120);
  const first = l.next();
  for (let i = 0; i < 499; i++) l.next();
  check(near(l.next(), first, 1e-9));
  // DelayLine: an impulse comes back after the delay, once.
  const d = new DelayLine();
  d.allocate(8);
  let sum = 0.0, at = -1;
  for (let i = 0; i < 12; i++) {
    const y = d.read(3);
    if (y == 1) at = i;
    sum += y;
    d.write(i == 0 ? 1 : 0);
  }
  check(at == 3 && sum == 1);
  // Biquad: the peak's gain at its centre, the shelf's half gain at its corner.
  const c = new Coefficients();
  coefficientsInto(c, biquadKindFromIndex(0), 1000, 1, 6, 48000);
  check(near(responseDb(c, 1000, 48000), 6, 1e-6));
  coefficientsInto(c, biquadKindFromIndex(1), 200, 0.707, -9, 48000);
  check(near(responseDb(c, 200, 48000), -4.5, 0.05));
  // Voices: the oldest is stolen.
  const io = detachedIo(128);
  const vs = new Voices<Counted>(2);
  const note = new Note();
  note.port = 0; note.channel = 0;
  note.noteId = 1; note.key = 60; check(vs.start(io, note) == 0);
  note.noteId = 2; note.key = 62; check(vs.start(io, note) == 1);
  note.noteId = 3; note.key = 64; check(vs.start(io, note) == 0);
  check(vs.note(0).noteId == 3 && vs.count() == 2);
  // Decibels both ways.
  check(near(gainToDb(dbToGain(-6)), -6, 1e-9));
  return failures;
}

function filterPeak(mode: i32, hz: f64): f64 {
  const f = new Filter();
  f.setSampleRate(48000);
  f.setMode(filterModeFromIndex(<f64>mode));
  f.setCutoff(1000);
  f.reset();
  const o = new Oscillator();
  o.setFrequency(hz);
  let peak = 0.0;
  for (let n = 0; n < 24000; n++) {
    const y = f.process(o.next());
    if (n > 12000 && Math.abs(y) > peak) peak = Math.abs(y);
  }
  return peak;
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
