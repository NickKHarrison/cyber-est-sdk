# The cookbook

Ten short plugins, each a working, validated starting point for a common job, in AssemblyScript (no native toolchain). Each is a folder in `sdk/cookbook/` with its `est.json`, `assembly/index.ts`, `asconfig.json`, a golden render in `test/` and a README; the SDK's tests validate every one (`est validate`'s checks, metered) and render its golden on every change, so the code here is tested code.

Start from one as from a template:

```
est new chorus ~/plugins/my-chorus --id org.example.my-chorus --name "My Chorus"
cd ~/plugins/my-chorus
est validate && est test && est dev
```

`est new` looks for the name among the templates first ([templates.md](templates.md)), then here. Each recipe ends with a prompt: the sentence to give a coding agent (or, once it opens, the Plugin Studio) to take it one step further. The templates are bigger and explained line by line in their `AGENTS.md`; a recipe is one idea in a page of code.

| Recipe | Kind | What it shows |
|---|---|---|
| [Compressor](#compressor) | effect | A peak compressor with threshold, ratio, attack, release and make-up gain, its channels linked. |
| [Chorus](#chorus) | effect | A stereo chorus: a modulated delay per channel, the two LFOs a quarter-turn apart, mixed with the dry signal. |
| [Bitcrusher](#bitcrusher) | effect | A bitcrusher: the signal quantised to fewer bits and held for several samples, mixed with the dry signal. |
| [Wavetable](#wavetable) | instrument | A wavetable synth: four single-cycle waves (sine, triangle, saw, square) morphed by Position, six voices with an envelope. |
| [Drum Synth](#drum-synth) | instrument | A drum synth: a kick (a falling sine), a snare (a tone and noise) and a hat (high-passed noise), on the General MIDI keys. |
| [Ring Modulator](#ring-mod) | effect | A ring modulator: the input multiplied by a sine carrier, mixed with the dry signal. |
| [Stereo Widener](#widener) | effect | A stereo widener: the signal as mid and side, the side scaled by Width (0 % mono, 100 % unchanged, 200 % twice as wide). |
| [Auto-Wah](#auto-wah) | effect | An auto-wah: an envelope follower on the input sweeps a resonant band-pass filter up from Base by up to Range octaves. |
| [Schroeder Reverb](#schroeder-reverb) | effect | A Schroeder reverb: four damped feedback combs in parallel, then two all-passes, per channel, the right a little longer for width. |
| [Step Sequencer](#step-sequencer) | note effect | A step sequencer: eight steps of notes from a root key, at a rate synced to the tempo, free or with the transport; notes played in pass through. |

## compressor

[`sdk/cookbook/compressor/`](../cookbook/compressor/): Cookbook Compressor, an effect. A peak compressor: the detector follows the louder channel (fast up at Attack, down at Release), and above the threshold the output rises only 1/Ratio as fast as the input. The gain is computed in dB, so a knee is one more line in `render`.

Parameters: Threshold (dB), Ratio, Attack (ms), Release (ms), Makeup (dB).

**Ask for:** "a compressor with a soft knee and a gain-reduction meter"

## chorus

[`sdk/cookbook/chorus/`](../cookbook/chorus/): Cookbook Chorus, an effect. Each channel writes into its own delay line and reads it back a few milliseconds late, the read point swept by a sine LFO; the right channel's LFO is a quarter-turn ahead, which is what makes it wide. `DelayLine.read` interpolates between samples, so the sweep is smooth.

Parameters: Rate (Hz), Depth (ms), Delay (ms), Mix (%).

**Ask for:** "a chorus with three voices and a stereo spread control"

## bitcrusher

[`sdk/cookbook/bitcrusher/`](../cookbook/bitcrusher/): Cookbook Bitcrusher, an effect. Two old tricks: `floor(x × steps + ½) / steps` keeps only so many levels (Bits, which may be fractional), and taking a new sample only every Downsample frames holds each one, which aliases the way early samplers did.

Parameters: Bits, Downsample, Mix (%).

**Ask for:** "a bitcrusher whose sample-rate reduction follows the tempo"

## wavetable

[`sdk/cookbook/wavetable/`](../cookbook/wavetable/): Cookbook Wavetable, an instrument. A table is a single cycle sampled 2048 times; a voice steps through it at its key's frequency and interpolates. Position morphs between neighbouring waves (0 sine, 1 triangle, 2 saw, 3 square). The tables are built once in `activate` from their harmonics, so they are band-limited to 24 harmonics.

Parameters: Level (dB), Position, Attack (ms), Release (ms).

**Ask for:** "a wavetable synth with a table drawn from four of my own waves and a filter"

## drum-synth

[`sdk/cookbook/drum-synth/`](../cookbook/drum-synth/): Cookbook Drum Synth, an instrument. Three drums from two ingredients. The kick is a sine whose pitch falls quickly to Kick pitch; the snare is a 185 Hz tone under noise; the hat is noise with its low part taken away (a one-pole high-pass). Each part decays by a factor per sample, and a voice ends its note when it is below -80 dB, which is when the host hears its NOTE_END.

Parameters: Level (dB), Kick decay (ms), Kick pitch (Hz), Snare decay (ms), Hat decay (ms).

**Ask for:** "an 808-style drum synth with a clap and a tom on more keys"

## ring-mod

[`sdk/cookbook/ring-mod/`](../cookbook/ring-mod/): Cookbook Ring Modulator, an effect. Multiplying by a sine moves every partial up and down by the carrier's frequency: at a few hertz it is a tremolo, in the audio range it is the metallic sound of a ring modulator.

Parameters: Frequency (Hz), Mix (%).

**Ask for:** "a ring modulator whose carrier follows the notes I play"

## widener

[`sdk/cookbook/widener/`](../cookbook/widener/): Cookbook Stereo Widener, an effect. Mid is what the channels share, side is how they differ. Scaling the side by Width and adding it back keeps the mid (and so the mono sum) exactly as it was, which is why this is the safe way to widen.

Parameters: Width (%).

**Ask for:** "a widener that keeps the bass mono below a frequency I choose"

## auto-wah

[`sdk/cookbook/auto-wah/`](../cookbook/auto-wah/): Cookbook Auto-Wah, an effect. An envelope follower turns the input's level into a number between 0 and 1 (fast up, slow down); that number sweeps a band-pass filter's cutoff geometrically, Base × 2^(Range × level), so loud notes open the wah.

Parameters: Sensitivity (dB), Base (Hz), Range (oct), Resonance, Mix (%).

**Ask for:** "an auto-wah that can also follow an LFO synced to the tempo"

## schroeder-reverb

[`sdk/cookbook/schroeder-reverb/`](../cookbook/schroeder-reverb/): Cookbook Schroeder Reverb, an effect. Manfred Schroeder's 1962 design: four feedback combs in parallel make a dense series of echoes (Size sets their feedback, Damping a low-pass inside each loop so highs die first), and two all-passes in series smear them into a wash. The right channel's delays are 23 frames longer, so the two sides decorrelate.

Parameters: Size, Damping, Mix (%).

**Ask for:** "a plate reverb with pre-delay and a high cut on the tail"

## step-sequencer

[`sdk/cookbook/step-sequencer/`](../cookbook/step-sequencer/): Cookbook Step Sequencer, a note effect. A note effect: it sends notes rather than sound. Each step is a parameter (semitones above Root), so a step can be automated; Run On counts from when it starts, With the transport puts step k on beat k × Rate from the song's start. Notes played into it pass through.

Parameters: Run, Rate, Root, Steps, Gate (%), Step 1 (st), Step 2 (st), Step 3 (st), Step 4 (st), Step 5 (st), Step 6 (st), Step 7 (st), Step 8 (st).

**Ask for:** "a step sequencer with velocity and a probability per step"

## Two notes

- **Note effects** (the step sequencer, and the `midi-effect` templates) send notes. Cyber installs them and reports what they send, but does not route their notes to the next plugin on a track yet (EST 1.1); `est test` checks their notes against `test/golden-notes.json`, and `est dev` logs them as `plugin-notes`.
- **Every recipe obeys the template rules**: nothing allocated while processing (fixed arrays, delay lines sized in `activate`), deterministic maths from the SDK, no output past +18 dBFS at any parameter setting (the conformance run tries the extremes: that is why the compressor's make-up stops at 12 dB).
