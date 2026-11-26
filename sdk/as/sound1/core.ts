// sound1's core: the two shapes a plugin is written in (`Effect`: what happens to the input, a sample
// at a time; `Instrument<V>`: what one voice sounds like, a sample at a time) and everything a plugin
// would otherwise write and get wrong: the block loop and its events, parameter smoothing, sample-rate
// set-up, the voices (the catalogue toolkit's allocator: steals with a fade, the pedal, chokes,
// NOTE_END), the tail it reports and keeps to, silence (nothing runs while there is nothing to hear),
// and the output's safety stage. Read README.md.
//
// One instance per module, as the EST library's glue: the kit's state is module globals. Top-level
// code is constants only (an EST module has no start function), so everything is made in `boot`.

import { Descriptor as EstDescriptor, Io, Note, Param, Plugin, exp2, isReady, onePole, setup } from "est";
import { SLOT_HELD, SLOT_IDLE, SLOT_STEAL, VOICE_RELEASE, VOICE_START, VoiceAllocator, eventKind, eventSlot } from "./dsp/voices";
import { Adsr as ToolkitAdsr } from "./dsp/envelope";
import { tanhFast } from "./fast";

// --- The sample rate and the transport -------------------------------------------------------------

let SR: f64 = 48000.0;
/** The sample rate (set before any block is prepared). */
// @ts-ignore: decorator
@inline export function sampleRate(): f64 { return SR; }

let tTempo: f64 = 120.0;
let tBeat: f64 = 0.0;
let tBarStart: f64 = 0.0;
let tNum: i32 = 4;
let tDen: i32 = 4;
let tPlaying: bool = false;
let tSeenBeat: f64 = -1.0;
let tSeenPlaying: bool = false;

/** The song's tempo in beats a minute. */
// @ts-ignore: decorator
@inline export function tempo(): f64 { return tTempo; }
/** The song position in beats at this sample (it only moves while the song plays). */
// @ts-ignore: decorator
@inline export function beat(): f64 { return tBeat; }
/** Whether the song is playing. */
// @ts-ignore: decorator
@inline export function playing(): bool { return tPlaying; }
/** The beat the current bar started on. */
// @ts-ignore: decorator
@inline export function barStart(): f64 { return tBarStart; }
/** The bar's meter. */
// @ts-ignore: decorator
@inline export function meterNum(): i32 { return tNum; }
// @ts-ignore: decorator
@inline export function meterDen(): i32 { return tDen; }
/** `n` beats in seconds at the song's tempo (a tempo-synced delay time). */
export function beats(n: f64): f64 { return n * 60.0 / (tTempo > 1.0 ? tTempo : 120.0); }

function readTransport(io: Io): void {
  const t = io.transport;
  tTempo = t.tempo;
  tBarStart = t.barStart;
  tNum = <i32>t.num;
  tDen = <i32>t.den;
  if (t.beat != tSeenBeat || t.playing != tSeenPlaying) {
    tSeenBeat = t.beat;
    tSeenPlaying = t.playing;
    tBeat = t.beat;
    tPlaying = t.playing;
  }
}

// --- The parameters: one smoothed value each -----------------------------------------------------

// A table by parameter id, 32 bytes a row: the value now, its target, the distance at which it snaps
// to the target (negative: a stepped parameter, never smoothed), spare.
let pTab: usize = 0;
/** A copy's room (the instrument's tail reads its settings at the targets). */
let pKeep: usize = 0;
let pCount: i32 = 0;
let pMoving: bool = false;
let pCoef: f64 = 1.0;
/** Whether values glide (false while nothing sounds: a value set then is there at once). */
let pLive: bool = false;

/**
 * Parameter `id`'s value at this sample, smoothed: a moved knob glides over a few milliseconds, so
 * nothing clicks. A switch (`labels`) is never smoothed: read it with `choice`.
 */
// @ts-ignore: decorator
@inline export function param(id: u32): f64 { return id < <u32>pCount ? load<f64>(pTab + (<usize>id << 5)) : 0.0; }
/** A switch's value as a whole number (0, 1, 2 …). */
// @ts-ignore: decorator
@inline export function choice(id: u32): i32 { return <i32>(param(id) + 0.5); }

function initParams(ps: Param[]): void {
  let top = 0;
  for (let i = 0; i < ps.length; i++) if (<i32>ps[i].id >= top) top = <i32>ps[i].id + 1;
  if (top > 4096) top = 4096;
  pCount = top;
  const rows: i32 = top > 0 ? top : 1;
  const bytes: usize = <usize>rows * 32;
  pTab = heap.alloc(bytes);
  memory.fill(pTab, 0, bytes);
  pKeep = heap.alloc(bytes);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (<i32>p.id >= top) continue;
    const row = pTab + (<usize>p.id << 5);
    store<f64>(row, p.defaultValue);
    store<f64>(row, p.defaultValue, 8);
    store<f64>(row, p.stepped() ? -1.0 : (p.max - p.min) * 1e-6, 16);
  }
}

function setTarget(id: u32, v: f64): void {
  if (id >= <u32>pCount) return;
  const row = pTab + (<usize>id << 5);
  store<f64>(row, v, 8);
  if (!pLive || load<f64>(row, 16) < 0.0) store<f64>(row, v);
  else pMoving = true;
}

function snapParams(): void {
  for (let i = 0, row = pTab; i < pCount; i++, row += 32) store<f64>(row, load<f64>(row, 8));
  pMoving = false;
}

function moveParams(): void {
  let moving = false;
  const c = pCoef;
  for (let i = 0, row = pTab; i < pCount; i++, row += 32) {
    const now = load<f64>(row), to = load<f64>(row, 8);
    if (now == to) continue;
    const d = to - now;
    if (abs<f64>(d) <= load<f64>(row, 16)) store<f64>(row, to);
    else { store<f64>(row, now + d * c); moving = true; }
  }
  pMoving = moving;
}

// --- The blocks: everything with state registers itself ------------------------------------------

let blocksRef: usize = 0;
let ownersRef: usize = 0;
/** The voice being made (its blocks are its own), or -1: the plugin's. */
let currentOwner: i32 = -1;

function blockList(): Array<Block> {
  if (blocksRef == 0) {
    blocksRef = changetype<usize>(new Array<Block>());
    ownersRef = changetype<usize>(new Array<i32>());
  }
  return changetype<Array<Block>>(blocksRef);
}
function ownerList(): Array<i32> { blockList(); return changetype<Array<i32>>(ownersRef); }

/**
 * A piece of sound with state (an oscillator, a filter, a delay …). The kit prepares every block
 * for the sample rate, clears it when the plugin is reset or a voice starts, and adds up the tails.
 * Make blocks only as fields (`osc: Osc = new Osc();`) or in a constructor: never while playing.
 */
export abstract class Block {
  constructor() {
    blockList().push(this);
    ownerList().push(currentOwner);
  }
  /** The sample rate is known (`sampleRate()`): size buffers, compute coefficients. */
  prepare(): void {}
  /** Forget everything heard so far. */
  reset(): void {}
  /** The block's voice started a note (the default: `reset`). */
  noteOn(): void { this.reset(); }
  /** The block's voice was let go. */
  noteOff(): void {}
  /** Seconds this block still sounds after its input stops, at its current settings. */
  tail(): f64 { return 0.0; }
}

function prepareBlocks(): void {
  const b = blockList();
  for (let i = 0; i < b.length; i++) unchecked(b[i]).prepare();
}
function resetBlocks(): void {
  const b = blockList();
  for (let i = 0; i < b.length; i++) unchecked(b[i]).reset();
}
/** The tails of the plugin's own blocks (not its voices'), added up: seconds. */
function ownTail(): f64 {
  const b = blockList(), o = ownerList();
  let t = 0.0;
  for (let i = 0; i < b.length; i++) if (unchecked(o[i]) < 0) t += unchecked(b[i]).tail();
  return t;
}

/** Call once from a plugin written on the raw EST library that uses sound1's blocks: its `activate`. */
export function prepareSound(rate: f64): void {
  SR = rate > 1000.0 ? rate : 48000.0;
  pCoef = onePole(0.008, SR);
  prepareBlocks();
  resetBlocks();
}

// --- The envelope --------------------------------------------------------------------------------

/**
 * An ADSR envelope, 0 to 1. `set` is cheap to call every sample. Inside a voice it starts with the
 * note and releases with the key by itself; `done()` once it has faded out.
 */
export class Adsr extends Block {
  core: ToolkitAdsr = new ToolkitAdsr();
  private a: f64 = 0.005;
  private d: f64 = 0.2;
  private s: f64 = 1.0;
  /** The release in seconds (read by the kit for the tail). */
  r: f64 = 0.1;

  constructor() { super(); this.apply(); }

  private apply(): void {
    const c = this.core;
    c.setAttack(this.a, SR);
    c.setDecayT60(this.d, SR);
    c.setSustain(this.s);
    c.setReleaseT60(this.r, SR);
  }
  /** Attack, decay and release in seconds, sustain 0 to 1. */
  set(attack: f64, decay: f64, sustain: f64, release: f64): void {
    if (attack == this.a && decay == this.d && sustain == this.s && release == this.r) return;
    this.a = attack > 0.001 ? (attack < 30.0 ? attack : 30.0) : 0.001;
    this.d = decay > 0.002 ? (decay < 30.0 ? decay : 30.0) : 0.002;
    this.s = sustain > 0.0 ? (sustain < 1.0 ? sustain : 1.0) : 0.0;
    this.r = release > 0.003 ? (release < 30.0 ? release : 30.0) : 0.003;
    this.apply();
    // Keep the values asked for, so the comparison above holds next sample.
    this.a = attack; this.d = decay; this.s = sustain; this.r = release;
  }
  /** A percussive shape: up in `attack`, then down in `decay` by itself, key held or not. */
  perc(attack: f64, decay: f64): void { this.set(attack, decay, 0.0, decay); }
  /** Start it (from the level it is at: a retrigger never clicks). */
  start(): void { this.core.start(); }
  release(): void { this.core.release(); }
  /** The level for this sample. */
  // @ts-ignore: decorator
  @inline next(): f64 { return this.core.next(); }
  /** Whether it has finished (idle). */
  done(): bool { return !this.core.active; }
  /** The release, as long as it really sounds (to -80 dB). */
  releaseSeconds(): f64 { const r = this.r; return (r > 0.003 ? (r < 30.0 ? r : 30.0) : 0.003) * 1.34; }

  prepare(): void { const a = this.a, d = this.d, s = this.s, r = this.r; this.a = -1.0; this.set(a, d, s, r); }
  reset(): void { this.core.stop(); }
  noteOn(): void { this.core.stop(); this.core.start(); }
  noteOff(): void { this.core.release(); }
}

// --- The output's safety stage -------------------------------------------------------------------

/** Set when a sample was not a number (or absurdly large): the blocks are cleared. */
let panic: bool = false;

/** Untouched up to 0.8; above it bends smoothly and never passes 1. Not a number: 0. */
// @ts-ignore: decorator
@inline function safe(x: f64): f64 {
  const a = abs<f64>(x);
  if (a <= 0.8) return x;
  if (!(a < 64.0)) { panic = true; return 0.0; }
  const y = 0.8 + 0.2 * tanhFast((a - 0.8) * 5.0);
  return x < 0.0 ? -y : y;
}

/** The gain a voice at full scale is mixed at (-12 dB): a chord stays clear of the safety stage. */
export const VOICE_GAIN: f64 = 0.25;
/** Frames of quiet a plugin is never asleep before (so `quiet` cannot overflow). */
const LONG: i32 = 0x3fffffff;
/** The longest tail the kit reports (seconds): under est.json's 60. */
const TAIL_MAX: f64 = 55.0;

// --- The two shapes ------------------------------------------------------------------------------

/** What `Effect` and `Instrument` share. Extend one of those, never this. */
export abstract class Sound extends Plugin {
  /** This sample, left and right: an effect's input when `tick` is called, and the output after it. */
  l: f64 = 0.0;
  r: f64 = 0.0;
  /** Frames since the plugin last had something to work on. */
  quiet: i32 = LONG;
  asleep: bool = true;
  /** The fade to silence at the end of the tail, in frames. */
  fade: i32 = 240;

  isInstrument(): bool { return false; }
  /** Seconds the plugin rings beyond what its blocks report (a feedback loop you built yourself). */
  ring(): f64 { return 0.0; }

  activate(sampleRate: f64, maxFrames: u32): bool {
    SR = sampleRate > 1000.0 ? sampleRate : 48000.0;
    pCoef = onePole(0.008, SR);
    this.fade = <i32>(SR * 0.005);
    prepareBlocks();
    this.reset();
    return true;
  }
  reset(): void {
    resetBlocks();
    this.sleep();
    tSeenBeat = -1.0;
  }
  paramChanged(id: u32, value: f64): void { setTarget(id, value); }
  latency(): u32 { return 0; }

  sleep(): void {
    this.quiet = LONG;
    this.asleep = true;
    pLive = false;
    snapParams();
  }
  wake(): void {
    this.asleep = false;
    pLive = true;
  }
  /** The plugin's own blocks' tails and `ring()`, in frames. */
  ownTailFrames(): i32 {
    let t = ownTail() + this.ring();
    if (!(t >= 0.0)) t = 0.0;
    if (t > TAIL_MAX) t = TAIL_MAX;
    return <i32>(t * SR);
  }
}

/**
 * An effect. Write `tick()`: it runs once a sample with the input in `this.l` and `this.r`; leave the
 * output there. The kit does the rest: it glides the parameters, clears the blocks, reports the tail
 * its blocks add up to, goes to sleep once the input has been silent for that long (so nothing rings
 * past the tail it reports, and silence costs nothing), and keeps the output within -1 to 1.
 */
export abstract class Effect extends Sound {
  abstract tick(): void;

  tail(): u32 { return <u32>(this.ownTailFrames() + this.fade + 1); }

  render(io: Io, from: i32, to: i32): void {
    readTransport(io);
    const stereo = io.channels > 1;
    const keep = this.ownTailFrames();
    const fade = this.fade;
    const perFrame = tTempo / (60.0 * SR);
    let quiet = this.quiet;
    for (let n = from; n < to; n++) {
      const inL = <f64>io.input(0, n);
      const inR = stereo ? <f64>io.input(1, n) : inL;
      if (abs<f64>(inL) > 1e-7 || abs<f64>(inR) > 1e-7) {
        quiet = 0;
        if (this.asleep) this.wake();
      } else if (quiet < LONG) quiet++;
      if (tPlaying) tBeat += perFrame;
      if (this.asleep) {
        io.output(0, n, 0);
        if (stereo) io.output(1, n, 0);
        continue;
      }
      if (quiet > keep + fade) {
        resetBlocks();
        this.sleep();
        quiet = LONG;
        io.output(0, n, 0);
        if (stereo) io.output(1, n, 0);
        continue;
      }
      if (pMoving) moveParams();
      this.l = inL;
      this.r = inR;
      this.tick();
      let l = safe(this.l), r = safe(this.r);
      if (panic) { panic = false; resetBlocks(); l = 0.0; r = 0.0; }
      if (quiet > keep) { const g = 1.0 - <f64>(quiet - keep) / <f64>fade; l *= g; r *= g; }
      io.output(0, n, <f32>l);
      if (stereo) io.output(1, n, <f32>r);
    }
    this.quiet = quiet;
  }
}

/**
 * One voice of an instrument. Write `tick()`: one sample of what the voice sounds like, about -1 to
 * 1. The kit multiplies it by the voice's loudness envelope `this.amp` (set its shape with
 * `this.amp.set(attack, decay, sustain, release)`) and ends the voice when that envelope has faded
 * out, so a note can never hang. Every block in the voice is cleared when a note starts; every
 * `Adsr` in it starts with the note and releases with the key.
 */
export abstract class Voice {
  /** The note's key (60 is middle C), with the pitch wheel added. */
  key: f64 = 60.0;
  /** The note's frequency in Hz (the pitch wheel and the instrument's glide applied). */
  hz: f64 = 261.6255653005986;
  /** How hard the key was struck, 0 to 1. */
  velocity: f64 = 0.0;
  /** Seconds since the note started. */
  seconds: f64 = 0.0;
  /** Where the voice sits: -1 left, 0 centre, 1 right. */
  pan: f64 = 0.0;
  /** The voice's loudness envelope: the kit applies it. */
  amp: Adsr = new Adsr();
  /** (The kit's) where the glide is heading, the played key, the internal note's frames left. */
  hzTo: f64 = 261.6255653005986;
  played: f64 = 60.0;
  left: i32 = 0;

  abstract tick(): f64;
  /** A note started (the blocks are already cleared, `key`, `hz` and `velocity` are set). */
  start(): void {}
}

/**
 * An instrument of `count` voices of `V` (1 to 32). Extend it as
 * `class MySynth extends Instrument<MyVoice> { constructor() { super(8); } }`: the voices play the
 * notes. Optional: `tick()` runs once a sample on the mix of the voices (`this.l`, `this.r`), for an
 * effect on the whole instrument.
 */
export abstract class Instrument<V extends Voice> extends Sound {
  voices: StaticArray<V>;
  notes: VoiceAllocator;
  private first: StaticArray<i32>;
  /** Seconds a note's pitch takes to glide from the note before (0: none). */
  glide: f64 = 0.0;
  private lastHz: f64 = 0.0;
  private bend: f64 = 0.0;
  private io: Io | null = null;
  private frame: i32 = 0;

  constructor(count: i32) {
    super();
    const n = count < 1 ? 1 : count > 32 ? 32 : count;
    this.voices = new StaticArray<V>(n);
    this.first = new StaticArray<i32>(n + 1);
    this.notes = new VoiceAllocator(n);
    for (let i = 0; i < n; i++) {
      currentOwner = i;
      unchecked(this.first[i] = blockList().length);
      unchecked(this.voices[i] = instantiate<V>());
    }
    currentOwner = -1;
    unchecked(this.first[n] = blockList().length);
  }

  isInstrument(): bool { return true; }
  /** The mix of the voices, once a sample (`this.l`, `this.r`): override for an effect on it. */
  tick(): void {}
  /** Once a sample, silent or not: where a pattern or an arpeggio calls `this.play(…)`. */
  pattern(): void {}

  activate(sampleRate: f64, maxFrames: u32): bool {
    super.activate(sampleRate, maxFrames);
    this.notes.setFade(0.003, SR);
    return true;
  }
  reset(): void {
    this.notes.reset();
    this.notes.setFade(0.003, SR);
    this.lastHz = 0.0;
    this.bend = 0.0;
    super.reset();
  }

  /** The longest a let-go voice still sounds, then the plugin's own blocks. */
  tail(): u32 {
    // A voice that has not played yet has not read its settings: let the first idle one read them now.
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      if (this.notes.state(i) != SLOT_IDLE) continue;
      const moving = pMoving;
      // With the parameters at their targets, without touching what is heard.
      const bytes = (<usize>pCount) << 5;
      const keep = pKeep;
      memory.copy(keep, pTab, bytes);
      snapParams();
      unchecked(vs[i]).tick();
      memory.copy(pTab, keep, bytes);
      pMoving = moving;
      this.clearVoice(i);
      break;
    }
    let rel = 0.0;
    for (let i = 0; i < vs.length; i++) { const r = unchecked(vs[i]).amp.releaseSeconds(); if (r > rel) rel = r; }
    let t = rel + 0.01 + <f64>this.ownTailFrames() / SR;
    if (t > TAIL_MAX) t = TAIL_MAX;
    return <u32>(t * SR) + <u32>this.fade + 1;
  }

  private clearVoice(i: i32): void {
    const b = blockList();
    for (let k = unchecked(this.first[i]), e = unchecked(this.first[i + 1]); k < e; k++) unchecked(b[k]).reset();
  }

  // --- Notes -------------------------------------------------------------------------------------

  noteOn(io: Io, note: Note): void { this.notes.noteOn(io, note); this.drain(); }
  noteOff(io: Io, note: Note): void { this.notes.noteOff(io, note); this.drain(); }
  choke(io: Io, note: Note): void { this.notes.choke(io, note); this.drain(); }
  midi(io: Io, port: u16, data: StaticArray<u8>): void {
    const status = unchecked(data[0]) & 0xf0;
    if (status == 0xb0 && unchecked(data[1]) == 64) { this.notes.pedal(io, unchecked(data[2]) >= 64); this.drain(); }
    else if (status == 0xe0) {
      this.bend = (<f64>((<i32>unchecked(data[2]) << 7) | <i32>unchecked(data[1])) - 8192.0) / 8192.0 * 2.0;
      const vs = this.voices;
      for (let i = 0; i < vs.length; i++) {
        const v = unchecked(vs[i]);
        v.key = v.played + this.bend;
        v.hzTo = 440.0 * exp2((v.key - 69.0) / 12.0);
        if (this.glide <= 0.0) v.hz = v.hzTo;
      }
    }
  }

  /**
   * Play a note of your own (a pattern, an arpeggio): `key`, `velocity` 0 to 1, for `seconds`. Call
   * it from `pattern()`. It never takes a voice from a note the player holds.
   */
  play(key: f64, velocity: f64, seconds: f64): void {
    const io = this.io;
    if (io == null) return;
    const s = this.notes.pick(true);
    if (s < 0) return;
    const k = <i32>(key + 0.5);
    this.notes.startInternal(io, s, k < 0 ? 0 : k > 127 ? 127 : k, velocity, -1, this.frame);
    const f = <i32>(seconds * SR);
    unchecked(this.voices[s]).left = f > 1 ? f : 1;
    this.drain();
  }

  private drain(): void {
    const a = this.notes;
    for (let e = a.next(); e >= 0; e = a.next()) {
      const s = eventSlot(e), kind = eventKind(e);
      const v = unchecked(this.voices[s]);
      const b = blockList();
      const from = unchecked(this.first[s]), to = unchecked(this.first[s + 1]);
      if (kind == VOICE_START) {
        v.played = <f64>a.key(s);
        v.key = v.played + this.bend;
        v.velocity = a.velocity(s);
        v.seconds = 0.0;
        v.pan = 0.0;
        v.hzTo = 440.0 * exp2((v.key - 69.0) / 12.0);
        v.hz = this.glide > 0.0 && this.lastHz > 0.0 ? this.lastHz : v.hzTo;
        this.lastHz = v.hzTo;
        if (!a.isInternal(s)) v.left = 0;
        for (let k = from; k < to; k++) unchecked(b[k]).noteOn();
        v.start();
        if (this.asleep) this.wake();
        this.quiet = 0;
      } else if (kind == VOICE_RELEASE) {
        for (let k = from; k < to; k++) unchecked(b[k]).noteOff();
      } else {
        v.amp.reset();
      }
    }
  }

  render(io: Io, from: i32, to: i32): void {
    readTransport(io);
    this.io = io;
    const a = this.notes;
    const vs = this.voices;
    const count = vs.length;
    const stereo = io.channels > 1;
    const keep = this.ownTailFrames();
    const fade = this.fade;
    const dt = 1.0 / SR;
    const perFrame = tTempo / (60.0 * SR);
    const glideCoef = this.glide > 0.0 ? onePole(this.glide / 3.0, SR) : 1.0;
    for (let n = from; n < to; n++) {
      this.frame = n;
      this.pattern();
      if (this.asleep) {
        // Asleep: only the song moves (a pattern may just have started a note).
        if (tPlaying) tBeat += perFrame;
        continue;
      }
      if (pMoving) moveParams();
      let sumL = 0.0, sumR = 0.0;
      let active = 0;
      for (let s = 0; s < count; s++) {
        const st = a.state(s);
        if (st == SLOT_IDLE) continue;
        active++;
        const v = unchecked(vs[s]);
        if (v.hz != v.hzTo) {
          const h = v.hz + (v.hzTo - v.hz) * glideCoef;
          v.hz = abs<f64>(h - v.hzTo) < 1e-4 ? v.hzTo : h;
        }
        const x = v.tick();
        const e = v.amp.next();
        if (v.left > 0 && st == SLOT_HELD) { v.left--; if (v.left == 0) a.release(io, s); }
        if (v.amp.done()) { if (st != SLOT_STEAL) a.finished(io, s, n); continue; }
        const y = x * e * a.gain(s) * VOICE_GAIN;
        v.seconds += dt;
        const p = v.pan;
        if (p == 0.0) { sumL += y; sumR += y; }
        else {
          const q = p < -1.0 ? -1.0 : p > 1.0 ? 1.0 : p;
          sumL += y * Math.sqrt(1.0 - q);
          sumR += y * Math.sqrt(1.0 + q);
        }
      }
      a.tick(io, n);
      this.drain();
      this.l = sumL;
      this.r = sumR;
      this.tick();
      if (tPlaying) tBeat += perFrame;
      if (active > 0) this.quiet = 0; else if (this.quiet < LONG) this.quiet++;
      const quiet = this.quiet;
      if (quiet > keep + fade) {
        resetBlocks();
        this.sleep();
        continue;
      }
      let l = safe(this.l), r = safe(this.r);
      if (panic) { panic = false; resetBlocks(); l = 0.0; r = 0.0; }
      if (quiet > keep) { const g = 1.0 - <f64>(quiet - keep) / <f64>fade; l *= g; r *= g; }
      io.add(0, n, <f32>l);
      if (stereo) io.add(1, n, <f32>r);
    }
  }
}

// --- Starting up ---------------------------------------------------------------------------------

/**
 * The plugin's identity: `new Descriptor("com.example.my-plugin", "My Plugin", "Me", "1.0.0")`. The id
 * and the version are est.json's. Whether it is an effect or an instrument comes from the class.
 * (The EST library's longer form, with a description, features and a state mark, is accepted too.)
 */
export class Descriptor extends EstDescriptor {
  constructor(id: string, name: string, vendor: string, version: string, description: string = "", features: string[] = [], stateMagic: string = "", stateVersion: u32 = 1) {
    super(id, name, vendor, version, description.length > 0 ? description : name, features, stateMagic.length == 4 ? stateMagic : markOf(id), stateVersion);
  }
}

/** Four letters from the id: what marks this plugin's saved state. */
function markOf(id: string): string {
  let h: u32 = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= <u32>id.charCodeAt(i); h *= 16777619; }
  let s = "";
  for (let i = 0; i < 4; i++) { s += String.fromCharCode(65 + <i32>(h % 26)); h /= 26; }
  return s;
}

let theSound: usize = 0;
function theMaker(): Plugin { return changetype<Plugin>(theSound); }

/**
 * Start the plugin: in its `malloc`, `if (!isReady()) start(new Descriptor(…), parameters(), new MyPlugin());`.
 * It hands the EST library the plugin's identity, its parameters and its kind (from its class).
 */
export function start(d: EstDescriptor, ps: Param[], sound: Sound): void {
  if (isReady()) return;
  initParams(ps);
  blockList();
  currentOwner = -1;
  theSound = changetype<usize>(sound);
  const kind = sound.isInstrument() ? "instrument" : "audio-effect";
  const f = new Array<string>();
  f.push(kind);
  for (let i = 0; i < d.features.length; i++) {
    const x = d.features[i];
    if (x != "instrument" && x != "audio-effect") f.push(x);
  }
  if (f.length == 1) { f.push(kind == "instrument" ? "synthesizer" : "utility"); f.push("stereo"); }
  d.features = f;
  setup(d, ps, theMaker);
}
