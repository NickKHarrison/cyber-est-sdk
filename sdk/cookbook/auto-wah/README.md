# Cookbook Auto-Wah

An envelope follower turns the input's level into a number between 0 and 1 (fast up, slow down); that number sweeps a band-pass filter's cutoff geometrically, Base × 2^(Range × level), so loud notes open the wah.

**Ask for:** "an auto-wah that can also follow an LFO synced to the tempo"

Start from it: `est new auto-wah <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
