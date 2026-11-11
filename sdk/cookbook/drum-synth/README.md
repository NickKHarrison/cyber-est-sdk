# Cookbook Drum Synth

Three drums from two ingredients. The kick is a sine whose pitch falls quickly to Kick pitch; the snare is a 185 Hz tone under noise; the hat is noise with its low part taken away (a one-pole high-pass). Each part decays by a factor per sample, and a voice ends its note when it is below -80 dB, which is when the host hears its NOTE_END.

**Ask for:** "an 808-style drum synth with a clap and a tom on more keys"

Start from it: `est new drum-synth <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
