// What a plugin writes and what `process` sees: the twin of the Rust crate's param.rs, io.rs,
// state.rs and plugin.rs (sdk/rust/est/src). The names are the Rust ones in camelCase; the
// differences AssemblyScript forces are listed at the top of ./index.ts.

import * as C from "./clap";
import { round } from "./math";

// --- Parameters ---------------------------------------------------------------------------------

/** How a value is worded. */
export enum Format {
  /** `decimals` decimals, then the unit ("-6.0 dB"). */
  Number = 0,
  /** A frequency: "440 Hz", "1.20 kHz" (text back takes "1.2k" and "1200"). */
  Hertz = 1,
}

/**
 * One parameter, in plain values, declared once with the builder:
 * `new Param(GAIN, "Gain").range(-60, 12).default(0).unit("dB").decimals(1)`.
 * The glue stores the values, clamps and steps what the host sends, words values as text and
 * calls the plugin's `paramChanged`.
 */
export class Param {
  modulePath: string = "";
  unitText: string = "";
  min: f64 = 0;
  max: f64 = 1;
  defaultValue: f64 = 0;
  decimalCount: i32 = 2;
  labelList: string[] = [];
  format: Format = Format.Number;
  flags: u32 = 0;
  /** Moves geometrically over its range (`log()`); est.json's `"scale": "log"` is what hosts read. */
  logScale: bool = false;
  /** The glue's C strings of the name and the module (written in `setup`). */
  cname: usize = 0;
  cmodule: usize = 0;

  constructor(public id: u32, public name: string) {}

  range(min: f64, max: f64): Param { this.min = min; this.max = max; return this; }
  default(v: f64): Param { this.defaultValue = v; return this; }
  unit(u: string): Param { this.unitText = u; return this; }
  decimals(n: i32): Param { this.decimalCount = n; return this; }
  module(m: string): Param { this.modulePath = m; return this; }
  /** A stepped parameter: one value per label, 0 to `labels.length - 1`. */
  labels(l: string[]): Param {
    this.labelList = l;
    this.min = 0;
    this.max = l.length > 0 ? <f64>(l.length - 1) : 0;
    this.decimalCount = 0;
    return this;
  }
  /** A frequency in Hz, worded "440 Hz" or "1.20 kHz". */
  hertz(): Param { this.format = Format.Hertz; this.unitText = "Hz"; return this; }
  /** The plugin's bypass switch (Off, On). */
  bypass(): Param { this.labels(["Off", "On"]); this.flags |= C.CLAP_PARAM_IS_BYPASS; return this; }
  /**
   * A logarithmic parameter (a frequency, a time, a Q): knobs, sliders and automation move
   * geometrically over its range. Needs a range above 0 and no labels, and `"scale": "log"` on the
   * parameter in est.json (the conformance run checks the range, EST-C021).
   */
  log(): Param { this.logScale = true; return this; }
  hidden(): Param { this.flags |= C.CLAP_PARAM_IS_HIDDEN; return this; }
  readOnly(): Param { this.flags |= C.CLAP_PARAM_IS_READONLY; return this; }

  stepped(): bool { return this.labelList.length > 0; }
  /** A value made valid: within the range, whole steps for a stepped parameter (NaN: the default). */
  clamp(v: f64): f64 {
    let x = isNaN(v) ? this.defaultValue : v;
    if (x < this.min) x = this.min;
    else if (x > this.max) x = this.max;
    return this.stepped() ? round(x) : x;
  }
}

/** The most parameters a plugin may declare. */
export const MAX_PARAMS = 512;

/** The plugin's identity (it must match est.json) and its state's marks. */
export class Descriptor {
  constructor(
    public id: string,
    public name: string,
    public vendor: string,
    public version: string,
    public description: string,
    /** The first is "audio-effect" or "instrument" (it decides the plugin's kind). */
    public features: string[],
    /** Four characters that mark this plugin's state. */
    public stateMagic: string,
    public stateVersion: u32 = 1,
  ) {}
  /** A note effect's (DEV-F, 1.321): a note input and a note output beside its audio (`noteEffect()`). */
  notePorts: bool = false;
  instrument(): bool { return this.features.length > 0 && this.features[0] == "instrument"; }
  /**
   * Make this effect a note effect: a note input (its `noteOn`, `noteOff` and `choke` are called)
   * and a note output (`io.sendNoteOn`, `io.sendNoteOff`). Its est.json says
   * `"notes": { "inputs": 1, "outputs": 1 }` and its features include "note-effect".
   */
  noteEffect(): Descriptor { this.notePorts = true; return this; }
}

// --- What process sees --------------------------------------------------------------------------

/** The host's transport, as of the sample being rendered. */
export class Transport {
  tempo: f64 = 120;
  playing: bool = false;
  /** The song position in beats (quarter notes). */
  beat: f64 = 0;
  /** The beat the current bar starts on. */
  barStart: f64 = 0;
  num: u16 = 4;
  den: u16 = 4;

  copyFrom(t: Transport): void {
    this.tempo = t.tempo; this.playing = t.playing; this.beat = t.beat; this.barStart = t.barStart; this.num = t.num; this.den = t.den;
  }
  /** Read a CLAP transport struct at `p` (0: the defaults). */
  read(p: usize): void {
    this.tempo = 120; this.playing = false; this.beat = 0; this.barStart = 0; this.num = 4; this.den = 4;
    if (p == 0) return;
    const flags = load<u32>(p, C.TRANSPORT_FLAGS);
    const tempo = load<f64>(p, C.TRANSPORT_TEMPO);
    if ((flags & C.CLAP_TRANSPORT_HAS_TEMPO) != 0 && tempo > 0) this.tempo = tempo;
    this.playing = (flags & C.CLAP_TRANSPORT_IS_PLAYING) != 0;
    if ((flags & C.CLAP_TRANSPORT_HAS_BEATS_TIMELINE) != 0) {
      this.beat = <f64>load<i64>(p, C.TRANSPORT_SONG_POS_BEATS) / BEATTIME_FACTOR;
      this.barStart = <f64>load<i64>(p, C.TRANSPORT_BAR_START) / BEATTIME_FACTOR;
    }
    const num = load<u16>(p, C.TRANSPORT_TSIG_NUM), den = load<u16>(p, C.TRANSPORT_TSIG_DENOM);
    if ((flags & C.CLAP_TRANSPORT_HAS_TIME_SIGNATURE) != 0 && num > 0 && den > 0) { this.num = num; this.den = den; }
  }
}

/** `clap_beattime` is fixed point: beats × 2³¹. */
const BEATTIME_FACTOR: f64 = 2147483648.0;

/** One note: `time` is its sample in the block; `noteId` -1 is none; `port`, `channel`, `key` -1 any. */
export class Note {
  time: i32 = 0;
  noteId: i32 = -1;
  port: i16 = -1;
  channel: i16 = -1;
  key: i16 = -1;
  velocity: f64 = 0;
  /** CLAP's matching: by note id when the event has one, else by port, channel and key (-1 any). */
  matches(id: i32, port: i16, channel: i16, key: i16): bool {
    if (this.noteId != -1) return id == this.noteId;
    return (this.port == -1 || this.port == port) && (this.channel == -1 || this.channel == channel) && (this.key == -1 || this.key == key);
  }
  copyFrom(n: Note): void {
    this.time = n.time; this.noteId = n.noteId; this.port = n.port; this.channel = n.channel; this.key = n.key; this.velocity = n.velocity;
  }
}

/** A note expression (`CLAP_NOTE_EXPRESSION_*` in `id`) on the notes `note` names. */
export class Expression {
  id: i32 = 0;
  note: Note = new Note();
  value: f64 = 0;
}

/** What an `Event` is. */
export enum EventKind { Param = 0, NoteOn = 1, NoteOff = 2, Choke = 3, Expression = 4, Midi = 5, Transport = 6, Other = 7 }

/** One event of the block, decoded into a reused object (valid until the next `events.get`). */
export class Event {
  kind: EventKind = EventKind.Other;
  /** The sample in the block it applies from. */
  time: i32 = 0;
  /** A parameter's id (`Param`) or an expression's (`Expression`). */
  id: u32 = 0;
  /** A parameter's value (as sent: the glue clamps it before storing) or an expression's. */
  value: f64 = 0;
  note: Note = new Note();
  /** A MIDI 1.0 message (`Midi`) and its note port. */
  midi: StaticArray<u8> = new StaticArray<u8>(3);
  port: u16 = 0;
  /** The transport from this sample on (`Transport`). */
  transport: Transport = new Transport();

  isParam(id: u32): bool { return this.kind == EventKind.Param && this.id == id; }

  decode(h: usize, frames: i32): void {
    this.kind = EventKind.Other;
    this.id = 0;
    this.value = 0;
    this.time = 0;
    if (h == 0) return;
    const t = load<u32>(h, C.HEADER_TIME);
    this.time = t < <u32>frames ? <i32>t : frames;
    if (load<u16>(h, C.HEADER_SPACE_ID) != C.CLAP_CORE_EVENT_SPACE_ID) return;
    const size = load<u32>(h, C.HEADER_SIZE);
    const type = load<u16>(h, C.HEADER_TYPE);
    const n = this.note;
    if (type == C.CLAP_EVENT_PARAM_VALUE && size >= <u32>C.PARAM_VALUE_SIZE) {
      this.kind = EventKind.Param;
      this.id = load<u32>(h, C.PARAM_VALUE_PARAM_ID);
      this.value = load<f64>(h, C.PARAM_VALUE_VALUE);
    } else if ((type == C.CLAP_EVENT_NOTE_ON || type == C.CLAP_EVENT_NOTE_OFF || type == C.CLAP_EVENT_NOTE_CHOKE) && size >= <u32>C.NOTE_SIZE) {
      this.kind = type == C.CLAP_EVENT_NOTE_ON ? EventKind.NoteOn : type == C.CLAP_EVENT_NOTE_OFF ? EventKind.NoteOff : EventKind.Choke;
      n.time = this.time;
      n.noteId = load<i32>(h, C.NOTE_NOTE_ID);
      n.port = load<i16>(h, C.NOTE_PORT_INDEX);
      n.channel = load<i16>(h, C.NOTE_CHANNEL);
      n.key = load<i16>(h, C.NOTE_KEY);
      n.velocity = load<f64>(h, C.NOTE_VELOCITY);
    } else if (type == C.CLAP_EVENT_NOTE_EXPRESSION && size >= <u32>C.EXPRESSION_SIZE) {
      this.kind = EventKind.Expression;
      this.id = <u32>load<i32>(h, C.EXPRESSION_EXPRESSION_ID);
      this.value = load<f64>(h, C.EXPRESSION_VALUE);
      n.time = this.time;
      n.noteId = load<i32>(h, C.EXPRESSION_NOTE_ID);
      n.port = load<i16>(h, C.EXPRESSION_PORT_INDEX);
      n.channel = load<i16>(h, C.EXPRESSION_CHANNEL);
      n.key = load<i16>(h, C.EXPRESSION_KEY);
      n.velocity = 0;
    } else if (type == C.CLAP_EVENT_MIDI && size >= <u32>C.MIDI_SIZE) {
      this.kind = EventKind.Midi;
      this.port = load<u16>(h, C.MIDI_PORT_INDEX);
      this.midi[0] = load<u8>(h, C.MIDI_DATA);
      this.midi[1] = load<u8>(h, C.MIDI_DATA + 1);
      this.midi[2] = load<u8>(h, C.MIDI_DATA + 2);
    } else if (type == C.CLAP_EVENT_TRANSPORT && size >= <u32>C.TRANSPORT_SIZE) {
      this.kind = EventKind.Transport;
      this.transport.read(h);
    }
  }
}

/** The block's events, in time order. `get(k)` decodes event `k` into one reused `Event`. */
export class Events {
  list: usize = 0;
  count: i32 = 0;
  frames: i32 = 0;
  current: Event = new Event();
  /** The expression the default `process` hands `noteExpression` (reused). */
  expression: Expression = new Expression();

  len(): i32 { return this.count; }
  isEmpty(): bool { return this.count == 0; }
  get(k: i32): Event {
    const e = this.current;
    if (k < 0 || k >= this.count) { e.decode(0, this.frames); return e; }
    e.decode(call_indirect<usize>(load<u32>(this.list, C.INPUT_EVENTS_GET), this.list, <u32>k), this.frames);
    return e;
  }
  /** (The glue's) point at the host's list for a block of `frames`. */
  reset(list: usize, frames: i32): void {
    this.list = list;
    this.frames = frames;
    this.count = list == 0 ? 0 : <i32>call_indirect<u32>(load<u32>(list, C.INPUT_EVENTS_SIZE), list);
  }
}

/**
 * The audio of one block, the parameters' values and the way back to the host (`noteEnd`). For
 * an effect, `input` reads the block's input; for an instrument there is none (it reads 0) and
 * the outputs start the block at zero.
 */
export class Io {
  inL: usize = 0;
  inR: usize = 0;
  outL: usize = 0;
  outR: usize = 0;
  /** Channels processed (1 or 2). */
  channels: i32 = 0;
  frames: i32 = 0;
  transport: Transport = new Transport();
  values: StaticArray<f64> = new StaticArray<f64>(0);
  params: Param[] = [];
  outEvents: usize = 0;
  ev: usize = 0;

  /** Input sample `n` of channel `c` (0 outside the block, and for an instrument). */
  @inline input(c: i32, n: i32): f32 {
    if (n < 0 || n >= this.frames || c < 0 || c >= this.channels) return 0;
    const p = c == 0 ? this.inL : this.inR;
    return p == 0 ? 0 : load<f32>(p + (<usize>n << 2));
  }
  /** Write output sample `n` of channel `c` (ignored outside the block). */
  @inline output(c: i32, n: i32, v: f32): void {
    if (n < 0 || n >= this.frames || c < 0 || c >= this.channels) return;
    const p = c == 0 ? this.outL : this.outR;
    if (p != 0) store<f32>(p + (<usize>n << 2), v);
  }
  /** Add `v` to output sample `n` of channel `c` (an instrument's voices mix this way). */
  @inline add(c: i32, n: i32, v: f32): void {
    if (n < 0 || n >= this.frames || c < 0 || c >= this.channels) return;
    const base = c == 0 ? this.outL : this.outR;
    if (base == 0) return;
    const p = base + (<usize>n << 2);
    store<f32>(p, load<f32>(p) + v);
  }

  indexOf(id: u32): i32 {
    const ps = this.params;
    for (let i = 0; i < ps.length; i++) if (ps[i].id == id) return i;
    return -1;
  }
  /** The current value of parameter `id` (clamped; 0 for an unknown id). */
  param(id: u32): f64 {
    const i = this.indexOf(id);
    return i < 0 || i >= this.values.length ? 0 : this.values[i];
  }
  /** (The glue's) store a value for parameter `id`, clamped: true when the id is known; the value is `lastSet`. */
  setParam(id: u32, v: f64): bool {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.lastSet = this.params[i].clamp(v);
    if (i < this.values.length) this.values[i] = this.lastSet;
    return true;
  }
  lastSet: f64 = 0;

  /** Tell the host the note (`id`, `port`, `channel`, `key`) stopped sounding at sample `n`. */
  noteEnd(id: i32, port: i16, channel: i16, key: i16, n: i32): void { this.pushNote(C.CLAP_EVENT_NOTE_END, id, port, channel, key, 0, n); }

  /**
   * A note effect's output (DEV-F, 1.321; `Descriptor.noteEffect()`): start note `key` at sample
   * `n` on the plugin's note output (port 0). Every note it starts it must also end (`sendNoteOff`).
   */
  sendNoteOn(id: i32, channel: i16, key: i16, velocity: f64, n: i32): void { this.pushNote(C.CLAP_EVENT_NOTE_ON, id, 0, channel, key, velocity, n); }
  /** A note effect's output: release note `key` (or `id`) at sample `n`. */
  sendNoteOff(id: i32, channel: i16, key: i16, velocity: f64, n: i32): void { this.pushNote(C.CLAP_EVENT_NOTE_OFF, id, 0, channel, key, velocity, n); }

  pushNote(type: u16, id: i32, port: i16, channel: i16, key: i16, velocity: f64, n: i32): void {
    if (this.outEvents == 0 || this.ev == 0) return;
    const e = this.ev;
    memory.fill(e, 0, C.NOTE_SIZE);
    store<u32>(e, <u32>C.NOTE_SIZE, C.HEADER_SIZE);
    store<u32>(e, <u32>(n < 0 ? 0 : n >= this.frames ? (this.frames > 0 ? this.frames - 1 : 0) : n), C.HEADER_TIME);
    store<u16>(e, C.CLAP_CORE_EVENT_SPACE_ID, C.HEADER_SPACE_ID);
    store<u16>(e, type, C.HEADER_TYPE);
    store<i32>(e, id, C.NOTE_NOTE_ID);
    store<i16>(e, port, C.NOTE_PORT_INDEX);
    store<i16>(e, channel, C.NOTE_CHANNEL);
    store<i16>(e, key, C.NOTE_KEY);
    store<f64>(e, velocity, C.NOTE_VELOCITY);
    call_indirect<bool>(load<u32>(this.outEvents, C.OUTPUT_EVENTS_TRY_PUSH), this.outEvents, e);
  }
}

/** An Io with no audio and no host (a plugin's own tests, and probes): reads 0, writes nothing. */
export function detachedIo(frames: i32): Io {
  const io = new Io();
  io.frames = frames;
  return io;
}

// --- The state ----------------------------------------------------------------------------------

/** Writes the state stream (little-endian), remembering whether every write landed. */
export class StateWriter {
  ok: bool = true;
  constructor(public stream: usize, public scratch: usize) {}
  bytes(src: usize, n: i32): void {
    let done: i64 = 0;
    while (this.ok && done < <i64>n) {
      const w = call_indirect<i64>(load<u32>(this.stream, C.OSTREAM_WRITE), this.stream, src + <usize>done, <u64>(<i64>n - done));
      if (w <= 0) this.ok = false; else done += w;
    }
  }
  u32(v: u32): void { store<u32>(this.scratch, v); this.bytes(this.scratch, 4); }
  f32(v: f32): void { store<f32>(this.scratch, v); this.bytes(this.scratch, 4); }
  f64(v: f64): void { store<f64>(this.scratch, v); this.bytes(this.scratch, 8); }
}

/** Reads the state stream; `ok` turns false at the first short read. */
export class StateReader {
  ok: bool = true;
  constructor(public stream: usize, public scratch: usize) {}
  bytes(dst: usize, n: i32): void {
    let done: i64 = 0;
    while (this.ok && done < <i64>n) {
      const r = call_indirect<i64>(load<u32>(this.stream, C.ISTREAM_READ), this.stream, dst + <usize>done, <u64>(<i64>n - done));
      if (r <= 0) this.ok = false; else done += r;
    }
  }
  u32(): u32 { store<u64>(this.scratch, 0); this.bytes(this.scratch, 4); return load<u32>(this.scratch); }
  f32(): f32 { store<u64>(this.scratch, 0); this.bytes(this.scratch, 4); return load<f32>(this.scratch); }
  f64(): f64 { store<u64>(this.scratch, 0); this.bytes(this.scratch, 8); return load<f64>(this.scratch); }
}

// --- The plugin ---------------------------------------------------------------------------------

/**
 * Every hook a plugin may have (the Rust traits' methods). Extend `Effect` or `Instrument`, not
 * this. `render` is the one a plugin must write; the default `process` splits each block at its
 * events, calls `render` between them and applies each event at its sample: a parameter
 * (stored, then `paramChanged`), the transport (`io.transport`), and an instrument's notes.
 */
export abstract class Plugin {
  activate(sampleRate: f64, maxFrames: u32): bool { return true; }
  deactivate(): void {}
  /** Clear delay lines, filters and smoothers, or silence every voice. */
  reset(): void {}
  /** A parameter's new value (also each default at creation, possibly before `activate`, and each value a state load brings). */
  paramChanged(id: u32, value: f64): void {}
  process(io: Io, events: Events): void { split(this, io, events); }
  /** Frames `from`…`to` of the block. */
  abstract render(io: Io, from: i32, to: i32): void;
  /** Any event, after the glue has applied it. */
  event(io: Io, e: Event): void {}
  noteOn(io: Io, note: Note): void {}
  noteOff(io: Io, note: Note): void {}
  choke(io: Io, note: Note): void {}
  noteExpression(io: Io, e: Expression): void {}
  /** A MIDI 1.0 message (status, two data bytes) on note port `port`. */
  midi(io: Io, port: u16, data: StaticArray<u8>): void {}
  latency(): u32 { return 0; }
  tail(): u32 { return 0; }
  /** The plugin's own bytes after the parameters (the glue saves those). */
  saveState(w: StateWriter): void {}
  loadState(r: StateReader, version: u32): bool { return true; }
  setOffline(offline: bool): void {}
}

/** An EST effect (its Descriptor's first feature is "audio-effect"). */
export abstract class Effect extends Plugin {}

/**
 * An EST instrument (its Descriptor's first feature is "instrument"): notes arrive at their
 * sample through `noteOn`, `noteOff`, `choke`, `noteExpression` and `midi`. Every note it
 * starts must end with `io.noteEnd` when it stops sounding (`Voices` does it).
 */
export abstract class Instrument extends Plugin {}

/** The default `process`: `render` between events, each event at its sample. */
export function split(p: Plugin, io: Io, events: Events): void {
  const n = events.len();
  let at = 0;
  for (let k = 0; k <= n; k++) {
    let until = io.frames;
    let e: Event | null = null;
    if (k < n) { e = events.get(k); until = e.time; }
    if (until > at) {
      p.render(io, at, until);
      at = until;
    }
    if (e) {
      if (e.kind == EventKind.Param) {
        if (io.setParam(e.id, e.value)) p.paramChanged(e.id, io.lastSet);
      } else if (e.kind == EventKind.Transport) {
        io.transport.copyFrom(e.transport);
      } else if (e.kind == EventKind.NoteOn) p.noteOn(io, e.note);
      else if (e.kind == EventKind.NoteOff) p.noteOff(io, e.note);
      else if (e.kind == EventKind.Choke) p.choke(io, e.note);
      else if (e.kind == EventKind.Expression) {
        const x = events.expression;
        x.id = <i32>e.id;
        x.value = e.value;
        x.note.copyFrom(e.note);
        p.noteExpression(io, x);
      } else if (e.kind == EventKind.Midi) p.midi(io, e.port, e.midi);
      p.event(io, e);
    }
  }
}
