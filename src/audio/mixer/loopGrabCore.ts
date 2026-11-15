/**
 * LOOPGRAB's arithmetic (1.601): the one place its grid, lengths, Chance roll, decay, filter sweep
 * and ring size are computed. Pure and **self-contained**: `loopGrabCore` references nothing
 * outside its own body, so `loopGrabWorklet.ts` injects it into the audio thread as a string
 * (`const LG = (<this function>)();`, the `WAVE_BUILD_LEVELS` pattern) and the main thread, the
 * card and the tests call the very same functions. No class fields, no imports, no outside values.
 *
 * Beats are the song's (quarter notes). A "bar" is the meter's bar in beats (`barBeatsAt`), handed
 * in: the core never assumes 4/4.
 */
export function loopGrabCore() {
  /** The Length choices' note values: a fraction of a whole note (4 beats), then whole bars. */
  const LENGTH_NOTES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2];
  const LENGTH_BARS = [1, 2, 4];
  /** The Repeat choices in beats (0: off). */
  const REPEAT_BEATS = [0, 1, 2, 4, 8, 16];
  /** The ring holds this many bars at the song's slowest tempo: the longest grab (4 bars) and the longest repeat (16 beats) after it. */
  const RING_BARS = 8;
  /** Never more than this many seconds a channel, whatever the tempo (60 s at 48 kHz is 11.5 MB a channel, 23 MB for two; the context's total is `LOOPGRAB_RING_BUDGET_BYTES` in loopGrab.ts). */
  const MAX_RING_SECONDS = 60;
  /** The slowest tempo the ring is ever sized for (the song's floor, `MIN_TEMPO`). */
  const MIN_BPM = 40;
  /** The longest pitch-down the ring ever reads past (±24 semitones). */
  const MAX_SEMIS = 24;
  const EPS = 1e-6;

  /** A Length choice in beats (`bar`: the bar in beats where the grab is). */
  function lengthBeats(index: number, bar: number): number {
    const i = Math.max(0, Math.min(LENGTH_NOTES.length + LENGTH_BARS.length - 1, Math.round(index)));
    if (i < LENGTH_NOTES.length) return LENGTH_NOTES[i]! * 4;
    return LENGTH_BARS[i - LENGTH_NOTES.length]! * Math.max(1, bar);
  }

  /** A Repeat choice in beats (0: no re-grab). */
  function repeatBeats(index: number): number {
    const i = Math.max(0, Math.min(REPEAT_BEATS.length - 1, Math.round(index)));
    return REPEAT_BEATS[i]!;
  }

  /** The grid a grab starts on: its own length up to a beat, then the beat ("on the beat"). */
  function quantum(lenBeats: number): number {
    return Math.min(lenBeats, 1);
  }

  /** The first grid point at or after `beat` (a beat on the grid is its own). */
  function nextGrid(beat: number, q: number): number {
    if (!(q > 0)) return beat;
    return Math.ceil(beat / q - EPS) * q;
  }

  /** The step Chance rolls on: the grab's length, at least a beat. */
  function chanceStep(lenBeats: number): number {
    return Math.max(1, lenBeats);
  }

  /** The step index holding `beat` (a beat on a step line starts that step). */
  function stepIndex(beat: number, step: number): number {
    return Math.floor(beat / step + EPS);
  }

  /**
   * Whether Chance grabs on step `index`: a hash of the step and the slot's seed against the
   * amount, so the same song position decides the same way live, offline and for every peer.
   */
  function chanceHit(index: number, seed: number, chance: number): boolean {
    if (!(chance > 0)) return false;
    if (chance >= 1) return true;
    let h = (Math.imul(index | 0, 0x9e3779b1) ^ (seed | 0)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 < chance;
  }

  /** A slot id's seed (FNV-1a over its characters). */
  function seedOf(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h | 0;
  }

  /** Each repeat quieter: the gain of pass `pass` (0 the first) with Decay `decay` (0…1). */
  function decayGain(pass: number, decay: number): number {
    const d = Math.max(0, Math.min(1, decay));
    if (d <= 0) return 1;
    // 1.621 (P4-07): below −120 dB a pass is silence, never a subnormal gain.
    const g = Math.pow(1 - d, pass);
    return g < 1e-6 ? 0 : g;
  }

  /**
   * The filter sweep's cutoff (Hz) after `progress` passes (fractional): Filter below 0 closes a
   * low-pass from 20 kHz, above 0 opens a high-pass from 20 Hz, reaching its depth after 8 passes.
   * 0: no filter (returns 0).
   */
  function sweepCutoff(filter: number, progress: number): number {
    const f = Math.max(-1, Math.min(1, filter));
    if (Math.abs(f) < 1e-4) return 0;
    const s = Math.min(1, Math.max(0, progress) / 8) * Math.abs(f);
    return f < 0 ? 20000 * Math.pow(2, -8 * s) : 20 * Math.pow(2, 9 * s);
  }

  /** Pitch as the read rate (±24 semitones by resampling). */
  function pitchRate(semis: number): number {
    return Math.pow(2, Math.max(-MAX_SEMIS, Math.min(MAX_SEMIS, semis)) / 12);
  }

  /**
   * The ring's frames a channel at the slowest tempo, plus one quantum: RING_BARS bars, or the
   * longest grab and the longest repeat after it where a bar is short, never past 16 bars or
   * MAX_RING_SECONDS (where it cannot hold both, the worklet stops recording while a grab plays).
   */
  function ringFrames(slowestBpm: number, bar: number, sampleRate: number): number {
    const bpm = Math.max(MIN_BPM, slowestBpm > 0 ? slowestBpm : MIN_BPM);
    const b = Math.max(1, bar);
    const beats = Math.min(16 * b, Math.max(RING_BARS * b, 4 * b + REPEAT_BEATS[REPEAT_BEATS.length - 1]!));
    const seconds = Math.min(MAX_RING_SECONDS, (beats * 60) / bpm);
    return Math.ceil(seconds * sampleRate) + 128;
  }

  /** A grab's loop in frames: its length at the tempo now, within the ring (less a quantum's margin). */
  function loopFrames(lenBeats: number, bpm: number, sampleRate: number, capacity: number): number {
    const f = Math.round((lenBeats * 60 * sampleRate) / Math.max(1, bpm));
    return Math.max(32, Math.min(capacity - 256, f));
  }

  return {
    LENGTH_NOTES, LENGTH_BARS, REPEAT_BEATS, RING_BARS, MAX_RING_SECONDS, MIN_BPM, EPS,
    lengthBeats, repeatBeats, quantum, nextGrid, chanceStep, stepIndex, chanceHit, seedOf,
    decayGain, sweepCutoff, pitchRate, ringFrames, loopFrames,
  };
}

/** The core, made once for the main thread. */
export const LG = loopGrabCore();

/** The Length choices' labels (fxDefs.ts' `length`), in the core's order. */
export const LOOPGRAB_LENGTHS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1 bar', '2 bars', '4 bars'] as const;
/** The Repeat choices' labels, in the core's order. */
export const LOOPGRAB_REPEATS = ['Off', '1 beat', '2 beats', '4 beats', '8 beats', '16 beats'] as const;

/**
 * Where a grab asked for at song beat `beat` starts (pure; the worklet does the same per sample):
 * while the song plays, the next point of its grid; stopped, at once.
 */
export function grabStartBeat(beat: number, lengthIndex: number, bar: number, playing: boolean): number {
  if (!playing) return beat;
  return LG.nextGrid(beat, LG.quantum(LG.lengthBeats(lengthIndex, bar)));
}

/**
 * The grabs Chance makes over [from, to) beats (pure: the worklet rolls the same steps): each is
 * one step long, starting on its step line.
 */
export function chanceGrabs(from: number, to: number, lengthIndex: number, bar: number, chance: number, seed: number): { start: number; end: number }[] {
  const step = LG.chanceStep(LG.lengthBeats(lengthIndex, bar));
  const out: { start: number; end: number }[] = [];
  for (let i = Math.ceil(from / step - LG.EPS); i * step < to - LG.EPS; i++) {
    if (LG.chanceHit(i, seed, chance)) out.push({ start: i * step + 0, end: (i + 1) * step });
  }
  return out;
}

/**
 * The re-grabs of a grab started at `start` and held until `end` with Repeat `repeatIndex` (pure):
 * the start, then every N beats after it.
 */
export function repeatGrabs(start: number, end: number, repeatIndex: number): number[] {
  const n = LG.repeatBeats(repeatIndex);
  if (!(n > 0)) return [start];
  const out: number[] = [];
  for (let b = start; b < end - LG.EPS; b += n) out.push(b);
  return out;
}
