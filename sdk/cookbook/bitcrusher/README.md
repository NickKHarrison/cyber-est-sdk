# Cookbook Bitcrusher

Two old tricks: `floor(x × steps + ½) / steps` keeps only so many levels (Bits, which may be fractional), and taking a new sample only every Downsample frames holds each one, which aliases the way early samplers did.

**Ask for:** "a bitcrusher whose sample-rate reduction follows the tempo"

Start from it: `est new bitcrusher <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
