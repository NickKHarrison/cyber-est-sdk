// The catalogue's DSP toolkit (est-plugins/catalogue-src/tools/dsp): the parts the reviews kept
// finding written wrong by hand, written once. Read README.md. AssemblyScript; it imports only the
// SDK's `est` library, so a plugin copies this folder (or points its asconfig.json's `path` at it).

export { DENORMAL_FLOOR, flush } from "./flush";
export { Glide, onePoleCoef, t60Coef } from "./smooth";
export { Adsr, Ar, END_LEVEL, ENV_ATTACK, ENV_DECAY, ENV_IDLE, ENV_RELEASE, Fall } from "./envelope";
export {
  SLOT_HELD, SLOT_IDLE, SLOT_PEDAL, SLOT_RELEASED, SLOT_STEAL, STEAL_NONE, STEAL_OLDEST, STEAL_QUIETEST,
  Slot, VOICE_RELEASE, VOICE_START, VOICE_STOP, VoiceAllocator, eventKind, eventSlot,
} from "./voices";
export { StepClock } from "./clock";
export { Dice, bipolar, chance, hashOf, mix64 } from "./random";
export { Tail, coefTo, echoTo, rt60To, t60To, tauTo } from "./tail";
export { Declick, Ramp } from "./declick";
export { BQ_BANDPASS, BQ_HIGHPASS, BQ_HIGHSHELF, BQ_LOWPASS, BQ_LOWSHELF, BQ_NOTCH, BQ_PEAK, Biquad, Mode, OnePole, prewarp } from "./filter";
