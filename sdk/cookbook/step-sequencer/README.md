# Cookbook Step Sequencer

A note effect: it sends notes rather than sound. Each step is a parameter (semitones above Root), so a step can be automated; Run On counts from when it starts, With the transport puts step k on beat k × Rate from the song's start. Notes played into it pass through.

**Ask for:** "a step sequencer with velocity and a probability per step"

Start from it: `est new step-sequencer <folder> --id <your id> --name "<your name>"`, then `est validate` and `est test` (see the SDK's `docs/cookbook.md`).
