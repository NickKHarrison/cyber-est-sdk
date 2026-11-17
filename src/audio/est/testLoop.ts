/**
 * DEV-D (1.323): the built-in loop the public plugin page's **Play** runs a plugin on (server/pluginPages.mjs,
 * `src/pluginPages/play.ts`). 1.336 (Cyber_EST_Robustness_Work_Order.md R-E, D-58: one loop for every test
 * rig): moved here from `src/pluginPages/playLoop.ts` (a re-export), so the Home plugin page's player
 * (`src/components/est/page/loopPlayer.ts`) plays the very same loop and phrase. Light: pure apart from
 * the AudioBuffer channels it fills; no store, no Web Audio.
 *
 * An effect hears a two-bar drum and chord loop (`fillLoop`; since 1.336 also drums only, or the chord
 * alone, `LoopKind`); an instrument plays a two-bar phrase of notes. Quiet by design: the loop peaks at
 * `LOOP_PEAK` and the page's output gain is `PLAY_GAIN`, so a plugin's own gain cannot make Play loud at
 * once.
 */

/** The loop's tempo (beats a minute) and length (bars of 4/4). */
export const LOOP_BPM = 110;
export const LOOP_BARS = 2;
/** The loop's peak (linear) and the page's output gain after the plugin (−12 dB). */
export const LOOP_PEAK = 0.5;
export const PLAY_GAIN = 0.25;
/** How long Play runs before it stops by itself (s). */
export const PLAY_SECONDS = 30;

export const loopSeconds = (bpm = LOOP_BPM, bars = LOOP_BARS): number => (60 / bpm) * 4 * bars;

/**
 * 1.336: which of the loop's parts sound: `full` (the drums and the chord: the public page's loop,
 * unchanged), `drums` (the kick and hats alone), `chord` (the sustained chord alone: reverbs, modulation).
 */
export type LoopKind = 'full' | 'drums' | 'chord';
export const LOOP_KINDS: readonly { kind: LoopKind; label: string }[] = [
  { kind: 'full', label: 'Drums and chord' },
  { kind: 'drums', label: 'Drums only' },
  { kind: 'chord', label: 'Sustained chord' },
];

/** A note of the instrument phrase: start and length in beats, a MIDI key, a velocity 0…1. */
export interface LoopNote { beat: number; beats: number; key: number; velocity: number }

/** The instrument phrase (two bars, C minor): a bass, a chord on each bar and a short melody. */
export function loopNotes(): LoopNote[] {
  const out: LoopNote[] = [];
  const bass = [36, 36, 43, 41];
  bass.forEach((key, i) => out.push({ beat: i * 2, beats: 1.5, key, velocity: 0.8 }));
  for (const [bar, chord] of [[0, [60, 63, 67]], [1, [58, 62, 65]]] as const) for (const key of chord) out.push({ beat: bar * 4, beats: 3.5, key, velocity: 0.55 });
  [72, 75, 74, 70, 72, 67].forEach((key, i) => out.push({ beat: 0.5 + i * 1.25, beats: 0.5, key, velocity: 0.7 }));
  return out.sort((a, b) => a.beat - b.beat || a.key - b.key);
}

/** One event of the phrase: a note on or off at a context time, with its note id (the page's own numbering). */
export interface PhraseEvent { type: 'noteOn' | 'noteOff'; time: number; key: number; velocity: number; noteId: number }

/** The note events of one pass of the phrase from context time `t0` (s), with ids from `firstId`. */
export function phraseEvents(t0: number, firstId = 1, bpm = LOOP_BPM): PhraseEvent[] {
  const spb = 60 / bpm;
  const events: PhraseEvent[] = [];
  loopNotes().forEach((n, i) => {
    const id = firstId + i;
    events.push({ type: 'noteOn', time: t0 + n.beat * spb, key: n.key, velocity: n.velocity, noteId: id });
    events.push({ type: 'noteOff', time: t0 + (n.beat + n.beats) * spb, key: n.key, velocity: 0, noteId: id });
  });
  return events.sort((a, b) => a.time - b.time);
}

/** A small seeded noise (the hats), so every Play sounds the same. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 31 - 1; };
}

/**
 * Fill a stereo loop for an effect: kick, hats and a chord, peaking at `LOOP_PEAK`. `kind` leaves the
 * drums or the chord out (each part's samples are then exactly 0, so `full` is unchanged from 1.323:
 * its test's checksum holds), and the kind kept is normalised to `LOOP_PEAK` on its own.
 */
export function fillLoop(left: Float32Array, right: Float32Array, rate: number, bpm = LOOP_BPM, kind: LoopKind = 'full'): void {
  const n = left.length;
  const spb = 60 / bpm;
  const rnd = noise(7);
  const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const chords = [[60, 63, 67], [58, 62, 65]];
  const drums = kind !== 'chord' ? 1 : 0;
  const pads = kind !== 'drums' ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const beat = t / spb;
    const inBeat = beat - Math.floor(beat);
    const tb = inBeat * spb;
    // Kick on every beat: a falling sine.
    const kick = drums * Math.sin(2 * Math.PI * (50 * tb + 60 * (1 - Math.exp(-tb * 30)) / 30)) * Math.exp(-tb * 9);
    // Hats on the off-beats (the noise is drawn whatever the kind, so the hats are the same in every kind).
    const off = beat * 2 - Math.floor(beat * 2);
    const th = off * spb / 2;
    const hat = drums * (Math.floor(beat * 2) % 2 === 1 ? rnd() * Math.exp(-th * 60) * 0.3 : 0);
    // A chord per bar, soft saws.
    const chord = chords[Math.floor(beat / 4) % chords.length] ?? chords[0]!;
    let pad = 0;
    for (const m of chord) { const f = mtof(m); pad += ((t * f) % 1) * 2 - 1; }
    pad *= 0.06 * pads;
    left[i] = kick * 0.6 + hat * 0.9 + pad;
    right[i] = kick * 0.6 + hat * 0.6 + pad;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
  const k = peak > 0 ? LOOP_PEAK / peak : 1;
  for (let i = 0; i < n; i++) { left[i] = (left[i] ?? 0) * k; right[i] = (right[i] ?? 0) * k; }
}
