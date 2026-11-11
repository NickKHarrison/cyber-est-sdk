# Cookbook Wavetable

A table is a single cycle sampled 2048 times; a voice steps through it at its key's frequency and interpolates. Position morphs between neighbouring waves (0 sine, 1 triangle, 2 saw, 3 square). The tables are built once in `activate` from their harmonics, so they are band-limited to 24 harmonics.

**Ask for:** "a wavetable synth with a table drawn from four of my own waves and a filter"

Start from it: `est new wavetable <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
