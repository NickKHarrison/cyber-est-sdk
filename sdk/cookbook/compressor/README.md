# Cookbook Compressor

A peak compressor: the detector follows the louder channel (fast up at Attack, down at Release), and above the threshold the output rises only 1/Ratio as fast as the input. The gain is computed in dB, so a knee is one more line in `render`.

**Ask for:** "a compressor with a soft knee and a gain-reduction meter"

Start from it: `est new compressor <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
