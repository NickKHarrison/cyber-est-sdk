// Cookbook Drum Synth (org.example.cookbook-drum-synth), from the EST cookbook: a kick, a snare and a hat, made from sines and noise. The recipe's
// page is README.md; `est new drum-synth <folder>` copies it to start from. Allocate only in field
// initialisers, the constructor and `activate`; no top-level code but constants.

import { Descriptor, Instrument, Io, Note, Param, Plugin, Smoother, Voice, Voices, alloc, dbToGain, exp, isReady, setup, sinTurns } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.cookbook-drum-synth", "Cookbook Drum Synth", "Example", "1.0.0",
    "A drum synth: a kick (a falling sine), a snare (a tone and noise) and a hat (high-passed noise), on the General MIDI keys.",
    ["instrument", "drum-machine", "stereo"], "CKDS", 1);
}
const LEVEL: u32 = 0;
const KICK_DECAY: u32 = 1;
const KICK_PITCH: u32 = 2;
const SNARE_DECAY: u32 = 3;
const HAT_DECAY: u32 = 4;
const VOICES = 8;
const KICK = 0;
const SNARE = 1;
const HAT = 2;

function parameters(): Param[] {
  return [
    new Param(LEVEL, "Level").range(-60, 0).default(-6).unit("dB").decimals(1),
    new Param(KICK_DECAY, "Kick decay").range(50, 1500).default(400).unit("ms").decimals(0).module("Kick"),
    new Param(KICK_PITCH, "Kick pitch").range(30, 90).default(48).unit("Hz").decimals(0).module("Kick"),
    new Param(SNARE_DECAY, "Snare decay").range(50, 800).default(180).unit("ms").decimals(0).module("Snare"),
    new Param(HAT_DECAY, "Hat decay").range(10, 500).default(60).unit("ms").decimals(0).module("Hat"),
  ];
}

class Drum extends Voice {
  kind: i32 = 0;
  phase: f64 = 0;
  amp: f64 = 0;
  fall: f64 = 1;
  sweep: f64 = 0;
  sweepFall: f64 = 1;
  noiseAmp: f64 = 0;
  noiseFall: f64 = 1;
  lp: f64 = 0;
  velocity: f64 = 0;
  release(): void {} // a drum plays out whatever the key does
  stop(): void { this.amp = 0; this.noiseAmp = 0; }
}

class Template extends Instrument {
  voices: Voices<Drum> = new Voices<Drum>(VOICES);
  level: Smoother = new Smoother(0.005);
  sampleRate: f64 = 48000;
  kickDecay: f64 = 0.4;
  kickPitch: f64 = 48;
  snareDecay: f64 = 0.18;
  hatDecay: f64 = 0.06;
  /** The noise: one xorshift for every voice, so a render is the same every time. */
  seed: u32 = 0x9e3779b9;

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sampleRate = sampleRate;
    this.level.setSampleRate(sampleRate);
    this.level.reset();
    return true;
  }

  reset(): void { this.voices.reset(); this.seed = 0x9e3779b9; }

  paramChanged(id: u32, value: f64): void {
    if (id == LEVEL) this.level.setTarget(dbToGain(value));
    else if (id == KICK_DECAY) this.kickDecay = value / 1000;
    else if (id == KICK_PITCH) this.kickPitch = value;
    else if (id == SNARE_DECAY) this.snareDecay = value / 1000;
    else if (id == HAT_DECAY) this.hatDecay = value / 1000;
  }

  @inline noise(): f64 {
    let s = this.seed;
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    this.seed = s;
    return <f64>(s >> 8) / 8388608.0 - 1.0;
  }

  /** The per-sample factor that falls by 1/e in `seconds`. */
  fall(seconds: f64): f64 { return exp(-1.0 / (seconds * this.sampleRate)); }

  noteOn(io: Io, note: Note): void {
    const d = this.voices.voice(this.voices.start(io, note));
    const key = <i32>note.key;
    d.kind = key < 38 ? KICK : key < 42 ? SNARE : HAT; // 36 kick, 38 snare, 42 hat (General MIDI)
    d.phase = 0; d.lp = 0; d.velocity = note.velocity;
    if (d.kind == KICK) { d.amp = 1; d.fall = this.fall(this.kickDecay / 4); d.sweep = 1; d.sweepFall = this.fall(0.03); d.noiseAmp = 0; }
    else if (d.kind == SNARE) { d.amp = 0.6; d.fall = this.fall(this.snareDecay / 6); d.sweep = 0; d.noiseAmp = 0.8; d.noiseFall = this.fall(this.snareDecay / 4); }
    else { d.amp = 0; d.sweep = 0; d.noiseAmp = 0.7; d.noiseFall = this.fall(this.hatDecay / 4); }
  }

  noteOff(io: Io, note: Note): void { this.voices.release(note); }

  choke(io: Io, note: Note): void { this.voices.choke(io, note); }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const level = this.level.next();
      const white = this.noise();
      let sum = 0.0;
      for (let i = 0; i < VOICES; i++) {
        if (!this.voices.isOn(i)) continue;
        const d = this.voices.voice(i);
        if (d.amp < 1e-4 && d.noiseAmp < 1e-4) { this.voices.end(i, io, n); continue; } // -80 dB: done
        let s = 0.0;
        if (d.kind == KICK) {
          s = sinTurns(d.phase) * d.amp;
          d.phase += this.kickPitch * (1.0 + 2.5 * d.sweep) / this.sampleRate; // the pitch falls to Kick pitch
          d.sweep *= d.sweepFall;
        } else if (d.kind == SNARE) {
          s = sinTurns(d.phase) * d.amp + white * d.noiseAmp;
          d.phase += 185.0 / this.sampleRate;
        } else {
          d.lp += (white - d.lp) * 0.3; // the hat: noise less its low part
          s = (white - d.lp) * d.noiseAmp;
        }
        if (d.phase >= 1.0) d.phase -= 1.0;
        d.amp *= d.fall;
        d.noiseAmp *= d.noiseFall;
        sum += s * d.velocity;
      }
      const out = <f32>(sum * level);
      io.add(0, n, out);
      io.add(1, n, out);
    }
  }

  /** The longest a drum sounds: the kick's decay to -80 dB (its decay is a quarter of Kick decay per 1/e). */
  tail(): u32 { return <u32>(this.sampleRate * 1.5 * 2.5); }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
