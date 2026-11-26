// The voice allocator: which voice a note takes, and the bookkeeping the reviews kept finding wrong
// by hand. It holds no sound: the plugin keeps its own voice objects in a parallel array and does
// what the allocator's events say (`next()`: START, RELEASE, STOP), multiplying a voice by `gain(s)`
// while a steal fades it out. The rules it exists for:
//
// - **Steal policy.** An idle voice first; else a released one, then one the pedal holds, then a
//   generated (internal) note, then a played note, the oldest (or the quietest, `STEAL_QUIETEST`)
//   in each. A voice already fading for a waiting note is never taken while another can be (review
//   2 D2-14: the 18th note stole the 17th's voice, so the 17th never sounded). `oldest.ts`'s
//   `OldestVoiceAllocator` (1.666) is the SDK library's `Voices` rule instead, the oldest note
//   whatever its state, for a plugin moved from that library with its sound kept to the sample.
// - **A click-free steal with the waiting note.** With a fade (`setFade`), a stolen voice fades out
//   linearly while the new note waits in its slot, then starts. A key let go during the fade marks
//   the waiting note released, **once** (a set, never a toggle: review n572 D-18, review 2 D2-09),
//   and it starts released (or pedal-held) when the fade ends (review n572 D-01: it started gated
//   and sustained for ever). With no fade the new note starts at once and the plugin declicks the
//   old voice's last sample (`Declick`).
// - **The pedal.** A key let go while the pedal is down holds its voice until the pedal goes up.
// - **Choke groups.** A note in a group ends every other note of its group (review n572 D-17).
// - **NOTE_END always.** Every played note gets exactly one NOTE_END: when its voice finishes
//   (`finished`), is stolen, is choked or is choked by its group, and when a waiting note is dropped
//   before it ever sounded (review 2 D2-04, D2-14). Generated notes (`startInternal`) get none.
// - **Counts are computed, never kept** (`held()`, `active()`): a counter cannot leak (D2-14).
//
// Drain the events after every call that can make them (`noteOn`, `startOwned`, `startInternal`,
// `noteOff`, `release`, `choke`, `chokeGroup`, `pedal`, `tick`): the queue holds 4 events a voice.

import { Io, Note } from "est";

export const SLOT_IDLE: i32 = 0;
/** Its key is down (or, generated, its length not yet over). */
export const SLOT_HELD: i32 = 1;
/** Its key is up and the pedal holds it. */
export const SLOT_PEDAL: i32 = 2;
/** Released: sounding out its release. */
export const SLOT_RELEASED: i32 = 3;
/** Fading out: when the fade ends its waiting note starts (or, choked, it stops). */
export const SLOT_STEAL: i32 = 4;

/** Start the slot's note now (`key`, `velocity`, `isInternal`); from here its `gain` is 1. */
export const VOICE_START: i32 = 1;
/** Release the slot's envelope. */
export const VOICE_RELEASE: i32 = 2;
/** Silence the slot (a choke, or a choke's fade ended). */
export const VOICE_STOP: i32 = 3;

/** Released before pedal-held before generated before played, the oldest first in each. */
export const STEAL_OLDEST: i32 = 0;
/** As `STEAL_OLDEST`, the quietest first in each (`setLevel`), then the oldest. */
export const STEAL_QUIETEST: i32 = 1;
/** Never steal: a note with no idle voice is not played (its NOTE_END is sent at once). */
export const STEAL_NONE: i32 = 2;

export class Slot {
  state: i32 = SLOT_IDLE;
  key: i32 = 60;
  velocity: f64 = 0;
  group: i32 = -1;
  age: i64 = 0;
  owned: bool = false;
  internal: bool = false;
  noteId: i32 = -1;
  port: i16 = 0;
  channel: i16 = 0;
  inKey: i16 = 60;
  level: f64 = 0;
  fadeLeft: i32 = 0;
  // The waiting note (a steal's fade in progress).
  waiting: bool = false;
  wOwned: bool = false;
  wInternal: bool = false;
  wKey: i32 = 60;
  wVelocity: f64 = 0;
  wGroup: i32 = -1;
  wNoteId: i32 = -1;
  wPort: i16 = 0;
  wChannel: i16 = 0;
  wInKey: i16 = 60;
  wReleased: bool = false;
}

/** CLAP's matching, both ways: a field of the event's that is -1 matches anything. */
// @ts-ignore: decorator
@inline function matches(n: Note, id: i32, port: i16, channel: i16, key: i16): bool {
  return (n.noteId < 0 || n.noteId == id) && (n.port < 0 || n.port == port) && (n.channel < 0 || n.channel == channel) && (n.key < 0 || n.key == key);
}

export class VoiceAllocator {
  slots: StaticArray<Slot>;
  policy: i32 = STEAL_OLDEST;
  /** The steal fade's length in frames (0: a stolen voice restarts at once). */
  fadeFrames: i32 = 0;
  pedalDown: bool = false;
  private ages: i64 = 0;
  private fading: i32 = 0;
  private q: StaticArray<i32>;
  private qHead: i32 = 0;
  private qLen: i32 = 0;

  constructor(count: i32) {
    this.slots = new StaticArray<Slot>(count);
    this.q = new StaticArray<i32>(count * 4 + 8);
    for (let i = 0; i < count; i++) unchecked(this.slots[i] = new Slot());
  }

  get count(): i32 { return this.slots.length; }

  /** The steal fade: `seconds` long (0: none). */
  setFade(seconds: f64, sampleRate: f64): void {
    const f = <i32>(seconds * sampleRate + 0.5);
    this.fadeFrames = f < 0 ? 0 : f;
  }

  /** Every voice idle, nothing waiting, no NOTE_END (activate, reset). */
  reset(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      v.state = SLOT_IDLE; v.owned = false; v.internal = false; v.waiting = false; v.fadeLeft = 0; v.level = 0; v.group = -1;
    }
    this.pedalDown = false;
    this.fading = 0;
    this.qHead = 0;
    this.qLen = 0;
  }

  // --- The events ---------------------------------------------------------------------------------

  private push(kind: i32, s: i32): void {
    const cap = this.q.length;
    if (this.qLen >= cap) { this.qHead = (this.qHead + 1) % cap; this.qLen--; } // never: drained after each call
    unchecked(this.q[(this.qHead + this.qLen) % cap] = (kind << 16) | s);
    this.qLen++;
  }
  /** The next event (`eventKind`, `eventSlot`), or -1. */
  next(): i32 {
    if (this.qLen == 0) return -1;
    const e = unchecked(this.q[this.qHead]);
    this.qHead = (this.qHead + 1) % this.q.length;
    this.qLen--;
    return e;
  }

  // --- Reading a slot ------------------------------------------------------------------------------

  state(s: i32): i32 { return unchecked(this.slots[s]).state; }
  key(s: i32): i32 { return unchecked(this.slots[s]).key; }
  velocity(s: i32): f64 { return unchecked(this.slots[s]).velocity; }
  group(s: i32): i32 { return unchecked(this.slots[s]).group; }
  isIdle(s: i32): bool { return unchecked(this.slots[s]).state == SLOT_IDLE; }
  /** Its key is down (or, generated, its length is not over). */
  isGated(s: i32): bool { return unchecked(this.slots[s]).state == SLOT_HELD; }
  isOwned(s: i32): bool { return unchecked(this.slots[s]).owned; }
  isInternal(s: i32): bool { return unchecked(this.slots[s]).internal; }
  /** The steal (or choke) fade's gain on the slot's sound: 1, or falling to 0 while it fades. */
  gain(s: i32): f64 {
    const v = unchecked(this.slots[s]);
    if (v.state != SLOT_STEAL || this.fadeFrames <= 0) return 1.0;
    return <f64>v.fadeLeft / <f64>this.fadeFrames;
  }
  /** The slot's loudness now, for `STEAL_QUIETEST`. */
  setLevel(s: i32, level: f64): void { unchecked(this.slots[s]).level = level; }

  /** Voices whose key is down (played and generated): counted, never kept. */
  held(): i32 { let c = 0; for (let i = 0; i < this.slots.length; i++) if (unchecked(this.slots[i]).state == SLOT_HELD) c++; return c; }
  /** Voices sounding or fading. */
  active(): i32 { let c = 0; for (let i = 0; i < this.slots.length; i++) if (unchecked(this.slots[i]).state != SLOT_IDLE) c++; return c; }
  /** Notes waiting for a steal's fade. */
  waiting(): i32 { let c = 0; for (let i = 0; i < this.slots.length; i++) if (unchecked(this.slots[i]).waiting) c++; return c; }

  // --- Choosing ------------------------------------------------------------------------------------

  /**
   * The voice a new note takes, or -1: an idle one, else by the policy. `protectPlayed`: never a
   * played note's held voice (a generated note may not take one).
   */
  pick(protectPlayed: bool = false): i32 {
    const n = this.slots.length;
    for (let i = 0; i < n; i++) if (unchecked(this.slots[i]).state == SLOT_IDLE) return i;
    if (this.policy == STEAL_NONE) return -1;
    let best = this.best(protectPlayed, false);
    if (best < 0) best = this.best(protectPlayed, true);
    return best;
  }

  private best(protectPlayed: bool, takeWaiting: bool): i32 {
    let best = -1;
    let bestClass = 99;
    let bestLevel: f64 = 0;
    let bestAge: i64 = 0;
    const quiet = this.policy == STEAL_QUIETEST;
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      let c: i32;
      if (v.state == SLOT_STEAL) {
        if (v.waiting) { if (!takeWaiting) continue; c = 5; } else c = -1; // a choke's fade: already going
      } else if (v.state == SLOT_RELEASED) c = 0;
      else if (v.state == SLOT_PEDAL) c = 1;
      else if (v.internal) c = 2;
      else { if (protectPlayed) continue; c = 3; }
      if (best >= 0) {
        if (c > bestClass) continue;
        if (c == bestClass) {
          if (quiet && v.level > bestLevel) continue;
          if ((!quiet || v.level == bestLevel) && v.age >= bestAge) continue;
        }
      }
      best = i; bestClass = c; bestLevel = v.level; bestAge = v.age;
    }
    return best;
  }

  // --- Starting -----------------------------------------------------------------------------------

  /** A played note: choke its group, take a voice and start it (or make it wait). The slot, or -1 (its NOTE_END sent). */
  noteOn(io: Io, note: Note, group: i32 = -1): i32 {
    if (group >= 0) this.chokeGroup(io, group, note.time);
    const s = this.pick(false);
    if (s < 0) { io.noteEnd(note.noteId, note.port, note.channel, note.key, note.time); return -1; }
    this.startOwned(io, s, note, group);
    return s;
  }

  /** Start played note `note` on slot `s` (from `pick`). */
  startOwned(io: Io, s: i32, note: Note, group: i32 = -1): void {
    this.begin(io, s, true, <i32>note.key, note.velocity, group, note.noteId, note.port, note.channel, note.key, note.time);
  }

  /** Start a generated note (no NOTE_END: the host never sent it) on slot `s`. */
  startInternal(io: Io, s: i32, key: i32, velocity: f64, group: i32 = -1, time: i32 = 0): void {
    this.begin(io, s, false, key, velocity, group, -1, 0, 0, <i16>key, time);
  }

  private begin(io: Io, s: i32, owned: bool, key: i32, vel: f64, group: i32, id: i32, port: i16, channel: i16, inKey: i16, time: i32): void {
    const v = unchecked(this.slots[s]);
    if (v.state != SLOT_IDLE) {
      // The note that had this voice ends now (a waiting one that never sounded too).
      if (v.state == SLOT_STEAL && v.waiting) {
        if (v.wOwned) io.noteEnd(v.wNoteId, v.wPort, v.wChannel, v.wInKey, time);
        v.waiting = false;
      } else if (v.owned) io.noteEnd(v.noteId, v.port, v.channel, v.inKey, time);
      v.owned = false;
      if (this.fadeFrames > 0) {
        if (v.state != SLOT_STEAL) { v.state = SLOT_STEAL; v.fadeLeft = this.fadeFrames; this.fading++; }
        v.waiting = true; v.wOwned = owned; v.wInternal = !owned; v.wKey = key; v.wVelocity = vel; v.wGroup = group;
        v.wNoteId = id; v.wPort = port; v.wChannel = channel; v.wInKey = inKey; v.wReleased = false;
        v.age = ++this.ages;
        return;
      }
      if (v.state == SLOT_STEAL) { v.fadeLeft = 0; this.fading--; }
    }
    v.state = SLOT_HELD; v.owned = owned; v.internal = !owned; v.key = key; v.velocity = vel; v.group = group;
    v.noteId = id; v.port = port; v.channel = channel; v.inKey = inKey; v.age = ++this.ages;
    this.push(VOICE_START, s);
  }

  // --- Letting go ---------------------------------------------------------------------------------

  /** A key went up: its voice releases (or the pedal holds it); a note still waiting is marked released, once. */
  noteOff(io: Io, note: Note): void {
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      if (v.state == SLOT_HELD && v.owned && matches(note, v.noteId, v.port, v.channel, v.inKey)) {
        if (this.pedalDown) v.state = SLOT_PEDAL;
        else { v.state = SLOT_RELEASED; this.push(VOICE_RELEASE, i); }
      } else if (v.state == SLOT_STEAL && v.waiting && v.wOwned && matches(note, v.wNoteId, v.wPort, v.wChannel, v.wInKey)) {
        v.wReleased = true;
      }
    }
  }

  /** A generated note's length is over (the pedal does not hold it). */
  release(io: Io, s: i32): void {
    const v = unchecked(this.slots[s]);
    if (v.state == SLOT_HELD || v.state == SLOT_PEDAL) { v.state = SLOT_RELEASED; this.push(VOICE_RELEASE, s); }
    else if (v.state == SLOT_STEAL && v.waiting) v.wReleased = true;
  }

  /** The sustain pedal: let go, every voice it held releases. */
  pedal(io: Io, down: bool): void {
    this.pedalDown = down;
    if (down) return;
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      if (v.state == SLOT_PEDAL) { v.state = SLOT_RELEASED; this.push(VOICE_RELEASE, i); }
    }
  }

  // --- Ending -------------------------------------------------------------------------------------

  private kill(io: Io, s: i32, time: i32): void {
    const v = unchecked(this.slots[s]);
    if (v.owned) io.noteEnd(v.noteId, v.port, v.channel, v.inKey, time);
    v.owned = false;
    if (v.waiting) { if (v.wOwned) io.noteEnd(v.wNoteId, v.wPort, v.wChannel, v.wInKey, time); v.waiting = false; }
    if (this.fadeFrames > 0) {
      if (v.state != SLOT_STEAL) { v.state = SLOT_STEAL; v.fadeLeft = this.fadeFrames; this.fading++; }
      return;
    }
    if (v.state == SLOT_STEAL) { v.fadeLeft = 0; this.fading--; }
    v.state = SLOT_IDLE;
    this.push(VOICE_STOP, s);
  }

  /** The host's choke: the played notes it names end now (`key` -1: all of them), waiting ones too. */
  choke(io: Io, note: Note): void {
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      if (v.state == SLOT_IDLE) continue;
      if (v.state == SLOT_STEAL && v.waiting && v.wOwned && matches(note, v.wNoteId, v.wPort, v.wChannel, v.wInKey)) {
        io.noteEnd(v.wNoteId, v.wPort, v.wChannel, v.wInKey, note.time);
        v.waiting = false;
        continue;
      }
      if (v.state != SLOT_STEAL && v.owned && matches(note, v.noteId, v.port, v.channel, v.inKey)) this.kill(io, i, note.time);
    }
  }

  /** Every note of `group` ends now (a closed hat chokes the open one). */
  chokeGroup(io: Io, group: i32, time: i32): void {
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      if (v.state == SLOT_IDLE) continue;
      if (v.state == SLOT_STEAL) {
        if (v.waiting && v.wGroup == group) { if (v.wOwned) io.noteEnd(v.wNoteId, v.wPort, v.wChannel, v.wInKey, time); v.waiting = false; }
        continue;
      }
      if (v.group == group) this.kill(io, i, time);
    }
  }

  /** The plugin's voice on slot `s` went silent at sample `n`: its NOTE_END (a fading slot carries on). */
  finished(io: Io, s: i32, n: i32): void {
    const v = unchecked(this.slots[s]);
    if (v.state == SLOT_STEAL || v.state == SLOT_IDLE) return;
    if (v.owned) io.noteEnd(v.noteId, v.port, v.channel, v.inKey, n);
    v.owned = false;
    v.state = SLOT_IDLE;
  }

  /** One sample of the steal fades: a fade that ends starts its waiting note (or stops its voice). */
  tick(io: Io, n: i32): void {
    if (this.fading == 0) return;
    for (let i = 0; i < this.slots.length; i++) {
      const v = unchecked(this.slots[i]);
      if (v.state != SLOT_STEAL) continue;
      v.fadeLeft--;
      if (v.fadeLeft > 0) continue;
      v.fadeLeft = 0;
      this.fading--;
      if (!v.waiting) { v.state = SLOT_IDLE; this.push(VOICE_STOP, i); continue; }
      v.waiting = false;
      v.owned = v.wOwned; v.internal = v.wInternal; v.key = v.wKey; v.velocity = v.wVelocity; v.group = v.wGroup;
      v.noteId = v.wNoteId; v.port = v.wPort; v.channel = v.wChannel; v.inKey = v.wInKey;
      v.state = SLOT_HELD;
      this.push(VOICE_START, i);
      if (v.wReleased) {
        if (this.pedalDown && v.owned) v.state = SLOT_PEDAL;
        else { v.state = SLOT_RELEASED; this.push(VOICE_RELEASE, i); }
      }
    }
  }
}

/** An event's kind (`VOICE_START`, `VOICE_RELEASE`, `VOICE_STOP`). */
// @ts-ignore: decorator
@inline export function eventKind(e: i32): i32 { return e >>> 16; }
/** An event's slot. */
// @ts-ignore: decorator
@inline export function eventSlot(e: i32): i32 { return e & 0xffff; }
