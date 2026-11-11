// Cookbook Wavetable (org.example.cookbook-wavetable), from the EST cookbook: four waves in one table, morphed by Position. The recipe's
// page is README.md; `est new wavetable <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Envelope, Instrument, Io, Note, Param, Plugin, Smoother, Voice, Voices, alloc, dbToGain, floor, isReady, keyToHz, setup, sinTurns } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-wavetable", "Cookbook Wavetable", "Example", "1.0.0",
    "A wavetable synth: four single-cycle waves (sine, triangle, saw, square) morphed by Position, six voices with an envelope.",
    ["instrument", "synthesizer", "stereo"], "CKWT", 1);
}
const LEVEL: u32 = 0;
const POSITION: u32 = 1;
const ATTACK: u32 = 2;
const RELEASE: u32 = 3;
const VOICES = 6;
const SIZE = 2048;
const WAVES = 4;
const HARMONICS = 24;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-60, 0).default(-12).unit("dB").decimals(1),
    new Param(POSITION, "Position").range(0, 3).default(0).decimals(2),
    new Param(ATTACK, "Attack").range(1, 2000).default(5).unit("ms").decimals(0).module("Envelope"),
    new Param(RELEASE, "Release").range(1, 4000).default(300).unit("ms").decimals(0).module("Envelope"),
  ];
}

class TableVoice extends Voice {
  env: Envelope = new Envelope();
  phase: f64 = 0;
  inc: f64 = 0;
  velocity: f64 = 0;
  release(): void { this.env.release(); }
  stop(): void { this.env.reset(); }
}

class Template extends Instrument {
  voices: Voices<TableVoice> = new Voices<TableVoice>(VOICES);
  /** WAVES tables of SIZE + 1 frames (the last repeats the first, for the interpolation). */
  table: StaticArray<f32> = new StaticArray<f32>(WAVES * (SIZE + 1));
  built: bool = false;
  level: Smoother = new Smoother(0.005);
  position: Smoother = new Smoother(0.02);
  sampleRate: f64 = 48000;

  /** The four waves by their harmonics (band-limited to HARMONICS), each at a peak of 1. */
  build(): void {
    for (let w = 0; w < WAVES; w++) {
      let peak = 0.0;
      for (let i = 0; i < SIZE; i++) {
        let s = 0.0;
        const t = <f64>i / <f64>SIZE;
        for (let h = 1; h <= HARMONICS; h++) {
          const hf = <f64>h;
          let a = 0.0;
          if (w == 0) a = h == 1 ? 1.0 : 0.0;
          else if (w == 1) a = (h & 1) == 1 ? ((h >> 1) & 1 ? -1.0 : 1.0) / (hf * hf) : 0.0;
          else if (w == 2) a = 1.0 / hf;
          else a = (h & 1) == 1 ? 1.0 / hf : 0.0;
          if (a != 0.0) s += a * sinTurns(t * hf);
        }
        this.table[w * (SIZE + 1) + i] = <f32>s;
        if (abs<f64>(s) > peak) peak = abs<f64>(s);
      }
      for (let i = 0; i < SIZE; i++) this.table[w * (SIZE + 1) + i] = <f32>(<f64>this.table[w * (SIZE + 1) + i] / peak);
      this.table[w * (SIZE + 1) + SIZE] = this.table[w * (SIZE + 1)];
    }
    this.built = true;
  }

  activate(sampleRate: f64, maxFrames: u32): bool {
    if (!this.built) this.build();
    this.sampleRate = sampleRate;
    this.level.setSampleRate(sampleRate); this.level.reset();
    this.position.setSampleRate(sampleRate); this.position.reset();
    for (let i = 0; i < VOICES; i++) this.voices.voice(i).env.setSampleRate(sampleRate);
    return true;
  }

  reset(): void { this.voices.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == LEVEL) { this.level.setTarget(dbToGain(value)); return; }
    if (id == POSITION) { this.position.setTarget(value); return; }
    for (let i = 0; i < VOICES; i++) {
      const e = this.voices.voice(i).env;
      e.setSustain(1); e.setDecay(0.01);
      if (id == ATTACK) e.setAttack(value / 1000);
      else if (id == RELEASE) e.setRelease(value / 1000);
    }
  }

  /** Wave `w` at `phase` (0…1), interpolated. */
  @inline at(w: i32, phase: f64): f64 {
    const x = phase * <f64>SIZE;
    const i = <i32>floor(x);
    const base = w * (SIZE + 1) + i;
    const a = <f64>this.table[base];
    return a + (<f64>this.table[base + 1] - a) * (x - <f64>i);
  }

  noteOn(io: Io, note: Note): void {
    const v = this.voices.voice(this.voices.start(io, note));
    v.phase = 0;
    v.inc = keyToHz(<f64>note.key) / this.sampleRate;
    v.velocity = note.velocity;
    v.env.start();
  }

  noteOff(io: Io, note: Note): void { this.voices.release(note); }

  choke(io: Io, note: Note): void { this.voices.choke(io, note); }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const level = this.level.next();
      const pos = this.position.next();
      let w = <i32>floor(pos);
      if (w > WAVES - 2) w = WAVES - 2;
      const mix = pos - <f64>w;
      let sum = 0.0;
      for (let i = 0; i < VOICES; i++) {
        if (!this.voices.isOn(i)) continue;
        const v = this.voices.voice(i);
        const e = v.env.next();
        if (!v.env.isActive()) { this.voices.end(i, io, n); continue; }
        const a = this.at(w, v.phase), b = this.at(w + 1, v.phase);
        sum += (a + (b - a) * mix) * e * v.velocity;
        v.phase += v.inc;
        if (v.phase >= 1.0) v.phase -= 1.0;
      }
      const s = <f32>(sum * level);
      io.add(0, n, s);
      io.add(1, n, s);
    }
  }

  tail(): u32 { return this.voices.voice(0).env.tailFrames(); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
