// sound1: Cyber's sound kit for EST plugins in AssemblyScript, version 1. A plugin says what one
// voice sounds like (`Instrument`, `Voice`) or what happens to the input (`Effect`), one sample at a
// time, out of blocks; the kit supplies the rest. Read README.md.
//
// `import … from "sound1"` is all a plugin needs: the EST library's names it uses are here too. The
// name carries the version: sound1 never changes what a plugin built on it sounds like (a change that
// would is `sound2`, beside it), so source written for it builds the same later.

export { Adsr, Block, Descriptor, Effect, Instrument, Sound, VOICE_GAIN, Voice, barStart, beat, beats, choice, meterDen, meterNum, param, playing, prepareSound, sampleRate, start, tempo } from "./core";
export { Filter, Lfo, Noise, OnePole, Osc, Smooth, Wavetable } from "./blocks";
export { Chorus, Delay, Echo, Flanger, PingPong, Reverb } from "./fx";
export { Compressor, Crusher, Limiter, drive, mix, panLeft, panRight, softClip } from "./dyn";
export { Steps } from "./steps";
export { quiet, sinPhase, tanhFast } from "./fast";
// The EST library's own (a plugin on the kit imports from "sound1" alone).
export { Io, Note, Param, Plugin, alloc, clap_entry, free, isReady } from "est";
export { clamp, dbToGain, exp, exp2, floor, gainToDb, keyToHz, ln, log2, round, sinTurns, cosTurns } from "est";
