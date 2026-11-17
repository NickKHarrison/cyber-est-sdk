// The DSP toolkit's test instrument (not a catalogue plugin): sine voices on the toolkit's
// `VoiceAllocator`, `Adsr` and `Declick`, with a `StepClock` that plays a generated note on every
// step while Clock is on (its key from `chance` by the step's index). It reports what the tests read
// as read-only parameters: voices active and held, the sum of the held keys, notes waiting for a
// steal's fade, the steps fired, and the last step's place in its bar and on the song's grid.
// Keys 42, 44 and 46 are choke group 1 (closed, pedal and open hat). CC 64 is the sustain pedal.

import { Descriptor, Event, EventKind, Events, Instrument, Io, Note, Param, Plugin, alloc, exp2, isReady, setup, sinTurns } from "est";
import { CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, HEADER_SIZE, HEADER_SPACE_ID, HEADER_TIME, HEADER_TYPE, OUTPUT_EVENTS_TRY_PUSH, PARAM_VALUE_PARAM_ID, PARAM_VALUE_SIZE, PARAM_VALUE_VALUE } from "est/clap";
import { Adsr, Declick, StepClock, Tail, VOICE_RELEASE, VOICE_START, VOICE_STOP, VoiceAllocator, chance, eventKind, eventSlot, t60To } from "../../../index";

export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new ToolkitSynth(); }

function describe(): Descriptor {
  return new Descriptor("org.example.dsp-toolkit-synth", "DSP Toolkit Test Synth", "Example", "1.0.0",
    "The DSP toolkit's test instrument: sine voices on the toolkit's allocator, envelope and step clock, rendered by sdk/tests/dspToolkit.test.ts. Not a catalogue plugin.",
    ["instrument", "synthesizer", "stereo"], "DSPT", 1);
}

const FADE: u32 = 1;
const SUSTAIN: u32 = 2;
const RELEASE: u32 = 3;
const CLOCK: u32 = 4;
const SWING: u32 = 5;
const POLICY: u32 = 6;
const DECAY: u32 = 7;
const R_ACTIVE: u32 = 20;
const R_HELD: u32 = 21;
const R_KEYSUM: u32 = 22;
const R_WAITING: u32 = 23;
const R_FIRED: u32 = 24;
const R_INBAR: u32 = 25;
const R_INDEX: u32 = 26;

const MAX_VOICES = 16;

function parameters(): Param[] {
  return [
    new Param(FADE, "Steal fade").range(0, 20).default(3).unit("ms").decimals(1),
    new Param(SUSTAIN, "Sustain").range(0, 100).default(100).unit("%").decimals(0),
    new Param(RELEASE, "Release").range(0.01, 10).default(0.3).unit("s").decimals(2),
    new Param(CLOCK, "Clock").labels(["Off", "On"]).default(0),
    new Param(SWING, "Swing").range(0, 100).default(0).unit("%").decimals(0),
    new Param(POLICY, "Policy").labels(["Oldest", "Quietest", "None"]).default(0),
    new Param(DECAY, "Decay").range(0.01, 10).default(1).unit("s").decimals(2),
    new Param(R_ACTIVE, "Active").range(0, 16).default(0).decimals(0).hidden().readOnly(),
    new Param(R_HELD, "Held").range(0, 16).default(0).decimals(0).hidden().readOnly(),
    new Param(R_KEYSUM, "Key sum").range(0, 4096).default(0).decimals(0).hidden().readOnly(),
    new Param(R_WAITING, "Waiting").range(0, 16).default(0).decimals(0).hidden().readOnly(),
    new Param(R_FIRED, "Steps fired").range(0, 1e9).default(0).decimals(0).hidden().readOnly(),
    new Param(R_INBAR, "Step in bar").range(-1, 64).default(-1).decimals(0).hidden().readOnly(),
    new Param(R_INDEX, "Step index").range(-1, 1e9).default(-1).decimals(0).hidden().readOnly(),
  ];
}

class Readout {
  ev: StaticArray<u8> = new StaticArray<u8>(<i32>PARAM_VALUE_SIZE);
  push(io: Io, id: u32, value: f64, n: i32): void {
    if (io.outEvents == 0) return;
    const e = changetype<usize>(this.ev);
    memory.fill(e, 0, PARAM_VALUE_SIZE);
    store<u32>(e, <u32>PARAM_VALUE_SIZE, HEADER_SIZE);
    store<u32>(e, <u32>(n < 0 ? 0 : n >= io.frames ? (io.frames > 0 ? io.frames - 1 : 0) : n), HEADER_TIME);
    store<u16>(e, CLAP_CORE_EVENT_SPACE_ID, HEADER_SPACE_ID);
    store<u16>(e, CLAP_EVENT_PARAM_VALUE, HEADER_TYPE);
    store<u32>(e, id, PARAM_VALUE_PARAM_ID);
    store<i32>(e, -1, 24);
    store<i16>(e, -1, 28);
    store<i16>(e, -1, 30);
    store<i16>(e, -1, 32);
    store<f64>(e, value, PARAM_VALUE_VALUE);
    call_indirect<bool>(load<u32>(io.outEvents, OUTPUT_EVENTS_TRY_PUSH), io.outEvents, e);
  }
}

class SineVoice {
  env: Adsr = new Adsr();
  click: Declick = new Declick();
  ph: f64 = 0;
  dt: f64 = 0;
  amp: f64 = 0;
  last: f64 = 0;
  left: f64 = 0; // a generated note's frames left
}

class ToolkitSynth extends Instrument {
  sr: f64 = 48000;
  alloc: VoiceAllocator = new VoiceAllocator(MAX_VOICES);
  voices: StaticArray<SineVoice> = new StaticArray<SineVoice>(MAX_VOICES);
  clock: StepClock = new StepClock();
  readout: Readout = new Readout();
  tailCalc: Tail = new Tail();
  fadeMs: f64 = 3;
  sustain: f64 = 1;
  release: f64 = 0.3;
  decay: f64 = 1;
  clockOn: bool = false;
  fired: f64 = 0;
  lastInBar: f64 = -1;
  lastIndex: f64 = -1;
  trAt: i32 = 0;
  readLeft: i32 = 0;

  constructor() {
    super();
    for (let i = 0; i < MAX_VOICES; i++) unchecked(this.voices[i] = new SineVoice());
    this.clock.step = 0.25;
  }

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.sr = sampleRate;
    this.alloc.reset();
    this.alloc.setFade(this.fadeMs * 0.001, sampleRate);
    this.clock.reset();
    for (let i = 0; i < MAX_VOICES; i++) { const v = unchecked(this.voices[i]); v.env.stop(); v.click.clear(); v.click.setTime(0.002, sampleRate); v.env.holdAttack = true; }
    this.envelopes();
    return true;
  }

  envelopes(): void {
    for (let i = 0; i < MAX_VOICES; i++) {
      const e = unchecked(this.voices[i]).env;
      e.setAttack(0.002, this.sr);
      e.setDecayT60(this.decay, this.sr);
      e.setSustain(this.sustain);
      e.setReleaseT60(this.release, this.sr);
    }
  }

  paramChanged(id: u32, value: f64): void {
    if (id == FADE) { this.fadeMs = value; this.alloc.setFade(value * 0.001, this.sr); }
    else if (id == SUSTAIN) { this.sustain = value / 100; this.envelopes(); }
    else if (id == RELEASE) { this.release = value; this.envelopes(); }
    else if (id == DECAY) { this.decay = value; this.envelopes(); }
    else if (id == CLOCK) { const on = value >= 0.5; if (on && !this.clockOn) this.clock.reset(); this.clockOn = on; }
    else if (id == SWING) this.clock.setSwing(value / 100 * 0.5);
    else if (id == POLICY) this.alloc.policy = <i32>value;
  }

  drain(): void {
    let e = this.alloc.next();
    while (e >= 0) {
      const s = eventSlot(e), k = eventKind(e);
      const v = unchecked(this.voices[s]);
      if (k == VOICE_START) {
        if (v.env.active) v.click.take(v.last); else v.click.clear();
        v.ph = 0;
        v.dt = 440.0 * exp2((<f64>this.alloc.key(s) - 69.0) / 12.0) / this.sr;
        v.amp = 0.05 + 0.1 * this.alloc.velocity(s);
        v.env.start();
      } else if (k == VOICE_RELEASE) v.env.release();
      else if (k == VOICE_STOP) { v.env.stop(); v.click.clear(); v.last = 0; }
      e = this.alloc.next();
    }
  }

  noteOn(io: Io, note: Note): void {
    const k = <i32>note.key;
    this.alloc.noteOn(io, note, k == 42 || k == 44 || k == 46 ? 1 : -1);
    this.drain();
  }
  noteOff(io: Io, note: Note): void { this.alloc.noteOff(io, note); this.drain(); }
  choke(io: Io, note: Note): void { this.alloc.choke(io, note); this.drain(); }
  midi(io: Io, port: u16, data: StaticArray<u8>): void {
    if ((data[0] & 0xf0) == 0xb0 && data[1] == 64) { this.alloc.pedal(io, data[2] >= 64); this.drain(); }
  }
  event(io: Io, e: Event): void { if (e.kind == EventKind.Transport) this.trAt = e.time; }
  process(io: Io, events: Events): void { this.trAt = 0; super.process(io, events); }

  render(io: Io, from: i32, to: i32): void {
    const tr = io.transport;
    const tempo = tr.tempo > 1 ? tr.tempo : 120.0;
    const perFrame = tempo / (60.0 * this.sr);
    for (let n = from; n < to; n++) {
      if (this.clockOn && tr.playing) {
        const beat = tr.beat + <f64>(n - this.trAt) * perFrame;
        if (this.clock.advance(beat, perFrame, tr.barStart, <i32>tr.num, <i32>tr.den)) {
          this.fired += 1;
          this.lastInBar = <f64>this.clock.inBar;
          this.lastIndex = <f64>this.clock.index;
          const key = 48 + <i32>(chance(this.clock.index, 0, 0, 1) * 24.0);
          const s = this.alloc.pick(false);
          if (s >= 0) {
            this.alloc.startInternal(io, s, key, 0.8, -1, n);
            this.drain();
            unchecked(this.voices[s]).left = this.clock.step * 0.5 / perFrame;
          }
        }
      }
      this.alloc.tick(io, n);
      this.drain();
      let sum = 0.0;
      for (let i = 0; i < MAX_VOICES; i++) {
        if (this.alloc.isIdle(i)) continue;
        const v = unchecked(this.voices[i]);
        if (this.alloc.isInternal(i) && this.alloc.isGated(i)) { v.left -= 1.0; if (v.left <= 0.0) { this.alloc.release(io, i); this.drain(); } }
        const g = v.env.next();
        if (!v.env.active) { this.alloc.finished(io, i, n); v.last = 0; v.click.clear(); continue; }
        const y = sinTurns(v.ph) * g * v.amp * this.alloc.gain(i);
        v.ph += v.dt; if (v.ph >= 1.0) v.ph -= 1.0;
        v.last = y;
        sum += y + v.click.next();
      }
      io.add(0, n, <f32>sum);
      io.add(1, n, <f32>sum);
      if (this.readLeft <= 0) { this.readLeft = 480; this.report(io, n); }
      this.readLeft--;
    }
  }

  report(io: Io, n: i32): void {
    let keys = 0;
    for (let i = 0; i < MAX_VOICES; i++) if (this.alloc.isGated(i)) keys += this.alloc.key(i);
    this.readout.push(io, R_ACTIVE, <f64>this.alloc.active(), n);
    this.readout.push(io, R_HELD, <f64>this.alloc.held(), n);
    this.readout.push(io, R_KEYSUM, <f64>keys, n);
    this.readout.push(io, R_WAITING, <f64>this.alloc.waiting(), n);
    this.readout.push(io, R_FIRED, this.fired, n);
    this.readout.push(io, R_INBAR, this.lastInBar, n);
    this.readout.push(io, R_INDEX, this.lastIndex, n);
  }

  tail(): u32 {
    // The release to the envelope's end level (−80 dB), then the steal fade: they follow one another.
    return this.tailCalc.clear().then(t60To(this.release, 80)).then(this.fadeMs * 0.001).frames(this.sr, 30);
  }
}

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
