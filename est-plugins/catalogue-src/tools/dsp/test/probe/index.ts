// The DSP toolkit's probe (not a plugin): each block behind plain exports, so sdk/tests/dspToolkit.test.ts
// can drive it sample by sample from the test and read what it does. One instance of each block.

import { Adsr, Ar, Biquad, Declick, Dice, Glide, Mode, OnePole, Ramp, StepClock, Tail, chance, coefTo, echoTo, t60To, tauTo, t60Coef, onePoleCoef } from "../../index";
import { sinTurns } from "est";
import { VoiceAllocator } from "../../voices";
import { OldestVoiceAllocator } from "../../oldest";

const MAX = 1 << 20;
const OUT = memory.data(MAX * 8, 16);
// @ts-ignore: decorator
@inline function out(i: i32, v: f64): void { store<f64>(OUT + (<usize>i << 3), v); }
export function output_ptr(): usize { return OUT; }
function lim(n: i32): i32 { return n < MAX ? n : MAX; }

/** A subnormal f64 (not 0, under the smallest normal). */
// @ts-ignore: decorator
@inline function sub(x: f64): bool { return x != 0.0 && abs<f64>(x) < 2.2250738585072014e-308; }
/** Under the toolkit's floor but not 0 (it should never hold one). */
// @ts-ignore: decorator
@inline function under(x: f64): bool { return x != 0.0 && abs<f64>(x) < 1e-20; }

// --- Envelopes ------------------------------------------------------------------------------------

const adsr = new Adsr();
/** An ADSR held `n` samples (attack, decay T60, sustain), its level out; returns how many levels were under the floor and not 0. */
export function adsrHeld(n: i32, attack: f64, decayT60: f64, sustain: f64, sr: f64, endLevel: f64): i32 {
  adsr.stop(); adsr.endLevel = endLevel; adsr.setAttack(attack, sr); adsr.setDecayT60(decayT60, sr); adsr.setSustain(sustain); adsr.start();
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { const l = adsr.next(); out(i, l); if (under(l) || under(adsr.level)) bad++; }
  return bad;
}
/** Attack to 1 (held `hold` samples, sustain 1), then released with `releaseT60`: the levels; returns the sample it went idle (or -1). */
export function adsrRelease(n: i32, hold: i32, releaseT60: f64, sr: f64, endLevel: f64, holdAttack: i32, releaseAt: i32): i32 {
  adsr.stop(); adsr.endLevel = endLevel; adsr.holdAttack = holdAttack != 0; adsr.setAttack(<f64>hold / sr, sr); adsr.setDecayT60(1, sr); adsr.setSustain(1); adsr.setReleaseT60(releaseT60, sr); adsr.start();
  let idle = -1;
  for (let i = 0; i < lim(n); i++) {
    if (i == releaseAt) { adsr.release(); adsr.release(); }
    const l = adsr.next(); out(i, l);
    if (idle < 0 && !adsr.active) idle = i;
  }
  adsr.holdAttack = false;
  return idle;
}
const ar = new Ar();
export function arRun(n: i32, attack: f64, releaseT60: f64, sr: f64, releaseAt: i32): i32 {
  ar.stop(); ar.endLevel = 1e-30; ar.setAttack(attack, sr); ar.setReleaseT60(releaseT60, sr); ar.start();
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { if (i == releaseAt) ar.release(); const l = ar.next(); out(i, l); if (under(l)) bad++; }
  return bad;
}

const glide = new Glide();
/** A glide from `from` to `to` with time constant `tau`: values out; returns the count under the floor and not 0. */
export function glideRun(n: i32, from: f64, to: f64, tau: f64, sr: f64): i32 {
  glide.snap(from); glide.setTime(tau, sr); glide.target = to;
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { const v = glide.next(); out(i, v); if (under(v)) bad++; }
  return bad;
}
export function coefT60(seconds: f64, sr: f64): f64 { return t60Coef(seconds, sr); }
export function coefOnePole(seconds: f64, sr: f64): f64 { return onePoleCoef(seconds, sr); }

// --- Filters ---------------------------------------------------------------------------------------

const bq = new Biquad();
/** An impulse into a biquad, then `n` samples of silence: the output; returns the times its states were subnormal, or together under the floor and not 0. */
export function biquadImpulse(n: i32, kind: i32, hz: f64, q: f64, gainDb: f64, sr: f64): i32 {
  bq.reset(); bq.set(kind, hz, q, gainDb, sr);
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { out(i, bq.process(i == 0 ? 1.0 : 0.0)); if (sub(bq.z1) || sub(bq.z2) || (bq.z1 != 0.0 && abs<f64>(bq.z1) + abs<f64>(bq.z2) < 1e-20)) bad++; }
  return bad;
}
export function biquadResponse(kind: i32, hz: f64, q: f64, gainDb: f64, sr: f64, at: f64): f64 { bq.set(kind, hz, q, gainDb, sr); return bq.responseDb(at, sr); }
/** A sine at `at` Hz through the biquad: its amplitude over the second half (from its RMS). */
export function biquadSine(kind: i32, hz: f64, q: f64, gainDb: f64, sr: f64, at: f64, n: i32): f64 {
  bq.reset(); bq.set(kind, hz, q, gainDb, sr);
  let e = 0.0, c = 0;
  for (let i = 0; i < n; i++) { const y = bq.process(sinTurns(at * <f64>i / sr)); if (i >= n / 2) { e += y * y; c++; } }
  return Math.sqrt(2.0 * e / <f64>c);
}
const mode = new Mode();
/** A mode struck once and left `n` samples: its output; returns the states under the floor and not 0. */
export function modeDecay(n: i32, hz: f64, t60: f64, sr: f64): i32 {
  mode.reset(); mode.set(hz, t60, sr); mode.strike(1.0);
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { out(i, mode.process(0.0)); if (under(mode.re) || under(mode.im)) bad++; }
  return bad;
}
const lp = new OnePole();
export function onePoleImpulse(n: i32, hz: f64, sr: f64): i32 {
  lp.reset(); lp.setCutoff(hz, sr);
  let bad = 0;
  for (let i = 0; i < lim(n); i++) { out(i, lp.lp(i == 0 ? 1.0 : 0.0)); if (under(lp.z)) bad++; }
  return bad;
}

// --- The step clock --------------------------------------------------------------------------------

const clock = new StepClock();
export function clockSet(step: f64, swing: f64, landing: i32): void { clock.reset(); clock.step = step; clock.setSwing(swing); clock.landing = landing != 0; }
export function clockSwing(swing: f64): void { clock.setSwing(swing); }
export function clockStep(step: f64): void { clock.setStep(step); }
export function clockReset(): void { clock.reset(); }
export function clockAdvance(beat: f64, frame: f64, barStart: f64, num: i32, den: i32): i32 { return clock.advance(beat, frame, barStart, num, den) ? 1 : 0; }
export function clockIndex(): f64 { return <f64>clock.index; }
export function clockInBar(): i32 { return clock.inBar; }
export function clockBar(): f64 { return clock.bar; }
export function clockJumped(): i32 { return clock.jumped ? 1 : 0; }

// --- Randomness ------------------------------------------------------------------------------------

export function rand(step: f64, voice: i32, key: i32, salt: i32): f64 { return chance(<i64>step, voice, key, salt); }
const dice = new Dice();
export function diceSeed(step: f64, voice: i32, key: i32, salt: i32): void { dice.seed(<i64>step, voice, key, salt); }
export function diceNext(): f64 { return dice.next(); }

// --- Tails -----------------------------------------------------------------------------------------

export function tailT60(t60: f64, db: f64): f64 { return t60To(t60, db); }
export function tailTau(tau: f64, db: f64): f64 { return tauTo(tau, db); }
export function tailCoef(coef: f64, sr: f64, db: f64): f64 { return coefTo(coef, sr, db); }
export function tailEcho(delay: f64, feedback: f64, db: f64): f64 { return echoTo(delay, feedback, db); }
const tail = new Tail();
export function tailClear(): void { tail.clear(); }
export function tailThen(s: f64): void { tail.then(s); }
export function tailWith(s: f64): void { tail.with(s); }
export function tailSeconds(): f64 { return tail.seconds; }
export function tailFrames(sr: f64, cap: f64): u32 { return tail.frames(sr, cap); }

// --- Declick and ramps -----------------------------------------------------------------------------

const click = new Declick();
/**
 * A sine voice at `hz` restarted at phase 0 at sample `at` (a steal): the output, with the old voice's
 * last sample carried (`declick` 1) or dropped (0).
 */
export function stealRestart(n: i32, hz: f64, sr: f64, at: i32, declick: i32): void {
  click.clear(); click.setTime(0.002, sr);
  let ph = 0.3, last = 0.0;
  for (let i = 0; i < lim(n); i++) {
    if (i == at) { if (declick != 0) click.take(last); ph = 0.0; }
    const y = sinTurns(ph) * 0.5;
    ph += hz / sr; if (ph >= 1.0) ph -= 1.0;
    last = y;
    out(i, y + click.next());
  }
}
const ramp = new Ramp();
export function rampSnap(v: f64): void { ramp.snap(v); }
export function rampTo(t: f64, seconds: f64, sr: f64): void { ramp.to(t, seconds, sr); }
export function rampNext(): f64 { return ramp.next(); }
export function rampDone(): i32 { return ramp.done ? 1 : 0; }

// --- The steal rules (which voice `pick` takes from slots set by hand) ------------------------------------

const plainAlloc = new VoiceAllocator(4);
const oldestAlloc = new OldestVoiceAllocator(4);
function allocOf(which: i32): VoiceAllocator { return which == 0 ? plainAlloc : changetype<VoiceAllocator>(oldestAlloc); }
/** Slot `s` of allocator `which` (0 the toolkit's, 1 the SDK rule's) set to `state`, `age`, owned and waiting. */
export function slotSet(which: i32, s: i32, state: i32, age: i32, owned: i32, waiting: i32): void {
  const v = unchecked(allocOf(which).slots[s]);
  v.state = state; v.age = <i64>age; v.owned = owned != 0; v.internal = owned == 0; v.waiting = waiting != 0;
}
export function slotPick(which: i32, protectPlayed: i32): i32 { return allocOf(which).pick(protectPlayed != 0); }

function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
