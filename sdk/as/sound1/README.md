# sound1: the sound kit

`import … from "sound1"`. A small kit of tested sound blocks for EST plugins in AssemblyScript, and two shapes that take a plugin's plumbing away. It is what Cyber's make-a-plugin prompt teaches a chat assistant (`sdk/docs/ONE_PROMPT.md`), and what the browser's builder gives every pasted plugin (`GET /playground/templates.json` serves it beside the EST library; the compile Worker reads it as files and fetches nothing).

The EST library (`"est"`) is still there for anyone who wants it raw: a plugin may import from either, or both.

## The two shapes

You write **one method**, `tick()`, which runs once a sample.

```ts
class MyEffect extends Effect {
  left: Filter = new Filter();
  right: Filter = new Filter();
  tick(): void {                     // the input is in this.l and this.r: leave the output there
    this.l = this.left.lowpass(this.l, param(CUTOFF), param(RESONANCE));
    this.r = this.right.lowpass(this.r, param(CUTOFF), param(RESONANCE));
  }
}

class MyVoice extends Voice {
  osc: Osc = new Osc();
  tick(): f64 {                      // one sample of ONE voice
    this.amp.set(0.01, 0.3, 0.6, param(RELEASE));
    return this.osc.saw(this.hz) * this.velocity;
  }
}
class MySynth extends Instrument<MyVoice> { constructor() { super(8); } }
```

and the export block (`sdk/agents/sound-examples/` has three whole plugins; `sdk/agents/prompt-example/` a fourth with its window):

```ts
export { clap_entry, free } from "sound1";
export function malloc(size: usize): usize {
  if (!isReady()) start(new Descriptor("com.example.my-synth", "My Synth", "Me", "1.0.0"), parameters(), new MySynth());
  return alloc(size);
}
```

## What the kit does, so a plugin cannot forget it

| | |
|---|---|
| The block loop and its events | `process`, `render`, events at their sample. |
| Parameters | `param(ID)` is the value at this sample, glided over 8 ms; a switch (`labels`) is read with `choice(ID)` and never glided. |
| The sample rate | Every block reads it from the kit: times are seconds, frequencies Hz, the same sound at 44.1, 48 and 96 kHz. Buffers are sized once, for 96 kHz, inside a 2.5 MB budget (a plugin's default memory is 4 MB). |
| Notes | The catalogue toolkit's `VoiceAllocator` (`dsp/voices.ts`): an idle voice first, then released, pedal-held, generated, played, the oldest in each; a steal fades the old note out over 3 ms while the new one waits; the sustain pedal; chokes; exactly one NOTE_END a played note. The pitch wheel (±2 semitones) and an optional glide move `this.hz`. |
| A voice always ends | The kit applies the voice's loudness envelope `this.amp` and frees the voice when it has faded: a note cannot hang. Every block of a voice is cleared when its note starts; every `Adsr` in it starts and releases with the note. |
| The tail | Each block knows how long it rings at its settings (`Echo`: its time and feedback; `Reverb`: its decay; `Filter`: its resonance); the kit reports the sum, and an instrument the longest release on top. `ring()` adds seconds for a feedback loop you built yourself from `Delay`. |
| Nothing past the tail, nothing while silent | Once the input (or the last voice) has been silent for the reported tail, the output fades over 5 ms, the blocks are cleared and the plugin sleeps: `tick()` is not called until sound returns. So a render never cuts a tail the plugin did not report, and silence costs nothing. |
| Tiny numbers | Every state that feeds itself is set to 0 below 1e-20. |
| The output | Untouched up to 0.8, bent smoothly above, never past 1. A sample that is not a number becomes 0 and clears the blocks. Voices are mixed at -12 dB each. |
| Latency | 0: no block looks ahead. |
| State | The parameters (the EST library saves them). |

Do not override `activate`, `reset`, `render`, `process`, `paramChanged`, `tail` or the note handlers on a kit class: they are the kit's.

## The blocks

All numbers are `f64`. Make a block only as a field (`osc: Osc = new Osc();`) or in a constructor; call it once a sample; give each signal its own.

- `Osc`: `sine(hz, fm = 0)`, `saw(hz)`, `square(hz)`, `pulse(hz, width)`, `triangle(hz)`. PolyBLEP and polyBLAMP: band-limited.
- `Noise`: `white()`, `pink()`, `random()`. Seeded: the same on every run.
- `Wavetable`: `harmonic(n, level)` in the constructor (n 1 to 32), `next(hz)`. Six band-limited copies, shared by equal tables.
- `Lfo`: `sine(hz)`, `triangle(hz)`, `saw(hz)`, `square(hz)`, `random(hz)`.
- `Adsr`: `set(attack, decay, sustain, release)`, `perc(attack, decay)`, `next()`, `done()`, `start()`, `release()`. The toolkit's envelope: a linear attack from where it is, exponential decay and release (the time is to -60 dB), idle at -80 dB.
- `Filter`: `lowpass(x, hz, resonance)`, `highpass`, `bandpass`, `notch`. A trapezoidal state-variable filter: stable at every setting and under modulation. `OnePole`: `lowpass(x, hz)`, `highpass(x, hz)`.
- `Smooth`: `next(target, seconds)`.
- `Delay(maxSeconds)`: `read(seconds)` then `write(x)`.
- `Echo(maxSeconds)`: `process(x, seconds, feedback, tone = 1)` returns the repeats alone. Feedback is held under 0.95 and under what would ring more than 40 s; the time glides.
- `PingPong(maxSeconds)`: `process(l, r, seconds, feedback)`, then `.l`, `.r`.
- `Reverb`: `process(l, r, seconds, damping)`, then `.l`, `.r`. Eight delay lines through a Householder reflection, two input diffusers.
- `Chorus`: `process(l, r, rateHz, depth)`; `Flanger`: `process(l, r, rateHz, depth, feedback)`; then `.l`, `.r`.
- `Compressor`: `gain(l, r, thresholdDb, ratio, attack, release)`; `Limiter`: `gain(l, r, ceilingDb)`: a gain to multiply both sides by. `Crusher`: `process(x, bits, rateHz)`.
- `Steps`: `next(stepsPerBeat, swing = 0)`: -1, or a step's place in its bar on the sample it starts. The toolkit's `StepClock`: counted from the host's bar start, a jump never fires what it skipped. An instrument's `pattern()` runs every sample and may call `this.play(key, velocity, seconds)`.
- Functions: `drive(x, amount)`, `softClip(x)`, `mix(dry, wet, amount)`, `panLeft(pan)`, `panRight(pan)`, `beats(n)`, `tempo()`, `beat()`, `playing()`, `sampleRate()`, and the EST library's `dbToGain`, `gainToDb`, `keyToHz`, `clamp`.

There is no sample player: the one-answer path carries text files only (no audio assets). A plugin with samples is made from the `sampler-as` template.

## The version is in the name

A plugin's source names the kit it was written for: `from "sound1"`. **sound1 never changes what a plugin built on it sounds like.** It may gain a block or a function; a fix that would move one sample of an existing render goes into a new kit beside it (`sdk/as/sound2`, added to `SOUND_KITS` in `server/studioTemplates.mjs`), and sound1 stays served for good. So source built again next year gives the same sound, and a bundle already built never changes anyway (it holds its compiled module).

`sdk/tests/soundKit.examples.test.ts` holds this: `frozen.json` is a hash of each example's render, and the test fails when one moves. `dsp/` holds the catalogue toolkit's files as they were when sound1 shipped (the test names any that have since changed there).

## In a folder made by `est new`

Copy this folder beside the folder's `est/` (its `asconfig.json` already looks there): `import … from "sound1"` then resolves. A plugin with a long `Echo` needs `"maximumMemory": 64` in `asconfig.json` and `limits.memoryPagesMax: 64` in `est.json`.

## Tests

- `sdk/tests/soundKit.test.ts`: every block through the probe (`test/probe`), at 44.1, 48 and 96 kHz: bounded, no NaN, stable over its ranges, silent after silence with no subnormal numbers, and what it is for.
- `sdk/tests/soundKit.examples.test.ts`: the example plugins built as the browser builds a pasted answer, the whole validator (the behaviour checks EST-C024 to EST-C030 included), the fuel of sixteen voices, the freeze.
