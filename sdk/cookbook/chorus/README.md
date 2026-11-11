# Cookbook Chorus

Each channel writes into its own delay line and reads it back a few milliseconds late, the read point swept by a sine LFO; the right channel's LFO is a quarter-turn ahead, which is what makes it wide. `DelayLine.read` interpolates between samples, so the sweep is smooth.

**Ask for:** "a chorus with three voices and a stereo spread control"

Start from it: `est new chorus <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
