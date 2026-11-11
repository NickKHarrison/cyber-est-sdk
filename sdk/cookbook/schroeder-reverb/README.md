# Cookbook Schroeder Reverb

Manfred Schroeder's 1962 design: four feedback combs in parallel make a dense series of echoes (Size sets their feedback, Damping a low-pass inside each loop so highs die first), and two all-passes in series smear them into a wash. The right channel's delays are 23 frames longer, so the two sides decorrelate.

**Ask for:** "a plate reverb with pre-delay and a high cut on the tail"

Start from it: `est new schroeder-reverb <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
