// Cookbook Step Sequencer (org.example.cookbook-step-sequencer), from the EST cookbook: eight steps of notes, synced to the tempo. The recipe's
// page is README.md; `est new step-sequencer <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Effect, Event, EventKind, Events, Io, Note, Param, Plugin, alloc, floor, isReady, setup, split } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-step-sequencer", "Cookbook Step Sequencer", "Example", "1.0.0",
    "A step sequencer: eight steps of notes from a root key, at a rate synced to the tempo, free or with the transport; notes played in pass through.",
    ["audio-effect", "note-effect", "stereo"], "CKSQ", 1).noteEffect();
}
const RUN: u32 = 0;
const RATE: u32 = 1;
const ROOT: u32 = 2;
const STEPS: u32 = 3;
const GATE: u32 = 4;
const STEP: u32 = 5; // Step 1 … Step 8: 5 … 12
const DEFAULTS: StaticArray<f64> = [0, 12, 7, 3, 0, 10, 7, 15];

function parameters(): Param[] {
  const ps: Param[] = [
    new Param(RUN, "Run").labels(["Off", "On", "With the transport"]).default(2),
    new Param(RATE, "Rate").labels(["1/4", "1/8", "1/16"]).default(2),
    new Param(ROOT, "Root").range(24, 96).default(48).decimals(0),
    new Param(STEPS, "Steps").range(1, 8).default(8).decimals(0),
    new Param(GATE, "Gate").range(5, 100).default(50).unit("%").decimals(0),
  ];
  for (let i = 0; i < 8; i++) ps.push(new Param(STEP + <u32>i, `Step ${i + 1}`).range(0, 24).default(DEFAULTS[i]).unit("st").decimals(0).module("Steps"));
  return ps;
}

class Template extends Effect {
  sampleRate: f64 = 48000;
  run: i32 = 2;
  rate: i32 = 2;
  root: i32 = 48;
  steps: i32 = 8;
  gate: f64 = 50;
  pitch: StaticArray<i32> = new StaticArray<i32>(8);
  step: i32 = 0;
  acc: f64 = 0;
  lastGrid: f64 = -1;
  started: bool = false;
  outKey: i32 = -1;
  offIn: i32 = 0;
  trAt: i32 = 0;

  activate(sampleRate: f64, maxFrames: u32): bool { this.sampleRate = sampleRate; this.reset(); return true; }

  reset(): void { this.step = 0; this.acc = 0; this.lastGrid = -1; this.started = false; this.outKey = -1; this.offIn = 0; }

  paramChanged(id: u32, value: f64): void {
    if (id == RUN) this.run = <i32>value;
    else if (id == RATE) this.rate = <i32>value;
    else if (id == ROOT) this.root = <i32>floor(value + 0.5);
    else if (id == STEPS) this.steps = <i32>floor(value + 0.5);
    else if (id == GATE) this.gate = value;
    else if (id >= STEP && id < STEP + 8) this.pitch[id - STEP] = <i32>floor(value + 0.5);
  }

  process(io: Io, events: Events): void { this.trAt = 0; split(this, io, events); }

  event(io: Io, e: Event): void {
    if (e.kind == EventKind.Transport) this.trAt = e.time;
    if (e.isParam(RUN)) { this.stop(io, e.time); this.started = false; }
  }

  // Notes played in pass through.
  noteOn(io: Io, note: Note): void { io.sendNoteOn(note.noteId, note.channel, note.key, note.velocity, note.time); }
  noteOff(io: Io, note: Note): void { io.sendNoteOff(note.noteId, note.channel, note.key, note.velocity, note.time); }

  stop(io: Io, n: i32): void {
    if (this.outKey >= 0) io.sendNoteOff(-1, 0, <i16>this.outKey, 0, n);
    this.outKey = -1;
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      for (let c = 0; c < io.channels; c++) io.output(c, n, io.input(c, n)); // the audio passes through
      const stepBeats = 1.0 / <f64>(1 << this.rate);
      const framesPerStep = this.sampleRate * 60.0 / io.transport.tempo * stepBeats;
      if (this.outKey >= 0) { this.offIn--; if (this.offIn <= 0) this.stop(io, n); }
      let due = false;
      if (this.run == 2) {
        if (!io.transport.playing) { if (this.started) { this.stop(io, n); this.started = false; } continue; }
        // With the transport: step k is at beat k × the rate, from the song's start.
        const beat = io.transport.beat + <f64>(n - this.trAt) * io.transport.tempo / (60.0 * this.sampleRate);
        const grid = floor(beat / stepBeats);
        if (grid != this.lastGrid) {
          due = true;
          this.lastGrid = grid;
          const s = <i32>(grid - floor(grid / <f64>this.steps) * <f64>this.steps);
          this.step = s;
        }
        this.started = true;
      } else if (this.run == 1) {
        if (!this.started) { this.started = true; this.acc = 0; this.step = 0; due = true; }
        else { this.acc += 1; if (this.acc >= framesPerStep) { this.acc -= framesPerStep; due = true; this.step++; } }
        if (this.step >= this.steps) this.step = 0;
      } else continue;
      if (!due) continue;
      this.stop(io, n);
      const key = this.root + this.pitch[this.step];
      if (key > 127) continue;
      io.sendNoteOn(-1, 0, <i16>key, 0.8, n);
      this.outKey = key;
      const g = <i32>floor(framesPerStep * this.gate / 100.0);
      this.offIn = g < 1 ? 1 : g;
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
