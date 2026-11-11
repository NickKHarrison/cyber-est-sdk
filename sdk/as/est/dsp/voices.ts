import { Io, Note } from "../plugin";

/**
 * What `Voices` asks of a voice: to begin its release when its key is let go, and to fall silent
 * at once when its note ends (choked, stolen or finished). A voice class has a constructor with
 * no arguments (`Voices` makes them with `instantiate<T>()`).
 */
export abstract class Voice {
  abstract release(): void;
  stop(): void {}
}

/**
 * Polyphony for `n` voices of `T`: which voice plays which note (CLAP's matching), oldest-note
 * stealing, and the host's NOTE_END for every note that stops sounding. The Rust crate's
 * `Voices<T, N>` with `n` given at construction (in the plugin's constructor: never while processing).
 *
 * - `noteOn`: `const i = this.voices.start(io, note);` then set up `this.voices.voice(i)`;
 * - `noteOff`: `this.voices.release(note)`; `choke`: `this.voices.choke(io, note)`;
 * - `render`: for each `i` with `isOn(i)`, render the voice; once silent, `end(i, io, n)`.
 */
export class Voices<T extends Voice> {
  private voices: StaticArray<T>;
  private on: StaticArray<bool>;
  private releasing: StaticArray<bool>;
  private notes: StaticArray<Note>;
  private ages: StaticArray<u32>;
  private age: u32 = 0;

  constructor(private n: i32) {
    this.voices = new StaticArray<T>(n);
    this.on = new StaticArray<bool>(n);
    this.releasing = new StaticArray<bool>(n);
    this.notes = new StaticArray<Note>(n);
    this.ages = new StaticArray<u32>(n);
    for (let i = 0; i < n; i++) {
      this.voices[i] = instantiate<T>();
      this.notes[i] = new Note();
    }
  }
  len(): i32 { return this.n; }
  /** Whether voice `i` is playing a note (held or releasing). */
  isOn(i: i32): bool { return i >= 0 && i < this.n && unchecked(this.on[i]); }
  /** Whether voice `i` has been released (its key let go). */
  isReleasing(i: i32): bool { return this.isOn(i) && unchecked(this.releasing[i]); }
  /** The note voice `i` plays (its key, velocity and id). */
  note(i: i32): Note { return this.notes[i]; }
  voice(i: i32): T { return this.voices[i]; }
  /** How many voices are on. */
  count(): i32 { let c = 0; for (let i = 0; i < this.n; i++) if (unchecked(this.on[i])) c++; return c; }
  /** Whether voice `i` is on and plays a note `note` names. */
  matches(i: i32, note: Note): bool {
    const m = this.notes[i];
    return this.isOn(i) && note.matches(m.noteId, m.port, m.channel, m.key);
  }
  /** The voice `start` would take: the first free one, else the one with the oldest note. */
  pick(): i32 {
    let pick = 0;
    for (let i = 0; i < this.n; i++) {
      if (!unchecked(this.on[i])) return i;
      if (unchecked(this.ages[i]) < unchecked(this.ages[pick])) pick = i;
    }
    return pick;
  }
  /** Give `note` a voice (stealing the oldest when all are on: its note ends at `note.time`). */
  start(io: Io, note: Note): i32 {
    const i = this.pick();
    if (this.on[i]) this.end(i, io, note.time);
    this.age++;
    this.on[i] = true;
    this.releasing[i] = false;
    this.notes[i].copyFrom(note);
    this.ages[i] = this.age;
    return i;
  }
  /** The key of `note` was let go: each matching held voice begins its release. */
  release(note: Note): void {
    for (let i = 0; i < this.n; i++) {
      if (unchecked(this.on[i]) && !unchecked(this.releasing[i]) && this.matches(i, note)) {
        this.releasing[i] = true;
        this.voices[i].release();
      }
    }
  }
  /** Stop each matching voice at once, ending its note at `note.time`. */
  choke(io: Io, note: Note): void {
    for (let i = 0; i < this.n; i++) if (this.matches(i, note)) this.end(i, io, note.time);
  }
  /** Voice `i` stopped sounding at sample `n`: its note ends, the voice's `stop()` runs and it is free. */
  end(i: i32, io: Io, n: i32): void {
    if (!this.isOn(i)) return;
    const m = this.notes[i];
    io.noteEnd(m.noteId, m.port, m.channel, m.key, n);
    this.voices[i].stop();
    this.on[i] = false;
    this.releasing[i] = false;
  }
  /** Every voice stopped and free at once, without NOTE_END (the host's reset forgets its notes). */
  reset(): void {
    for (let i = 0; i < this.n; i++) {
      this.voices[i].stop();
      this.on[i] = false;
      this.releasing[i] = false;
    }
  }
}
