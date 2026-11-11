// The DSP library, the twin of the Rust crate's `est::dsp` (sdk/rust/est/src/dsp): the same
// blocks, the same algorithms and the same maths, so each renders the same samples in both
// languages (Cyber's suite compares the two builds of every block to within 1e-5). Every block
// allocates nothing after `activate` (only `DelayLine.allocate` allocates, and only there) and
// takes its sample rate from `setSampleRate` (until then it assumes 48 kHz).

export { Biquad, BiquadKind, Coefficients, biquadKindFromIndex, coefficientsInto, responseDb } from "./biquad";
export { DelayLine } from "./delay";
export { Envelope, Stage } from "./envelope";
export { Filter, FilterMode, filterModeFromIndex } from "./filter";
export { Lfo } from "./lfo";
export { Oscillator, Wave, waveFromIndex } from "./oscillator";
export { DEFAULT_SAMPLE_RATE, Smoother } from "./smoother";
export { Voice, Voices } from "./voices";
export { dbToGain, gainToDb, keyToHz } from "../math";
