# The DSP toolkit: voices, envelopes and clocks done once

The [DSP library](dsp-library.md) gives you the blocks: oscillators, filters, envelopes, delays. The **DSP toolkit**
gives you the bookkeeping around them that is easy to get wrong:

- which voice a note takes;
- a NOTE_END for every note;
- a step clock that follows the song;
- randomness that a render reproduces;
- a tail that is long enough;
- states that never sink to subnormal numbers.

Cyber's own catalogue plugins use it. Every rule in it answers a fault a code review found in a plugin that did
the same thing by hand.

It is AssemblyScript, in the Cyber clone (and the kit's public repository) at
[est-plugins/catalogue-src/tools/dsp/](../../est-plugins/catalogue-src/tools/dsp/README.md). Its README
documents every piece. It imports only this kit's `est` library.

## Use it in a plugin made by `est new`

1. Copy the folder into your plugin as `assembly/dsp/`. Leave out its `test/` folder, which holds the toolkit's
   own tests.
2. Import what you need:

   ```ts
   import { VoiceAllocator, VOICE_START, VOICE_RELEASE, eventKind, eventSlot, Adsr, StepClock, Tail, chance } from "./dsp/index";
   ```

3. Make each object where allocation is allowed: a field initialiser, the constructor or `activate`.

Your `asconfig.json` already finds `est`, which the toolkit imports, so nothing else changes. Your bundle carries
the copy it was built with.

## What each piece is for

- **`VoiceAllocator`**: the instrument templates' `Voices` with the rules a polyphonic instrument needs:
  - a steal policy (released voices first, then held ones, oldest or quietest);
  - an optional steal fade, during which the new note waits;
  - a key let go during that fade still releases its note;
  - the sustain pedal;
  - choke groups.

  It sends a NOTE_END for every played note however it ends: finished, stolen, choked, or dropped while waiting.
  It holds no sound. You keep your voices in an array and do what its events say (start, release, stop).
- **`Adsr`, `Ar`, `Fall`, `Glide`**: envelopes and smoothers that go idle at a set level and set every value under
  1e-20 to exactly 0. A −60 dB time and a time constant are separate functions (`t60Coef`, `onePoleCoef`).
- **`StepClock`**: steps on the host's song position, counted from the host's bar start, so a meter change keeps
  the pattern on the bar. Each step fires once and forwards. Swing never replays a step. Any jump (a loop, a
  locate) re-syncs without firing what it skipped.
- **`chance`, `Dice`**: random values from a hash of the song step, the voice and the key. The same note at the
  same place always gets the same value, live, in a render and on every peer.
- **`Tail`**: your `tail()` from what the plugin is made of:
  - releases counted to their real end level;
  - an echo's repeats at the tempo now;
  - parts that follow one another added together.
- **`Declick`, `Ramp`**: a voice taken while sounding carries its last sample down over 2 ms, and a path switches
  only once its gain ramp has arrived.
- **`OnePole`, `Biquad`, `Mode`**: filters and resonances whose states flush.

## Checks

The toolkit's rules are tested in the kit's suite (`sdk/tests/dspToolkit.test.ts`), which builds a test
instrument on it and runs it as Cyber's install does. A plugin on the toolkit still runs `est validate` and
`est test` as any other: the conformance run counts its NOTE_ENDs.
