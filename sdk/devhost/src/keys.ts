/**
 * The computer keys as notes, Cyber's layout (the home row from A is the white keys from C, the row
 * above the black keys; Z and X move the octave). Pure.
 */
const ROW: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/** The note a key plays at `octave` (C of that octave, MIDI: octave 4 is 60), or null. */
export function noteForKey(code: string, octave: number): number | null {
  const k = ROW[code];
  if (k === undefined) return null;
  const n = 12 * (octave + 1) + k;
  return n >= 0 && n <= 127 ? n : null;
}

/** Z and X: one octave down and up (−1 to 8). */
export function octaveForKey(code: string, octave: number): number | null {
  if (code === 'KeyZ') return Math.max(-1, octave - 1);
  if (code === 'KeyX') return Math.min(8, octave + 1);
  return null;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** A note's name: 60 is C4. */
export const noteName = (n: number) => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
export const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

/** Whether a key event belongs to something being typed in (or a control that keeps its keys). */
export function keepsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], est-knob, est-slider, iframe')) return true;
  return false;
}

/** A Web MIDI message as what the dev host does with it. */
export type MidiAction =
  | { type: 'on'; key: number; velocity: number }
  | { type: 'off'; key: number }
  | { type: 'bend'; value: number }
  | { type: 'cc'; num: number; value: number }
  | null;

export function midiAction(data: ArrayLike<number>): MidiAction {
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const a = data[1] ?? 0;
  const b = data[2] ?? 0;
  if (kind === 0x90 && b > 0) return { type: 'on', key: a, velocity: b };
  if (kind === 0x80 || (kind === 0x90 && b === 0)) return { type: 'off', key: a };
  if (kind === 0xe0) return { type: 'bend', value: ((b << 7) | a) / 8192 - 1 };
  if (kind === 0xb0) return { type: 'cc', num: a, value: b };
  return null;
}
