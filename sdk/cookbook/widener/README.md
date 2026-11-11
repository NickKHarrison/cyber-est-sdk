# Cookbook Stereo Widener

Mid is what the channels share, side is how they differ. Scaling the side by Width and adding it back keeps the mid (and so the mono sum) exactly as it was, which is why this is the safe way to widen.

**Ask for:** "a widener that keeps the bass mono below a frequency I choose"

Start from it: `est new widener <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
