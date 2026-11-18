# The DSP toolkit (`tools/dsp/`)

The parts of a catalogue plugin that the code reviews kept finding written wrong by hand, written once and
tested (1.653). AssemblyScript; it imports only the SDK's `est` library (`sdk/as/est`), so it has no private
dependency and is exported with the developer kit (`scripts/sdk-export.mjs`' allow-list).

Each piece exists for a rule. The rule, and the review findings it answers, are in the file's header and below.
The findings are in [docs/releases/1.647.md](../../../../docs/releases/1.647.md) (review n572, area D: D-01 to D-24)
and [docs/releases/1.651.md](../../../../docs/releases/1.651.md) (review 2, area D: D2-01 to D2-17).

| File | What | The rule it holds |
|---|---|---|
| `voices.ts` | `VoiceAllocator` | Steal policy; a click-free steal fade with the waiting note; release marks set once; the pedal; choke groups; a NOTE_END for every played note |
| `envelope.ts` | `Adsr`, `Ar`, `Fall` | Exponential segments set by a −60 dB time; idle under an end level; every level under 1e-20 is 0 |
| `rcenv.ts` (1.820) | `RcAdsr` | An analogue chip's envelope: the attack an exponential rise toward 1.3 of the peak, stopped at the peak; the same end and floor rules as `Adsr`. Imported from its own file, never `index.ts` |
| `smooth.ts` | `Glide`, `onePoleCoef`, `t60Coef` | A one-pole that flushes; a time constant and a −60 dB time never confused |
| `clock.ts` | `StepClock` | Steps on the host's song position and bar start; meter changes; forward only; re-sync on any jump; swing without replay |
| `random.ts` | `chance`, `bipolar`, `hashOf`, `Dice` | Seeded by song step, voice and key, never by a counter |
| `tail.ts` | `Tail`, `t60To`, `tauTo`, `coefTo`, `echoTo` | A tail counted from release times and decay targets: parts in turn add, parts beside take the longest |
| `declick.ts` | `Declick`, `Ramp` | A voice taken while sounding carries its last sample; a switch waits until its ramp has arrived exactly |
| `filter.ts` | `OnePole`, `Biquad`, `Mode` | Filters whose states never sink to subnormal numbers |
| `flush.ts` | `flush`, `DENORMAL_FLOOR` | The floor every block flushes at: 1e-20 |
| `granular.ts` (1.711) | `GrainSource`, `GrainWindows`, `GrainPool`, `GrainScheduler`, `Playhead`, `semitoneRatio` | Band-limited reads through mip levels; grains windowed from 0 to 0 and started on their frame; fixed caps that refuse, never steal; spray seeded by the grain's place; tape as Hann grains at an overlap of 2 |

## Using it

From a catalogue folder that builds against `sdk/as/` (its `asconfig.json`'s `path` names `../../../sdk/as`):

```ts
import { VoiceAllocator, Adsr, StepClock, Tail } from "../../tools/dsp/index";
```

From a folder made by `est new` (its own copy of `est/`): copy this folder into `assembly/dsp/` and
`import … from "./dsp/index"`. The files import `est`, which the folder's `asconfig.json` already finds.
A shipped bundle never changes, so a copy is the version it was built with.

Allocate a toolkit object only where the SDK allows allocation: field initialisers, the constructor, `activate`.
`new Tail()` in `tail()` is an allocation: keep one as a field and `clear()` it.

## The voice allocator

The allocator holds no sound. Keep your voice objects in an array of the same length, and do what its events say.

```ts
alloc: VoiceAllocator = new VoiceAllocator(16);   // 16 slots

activate(sr: f64, maxFrames: u32): bool { this.alloc.reset(); this.alloc.setFade(0.003, sr); return true; }

noteOn(io: Io, note: Note): void { this.alloc.noteOn(io, note, groupOf(note.key)); this.drain(); }
noteOff(io: Io, note: Note): void { this.alloc.noteOff(io, note); this.drain(); }
choke(io: Io, note: Note): void { this.alloc.choke(io, note); this.drain(); }
// CC 64 in midi(): this.alloc.pedal(io, value >= 64); this.drain();

drain(): void {
  for (let e = this.alloc.next(); e >= 0; e = this.alloc.next()) {
    const s = eventSlot(e), v = this.voices[s];
    if (eventKind(e) == VOICE_START) v.start(this.alloc.key(s), this.alloc.velocity(s));
    else if (eventKind(e) == VOICE_RELEASE) v.env.release();
    else v.stop(); // VOICE_STOP
  }
}

render(io: Io, from: i32, to: i32): void {
  for (let n = from; n < to; n++) {
    this.alloc.tick(io, n); this.drain();           // the steal fades, and the waiting notes they start
    for (let s = 0; s < 16; s++) {
      if (this.alloc.isIdle(s)) continue;
      const v = this.voices[s];
      const amp = v.env.next();
      if (!v.env.active) { this.alloc.finished(io, s, n); continue; }   // its NOTE_END
      out += v.sample() * amp * this.alloc.gain(s);                       // gain: the steal fade
    }
  }
}
```

- **Steal policy** (`policy`). `STEAL_OLDEST` takes, in order:
  1. an idle voice;
  2. a released voice;
  3. a voice the pedal holds;
  4. a generated note's voice;
  5. a played note's voice.

  It takes the oldest in each class. `STEAL_QUIETEST` takes the quietest (`setLevel`), then the oldest. `STEAL_NONE` never steals.
  A voice already fading for a waiting note is taken last (D2-14: the 18th note took the 17th's fading voice).
- **The steal fade** (`setFade`). The stolen voice fades out linearly (`gain(s)`), and the new note waits in its
  slot until the fade ends. A key let go during the fade marks the waiting note released. The mark is a set,
  never a toggle (D-18, D2-09). The note then starts released, or held if the pedal is down (D-01: it started gated and sustained for ever).
  With no fade, the note starts at once: carry the old voice's last sample with a `Declick` (D-10).
- **NOTE_END** is sent once for every played note:
  - when its voice finishes (`finished`);
  - when its voice is stolen;
  - when it is choked by the host;
  - when it is choked by its group (D-17);
  - when it is dropped while still waiting (D2-04, D2-14).

  Generated notes (`startInternal`: an arpeggio, a cat's paws) get none.
- **Choke groups.** `noteOn(io, note, group)` ends every other note of `group` first.
- **Counts are computed** (`held()`, `active()`, `waiting()`), never kept by hand: a kept count can leak (D2-14).
- **A key goes up the way it went down.** The allocator matches a note-off only against the notes it started. A
  plugin that also treats keys as switches checks its own held list first (D-16, D2-01).

## Envelopes and smoothers

- `Adsr`:
  - a linear attack from wherever it is, so a retrigger never clicks;
  - the decay toward Sustain and the release toward 0, each an exponential set by its −60 dB time (`setDecayT60`, `setReleaseT60`) or a coefficient;
  - idle under `endLevel` (−80 dB by default), and every level under 1e-20 is exactly 0 (D-13, D-14);
  - `holdAttack`: a release during the attack waits for the attack to reach 1.

  `Ar` is the attack and the release alone; `Fall` a value that only decays (an FM index, a partial).
- `Glide` follows a target and flushes, so a smoother sent to 0 is 0, never a subnormal (D2-08, D2-13).
  `settle(eps)` sets it exactly to its target, so a path that tests equality can switch (D-07).
- A **time constant** (`onePoleCoef`, `tauTo`) and a **−60 dB time** (`t60Coef`, `t60To`) are different
  functions. A "1.5 s fade" written as a 1.5 s time constant took 13.8 s to fall 80 dB (D2-12).

## The step clock

Call `advance(beat, frame, barStart, num, den)` once a sample with the song beat. It returns true on the sample a
step fires, with `index` (the step's place on the song's step grid), `inBar`, `bar` and `grid` set.

- **On the host's bars.** Steps are laid from the transport's `barStart`, then every bar of `num`/`den`. After a
  meter change the pattern starts on the bar line (D2-07). A change of bar start or meter re-lays the grid after
  the last step fired: it never stalls and never repeats.
- **Forward only.** Swing (`setSwing`, a fraction of a step) delays the odd steps of the bar. Changing it never
  fires a step again (D-05, D2-02, D2-06, D2-11).
- **Re-sync on any jump.** A jump is the beat going back, or forward by more than two frames. The clock re-lays
  at the new position, and the steps it skipped never fire (D-12: a 32-beat jump fired 128 hits in 3 ms). The step it
  lands on fires if the position is on it to within a frame. With `landing`, the step it lands in fires once,
  unless it is the step last fired. `jumped` says a re-sync happened, so a plugin re-derives anything it keeps by
  position, such as a stop pending at the next bar line (D-15).
- Seed randomness by `index` (or `grid`), never by a count of steps.

## Seeded randomness

`chance(step, voice, key, salt)` is a value in [0, 1): a 64-bit hash of what it is for, so the same arguments
always give the same value. A render from bar 9 matches live play from bar 9, a peer matches the host, and a note
sounds the same however many came before it (D-06, D2-10). `Dice` draws a short run from one such seed. Its
counter restarts with every `seed`.

## The tail

`new Tail()` (a field), then:

- `then(s)` for parts that follow one another (a release, then a pre-delay running out);
- `with(s)` for parts beside them (the longest wins);
- `frames(sampleRate, capSeconds)`, rounded up, at most est.json's `limits.tailSeconds`.

`t60To(release, 80)` is a release counted to a voice's −80 dB end (D2-15). `echoTo(delay, feedback, 60)` is an
echo's repeats at the tempo now (D-23). Leave nothing out (D2-03).

## Declick and ramps

- `Declick.take(last)` carries a taken voice's last sample, and `next()` lets it fall over its time (2 ms) (D-10).
- `Ramp` moves a gain linearly and reports `done` only when it is exactly at its target. Switch a path (a bypass,
  a copy, a weight) only then (D-07, D-08).

## Filters

`OnePole` (`lp`, `hp`), `Biquad` (RBJ's cookbook in transposed direct form II; `set(kind, hz, q, gainDb, sr)`,
`responseDb`) and `Mode` (a decaying resonance: a bar's, a tine's or a bell's partial, set by its −60 dB time).
Every state is flushed below 1e-20 as it is written (D-11, D2-05). The biquad's two states are flushed together,
since flushing one alone feeds the other a step: a limit cycle at the floor.

## The worked example

CAT ON KEYBOARD (`org.nickkharrison.cat-on-keyboard`, 1.653) uses the toolkit for:

- its voices (`VoiceAllocator`, no fade, with `Declick`);
- its envelopes (`Adsr` with `holdAttack`, `Fall`);
- its smoothing (`Glide`, `OnePole`);
- the cat's grid (`StepClock` with `landing`);
- its tail (`Tail`).

Its sound is the 1.0.0 module's to the bit (`src/audio/est/install/catOnKeyboardToolkit.test.ts`). The other
catalogue plugins move in later releases, one at a time, each proven the same way.

## Tests

`sdk/tests/dspToolkit.test.ts` builds `test/probe/` (each block behind plain exports) and `test/synth/` (a test
instrument: sine voices on the allocator, envelope, declick and clock). It runs the instrument as Cyber's install
does, on the reviews' scenarios:

- the NOTE_END counts;
- the readouts of voices held and waiting;
- the store review's subnormal counter;
- the conformance run.

Change a rule here only with its test, and run `npx vitest run sdk/tests/dspToolkit.test.ts`.

## The granular engine (`granular.ts`, 1.711)

The suite of granular synthesizers (1.711–1.713) shares it. Import it from `"../../tools/dsp/granular"`
(`index.ts` does not re-export it, so a plugin that does not use it compiles to the bytes it did).

- **`GrainSource(maxFrames)`**: `loadI16(ptr, frames, rate)` (a module's embedded table, see the
  sampler templates' `tools/embed-samples.mjs`) or `loadF32`, from `activate` once: it builds five half-band
  mip levels (a 23-tap Blackman-windowed half-band each, the source read as a loop), so `levelFor(step)`
  reads a grain pitched up where its step is at most one frame, with a 4-point Hermite interpolation: no
  aliasing three octaves up, at the cost of one octave down. About 30 points a source frame, once. A source
  changed while playing loads in steps (`beginI16`/`beginF32`, then `work(units)` each block until it answers
  true; silent meanwhile), since a whole 64 000-frame load overruns one block's fuel.
- **`GrainWindows`**: Hann, Tukey (α 0.5), trapezoid (a tenth each side) and exponential (a struck grain),
  each a 1024-point table from 0 to 0.
- **`GrainPool(count, ownerCap, owners?)`**: `spawn(src, owner, pos, step, frames, shape, pan, gain, delay, sr)` starts
  a grain on frame `delay` of the next render (a negative step reads backward; its length bounded by
  `MIN_GRAIN_SECONDS`..`MAX_GRAIN_SECONDS`), or answers -1 past the pool's size or the owner's cap: a sounding
  grain is never taken. `render(src, win, owner, L, R, frames)` adds an owner's grains (all with -1) into two
  `StaticArray<f64>` buffers; `stop(owner)` only once the owner is silent. With `owners` (owners numbered 0 …
  owners − 1) the pool keeps each owner's count as grains start and end (`activeOf`, a cap checked without a walk)
  and **`renderInto(src, win, L[], R[], frames)` renders every grain in one walk, each into its owner's buffers**:
  use it when several owners sound (a plugin's voices × playheads), since the meter charges a loop's whole body on
  every pass and a walk of the pool per owner costs more than the grains (FOURFOLD: half its fuel, 1.711).
- **`GrainScheduler`**: free (`setDensity(hz)`, `setOverlap(length, overlap)`) or synced (`setTransport(playing,
  beat, bpm, sr)` each block, `beatsPerGrain`). `next(from, frames)` answers each grain's frame in the block.
  `index` numbers the grains from `start()` (free: a place in the note) or by the song's grid (synced), and
  `dice(salt)`/`spray(salt)` are `chance` of it with the owner, key and salt: a note sounds the same wherever it
  falls, a render from bar 9 matches live play. A synced jump never fires the steps it skipped.
- **`Playhead`**: a region (`setRegion`), `PH_FORWARD`, `PH_REVERSE` or `PH_PINGPONG`, `advance(frames)` by any
  distance (0 holds it), `dir` the way it reads now.
- **Tape** is not a second engine: Hann grains at an overlap of exactly 2, each read at the speed its playhead
  scans, sum to the source itself (`sdk/tests/dspGranular.test.ts` holds it within 2e-3).

Cost: a grain is about 60 points a frame (its window, a Hermite read, two adds), and a walk of the pool about 40
points a grain whether it sounds or not. With the caps a plugin sets, its worst block is about `count × frames ×
60` points; 168 grains are about 1.3 M points a 128-frame block, 3 % of `BLOCK_FUEL`.

## The SDK library's steal rule (`oldest.ts`, 1.666)

`OldestVoiceAllocator` is the allocator with the SDK library's `Voices` rule: an idle voice first, else the oldest
note whatever its state, held, pedal-held or released. It is for a plugin moved onto the toolkit from `Voices`, so
a steal takes the voice it always took (STACKTONE 1.0.2 and STRATATONE 1.0.2). Everything else is the allocator's
own. Import it from `"../../tools/dsp/oldest"`: `index.ts` does not re-export it, because overriding `pick` makes
it virtual in any program that parses the subclass, and a plugin on `VoiceAllocator` alone must compile to the
bytes it did. `sdk/tests/dspToolkit.test.ts` holds its rule on the probe.
