// EST Instrument Template (AS) (org.example.est-instrument-template-as): an EST instrument in
// AssemblyScript, made from the instrument-as template, which starts as four voices of a
// band-limited saw into a resonant low-pass, each shaped by an ADSR. Grow the voice, keep est.json's
// identity and parameters in step with `describe()` and `parameters()`, then (see AGENTS.md):
//
//     est pack        # asc (asconfig.json's release target), then the bundle in dist/
//     est validate    # the checks Cyber's install runs; read dist/validation.json
//     est test        # the golden render in test/ plus the conformance run
//
// The rules an instrument keeps (the conformance run checks each): every note it starts ends with
// a NOTE_END when its voice stops sounding (`Voices` sends it: call `voices.end` when a voice falls
// silent); a choke stops at once; `tail()` covers the longest release; allocate only in the
// constructor, field initialisers and `activate`, never in `render`, `process`, `paramChanged` or
// the note handlers; no top-level code but constants (no start function).

import {
  Descriptor, Envelope, Filter, Instrument, Io, Note, Oscillator, Param, Plugin, Smoother, Voice, Voices, Wave,
  alloc, dbToGain, isReady, keyToHz, setup,
} from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-instrument-template-as", "EST Instrument Template (AS)", "Example", "1.0.0",
    "Four voices of a saw through a resonant low-pass and an ADSR: the starting point for an EST instrument in AssemblyScript.",
    ["instrument", "synthesizer", "stereo"], "TMPI", 1);
}

const LEVEL: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const VOICES = 4;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-60, 0).default(-12).unit("dB").decimals(1),
    new Param(CUTOFF, "Cutoff").range(20, 20000).default(2000).hertz().module("Filter"),
    new Param(RESONANCE, "Resonance").range(0, 1).default(0.2).module("Filter"),
    new Param(ATTACK, "Attack").range(1, 2000).default(5).unit("ms").decimals(0).module("Envelope"),
    new Param(DECAY, "Decay").range(1, 2000).default(200).unit("ms").decimals(0).module("Envelope"),
    new Param(SUSTAIN, "Sustain").range(0, 100).default(70).unit("%").decimals(0).module("Envelope"),
    new Param(RELEASE, "Release").range(1, 4000).default(300).unit("ms").decimals(0).module("Envelope"),
  ];
}

class SynthVoice extends Voice {
  osc: Oscillator = new Oscillator();
  filter: Filter = new Filter();
  env: Envelope = new Envelope();
  velocity: f64 = 0;
  constructor() { super(); this.osc.setWave(Wave.Saw); }
  release(): void { this.env.release(); }
  stop(): void { this.env.reset(); }
}

class Template extends Instrument {
  voices: Voices<SynthVoice> = new Voices<SynthVoice>(VOICES);
  level: Smoother = new Smoother(0.005);
  sampleRate: f64 = 48000;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.level.setSampleRate(sampleRate);
    this.level.reset();
    for (let i = 0; i < VOICES; i++) {
      const v = this.voices.voice(i);
      v.osc.setSampleRate(sampleRate);
      v.filter.setSampleRate(sampleRate);
      v.env.setSampleRate(sampleRate);
    }
    return true;
  }

  reset(): void { this.voices.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == LEVEL) { this.level.setTarget(dbToGain(value)); return; }
    for (let i = 0; i < VOICES; i++) {
      const v = this.voices.voice(i);
      if (id == CUTOFF) v.filter.setCutoff(value);
      else if (id == RESONANCE) v.filter.setResonance(value);
      else if (id == ATTACK) v.env.setAttack(value / 1000);
      else if (id == DECAY) v.env.setDecay(value / 1000);
      else if (id == SUSTAIN) v.env.setSustain(value / 100);
      else if (id == RELEASE) v.env.setRelease(value / 1000);
    }
  }

  noteOn(io: Io, note: Note): void {
    const i = this.voices.start(io, note);
    const v = this.voices.voice(i);
    v.osc.setFrequency(keyToHz(<f64>note.key));
    v.osc.reset(0);
    v.filter.reset();
    v.env.start();
    v.velocity = note.velocity;
  }

  noteOff(io: Io, note: Note): void { this.voices.release(note); }

  choke(io: Io, note: Note): void { this.voices.choke(io, note); }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const level = this.level.next();
      let sum = 0.0;
      for (let i = 0; i < VOICES; i++) {
        if (!this.voices.isOn(i)) continue;
        const v = this.voices.voice(i);
        const e = v.env.next();
        if (!v.env.isActive()) { this.voices.end(i, io, n); continue; }
        sum += v.filter.process(v.osc.next()) * e * v.velocity;
      }
      const s = <f32>(sum * level);
      io.add(0, n, s);
      io.add(1, n, s);
    }
  }

  /** The longest a released voice sounds: its release. */
  tail(): u32 { return this.voices.voice(0).env.tailFrames(); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
