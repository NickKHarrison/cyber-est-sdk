/**
 * Scales for the piano roll's highlighting and fold (Cyber_Sequencer_Polish_Work_Order.md §2, §5):
 * a root pitch class (0 = C … 11 = B) and a mode. Highlighting only: notes off the scale are
 * allowed, as in Ableton.
 */

export type ScaleMode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'harmonicMinor' | 'pentatonicMajor' | 'pentatonicMinor' | 'blues';

export interface Scale { root: number; mode: ScaleMode }

/** Semitones from the root, per mode. */
export const SCALE_INTERVALS: Readonly<Record<ScaleMode, readonly number[]>> = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
});

export const SCALE_MODES = Object.keys(SCALE_INTERVALS) as ScaleMode[];

export const SCALE_LABELS: Readonly<Record<ScaleMode, string>> = Object.freeze({
  major: 'Major',
  minor: 'Minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  harmonicMinor: 'Harmonic minor',
  pentatonicMajor: 'Pentatonic major',
  pentatonicMinor: 'Pentatonic minor',
  blues: 'Blues',
});

/** Root names, sharps as Cyber's note names show them. */
export const ROOT_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** The pitch classes of a scale. */
export function scaleClasses(s: Scale): Set<number> {
  return new Set(SCALE_INTERVALS[s.mode].map(i => (s.root + i) % 12));
}

/** Whether a MIDI pitch is in the scale. */
export function inScale(pitch: number, s: Scale): boolean {
  const pc = ((pitch - s.root) % 12 + 12) % 12;
  return SCALE_INTERVALS[s.mode].includes(pc);
}

/** The MIDI pitches 0–127 in the scale, high to low (the roll's row order). */
export function scaleRows(s: Scale): number[] {
  const out: number[] = [];
  for (let p = 127; p >= 0; p--) if (inScale(p, s)) out.push(p);
  return out;
}

/** "A minor", "C major". */
export function scaleName(s: Scale): string {
  return `${ROOT_NAMES[s.root]} ${SCALE_LABELS[s.mode].toLowerCase()}`;
}

/** A scale from anything (projects, live sessions): null when not a valid one. */
export function sanitiseScale(raw: unknown): Scale | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const root = typeof r.root === 'number' && Number.isInteger(r.root) && r.root >= 0 && r.root <= 11 ? r.root : null;
  const mode = typeof r.mode === 'string' && (SCALE_MODES as string[]).includes(r.mode) ? r.mode as ScaleMode : null;
  return root === null || mode === null ? null : { root, mode };
}

// --- 1.353 (Cyber_Instruments_MIDI_Work_Order.md, stream 6): the scale drives input -------------

/** The pitch a scale degree stands for from a base (the root's pitch in an octave): degree 0 the root, past the mode's length the next octave's. */
export function degreePitch(s: Scale, base: number, degree: number): number {
  const iv = SCALE_INTERVALS[s.mode];
  const n = iv.length;
  const oct = Math.floor(degree / n);
  return base + iv[((degree % n) + n) % n]! + 12 * oct;
}

/**
 * The computer keys in Scale mode (decided: Live 12's feel, foolproof): the white-key row A S D F G
 * H J K L ; walks the scale's degrees from its root in the keys' octave (`low`, the C the A key
 * plays; the root is the first C-to-B pitch of the root's class at or above it), so every key is in
 * key; the black-key row W E T Y U O P plays nothing (null). `whiteIndex` is the key's place in
 * `WHITE_KEYS`, −1 for a black key.
 */
export function scaleKeyPitch(s: Scale, low: number, whiteIndex: number): number | null {
  if (whiteIndex < 0) return null;
  const p = degreePitch(s, low + s.root, whiteIndex);
  return p >= 0 && p <= 127 ? p : null;
}

/** The computer keys' white-key row, in order (the scale's degrees in Scale mode). */
export const WHITE_KEYS = 'asdfghjkl;';

/**
 * The nearest pitch in the scale (decided: a tie between the one below and the one above goes
 * **down**, so E in C minor snaps to E♭), within 0–127.
 */
export function snapToScale(pitch: number, s: Scale): number {
  const p = Math.max(0, Math.min(127, Math.round(pitch)));
  if (inScale(p, s)) return p;
  for (let d = 1; d <= 6; d++) {
    if (p - d >= 0 && inScale(p - d, s)) return p - d;
    if (p + d <= 127 && inScale(p + d, s)) return p + d;
  }
  return p;
}

/** The pitch `steps` scale degrees from `pitch` (snapped into the scale first), within 0–127. */
export function stepInScale(pitch: number, s: Scale, steps: number): number {
  let p = snapToScale(pitch, s);
  const dir = steps < 0 ? -1 : 1;
  for (let k = 0; k < Math.abs(steps); k++) {
    let q = p + dir;
    while (q >= 0 && q <= 127 && !inScale(q, s)) q += dir;
    if (q < 0 || q > 127) break;
    p = q;
  }
  return p;
}

/** A drawn note's pitch in Scale mode (`on`): snapped to the clip's scale when it has one, else as drawn. The roll's one call. */
export function drawPitch(pitch: number, s: Scale | null | undefined, on: boolean): number {
  return on && s ? snapToScale(pitch, s) : pitch;
}

/** "C min", "F♯ maj": the keys button's short name for a scale. */
export function scaleShort(s: Scale): string {
  const m: Record<ScaleMode, string> = { major: 'maj', minor: 'min', dorian: 'dor', mixolydian: 'mix', harmonicMinor: 'hmi', pentatonicMajor: 'pmj', pentatonicMinor: 'pmn', blues: 'blu' };
  return `${ROOT_NAMES[s.root]} ${m[s.mode]}`;
}
