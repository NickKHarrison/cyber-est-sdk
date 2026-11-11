/**
 * EST Phase 3 (1.283, stream 3-A): an EST instrument's notes as CLAP sees them. The Synth wrapper,
 * the transport, the arpeggiator, MIDI FX, MIDI and the computer keys all speak the instruments'
 * one message set (`noteOn`, `noteOff`, `noteExpr`, `control`, `cancelFrom`, `clearQueue`,
 * `allNotesOff`, `panic`, `param`: synth.ts, input.ts, transport.ts), which names a note by its
 * pitch; CLAP names each note by an id (`note_id`). This turns the one into the other, pure (no
 * Web Audio, no store), for the live instrument and the offline render alike:
 *
 * - **Ids.** Every note-on gets a new id (0, 1, 2 … per instance: an offline render's are the same
 *   every time, so it renders bit-identically). Its note-off is matched to it: for a note played by
 *   hand (`keys`, `screen`, `midi`: `live`), the one open note of that pitch (a second note-on of the
 *   pitch first releases the first, as every Cyber engine plays one voice per pitch); for a timed
 *   note (the transport, the arpeggiator, an echo, an audition: posted on and off together), the
 *   earliest of that pitch still open, else the one sounding then, whose end moves earlier (Back to
 *   Arrangement's cut). So a loop's wrap, where a note's end and the next pass's start meet, never
 *   doubles or strands a note: each pass's note is its own id.
 * - **`cancelFrom(when)`** (a Session launch re-planned, a follow action, a stop of a clip): the
 *   processor drops every queued note event at or after `when` (`cancelNotes`); here, the timed notes
 *   that would start then are forgotten and the ones sounding then are given a note-off at `when`.
 *   Notes played by hand are not touched.
 * - **Stop** (`clearQueue` then `allNotesOff`): every queued note event dropped (`clearNotes`), then a
 *   note-off now for every note not yet ended, so each rings out its release (`clap.tail`).
 * - **Panic**: every queued note event dropped, a choke for every note (and a wildcard one), silence.
 * - **Expressions** (MPE, poly aftertouch, a bench layer's fine tune): `noteExpr` on the newest
 *   note of that pitch as CLAP `NOTE_EXPRESSION`s on its id: bend as tuning (semitones), pressure,
 *   slide (CC 74) as brightness. **Controls** (`control`: the wheel, bend, sustain, channel pressure,
 *   any other CC) as CLAP `MIDI` events on channel 1, for a plugin that reads MIDI.
 */
import type { EstEvent } from './EstNode';

/** Who played a note: by hand (one open note per pitch) or timed (on and off posted together). */
export type EstNoteGroup = 'live' | 'timed';
const LIVE_SOURCES = new Set(['keys', 'screen', 'midi']);

interface HeldNote {
  id: number;
  key: number;
  group: EstNoteGroup;
  /** Context seconds it starts. */
  on: number;
  /** Context seconds its note-off is posted for; null while open (a key held). */
  off: number | null;
}

/** A message as the Synth wrapper posts it (synth.ts). */
export interface InstrumentMessage {
  type?: string;
  note?: number;
  velocity?: number;
  when?: number;
  src?: string;
  bend?: number;
  pressure?: number;
  slide?: number;
  modWheel?: number;
  pitchBend?: number;
  sustain?: boolean;
  cc?: { num: number; value: number };
}

/** What a message asks of the processor besides its events. */
export interface NoteActions {
  events: EstEvent[];
  /** Drop the queued note events at or after this context time (s) first. */
  cancelFrom?: number;
  /** Drop every queued note event first. */
  clear?: boolean;
}

const clampKey = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : -1);
/** A time the processor reads (0: at once). */
const at = (when: number | undefined) => (typeof when === 'number' && Number.isFinite(when) && when > 0 ? when : 0);
const u7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

export class EstNoteMap {
  private nextId = 0;
  private notes: HeldNote[] = [];

  /** `now`: the context's time (s); `sampleRate`: so times compare as the processor's frames do. */
  constructor(private readonly now: () => number, private readonly sampleRate = 48000) {}

  private frame(t: number) { return Math.round(t * this.sampleRate); }
  private t(when: number | undefined) { const w = at(when); return w > 0 ? w : this.now(); }

  /** The notes still tracked (tests, the voice count). */
  held(): readonly Readonly<HeldNote>[] { return this.notes; }

  /** Notes sounding at context time `t` (from their start to their note-off). */
  sounding(t = this.now()): number {
    let n = 0;
    for (const x of this.notes) if (x.on <= t + 1e-9 && (x.off === null || x.off > t)) n++;
    return n;
  }

  /** Forget notes whose note-off is well past (the map stays small). */
  private prune() {
    const t = this.now() - 1;
    if (this.notes.length < 64) return;
    this.notes = this.notes.filter(x => x.off === null || x.off >= t);
  }

  noteOn(key: number, velocity: number, when: number | undefined, src: string | undefined): EstEvent[] {
    const k = clampKey(key);
    if (k < 0 || k > 127) return [];
    this.prune();
    const group: EstNoteGroup = src && LIVE_SOURCES.has(src) ? 'live' : 'timed';
    const on = this.t(when);
    const out: EstEvent[] = [];
    if (group === 'live') {
      // One open note per pitch played by hand: a second press of the pitch (another source) restarts it.
      for (const x of this.notes) {
        if (x.group !== 'live' || x.key !== k || x.off !== null) continue;
        x.off = on;
        out.push({ type: 'noteOff', key: k, noteId: x.id, channel: 0, port: 0, velocity: 0, time: at(when) });
      }
    }
    const id = this.nextId++;
    // CLAP's note ids are int32; the counter wraps long before (2^31 notes).
    if (this.nextId >= 0x7fffffff) this.nextId = 0;
    this.notes.push({ id, key: k, group, on, off: null });
    out.push({ type: 'noteOn', key: k, noteId: id, channel: 0, port: 0, velocity: Math.max(0, Math.min(1, (velocity || 0) / 127)), time: at(when) });
    return out;
  }

  noteOff(key: number, when: number | undefined, src: string | undefined): EstEvent[] {
    const k = clampKey(key);
    if (k < 0 || k > 127) return [];
    const group: EstNoteGroup = src && LIVE_SOURCES.has(src) ? 'live' : 'timed';
    const off = this.t(when);
    const time = at(when);
    const end = (x: HeldNote): EstEvent[] => { x.off = Math.max(off, x.on); return [{ type: 'noteOff', key: k, noteId: x.id, channel: 0, port: 0, velocity: 0, time: time > 0 ? Math.max(time, x.on) : 0 }]; };
    const mine = this.notes.filter(x => x.key === k && x.group === group);
    if (group === 'live') {
      const open = mine.find(x => x.off === null);
      return open ? end(open) : [];
    }
    const f = this.frame(off);
    // The earliest open note of the pitch that has started by then (its pair), else any open one.
    const open = mine.find(x => x.off === null && this.frame(x.on) <= f) ?? mine.find(x => x.off === null);
    if (open) return end(open);
    // A note sounding then, posted to end later: its end moves earlier (the later note-off finds no note).
    let sounding: HeldNote | null = null;
    for (const x of mine) if (this.frame(x.on) <= f && x.off !== null && this.frame(x.off) > f && (!sounding || x.on > sounding.on)) sounding = x;
    return sounding ? end(sounding) : [];
  }

  /** One note's expression (`noteExpr`): on the newest note of the pitch sounding (played by hand first). */
  expression(key: number, m: InstrumentMessage): EstEvent[] {
    const k = clampKey(key);
    const now = this.now();
    let target: HeldNote | null = null;
    for (const x of this.notes) {
      if (x.key !== k || (x.off !== null && x.off <= now)) continue;
      if (!target || (x.group === 'live' && target.group !== 'live') || (x.group === target.group && x.on >= target.on)) target = x;
    }
    if (!target) return [];
    const base = { noteId: target.id, key: k, channel: 0, port: 0, time: at(m.when) } as const;
    const out: EstEvent[] = [];
    if (typeof m.bend === 'number' && Number.isFinite(m.bend)) out.push({ type: 'expression', expression: 'tuning', value: Math.max(-120, Math.min(120, m.bend)), ...base });
    if (typeof m.pressure === 'number' && Number.isFinite(m.pressure)) out.push({ type: 'expression', expression: 'pressure', value: Math.max(0, Math.min(1, m.pressure)), ...base });
    if (typeof m.slide === 'number' && Number.isFinite(m.slide)) out.push({ type: 'expression', expression: 'brightness', value: Math.max(0, Math.min(1, m.slide)), ...base });
    return out;
  }

  /** A controller's message (`control`) as MIDI events on channel 1. */
  control(m: InstrumentMessage): EstEvent[] {
    const out: EstEvent[] = [];
    const time = at(m.when);
    if (typeof m.pitchBend === 'number' && Number.isFinite(m.pitchBend)) {
      const v = Math.max(0, Math.min(16383, Math.round((Math.max(-1, Math.min(1, m.pitchBend)) + 1) * 8192)));
      out.push({ type: 'midi', data: [0xe0, v & 0x7f, v >> 7], time });
    }
    if (typeof m.modWheel === 'number' && Number.isFinite(m.modWheel)) out.push({ type: 'midi', data: [0xb0, 1, u7(m.modWheel * 127)], time });
    if (typeof m.sustain === 'boolean') out.push({ type: 'midi', data: [0xb0, 64, m.sustain ? 127 : 0], time });
    if (typeof m.pressure === 'number' && Number.isFinite(m.pressure)) out.push({ type: 'midi', data: [0xd0, u7(m.pressure * 127), 0], time });
    if (m.cc && Number.isInteger(m.cc.num) && m.cc.num >= 0 && m.cc.num < 120) out.push({ type: 'midi', data: [0xb0, m.cc.num, u7(m.cc.value)], time });
    return out;
  }

  /** A Session launch re-planned from `when`: what was to start then does not; what sounds then ends there. */
  cancelFrom(when: number): NoteActions {
    if (!Number.isFinite(when)) return { events: [] };
    const f = this.frame(when);
    const events: EstEvent[] = [];
    const keep: HeldNote[] = [];
    for (const x of this.notes) {
      if (x.group === 'live') { keep.push(x); continue; }
      if (this.frame(x.on) >= f) continue;
      if (x.off === null || this.frame(x.off) >= f) {
        x.off = when;
        events.push({ type: 'noteOff', key: x.key, noteId: x.id, channel: 0, port: 0, velocity: 0, time: at(when) });
      }
      keep.push(x);
    }
    this.notes = keep;
    return { events, cancelFrom: when };
  }

  /** Stop: every note not yet ended released now (with its release); nothing queued starts. */
  allNotesOff(): EstEvent[] {
    const now = this.now();
    const events: EstEvent[] = [];
    for (const x of this.notes) {
      if (x.off !== null && x.off <= now) continue;
      events.push({ type: 'noteOff', key: x.key, noteId: x.id, channel: 0, port: 0, velocity: 0, time: 0 });
    }
    this.notes = [];
    return events;
  }

  /** Panic: every note choked at once (and a wildcard choke for any the plugin holds besides). */
  panic(): EstEvent[] {
    const events: EstEvent[] = [];
    for (const x of this.notes) if (x.off === null || x.off > this.now()) events.push({ type: 'choke', key: x.key, noteId: x.id, channel: 0, port: 0, time: 0 });
    events.push({ type: 'choke', key: -1, noteId: -1, channel: -1, port: -1, time: 0 });
    this.notes = [];
    return events;
  }

  /**
   * One message (synth.ts's set) as the processor's events, or null for a message that is not a
   * note's (the patch, the tempo, a parameter: the instrument handles those itself).
   */
  message(m: InstrumentMessage): NoteActions | null {
    switch (m.type) {
      case 'noteOn': return { events: this.noteOn(m.note ?? -1, m.velocity ?? 100, m.when, m.src) };
      case 'noteOff': return { events: this.noteOff(m.note ?? -1, m.when, m.src) };
      case 'noteExpr': return { events: this.expression(m.note ?? -1, m) };
      case 'control': return { events: this.control(m) };
      case 'cancelFrom': return typeof m.when === 'number' ? this.cancelFrom(m.when) : { events: [] };
      case 'clearQueue': return { events: [], clear: true };
      case 'allNotesOff': return { events: this.allNotesOff(), clear: true };
      case 'panic': return { events: this.panic(), clear: true };
      default: return null;
    }
  }
}
