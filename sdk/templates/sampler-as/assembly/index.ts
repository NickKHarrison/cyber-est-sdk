// EST Sampler Template (AS) (org.example.est-sampler-template-as): an EST instrument in
// AssemblyScript, made from the sampler-as template: WAVs from assets/, mapped to keys and
// velocity layers in samples.json, played from notes with pitch, a one-shot or loop mode and an
// ADSR. The samples are in the module (assembly/samples.ts, written by tools/embed-samples.mjs):
// an EST module reads no file and fetches nothing at run time. Then (see AGENTS.md):
//
//     node tools/embed-samples.mjs   # after changing samples.json or a WAV
//     est pack        # asc (asconfig.json's release target), then the bundle in dist/
//     est validate    # the checks Cyber's install runs; read dist/validation.json
//     est test        # the golden render in test/ plus the conformance run
//
// The rules an instrument keeps: every note it starts ends with a NOTE_END when its voice stops
// (`voices.end`); a choke stops at once; `tail()` covers the longest release; allocate only in the
// constructor, field initialisers and `activate`; no top-level code but constants.

import {
  Descriptor, Envelope, Instrument, Io, Note, Param, Plugin, Smoother, Voice, Voices,
  alloc, dbToGain, exp2, floor, isReady, setup,
} from "est";
import { COUNT, DATA, INFO, INFO_STRIDE } from "./samples";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-sampler-template-as", "EST Sampler Template (AS)", "Example", "1.0.0",
    "Samples mapped to keys and velocity layers, one-shot or looped, with an ADSR: the starting point for an EST sampler in AssemblyScript.",
    ["instrument", "sampler", "stereo"], "TMPS", 1);
}

const LEVEL: u32 = 0;
const MODE: u32 = 1;
const TUNE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const VOICES = 8;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-60, 0).default(-6).unit("dB").decimals(1),
    new Param(MODE, "Mode").labels(["One-shot", "Loop"]),
    new Param(TUNE, "Tune").range(-24, 24).default(0).unit("st").decimals(0),
    new Param(ATTACK, "Attack").range(0, 2000).default(1).unit("ms").decimals(0).module("Envelope"),
    new Param(DECAY, "Decay").range(1, 4000).default(400).unit("ms").decimals(0).module("Envelope"),
    new Param(SUSTAIN, "Sustain").range(0, 100).default(80).unit("%").decimals(0).module("Envelope"),
    new Param(RELEASE, "Release").range(1, 4000).default(200).unit("ms").decimals(0).module("Envelope"),
  ];
}

/** Value `k` of sample `s`'s row in the table. */
@inline function info(s: i32, k: i32): i32 { return load<i32>(INFO + (<usize>(s * INFO_STRIDE + k) << 2)); }
/** Frame `i` of the table's data, as -1…1. */
@inline function frame(i: i32): f64 { return <f64>load<i16>(DATA + (<usize>i << 1)) / 32768.0; }

class SampleVoice extends Voice {
  env: Envelope = new Envelope();
  sample: i32 = 0;
  pos: f64 = 0;
  step: f64 = 1;
  gain: f64 = 0;
  release(): void { this.env.release(); }
  stop(): void { this.env.reset(); }
}

class Template extends Instrument {
  voices: Voices<SampleVoice> = new Voices<SampleVoice>(VOICES);
  level: Smoother = new Smoother(0.005);
  sampleRate: f64 = 48000;
  loop: bool = false;
  tune: f64 = 0;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.level.setSampleRate(sampleRate);
    this.level.reset();
    for (let i = 0; i < VOICES; i++) this.voices.voice(i).env.setSampleRate(sampleRate);
    return true;
  }

  reset(): void { this.voices.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == LEVEL) { this.level.setTarget(dbToGain(value)); return; }
    if (id == MODE) { this.loop = value >= 0.5; return; }
    if (id == TUNE) { this.tune = value; return; }
    for (let i = 0; i < VOICES; i++) {
      const e = this.voices.voice(i).env;
      if (id == ATTACK) e.setAttack(value / 1000);
      else if (id == DECAY) e.setDecay(value / 1000);
      else if (id == SUSTAIN) e.setSustain(value / 100);
      else if (id == RELEASE) e.setRelease(value / 1000);
    }
  }

  /** The first sample whose keys and velocities hold the note, or -1. */
  pick(key: i32, velocity: f64): i32 {
    for (let s = 0; s < COUNT; s++) {
      if (key < info(s, 4) || key > info(s, 5)) continue;
      if (velocity < <f64>info(s, 6) / 1000.0 || velocity > <f64>info(s, 7) / 1000.0) continue;
      return s;
    }
    return -1;
  }

  noteOn(io: Io, note: Note): void {
    const s = this.pick(<i32>note.key, note.velocity);
    if (s < 0) { io.noteEnd(note.noteId, note.port, note.channel, note.key, note.time); return; } // no sample: it ends at once
    const i = this.voices.start(io, note);
    const v = this.voices.voice(i);
    v.sample = s;
    v.pos = 0;
    v.step = exp2((<f64>note.key + this.tune - <f64>info(s, 3)) / 12.0) * <f64>info(s, 2) / this.sampleRate;
    v.gain = note.velocity;
    v.env.start();
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
        const s = v.sample, at = info(s, 0), len = info(s, 1), ls = info(s, 8), le = info(s, 9);
        const e = v.env.next();
        if (!v.env.isActive() || (!this.loop && v.pos >= <f64>(len - 1))) { this.voices.end(i, io, n); continue; }
        // Linear interpolation between two frames (the loop's end wraps to its start).
        const k = <i32>floor(v.pos);
        const frac = v.pos - <f64>k;
        let k1 = k + 1;
        if (this.loop && k1 >= le) k1 = ls;
        const x0 = frame(at + k), x1 = frame(at + (k1 < len ? k1 : len - 1));
        sum += (x0 + (x1 - x0) * frac) * e * v.gain;
        v.pos += v.step;
        if (this.loop && v.pos >= <f64>le) v.pos -= <f64>(le - ls);
      }
      const out = <f32>(sum * level);
      io.add(0, n, out);
      io.add(1, n, out);
    }
  }

  /** The longest a released voice sounds: its release. */
  tail(): u32 { return this.voices.voice(0).env.tailFrames(); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
