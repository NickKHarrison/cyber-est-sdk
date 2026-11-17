# Cookbook Spectrum Tilt

A tilt EQ: a one-pole low-pass at Pivot splits the sound into lows and highs, and Tilt raises one half by half its amount while it lowers the other by the same, so the pivot stays where it was. Its own window draws the plugin's output spectrum through EST 1.1: est.json says `"abi": { "est": "1.1" }` and `"ui": { "audio": true }`, the page asks with `est.audio({ fftSize, rate }, fn)` and draws the bins the host sends (`est:spectrum`: whole-dB magnitudes and each channel's RMS, at most 30 times a second). **The page never receives samples**, so it cannot record what is played through the plugin; a figure the analysis does not give is the DSP's to compute and report as a read-only parameter. Where the host sends no analysis (`est.audioAvailable` false), the page says so in words and still draws the tilt's curve.

**Ask for:** "a tilt EQ whose window shows its own spectrum, with the tilt's curve drawn over it"

Start from it: `est new spectrum-tilt <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
