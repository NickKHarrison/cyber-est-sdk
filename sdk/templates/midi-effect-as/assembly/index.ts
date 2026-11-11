// EST MIDI Effect Template (AS) (org.example.est-midi-effect-template-as): an EST note effect in
// AssemblyScript, made from the midi-effect-as template: notes in, notes out, the audio passed
// through. Two modes: an arpeggiator whose rate follows the transport's tempo (and its beat grid
// while the transport plays), and a chord memory that plays a learned chord from each key. Keep
// est.json's identity and parameters in step with `describe()` and `parameters()`, then (see
// AGENTS.md):
//
//     est pack        # asc (asconfig.json's release target), then the bundle in dist/
//     est validate    # the checks Cyber's install runs; read dist/validation.json
//     est test        # the golden render (audio and the notes sent) plus the conformance run
//
// The rules a note effect keeps: every note it starts it ends (`io.sendNoteOff`), including when
// the mode changes or the keys are let go; allocate only in field initialisers and `activate`,
// never in `render`, `process`, `paramChanged` or the note handlers; no top-level code but constants.

import {
  Descriptor, Effect, Event, EventKind, Events, Io, Note, Param, Plugin, StateReader, StateWriter,
  alloc, floor, isReady, setup, split,
} from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-midi-effect-template-as", "EST MIDI Effect Template (AS)", "Example", "1.0.0",
    "An arpeggiator synced to the tempo and a chord memory: the starting point for an EST note effect in AssemblyScript.",
    ["audio-effect", "note-effect", "stereo"], "TMPN", 1).noteEffect();
}

const MODE: u32 = 0;
const RATE: u32 = 1;
const PATTERN: u32 = 2;
const OCTAVES: u32 = 3;
const GATE: u32 = 4;
const LEARN: u32 = 5;

const MAX_HELD = 16;
const MAX_CHORD = 8;

function parameters(): Param[] {
  return [
    new Param(MODE, "Mode").labels(["Arpeggiator", "Chord memory"]),
    new Param(RATE, "Rate").labels(["1/4", "1/8", "1/16", "1/32"]).default(2).module("Arpeggiator"),
    new Param(PATTERN, "Pattern").labels(["Up", "Down", "Up-Down", "As played"]).module("Arpeggiator"),
    new Param(OCTAVES, "Octaves").labels(["1", "2", "3", "4"]).module("Arpeggiator"),
    new Param(GATE, "Gate").range(5, 100).default(50).unit("%").decimals(0).module("Arpeggiator"),
    new Param(LEARN, "Learn").labels(["Off", "On"]).module("Chord memory"),
  ];
}

class Template extends Effect {
  sampleRate: f64 = 48000;
  mode: i32 = 0;
  rate: i32 = 2;
  pattern: i32 = 0;
  octaves: i32 = 1;
  gate: f64 = 50;
  learn: bool = false;
  // The arpeggiator: the keys held (in the order played), the step, the note sounding.
  held: StaticArray<i32> = new StaticArray<i32>(MAX_HELD);
  heldVel: StaticArray<f64> = new StaticArray<f64>(MAX_HELD);
  heldCount: i32 = 0;
  sorted: StaticArray<i32> = new StaticArray<i32>(MAX_HELD);
  step: i32 = 0;
  acc: f64 = 0;
  lastGrid: f64 = -1;
  trigger: bool = false;
  outKey: i32 = -1;
  offIn: i32 = 0;
  /** Where the block's transport was last set (a transport event mid-block moves it). */
  trAt: i32 = 0;
  // The chord memory: the intervals learned, and what each held input key started.
  memory: StaticArray<i32> = new StaticArray<i32>(MAX_CHORD);
  memCount: i32 = 3;
  learnKeys: StaticArray<i32> = new StaticArray<i32>(MAX_CHORD);
  learnCount: i32 = 0;
  active: StaticArray<i32> = new StaticArray<i32>(128 * MAX_CHORD);
  activeCount: StaticArray<i32> = new StaticArray<i32>(128);

  constructor() {
    super();
    this.memory[0] = 0; this.memory[1] = 4; this.memory[2] = 7; // a major triad until one is learned
  }

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.reset();
    return true;
  }

  /** Forget every note (the host's reset: it silences what follows this plugin itself). */
  reset(): void {
    this.heldCount = 0; this.outKey = -1; this.offIn = 0; this.step = 0; this.acc = 0; this.lastGrid = -1; this.trigger = false;
    this.learnCount = 0;
    for (let k = 0; k < 128; k++) this.activeCount[k] = 0;
  }

  paramChanged(id: u32, value: f64): void {
    if (id == MODE) this.mode = <i32>value;
    else if (id == RATE) this.rate = <i32>value;
    else if (id == PATTERN) this.pattern = <i32>value;
    else if (id == OCTAVES) this.octaves = <i32>value + 1;
    else if (id == GATE) this.gate = value;
    else if (id == LEARN) { this.learn = value >= 0.5; this.learnCount = 0; }
  }

  process(io: Io, events: Events): void { this.trAt = 0; split(this, io, events); }

  /** After the glue has applied an event: a mode or Learn change ends every note sounding. */
  event(io: Io, e: Event): void {
    if (e.kind == EventKind.Transport) this.trAt = e.time;
    if (e.isParam(MODE) || e.isParam(LEARN)) this.flush(io, e.time);
  }

  flush(io: Io, n: i32): void {
    if (this.outKey >= 0) { io.sendNoteOff(-1, 0, <i16>this.outKey, 0, n); this.outKey = -1; }
    this.heldCount = 0;
    for (let k = 0; k < 128; k++) this.releaseKey(io, k, n);
  }

  // --- Notes in ---

  noteOn(io: Io, note: Note): void {
    const key = <i32>note.key;
    if (key < 0 || key > 127) return;
    if (this.mode == 0) {
      if (this.heldCount >= MAX_HELD) return;
      if (this.heldCount == 0) this.trigger = true;
      this.held[this.heldCount] = key;
      this.heldVel[this.heldCount] = note.velocity;
      this.heldCount++;
      return;
    }
    this.releaseKey(io, key, note.time); // the same key again: its chord starts afresh
    if (this.learn) {
      if (this.learnCount == 0) this.memCount = 0;
      if (this.learnCount < MAX_CHORD) { this.learnKeys[this.learnCount] = key; this.learnCount++; }
      this.learnChord();
      this.startKey(io, key, key, note.velocity, note.time); // played as it is while learning
      return;
    }
    for (let i = 0; i < this.memCount; i++) this.startKey(io, key, key + this.memory[i], note.velocity, note.time);
  }

  noteOff(io: Io, note: Note): void {
    const key = <i32>note.key;
    if (this.mode == 0) {
      this.removeHeld(key);
      if (this.heldCount == 0 && this.outKey >= 0) { io.sendNoteOff(-1, 0, <i16>this.outKey, 0, note.time); this.outKey = -1; }
      return;
    }
    if (key >= 0 && key < 128) this.releaseKey(io, key, note.time);
    for (let i = 0; i < this.learnCount; i++) {
      if (this.learnKeys[i] != key) continue;
      for (let j = i + 1; j < this.learnCount; j++) this.learnKeys[j - 1] = this.learnKeys[j];
      this.learnCount--;
      break;
    }
  }

  choke(io: Io, note: Note): void { this.flush(io, note.time); }

  removeHeld(key: i32): void {
    for (let i = 0; i < this.heldCount; i++) {
      if (this.held[i] != key) continue;
      for (let j = i + 1; j < this.heldCount; j++) { this.held[j - 1] = this.held[j]; this.heldVel[j - 1] = this.heldVel[j]; }
      this.heldCount--;
      return;
    }
  }

  /** The chord memory: the keys held while learning, from the lowest, as intervals. */
  learnChord(): void {
    let lo = 127;
    for (let i = 0; i < this.learnCount; i++) if (this.learnKeys[i] < lo) lo = this.learnKeys[i];
    this.memCount = 0;
    for (let i = 0; i < this.learnCount; i++) this.memory[this.memCount++] = this.learnKeys[i] - lo;
    // In ascending order (an insertion sort: a few entries, nothing allocated).
    for (let i = 1; i < this.memCount; i++) {
      const v = this.memory[i];
      let j = i - 1;
      while (j >= 0 && this.memory[j] > v) { this.memory[j + 1] = this.memory[j]; j--; }
      this.memory[j + 1] = v;
    }
  }

  startKey(io: Io, input: i32, out: i32, velocity: f64, n: i32): void {
    if (out < 0 || out > 127) return;
    const c = this.activeCount[input];
    if (c >= MAX_CHORD) return;
    this.active[input * MAX_CHORD + c] = out;
    this.activeCount[input] = c + 1;
    io.sendNoteOn(-1, 0, <i16>out, velocity, n);
  }

  releaseKey(io: Io, input: i32, n: i32): void {
    const c = this.activeCount[input];
    for (let i = 0; i < c; i++) io.sendNoteOff(-1, 0, <i16>this.active[input * MAX_CHORD + i], 0, n);
    this.activeCount[input] = 0;
  }

  // --- The arpeggiator's clock and the audio ---

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      for (let c = 0; c < io.channels; c++) io.output(c, n, io.input(c, n)); // the audio passes through
      if (this.mode != 0) continue;
      const stepBeats = 1.0 / <f64>(1 << this.rate);
      const framesPerStep = this.sampleRate * 60.0 / io.transport.tempo * stepBeats;
      if (this.outKey >= 0) {
        this.offIn--;
        if (this.offIn <= 0) { io.sendNoteOff(-1, 0, <i16>this.outKey, 0, n); this.outKey = -1; }
      }
      if (this.heldCount == 0) continue;
      let due = false;
      if (io.transport.playing) {
        // On the song's grid: a step at every multiple of the rate.
        const beat = io.transport.beat + <f64>(n - this.trAt) * io.transport.tempo / (60.0 * this.sampleRate);
        const grid = floor(beat / stepBeats);
        if (grid != this.lastGrid) { due = this.lastGrid >= 0; this.lastGrid = grid; }
      } else {
        // Free: a step every `framesPerStep` frames from the first key.
        this.lastGrid = -1;
        this.acc += 1;
        if (this.acc >= framesPerStep) { this.acc -= framesPerStep; due = true; }
      }
      if (this.trigger) { due = true; this.trigger = false; this.acc = 0; this.step = 0; }
      if (due) this.playStep(io, n, framesPerStep);
    }
  }

  playStep(io: Io, n: i32, framesPerStep: f64): void {
    const h = this.heldCount;
    // The keys in pattern order: sorted for Up, Down and Up-Down, as played otherwise.
    for (let i = 0; i < h; i++) this.sorted[i] = this.held[i];
    if (this.pattern != 3) {
      for (let i = 1; i < h; i++) {
        const v = this.sorted[i];
        let j = i - 1;
        while (j >= 0 && this.sorted[j] > v) { this.sorted[j + 1] = this.sorted[j]; j--; }
        this.sorted[j + 1] = v;
      }
    }
    const len = h * this.octaves;
    let i = 0;
    if (this.pattern == 1) i = len - 1 - this.step % len;
    else if (this.pattern == 2) {
      const period = len > 1 ? 2 * len - 2 : 1;
      const j = this.step % period;
      i = j < len ? j : period - j;
    } else i = this.step % len;
    const key = this.sorted[i % h] + 12 * (i / h);
    let velocity = 0.0;
    for (let k = 0; k < h; k++) if (this.held[k] == this.sorted[i % h]) velocity = this.heldVel[k];
    this.step++;
    if (this.outKey >= 0) io.sendNoteOff(-1, 0, <i16>this.outKey, 0, n);
    this.outKey = -1;
    if (key > 127) return;
    io.sendNoteOn(-1, 0, <i16>key, velocity, n);
    this.outKey = key;
    const gateFrames = <i32>floor(framesPerStep * this.gate / 100.0);
    this.offIn = gateFrames < 1 ? 1 : gateFrames;
  }

  // --- The state: the learned chord ---

  saveState(w: StateWriter): void {
    w.u32(<u32>this.memCount);
    for (let i = 0; i < this.memCount; i++) w.u32(<u32>this.memory[i]);
  }

  loadState(r: StateReader, version: u32): bool {
    const n = <i32>r.u32();
    if (!r.ok || n < 0 || n > MAX_CHORD) return false;
    for (let i = 0; i < n; i++) { const v = <i32>r.u32(); if (v < 0 || v > 127) return false; this.memory[i] = v; }
    this.memCount = n;
    return r.ok;
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
